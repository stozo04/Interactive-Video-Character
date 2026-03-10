// server/routes/agentRoutes.ts
//
// API gateway for the Kayley agent — single entry point for all clients.
// POST /agent/message  — process a user message through the full orchestrator
// POST /agent/greeting — generate a daily greeting
//
// Uses ServerGeminiService (SDK Chat sessions + automatic function calling)
// instead of the browser GeminiService (Interactions API + manual tool loop).
// The Gemini API key stays server-side and never reaches the browser.

import type { IncomingMessage, ServerResponse } from "node:http";
import { log } from "../runtimeLogger";
import { serverGeminiService } from "../services/ai/serverGeminiService";
import { processUserMessage } from "../../src/services/messageOrchestrator";
import type { UserContent } from "../../src/services/aiService";
import type { ChatMessage, NewEmailPayload } from "../../src/types";
import {
  getXAuthStatus,
  handleXAuthCallback as completeXAuthCallback,
  initXAuth as startXAuth,
  refreshRecentTweetMetrics,
  resolveTweetDraft as resolveXTweetDraft,
  revokeXAuth as disconnectXAuth,
} from "../services/xTwitterServerService";
import { pollAndProcessMentions } from "../services/xMentionService";
import { getClaudeSessionSummary, lookUpClaudeQuota } from "../services/anthropic/claudeSessionService";
import { getOpenAICodexSessionSummary } from "../services/openai/codexSessionService";
import { TurnEventBus } from "../services/ai/turnEventBus";
import {
  drainTaskNotifications,
  listActiveTasks,
  cancelTask,
} from "../services/backgroundTaskManager";
import {
  MediaDeliveryStatus,
  recordVideoGenerationHistory,
  recordVoiceNoteHistory,
  updateSelfieGenerationHistory,
  updateVideoGenerationHistory,
  updateVoiceNoteHistory,
} from "../services/mediaHistoryService";

const runtimeLog = log.fromContext({ source: "agentRoutes" });

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ============================================================================
// Request Types
// ============================================================================

interface AgentMessageRequest {
  message: string;
  messageForAI?: string;
  userContent?: UserContent;
  sessionId: string;
  chatHistory?: ChatMessage[];
  isMuted?: boolean;
  pendingEmail?: NewEmailPayload | null;
}

interface AgentGreetingRequest {
  sessionId: string;
}

interface TweetDraftResolveRequest {
  action: "post" | "reject";
}

interface XAuthCallbackRequest {
  code: string;
  state: string;
}

interface MediaHistoryEventRequest {
  mediaType: "selfie" | "video" | "voice_note";
  status: "delivered" | "failed";
  historyId?: string | null;
  scene?: string;
  mood?: string | null;
  messageText?: string | null;
  videoUrl?: string | null;
  deliveryChannel?: string | null;
  error?: string | null;
}

// ============================================================================
// Session Store (lightweight — maps sessionId to AIChatSession)
// ============================================================================

import type { AIChatSession } from "../../src/services/aiService";

const sessions = new Map<string, AIChatSession>();

// Per-session turn lock — ensures Gemini SDK chat sessions process one turn at a time.
// New requests wait for the previous turn to finish before starting.
const sessionTurnChains = new Map<string, Promise<void>>();

function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionTurnChains.get(sessionId) ?? Promise.resolve();
  // Chain this turn after the previous one. Swallow errors so the chain doesn't break.
  const current = prev.then(fn, fn);
  // Store only the "done" signal (void), not the result
  sessionTurnChains.set(sessionId, current.then(() => {}, () => {}));
  return current;
}

// ============================================================================
// Body Parser
// ============================================================================

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const maxBytes = 512 * 1024; // 512KB — messages can include base64 audio
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > maxBytes) {
      throw new Error("Request body exceeds 512KB limit.");
    }
  }
  if (!body.trim()) {
    throw new Error("Empty request body.");
  }
  return JSON.parse(body) as T;
}

// ============================================================================
// Route Handler
// ============================================================================

/**
 * Route incoming requests to agent endpoints.
 * Returns true if the request was handled, false if it should fall through.
 */
export function createAgentRouter(): (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<boolean> {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // CORS preflight
    if (req.method === "OPTIONS" && url.pathname.startsWith("/agent/")) {
      res.writeHead(204, JSON_HEADERS);
      res.end();
      return true;
    }

    if (req.method === "GET" && url.pathname === "/agent/tasks/active") {
      const tasks = listActiveTasks();
      sendJson(res, 200, { tasks });
      return true;
    }

    const cancelTaskMatch = url.pathname.match(/^\/agent\/tasks\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelTaskMatch) {
      const taskId = cancelTaskMatch[1];
      const cancelled = cancelTask(taskId);
      sendJson(res, 200, { cancelled });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/message") {
      await handleAgentMessage(req, res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/message/stream") {
      await handleAgentMessageStream(req, res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/greeting") {
      await handleAgentGreeting(req, res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/media-history") {
      await handleMediaHistoryEvent(req, res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/x/auth/start") {
      await handleXAuthStart(res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/x/auth/callback") {
      await handleXAuthCallback(req, res);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/agent/x/status") {
      await handleXStatus(res);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/agent/anthropic/session") {
      await handleClaudeSessionStatus(res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/anthropic/quota") {
      await handleClaudeQuotaLookup(res);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/agent/openai/session") {
      await handleOpenAICodexSessionStatus(res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/x/auth/revoke") {
      await handleXAuthRevoke(res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/x/metrics/refresh") {
      await handleXMetricsRefresh(res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/x/mentions/poll") {
      await handleXMentionsPoll(res);
      return true;
    }

    const tweetResolveMatch = url.pathname.match(/^\/agent\/tweet-drafts\/([^/]+)\/resolve$/);
    if (req.method === "POST" && tweetResolveMatch) {
      await handleTweetDraftResolve(req, res, tweetResolveMatch[1]);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/agent/health") {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ status: "ok", sessions: sessions.size }));
      return true;
    }

    return false;
  };
}

// ============================================================================
// /agent/message — Full orchestrator pipeline
// ============================================================================

async function handleAgentMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startMs = Date.now();

  try {
    const body = await parseJsonBody<AgentMessageRequest>(req);

    if (!body.message && !body.userContent) {
      sendJson(res, 400, { success: false, error: "Missing 'message' or 'userContent'." });
      return;
    }
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: "Missing 'sessionId'." });
      return;
    }

    runtimeLog.info("Processing agent message", {
      sessionId: body.sessionId,
      messageLength: body.message?.length || 0,
      historyCount: body.chatHistory?.length || 0,
    });

    // Retrieve or initialize session for this client
    const session = sessions.get(body.sessionId) || null;

    // Run through the FULL orchestrator pipeline (same as web/telegram)
    const result = await processUserMessage({
      userMessage: body.message,
      userMessageForAI: body.messageForAI,
      userContent: body.userContent,
      aiService: serverGeminiService,
      session,
      chatHistory: body.chatHistory || [],
      isMuted: body.isMuted ?? false,
      pendingEmail: body.pendingEmail,
      conversationScopeId: body.sessionId,
    });

    // Persist updated session
    if (result.updatedSession) {
      sessions.set(body.sessionId, result.updatedSession);
    }

    const elapsedMs = Date.now() - startMs;
    runtimeLog.info("Agent message completed", {
      sessionId: body.sessionId,
      elapsedMs,
      actionType: result.actionType,
      success: result.success,
      hasAudio: !!result.audioToPlay,
      hasSelfie: !!result.selfieImage,
      hasVideo: !!result.videoUrl,
    });

    sendJson(res, 200, { success: true, result });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("Agent message failed", {
      error: errorMsg,
      stack: err instanceof Error ? err.stack : undefined,
    });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

// ============================================================================
// /agent/greeting — Daily greeting generation
// ============================================================================

async function handleAgentGreeting(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startMs = Date.now();

  try {
    const body = await parseJsonBody<AgentGreetingRequest>(req);

    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: "Missing 'sessionId'." });
      return;
    }

    runtimeLog.info("Processing agent greeting", {
      sessionId: body.sessionId,
    });

    const greetingResult = await serverGeminiService.generateGreeting();

    // Store the session for subsequent messages
    if (greetingResult.session) {
      sessions.set(body.sessionId, greetingResult.session);
    }

    const elapsedMs = Date.now() - startMs;
    runtimeLog.info("Agent greeting completed", {
      sessionId: body.sessionId,
      elapsedMs,
      hasAudio: !!greetingResult.audioData,
    });

    sendJson(res, 200, {
      success: true,
      result: {
        greeting: greetingResult.greeting,
        session: greetingResult.session,
        audioData: greetingResult.audioData,
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("Agent greeting failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

async function handleMediaHistoryEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseJsonBody<MediaHistoryEventRequest>(req);

    if (body.mediaType === "selfie") {
      if (!body.historyId) {
        sendJson(res, 400, { success: false, error: "Missing 'historyId' for selfie history event." });
        return;
      }

      await updateSelfieGenerationHistory(body.historyId, {
        deliveryStatus:
          body.status === "delivered" ? MediaDeliveryStatus.DELIVERED : MediaDeliveryStatus.FAILED,
        deliveryChannel: body.deliveryChannel ?? "web",
        deliveryError: body.error ?? null,
        messageText: body.messageText ?? null,
      });

      sendJson(res, 200, { success: true });
      return;
    }

    if (body.mediaType === "video") {
      if (!body.videoUrl || !body.scene) {
        sendJson(res, 400, { success: false, error: "Missing 'videoUrl' or 'scene' for video history event." });
        return;
      }

      const historyId = await recordVideoGenerationHistory({
        scene: body.scene,
        mood: body.mood ?? undefined,
        messageText: body.messageText ?? undefined,
        videoUrl: body.videoUrl,
      });

      if (historyId) {
        await updateVideoGenerationHistory(historyId, {
          deliveryStatus:
            body.status === "delivered" ? MediaDeliveryStatus.DELIVERED : MediaDeliveryStatus.FAILED,
          deliveryChannel: body.deliveryChannel ?? "web",
          deliveryError: body.error ?? null,
          messageText: body.messageText ?? null,
        });
      }

      sendJson(res, 200, { success: true });
      return;
    }

    if (body.mediaType === "voice_note") {
      if (!body.messageText) {
        sendJson(res, 400, { success: false, error: "Missing 'messageText' for voice note history event." });
        return;
      }

      const historyId = await recordVoiceNoteHistory({
        messageText: body.messageText,
        provider: "web",
        audioMimeType: undefined,
      });
      if (historyId) {
        await updateVoiceNoteHistory(historyId, {
          deliveryStatus:
            body.status === "delivered" ? MediaDeliveryStatus.DELIVERED : MediaDeliveryStatus.FAILED,
          deliveryChannel: body.deliveryChannel ?? "web",
          deliveryError: body.error ?? null,
          messageText: body.messageText ?? null,
        });
      }

      sendJson(res, 200, { success: true });
      return;
    }

    sendJson(res, 400, { success: false, error: `Unsupported mediaType '${body.mediaType}'.` });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("Media history event failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

// ============================================================================
// /agent/x/* - Server-owned X integration endpoints
// ============================================================================

async function handleXAuthStart(res: ServerResponse): Promise<void> {
  try {
    const authUrl = await startXAuth();
    sendJson(res, 200, { success: true, authUrl });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("X auth start failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

async function handleXAuthCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseJsonBody<XAuthCallbackRequest>(req);
    if (!body.code || !body.state) {
      sendJson(res, 400, { success: false, error: "Missing 'code' or 'state'." });
      return;
    }

    await completeXAuthCallback(body.code, body.state);
    sendJson(res, 200, { success: true });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("X auth callback failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

async function handleXStatus(res: ServerResponse): Promise<void> {
  try {
    const status = await getXAuthStatus();
    sendJson(res, 200, { success: true, ...status });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("X status failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg, connected: false, scopes: [], hasMediaWrite: false });
  }
}

async function handleClaudeSessionStatus(res: ServerResponse): Promise<void> {
  try {
    const summary = await getClaudeSessionSummary();
    sendJson(res, 200, { success: true, summary });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("Claude session status failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

async function handleClaudeQuotaLookup(res: ServerResponse): Promise<void> {
  try {
    const quota = await lookUpClaudeQuota();
    sendJson(res, 200, { success: true, quota });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("Claude quota lookup failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

async function handleOpenAICodexSessionStatus(res: ServerResponse): Promise<void> {
  try {
    const summary = await getOpenAICodexSessionSummary();
    sendJson(res, 200, { success: true, summary });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("OpenAI Codex session status failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

async function handleXAuthRevoke(res: ServerResponse): Promise<void> {
  try {
    await disconnectXAuth();
    sendJson(res, 200, { success: true });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("X auth revoke failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

async function handleXMetricsRefresh(res: ServerResponse): Promise<void> {
  try {
    const updatedCount = await refreshRecentTweetMetrics();
    sendJson(res, 200, { success: true, updatedCount });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("X metrics refresh failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

async function handleXMentionsPoll(res: ServerResponse): Promise<void> {
  try {
    const mentionCount = await pollAndProcessMentions();
    sendJson(res, 200, { success: true, mentionCount });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("X mentions poll failed", { error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

// ============================================================================
// /agent/tweet-drafts/:id/resolve — UI approval gate
// ============================================================================

async function handleTweetDraftResolve(
  req: IncomingMessage,
  res: ServerResponse,
  draftId: string,
): Promise<void> {
  const startMs = Date.now();

  try {
    const body = await parseJsonBody<TweetDraftResolveRequest>(req);
    if (!body?.action || (body.action !== "post" && body.action !== "reject")) {
      sendJson(res, 400, { success: false, error: "Invalid action." });
      return;
    }

    runtimeLog.info("Resolving tweet draft", {
      draftId,
      action: body.action,
    });

    const result = await resolveXTweetDraft(draftId, body.action);
    if (!result.success) {
      const statusCode =
        result.error === "Draft not found."
          ? 404
          : result.error === "Draft is not pending approval."
            ? 409
            : 500;
      sendJson(res, statusCode, { success: false, error: result.error || "Failed to resolve draft." });
      return;
    }

    runtimeLog.info("Tweet draft resolved", {
      draftId,
      action: body.action,
      tweetId: result.tweetId ?? null,
      elapsedMs: Date.now() - startMs,
    });
    sendJson(res, 200, { success: true, tweetUrl: result.tweetUrl });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("Tweet draft resolve failed", { draftId, error: errorMsg });
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}

// ============================================================================
// /agent/message/stream — SSE streaming endpoint (web client only)
// ============================================================================

async function handleAgentMessageStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startMs = Date.now();

  try {
    const body = await parseJsonBody<AgentMessageRequest>(req);

    if (!body.message && !body.userContent) {
      sendJson(res, 400, { success: false, error: "Missing 'message' or 'userContent'." });
      return;
    }
    if (!body.sessionId) {
      sendJson(res, 400, { success: false, error: "Missing 'sessionId'." });
      return;
    }

    // Set SSE headers — from here on we write SSE events, not JSON
    res.writeHead(200, SSE_HEADERS);

    // Create per-turn event bus
    const eventBus = new TurnEventBus();

    // Wire bus events to SSE response
    eventBus.on('sse', (event: unknown) => {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });

    // Emit turn_start
    res.write(`data: ${JSON.stringify({ type: 'turn_start', timestamp: Date.now() })}\n\n`);

    // Drain any pending background task completion notifications.
    // Prepend them to the user message so Kayley sees them without polling.
    const taskNotifications = drainTaskNotifications();
    let messageWithNotifications = body.message;
    if (taskNotifications.length > 0 && messageWithNotifications) {
      const notifLines = taskNotifications.map((n) => {
        const dur = n.durationMs < 1000 ? `${n.durationMs}ms` : `${(n.durationMs / 1000).toFixed(1)}s`;
        const tail = n.tailOutput.length > 0 ? `\nLast output:\n${n.tailOutput.join('\n')}` : '';
        return `[Background task finished] "${n.label}" — ${n.status} (exit ${n.exitCode}, ${dur})${tail}`;
      });
      messageWithNotifications = `[SYSTEM NOTE: ${notifLines.join('\n\n')}]\n\n${messageWithNotifications}`;
    }

    runtimeLog.info("Processing agent message (stream)", {
      sessionId: body.sessionId,
      messageLength: body.message?.length || 0,
      historyCount: body.chatHistory?.length || 0,
      taskNotificationCount: taskNotifications.length,
    });

    // Serialize turns per session — Gemini SDK chat sessions can't handle concurrent sends.
    // If a previous turn is still processing, this request waits in the queue.
    // The SSE connection stays open (turn_start already sent) so the client knows we're waiting.
    const result = await withSessionLock(body.sessionId, async () => {
      const session = sessions.get(body.sessionId) || null;

      const orchestratorResult = await processUserMessage({
        userMessage: messageWithNotifications,
        userMessageForAI: body.messageForAI,
        userContent: body.userContent,
        aiService: serverGeminiService,
        session,
        chatHistory: body.chatHistory || [],
        isMuted: body.isMuted ?? false,
        pendingEmail: body.pendingEmail,
        conversationScopeId: body.sessionId,
        eventBus,
      });

      if (orchestratorResult.updatedSession) {
        sessions.set(body.sessionId, orchestratorResult.updatedSession);
      }

      return orchestratorResult;
    });

    const elapsedMs = Date.now() - startMs;
    runtimeLog.info("Agent message stream completed", {
      sessionId: body.sessionId,
      elapsedMs,
      actionType: result.actionType,
      success: result.success,
    });

    // Emit turn_complete with full result
    res.write(`data: ${JSON.stringify({ type: 'turn_complete', result, timestamp: Date.now() })}\n\n`);
    res.end();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("Agent message stream failed", {
      error: errorMsg,
      stack: err instanceof Error ? err.stack : undefined,
    });

    // If headers already sent (SSE mode), emit error event
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'turn_error', error: errorMsg, timestamp: Date.now() })}\n\n`);
      res.end();
    } else {
      sendJson(res, 500, { success: false, error: errorMsg });
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(data));
}
