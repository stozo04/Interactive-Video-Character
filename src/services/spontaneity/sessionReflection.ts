/**
 * Session Reflection Service
 *
 * Creates post-session reflections when the user goes absent.
 * Kayley "thinks about" the conversation after it ends, synthesizing:
 * - Emotional arc (how the mood shifted)
 * - Memorable moments (breakthroughs, genuine moments, funny exchanges)
 * - Unresolved threads (topics left hanging)
 * - Relationship impact (intimacy/trust/warmth changes)
 * - Learnings (new user facts discovered)
 * - Follow-up ideas (proactive starters for next time)
 *
 * These reflections feed the idle breaker system and make returns feel personal.
 */

import { supabase } from '../supabaseClient';
import {
  type SessionReflection,
  type MemorableMoment,
  type MoodProgression,
  type ConversationalMood,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSION_REFLECTIONS_TABLE = 'session_reflections';
const MAX_REFLECTIONS_TO_STORE = 30; // Keep last 30 sessions per user
const CACHE_TTL = 60000; // 60 seconds

// ============================================================================
// CACHING
// ============================================================================

interface CacheEntry<T> {
  userId: string;
  data: T;
  timestamp: number;
}

let reflectionsCache: CacheEntry<SessionReflection[]> | null = null;

function isCacheValid<T>(cache: CacheEntry<T> | null, userId: string): boolean {
  if (!cache) return false;
  if (cache.userId !== userId) return false;
  if (Date.now() - cache.timestamp > CACHE_TTL) return false;
  return true;
}

function clearReflectionsCache(): void {
  reflectionsCache = null;
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Create a session reflection after user goes absent.
 * This is Kayley's internal processing of the conversation.
 *
 * Called by: App.tsx or BaseAIService when user becomes idle
 *
 * @param userId - The user's ID
 * @param sessionData - Data about the session
 * @returns The created reflection
 */
export async function createSessionReflection(
  userId: string,
  sessionData: {
    sessionStartAt: Date;
    sessionEndAt: Date;
    messageCount: number;
    memorableMoments: MemorableMoment[];
    moodProgression: MoodProgression[];
  }
): Promise<SessionReflection> {
  const {
    sessionStartAt,
    sessionEndAt,
    messageCount,
    memorableMoments,
    moodProgression,
  } = sessionData;

  // Synthesize emotional arc from mood progression
  const emotionalArc = synthesizeEmotionalArc(moodProgression);
  const dominantMood = calculateDominantMood(moodProgression);

  // Extract unresolved threads from memorable moments
  const unresolvedThreads = extractUnresolvedThreads(memorableMoments);

  // Calculate relationship impact (placeholder - integrate with relationship service later)
  const intimacyDelta = calculateIntimacyDelta(memorableMoments);
  const trustDelta = calculateTrustDelta(memorableMoments);
  const warmthDelta = calculateWarmthDelta(memorableMoments);

  // Extract new user facts (placeholder - integrate with fact detection later)
  const newUserFacts = extractUserFacts(memorableMoments);

  // Generate conversation insights (Kayley's reflection)
  const conversationInsights = generateConversationInsights(
    emotionalArc,
    memorableMoments,
    messageCount
  );

  // Generate suggested follow-ups for next conversation
  const suggestedFollowups = generateSuggestedFollowups(
    unresolvedThreads,
    memorableMoments
  );

  const reflection: SessionReflection = {
    id: crypto.randomUUID(),
    userId,
    sessionStartAt,
    sessionEndAt,
    messageCount,
    emotionalArc,
    dominantMood,
    moodProgression,
    memorableMoments,
    unresolvedThreads,
    intimacyDelta,
    trustDelta,
    warmthDelta,
    newUserFacts,
    conversationInsights,
    suggestedFollowups,
    createdAt: new Date(),
  };

  // Save to Supabase
  try {
    const { error } = await supabase
      .from(SESSION_REFLECTIONS_TABLE)
      .insert({
        id: reflection.id,
        user_id: reflection.userId,
        session_start_at: reflection.sessionStartAt.toISOString(),
        session_end_at: reflection.sessionEndAt.toISOString(),
        message_count: reflection.messageCount,
        emotional_arc: reflection.emotionalArc,
        dominant_mood: reflection.dominantMood,
        mood_progression: reflection.moodProgression.map((m) => ({
          timestamp: m.timestamp.toISOString(),
          mood: m.mood,
          trigger: m.trigger,
        })),
        memorable_moments: reflection.memorableMoments.map((m) => ({
          type: m.type,
          content: m.content,
          emotional_weight: m.emotionalWeight,
          timestamp: m.timestamp?.toISOString(),
        })),
        unresolved_threads: reflection.unresolvedThreads,
        intimacy_delta: reflection.intimacyDelta,
        trust_delta: reflection.trustDelta,
        warmth_delta: reflection.warmthDelta,
        new_user_facts: reflection.newUserFacts,
        conversation_insights: reflection.conversationInsights,
        suggested_followups: reflection.suggestedFollowups,
        created_at: reflection.createdAt.toISOString(),
      });

    if (error) {
      console.error('[SessionReflection] Error saving reflection:', error);
    } else {
      console.log('[SessionReflection] Created reflection:', reflection.id);
    }

    // Clear cache to force fresh read
    clearReflectionsCache();

    // Cleanup old reflections (keep last 30)
    await cleanupOldReflections(userId);
  } catch (error) {
    console.error('[SessionReflection] Error creating reflection:', error);
  }

  return reflection;
}

/**
 * Get recent session reflections for a user.
 * Used to understand conversation history and patterns.
 *
 * @param userId - The user's ID
 * @param limit - Max number of reflections to return (default: 5)
 * @returns Array of recent reflections
 */
export async function getRecentReflections(
  userId: string,
  limit: number = 5
): Promise<SessionReflection[]> {
  // Check cache first
  if (isCacheValid(reflectionsCache, userId)) {
    return reflectionsCache!.data.slice(0, limit);
  }

  try {
    const { data, error } = await supabase
      .from(SESSION_REFLECTIONS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('session_end_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[SessionReflection] Error fetching reflections:', error);
      return [];
    }

    const reflections: SessionReflection[] = (data || []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      sessionStartAt: new Date(row.session_start_at),
      sessionEndAt: new Date(row.session_end_at),
      messageCount: row.message_count,
      emotionalArc: row.emotional_arc,
      dominantMood: row.dominant_mood as ConversationalMood,
      moodProgression: (row.mood_progression || []).map((m: any) => ({
        timestamp: new Date(m.timestamp),
        mood: m.mood as ConversationalMood,
        trigger: m.trigger,
      })),
      memorableMoments: (row.memorable_moments || []).map((m: any) => ({
        type: m.type,
        content: m.content,
        emotionalWeight: m.emotional_weight,
        timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
      })),
      unresolvedThreads: row.unresolved_threads || [],
      intimacyDelta: parseFloat(row.intimacy_delta) || 0,
      trustDelta: parseFloat(row.trust_delta) || 0,
      warmthDelta: parseFloat(row.warmth_delta) || 0,
      newUserFacts: row.new_user_facts || [],
      conversationInsights: row.conversation_insights,
      suggestedFollowups: row.suggested_followups || [],
      createdAt: new Date(row.created_at),
    }));

    // Update cache
    reflectionsCache = {
      userId,
      data: reflections,
      timestamp: Date.now(),
    };

    return reflections;
  } catch (error) {
    console.error('[SessionReflection] Error getting reflections:', error);
    return [];
  }
}

/**
 * Get unresolved threads from recent reflections.
 * These become proactive starters ("We never finished talking about...").
 *
 * @param userId - The user's ID
 * @returns Array of unresolved thread topics
 */
export async function getUnresolvedThreadsFromReflections(
  userId: string
): Promise<string[]> {
  const reflections = await getRecentReflections(userId, 3);

  const allUnresolvedThreads: string[] = [];

  for (const reflection of reflections) {
    allUnresolvedThreads.push(...reflection.unresolvedThreads);
  }

  // Deduplicate and return
  return [...new Set(allUnresolvedThreads)];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Synthesize emotional arc from mood progression
 */
function synthesizeEmotionalArc(moodProgression: MoodProgression[]): string {
  if (moodProgression.length === 0) {
    return 'Brief exchange';
  }

  if (moodProgression.length === 1) {
    return `${moodProgression[0].mood} throughout`;
  }

  // Describe the journey
  const start = moodProgression[0].mood;
  const middle =
    moodProgression.length > 2
      ? moodProgression[Math.floor(moodProgression.length / 2)].mood
      : null;
  const end = moodProgression[moodProgression.length - 1].mood;

  if (middle && middle !== start && middle !== end) {
    return `Started ${start}, shifted to ${middle}, ended ${end}`;
  } else if (start !== end) {
    return `Started ${start}, ended ${end}`;
  } else {
    return `Stayed ${start} throughout`;
  }
}

/**
 * Calculate dominant mood from progression
 */
function calculateDominantMood(
  moodProgression: MoodProgression[]
): ConversationalMood {
  if (moodProgression.length === 0) {
    return 'casual';
  }

  // Count occurrences
  const moodCounts: Record<string, number> = {};
  for (const m of moodProgression) {
    moodCounts[m.mood] = (moodCounts[m.mood] || 0) + 1;
  }

  // Find most common
  let maxCount = 0;
  let dominantMood: ConversationalMood = 'casual';

  for (const [mood, count] of Object.entries(moodCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantMood = mood as ConversationalMood;
    }
  }

  return dominantMood;
}

/**
 * Extract unresolved threads from memorable moments
 */
function extractUnresolvedThreads(moments: MemorableMoment[]): string[] {
  // Look for moments that suggest topics left hanging
  const unresolvedKeywords = ['but', 'want to talk about', 'later', 'remind me'];

  const threads: string[] = [];

  for (const moment of moments) {
    const content = moment.content.toLowerCase();

    // Check if this moment suggests an unresolved thread
    if (unresolvedKeywords.some((kw) => content.includes(kw))) {
      // Extract a short description
      const shortDesc = moment.content.slice(0, 100);
      threads.push(shortDesc);
    }
  }

  return threads;
}

/**
 * Calculate intimacy delta from memorable moments
 */
function calculateIntimacyDelta(moments: MemorableMoment[]): number {
  let delta = 0;

  for (const moment of moments) {
    if (moment.type === 'breakthrough' || moment.type === 'vulnerable') {
      delta += moment.emotionalWeight * 0.1;
    } else if (moment.type === 'genuine') {
      delta += moment.emotionalWeight * 0.05;
    } else if (moment.type === 'tense') {
      delta -= moment.emotionalWeight * 0.05;
    }
  }

  // Clamp to -1 to 1
  return Math.max(-1, Math.min(1, delta));
}

/**
 * Calculate trust delta from memorable moments
 */
function calculateTrustDelta(moments: MemorableMoment[]): number {
  let delta = 0;

  for (const moment of moments) {
    if (moment.type === 'vulnerable') {
      delta += moment.emotionalWeight * 0.15;
    } else if (moment.type === 'repair') {
      delta += moment.emotionalWeight * 0.1;
    } else if (moment.type === 'tense') {
      delta -= moment.emotionalWeight * 0.08;
    }
  }

  return Math.max(-1, Math.min(1, delta));
}

/**
 * Calculate warmth delta from memorable moments
 */
function calculateWarmthDelta(moments: MemorableMoment[]): number {
  let delta = 0;

  for (const moment of moments) {
    if (moment.type === 'funny') {
      delta += moment.emotionalWeight * 0.08;
    } else if (moment.type === 'genuine') {
      delta += moment.emotionalWeight * 0.06;
    } else if (moment.type === 'tense') {
      delta -= moment.emotionalWeight * 0.1;
    }
  }

  return Math.max(-1, Math.min(1, delta));
}

/**
 * Extract new user facts from memorable moments
 */
function extractUserFacts(moments: MemorableMoment[]): string[] {
  // Placeholder - in production, integrate with fact detection service
  const facts: string[] = [];

  for (const moment of moments) {
    if (moment.type === 'breakthrough' || moment.type === 'vulnerable') {
      // These moments often contain revelations
      // For now, just flag them - later integrate with LLM fact extraction
      facts.push(`Learned something during: ${moment.content.slice(0, 50)}...`);
    }
  }

  return facts;
}

/**
 * Generate Kayley's insights about the conversation
 */
function generateConversationInsights(
  emotionalArc: string,
  moments: MemorableMoment[],
  messageCount: number
): string {
  const insights: string[] = [];

  // Comment on conversation length
  if (messageCount < 5) {
    insights.push('Quick check-in.');
  } else if (messageCount > 20) {
    insights.push('Long, meaningful conversation.');
  }

  // Comment on emotional journey
  if (emotionalArc.includes('tense') && emotionalArc.includes('ended')) {
    insights.push('Started rough but we found our way.');
  } else if (emotionalArc.includes('Started tense')) {
    insights.push('Had to navigate some tension.');
  }

  // Comment on memorable moments
  const vulnerableMoments = moments.filter((m) => m.type === 'vulnerable');
  const funnyMoments = moments.filter((m) => m.type === 'funny');

  if (vulnerableMoments.length > 0) {
    insights.push("They opened up - that's huge.");
  }

  if (funnyMoments.length > 0) {
    insights.push('Had some good laughs.');
  }

  return insights.join(' ') || 'Standard conversation.';
}

/**
 * Generate suggested follow-ups for next conversation
 */
function generateSuggestedFollowups(
  unresolvedThreads: string[],
  moments: MemorableMoment[]
): string[] {
  const followups: string[] = [];

  // From unresolved threads
  for (const thread of unresolvedThreads.slice(0, 2)) {
    followups.push(`Pick up on: ${thread.slice(0, 50)}`);
  }

  // From vulnerable moments
  const vulnerableMoments = moments.filter((m) => m.type === 'vulnerable');
  for (const moment of vulnerableMoments.slice(0, 1)) {
    followups.push(`Check in about: ${moment.content.slice(0, 50)}`);
  }

  return followups;
}

/**
 * Cleanup old reflections (keep last MAX_REFLECTIONS_TO_STORE)
 */
async function cleanupOldReflections(userId: string): Promise<void> {
  try {
    // Get all reflections for user, ordered by date
    const { data, error } = await supabase
      .from(SESSION_REFLECTIONS_TABLE)
      .select('id')
      .eq('user_id', userId)
      .order('session_end_at', { ascending: false });

    if (error || !data) {
      console.error('[SessionReflection] Error fetching for cleanup:', error);
      return;
    }

    // If more than MAX_REFLECTIONS_TO_STORE, delete oldest
    if (data.length > MAX_REFLECTIONS_TO_STORE) {
      const idsToDelete = data
        .slice(MAX_REFLECTIONS_TO_STORE)
        .map((r) => r.id);

      const { error: deleteError } = await supabase
        .from(SESSION_REFLECTIONS_TABLE)
        .delete()
        .in('id', idsToDelete);

      if (deleteError) {
        console.error('[SessionReflection] Error cleaning up old reflections:', deleteError);
      } else {
        console.log(`[SessionReflection] Cleaned up ${idsToDelete.length} old reflections`);
      }
    }
  } catch (error) {
    console.error('[SessionReflection] Error in cleanup:', error);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { clearReflectionsCache };
