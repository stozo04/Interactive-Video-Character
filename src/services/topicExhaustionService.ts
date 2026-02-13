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
 * Decay old mentions: reset counts for topics not mentioned in the last 7 days,
 * and expire any cooldowns that have passed.
 */
export async function decayOldMentions(): Promise<void> {
  const cutoff = new Date(Date.now() - DECAY_WINDOW_DAYS * 86400000).toISOString();
  const now = new Date().toISOString();

  try {
    // Reset counts for stale topics
    const { error: decayError } = await supabase
      .from(TABLE)
      .update({ mention_count_7d: 0 })
      .lt("last_mentioned_at", cutoff)
      .gt("mention_count_7d", 0);

    if (decayError) {
      console.error(`${LOG_PREFIX} Failed to decay old mentions`, { decayError });
    }

    // Expire past cooldowns
    const { error: expireError } = await supabase
      .from(TABLE)
      .update({ cooldown_until: null })
      .lt("cooldown_until", now)
      .not("cooldown_until", "is", null);

    if (expireError) {
      console.error(`${LOG_PREFIX} Failed to expire cooldowns`, { expireError });
    }

    console.log(`${LOG_PREFIX} Decay pass complete`);
  } catch (err) {
    console.error(`${LOG_PREFIX} decayOldMentions failed`, { err });
  }
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

  const aiLower = aiResponse.toLowerCase();
  const userLower = userMessage.toLowerCase();

  const aiMentioned: string[] = [];
  const userMentioned: string[] = [];

  for (const topic of trackedTopics) {
    // Convert topic_key (snake_case) to words for matching
    const words = topic.replace(/_/g, " ");
    if (aiLower.includes(words) || aiLower.includes(topic)) {
      aiMentioned.push(topic);
    }
    if (userLower.includes(words) || userLower.includes(topic)) {
      userMentioned.push(topic);
    }
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
    console.log(`${LOG_PREFIX} Topics extracted`, {
      aiTopics: aiOnly.length,
      userTopics: userMentioned.length,
    });
  }
}

// ============================================================================
// Frequency Summary (for synthesis input)
// ============================================================================

export interface TopicFrequencyEntry {
  topic_key: string;
  mention_count_7d: number;
  last_mentioned_at: string;
  last_initiated_by: string;
  in_cooldown: boolean;
}

/**
 * Get a frequency summary of all tracked topics for richer synthesis input.
 */
export async function getTopicFrequencySummary(): Promise<TopicFrequencyEntry[]> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("topic_key, mention_count_7d, last_mentioned_at, last_initiated_by, cooldown_until")
      .gt("mention_count_7d", 0)
      .order("mention_count_7d", { ascending: false })
      .limit(50);

    if (error) {
      console.error(`${LOG_PREFIX} Failed to get topic frequency summary`, { error });
      return [];
    }

    const now = new Date().toISOString();
    return (data || []).map((row) => ({
      topic_key: row.topic_key,
      mention_count_7d: row.mention_count_7d,
      last_mentioned_at: row.last_mentioned_at,
      last_initiated_by: row.last_initiated_by,
      in_cooldown: !!(row.cooldown_until && row.cooldown_until > now),
    }));
  } catch (err) {
    console.error(`${LOG_PREFIX} getTopicFrequencySummary failed`, { err });
    return [];
  }
}

// ============================================================================
// Topic Seeding (bootstrap from synthesis output)
// ============================================================================

/**
 * Seed the topic_exhaustion table with new topic keys.
 * Only inserts keys that don't already exist. Used by synthesis job to bootstrap tracking.
 */
export async function seedTopics(topicKeys: string[]): Promise<void> {
  const normalized = [...new Set(
    topicKeys.map((k) => k.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean)
  )];

  if (normalized.length === 0) return;

  const existing = await getTrackedTopicKeys();
  const existingSet = new Set(existing);
  const newTopics = normalized.filter((k) => !existingSet.has(k));

  if (newTopics.length === 0) return;

  try {
    const rows = newTopics.map((key) => ({
      topic_key: key,
      mention_count_7d: 0,
      last_mentioned_at: new Date().toISOString(),
      last_initiated_by: "ai" as const,
    }));

    const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: "topic_key" });

    if (error) {
      console.error(`${LOG_PREFIX} Failed to seed topics`, { error });
    } else {
      console.log(`${LOG_PREFIX} Seeded ${newTopics.length} new topics`, { topics: newTopics });
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} seedTopics failed`, { err });
  }
}
