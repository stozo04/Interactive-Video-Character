import { bot, getStevenChatId } from "../../telegram/telegramClient";
import { log } from "../runtimeLogger";
import {
  appendConversationHistory,
  getTodaysInteractionId,
} from "../../src/services/conversationHistoryService";
import { pollAndProcessMentionsDetailed } from "./xMentionService";
import {
  markMentionAnnouncementDelivered,
  markMentionAnnouncementHistoryLogged,
  queueMentionAnnouncement,
  type StoredMention,
} from "./xTwitterServerService";

const LOG_PREFIX = "[XMentionHeartbeat]";
const runtimeLog = log.fromContext({ source: "xMentionHeartbeat", route: "server/x-mentions" });

const TICK_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 15_000;

function buildNotificationMessage(
  mention: StoredMention,
  hasDraftedReply: boolean,
): string {
  if (mention.isKnownUser) {
    if (hasDraftedReply) {
      return `Okay wait—I just saw your comment on X from @${mention.authorUsername}: "${mention.text}" I already have a reply drafted if you want me to send it.`;
    }
    return `Okay wait—I just saw your comment on X from @${mention.authorUsername}: "${mention.text}"`;
  }

  return `I just picked up a new X mention from @${mention.authorUsername}: "${mention.text}" Want me to handle it?`;
}

async function deliverTelegramMessage(mentionId: string, message: string): Promise<boolean> {
  const chatId = getStevenChatId();
  if (!chatId) return false;

  try {
    await bot.api.sendMessage(chatId, message);
    await markMentionAnnouncementDelivered(mentionId, "telegram");
    runtimeLog.info("X mention heartbeat delivered to Telegram", {
      chatId,
      mentionId,
    });
    return true;
  } catch (err) {
    runtimeLog.error("Failed to deliver X mention heartbeat to Telegram", {
      mentionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function persistMessage(mentionId: string, message: string): Promise<void> {
  try {
    const interactionId = await getTodaysInteractionId();
    const logId = crypto.randomUUID();
    await appendConversationHistory(
      [{ role: "model", text: message }],
      interactionId ?? undefined,
      logId,
    );
    await markMentionAnnouncementHistoryLogged(mentionId);
  } catch (err) {
    runtimeLog.error("Failed to persist X mention heartbeat message", {
      mentionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function tick(): Promise<void> {
  try {
    const result = await pollAndProcessMentionsDetailed();
    if (result.mentionCount <= 0) return;

    const draftedIds = new Set(result.draftedMentionIds);
    const notifications = [...result.newMentions, ...result.reclassifiedMentions]
      .filter((mention, index, array) => array.findIndex((item) => item.id === mention.id) === index)
      .filter((mention) => !mention.announcementCreatedAt);

    for (const mention of notifications) {
      const message = buildNotificationMessage(mention, draftedIds.has(mention.id));
      const queued = await queueMentionAnnouncement(mention.id, message);
      if (!queued) continue;

      const telegramDelivered = await deliverTelegramMessage(mention.id, message);
      if (telegramDelivered) {
        await persistMessage(mention.id, message);
      }
    }
  } catch (err) {
    runtimeLog.error("X mention heartbeat tick failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startXMentionHeartbeat(): { stop: () => void } {
  runtimeLog.info("X mention heartbeat started", {
    logPrefix: LOG_PREFIX,
    tickMs: TICK_MS,
    initialDelayMs: INITIAL_DELAY_MS,
  });

  setTimeout(() => {
    void tick();
  }, INITIAL_DELAY_MS);

  intervalId = setInterval(() => {
    void tick();
  }, TICK_MS);

  return {
    stop: () => {
      if (!intervalId) return;
      clearInterval(intervalId);
      intervalId = null;
      runtimeLog.info("X mention heartbeat stopped", {
        logPrefix: LOG_PREFIX,
      });
    },
  };
}
