// server/services/ai/chatSessionManager.ts
//
// Manages SDK Chat sessions per client (web, telegram, whatsapp).
// Each session holds in-memory conversation history; on expiry or restart,
// history is rehydrated from the conversation_history DB table.

import type { Chat, Content, GenerateContentConfig } from "@google/genai";
import { ai, GEMINI_MODEL } from "./geminiClient";
import { log } from "../../runtimeLogger";

const runtimeLog = log.fromContext({ source: "chatSessionManager" });

// ============================================================================
// Types
// ============================================================================

interface ManagedSession {
  chat: Chat;
  lastActivity: number;
  model: string;
}

export interface CreateSessionOptions {
  /** Unique session key, e.g. "web-main", "telegram-123456" */
  sessionId: string;
  /** Full system instruction text */
  systemPrompt: string;
  /** SDK tools (CallableTool[]) — passed directly to config */
  tools?: GenerateContentConfig["tools"];
  /** Pre-existing history to hydrate the session with */
  history?: Content[];
  /** Override model for this session */
  model?: string;
}

// ============================================================================
// Session Store
// ============================================================================

const sessions = new Map<string, ManagedSession>();

/** Session TTL: 2 hours of inactivity before eviction */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Cleanup interval: check every 10 minutes */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

// Background cleanup timer
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
      evicted++;
    }
  }
  if (evicted > 0) {
    runtimeLog.info("Evicted stale chat sessions", {
      evicted,
      remaining: sessions.size,
    });
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref(); // Don't prevent process exit

// ============================================================================
// Public API
// ============================================================================

/**
 * Get an existing session or create a new one.
 *
 * If a session exists for this sessionId, it is returned with its history intact.
 * If not, a new Chat is created with the provided systemPrompt, tools, and history.
 */
export function getOrCreateSession(opts: CreateSessionOptions): Chat {
  const existing = sessions.get(opts.sessionId);
  if (existing) {
    existing.lastActivity = Date.now();
    return existing.chat;
  }

  const model = opts.model || GEMINI_MODEL;

  const config: GenerateContentConfig = {
    systemInstruction: opts.systemPrompt,
    tools: opts.tools,
    automaticFunctionCalling: { maximumRemoteCalls: 10 },
    thinkingConfig: { thinkingBudget: 1024 },
    temperature: 1.0,
  };

  const chat = ai.chats.create({
    model,
    config,
    history: opts.history || [],
  });

  sessions.set(opts.sessionId, {
    chat,
    lastActivity: Date.now(),
    model,
  });

  runtimeLog.info("Created new chat session", {
    sessionId: opts.sessionId,
    model,
    historyLength: opts.history?.length || 0,
    toolCount: Array.isArray(opts.tools) ? opts.tools.length : 0,
  });

  return chat;
}

/**
 * Invalidate a session (e.g. when system prompt changes, or on explicit reset).
 * Next call to getOrCreateSession will create a fresh Chat.
 */
export function invalidateSession(sessionId: string): boolean {
  const deleted = sessions.delete(sessionId);
  if (deleted) {
    runtimeLog.info("Invalidated chat session", { sessionId });
  }
  return deleted;
}

/**
 * Get the current history from a session (for DB backup or debugging).
 */
export function getSessionHistory(sessionId: string): Content[] | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return session.chat.getHistory();
}

/** Number of active sessions (for monitoring). */
export function activeSessionCount(): number {
  return sessions.size;
}
