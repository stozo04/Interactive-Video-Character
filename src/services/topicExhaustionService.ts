// src/services/topicExhaustionService.ts
/**
 * Topic Exhaustion Service
 *
 * Tracks how often topics are mentioned in conversation and manages cooldowns
 * to prevent repetitive surfacing by the AI. User-initiated topics are NEVER
 * suppressed — only AI-initiated repeats during cooldown are suppressed.
 *
 * Cooldown triggers at 3+ AI-initiated mentions within a 7-day window.
 * Default cooldown duration: 3 days.
 */

import { supabase } from "./supabaseClient";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error("VITE_GEMINI_API_KEY is not set");
    }
    geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return geminiClient;
}

const LOG_PREFIX = "[TopicExhaustion]";
const TABLE = "topic_exhaustion";

/** Mentions threshold before cooldown kicks in */
const COOLDOWN_THRESHOLD = 3;
/** Cooldown duration in days */
const COOLDOWN_DAYS = 3;
/** Mentions older than this many days are decayed */
const DECAY_WINDOW_DAYS = 7;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Record a single topic mention. Upserts the row, increments count,
 * and triggers cooldown if threshold is reached for AI-initiated mentions.
 */
export async function recordTopicMention(
  topicKey: string,
  initiatedBy: "ai" | "user"
): Promise<void> {
  const normalized = topicKey.trim().toLowerCase().replace(/\s+/g, "_");
  if (!normalized) return;

  try {
    const { data: existing } = await supabase
      .from(TABLE)
      .select("*")
      .eq("topic_key", normalized)
      .maybeSingle();

    const now = new Date().toISOString();

    if (!existing) {
      // First mention — insert
      const cooldownUntil =
        initiatedBy === "ai" && COOLDOWN_THRESHOLD <= 1
          ? new Date(Date.now() + COOLDOWN_DAYS * 86400000).toISOString()
          : null;

      const { error } = await supabase.from(TABLE).insert({
        topic_key: normalized,
        mention_count_7d: 1,
        last_mentioned_at: now,
        last_initiated_by: initiatedBy,
        cooldown_until: cooldownUntil,
      });

      if (error) {
        console.error(`${LOG_PREFIX} Failed to insert topic mention`, { topicKey: normalized, error });
      }
      return;
    }

    // Existing row — increment and maybe trigger cooldown
    const newCount = (existing.mention_count_7d ?? 0) + 1;
    let cooldownUntil = existing.cooldown_until;

    // Trigger cooldown only for AI-initiated mentions at threshold
    if (initiatedBy === "ai" && newCount >= COOLDOWN_THRESHOLD && !cooldownUntil) {
      cooldownUntil = new Date(Date.now() + COOLDOWN_DAYS * 86400000).toISOString();
      console.log(`${LOG_PREFIX} Cooldown triggered`, { topicKey: normalized, count: newCount });
    }

    // If user re-initiates a topic that's in cooldown, lift the cooldown
    if (initiatedBy === "user" && cooldownUntil) {
      cooldownUntil = null;
      console.log(`${LOG_PREFIX} User re-initiated topic, lifting cooldown`, { topicKey: normalized });
    }

    const { error } = await supabase
      .from(TABLE)
      .update({
        mention_count_7d: newCount,
        last_mentioned_at: now,
        last_initiated_by: initiatedBy,
        cooldown_until: cooldownUntil,
      })
      .eq("id", existing.id);

    if (error) {
      console.error(`${LOG_PREFIX} Failed to update topic mention`, { topicKey: normalized, error });
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} recordTopicMention failed`, { topicKey, err });
  }
}

/**
 * Batch version of recordTopicMention.
 */
export async function recordTopicMentions(
  topicKeys: string[],
  initiatedBy: "ai" | "user"
): Promise<void> {
  const unique = [...new Set(topicKeys.map((k) => k.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean))];
  for (const key of unique) {
    await recordTopicMention(key, initiatedBy);
  }
}

/**
 * Get all topics currently in cooldown (AI-initiated suppression only).
 */
export async function getSuppressedTopics(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("topic_key")
      .gt("cooldown_until", new Date().toISOString());

    if (error) {
      console.error(`${LOG_PREFIX} Failed to get suppressed topics`, { error });
      return [];
    }

    return (data || []).map((row) => row.topic_key);
  } catch (err) {
    console.error(`${LOG_PREFIX} getSuppressedTopics failed`, { err });
    return [];
  }
}

/**
 * Build a prompt section listing suppressed topics.
 * Returns empty string if nothing is suppressed.
 */
export async function buildTopicSuppressionPromptSection(): Promise<string> {
  const suppressed = await getSuppressedTopics();
  if (suppressed.length === 0) return "";

  const list = suppressed.map((t) => `- ${t}`).join("\n");
  return `
====================================================
TOPIC COOLDOWNS (Do Not Initiate)
====================================================
These topics have been discussed frequently. Do NOT bring them up unless the user does first.
If the user brings one up, respond normally.

${list}
`.trim();
}

/**
 * Get all tracked topic keys for matching against conversation text.
 */
async function getTrackedTopicKeys(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("topic_key");

    if (error) {
      console.error(`${LOG_PREFIX} Failed to get tracked topics`, { error });
      return [];
    }

    return (data || []).map((row) => row.topic_key);
  } catch (err) {
    console.error(`${LOG_PREFIX} getTrackedTopicKeys failed`, { err });
    return [];
  }
}

/**
 * Extract topic mentions from AI response and user message, then record them.
 * Matches against existing tracked topic keys (Phase 1 — no new topic creation).
 * The synthesis job seeds new topics over time.
 */
export async function extractAndRecordTopics(
  aiResponse: string,
  userMessage: string
): Promise<void> {
  const trackedTopics = await getTrackedTopicKeys();
  if (trackedTopics.length === 0) return;

  let aiMentioned: string[] = [];
  let userMentioned: string[] = [];

  try {

    const systemPrompt = "You are a topic matcher. Given a list of tracked topic keys and two messages, identify which topics are actually being discussed."
    const prompt = `Tracked topics: ${JSON.stringify(trackedTopics)}
                    AI message: "${aiResponse}"
                    User message: "${userMessage}"

                    Return JSON only: { "ai_topics": [...], "user_topics": [...] }
                    Only include topics clearly and directly discussed. Do not match incidental word overlaps.`;


    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    console.log('TopicExhaustion RESPONSE: ', response)
    const responseText = response.text || "{}";
    const cleaned = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const trackedSet = new Set(trackedTopics);
    aiMentioned = (parsed.ai_topics || []).filter((t: string) => trackedSet.has(t));
    userMentioned = (parsed.user_topics || []).filter((t: string) => trackedSet.has(t));
  } catch (err) {
    console.warn(`${LOG_PREFIX} LLM topic extraction failed, skipping recording`, { err });
    return;
  }

  // Record user-mentioned topics first (they take priority / can lift cooldowns)
  if (userMentioned.length > 0) {
    await recordTopicMentions(userMentioned, "user");
  }

  // Record AI-mentioned topics (excluding ones the user also mentioned — user takes precedence)
  const aiOnly = aiMentioned.filter((t) => !userMentioned.includes(t));
  if (aiOnly.length > 0) {
    await recordTopicMentions(aiOnly, "ai");
  }

  if (aiMentioned.length > 0 || userMentioned.length > 0) {
    console.log(`${LOG_PREFIX} Topics extracted via LLM`, {
      aiTopics: aiOnly.length,
      userTopics: userMentioned.length,
    });
  }
}

// ============================================================================

