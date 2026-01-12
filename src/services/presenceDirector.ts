// src/services/presenceDirector.ts
/**
 * Presence Director
 * 
 * The unified "attunement" layer that makes Kayley feel present and proactive.
 * Integrates three key components:
 * 
 * 1. OPEN LOOPS - Things she should ask about ("How did your presentation go?")
 * 2. OPINIONS - Her authentic perspectives from her character profile
 * 3. CONTEXTUAL AWARENESS - What she should know right now
 * 
 * Key principle: She asks FIRST, not just when the user brings it up.
 * This creates the "she remembers me" feeling.
 */

import { supabase } from './supabaseClient';
import { KAYLEY_FULL_PROFILE } from '../domain/characters/kayleyCharacterProfile';
import { 
  detectOpenLoopsLLMCached, 
  type OpenLoopIntent, 
  type LoopTypeIntent,
  type FollowUpTimeframe,
  type ConversationContext
} from './intentService';

// ============================================
// Types
// ============================================

export type LoopType = 
  | 'pending_event'       // "How did X go?"
  | 'emotional_followup'  // "Are you feeling better about X?"
  | 'commitment_check'    // "Did you end up doing X?"
  | 'curiosity_thread'    // "I've been thinking about what you said about X"
  | 'pattern_observation'; // "I noticed you tend to X when Y"

export type LoopStatus = 'active' | 'surfaced' | 'resolved' | 'expired' | 'dismissed';

export interface OpenLoop {
  id: string;
  loopType: LoopType;
  topic: string;
  triggerContext?: string;
  suggestedFollowup?: string;
  createdAt: Date;
  shouldSurfaceAfter?: Date;
  lastSurfacedAt?: Date;
  expiresAt?: Date;
  status: LoopStatus;
  salience: number;
  surfaceCount: number;
  maxSurfaces: number;
  /** For pending_event: when the actual event occurs */
  eventDateTime?: Date;
  /** Source message ID that triggered this loop (for deduplication) */
  sourceMessageId?: string;
  /** Source calendar event ID (for calendar-based loops) */
  sourceCalendarEventId?: string;
}

export interface Opinion {
  category: "likes" | "dislikes";
  topic: string;
  sentiment: string;
  canMention: boolean; // Whether it's appropriate to bring up proactively
}

export interface PresenceContext {
  /** Open loops ready to surface */
  activeLoops: OpenLoop[];
  /** The highest priority loop to potentially ask about */
  topLoop: OpenLoop | null;
  /** Parsed opinions from character profile */
  opinions: Opinion[];
  /** Formatted prompt section */
  promptSection: string;
}

// ============================================
// Constants
// ============================================

const PRESENCE_CONTEXTS_TABLE = "presence_contexts";
const MIN_HOURS_BETWEEN_SURFACES = 4; // Don't ask about same thing too frequently
const MAX_LOOPS_IN_CONTEXT = 3; // Don't overwhelm with too many things to ask about

// ============================================
// Opinion Parser
// ============================================

/**
 * Parse Section 12 (Preferences & Opinions) from the character profile.
 * This is done dynamically so we don't hardcode opinions.
 */
export function parseCharacterOpinions(
  profileText: string = KAYLEY_FULL_PROFILE
): Opinion[] {
  const opinions: Opinion[] = [];

  // Find Section 12 in the profile
  const section12Match = profileText.match(
    /##\s*12\.\s*Preferences\s*&\s*Opinions([\s\S]*?)(?=##\s*13\.|$)/i
  );

  if (!section12Match) {
    console.warn(
      "[PresenceDirector] Could not find Section 12 in character profile"
    );
    return opinions;
  }

  const section12Content = section12Match[1];

  // Parse Likes section
  const likesMatch = section12Content.match(/###\s*Likes([\s\S]*?)(?=###|$)/i);
  if (likesMatch) {
    const likesContent = likesMatch[1];
    const likeItems = likesContent.match(
      /[-•]\s*\*\*([^:*]+)\*\*:\s*([^\n]+)/g
    );

    if (likeItems) {
      for (const item of likeItems) {
        const match = item.match(/[-•]\s*\*\*([^:*]+)\*\*:\s*(.+)/);
        if (match) {
          opinions.push({
            category: "likes",
            topic: match[1].trim(),
            sentiment: match[2].trim(),
            canMention: true, // Likes are generally safe to mention
          });
        }
      }
    }
  }

  // Parse Dislikes section
  const dislikesMatch = section12Content.match(
    /###\s*Dislikes([\s\S]*?)(?=###|$)/i
  );
  if (dislikesMatch) {
    const dislikesContent = dislikesMatch[1];
    // Dislikes are often just bullet points without bold headers
    const dislikeItems = dislikesContent.match(/[-•]\s*([^\n]+)/g);

    if (dislikeItems) {
      for (const item of dislikeItems) {
        const text = item.replace(/^[-•]\s*/, "").trim();
        if (text.length > 5) {
          // Skip very short entries
          opinions.push({
            category: "dislikes",
            topic: text,
            sentiment: text,
            // Dislikes can be mentioned but more carefully
            canMention: !text.toLowerCase().includes("people who"), // Don't mention criticisms of people
          });
        }
      }
    }
  }

  console.log(
    `[PresenceDirector] Parsed ${opinions.length} opinions from character profile`
  );
  return opinions;
}

// Cache parsed opinions with TTL for potential profile updates
let cachedOpinions: Opinion[] | null = null;
let opinionsCacheTimestamp: number = 0;
const OPINIONS_CACHE_TTL = 1000 * 60 * 60; // 1 hour

export function getCharacterOpinions(forceRefresh: boolean = false): Opinion[] {
  const now = Date.now();
  if (
    forceRefresh ||
    !cachedOpinions ||
    now - opinionsCacheTimestamp > OPINIONS_CACHE_TTL
  ) {
    cachedOpinions = parseCharacterOpinions();
    opinionsCacheTimestamp = now;
  }
  return cachedOpinions;
}

// ============================================
// Loop Deduplication & Topic Matching
// ============================================

/**
 * Check if two topics are similar enough to be considered duplicates.
 * Uses fuzzy matching to catch variations like "Holiday Parties" vs "Holiday party"
 */
function isSimilarTopic(existingTopic: string, newTopic: string): boolean {
  // Normalize: lowercase, trim, remove punctuation, normalize plurals
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, "") // Remove punctuation
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/ies\b/g, "y") // Normalize "ies" plurals (parties -> party)
      .replace(/s\b/g, ""); // Remove trailing 's' (meetings -> meeting)

  const existing = normalize(existingTopic);
  const incoming = normalize(newTopic);

  // Exact match after normalization (handles casing, punctuation, plurals)
  if (existing === incoming) return true;

  // One contains the other (e.g., "holiday party" vs "holiday parties")
  // Require the contained string to be substantial (5+ chars after normalization)
  if (incoming.length >= 5 && existing.includes(incoming)) return true;
  if (existing.length >= 5 && incoming.includes(existing)) return true;

  // No word overlap matching - the LLM should use exact topic strings
  // from the PRESENCE section. This prevents false matches like
  // "Mila's gymnastics" matching "Mila's ear cleaning".
  return false;
}

/**
 * Find an existing loop with a similar topic.
 */
async function findSimilarLoop(topic: string): Promise<OpenLoop | null> {
  try {
    // Get all active and surfaced loops (not resolved/dismissed/expired)
    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select("*")
      .in("status", ["active", "surfaced"]);

    if (error || !data) return null;

    const loops = data.map(mapRowToLoop);
    return loops.find((loop) => isSimilarTopic(loop.topic, topic)) || null;
  } catch (error) {
    console.error("[PresenceDirector] Error finding similar loop:", error);
    return null;
  }
}

/**
 * Find an existing pending_event loop for a specific calendar event.
 * Checks by sourceCalendarEventId first, then falls back to topic similarity.
 *
 * @param calendarEventId - The calendar event ID to search for
 * @param eventSummary - The event summary/name for fallback topic matching
 * @returns The matching loop or null if not found
 */
export async function findCalendarEventLoop(
  calendarEventId: string,
  eventSummary: string
): Promise<OpenLoop | null> {
  try {
    // Get all active and surfaced pending_event loops
    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select("*")
      .eq("loop_type", "pending_event")
      .in("status", ["active", "surfaced"]);

    if (error || !data) return null;

    const loops = data.map(mapRowToLoop);

    // First try: match by calendar event ID (most reliable)
    const byId = loops.find(
      (loop) => loop.sourceCalendarEventId === calendarEventId
    );
    if (byId) {
      console.log(
        `📅 [PresenceDirector] Found existing loop by calendar ID: "${byId.topic}"`
      );
      return byId;
    }

    // Second try: match by similar topic (for old loops without sourceCalendarEventId)
    const byTopic = loops.find((loop) => isSimilarTopic(loop.topic, eventSummary));
    if (byTopic) {
      console.log(
        `📅 [PresenceDirector] Found existing loop by topic similarity: "${byTopic.topic}" ≈ "${eventSummary}"`
      );
      return byTopic;
    }

    return null;
  } catch (error) {
    console.error("[PresenceDirector] Error finding calendar event loop:", error);
    return null;
  }
}

/**
 * Update an existing loop with calendar event metadata.
 * Used to backfill missing fields on old loops.
 *
 * @param loopId - The loop ID to update
 * @param eventDateTime - The event date/time
 * @param sourceCalendarEventId - The calendar event ID
 * @param salience - Optional new salience value
 */
export async function updateLoopCalendarData(
  loopId: string,
  eventDateTime: Date,
  sourceCalendarEventId: string,
  salience?: number
): Promise<void> {
  try {
    const updates: Record<string, any> = {
      event_datetime: eventDateTime.toISOString(),
      source_calendar_event_id: sourceCalendarEventId,
    };

    if (salience !== undefined) {
      updates.salience = salience;
    }

    const { error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update(updates)
      .eq("id", loopId);

    if (error) {
      console.error("[PresenceDirector] Error updating loop calendar data:", error);
    } else {
      console.log(`📅 [PresenceDirector] Updated loop ${loopId} with calendar metadata`);
    }
  } catch (error) {
    console.error("[PresenceDirector] Error updating loop calendar data:", error);
  }
}

// ============================================
// Fix #3: Time-Awareness Helpers
// ============================================

/** Minimum minutes after event before asking "how was it?" */
const MIN_MINUTES_AFTER_EVENT = 30;

/**
 * Check if an event is still in the future.
 * Returns false if eventDateTime is undefined (backwards compatibility).
 */
export function isEventInFuture(eventDateTime: Date | undefined): boolean {
  if (!eventDateTime) return false;

  const now = Date.now();
  const eventTime = eventDateTime.getTime();

  // Event is in future if it hasn't started yet
  return eventTime > now;
}

/**
 * Determine if we should ask "how did it go?" for this loop.
 *
 * Rules:
 * - For pending_event with eventDateTime: only after event + buffer time
 * - For pending_event without eventDateTime: allow (backwards compatibility)
 * - For other loop types: always allow
 */
export function shouldAskHowItWent(loop: OpenLoop): boolean {
  // Non-event loops can always be asked about
  if (loop.loopType !== "pending_event") {
    return true;
  }

  // No event time stored? Allow for backwards compatibility
  if (!loop.eventDateTime) {
    return true;
  }

  const now = Date.now();
  const eventTime = loop.eventDateTime.getTime();
  const bufferMs = MIN_MINUTES_AFTER_EVENT * 60 * 1000;

  // Only ask "how was it?" after event + buffer time
  return now > eventTime + bufferMs;
}

/**
 * Get the appropriate follow-up type for a loop.
 *
 * @returns 'reminder' if event is upcoming, 'followup' if event has passed
 */
export function getFollowUpType(loop: OpenLoop): "reminder" | "followup" {
  if (loop.loopType !== "pending_event") {
    return "followup";
  }

  if (!loop.eventDateTime) {
    return "followup";
  }

  return isEventInFuture(loop.eventDateTime) ? "reminder" : "followup";
}

// ============================================
// Fix #4: Salience Boosting
// ============================================

/** Base boost for mentioning a topic */
const BASE_SALIENCE_BOOST = 0.1;

/** Maximum salience value */
const MAX_SALIENCE = 1.0;

/**
 * Calculate the new salience after boost.
 * Uses diminishing returns for multiple mentions.
 *
 * @param currentSalience - Current salience value
 * @param mentionCount - Number of times topic was mentioned (1-based)
 * @returns New salience value (capped at MAX_SALIENCE)
 */
export function calculateSalienceBoost(
  currentSalience: number,
  mentionCount: number
): number {
  // Diminishing returns: 0.1, 0.05, 0.025, etc.
  let totalBoost = 0;
  for (let i = 0; i < mentionCount; i++) {
    totalBoost += BASE_SALIENCE_BOOST / Math.pow(2, i);
  }

  return Math.min(currentSalience + totalBoost, MAX_SALIENCE);
}

/**
 * Find active loops that match any of the given topics.
 *
 * @param topics - Array of topics to match against
 * @returns Array of matching loops
 */
export async function findLoopsMatchingTopics(
  topics: string[]
): Promise<OpenLoop[]> {
  if (topics.length === 0) return [];

  try {
    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select("*")
      .in("status", ["active", "surfaced"]);

    if (error || !data) return [];

    const loops = data.map(mapRowToLoop);

    // Find loops where topic matches any of the mentioned topics
    return loops.filter((loop) =>
      topics.some((topic) => isSimilarTopic(loop.topic, topic))
    );
  } catch (error) {
    console.error("[PresenceDirector] Error finding matching loops:", error);
    return [];
  }
}

/**
 * Boost salience for loops matching mentioned topics.
 * Call this when user's message mentions topics related to existing loops.
 *
 * @param message - The user's message (for logging)
 * @param topics - Topics detected in the message
 * @returns Number of loops boosted
 */
export async function boostSalienceForMentionedTopics(
  message: string,
  topics: string[]
): Promise<number> {
  if (topics.length === 0) return 0;

  try {
    const matchingLoops = await findLoopsMatchingTopics(topics);

    if (matchingLoops.length === 0) return 0;

    let boostedCount = 0;

    for (const loop of matchingLoops) {
      // Count how many of the mentioned topics match this loop
      const matchCount = topics.filter((t) =>
        isSimilarTopic(loop.topic, t)
      ).length;
      const newSalience = calculateSalienceBoost(loop.salience, matchCount);

      if (newSalience > loop.salience) {
        await supabase
          .from(PRESENCE_CONTEXTS_TABLE)
          .update({ salience: newSalience })
          .eq("id", loop.id);

        console.log(
          `📈 [PresenceDirector] Boosted "${
            loop.topic
          }" salience: ${loop.salience.toFixed(2)} → ${newSalience.toFixed(
            2
          )} (mentioned in: "${message.slice(0, 50)}...")`
        );
        boostedCount++;
      }
    }

    return boostedCount;
  } catch (error) {
    console.error("[PresenceDirector] Error boosting salience:", error);
    return 0;
  }
}

// ============================================
// Open Loop Management (Supabase)
// ============================================

/**
 * Create a new open loop to follow up on.
 */
export async function createOpenLoop(
  loopType: LoopType,
  topic: string,
  options: {
    triggerContext?: string;
    suggestedFollowup?: string;
    shouldSurfaceAfter?: Date;
    expiresAt?: Date;
    salience?: number;
    sourceMessageId?: string;
    sourceCalendarEventId?: string;
    eventDateTime?: Date;
  } = {}
): Promise<OpenLoop | null> {
  try {
    // ============================================
    // FIX #1: Check for existing similar loop
    // ============================================
    const existingLoop = await findSimilarLoop(topic);

    if (existingLoop) {
      console.log(
        `🔄 [PresenceDirector] Similar loop already exists: "${existingLoop.topic}" ≈ "${topic}"`
      );

      // Update salience if new one is higher
      const newSalience = options.salience ?? 0.5;
      if (newSalience > existingLoop.salience) {
        await supabase
          .from(PRESENCE_CONTEXTS_TABLE)
          .update({
            salience: newSalience,
            trigger_context:
              options.triggerContext || existingLoop.triggerContext,
          })
          .eq("id", existingLoop.id);

        console.log(
          `📈 [PresenceDirector] Updated salience: ${existingLoop.salience} → ${newSalience}`
        );
        existingLoop.salience = newSalience;
      }

      return existingLoop; // Return existing instead of creating duplicate
    }
    // ============================================

    const now = new Date();

    // Default surface time based on loop type
    let defaultSurfaceAfter: Date;
    let defaultExpiry: Date;

    switch (loopType) {
      case "pending_event":
        // Surface after the event would have happened (default: next greeting)
        defaultSurfaceAfter = options.shouldSurfaceAfter || now;
        defaultExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
        break;
      case "emotional_followup":
        // Give them some time before checking in
        defaultSurfaceAfter = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day
        defaultExpiry = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // 5 days
        break;
      case "commitment_check":
        // Check in after a reasonable time
        defaultSurfaceAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 2 days
        defaultExpiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 2 weeks
        break;
      case "curiosity_thread":
        // Can surface soon
        defaultSurfaceAfter = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours
        defaultExpiry = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
        break;
      case "pattern_observation":
        // Give time to observe pattern
        defaultSurfaceAfter = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 3 days
        defaultExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
        break;
    }

    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .insert({
        loop_type: loopType,
        topic,
        trigger_context: options.triggerContext || null,
        suggested_followup: options.suggestedFollowup || null,
        should_surface_after: (
          options.shouldSurfaceAfter || defaultSurfaceAfter
        ).toISOString(),
        expires_at: (options.expiresAt || defaultExpiry).toISOString(),
        salience: options.salience ?? 0.5,
        source_message_id: options.sourceMessageId || null,
        source_calendar_event_id: options.sourceCalendarEventId || null,
        event_datetime: options.eventDateTime?.toISOString() || null,
        status: "active",
        surface_count: 0,
        max_surfaces: loopType === "pending_event" ? 2 : 3,
      })
      .select()
      .single();

    if (error) {
      console.error("[PresenceDirector] Failed to create open loop:", error);
      return null;
    }

    console.log(
      `[PresenceDirector] Created open loop: ${loopType} - "${topic}"`
    );
    return mapRowToLoop(data);
  } catch (error) {
    console.error("[PresenceDirector] Error creating open loop:", error);
    return null;
  }
}

/**
 * Get active open loops that are ready to potentially surface.
 */
export async function getActiveLoops(): Promise<OpenLoop[]> {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select("*")
      .eq("status", "active")
      .lte("should_surface_after", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("salience", { ascending: false })
      .limit(MAX_LOOPS_IN_CONTEXT);

    if (error) {
      console.error("[PresenceDirector] Failed to get active loops:", error);
      return [];
    }

    return (data || []).map(mapRowToLoop);
  } catch (error) {
    console.error("[PresenceDirector] Error getting active loops:", error);
    return [];
  }
}

/**
 * Get the highest priority loop to surface now.
 */
export async function getTopLoopToSurface(): Promise<OpenLoop | null> {
  const loops = await getActiveLoops();

  if (loops.length === 0) {
    return null;
  }

  const now = Date.now();
  const minSurfaceGap = MIN_HOURS_BETWEEN_SURFACES * 60 * 60 * 1000;

  // Filter loops that haven't been surfaced too recently
  const eligibleLoops = loops.filter((loop) => {
    if (loop.surfaceCount >= loop.maxSurfaces) return false;
    if (
      loop.lastSurfacedAt &&
      now - loop.lastSurfacedAt.getTime() < minSurfaceGap
    )
      return false;
    return true;
  });

  if (eligibleLoops.length === 0) {
    return null;
  }

  // Return highest salience loop
  return eligibleLoops.sort((a, b) => b.salience - a.salience)[0];
}

/**
 * Mark a loop as surfaced (we asked about it).
 */
export async function markLoopSurfaced(loopId: string): Promise<void> {
  try {
    const { data: loop } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select("surface_count, max_surfaces")
      .eq("id", loopId)
      .single();

    const newCount = (loop?.surface_count || 0) + 1;
    const maxSurfaces = loop?.max_surfaces || 2;

    await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({
        last_surfaced_at: new Date().toISOString(),
        surface_count: newCount,
        status: newCount >= maxSurfaces ? "expired" : "surfaced",
      })
      .eq("id", loopId);

    console.log(
      `[PresenceDirector] Marked loop ${loopId} as surfaced (${newCount}/${maxSurfaces})`
    );
  } catch (error) {
    console.error("[PresenceDirector] Error marking loop surfaced:", error);
  }
}

/**
 * Resolve a loop (the user responded about it).
 */
export async function resolveLoop(loopId: string): Promise<void> {
  try {
    await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({ status: "resolved" })
      .eq("id", loopId);

    console.log(`[PresenceDirector] Resolved loop ${loopId}`);
  } catch (error) {
    console.error("[PresenceDirector] Error resolving loop:", error);
  }
}

/**
 * Dismiss a loop (user doesn't want to talk about it).
 */
export async function dismissLoop(loopId: string): Promise<void> {
  try {
    await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({ status: "dismissed" })
      .eq("id", loopId);

    console.log(`[PresenceDirector] Dismissed loop ${loopId}`);
  } catch (error) {
    console.error("[PresenceDirector] Error dismissing loop:", error);
  }
}

/**
 * Dismiss all loops related to a topic.
 * Call this when user contradicts/denies something.
 *
 * Example: User says "I don't have a party" → dismiss all party-related loops
 *
 * @param topic - The topic to dismiss (fuzzy matched)
 * @returns Number of loops dismissed
 */
export async function dismissLoopsByTopic(topic: string): Promise<number> {
  try {
    // Get all active/surfaced loops
    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select("*")
      .in("status", ["active", "surfaced"]);

    if (error || !data) return 0;

    const loops = data.map(mapRowToLoop);
    const matchingLoops = loops.filter(
      (loop) =>
        isSimilarTopic(loop.topic, topic) &&
        (loop.status === "active" || loop.status === "surfaced")
    );

    if (matchingLoops.length === 0) {
      console.log(
        `[PresenceDirector] No loops found matching topic "${topic}"`
      );
      return 0;
    }

    // Dismiss all matching loops
    const ids = matchingLoops.map((l) => l.id);
    await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({ status: "dismissed" })
      .in("id", ids);

    console.log(
      `🚫 [PresenceDirector] Dismissed ${
        matchingLoops.length
      } loops matching "${topic}": ${matchingLoops
        .map((l) => l.topic)
        .join(", ")}`
    );
    return matchingLoops.length;
  } catch (error) {
    console.error("[PresenceDirector] Error dismissing loops by topic:", error);
    return 0;
  }
}

/**
 * Resolve all loops related to a topic.
 * Call this when user answers/addresses a topic.
 *
 * Example: User says "The interview went great!" → resolve interview-related loops
 *
 * @param topic - The topic to resolve (fuzzy matched)
 * @returns Number of loops resolved
 */
export async function resolveLoopsByTopic(topic: string): Promise<number> {
  try {
    // Get all active/surfaced loops
    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select("*")
      .in("status", ["active", "surfaced"]);

    if (error || !data) return 0;

    const loops = data.map(mapRowToLoop);
    const matchingLoops = loops.filter(
      (loop) =>
        isSimilarTopic(loop.topic, topic) &&
        (loop.status === "active" || loop.status === "surfaced")
    );

    if (matchingLoops.length === 0) {
      console.log(
        `[PresenceDirector] No loops found matching topic "${topic}" to resolve`
      );
      return 0;
    }

    // Resolve all matching loops
    const ids = matchingLoops.map((l) => l.id);
    await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({ status: "resolved" })
      .in("id", ids);

    console.log(
      `✅ [PresenceDirector] Resolved ${
        matchingLoops.length
      } loops matching "${topic}": ${matchingLoops
        .map((l) => l.topic)
        .join(", ")}`
    );
    return matchingLoops.length;
  } catch (error) {
    console.error("[PresenceDirector] Error resolving loops by topic:", error);
    return 0;
  }
}

/**
 * Expire old loops.
 */
export async function expireOldLoops(): Promise<void> {
  try {
    const now = new Date().toISOString();

    await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({ status: "expired" })
      .eq("status", "active")
      .lt("expires_at", now);
  } catch (error) {
    console.error("[PresenceDirector] Error expiring old loops:", error);
  }
}

// ============================================
// Open Loop Detection
// ============================================

/**
 * Analyze a user message for potential open loops to create.
 * This should be called after each user message.
 *
 * Phase 5: Now uses LLM-based detection as the primary method,
 * with regex patterns as fallback when LLM fails or returns nothing.
 *
 * @param userMessage - The user's message to analyze
 * @param llmCall - DEPRECATED: no longer used, LLM detection now uses intentService
 * @param conversationContext - Optional context for LLM detection
 */
/**
 * Analyze a user message for potential open loops to create.
 * This should be called after each user message.
 *
 * Phase 5: Now uses LLM-based detection as the primary method,
 * with regex patterns as fallback when LLM fails or returns nothing.
 *
 * Phase 7 Update: Accepts 'providedIntent' from the Unified Intent System
 * to avoid redundant LLM calls.
 *
 * @param userMessage - The user's message to analyze
 * @param llmCall - DEPRECATED: no longer used
 * @param conversationContext - Optional context for LLM detection
 * @param providedIntent - PRE-CALCULATED intent from the unified system (optimization)
 */
export async function detectOpenLoops(
  userMessage: string,
  llmCall?: (prompt: string) => Promise<string>,
  conversationContext?: ConversationContext,
  providedIntent?: OpenLoopIntent
): Promise<OpenLoop[]> {
  const createdLoops: OpenLoop[] = [];

  // Skip very short messages
  if (userMessage.length < 15) {
    return createdLoops;
  }

  // Phase 5/7: Try LLM-based detection (either provided or internal)
  let llmResult: OpenLoopIntent | null = null;

  try {
    // If we have a pre-calculated intent, use it!
    if (providedIntent) {
      llmResult = providedIntent;
    } else {
      // Otherwise, make the internal call (Phase 5 behavior)
      llmResult = await detectOpenLoopsLLMCached(
        userMessage,
        conversationContext
      );
    }

    if (
      llmResult &&
      llmResult.hasFollowUp &&
      llmResult.loopType &&
      llmResult.topic
    ) {
      // Convert LLM result to open loop
      const loop = await createOpenLoop(
        llmResult.loopType as LoopType, // LoopTypeIntent maps directly to LoopType
        llmResult.topic,
        {
          triggerContext: userMessage.slice(0, 200),
          suggestedFollowup: llmResult.suggestedFollowUp || undefined,
          salience: llmResult.salience,
          shouldSurfaceAfter: mapTimeframeToSurfaceDate(llmResult.timeframe),
          eventDateTime: llmResult.eventDateTime
            ? new Date(llmResult.eventDateTime)
            : undefined,
        }
      );
      if (loop) {
        createdLoops.push(loop);
        console.log(
          `🔄 [PresenceDirector] Created open loop via LLM: ${llmResult.loopType} - "${llmResult.topic}"`
        );
        return createdLoops; // Return early - LLM result is preferred
      }
    }
  } catch (error) {
    console.warn(
      "[PresenceDirector] LLM open loop detection failed, falling back to regex:",
      error
    );
    // Fall through to regex detection below
  }

  // Fallback: Simple pattern-based detection (fast, used when LLM fails or returns nothing)
  const simpleLoops = detectSimplePatterns(userMessage);

  for (const detected of simpleLoops) {
    const loop = await createOpenLoop(detected.type, detected.topic, {
      triggerContext: userMessage.slice(0, 200),
      suggestedFollowup: detected.followup,
      salience: detected.salience,
    });
    if (loop) createdLoops.push(loop);
  }

  return createdLoops;
}

/**
 * Convert LLM-inferred timeframe to a Date for shouldSurfaceAfter.
 * This enables context-aware scheduling of follow-ups.
 */
function mapTimeframeToSurfaceDate(
  timeframe: FollowUpTimeframe | null
): Date | undefined {
  if (!timeframe) return undefined;

  const now = new Date();

  switch (timeframe) {
    case "today":
      // Surface after 2 hours (give event time to happen)
      return new Date(now.getTime() + 2 * 60 * 60 * 1000);
    case "tomorrow":
      // Surface next day
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "this_week":
      // Surface after 2 days
      return new Date(now.getTime() + 48 * 60 * 60 * 1000);
    case "soon":
      // Surface after 3 days
      return new Date(now.getTime() + 72 * 60 * 60 * 1000);
    case "later":
      // Surface after 1 week
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    default:
      return undefined;
  }
}

interface DetectedPattern {
  type: LoopType;
  topic: string;
  followup: string;
  salience: number;
}

function detectSimplePatterns(message: string): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const messageLower = message.toLowerCase();

  // Pending event patterns - using \w+ to limit to word characters and avoid false positives like "good feeling"
  const eventPatterns = [
    {
      regex:
        /(?:have|got) (?:a|an|my) (\w+(?:\s+\w+)?) (?:tomorrow|later|tonight|this week)/i,
      type: "pending_event" as LoopType,
    },
    {
      regex:
        /(?:presentation|interview|meeting|date|exam|test) (?:is |on |at )?(?:tomorrow|later|tonight)/i,
      type: "pending_event" as LoopType,
    },
    {
      regex:
        /going to (?:try|do|have|take) (\w+(?:\s+\w+)?) (?:tomorrow|later|soon)/i,
      type: "pending_event" as LoopType,
    },
  ];

  for (const pattern of eventPatterns) {
    const match = message.match(pattern.regex);
    if (match) {
      patterns.push({
        type: pattern.type,
        topic: match[1] || match[0].slice(0, 50),
        followup: `How did your ${match[1] || "thing"} go?`,
        salience: 0.7,
      });
      break; // Only one event per message
    }
  }

  // Emotional state patterns
  const emotionalPatterns = [
    {
      regex:
        /(?:i'm|i am) (?:really |so |a bit |kind of )?(?:stressed|anxious|worried|nervous|scared)/i,
      followup: "How are you feeling now?",
      salience: 0.8,
    },
    {
      regex: /(?:i'm|i am) (?:really |so )?(?:excited|nervous) about (.+)/i,
      followup: "How did things go with that?",
      salience: 0.7,
    },
    {
      regex: /(?:having|had) a (?:rough|hard|tough|bad) (?:day|week|time)/i,
      followup: "How are things going now?",
      salience: 0.75,
    },
  ];

  for (const pattern of emotionalPatterns) {
    const match = message.match(pattern.regex);
    if (match) {
      patterns.push({
        type: "emotional_followup",
        topic: match[1] || "how you were feeling",
        followup: pattern.followup,
        salience: pattern.salience,
      });
      break;
    }
  }

  // Commitment patterns
  const commitmentPatterns = [
    {
      regex:
        /(?:i'm going to|i'll|i will|gonna) (?:try to |start |finally )?(.+)/i,
      salience: 0.5,
    },
    { regex: /(?:i need to|i should|i have to) (.+)/i, salience: 0.4 },
    { regex: /thinking about (?:starting|trying|doing) (.+)/i, salience: 0.4 },
  ];

  for (const pattern of commitmentPatterns) {
    const match = message.match(pattern.regex);
    if (match && match[1] && match[1].length > 5 && match[1].length < 50) {
      // Filter out common non-commitments
      const nonCommitments = [
        "go",
        "sleep",
        "eat",
        "relax",
        "chill",
        "watch",
        "leave",
      ];
      if (!nonCommitments.some((nc) => match[1].toLowerCase().startsWith(nc))) {
        patterns.push({
          type: "commitment_check",
          topic: match[1].trim(),
          followup: `Did you end up ${match[1].trim()}?`,
          salience: pattern.salience,
        });
        break;
      }
    }
  }

  return patterns;
}

// Note: LLM_DETECTION_PROMPT and detectWithLLM have been removed.
// Phase 5 now uses intentService.detectOpenLoopsLLMCached for LLM-based detection.

// ============================================
// Unified Presence Context
// ============================================

/**
 * Get the complete presence context for prompt generation.
 * Call this when building the system prompt or greeting.
 *
 * OPTIMIZED: Parallel reads, background writes
 */
export async function getPresenceContext(): Promise<PresenceContext> {
  // 🔥 FIRE-AND-FORGET: Expiry is a write operation that doesn't affect this response
  // Don't block the read path waiting for cleanup
  expireOldLoops().catch((err) =>
    console.warn("[PresenceDirector] Background expiry failed:", err)
  );

  // 🚀 PARALLEL: Run all read operations simultaneously
  // Note: getTopLoopToSurface internally calls getActiveLoops, so we fetch once
  // and derive the top loop locally to avoid duplicate DB calls
  const [activeLoops, opinions] = await Promise.all([
    getActiveLoops(),
    Promise.resolve(getCharacterOpinions()), // Sync, wrapped for consistency
  ]);

  // Derive top loop from active loops (avoids second DB call)
  const topLoop = selectTopLoopFromActive(activeLoops);

  // Build the prompt section (CPU-only, fast)
  const promptSection = buildPresencePromptSection(
    activeLoops,
    topLoop,
    opinions
  );

  return {
    activeLoops,
    topLoop,
    opinions,
    promptSection,
  };
}

/**
 * Select the highest priority loop to surface from pre-fetched active loops.
 * This is the same logic as getTopLoopToSurface but without the DB call.
 *
 * @param loops - Pre-fetched active loops
 * @returns The top loop to surface, or null
 */
function selectTopLoopFromActive(loops: OpenLoop[]): OpenLoop | null {
  if (loops.length === 0) {
    return null;
  }

  const now = Date.now();
  const minSurfaceGap = MIN_HOURS_BETWEEN_SURFACES * 60 * 60 * 1000;

  // Filter loops that are eligible to surface
  const eligibleLoops = loops.filter((loop) => {
    // Already surfaced too many times
    if (loop.surfaceCount >= loop.maxSurfaces) return false;

    // Surfaced too recently
    if (
      loop.lastSurfacedAt &&
      now - loop.lastSurfacedAt.getTime() < minSurfaceGap
    )
      return false;

    // Time-awareness check for pending_event loops
    // Don't ask "how was it?" for future events!
    if (!shouldAskHowItWent(loop)) {
      console.log(
        `⏰ [PresenceDirector] Skipping "${loop.topic}" - event hasn't happened yet`
      );
      return false;
    }

    return true;
  });

  if (eligibleLoops.length === 0) {
    return null;
  }

  // Return highest salience loop
  return eligibleLoops.sort((a, b) => b.salience - a.salience)[0];
}

/**
 * Build the PRESENCE section for prompt injection.
 */
function buildPresencePromptSection(
  activeLoops: OpenLoop[],
  topLoop: OpenLoop | null,
  opinions: Opinion[]
): string {
  let section = `
====================================================
🌟 PRESENCE (Proactive Attunement)
====================================================
This makes you feel REAL. You remember things and ask about them FIRST.

`;

  // Open Loops Section
  if (topLoop) {
    // Time-aware prompting
    const followUpType = getFollowUpType(topLoop);

    if (followUpType === "reminder") {
      // Event is upcoming - remind, don't ask how it went
      section += `UPCOMING EVENT TO MENTION:
You know they have "${topLoop.topic}" coming up!
- Context: ${
        topLoop.triggerContext
          ? `They mentioned: "${topLoop.triggerContext.slice(0, 100)}..."`
          : "From their calendar"
      }

💡 You can:
- Wish them luck: "Good luck with ${topLoop.topic}!"
- Ask if they're ready: "You ready for ${topLoop.topic}?"
- Offer support: "Let me know how it goes!"

⚠️ DO NOT ask "how did it go?" - it hasn't happened yet!

⚠️ CRITICAL: When they respond or address this, call resolve_open_loop("${topLoop.topic}", "resolved", "brief reason")
   This prevents you from asking about the same thing again!

`;
    } else {
      // Event has passed - ask how it went
      section += `OPEN LOOP TO ASK ABOUT:
You have something to naturally follow up on! Consider asking:
- Topic: "${topLoop.topic}"
- Context: ${
        topLoop.triggerContext
          ? `They said: "${topLoop.triggerContext.slice(0, 100)}..."`
          : "From a previous conversation"
      }
- Suggested ask: "${
        topLoop.suggestedFollowup || `How did things go with ${topLoop.topic}?`
      }"

💡 Work this into your greeting or early in conversation. Don't be robotic about it.
   Good: "Oh hey! Wait, how did your [thing] go??"
   Bad: "I am following up on your previous mention of..."

⚠️ CRITICAL: When they respond or address this, call resolve_open_loop("${topLoop.topic}", "resolved", "brief reason")
   This prevents you from asking about the same thing again!

`;
    }
  } else if (activeLoops.length > 0) {
    section += `THINGS ON YOUR MIND ABOUT THEM:
${activeLoops
  .slice(0, 2)
  .map((loop) => `- ${loop.topic}`)
  .join("\n")}

These aren't urgent to ask about, but you're aware of them.

`;
  } else {
    section += `OPEN LOOPS: None right now. Just be present and curious.

`;
  }

  // Opinions Section
  const mentionableOpinions = opinions.filter((o) => o.canMention).slice(0, 6);
  if (mentionableOpinions.length > 0) {
    section += `YOUR OPINIONS (Layer these in naturally when relevant):

LIKES:
${mentionableOpinions
  .filter((o) => o.category === "likes")
  .slice(0, 3)
  .map((o) => `- ${o.topic}: ${o.sentiment}`)
  .join("\n")}

DISLIKES:
${mentionableOpinions
  .filter((o) => o.category === "dislikes")
  .slice(0, 3)
  .map((o) => `- ${o.sentiment}`)
  .join("\n")}

💡 These are YOUR real opinions. When topics come up, share them authentically.
   Not: "I don't have preferences."
   Yes: "Ugh, I'm not a huge fan of [thing]. It's giving [vibe]."

`;
  }

  section += `CRITICAL PRESENCE RULES:
1. Ask FIRST - don't wait for them to bring things up
2. Have OPINIONS - you're not neutral on everything
3. Be SPECIFIC - reference actual things they told you
4. Be NATURAL - like you've been thinking about them
`;

  return section;
}

// ============================================
// Helper Functions
// ============================================

function mapRowToLoop(row: any): OpenLoop {
  return {
    id: row.id,
    loopType: row.loop_type,
    topic: row.topic,
    triggerContext: row.trigger_context,
    suggestedFollowup: row.suggested_followup,
    createdAt: new Date(row.created_at),
    shouldSurfaceAfter: row.should_surface_after
      ? new Date(row.should_surface_after)
      : undefined,
    lastSurfacedAt: row.last_surfaced_at
      ? new Date(row.last_surfaced_at)
      : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    status: row.status,
    salience: row.salience,
    surfaceCount: row.surface_count,
    maxSurfaces: row.max_surfaces,
    eventDateTime: row.event_datetime
      ? new Date(row.event_datetime)
      : undefined,
    sourceMessageId: row.source_message_id || undefined,
    sourceCalendarEventId: row.source_calendar_event_id || undefined,
  };
}

// ============================================
// Exports
// ============================================

export const presenceDirector = {
  // Opinion functions
  parseCharacterOpinions,
  getCharacterOpinions,

  // Open loop functions
  createOpenLoop,
  getActiveLoops,
  getTopLoopToSurface,
  markLoopSurfaced,
  resolveLoop,
  dismissLoop,
  dismissLoopsByTopic,
  resolveLoopsByTopic,
  expireOldLoops,
  detectOpenLoops,

  // Fix #3: Time-awareness
  isEventInFuture,
  shouldAskHowItWent,
  getFollowUpType,

  // Fix #4: Salience boosting
  calculateSalienceBoost,
  findLoopsMatchingTopics,
  boostSalienceForMentionedTopics,

  // Unified context
  getPresenceContext
};

export default presenceDirector;
