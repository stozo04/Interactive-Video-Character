import { sentMessageIds, type WASocket } from "./baileyClient";
import { serverGeminiService } from "../services/ai/serverGeminiService";
import { processUserMessage } from "../../src/services/messageOrchestrator";
import {
  loadTodaysConversationHistory,
  getTodaysInteractionId,
} from "../../src/services/conversationHistoryService";
import type { OrchestratorResult } from "../../src/handlers/messageActions/types";
import type { UserContent } from "../../src/services/aiService";
import { generateSpeechBuffer } from "./serverAudio";
import { createWhatsAppSticker } from "./serverSticker";
import { log } from "../runtimeLogger";
import { supabaseAdmin as supabase } from "../services/supabaseAdmin";
import {
  fetchEmailBody as gogFetchEmailBody,
  archiveEmail as gogArchiveEmail,
  sendReply as gogSendReply,
} from "../services/gogService";
import { composePolishedReply } from "../../src/services/emailProcessingService";
import {
  addAutoArchiveRule,
  checkAutoArchiveRule,
  extractEmailAddress,
  extractDisplayName,
} from "../services/autoArchiveService";
import {
  formatTweetApprovalPrompt,
  getPendingDraftForConversationScope,
  parseTweetApprovalAction,
  resolveTweetDraft,
} from "../services/xTwitterServerService";
import fs from "fs";
import path from "path";
import { NewEmailPayload } from "../../src/types";
const LOG_PREFIX = "[WhatsApp]";
const INBOUND_DEDUPE_TTL_MS = 10 * 60 * 1000;

// ============================================================================
// AUTO-ARCHIVE CONFIRMATION STATE
// After a manual archive Kayley asks "always archive from X?". The pending
// confirmation lives here (in-process memory) until the next WA message.
// ============================================================================

let pendingAutoArchiveConfirm: { email: string; name: string } | null = null;
const runtimeLog = log.fromContext({ source: "whatsappHandler", route: "whatsapp/handler" });
const TYPING_INDICATOR_INTERVAL_MS = 4500;
const processedInboundMessageKeys = new Map<string, number>();

function pruneInboundMessageCache(nowMs: number): void {
  for (const [key, timestamp] of processedInboundMessageKeys.entries()) {
    if (nowMs - timestamp > INBOUND_DEDUPE_TTL_MS) {
      processedInboundMessageKeys.delete(key);
    }
  }
}

async function sendTypingState(sock: WASocket, jid: string, state: "composing" | "paused"): Promise<void> {
  try {
    await sock.sendPresenceUpdate(state, jid);
    runtimeLog.info("Typing state sent", {
      source: "whatsappHandler",
      jid,
      state,
    });
  } catch (error) {
    runtimeLog.warning("Failed to send typing state", {
      source: "whatsappHandler",
      jid,
      state,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function startTypingIndicator(sock: WASocket, jid: string): () => Promise<void> {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const sendComposing = () => {
    void sendTypingState(sock, jid, "composing");
  };

  sendComposing();
  timer = setInterval(sendComposing, TYPING_INDICATOR_INTERVAL_MS);

  return async () => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    await sendTypingState(sock, jid, "paused");
  };
}

function isFetchableUrl(url: string): boolean {
  const isFetchable = url.startsWith("http://") || url.startsWith("https://");
  if (!isFetchable) {
    runtimeLog.info("URL is not fetchable", {
      source: "whatsappHandler",
      url: url.substring(0, 100),
      isFetchable,
    });
  }
  return isFetchable;
}

const ALLOWED_MEDIA_HOSTS = new Set([
  "media.giphy.com",
  "giphy.com",
]);
const ALLOWED_MEDIA_DOMAINS = ["giphy.com"];
const MAX_GIF_BYTES = 12 * 1024 * 1024;

function getGiphyApiKey(): string | null {
  const envKey = process.env.GIPHY_API_KEY;
  const viteKey = (globalThis as any).__importMetaEnv?.VITE_GIPHY_API_KEY as string | undefined;
  return envKey || viteKey || null;
}

function parseOptionalNumber(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type GiphyRendition = {
  mp4?: string;
  mp4_size?: string;
};

type GiphyGif = {
  id?: string;
  title?: string;
  url?: string;
  rating?: string;
  images?: Record<string, GiphyRendition | undefined>;
};

async function fetchGiphyMp4ForQuery(query: string): Promise<{
  ok: boolean;
  mp4Url?: string;
  rendition?: string;
  mp4Size?: number | null;
  reason?: string;
}> {
  const apiKey = getGiphyApiKey();
  if (!apiKey) {
    runtimeLog.error("GIPHY API key missing", {
      source: "whatsappHandler",
      reason: "missing_giphy_api_key",
    });
    return { ok: false, reason: "missing_giphy_api_key" };
  }

  const endpoint = new URL("https://api.giphy.com/v1/gifs/search");
  endpoint.searchParams.set("api_key", apiKey);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("limit", "5");
  endpoint.searchParams.set("rating", "g");
  endpoint.searchParams.set("lang", "en");

  runtimeLog.info("GIPHY search request", {
    source: "whatsappHandler",
    queryPreview: query.substring(0, 60),
    limit: 5,
    rating: "g",
  });

  try {
    const response = await fetch(endpoint.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      runtimeLog.error("GIPHY search failed", {
        source: "whatsappHandler",
        status: response.status,
        statusText: response.statusText,
        errorSnippet: errorText.substring(0, 400),
      });
      return { ok: false, reason: "giphy_search_failed" };
    }

    const payload = (await response.json()) as { data?: GiphyGif[] };
    const results = Array.isArray(payload?.data) ? payload.data : [];
    runtimeLog.info("GIPHY search response", {
      source: "whatsappHandler",
      queryPreview: query.substring(0, 60),
      resultCount: results.length,
    });
    if (results.length === 0) {
      runtimeLog.warning("GIPHY search returned no results", {
        source: "whatsappHandler",
        query,
      });
      return { ok: false, reason: "no_results" };
    }

    const preferredRenditions = ["downsized_small", "fixed_height", "fixed_width", "original"];
    for (const gif of results) {
      const images = gif.images || {};
      for (const rendition of preferredRenditions) {
        const candidate = images[rendition];
        if (!candidate?.mp4) {
          continue;
        }
        const mp4Size = parseOptionalNumber(candidate.mp4_size);
        if (mp4Size && mp4Size > MAX_GIF_BYTES) {
          continue;
        }
        runtimeLog.info("GIPHY MP4 rendition selected", {
          source: "whatsappHandler",
          gifId: gif.id,
          rendition,
          mp4Size: mp4Size ?? null,
          title: gif.title ?? null,
          rating: gif.rating ?? null,
        });
        return {
          ok: true,
          mp4Url: candidate.mp4,
          rendition,
          mp4Size: mp4Size ?? null,
        };
      }
    }

    runtimeLog.warning("No suitable GIPHY MP4 rendition found", {
      source: "whatsappHandler",
      query,
    });
    return { ok: false, reason: "no_mp4_rendition" };
  } catch (error) {
    runtimeLog.error("GIPHY search threw exception", {
      source: "whatsappHandler",
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "giphy_search_exception" };
  }
}

function isAllowedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isAllowed =
      ALLOWED_MEDIA_HOSTS.has(hostname) ||
      ALLOWED_MEDIA_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      );
    if (!isAllowed) {
      runtimeLog.warning("Media URL host not in allowlist", {
        source: "whatsappHandler",
        hostname,
        allowedHosts: Array.from(ALLOWED_MEDIA_HOSTS).join(", "),
        allowedDomains: ALLOWED_MEDIA_DOMAINS.join(", "),
      });
    }
    return isAllowed;
  } catch (err) {
    runtimeLog.warning("Failed to parse media URL", {
      source: "whatsappHandler",
      url: url.substring(0, 100),
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function fetchAndValidateVideo(
  url: string,
  options: { label: string; requireMp4: boolean; maxBytes?: number; requestHeaders?: Record<string, string> }
): Promise<{ ok: boolean; buffer?: Buffer; contentType?: string; reason?: string }> {
  runtimeLog.info("Starting video validation", {
    source: "whatsappHandler",
    label: options.label,
    requireMp4: options.requireMp4,
    maxBytes: options.maxBytes ?? null,
    urlPreview: url.substring(0, 100),
  });

  if (!isFetchableUrl(url)) {
    runtimeLog.warning("Video URL not fetchable", {
      source: "whatsappHandler",
      label: options.label,
      reason: "non_fetchable_url",
      urlPreview: url.substring(0, 100),
    });
    return { ok: false, reason: "non_fetchable_url" };
  }

  if (!isAllowedMediaUrl(url)) {
    runtimeLog.error("Video host not allowed", {
      source: "whatsappHandler",
      label: options.label,
      reason: "host_not_allowed",
      urlPreview: url.substring(0, 100),
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} blocked (host not allowed):`, { url });
    return { ok: false, reason: "host_not_allowed" };
  }

  let response: Response;
  try {
    runtimeLog.info("Fetching video from URL", {
      source: "whatsappHandler",
      label: options.label,
      urlPreview: url.substring(0, 100),
    });

    response = await fetch(url, options.requestHeaders ? { headers: options.requestHeaders } : undefined);

    runtimeLog.info("Video fetch completed", {
      source: "whatsappHandler",
      label: options.label,
      status: response.status,
      statusText: response.statusText,
      responseUrl: response.url,
      contentLength: response.headers.get("content-length"),
    });
  } catch (err) {
    runtimeLog.error("Video fetch failed with exception", {
      source: "whatsappHandler",
      label: options.label,
      urlPreview: url.substring(0, 100),
      error: err instanceof Error ? err.message : String(err),
      reason: "fetch_error",
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} fetch failed:`, err);
    return { ok: false, reason: "fetch_error" };
  }

  if (!response.ok) {
    runtimeLog.error("Video fetch returned non-2xx status", {
      source: "whatsappHandler",
      label: options.label,
      status: response.status,
      statusText: response.statusText,
      urlPreview: url.substring(0, 100),
      reason: "bad_status",
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} fetch status:`, {
      status: response.status,
      statusText: response.statusText,
      url,
    });
    return { ok: false, reason: "bad_status" };
  }

  const contentType = response.headers.get("content-type") || "";
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  const isMp4 = contentType.toLowerCase().includes("video/mp4");
  const isVideo = contentType.toLowerCase().startsWith("video/");

  runtimeLog.info("Video content type detected", {
    source: "whatsappHandler",
    label: options.label,
    contentType,
    isMp4,
    isVideo,
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
  });

  if (options.maxBytes && Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    runtimeLog.error("Video content length exceeds limit", {
      source: "whatsappHandler",
      label: options.label,
      contentLength,
      maxBytes: options.maxBytes,
      reason: "payload_too_large_header",
      urlPreview: url.substring(0, 100),
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} payload too large (header):`, {
      contentLength,
      maxBytes: options.maxBytes,
      url,
    });
    return { ok: false, reason: "payload_too_large_header" };
  }

  if (options.requireMp4 && !isMp4) {
    runtimeLog.error("Video content type is not MP4", {
      source: "whatsappHandler",
      label: options.label,
      contentType,
      requireMp4: true,
      reason: "invalid_content_type",
      urlPreview: url.substring(0, 100),
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} invalid content-type (expected mp4):`, {
      contentType,
      url,
    });
    return { ok: false, reason: "invalid_content_type" };
  }

  if (!options.requireMp4 && !isVideo) {
    runtimeLog.error("Video content type is not video/*", {
      source: "whatsappHandler",
      label: options.label,
      contentType,
      requireMp4: false,
      reason: "invalid_content_type",
      urlPreview: url.substring(0, 100),
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} invalid content-type (expected video/*):`, {
      contentType,
      url,
    });
    return { ok: false, reason: "invalid_content_type" };
  }

  try {
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      runtimeLog.error("Video buffer is empty", {
        source: "whatsappHandler",
        label: options.label,
        bufferLength: 0,
        reason: "empty_payload",
        urlPreview: url.substring(0, 100),
      });
      console.error(`${LOG_PREFIX} [MEDIA] ${options.label} empty payload:`, { url });
      return { ok: false, reason: "empty_payload" };
    }

    if (options.maxBytes && buffer.length > options.maxBytes) {
      runtimeLog.error("Video buffer exceeds size limit", {
        source: "whatsappHandler",
        label: options.label,
        bufferLength: buffer.length,
        maxBytes: options.maxBytes,
        reason: "payload_too_large_buffer",
        urlPreview: url.substring(0, 100),
      });
      console.error(`${LOG_PREFIX} [MEDIA] ${options.label} payload too large (buffer):`, {
        bufferLength: buffer.length,
        maxBytes: options.maxBytes,
        url,
      });
      return { ok: false, reason: "payload_too_large_buffer" };
    }

    runtimeLog.info("Video validation successful", {
      source: "whatsappHandler",
      label: options.label,
      bufferSize: buffer.length,
      contentType,
    });

    return { ok: true, buffer, contentType };
  } catch (bufferError) {
    runtimeLog.error("Failed to convert video response to buffer", {
      source: "whatsappHandler",
      label: options.label,
      error: bufferError instanceof Error ? bufferError.message : String(bufferError),
      urlPreview: url.substring(0, 100),
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} buffer conversion failed:`, bufferError);
    return { ok: false, reason: "buffer_conversion_error" };
  }
}

async function sendAndTrack(
  sock: WASocket,
  jid: string,
  content: any
): Promise<void> {
  const contentKeys = Object.keys(content);
  runtimeLog.info("Sending message to WhatsApp", {
    source: "whatsappHandler",
    jid,
    contentTypes: contentKeys.join(", "),
    hasText: !!content.text,
    hasImage: !!content.image,
    hasVideo: !!content.video,
    hasAudio: !!content.audio,
    hasSticker: !!content.sticker,
    gifPlayback: content.gifPlayback ?? false,
  });

  try {
    const sent = await sock.sendMessage(jid, content);

    runtimeLog.info("Message sent successfully to WhatsApp", {
      source: "whatsappHandler",
      jid,
      messageId: sent?.key?.id,
      remoteJid: sent?.key?.remoteJid,
      fromMe: sent?.key?.fromMe,
      status: sent?.status,
      contentTypes: contentKeys.join(", "),
    });

    console.log(`${LOG_PREFIX} [SEND] Sending to ${jid}:`, Object.keys(content));
    console.log(`${LOG_PREFIX} [SEND] Local Result:`, {
      id: sent?.key?.id,
      remoteJid: sent?.key?.remoteJid,
      fromMe: sent?.key?.fromMe,
      status: sent?.status,
    });

    if (sent?.key?.id) {
      sentMessageIds.add(sent.key.id);
      runtimeLog.info("Message ID tracked to prevent echo", {
        source: "whatsappHandler",
        messageId: sent.key.id,
      });
    }

    // Mark the chat as unread so the phone shows a notification badge.
    // WhatsApp suppresses push notifications for self-messages from linked
    // devices; marking unread is the best workaround within a single account.
    if (sent?.key) {
      try {
        await sock.chatModify(
          {
            markRead: false,
            lastMessages: [{ key: sent.key, messageTimestamp: sent.messageTimestamp ?? 0 }],
          },
          jid
        );
        runtimeLog.info("Chat marked as unread for notification badge", {
          source: "whatsappHandler",
          jid,
          messageId: sent.key.id,
        });
      } catch (markErr) {
        // Non-fatal — notification badge is best-effort
        runtimeLog.warning("Failed to mark chat as unread", {
          source: "whatsappHandler",
          jid,
          error: markErr instanceof Error ? markErr.message : String(markErr),
        });
      }
    }
  } catch (err) {
    runtimeLog.error("Failed to send message to WhatsApp", {
      source: "whatsappHandler",
      jid,
      contentTypes: contentKeys.join(", "),
      error: err instanceof Error ? err.message : String(err),
      errorType: err instanceof Error ? err.constructor.name : "unknown",
    });
    console.error(`${LOG_PREFIX} [SEND] FAILED:`, err);
    throw err;
  }
}

// ==========================================================================
// PENDING EMAIL: Load most-recent pending email that has been forwarded to WA
// ==========================================================================

interface PendingEmailRow {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_address: string | null;
  subject: string | null;
}

async function loadPendingEmailFromDB(): Promise<{ row: PendingEmailRow; email: NewEmailPayload } | null> {
  const { data, error } = await supabase
    .from('kayley_email_actions')
    .select('id, gmail_message_id, gmail_thread_id, from_address, subject')
    .eq('action_taken', 'pending')
    .not('whatsapp_sent_at', 'is', null)  // must have been sent to WA already
    // Prefer the latest surfaced pending email to avoid acting on stale rows.
    .order('whatsapp_sent_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  // Fetch email body via gogcli
  let body = '';
  try {
    body = await gogFetchEmailBody(data.gmail_message_id);
  } catch (err) {
    runtimeLog.warning('Could not fetch email body for pending email', {
      source: 'whatsappHandler',
      gmailMessageId: data.gmail_message_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const email = {
    id:         data.gmail_message_id,
    threadId:   data.gmail_thread_id   ?? '',
    from:       data.from_address      ?? '',
    subject:    data.subject           ?? '',
    snippet:    body.slice(0, 200),
    body,
    receivedAt: '',
  };

  return { row: data as PendingEmailRow, email };
}

async function executeWAEmailAction(
  action: 'archive' | 'reply' | 'dismiss',
  replyBody: string | undefined,
  row: PendingEmailRow,
  email: { id: string; threadId: string; from: string; subject: string; snippet: string; body: string; receivedAt: string }
): Promise<void> {
  let success = false;

  try {
    if (action === 'archive') {
      success = await gogArchiveEmail(row.gmail_message_id);

    } else if (action === 'reply' && replyBody) {
      const polished = await composePolishedReply(replyBody, email, []);
      const toMatch = email.from.match(/<(.+?)>/);
      const toAddress = toMatch ? toMatch[1] : email.from;

      success = await gogSendReply(
        row.gmail_message_id,
        toAddress,
        email.subject,
        polished
      );

    } else if (action === 'dismiss') {
      success = true;
    }

  } catch (err) {
    runtimeLog.error('gogcli call failed during WA email action', {
      source: 'whatsappHandler',
      action,
      gmailMessageId: row.gmail_message_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!success) {
    runtimeLog.warning('WA email action failed, row left as pending for retry', {
      source: 'whatsappHandler',
      action,
      rowId: row.id,
      gmailMessageId: row.gmail_message_id,
    });
    try {
      const sock = (await import('./baileyClient')).getActiveSock();
      const stevenJid = process.env.WHATSAPP_STEVEN_JID;
      if (sock && stevenJid) {
        await sock.sendMessage(stevenJid, {
          text: `Hmm, something went wrong trying to ${action} that email — it didn't go through. Want me to try again?`,
        });
      }
    } catch { /* best-effort */ }
    return;
  }

  // Only mark actioned after confirmed success
  const dbAction = action === 'dismiss' ? 'dismissed' : action;
  const { error: updateErr } = await supabase
    .from('kayley_email_actions')
    .update({
      action_taken: dbAction,
      actioned_at:  new Date().toISOString(),
    })
    .eq('id', row.id);

  if (updateErr) {
    runtimeLog.error('Failed to update kayley_email_actions after successful action', {
      source: 'whatsappHandler',
      id: row.id,
      action,
      error: updateErr.message,
    });
  } else {
    runtimeLog.info('WA email action executed', {
      source: 'whatsappHandler',
      action,
      dbAction,
      gmailMessageId: row.gmail_message_id,
    });
  }

  // After a successful archive: offer to add the sender to the auto-archive list
  // (but only if they're not already on it)
  if (action === 'archive' && success) {
    const fromEmail = extractEmailAddress(email.from);
    const fromName  = extractDisplayName(email.from) || fromEmail;

    try {
      const alreadyRuled = await checkAutoArchiveRule(fromEmail);
      if (!alreadyRuled) {
        pendingAutoArchiveConfirm = { email: fromEmail, name: fromName };

        const sock = (await import('./baileyClient')).getActiveSock();
        const stevenJid = process.env.WHATSAPP_STEVEN_JID;
        if (sock && stevenJid) {
          const msg = `Want me to always auto-archive emails from ${fromName}? Just say "yes" if so!`;
          const sent = await sock.sendMessage(stevenJid, { text: msg });
          if (sent?.key?.id) sentMessageIds.add(sent.key.id);
        }
      }
    } catch {
      pendingAutoArchiveConfirm = null; // don't leave stale state if the check failed
    }
  }
}

export async function handleWhatsAppMessage(
  sock: WASocket,
  text: string,
  jid: string,
  replyJid: string,
  userContent?: UserContent,
  inboundMessageId?: string
): Promise<void> {
  const nowMs = Date.now();
  const inboundKey = inboundMessageId ? `wa:${jid}:${inboundMessageId}` : null;
  const messageId = inboundKey ?? `${jid}_${nowMs}`;

  pruneInboundMessageCache(nowMs);
  if (inboundKey) {
    const firstSeenAt = processedInboundMessageKeys.get(inboundKey);
    if (typeof firstSeenAt === "number" && nowMs - firstSeenAt < INBOUND_DEDUPE_TTL_MS) {
      runtimeLog.warning("Skipping duplicate WhatsApp inbound message", {
        source: "whatsappHandler",
        messageId,
        jid,
        inboundMessageId,
        ageMs: nowMs - firstSeenAt,
      });
      runtimeLog.info("model_turn_trace", {
        source: "whatsappHandler",
        requestId: messageId,
        conversationLogId: null,
        channel: "whatsapp",
        turnType: "transport_duplicate_skipped",
        retryAttempt: 0,
        hasText: false,
        textLength: 0,
        transportDuplicateSkipped: true,
        pseudoToolKeys: [],
        toolUsePromptTokenCount: null,
        thoughtsTokenCount: null,
        promptTokenCount: null,
        candidatesTokenCount: null,
        totalTokenCount: null,
        inboundMessageId,
        ageMs: nowMs - firstSeenAt,
      });
      return;
    }
    processedInboundMessageKeys.set(inboundKey, nowMs);
  }

  const stopTyping = startTypingIndicator(sock, replyJid);

  runtimeLog.info("WhatsApp message handler invoked", {
    source: "whatsappHandler",
    messageId,
    jid,
    replyJid,
    inboundMessageId: inboundMessageId ?? null,
    textLength: text.length,
    textPreview: text.substring(0, 60),
    hasUserContent: !!userContent,
    userContentType: userContent?.type,
  });

  console.log(`${LOG_PREFIX} Reply JID: ${replyJid} (original: ${jid})`);
  console.log(`${LOG_PREFIX} Processing: "${text.substring(0, 60)}..."`);

  try {
    // -----------------------------------------------------------------------
    // AUTO-ARCHIVE CONFIRMATION — short-circuit before the full pipeline
    // If Kayley just asked "always archive from X?" and Steven said yes,
    // handle it here and return. Either way, always clear the pending state.
    // -----------------------------------------------------------------------
    const confirming = pendingAutoArchiveConfirm;
    pendingAutoArchiveConfirm = null;

    if (confirming) {
      const isYes = text.length < 60 &&
        /^(yes|yeah|yep|yup|sure|ok|okay|do it|add( it)?|absolutely|definitely|sounds good|go ahead)/i
          .test(text.trim());

      if (isYes) {
        runtimeLog.info("Auto-archive confirmation accepted", {
          source: "whatsappHandler",
          messageId,
          jid,
          replyJid,
          fromEmail: confirming.email,
          fromName: confirming.name,
          userReplyPreview: text.substring(0, 60),
        });
        try {
          await addAutoArchiveRule(confirming.email, confirming.name);
          await sendAndTrack(sock, replyJid, {
            text: `Done! I'll auto-archive emails from ${confirming.name} from now on. 🗑️`,
          });
        } catch {
          runtimeLog.warning("Auto-archive rule save failed after confirmation", {
            source: "whatsappHandler",
            messageId,
            jid,
            replyJid,
            fromEmail: confirming.email,
            fromName: confirming.name,
          });
          await sendAndTrack(sock, replyJid, {
            text: `Hmm, had trouble saving that — want to try again?`,
          });
        }
        return; // don't run through the orchestrator
      }
      runtimeLog.info("Auto-archive confirmation declined or skipped", {
        source: "whatsappHandler",
        messageId,
        jid,
        replyJid,
        fromEmail: confirming.email,
        fromName: confirming.name,
        userReplyPreview: text.substring(0, 60),
      });
      // Non-affirmative: fall through to normal orchestrator
    }

    runtimeLog.info("Loading interaction context", {
      source: "whatsappHandler",
      messageId,
    });

    const interactionId = await getTodaysInteractionId();
    const session = interactionId
      ? { model: serverGeminiService.model, interactionId }
      : null;

    runtimeLog.info("Interaction context loaded", {
      source: "whatsappHandler",
      messageId,
      hasInteractionId: !!interactionId,
      interactionId: interactionId ?? "none",
    });

    runtimeLog.info("Loading conversation history", {
      source: "whatsappHandler",
      messageId,
    });

    const [chatHistory, pendingEmailData] = await Promise.all([
      loadTodaysConversationHistory(),
      loadPendingEmailFromDB(),
    ]);

    runtimeLog.info("Conversation history loaded", {
      source: "whatsappHandler",
      messageId,
      historyLength: chatHistory?.length ?? 0,
      hasPendingEmail: !!pendingEmailData,
    });

    if (pendingEmailData) {
      runtimeLog.info("Injecting pending email context into orchestrator", {
        source: "whatsappHandler",
        messageId,
        gmailMessageId: pendingEmailData.row.gmail_message_id,
      });
    }

    runtimeLog.info("Processing user message through orchestrator", {
      source: "whatsappHandler",
      messageId,
      textLength: text.length,
      isMuted: true,
    });
    const conversationScopeId = `whatsapp-${jid}`;
    const mechanicalTweetAction = parseTweetApprovalAction(text);

    if (mechanicalTweetAction) {
      await handleTweetApprovalCommand(
        sock,
        replyJid,
        mechanicalTweetAction,
        conversationScopeId,
        session,
        chatHistory,
        pendingEmailData?.email ?? null,
      );
      return;
    }

    const result = await processUserMessage({
      userMessage: text,
      userContent,
      aiService: serverGeminiService,
      session,
      chatHistory,
      isMuted: true,
      pendingEmail: pendingEmailData?.email ?? null,
      conversationScopeId,
    });

    runtimeLog.info("Message processing completed", {
      source: "whatsappHandler",
      messageId,
      success: result.success,
      hasText: !!result.chatMessages?.[0]?.text,
      hasSelfie: !!result.selfieImage,
      hasSticker: !!result.stickerBuffer || !!result.rawGeneratedStickerBase64,
      hasGif: !!result.gifQuery,
      hasVideo: !!result.videoUrl,
      hasEmailAction: !!result.detectedEmailAction,
    });

    // Execute email action if orchestrator detected one
    if (result.detectedEmailAction && pendingEmailData) {
      const { action, reply_body } = result.detectedEmailAction;
      runtimeLog.info("Executing WA email action", {
        source: "whatsappHandler",
        messageId,
        action,
        gmailMessageId: pendingEmailData.row.gmail_message_id,
      });
      await executeWAEmailAction(action, reply_body, pendingEmailData.row, pendingEmailData.email);
    }

    await sendOrchestratorResult(sock, replyJid, result);
  } catch (error) {
    if (inboundKey) {
      // If processing failed, allow transport retries to process the same message id again.
      processedInboundMessageKeys.delete(inboundKey);
    }
    runtimeLog.error("Message processing failed with exception", {
      source: "whatsappHandler",
      messageId,
      jid,
      replyJid,
      textLength: text.length,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : "unknown",
    });
    console.error(`${LOG_PREFIX} Error processing message:`, error);

    try {
      await sendAndTrack(sock, replyJid, {
        text: "Sorry, I'm having trouble right now. Try again in a sec?",
      });
    } catch (fallbackError) {
      runtimeLog.error("Failed to send fallback error message", {
        source: "whatsappHandler",
        messageId,
        replyJid,
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
    }
  } finally {
    await stopTyping();
  }
}

async function sendOrchestratorResult(
  sock: WASocket,
  jid: string,
  result: OrchestratorResult
): Promise<void> {
  runtimeLog.info("Starting orchestrator result sending", {
    source: "whatsappHandler",
    jid,
    success: result.success,
  });

  if (!result.success) {
    const errorMessage = result.error || "Something went wrong processing that.";
    runtimeLog.warning("Orchestrator result indicates failure", {
      source: "whatsappHandler",
      jid,
      error: errorMessage,
    });
    await sendAndTrack(sock, jid, {
      text: errorMessage,
    });
    return;
  }

  runtimeLog.info("Orchestrator result is success, sending media responses", {
    source: "whatsappHandler",
    jid,
  });

  if (result.rawGeneratedStickerBase64) {
      try {
          runtimeLog.info("Processing generated sticker from orchestrator", {
            source: "whatsappHandler",
            jid,
            base64Length: result.rawGeneratedStickerBase64.length,
          });

          // 1. Convert it using your new utility
          const webpBuffer = await createWhatsAppSticker(result.rawGeneratedStickerBase64);

          runtimeLog.info("Generated sticker converted to WebP", {
            source: "whatsappHandler",
            jid,
            webpSize: webpBuffer.length,
          });

          // 2. Send the compliant buffer
          await sendAndTrack(sock, jid, {
              sticker: webpBuffer
          });
          console.log(`${LOG_PREFIX} Sent generated Sticker`);
          runtimeLog.info("Generated sticker sent successfully", {
            source: "whatsappHandler",
            jid,
          });
      } catch (err) {
          runtimeLog.error("Failed to generate or send sticker", {
            source: "whatsappHandler",
            jid,
            error: err instanceof Error ? err.message : String(err),
            errorType: err instanceof Error ? err.constructor.name : "unknown",
          });
          console.error(`${LOG_PREFIX} Failed to send Sticker:`, err);
      }
  }
  // --- Sending a GIF ---
  // Note: result.gifQuery is a short search term; we fetch a valid GIPHY MP4 rendition server-side.
  if (result.gifQuery && result.gifQuery.trim().length > 0) {
    try {
        runtimeLog.info("Processing GIF for sending", {
          source: "whatsappHandler",
          jid,
          gifQueryPreview: result.gifQuery.substring(0, 60),
        });

        const giphyResult = await fetchGiphyMp4ForQuery(result.gifQuery);
        if (!giphyResult.ok || !giphyResult.mp4Url) {
          runtimeLog.warning("GIPHY search failed to return a usable MP4", {
            source: "whatsappHandler",
            jid,
            reason: giphyResult.reason,
            gifQueryPreview: result.gifQuery.substring(0, 60),
          });
          await sendAndTrack(sock, jid, {
            text: result.gifMessageText || "I tried to send a GIF, but couldn't find a usable one.",
          });
          return;
        }

        runtimeLog.info("GIPHY MP4 selected for GIF send", {
          source: "whatsappHandler",
          jid,
          gifQueryPreview: result.gifQuery.substring(0, 60),
          rendition: giphyResult.rendition,
          mp4Size: giphyResult.mp4Size ?? null,
          mp4UrlPreview: giphyResult.mp4Url.substring(0, 100),
        });

        const validated = await fetchAndValidateVideo(giphyResult.mp4Url, {
          label: "GIF",
          requireMp4: true,
          maxBytes: MAX_GIF_BYTES,
          requestHeaders: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "video/mp4",
          },
        });

        if (!validated.ok || !validated.buffer) {
          runtimeLog.warning("GIF validation failed", {
            source: "whatsappHandler",
            jid,
            reason: validated.reason,
          });
          await sendAndTrack(sock, jid, {
            text: result.gifMessageText || "I tried to send a GIF, but it didn't work.",
          });
          return;
        }

        runtimeLog.info("GIF validated and ready to send", {
          source: "whatsappHandler",
          jid,
          bufferSize: validated.buffer.length,
          contentType: validated.contentType,
        });

        await sendAndTrack(sock, jid, {
            video: validated.buffer,
            mimetype: "video/mp4",
            gifPlayback: true, // THIS FLAG IS THE MAGIC TRICK
            caption: result.gifMessageText || undefined,
        });
        console.log(`${LOG_PREFIX} Sent GIF`, {
          contentType: validated.contentType,
          declaredMimeType: "video/mp4",
          sizeBytes: validated.buffer.length,
          giphyRendition: giphyResult.rendition,
          giphyMp4Size: giphyResult.mp4Size ?? null,
        });

        runtimeLog.info("GIF sent successfully", {
          source: "whatsappHandler",
          jid,
          bufferSize: validated.buffer.length,
        });
    } catch (err) {
        runtimeLog.error("Failed to send GIF", {
          source: "whatsappHandler",
          jid,
          gifQueryPreview: result.gifQuery.substring(0, 60),
          error: err instanceof Error ? err.message : String(err),
        });
        console.error(`${LOG_PREFIX} Failed to send GIF:`, err);
    }
  }

  // --- Sending a Sticker ---
  // Note: result.stickerBuffer MUST be a valid .webp file buffer!
  if (result.stickerBuffer) {
      try {
          runtimeLog.info("Sending pre-made sticker", {
            source: "whatsappHandler",
            jid,
            stickerSize: result.stickerBuffer.length,
          });

          await sendAndTrack(sock, jid, {
              sticker: result.stickerBuffer
          });
          console.log(`${LOG_PREFIX} Sent Sticker`);

          runtimeLog.info("Pre-made sticker sent successfully", {
            source: "whatsappHandler",
            jid,
            stickerSize: result.stickerBuffer.length,
          });
      } catch (err) {
          runtimeLog.error("Failed to send pre-made sticker", {
            source: "whatsappHandler",
            jid,
            stickerSize: result.stickerBuffer.length,
            error: err instanceof Error ? err.message : String(err),
          });
          console.error(`${LOG_PREFIX} Failed to send Sticker:`, err);
      }
  }

  const textResponse = result.chatMessages?.[0]?.text;
  if (textResponse) {
    runtimeLog.info("Sending text response", {
      source: "whatsappHandler",
      jid,
      textLength: textResponse.length,
      textPreview: textResponse.substring(0, 60),
    });
    await sendAndTrack(sock, jid, { text: textResponse });
    runtimeLog.info("Text response sent successfully", {
      source: "whatsappHandler",
      jid,
    });
  }

  if (result.pendingTweetDraft) {
    await sendAndTrack(sock, jid, {
      text: formatTweetApprovalPrompt(result.pendingTweetDraft),
    });
  }

  if (result.selfieImage?.base64) {
    try {
      runtimeLog.info("Processing selfie image", {
        source: "whatsappHandler",
        jid,
        base64Length: result.selfieImage.base64.length,
        mimeType: result.selfieImage.mimeType,
        messageText: result.selfieMessageText?.substring(0, 50),
      });

      const selfiesDir = path.join(process.cwd(), "selfies");
      if (!fs.existsSync(selfiesDir)) {
        fs.mkdirSync(selfiesDir, { recursive: true });
        runtimeLog.info("Created selfies directory", {
          source: "whatsappHandler",
          selfiesDir,
        });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeScene = result.selfieMessageText
        ? result.selfieMessageText
            .substring(0, 30)
            .replace(/[^a-z0-9]/gi, "_")
            .toLowerCase()
        : "selfie";
      const filename = `selfie_${timestamp}_${safeScene}.jpg`;
      const filePath = path.join(selfiesDir, filename);
      const fileBuffer = Buffer.from(result.selfieImage.base64, "base64");
      fs.writeFileSync(filePath, fileBuffer);

      runtimeLog.info("Selfie image saved to disk", {
        source: "whatsappHandler",
        filePath,
        fileSize: fileBuffer.length,
      });
      console.log(`${LOG_PREFIX} [SELFIE] Saved ${filePath}`);

      const imageBuffer = Buffer.from(result.selfieImage.base64, "base64");
      await sendAndTrack(sock, jid, {
        image: imageBuffer,
        mimetype: result.selfieImage.mimeType || "image/png",
        caption: result.selfieMessageText || undefined,
      });

      runtimeLog.info("Selfie image sent successfully", {
        source: "whatsappHandler",
        jid,
        fileSize: imageBuffer.length,
      });
    } catch (err) {
      runtimeLog.error("Failed to process or send selfie", {
        source: "whatsappHandler",
        jid,
        error: err instanceof Error ? err.message : String(err),
        errorType: err instanceof Error ? err.constructor.name : "unknown",
      });
      console.error(`${LOG_PREFIX} Failed to send selfie:`, err);
    }
  }

  if (result.videoUrl) {
    try {
      runtimeLog.info("Processing video for sending", {
        source: "whatsappHandler",
        jid,
        videoUrlPreview: result.videoUrl.substring(0, 100),
      });

      if (!isFetchableUrl(result.videoUrl)) {
        runtimeLog.warning("Video URL is not fetchable", {
          source: "whatsappHandler",
          jid,
          videoUrlPreview: result.videoUrl.substring(0, 100),
        });
        await sendAndTrack(sock, jid, {
          text: result.videoMessageText || "I have a video to show you, but I can't send it over WhatsApp right now.",
        });
      } else {
        const validated = await fetchAndValidateVideo(result.videoUrl, {
          label: "Video",
          requireMp4: false,
        });

        if (!validated.ok || !validated.buffer) {
          runtimeLog.warning("Video validation failed", {
            source: "whatsappHandler",
            jid,
            reason: validated.reason,
          });
          await sendAndTrack(sock, jid, {
            text: result.videoMessageText || "I have a video to show you, but the link didn't work.",
          });
          return;
        }

        runtimeLog.info("Video validated and ready to send", {
          source: "whatsappHandler",
          jid,
          bufferSize: validated.buffer.length,
          contentType: validated.contentType,
        });

        await sendAndTrack(sock, jid, {
          video: validated.buffer,
          caption: result.videoMessageText || undefined,
        });
        console.log(`${LOG_PREFIX} Sent video`, {
          contentType: validated.contentType,
          sizeBytes: validated.buffer.length,
        });

        runtimeLog.info("Video sent successfully", {
          source: "whatsappHandler",
          jid,
          bufferSize: validated.buffer.length,
        });
      }
    } catch (err) {
      runtimeLog.error("Failed to send video", {
        source: "whatsappHandler",
        jid,
        videoUrlPreview: result.videoUrl.substring(0, 100),
        error: err instanceof Error ? err.message : String(err),
      });

      if (isFetchableUrl(result.videoUrl)) {
        runtimeLog.info("Sending video URL as text fallback", {
          source: "whatsappHandler",
          jid,
          videoUrlPreview: result.videoUrl.substring(0, 100),
        });
        await sendAndTrack(sock, jid, {
          text: `${result.videoMessageText || "Here's the video:"} ${result.videoUrl}`,
        });
      }
    }
  }

  if (textResponse) {
    try {
      runtimeLog.info("Generating speech audio for text response", {
        source: "whatsappHandler",
        jid,
        textLength: textResponse.length,
      });

      const audioBuffer = await generateSpeechBuffer(textResponse);

      if (audioBuffer) {
        runtimeLog.info("Audio buffer generated, sending as voice note", {
          source: "whatsappHandler",
          jid,
          audioSize: audioBuffer.length,
          ptt: true,
        });

        await sendAndTrack(sock, jid, {
          audio: audioBuffer,
          mimetype: "audio/mpeg",
          ptt: true,
        });

        runtimeLog.info("Voice note sent successfully", {
          source: "whatsappHandler",
          jid,
          audioSize: audioBuffer.length,
        });
      } else {
        runtimeLog.warning("Failed to generate audio buffer", {
          source: "whatsappHandler",
          jid,
          textLength: textResponse.length,
        });
      }
    } catch (err) {
      runtimeLog.error("Failed to generate or send voice note", {
        source: "whatsappHandler",
        jid,
        textLength: textResponse.length,
        error: err instanceof Error ? err.message : String(err),
        errorType: err instanceof Error ? err.constructor.name : "unknown",
      });
      console.error(`${LOG_PREFIX} Failed to send voice note:`, err);
    }
  }
}

async function handleTweetApprovalCommand(
  sock: WASocket,
  replyJid: string,
  action: "post" | "reject",
  conversationScopeId: string,
  session: { model: string; interactionId: string } | null,
  chatHistory: any[],
  pendingEmail: NewEmailPayload | null,
): Promise<boolean> {
  const draft = await getPendingDraftForConversationScope(conversationScopeId);
  if (!draft) {
    await sendAndTrack(sock, replyJid, {
      text: "There is no pending tweet draft in this conversation right now.",
    });
    return true;
  }

  const resolution = await resolveTweetDraft(draft.id, action);
  if (!resolution.success) {
    await sendAndTrack(sock, replyJid, {
      text: resolution.error || "I could not resolve that tweet draft.",
    });
    return true;
  }

  await sendAndTrack(sock, replyJid, {
    text: action === "post"
      ? (resolution.tweetUrl ? `Posted it: ${resolution.tweetUrl}` : "Posted it.")
      : "Rejected that tweet draft.",
  });

  const systemMessage =
    action === "post"
      ? `[System] Tweet draft posted: ${draft.id}`
      : `[System] Tweet draft rejected: ${draft.id}`;

  const followUp = await processUserMessage({
    userMessage: systemMessage,
    aiService: serverGeminiService,
    session,
    chatHistory,
    isMuted: true,
    pendingEmail,
    conversationScopeId,
  });

  await sendOrchestratorResult(sock, replyJid, followUp);
  return true;
}
