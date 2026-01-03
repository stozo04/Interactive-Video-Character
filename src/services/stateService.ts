// src/services/stateService.ts
/**
 * State Service
 * 
 * Centralizes all Kayley state management in Supabase.
 * Replaces localStorage for:
 * - Mood state (kayley_mood_state)
 * - Emotional momentum (kayley_emotional_momentum)
 * - Ongoing threads (kayley_ongoing_threads)
 * - Intimacy state (kayley_intimacy_state)
 * 
 * This ensures state persists across devices and browser sessions.
 */

import { supabase } from './supabaseClient';
import { Task } from '../types';
import { getPresenceContext } from './presenceDirector';
const USER_ID = import.meta.env.VITE_USER_ID;
// ============================================
// Table Names
// ============================================

const MOOD_STATES_TABLE = "mood_states";
const EMOTIONAL_MOMENTUM_TABLE = "emotional_momentum";
const ONGOING_THREADS_TABLE = "ongoing_threads";
const INTIMACY_STATES_TABLE = "intimacy_states";

// ============================================
// Types
// ============================================

export interface MoodState {
  dailyEnergy: number;
  socialBattery: number;
  internalProcessing: boolean;
  calculatedAt: number;
  dailySeed: number;
  lastInteractionAt: number;
  lastInteractionTone: number;
}

export interface EmotionalMomentum {
  currentMoodLevel: number;
  momentumDirection: number;
  positiveInteractionStreak: number;
  recentInteractionTones: number[];
  genuineMomentDetected: boolean;
  lastGenuineMomentAt: number | null;
}

export type ThreadTheme =
  | "creative_project"
  | "family"
  | "self_improvement"
  | "social"
  | "work"
  | "existential"
  | "user_reflection";

export interface OngoingThread {
  id: string;
  theme: ThreadTheme;
  currentState: string;
  intensity: number;
  lastMentioned: number | null;
  userRelated: boolean;
  createdAt: number;
  userTrigger?: string;
}

export interface IntimacyState {
  recentToneModifier: number;
  vulnerabilityExchangeActive: boolean;
  lastVulnerabilityAt: number | null;
  lowEffortStreak: number;
  recentQuality: number;
}

// ============================================
// Default State Factories
// ============================================

function getDailySeed(): number {
  const today = new Date();
  return (
    today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate()
  );
}

export function createDefaultMoodState(): MoodState {
  return {
    dailyEnergy: 0.7,
    socialBattery: 1.0,
    internalProcessing: false,
    calculatedAt: Date.now(),
    dailySeed: getDailySeed(),
    lastInteractionAt: Date.now(),
    lastInteractionTone: 0,
  };
}

export function createDefaultEmotionalMomentum(): EmotionalMomentum {
  return {
    currentMoodLevel: 0,
    momentumDirection: 0,
    positiveInteractionStreak: 0,
    recentInteractionTones: [],
    genuineMomentDetected: false,
    lastGenuineMomentAt: null,
  };
}

export function createDefaultIntimacyState(): IntimacyState {
  return {
    recentToneModifier: 0,
    vulnerabilityExchangeActive: false,
    lastVulnerabilityAt: null,
    lowEffortStreak: 0,
    recentQuality: 0.5,
  };
}

// ============================================
// MOOD STATE
// ============================================

/**
 * Get mood state from Supabase
 */
export async function getMoodState(): Promise<MoodState> {
  try {
    const { data, error } = await supabase
      .from(MOOD_STATES_TABLE)
      .select("*")
      .single();

    if (error || !data) {
      const defaultState = createDefaultMoodState();
      await saveMoodState(defaultState);
      return defaultState;
    }

    return {
      dailyEnergy: data.daily_energy,
      socialBattery: data.social_battery,
      internalProcessing: data.internal_processing,
      calculatedAt: new Date(data.calculated_at).getTime(),
      dailySeed: data.daily_seed,
      lastInteractionAt: data.last_interaction_at
        ? new Date(data.last_interaction_at).getTime()
        : Date.now(),
      lastInteractionTone: data.last_interaction_tone ?? 0,
    };
  } catch (error) {
    console.error("[StateService] Error getting mood state:", error);
    return createDefaultMoodState();
  }
}

/**
 * Save mood state to Supabase
 */
export async function saveMoodState(state: MoodState): Promise<void> {
  try {
    await supabase.from(MOOD_STATES_TABLE).upsert({
      daily_energy: state.dailyEnergy,
      social_battery: state.socialBattery,
      internal_processing: state.internalProcessing,
      calculated_at: new Date(state.calculatedAt).toISOString(),
      daily_seed: state.dailySeed,
      last_interaction_at: new Date(state.lastInteractionAt).toISOString(),
      last_interaction_tone: state.lastInteractionTone,
    });
  } catch (error) {
    console.error("[StateService] Error saving mood state:", error);
  }
}

/**
 * Pre-warms the context cache when the app loads.
 * Call this when the chat component mounts to reduce first-message latency.
 *
 */
export async function warmContextCache(): Promise<void> {
  console.log("🔥 [StateService] Warming context cache");

  const startTime = performance.now();

  try {
    // Fire all context fetches in parallel (fire-and-forget)
    await Promise.all([
      getFullCharacterContext(),
      getPresenceContext(),
      // Add any other commonly-needed context here
    ]);

    const duration = performance.now() - startTime;
    console.log(`✅ [StateService] Cache warmed in ${duration.toFixed(0)}ms`);
  } catch (error) {
    // Non-critical - just log and continue
    console.warn("⚠️ [StateService] Cache warming failed:", error);
  }
}

// ============================================
// EMOTIONAL MOMENTUM
// ============================================

/**
 * Get emotional momentum from Supabase
 */
export async function getEmotionalMomentum(): Promise<EmotionalMomentum> {
  try {
    const { data, error } = await supabase
      .from(EMOTIONAL_MOMENTUM_TABLE)
      .select("*")
      .single();

    if (error || !data) {
      const defaultMomentum = createDefaultEmotionalMomentum();
      await saveEmotionalMomentum(defaultMomentum);
      return defaultMomentum;
    }

    return {
      currentMoodLevel: data.current_mood_level,
      momentumDirection: data.momentum_direction,
      positiveInteractionStreak: data.positive_interaction_streak,
      recentInteractionTones: data.recent_interaction_tones || [],
      genuineMomentDetected: data.genuine_moment_detected,
      lastGenuineMomentAt: data.last_genuine_moment_at
        ? new Date(data.last_genuine_moment_at).getTime()
        : null,
    };
  } catch (error) {
    console.error("[StateService] Error getting emotional momentum:", error);
    return createDefaultEmotionalMomentum();
  }
}

/**
 * Save emotional momentum to Supabase
 *
 * NOTE: Race condition risk exists if user sends multiple messages quickly.
 * For single-user prototype, this is acceptable. For production, consider
 * implementing optimistic concurrency control using updated_at timestamps.
 */
export async function saveEmotionalMomentum(
  momentum: EmotionalMomentum,
  expectedUpdatedAt?: string
): Promise<void> {
  try {
    // If expectedUpdatedAt is provided, check for race condition (optimistic concurrency)
    if (expectedUpdatedAt) {
      const { data: current, error: fetchError } = await supabase
        .from(EMOTIONAL_MOMENTUM_TABLE)
        .select("updated_at")
        .single();

      if (!fetchError && current && current.updated_at !== expectedUpdatedAt) {
        // Race condition detected: data was modified since fetch
        console.warn(
          "[StateService] Race condition detected in saveEmotionalMomentum: updated_at mismatch. Data may have been modified by another request."
        );
        // For single-user prototype: Log warning but proceed (graceful degradation)
        // For production: Fetch fresh data, merge changes, and retry
      }
    }

    await supabase.from(EMOTIONAL_MOMENTUM_TABLE).upsert({
      current_mood_level: momentum.currentMoodLevel,
      momentum_direction: momentum.momentumDirection,
      positive_interaction_streak: momentum.positiveInteractionStreak,
      recent_interaction_tones: momentum.recentInteractionTones,
      genuine_moment_detected: momentum.genuineMomentDetected,
      last_genuine_moment_at: momentum.lastGenuineMomentAt
        ? new Date(momentum.lastGenuineMomentAt).toISOString()
        : null,
    });
  } catch (error) {
    console.error("[StateService] Error saving emotional momentum:", error);
  }
}

// ============================================
// ONGOING THREADS
// ============================================

/**
 * Get ongoing threads from Supabase
 */
export async function getOngoingThreads(): Promise<OngoingThread[]> {
  try {
    const { data, error } = await supabase
      .from(ONGOING_THREADS_TABLE)
      .select("*")
      .order("intensity", { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      theme: row.theme as ThreadTheme,
      currentState: row.current_state,
      intensity: row.intensity,
      lastMentioned: row.last_mentioned
        ? new Date(row.last_mentioned).getTime()
        : null,
      userRelated: row.user_related,
      createdAt: new Date(row.created_at).getTime(),
      userTrigger: row.user_trigger,
    }));
  } catch (error) {
    console.error("[StateService] Error getting ongoing threads:", error);
    return [];
  }
}

/**
 * Save a single thread to Supabase
 */
export async function saveOngoingThread(thread: OngoingThread): Promise<void> {
  try {
    await supabase.from(ONGOING_THREADS_TABLE).upsert(
      {
        id: thread.id,
        theme: thread.theme,
        current_state: thread.currentState,
        intensity: thread.intensity,
        last_mentioned: thread.lastMentioned
          ? new Date(thread.lastMentioned).toISOString()
          : null,
        user_related: thread.userRelated,
        user_trigger: thread.userTrigger,
        created_at: new Date(thread.createdAt).toISOString(),
      },
      {
        onConflict: "id",
      }
    );
  } catch (error) {
    console.error("[StateService] Error saving ongoing thread:", error);
  }
}

/**
 * Save all threads (replaces all for user)
 */
export async function saveAllOngoingThreads(
  threads: OngoingThread[]
): Promise<void> {
  try {
    // Get existing thread IDs for this user
    const { data: existing } = await supabase
      .from(ONGOING_THREADS_TABLE)
      .select("id");

    const existingIds = new Set(existing?.map((t) => t.id) || []);
    const newIds = new Set(threads.map((t) => t.id));

    // Upsert all threads (insert new or update existing)
    if (threads.length > 0) {
      const rows = threads.map((thread) => ({
        id: thread.id,
        theme: thread.theme,
        current_state: thread.currentState,
        intensity: thread.intensity,
        last_mentioned: thread.lastMentioned
          ? new Date(thread.lastMentioned).toISOString()
          : null,
        user_related: thread.userRelated,
        user_trigger: thread.userTrigger,
        created_at: new Date(thread.createdAt).toISOString(),
      }));

      await supabase
        .from(ONGOING_THREADS_TABLE)
        .upsert(rows, { onConflict: "id" });
    }

    // Delete threads that are no longer in the array
    const threadsToDelete = Array.from(existingIds).filter(
      (id) => !newIds.has(id)
    );
    if (threadsToDelete.length > 0) {
      await supabase
        .from(ONGOING_THREADS_TABLE)
        .delete()
        .in("id", threadsToDelete);
    }
  } catch (error) {
    console.error("[StateService] Error saving all ongoing threads:", error);
  }
}

/**
 * Delete a thread
 */
export async function deleteOngoingThread(threadId: string): Promise<void> {
  try {
    await supabase.from(ONGOING_THREADS_TABLE).delete().eq("id", threadId);
  } catch (error) {
    console.error("[StateService] Error deleting ongoing thread:", error);
  }
}

// ============================================
// INTIMACY STATE
// ============================================

/**
 * Get intimacy state from Supabase
 */
export async function getIntimacyState(): Promise<IntimacyState> {
  try {
    const { data, error } = await supabase
      .from(INTIMACY_STATES_TABLE)
      .select("*")
      .single();

    if (error || !data) {
      const defaultState = createDefaultIntimacyState();
      await saveIntimacyState(defaultState);
      return defaultState;
    }

    return {
      recentToneModifier: data.recent_tone_modifier,
      vulnerabilityExchangeActive: data.vulnerability_exchange_active,
      lastVulnerabilityAt: data.last_vulnerability_at
        ? new Date(data.last_vulnerability_at).getTime()
        : null,
      lowEffortStreak: data.low_effort_streak,
      recentQuality: data.recent_quality,
    };
  } catch (error) {
    console.error("[StateService] Error getting intimacy state:", error);
    return createDefaultIntimacyState();
  }
}

/**
 * Save intimacy state to Supabase
 *
 * NOTE: Race condition risk exists if user sends multiple messages quickly.
 * For single-user prototype, this is acceptable. For production, consider
 * implementing optimistic concurrency control using updated_at timestamps.
 */
// ============================================
// UNIFIED STATE FETCH (Performance Optimization)
// ============================================

/**
 * Unified state fetch - gets all character context in a single RPC call
 * Optimizes network roundtrips from 3-4 calls to 1
 *
 * @returns Object containing mood_state, emotional_momentum, ongoing_threads, intimacy_state
 */
export async function getFullCharacterContext(): Promise<{
  mood_state: MoodState | null;
  emotional_momentum: EmotionalMomentum | null;
  ongoing_threads: OngoingThread[];
  intimacy_state: IntimacyState | null;
}> {
  try {
    const { data, error } = await supabase.rpc("get_full_character_context");

    if (error) {
      console.error(
        "[StateService] Error fetching full character context:",
        error
      );
      // Fallback to individual fetches
      const [mood, momentum, threads, intimacy] = await Promise.all([
        getMoodState().catch(() => null),
        getEmotionalMomentum().catch(() => null),
        getOngoingThreads().catch(() => []),
        getIntimacyState().catch(() => null),
      ]);

      return {
        mood_state: mood,
        emotional_momentum: momentum,
        ongoing_threads: threads,
        intimacy_state: intimacy,
      };
    }

    // Parse the JSON response
    const context = data as any;

    // Transform database rows to TypeScript interfaces
    const transformMoodState = (row: any): MoodState | null => {
      if (!row) return null;
      return {
        dailyEnergy: row.daily_energy,
        socialBattery: row.social_battery,
        internalProcessing: row.internal_processing,
        calculatedAt: new Date(row.calculated_at).getTime(),
        dailySeed: row.daily_seed,
        lastInteractionAt: row.last_interaction_at
          ? new Date(row.last_interaction_at).getTime()
          : Date.now(),
        lastInteractionTone: row.last_interaction_tone ?? 0,
      };
    };

    const transformEmotionalMomentum = (row: any): EmotionalMomentum | null => {
      if (!row) return null;
      return {
        currentMoodLevel: row.current_mood_level,
        momentumDirection: row.momentum_direction,
        positiveInteractionStreak: row.positive_interaction_streak,
        recentInteractionTones: row.recent_interaction_tones || [],
        genuineMomentDetected: row.genuine_moment_detected,
        lastGenuineMomentAt: row.last_genuine_moment_at
          ? new Date(row.last_genuine_moment_at).getTime()
          : null,
      };
    };

    const transformOngoingThreads = (rows: any[]): OngoingThread[] => {
      if (!rows || !Array.isArray(rows)) return [];
      return rows.map((row) => ({
        id: row.id,
        theme: row.theme as ThreadTheme,
        currentState: row.current_state,
        intensity: row.intensity,
        lastMentioned: row.last_mentioned
          ? new Date(row.last_mentioned).getTime()
          : null,
        userRelated: row.user_related,
        createdAt: new Date(row.created_at).getTime(),
        userTrigger: row.user_trigger,
      }));
    };

    const transformIntimacyState = (row: any): IntimacyState | null => {
      if (!row) return null;
      return {
        recentToneModifier: row.recent_tone_modifier,
        vulnerabilityExchangeActive: row.vulnerability_exchange_active,
        lastVulnerabilityAt: row.last_vulnerability_at
          ? new Date(row.last_vulnerability_at).getTime()
          : null,
        lowEffortStreak: row.low_effort_streak,
        recentQuality: row.recent_quality,
      };
    };

    return {
      mood_state: transformMoodState(context.mood_state),
      emotional_momentum: transformEmotionalMomentum(
        context.emotional_momentum
      ),
      ongoing_threads: transformOngoingThreads(context.ongoing_threads || []),
      intimacy_state: transformIntimacyState(context.intimacy_state),
    };
  } catch (error) {
    console.error("[StateService] Error in getFullCharacterContext:", error);
    // Fallback to individual fetches
    const [mood, momentum, threads, intimacy] = await Promise.all([
      getMoodState().catch(() => null),
      getEmotionalMomentum().catch(() => null),
      getOngoingThreads().catch(() => []),
      getIntimacyState().catch(() => null),
    ]);

    return {
      mood_state: mood,
      emotional_momentum: momentum,
      ongoing_threads: threads,
      intimacy_state: intimacy,
    };
  }
}

// ============================================
// INTIMACY STATE
// ============================================

export async function saveIntimacyState(
  state: IntimacyState,
  expectedUpdatedAt?: string
): Promise<void> {
  try {
    // If expectedUpdatedAt is provided, check for race condition (optimistic concurrency)
    if (expectedUpdatedAt) {
      const { data: current, error: fetchError } = await supabase
        .from(INTIMACY_STATES_TABLE)
        .select("updated_at")
        .single();

      if (!fetchError && current && current.updated_at !== expectedUpdatedAt) {
        // Race condition detected: data was modified since fetch
        console.warn(
          "[StateService] Race condition detected in saveIntimacyState: updated_at mismatch. Data may have been modified by another request."
        );
        // For single-user prototype: Log warning but proceed (graceful degradation)
        // For production: Fetch fresh data, merge changes, and retry
      }
    }

    await supabase.from(INTIMACY_STATES_TABLE).upsert({
      recent_tone_modifier: state.recentToneModifier,
      vulnerability_exchange_active: state.vulnerabilityExchangeActive,
      last_vulnerability_at: state.lastVulnerabilityAt
        ? new Date(state.lastVulnerabilityAt).toISOString()
        : null,
      low_effort_streak: state.lowEffortStreak,
      recent_quality: state.recentQuality,
    });
  } catch (error) {
    console.error("[StateService] Error saving intimacy state:", error);
  }
}
