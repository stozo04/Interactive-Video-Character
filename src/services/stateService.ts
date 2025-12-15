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

// ============================================
// Table Names
// ============================================

const MOOD_STATES_TABLE = 'mood_states';
const EMOTIONAL_MOMENTUM_TABLE = 'emotional_momentum';
const ONGOING_THREADS_TABLE = 'ongoing_threads';
const INTIMACY_STATES_TABLE = 'intimacy_states';

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
  | 'creative_project'
  | 'family'
  | 'self_improvement'
  | 'social'
  | 'work'
  | 'existential'
  | 'user_reflection';

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
  return today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
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
export async function getMoodState(userId: string): Promise<MoodState> {
  try {
    const { data, error } = await supabase
      .from(MOOD_STATES_TABLE)
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error || !data) {
      const defaultState = createDefaultMoodState();
      await saveMoodState(userId, defaultState);
      return defaultState;
    }
    
    return {
      dailyEnergy: data.daily_energy,
      socialBattery: data.social_battery,
      internalProcessing: data.internal_processing,
      calculatedAt: new Date(data.calculated_at).getTime(),
      dailySeed: data.daily_seed,
      lastInteractionAt: data.last_interaction_at ? new Date(data.last_interaction_at).getTime() : Date.now(),
      lastInteractionTone: data.last_interaction_tone ?? 0,
    };
  } catch (error) {
    console.error('[StateService] Error getting mood state:', error);
    return createDefaultMoodState();
  }
}

/**
 * Save mood state to Supabase
 */
export async function saveMoodState(userId: string, state: MoodState): Promise<void> {
  try {
    await supabase
      .from(MOOD_STATES_TABLE)
      .upsert({
        user_id: userId,
        daily_energy: state.dailyEnergy,
        social_battery: state.socialBattery,
        internal_processing: state.internalProcessing,
        calculated_at: new Date(state.calculatedAt).toISOString(),
        daily_seed: state.dailySeed,
        last_interaction_at: new Date(state.lastInteractionAt).toISOString(),
        last_interaction_tone: state.lastInteractionTone,
      }, {
        onConflict: 'user_id'
      });
  } catch (error) {
    console.error('[StateService] Error saving mood state:', error);
  }
}

// ============================================
// EMOTIONAL MOMENTUM
// ============================================

/**
 * Get emotional momentum from Supabase
 */
export async function getEmotionalMomentum(userId: string): Promise<EmotionalMomentum> {
  try {
    const { data, error } = await supabase
      .from(EMOTIONAL_MOMENTUM_TABLE)
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error || !data) {
      const defaultMomentum = createDefaultEmotionalMomentum();
      await saveEmotionalMomentum(userId, defaultMomentum);
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
    console.error('[StateService] Error getting emotional momentum:', error);
    return createDefaultEmotionalMomentum();
  }
}

/**
 * Save emotional momentum to Supabase
 */
export async function saveEmotionalMomentum(userId: string, momentum: EmotionalMomentum): Promise<void> {
  try {
    await supabase
      .from(EMOTIONAL_MOMENTUM_TABLE)
      .upsert({
        user_id: userId,
        current_mood_level: momentum.currentMoodLevel,
        momentum_direction: momentum.momentumDirection,
        positive_interaction_streak: momentum.positiveInteractionStreak,
        recent_interaction_tones: momentum.recentInteractionTones,
        genuine_moment_detected: momentum.genuineMomentDetected,
        last_genuine_moment_at: momentum.lastGenuineMomentAt 
          ? new Date(momentum.lastGenuineMomentAt).toISOString() 
          : null,
      }, {
        onConflict: 'user_id'
      });
  } catch (error) {
    console.error('[StateService] Error saving emotional momentum:', error);
  }
}

// ============================================
// ONGOING THREADS
// ============================================

/**
 * Get ongoing threads from Supabase
 */
export async function getOngoingThreads(userId: string): Promise<OngoingThread[]> {
  try {
    const { data, error } = await supabase
      .from(ONGOING_THREADS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('intensity', { ascending: false });
    
    if (error || !data) {
      return [];
    }
    
    return data.map(row => ({
      id: row.id,
      theme: row.theme as ThreadTheme,
      currentState: row.current_state,
      intensity: row.intensity,
      lastMentioned: row.last_mentioned ? new Date(row.last_mentioned).getTime() : null,
      userRelated: row.user_related,
      createdAt: new Date(row.created_at).getTime(),
      userTrigger: row.user_trigger,
    }));
  } catch (error) {
    console.error('[StateService] Error getting ongoing threads:', error);
    return [];
  }
}

/**
 * Save a single thread to Supabase
 */
export async function saveOngoingThread(userId: string, thread: OngoingThread): Promise<void> {
  try {
    await supabase
      .from(ONGOING_THREADS_TABLE)
      .upsert({
        id: thread.id,
        user_id: userId,
        theme: thread.theme,
        current_state: thread.currentState,
        intensity: thread.intensity,
        last_mentioned: thread.lastMentioned ? new Date(thread.lastMentioned).toISOString() : null,
        user_related: thread.userRelated,
        user_trigger: thread.userTrigger,
        created_at: new Date(thread.createdAt).toISOString(),
      }, {
        onConflict: 'id'
      });
  } catch (error) {
    console.error('[StateService] Error saving ongoing thread:', error);
  }
}

/**
 * Save all threads (replaces all for user)
 */
export async function saveAllOngoingThreads(userId: string, threads: OngoingThread[]): Promise<void> {
  try {
    // Delete old threads for this user
    await supabase
      .from(ONGOING_THREADS_TABLE)
      .delete()
      .eq('user_id', userId);
    
    // Insert new threads
    if (threads.length > 0) {
      const rows = threads.map(thread => ({
        id: thread.id,
        user_id: userId,
        theme: thread.theme,
        current_state: thread.currentState,
        intensity: thread.intensity,
        last_mentioned: thread.lastMentioned ? new Date(thread.lastMentioned).toISOString() : null,
        user_related: thread.userRelated,
        user_trigger: thread.userTrigger,
        created_at: new Date(thread.createdAt).toISOString(),
      }));
      
      await supabase.from(ONGOING_THREADS_TABLE).insert(rows);
    }
  } catch (error) {
    console.error('[StateService] Error saving all ongoing threads:', error);
  }
}

/**
 * Delete a thread
 */
export async function deleteOngoingThread(threadId: string): Promise<void> {
  try {
    await supabase
      .from(ONGOING_THREADS_TABLE)
      .delete()
      .eq('id', threadId);
  } catch (error) {
    console.error('[StateService] Error deleting ongoing thread:', error);
  }
}

// ============================================
// INTIMACY STATE
// ============================================

/**
 * Get intimacy state from Supabase
 */
export async function getIntimacyState(userId: string): Promise<IntimacyState> {
  try {
    const { data, error } = await supabase
      .from(INTIMACY_STATES_TABLE)
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error || !data) {
      const defaultState = createDefaultIntimacyState();
      await saveIntimacyState(userId, defaultState);
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
    console.error('[StateService] Error getting intimacy state:', error);
    return createDefaultIntimacyState();
  }
}

/**
 * Save intimacy state to Supabase
 */
export async function saveIntimacyState(userId: string, state: IntimacyState): Promise<void> {
  try {
    await supabase
      .from(INTIMACY_STATES_TABLE)
      .upsert({
        user_id: userId,
        recent_tone_modifier: state.recentToneModifier,
        vulnerability_exchange_active: state.vulnerabilityExchangeActive,
        last_vulnerability_at: state.lastVulnerabilityAt 
          ? new Date(state.lastVulnerabilityAt).toISOString() 
          : null,
        low_effort_streak: state.lowEffortStreak,
        recent_quality: state.recentQuality,
      }, {
        onConflict: 'user_id'
      });
  } catch (error) {
    console.error('[StateService] Error saving intimacy state:', error);
  }
}

// ============================================
// RESET FUNCTIONS (for testing/debugging)
// ============================================

export async function resetAllState(userId: string): Promise<void> {
  console.log(`🔄 [StateService] Resetting all state for user ${userId}`);
  
  await Promise.all([
    supabase.from(MOOD_STATES_TABLE).delete().eq('user_id', userId),
    supabase.from(EMOTIONAL_MOMENTUM_TABLE).delete().eq('user_id', userId),
    supabase.from(ONGOING_THREADS_TABLE).delete().eq('user_id', userId),
    supabase.from(INTIMACY_STATES_TABLE).delete().eq('user_id', userId),
  ]);
  
  console.log(`✅ [StateService] All state reset for user ${userId}`);
}

// ============================================
// MIGRATION HELPER
// ============================================

/**
 * Migrate localStorage to Supabase (run once)
 * Call this on app startup to migrate existing localStorage data
 */
export async function migrateLocalStorageToSupabase(userId: string): Promise<void> {
  console.log(`📦 [StateService] Checking for localStorage migration for user ${userId}...`);
  
  // Mood State
  const moodStateRaw = localStorage.getItem('kayley_mood_state');
  if (moodStateRaw) {
    try {
      const moodState = JSON.parse(moodStateRaw) as MoodState;
      await saveMoodState(userId, moodState);
      localStorage.removeItem('kayley_mood_state');
      console.log(`✅ [StateService] Migrated mood state to Supabase`);
    } catch {
      console.warn('[StateService] Could not migrate mood state');
    }
  }
  
  // Emotional Momentum
  const momentumRaw = localStorage.getItem('kayley_emotional_momentum');
  if (momentumRaw) {
    try {
      const momentum = JSON.parse(momentumRaw) as EmotionalMomentum;
      await saveEmotionalMomentum(userId, momentum);
      localStorage.removeItem('kayley_emotional_momentum');
      console.log(`✅ [StateService] Migrated emotional momentum to Supabase`);
    } catch {
      console.warn('[StateService] Could not migrate emotional momentum');
    }
  }
  
  // Ongoing Threads
  const threadsRaw = localStorage.getItem('kayley_ongoing_threads');
  if (threadsRaw) {
    try {
      const threadsState = JSON.parse(threadsRaw);
      if (threadsState.threads) {
        await saveAllOngoingThreads(userId, threadsState.threads);
        localStorage.removeItem('kayley_ongoing_threads');
        console.log(`✅ [StateService] Migrated ongoing threads to Supabase`);
      }
    } catch {
      console.warn('[StateService] Could not migrate ongoing threads');
    }
  }
  
  // Intimacy State
  const intimacyRaw = localStorage.getItem('kayley_intimacy_state');
  if (intimacyRaw) {
    try {
      const intimacyState = JSON.parse(intimacyRaw) as IntimacyState;
      await saveIntimacyState(userId, intimacyState);
      localStorage.removeItem('kayley_intimacy_state');
      console.log(`✅ [StateService] Migrated intimacy state to Supabase`);
    } catch {
      console.warn('[StateService] Could not migrate intimacy state');
    }
  }
  
  // Clean up old keys
  localStorage.removeItem('kayley_last_interaction');
  
  console.log(`📦 [StateService] Migration check complete`);
}
