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

const runtimeLog = log.fromContext({ source: "agentRoutes" });

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
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

// ============================================================================
// Session Store (lightweight — maps sessionId to AIChatSession)
// ============================================================================

import type { AIChatSession } from "../../src/services/aiService";

const sessions = new Map<string, AIChatSession>();

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

    if (req.method === "POST" && url.pathname === "/agent/message") {
      await handleAgentMessage(req, res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/agent/greeting") {
      await handleAgentGreeting(req, res);
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
// Helpers
// ============================================================================

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(data));
}
