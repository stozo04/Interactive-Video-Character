// src/services/conversationAnchorService.ts
/**
 * Conversation Anchor Service
 *
 * Maintains turn-local "working memory" for active conversation threads.
 * Prevents long-thread continuity failures by tracking unresolved asks,
 * pending commitments, and emotional context.
 *
 * Updated every 3 turns OR on topic shift OR 90s time guard.
 * Injected into system prompt ahead of synthesis (highest priority).
 */

import { supabase } from "./supabaseClient";
import { GoogleGenAI } from "@google/genai";

const LOG_PREFIX = "[ConversationAnchor]";
const TABLE = "conversation_anchor";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;
const SCHEMA_VERSION = 1;
const TOPIC_SHIFT_THRESHOLD = 0.3;
const USE_CONVERSATION_ANCHOR = true;
const CONVERSATION_ANCHOR_FRESHNESS_MINUTES = 120;

// Freshness window: default 2 hours (anchor is read before post-turn refresh,
// so short window drops continuity after normal pauses). Fast regeneration
// triggers (topic shift, turn delta, 90s guard) maintain freshness.
const FRESHNESS_WINDOW_MINUTES = Math.max(1, CONVERSATION_ANCHOR_FRESHNESS_MINUTES);
const FRESHNESS_WINDOW_MS = FRESHNESS_WINDOW_MINUTES * 60 * 1000;

console.log(`${LOG_PREFIX} Config`, {
  enabled: USE_CONVERSATION_ANCHOR,
  freshnessMinutes: FRESHNESS_WINDOW_MINUTES,
  topicShiftThreshold: TOPIC_SHIFT_THRESHOLD,
});

// Singleton AI client
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error("VITE_GEMINI_API_KEY is not set");
    }
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return aiClient;
}

// Size caps (enforced before write and render)
const SIZE_CAPS = {
  anchor_summary: 450,              // chars
  unresolved_asks_count: 4,         // max items
  unresolved_asks_item: 120,        // chars per item
  pending_commitments_count: 4,     // max items
  pending_commitments_item: 120,    // chars per item
  emotional_context: 180,           // chars
  total_section: 1200,              // chars (total prompt injection)
};

// ============================================================================
// Types
// ============================================================================

export interface ConversationAnchorRow {
  id: string;
  interaction_id: string;
  schema_version: number;
  anchor_summary: string;
  unresolved_asks: string[];
  active_emotional_context: string;
  pending_commitments: string[];
  last_user_message: string;
  last_turn_index: number;
  last_topic_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefreshAnchorInput {
  interactionId: string;
  turnIndex: number;              // Count of user messages (not total messages)
  userMessage: string;
  recentTurns: Array<{ role: "user" | "model"; text: string }>;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Fetch conversation anchor by interaction ID.
 * Hot path - must be fast (single DB read, no LLM calls).
 */
export async function getConversationAnchor(
  interactionId: string
): Promise<ConversationAnchorRow | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("interaction_id", interactionId)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST116") {
        // No rows found - expected for first turn
        return null;
      }
      console.error(`${LOG_PREFIX} Failed to fetch anchor`, { error });
      return null;
    }

    return data as ConversationAnchorRow;
  } catch (err) {
    console.error(`${LOG_PREFIX} getConversationAnchor failed`, { err });
    return null;
  }
}

/**
 * Build conversation anchor prompt section for injection.
 * Returns empty string if feature disabled, missing ID, or any error.
 * Hot path - no LLM calls, minimal processing.
 */
export async function buildConversationAnchorPromptSection(
  interactionId: string | null | undefined
): Promise<string> {
  // Feature flag check
  if (!USE_CONVERSATION_ANCHOR) {
    return "";
  }

  // Missing interactionId → skip (don't create synthetic ID)
  if (!interactionId) {
    console.debug(`${LOG_PREFIX} Skipped (missing interactionId)`);
    return "";
  }

  try {
    // Single DB read
    const anchor = await getConversationAnchor(interactionId);
    if (!anchor) return "";

    // Schema version check
    if (anchor.schema_version !== SCHEMA_VERSION) {
      console.warn(`${LOG_PREFIX} Schema version mismatch`, {
        expected: SCHEMA_VERSION,
        got: anchor.schema_version,
      });
      return "";
    }

    // Freshness check (avoid stale anchor after long pause)
    const age = Date.now() - new Date(anchor.updated_at).getTime();
    if (age > FRESHNESS_WINDOW_MS) {
      console.debug(`${LOG_PREFIX} Anchor is stale (${Math.round(age / 60000)}min old), skipping`);
      return "";
    }

    // Enforce size caps before rendering
    const capped = enforceSizeCaps({
      anchor_summary: anchor.anchor_summary,
      unresolved_asks: anchor.unresolved_asks,
      active_emotional_context: anchor.active_emotional_context,
      pending_commitments: anchor.pending_commitments,
    });

    // Build section
    const unresolvedSection =
      capped.unresolved_asks.length > 0
        ? `\nUNRESOLVED ASKS:\n${capped.unresolved_asks.map((a) => `- ${a}`).join("\n")}`
        : "";

    const commitmentsSection =
      capped.pending_commitments.length > 0
        ? `\nPENDING COMMITMENTS:\n${capped.pending_commitments.map((c) => `- ${c}`).join("\n")}`
        : "";

    const section = `
====================================================
CONVERSATION ANCHOR (turn ${anchor.last_turn_index})
====================================================

SUMMARY: ${capped.anchor_summary}

EMOTIONAL CONTEXT:
${capped.active_emotional_context}
${unresolvedSection}
${commitmentsSection}

IMPORTANT: If this anchor conflicts with the current user message,
trust the current user message. The anchor may be slightly stale.
====================================================
`.trim();

    // Total section size cap
    return section.length > SIZE_CAPS.total_section
      ? truncate(section, SIZE_CAPS.total_section)
      : section;
  } catch (err) {
    console.error(`${LOG_PREFIX} buildConversationAnchorPromptSection failed`, { err });
    return ""; // Graceful degradation
  }
}

/**
 * Refresh conversation anchor via LLM generation.
 * Fire-and-forget from orchestrator (no blocking).
 */
export async function refreshConversationAnchor(
  input: RefreshAnchorInput
): Promise<void> {
  // Feature flag check (opt-in rollout)
  if (!USE_CONVERSATION_ANCHOR) {
    return;
  }

  const { interactionId, turnIndex, userMessage, recentTurns } = input;

  try {
    // 1. Fetch existing anchor
    const existing = await getConversationAnchor(interactionId);

    // 2. Compute topic shift
    const topicShift = existing
      ? computeTopicShift(existing.last_user_message, userMessage)
      : false;

    // 3. Check if refresh needed
    if (
      !shouldRefreshAnchor({
        existing,
        turnIndex,
        topicShift,
      })
    ) {
      return;
    }

    const reason = !existing
      ? "new"
      : topicShift
      ? "topic_shift"
      : "turn_delta_or_time_guard";

    console.log(`${LOG_PREFIX} Refreshing anchor`, {
      interactionId,
      turnIndex,
      reason,
    });

    // 4. Call Gemini LLM
    const anchor = await generateAnchorViaLLM(recentTurns);
    if (!anchor) {
      console.warn(`${LOG_PREFIX} LLM generation failed, skipping update`);
      return;
    }

    // 5. Enforce size caps
    const capped = enforceSizeCaps(anchor);

    // 6. Compute topic hash (optional)
    const topicHash = computeTopicHash(userMessage);

    // 7. Upsert to DB
    const { error } = await supabase.from(TABLE).upsert(
      {
        interaction_id: interactionId,
        schema_version: SCHEMA_VERSION,
        anchor_summary: capped.anchor_summary,
        unresolved_asks: capped.unresolved_asks,
        active_emotional_context: capped.active_emotional_context,
        pending_commitments: capped.pending_commitments,
        last_user_message: userMessage,
        last_turn_index: turnIndex,
        last_topic_hash: topicHash,
      },
      { onConflict: "interaction_id" }
    );

    if (error) {
      console.error(`${LOG_PREFIX} Failed to store anchor`, { error });
      return;
    }

    console.log(`${LOG_PREFIX} Anchor stored`, { interactionId, turnIndex });
  } catch (err) {
    console.error(`${LOG_PREFIX} refreshConversationAnchor failed`, { err });
  }
}

/**
 * Determine if anchor should be refreshed.
 * Deterministic rules: no anchor | topic shift | turn delta >= 3 | time guard (90s + 1 turn)
 */
export function shouldRefreshAnchor(params: {
  existing: ConversationAnchorRow | null;
  turnIndex: number;
  topicShift: boolean;
}): boolean {
  const { existing, turnIndex, topicShift } = params;

  // 1. No existing anchor → refresh
  if (!existing) return true;

  // 2. Out-of-order write → skip (monotonic write guard)
  if (turnIndex <= existing.last_turn_index) {
    console.log(`${LOG_PREFIX} Stale write skipped`, {
      turnIndex,
      lastTurnIndex: existing.last_turn_index,
    });
    return false;
  }

  // 3. Topic shift detected → refresh
  if (topicShift) return true;

  // 4. Turn delta >= 3 → refresh
  const turnDelta = turnIndex - existing.last_turn_index;
  if (turnDelta >= 3) return true;

  // 5. Time guard: >= 90s since updated_at AND >= 1 new turn → refresh
  const timeSinceUpdate = Date.now() - new Date(existing.updated_at).getTime();
  if (timeSinceUpdate >= 90_000 && turnDelta >= 1) return true;

  return false;
}

/**
 * Detect topic shift between previous and current user messages.
 * Uses token overlap ratio + marker word boost.
 */
export function computeTopicShift(
  previousUserMessage: string,
  currentUserMessage: string
): boolean {
  // 1. Normalize to tokens
  const prevTokens = normalizeToTokens(previousUserMessage);
  const currTokens = normalizeToTokens(currentUserMessage);

  // 2. Min length check (ignore very short messages)
  if (prevTokens.length < 3 || currTokens.length < 3) return false;

  // 3. Compute overlap ratio
  const prevSet = new Set(prevTokens);
  const currSet = new Set(currTokens);
  const intersection = [...prevSet].filter((t) => currSet.has(t));
  const overlapRatio = intersection.length / Math.max(prevSet.size, currSet.size);

  // 4. Marker word boost (instant topic shift signals)
  const markerWords = [
    "anyway",
    "switching gears",
    "different topic",
    "changing subject",
    "moving on",
    "by the way",
    "off topic",
  ];
  const hasMarker = markerWords.some((m) =>
    currentUserMessage.toLowerCase().includes(m)
  );

  // 5. Shift if overlap below threshold OR has marker word
  return overlapRatio < TOPIC_SHIFT_THRESHOLD || hasMarker;
}

// ============================================================================
// LLM Generation
// ============================================================================

/**
 * Generate anchor via Gemini LLM.
 * Returns null on failure (timeout, malformed JSON, etc.)
 */
async function generateAnchorViaLLM(
  recentTurns: Array<{ role: string; text: string }>
): Promise<{
  anchor_summary: string;
  unresolved_asks: string[];
  active_emotional_context: string;
  pending_commitments: string[];
} | null> {
  if (!GEMINI_API_KEY) {
    console.warn(`${LOG_PREFIX} No Gemini API key, skipping generation`);
    return null;
  }

  try {
    const systemPrompt = buildAnchorSystemPrompt();
    const prompt = buildAnchorPrompt(recentTurns);

    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object" as any,
          properties: {
            anchor_summary: { type: "string" as any },
            unresolved_asks: { type: "array" as any, items: { type: "string" as any } },
            active_emotional_context: { type: "string" as any },
            pending_commitments: { type: "array" as any, items: { type: "string" as any } },
          },
          required: ["anchor_summary", "unresolved_asks", "active_emotional_context", "pending_commitments"],
        },
      },
    });

    const text = response.text?.trim() || "";
    // Extract first balanced JSON object (greedy regex matches to last '}', causing parse failures)
    const firstBrace = text.indexOf("{");
    if (firstBrace === -1) {
      console.warn(`${LOG_PREFIX} No JSON in LLM response`);
      return null;
    }
    let depth = 0, end = -1;
    for (let i = firstBrace; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) {
      console.warn(`${LOG_PREFIX} Unbalanced JSON in LLM response`);
      return null;
    }
    const parsed = JSON.parse(text.slice(firstBrace, end + 1));

    // Validate structure
    return {
      anchor_summary: parsed.anchor_summary || "",
      unresolved_asks: Array.isArray(parsed.unresolved_asks) ? parsed.unresolved_asks : [],
      active_emotional_context: parsed.active_emotional_context || "",
      pending_commitments: Array.isArray(parsed.pending_commitments)
        ? parsed.pending_commitments
        : [],
    };
  } catch (err) {
    console.error(`${LOG_PREFIX} generateAnchorViaLLM failed`, { err });
    return null;
  }
}

function buildAnchorSystemPrompt(): string {
  return `
ROLE:
You are a conversation memory synthesizer for Kayley (AI companion) and Steven (user).
Your job is to extract the current working memory anchor for this conversation thread.

RULES:
1. Be concise. This is working memory, not long-term storage.
2. Extract ONLY unresolved asks (questions Steven asked that Kayley hasn't fully answered yet).
3. Extract ONLY pending commitments (promises Kayley made that haven't been fulfilled yet).
4. Capture the emotional tone of the conversation (venting, playful, serious, stressed, excited).
5. Summarize the conversation in 1-2 sentences (what's being discussed, what Steven cares about).
6. If nothing is unresolved or pending, use empty arrays.

OUTPUT:
Return raw JSON only. No markdown. No explanation. Schema:
{
  "anchor_summary": "1-2 sentence summary of conversation state",
  "unresolved_asks": ["list", "of", "open", "questions"],
  "active_emotional_context": "Tone/mood description",
  "pending_commitments": ["list", "of", "promises", "Kayley made"]
}

SIZE LIMITS:
- anchor_summary: max 450 characters
- unresolved_asks: max 4 items, each max 120 characters
- pending_commitments: max 4 items, each max 120 characters
- active_emotional_context: max 180 characters
`.trim();
}

function buildAnchorPrompt(recentTurns: Array<{ role: string; text: string }>): string {
  const formatted = recentTurns
    .map((t) => `${t.role === "user" ? "Steven" : "Kayley"}: ${t.text}`)
    .join("\n\n");

  return `
RECENT CONVERSATION (last 6-8 turns):
${formatted}

Task: Extract the working memory anchor for this conversation.
Return JSON only.
`.trim();
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize text to tokens (lowercase, remove stopwords, split)
 */
function normalizeToTokens(text: string): string[] {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "should",
    "could",
    "may",
    "might",
    "must",
    "can",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Remove punctuation
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopwords.has(token));
}

function shouldKeepPendingCommitment(text: string): boolean {
  const lower = text.toLowerCase();
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);

  if (!timeMatch) {
    return true;
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || "0");
  const meridian = timeMatch[3];

  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;

  const now = new Date();
  const target = new Date(now);
  target.setSeconds(0, 0);
  target.setHours(hour, minute, 0, 0);

  if (lower.includes("tomorrow")) {
    return true;
  }

  if (lower.includes("today")) {
    return target.getTime() >= now.getTime();
  }

  return target.getTime() >= now.getTime();
}

/**
 * Enforce size caps on anchor fields
 */
function enforceSizeCaps(anchor: {
  anchor_summary: string;
  unresolved_asks: string[];
  active_emotional_context: string;
  pending_commitments: string[];
}) {
  return {
    anchor_summary: truncate(anchor.anchor_summary, SIZE_CAPS.anchor_summary),
    unresolved_asks: anchor.unresolved_asks
      .slice(0, SIZE_CAPS.unresolved_asks_count)
      .map((a) => truncate(a, SIZE_CAPS.unresolved_asks_item)),
    active_emotional_context: truncate(
      anchor.active_emotional_context,
      SIZE_CAPS.emotional_context
    ),
    pending_commitments: anchor.pending_commitments
      .filter(shouldKeepPendingCommitment)
      .slice(0, SIZE_CAPS.pending_commitments_count)
      .map((c) => truncate(c, SIZE_CAPS.pending_commitments_item)),
  };
}

/**
 * Truncate text to max length with ellipsis
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Compute simple hash of user message for topic tracking
 * (Optional: used for last_topic_hash field)
 */
function computeTopicHash(userMessage: string): string {
  const tokens = normalizeToTokens(userMessage);
  return tokens.slice(0, 5).sort().join("_"); // Simple fingerprint
}
