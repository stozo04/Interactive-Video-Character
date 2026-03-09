import { getActiveSock, sentMessageIds } from "./baileyClient";
import { supabaseAdmin as supabase } from "../server/services/supabaseAdmin";
import { log } from "../lib/logger";
import {
  appendConversationHistory,
  getTodaysInteractionId,
} from "../src/services/conversationHistoryService";

const LOG_PREFIX = "[XMentionBridge]";
const runtimeLog = log.fromContext({ source: "xMentionBridge", route: "whatsapp/x-mentions" });
const POLL_INTERVAL_MS = 60_000;
const STEVEN_JID = process.env.WHATSAPP_STEVEN_JID;

export function startXMentionBridge(): { stop: () => void } {
  let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (startupTimeoutId) {
      clearTimeout(startupTimeoutId);
      startupTimeoutId = null;
    }
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    runtimeLog.info("X mention bridge stopped");
  };

  if (!STEVEN_JID) {
    runtimeLog.warning("X mention bridge disabled: WHATSAPP_STEVEN_JID not configured");
    return { stop };
  }

  runtimeLog.info("X mention bridge started", {
    logPrefix: LOG_PREFIX,
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  startupTimeoutId = setTimeout(() => {
    void pollQueuedMentionAnnouncements();
    intervalId = setInterval(() => void pollQueuedMentionAnnouncements(), POLL_INTERVAL_MS);
  }, 3_000);

  return { stop };
}

async function pollQueuedMentionAnnouncements(): Promise<void> {
  const sock = getActiveSock();
  if (!sock) return;

  const { data, error } = await supabase
    .from("x_mentions")
    .select("id, tweet_id, author_username, announcement_text, history_logged_at")
    .not("announcement_created_at", "is", null)
    .is("whatsapp_sent_at", null)
    .not("announcement_text", "is", null)
    .order("announcement_created_at", { ascending: true })
    .limit(5);

  if (error) {
    runtimeLog.error("Failed to poll queued X mention announcements", {
      error: error.message,
    });
    return;
  }

  if (!data?.length) return;

  for (const row of data) {
    const message = row.announcement_text as string | null;
    if (!message) continue;

    try {
      const sent = await sock.sendMessage(STEVEN_JID!, { text: message });
      if (sent?.key?.id) {
        sentMessageIds.add(sent.key.id);
      }

      const updatePayload: Record<string, string> = {
        whatsapp_sent_at: new Date().toISOString(),
      };

      if (!row.history_logged_at) {
        const interactionId = await getTodaysInteractionId();
        const logId = crypto.randomUUID();
        await appendConversationHistory(
          [{ role: "model", text: message }],
          interactionId ?? undefined,
          logId,
        );
        updatePayload.history_logged_at = new Date().toISOString();
      }

      await supabase
        .from("x_mentions")
        .update(updatePayload)
        .eq("id", row.id);

      runtimeLog.info("Queued X mention announcement delivered to WhatsApp", {
        mentionId: row.id,
        tweetId: row.tweet_id,
        authorUsername: row.author_username,
      });
    } catch (err) {
      runtimeLog.error("Failed to deliver queued X mention announcement to WhatsApp", {
        mentionId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
