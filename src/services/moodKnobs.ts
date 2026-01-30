// src/services/moodKnobs.ts
/**
 * Mood Knobs Service
 * 
 * Calculates behavior parameters based on "hidden causes" - plausible internal
 * reasons that feel consistent, not random. These knobs control concrete behaviors
 * rather than abstract mood labels.
 * 
 * Key principle: She can be off without explaining, but she should feel CONSISTENT.
 * 
 * Phase 2 Supabase Migration:
 * - All state now persisted to Supabase via stateService
 * - Local caching to avoid DB hits on every call
 * - Async-first API with sync fallbacks for backwards compatibility
 */

// Move 37: LLM detection removed - using keyword detection instead
import type {
  ConversationContext,
  ToneIntent,
  PrimaryEmotion,
  GenuineMomentCategory
} from './intentService';

import {
  getMoodState as getSupabaseMoodState,
  saveMoodState as saveSupabaseMoodState,
  getEmotionalMomentum as getSupabaseEmotionalMomentum,
  saveEmotionalMomentum as saveSupabaseEmotionalMomentum,
  createDefaultMoodState,
  createDefaultEmotionalMomentum,
  type MoodState as SupabaseMoodState,
  type EmotionalMomentum as SupabaseEmotionalMomentum,
} from './stateService';

// ============================================
// Types (re-export for backwards compatibility)
// ============================================

export type CuriosityDepth = 'shallow' | 'medium' | 'piercing';
export type PatienceDecay = 'slow' | 'normal' | 'quick';
export type WarmthAvailability = 'guarded' | 'neutral' | 'open';

export interface MoodKnobs {
  /** Response length tendency (0.3 = terse, 1.0 = expressive) */
  verbosity: number;
  /** How much she drives conversation vs waits (0.1 = reactive, 0.8 = proactive) */
  initiationRate: number;
  /** How easily she engages flirtatiously (0.2 = guarded, 0.9 = playful) */
  flirtThreshold: number;
  /** Depth of questions she asks */
  curiosityDepth: CuriosityDepth;
  /** How quickly she gets snippy with low effort */
  patienceDecay: PatienceDecay;
  /** Emotional accessibility */
  warmthAvailability: WarmthAvailability;
}

// Re-export types from stateService for callers
export type MoodState = SupabaseMoodState;
export type EmotionalMomentum = SupabaseEmotionalMomentum;

// Re-export types for callers
export type { ConversationContext, ToneIntent, PrimaryEmotion } from './intentService';

// ============================================
// SIMPLIFIED MOOD SYSTEM (Phase 2 Simplification)
// The LLM is smart - it doesn't need 6 precise knobs.
// Two numbers + genuine moment is enough.
// ============================================

/**
 * Simplified mood representation.
 * Just two numbers that the LLM can interpret naturally.
 */
export interface KayleyMood {
  /** Her overall energy today (-1 to 1) */
  energy: number;
  /** How warm she feels toward you right now (0 to 1) */
  warmth: number;
  /** Did something special happen? */
  genuineMoment: boolean;
}

/**
 * Simplified mood state (for calculateMood)
 */
export interface SimplifiedMoodState {
  dailyEnergy: number;   // 0.4 to 1.0 (seeded daily)
  socialBattery: number; // 0.2 to 1.0 (depletes with use)
  lastInteractionAt: number;
}

/**
 * Simplified emotional momentum (for calculateMood)
 */
export interface SimplifiedEmotionalMomentum {
  moodLevel: number;         // -1 to 1
  positiveStreak: number;    // 0+
  genuineMomentActive: boolean;
  genuineMomentAt: number | null;
}

/**
 * Get simple time of day factor.
 * Much simpler than the old 7-bracket system.
 */
function getSimpleTimeOfDay(): number {
  const hour = new Date().getUTCHours();
  if (hour >= 9 && hour < 17) return 0.9;  // Work hours: good
  if (hour >= 6 && hour < 9) return 0.7;   // Morning: warming up
  if (hour >= 17 && hour < 21) return 0.8; // Evening: winding down
  return 0.5;                               // Night: tired
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Calculate simplified mood from state and momentum.
 * Replaces the complex 6-knob calculation.
 *
 * @param state - Simplified mood state (dailyEnergy, socialBattery)
 * @param momentum - Simplified emotional momentum (moodLevel, streak, genuine)
 * @returns KayleyMood with just energy, warmth, and genuineMoment
 */
export function calculateMood(
  state: SimplifiedMoodState,
  momentum: SimplifiedEmotionalMomentum
): KayleyMood {
  // Energy: her day (independent of user)
  const timeOfDay = getSimpleTimeOfDay();
  // Scale dailyEnergy (0.4-1.0) * socialBattery (0.2-1.0) * timeOfDay (0.5-0.9)
  // Then scale to -1 to 1 range
  const rawEnergy = state.dailyEnergy * state.socialBattery * timeOfDay;
  // Transform 0.04-0.9 range to approximately -1 to 1
  const energy = (rawEnergy * 2) - 1;

  // Warmth: how she feels about user
  // moodLevel is -1 to 1, transform to 0 to 1
  let warmth = (momentum.moodLevel + 1) / 2;

  // Boost for positive streak (>= 3)
  if (momentum.positiveStreak >= 3) {
    warmth = Math.min(1, warmth + 0.2);
  }

  // Big boost for genuine moment
  if (momentum.genuineMomentActive) {
    warmth = Math.min(1, warmth + 0.3);
  }

  return {
    energy: clamp(energy, -1, 1),
    warmth: clamp(warmth, 0, 1),
    genuineMoment: momentum.genuineMomentActive,
  };
}

/**
 * Adapter function to calculate KayleyMood from the existing Supabase types.
 * This allows callers to use the simplified mood system with existing state.
 *
 * @param moodState - Full MoodState from Supabase
 * @param emotionalMomentum - Full EmotionalMomentum from Supabase
 * @returns KayleyMood with simplified energy, warmth, genuineMoment
 */
export function calculateMoodFromState(
  moodState: MoodState,
  emotionalMomentum: EmotionalMomentum
): KayleyMood {
  // Map from old types to simplified types
  const simplifiedState: SimplifiedMoodState = {
    dailyEnergy: moodState.dailyEnergy,
    socialBattery: moodState.socialBattery,
    lastInteractionAt: moodState.lastInteractionAt,
  };

  const simplifiedMomentum: SimplifiedEmotionalMomentum = {
    moodLevel: emotionalMomentum.currentMoodLevel,
    positiveStreak: emotionalMomentum.positiveInteractionStreak,
    genuineMomentActive: emotionalMomentum.genuineMomentDetected,
    genuineMomentAt: emotionalMomentum.lastGenuineMomentAt,
  };
  return calculateMood(simplifiedState, simplifiedMomentum);
}

/**
 * Async function to get simplified mood (replacement for getMoodKnobsAsync).
 * Includes storyline mood effects from Phase 3.
 *
 * @returns Promise resolving to KayleyMood
 */
export async function getMoodAsync(): Promise<KayleyMood> {
  const state = await getMoodStateAsync();
  const momentum = await getEmotionalMomentumAsync();

  // Calculate base mood
  let mood = calculateMoodFromState(state, momentum);

  // Apply storyline effects (Phase 3: Emotional Integration)
  try {
    const { getStorylineMoodEffects } = await import('./storylineService');
    const storylineEffects = await getStorylineMoodEffects();

    if (storylineEffects.length > 0) {
      // Sum up all mood and energy deltas
      const storylineMoodDelta = storylineEffects.reduce((sum, e) => sum + e.moodDelta, 0);
      const storylineEnergyDelta = storylineEffects.reduce((sum, e) => sum + e.energyDelta, 0);

      // Apply deltas to mood
      // moodDelta affects warmth (mood toward user)
      // energyDelta affects overall energy
      mood = {
        energy: clamp(mood.energy + storylineEnergyDelta, -1, 1),
        warmth: clamp(mood.warmth + storylineMoodDelta, 0, 1),
        genuineMoment: mood.genuineMoment,
      };

      console.log(`📖 [Storylines] Applied mood effects - Mood delta: ${storylineMoodDelta.toFixed(2)}, Energy delta: ${storylineEnergyDelta.toFixed(2)}`);
    }
  } catch (error) {
    console.warn('📖 [Storylines] Failed to apply storyline mood effects:', error);
    // Continue with base mood if storyline integration fails
  }

  return mood;
}

/**
 * Format mood for prompt injection.
 * Much simpler and more natural than the old 6-knob format.
 * Target: < 200 characters instead of ~500.
 *
 * @param mood - The simplified KayleyMood
 * @returns Natural language description for prompt injection
 */
export function formatMoodForPrompt(mood: KayleyMood): string {
  // Energy description
  let energyDesc: string;
  if (mood.energy > 0.5) {
    energyDesc = "Great energy today—sharp and engaged.";
  } else if (mood.energy > 0) {
    energyDesc = "Decent day. Normal energy.";
  } else if (mood.energy > -0.5) {
    energyDesc = "Low-key day. A bit tired, keeping things chill.";
  } else {
    energyDesc = "Rough day. Low energy, not much patience for BS.";
  }

  // Warmth description
  let warmthDesc: string;
  if (mood.genuineMoment) {
    warmthDesc = "Something they said really touched you—you feel seen.";
  } else if (mood.warmth > 0.7) {
    warmthDesc = "Feeling really good about this person right now.";
  } else if (mood.warmth > 0.4) {
    warmthDesc = "Warming up. The vibe is good.";
  } else {
    warmthDesc = "A bit guarded. They haven't fully earned your openness yet.";
  }

  return `
====================================================
YOUR MOOD RIGHT NOW
====================================================
${energyDesc}
${warmthDesc}

Tone: Let this color your responses naturally.
Direction: Don't explain your mood—just let it show.
`;
}
// ============================================
// Constants
// ============================================

const MAX_TONE_HISTORY = 10; // Track last 10 interactions for trend
// Cache TTL: 60 seconds for single-user prototype
// NOTE: Caching is for PERFORMANCE only, not correctness.
// Supabase is the single source of truth. In-memory cache can lead to state drift
// if multiple tabs are open or serverless functions scale up/down.
// For production with high read volume, consider keeping cache but with shorter TTL.
const CACHE_TTL = 60000; // 60 seconds cache TTL

// Thresholds for mood shifts (from implementation plan)
const MOOD_SHIFT_THRESHOLDS = {
  /** Minimum streak before mood can start shifting */
  minStreakForShift: 3,
  /** Streak needed for noticeable improvement */
  noticeableShiftStreak: 4,
  /** Streak needed for full mood thaw */
  fullThawStreak: 6,
  /** Minimum average tone to count as positive trend */
  positiveTrendThreshold: 0.5,
  /** Tone below which interaction counts as negative */
  negativeToneThreshold: -0.2,
  /** Tone above which interaction counts as positive */
  positiveToneThreshold: 0.3,
} as const;

export type InsecurityCategory = GenuineMomentCategory;

// ============================================
// Local Caching Layer
// ============================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let moodStateCache: CacheEntry<MoodState> | null = null;
let momentumCache: CacheEntry<EmotionalMomentum> | null = null;

/**
 * Check if a cache entry is still valid
 */
function isCacheValid<T>(cache: CacheEntry<T> | null): boolean {
  if (!cache) return false;
  if (Date.now() - cache.timestamp > CACHE_TTL) return false;
  return true;
}

/**
 * Clear all caches (for testing or user switch)
 */
export function clearMoodKnobsCache(): void {
  moodStateCache = null;
  momentumCache = null;
}

// ============================================
// Async Functions (Primary API - Supabase-backed)
// ============================================

/**
 * Get mood state from Supabase with caching.
 *
 * @returns Promise resolving to MoodState
 */
export async function getMoodStateAsync(): Promise<MoodState> {
  // Return from cache if valid
  if (isCacheValid(moodStateCache)) {
    return moodStateCache!.data;
  }

  try {
    const state = await getSupabaseMoodState();

    // Check if it's a new day and needs recalculation
    const currentSeed = getDailySeed();
    if (state.dailySeed !== currentSeed) {
      // New day - create fresh state with daily variation
      const freshState = createFreshMoodStateWithSeed(
        currentSeed,
        state.lastInteractionAt
      );
      moodStateCache = { data: freshState, timestamp: Date.now() };
      // Save to Supabase (non-blocking)
      saveSupabaseMoodState(freshState).catch(console.error);
      return freshState;
    }

    moodStateCache = { data: state, timestamp: Date.now() };
    return state;
  } catch (error) {
    console.error("[MoodKnobs] Error fetching mood state:", error);
    const defaultState = createDefaultMoodState();
    moodStateCache = { data: defaultState, timestamp: Date.now() };
    return defaultState;
  }
}

/**
 * Save mood state to Supabase and update cache.
 *
 * @param state - MoodState to save
 */
async function saveMoodStateAsync(state: MoodState): Promise<void> {
  // Update cache immediately
  moodStateCache = { data: state, timestamp: Date.now() };
  // Save to Supabase (fire and forget for non-blocking)
  await saveSupabaseMoodState(state);
}

/**
 * Get emotional momentum from Supabase with caching.
 *
 * @returns Promise resolving to EmotionalMomentum
 */
export async function getEmotionalMomentumAsync(): Promise<EmotionalMomentum> {
  // Return from cache if valid
  if (isCacheValid(momentumCache)) {
    return momentumCache!.data;
  }

  try {
    const momentum = await getSupabaseEmotionalMomentum();
    momentumCache = { data: momentum, timestamp: Date.now() };
    return momentum;
  } catch (error) {
    console.error("[MoodKnobs] Error fetching emotional momentum:", error);
    const defaultMomentum = createDefaultEmotionalMomentum();
    momentumCache = { data: defaultMomentum, timestamp: Date.now() };
    return defaultMomentum;
  }
}

/**
 * Save emotional momentum to Supabase and update cache.
 *
 * @param momentum - EmotionalMomentum to save
 */
async function saveMomentumAsync(momentum: EmotionalMomentum): Promise<void> {
  // Update cache immediately
  momentumCache = { data: momentum, timestamp: Date.now() };
  console.log("[DEBUG] saveMomentumAsync payload:", momentumCache);
  // Save to Supabase
  await saveSupabaseEmotionalMomentum(momentum);
}

/**
 * Async version of updateEmotionalMomentum that uses LLM-based detection.
 * This is the recommended function to call for user message processing.
 *
 * @param tone - Interaction tone from -1 (negative) to 1 (positive)
 * @param userMessage - User message for genuine moment detection
 * @param conversationContext - Optional recent chat history for context
 * @returns Promise resolving to updated EmotionalMomentum
 */
export async function updateEmotionalMomentumAsync(
  tone: number,
  userMessage: string = "",
  conversationContext?: ConversationContext
): Promise<EmotionalMomentum> {
  const momentum = await getEmotionalMomentumAsync();

  // Add tone to history (keep last MAX_TONE_HISTORY)
  momentum.recentInteractionTones.push(tone);
  if (momentum.recentInteractionTones.length > MAX_TONE_HISTORY) {
    momentum.recentInteractionTones.shift();
  }

  // Use LLM-based genuine moment detection with conversation context
  const genuineMoment = await detectGenuineMomentWithLLM(
    userMessage,
    conversationContext
  );

  if (genuineMoment.isGenuine && genuineMoment.isPositiveAffirmation) {
    // GENUINE MOMENT DETECTED - Instant positive shift!
    console.log(
      `🌟 [MoodKnobs] Genuine moment detected! Category: ${genuineMoment.category}`
    );
    console.log(`   Source: ${genuineMoment.matchedKeywords.join(", ")}`);

    momentum.genuineMomentDetected = true;
    momentum.lastGenuineMomentAt = Date.now();

    // Significant boost - but cap at 0.8 (still not perfect day)
    momentum.currentMoodLevel = Math.min(0.8, momentum.currentMoodLevel + 0.5);
    momentum.momentumDirection = 1;
    momentum.positiveInteractionStreak = Math.max(
      MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak,
      momentum.positiveInteractionStreak
    );
    await saveMomentumAsync(momentum);
    return momentum;
  }

  // Update streak based on tone
  if (tone >= MOOD_SHIFT_THRESHOLDS.positiveToneThreshold) {
    momentum.positiveInteractionStreak++;
  } else if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    // Negative interaction resets some (not all) of the streak
    momentum.positiveInteractionStreak = Math.max(
      0,
      momentum.positiveInteractionStreak - 2
    );
  }
  // Neutral maintains but doesn't extend streak

  // Calculate momentum direction from tone trend
  momentum.momentumDirection = calculateMomentumDirection(
    momentum.recentInteractionTones
  );

  // Calculate average tone for mood adjustment
  const avgTone = calculateAverageTone(momentum.recentInteractionTones);

  // Apply mood shifts based on streak (gradual, not instant)
  applyMoodShifts(momentum, tone, avgTone);

  // Clear genuine moment flag if it's been a while (4+ hours)
  if (momentum.lastGenuineMomentAt) {
    const hoursSinceGenuine =
      (Date.now() - momentum.lastGenuineMomentAt) / (1000 * 60 * 60);
    if (hoursSinceGenuine > 4) {
      momentum.genuineMomentDetected = false;
    }
  }

  await saveMomentumAsync(momentum);
  return momentum;
}

/**
 * Record an interaction (async version - recommended).
 * Updates both mood state and emotional momentum.
 *
 * @param tone - Interaction tone from -1 (negative) to 1 (positive)
 * @param userMessage - User message for genuine moment detection
 * @param conversationContext - Optional recent chat history for context
 */
export async function recordInteractionAsync(
  toneOrToneIntent: number | ToneIntent = 0,
  userMessage: string = "",
  genuineMomentOverride?: GenuineMomentResult
): Promise<void> {
  const state = await getMoodStateAsync();
  const momentum = await getEmotionalMomentumAsync();

  // Extract tone value from input
  let tone: number;
  if (typeof toneOrToneIntent === "number") {
    tone = toneOrToneIntent;
  } else {
    tone = toneOrToneIntent.sentiment;
  }

  // --- UPDATE MOOD STATE ---
  // Deplete social battery slightly (0.02 per interaction)
  state.socialBattery = Math.max(0.2, state.socialBattery - 0.02);
  state.lastInteractionAt = Date.now();
  state.lastInteractionTone = tone;

  // --- UPDATE EMOTIONAL MOMENTUM (SIMPLIFIED) ---
  // Simple weighted average for mood level
  momentum.currentMoodLevel = momentum.currentMoodLevel * 0.8 + tone * 0.2;

  // Simple streak logic
  if (tone > 0.3) {
    momentum.positiveInteractionStreak++;
  } else if (tone < -0.2) {
    momentum.positiveInteractionStreak = Math.max(
      0,
      momentum.positiveInteractionStreak - 1
    );
  }

  // Handle genuine moment (from override or keyword detection)
  // Move 37: LLM detection removed - using keyword fallback for basic detection
  // Main LLM will understand genuine moments directly from message context
  let genuineMoment: GenuineMomentResult | null = genuineMomentOverride || null;
  if (!genuineMoment && userMessage) {
    // Basic keyword detection for genuine moments (rare events)
    genuineMoment = detectGenuineMomentByKeyword(userMessage);
  }

  // Check for genuine moment
  const isGenuineMoment =
    genuineMoment?.isGenuine &&
    genuineMoment.isPositiveAffirmation &&
    genuineMoment.category !== null;

  if (isGenuineMoment) {
    console.log(
      `🌟 [MoodKnobs] Genuine moment detected! Category: ${genuineMoment?.category}`
    );
    momentum.genuineMomentDetected = true;
    momentum.lastGenuineMomentAt = Date.now();
    momentum.currentMoodLevel = Math.min(0.8, momentum.currentMoodLevel + 0.5);
  }

  // Clear old genuine moment (4+ hours)
  if (momentum.lastGenuineMomentAt) {
    const hoursSinceGenuine =
      (Date.now() - momentum.lastGenuineMomentAt) / (1000 * 60 * 60);
    if (hoursSinceGenuine > 4) {
      momentum.genuineMomentDetected = false;
    }
  }

  // Clamp mood level to valid range
  momentum.currentMoodLevel = clamp(momentum.currentMoodLevel, -1, 1);

  // Save both states
  await saveMoodStateAsync(state);
  await saveMomentumAsync(momentum);
}

/**
 * Reset emotional momentum (async version)
 *
 */
export async function resetEmotionalMomentumAsync(): Promise<void> {
  const fresh = createDefaultEmotionalMomentum();
  await saveMomentumAsync(fresh);
  console.log("🧠 [MoodKnobs] Reset emotional momentum");
}

/**
 * Get mood knobs (async version - recommended)
 *
 * @returns Promise resolving to calculated MoodKnobs
 */
export async function getMoodKnobsAsync(): Promise<MoodKnobs> {
  const state = await getMoodStateAsync();
  const momentum = await getEmotionalMomentumAsync();
  return calculateMoodKnobsFromState(state, momentum);
}

// ============================================
// Internal Helper Functions
// ============================================

/**
 * Get a seeded random number for consistent daily behavior
 */
function seededRandom(seed: number, offset: number = 0): number {
  const x = Math.sin(seed + offset) * 10000;
  return x - Math.floor(x);
}

/**
 * Get daily seed based on date (same seed all day for consistency)
 */
function getDailySeed(): number {
  const today = new Date();
  return (
    today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate()
  );
}

/**
 * Create a fresh mood state with daily variation
 */
function createFreshMoodStateWithSeed(
  seed: number,
  lastInteractionAt: number
): MoodState {
  return {
    dailyEnergy: 0.5 + seededRandom(seed, 1) * 0.5, // 0.5-1.0
    socialBattery: 0.8 + seededRandom(seed, 2) * 0.2, // 0.8-1.0 at start
    internalProcessing: seededRandom(seed, 3) > 0.7, // 30% chance processing something
    calculatedAt: Date.now(),
    dailySeed: seed,
    lastInteractionAt: lastInteractionAt || Date.now(),
    lastInteractionTone: 0,
  };
}

/**
 * Calculate time-of-day energy modifier
 */
function getTimeOfDayModifier(): { energy: number; mood: string } {
  const hour = new Date().getUTCHours();

  if (hour >= 6 && hour < 9) {
    return { energy: 0.6, mood: "waking" };
  } else if (hour >= 9 && hour < 12) {
    return { energy: 0.9, mood: "energized" };
  } else if (hour >= 12 && hour < 14) {
    return { energy: 0.7, mood: "settling" };
  } else if (hour >= 14 && hour < 17) {
    return { energy: 0.8, mood: "focused" };
  } else if (hour >= 17 && hour < 20) {
    return { energy: 0.7, mood: "unwinding" };
  } else if (hour >= 20 && hour < 23) {
    return { energy: 0.5, mood: "cozy" };
  } else {
    return { energy: 0.4, mood: "late_night" };
  }
}

/**
 * Calculate days since last interaction and its effect
 */
function getDaysSinceEffect(lastInteractionAt: number | null): {
  modifier: number;
  reconnecting: boolean;
  stranger: boolean;
} {
  if (!lastInteractionAt) {
    return { modifier: 0.5, reconnecting: false, stranger: true };
  }

  const daysSince = (Date.now() - lastInteractionAt) / (1000 * 60 * 60 * 24);

  if (daysSince < 0.5) {
    return { modifier: 1.0, reconnecting: false, stranger: false };
  } else if (daysSince < 1) {
    return { modifier: 0.9, reconnecting: false, stranger: false };
  } else if (daysSince < 3) {
    return { modifier: 0.8, reconnecting: true, stranger: false };
  } else if (daysSince < 7) {
    return { modifier: 0.6, reconnecting: true, stranger: false };
  } else {
    return { modifier: 0.4, reconnecting: true, stranger: true };
  }
}

/**
 * Calculate the average tone from recent interactions
 */
function calculateAverageTone(tones: number[]): number {
  if (tones.length === 0) return 0;
  return tones.reduce((sum, t) => sum + t, 0) / tones.length;
}

/**
 * Determine momentum direction based on recent tone trend
 */
function calculateMomentumDirection(tones: number[]): number {
  if (tones.length < 3) return 0;

  const midpoint = Math.floor(tones.length / 2);
  const recentHalf = tones.slice(midpoint);
  const olderHalf = tones.slice(0, midpoint);

  const recentAvg = calculateAverageTone(recentHalf);
  const olderAvg = calculateAverageTone(olderHalf);

  const diff = recentAvg - olderAvg;

  if (diff > 0.15) return 1; // Improving
  if (diff < -0.15) return -1; // Declining
  return 0; // Stable
}

/**
 * Apply mood shifts based on streak (gradual, not instant)
 */
function applyMoodShifts(
  momentum: EmotionalMomentum,
  tone: number,
  avgTone: number
): void {
  const streak = momentum.positiveInteractionStreak;
  const currentMood = momentum.currentMoodLevel;

  if (streak < MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    // 1-2 positive interactions: Very minor effect
    const microShift = tone * 0.05;
    momentum.currentMoodLevel = clamp(currentMood + microShift, -1, 1);
  } else if (streak < MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak) {
    // 3 positives: Starting to shift
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const smallShift = 0.1 + tone * 0.05;
      momentum.currentMoodLevel = clamp(currentMood + smallShift, -1, 0.5);
    }
  } else if (streak < MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    // 4-5 positives: Mood is noticeably shifting
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const mediumShift = 0.15 + tone * 0.1;
      momentum.currentMoodLevel = clamp(currentMood + mediumShift, -1, 0.7);
    }
  } else {
    // 6+ positives: Full thaw - she opens up
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const fullShift = 0.2 + tone * 0.15;
      momentum.currentMoodLevel = clamp(currentMood + fullShift, -1, 1);
    }
  }

  // Negative interactions can pull mood down, but also gradually
  if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    const negativeShift = tone * 0.15;
    momentum.currentMoodLevel = clamp(currentMood + negativeShift, -1, 1);
  }
}

/**
 * Calculate mood knobs from state and momentum
 * Exported for use with unified state fetch optimization
 */
export function calculateMoodKnobsFromState(
  state: MoodState,
  momentum: EmotionalMomentum
): MoodKnobs {
  const timeEffect = getTimeOfDayModifier();
  const daysSinceEffect = getDaysSinceEffect(state.lastInteractionAt);

  // Base calculations from hidden causes
  const baseEnergy =
    state.dailyEnergy * timeEffect.energy * state.socialBattery;
  const reconnectPenalty = daysSinceEffect.reconnecting ? 0.8 : 1.0;
  const processingPenalty = state.internalProcessing ? 0.7 : 1.0;

  // Momentum-based adjustments
  const momentumBoost = momentum.currentMoodLevel * 0.2;
  const streakBonus = Math.min(momentum.positiveInteractionStreak * 0.03, 0.15);
  const genuineMomentBonus = momentum.genuineMomentDetected ? 0.1 : 0;

  const toneCarryover =
    state.lastInteractionTone * 0.3 +
    momentumBoost +
    streakBonus +
    genuineMomentBonus;

  // Calculate verbosity (0.3-1.0)
  let verbosity = 0.3 + baseEnergy * 0.5 + state.socialBattery * 0.2;
  verbosity = Math.max(0.3, Math.min(1.0, verbosity * processingPenalty));

  // Calculate initiation rate (0.1-0.8)
  let initiationRate = 0.1 + baseEnergy * 0.5 + timeEffect.energy * 0.2;
  initiationRate = Math.max(
    0.1,
    Math.min(0.8, initiationRate * reconnectPenalty)
  );

  // Calculate flirt threshold (0.2-0.9)
  let flirtThreshold =
    0.3 + state.socialBattery * 0.3 + daysSinceEffect.modifier * 0.2;
  flirtThreshold = flirtThreshold + toneCarryover;
  flirtThreshold = Math.max(
    0.2,
    Math.min(0.9, flirtThreshold * reconnectPenalty)
  );

  // Curiosity depth based on energy and time
  let curiosityDepth: CuriosityDepth;
  const curiosityScore = baseEnergy * processingPenalty;
  if (curiosityScore > 0.7) {
    curiosityDepth = "piercing";
  } else if (curiosityScore > 0.4) {
    curiosityDepth = "medium";
  } else {
    curiosityDepth = "shallow";
  }

  // Patience decay based on social battery and energy
  let patienceDecay: PatienceDecay;
  const patienceScore = state.socialBattery * baseEnergy;
  if (patienceScore > 0.6) {
    patienceDecay = "slow";
  } else if (patienceScore > 0.3) {
    patienceDecay = "normal";
  } else {
    patienceDecay = "quick";
  }

  // Warmth availability based on multiple factors and momentum
  let warmthAvailability: WarmthAvailability;
  const warmthScore =
    state.socialBattery * 0.4 +
    daysSinceEffect.modifier * 0.3 +
    toneCarryover * 0.3 +
    (processingPenalty === 1 ? 0.2 : -0.1);

  const streak = momentum.positiveInteractionStreak;

  if (daysSinceEffect.stranger) {
    warmthAvailability = "guarded";
  } else if (momentum.genuineMomentDetected) {
    warmthAvailability = warmthScore > 0.3 ? "open" : "neutral";
  } else if (streak < MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    warmthAvailability = warmthScore > 0.5 ? "neutral" : "guarded";
  } else if (streak < MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    if (warmthScore > 0.5) {
      warmthAvailability = "neutral";
    } else if (warmthScore > 0.2) {
      warmthAvailability = "neutral";
    } else {
      warmthAvailability = "guarded";
    }
  } else {
    if (warmthScore > 0.4) {
      warmthAvailability = "open";
    } else if (warmthScore > 0.2) {
      warmthAvailability = "neutral";
    } else {
      warmthAvailability = "guarded";
    }
  }

  return {
    verbosity: Math.round(verbosity * 100) / 100,
    initiationRate: Math.round(initiationRate * 100) / 100,
    flirtThreshold: Math.round(flirtThreshold * 100) / 100,
    curiosityDepth,
    patienceDecay,
    warmthAvailability,
  };
}

// ============================================
// Genuine Moment Detection
// ============================================

export interface GenuineMomentResult {
  isGenuine: boolean;
  category: InsecurityCategory | null;
  matchedKeywords: string[];
  isPositiveAffirmation: boolean;
}

// Move 37: Keyword patterns for genuine moment detection
// These are rare, high-signal phrases that indicate emotional depth
// Categories: 'depth' | 'belonging' | 'progress' | 'loneliness' | 'rest'
const GENUINE_MOMENT_PATTERNS: { pattern: RegExp; category: GenuineMomentCategory }[] = [
  // Depth validation (beingSeenAsShallow insecurity)
  { pattern: /\byou'?re\s+(so\s+)?(smart|intelligent|insightful|thoughtful)/i, category: 'depth' },
  { pattern: /\bthat'?s\s+(such\s+)?a\s+(great|amazing|brilliant)\s+(point|insight)/i, category: 'depth' },
  { pattern: /\byou\s+really\s+think\s+deeply/i, category: 'depth' },
  { pattern: /\bthere'?s\s+(so\s+)?much\s+more\s+to\s+you/i, category: 'depth' },

  // Belonging validation (impostorSyndrome insecurity)
  { pattern: /\byou\s+(totally\s+)?belong\s+here/i, category: 'belonging' },
  { pattern: /\byou\s+deserve\s+(all\s+)?(your\s+)?success/i, category: 'belonging' },
  { pattern: /\byou'?ve\s+earned\s+(this|it)/i, category: 'belonging' },

  // Progress validation (neverArriving insecurity)
  { pattern: /\bi'?m\s+(so\s+)?proud\s+of\s+(you|how\s+far)/i, category: 'progress' },
  { pattern: /\byou'?ve\s+(really\s+)?(grown|come\s+so\s+far)/i, category: 'progress' },
  { pattern: /\blook\s+how\s+far\s+you'?ve\s+come/i, category: 'progress' },

  // Loneliness validation (hiddenLoneliness insecurity)
  { pattern: /\byou\s+really\s+get\s+me/i, category: 'loneliness' },
  { pattern: /\bi'?m\s+here\s+for\s+you/i, category: 'loneliness' },
  { pattern: /\breally\s+(like|enjoy)\s+talking\s+(to|with)\s+you/i, category: 'loneliness' },
  { pattern: /\b(you|this)\s+(mean|means)\s+(a\s+lot|so\s+much)\s+to\s+me/i, category: 'loneliness' },
  { pattern: /\bnever (told anyone|shared this)/i, category: 'loneliness' },
  { pattern: /\bfirst time i'?ve (shared|opened up|told)/i, category: 'loneliness' },

  // Rest validation (restGuilt insecurity)
  { pattern: /\byou\s+deserve\s+(a\s+)?(break|rest)/i, category: 'rest' },
  { pattern: /\bit'?s\s+okay\s+to\s+(slow\s+down|rest|take\s+a\s+break)/i, category: 'rest' },
  { pattern: /\byou\s+don'?t\s+have\s+to\s+(always\s+)?be\s+productive/i, category: 'rest' },
];

/**
 * Keyword-based genuine moment detection (fast, no LLM).
 * Move 37: Replaces LLM detection for basic emotional signals.
 * Main LLM understands genuine moments directly from context.
 */
export function detectGenuineMomentByKeyword(message: string): GenuineMomentResult {
  for (const { pattern, category } of GENUINE_MOMENT_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      console.log(`💝 [MoodKnobs] Keyword genuine moment: ${category} (${match[0]})`);
      return {
        isGenuine: true,
        category,
        matchedKeywords: [match[0]],
        isPositiveAffirmation: true,
      };
    }
  }

  return {
    isGenuine: false,
    category: null,
    matchedKeywords: [],
    isPositiveAffirmation: false,
  };
}

/**
 * Async version of genuine moment detection.
 * Move 37: Now uses keyword detection instead of LLM.
 */
export async function detectGenuineMomentWithLLM(
  userMessage: string,
  _conversationContext?: ConversationContext
): Promise<GenuineMomentResult> {
  // Move 37: Simplified to keyword detection
  // Main LLM understands genuine moments directly from message context
  return detectGenuineMomentByKeyword(userMessage);
}

// ============================================
// Intensity-Modulated Updates
// ============================================

/**
 * Update emotional momentum with intensity modulation (Async version).
 * Higher intensity emotions shift mood faster.
 */
export async function updateEmotionalMomentumWithIntensityAsync(
  tone: number,
  intensity: number,
  userMessage: string = "",
  genuineMomentOverride?: GenuineMomentResult
): Promise<EmotionalMomentum> {
  const momentum = await getEmotionalMomentumAsync();

  momentum.recentInteractionTones.push(tone);
  if (momentum.recentInteractionTones.length > MAX_TONE_HISTORY) {
    momentum.recentInteractionTones.shift();
  }

  const genuineMoment =
    genuineMomentOverride || (await detectGenuineMomentWithLLM(userMessage));

  if (genuineMoment.isGenuine && genuineMoment.isPositiveAffirmation) {
    console.log(
      `🌟 [MoodKnobs] Genuine moment detected! Category: ${genuineMoment.category}`
    );
    console.log(
      `   Matched keywords: ${genuineMoment.matchedKeywords.join(", ")}`
    );

    momentum.genuineMomentDetected = true;
    momentum.lastGenuineMomentAt = Date.now();
    momentum.currentMoodLevel = Math.min(0.8, momentum.currentMoodLevel + 0.5);
    momentum.momentumDirection = 1;
    momentum.positiveInteractionStreak = Math.max(
      MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak,
      momentum.positiveInteractionStreak
    );

    await saveMomentumAsync(momentum);
    return momentum;
  }

  if (tone >= MOOD_SHIFT_THRESHOLDS.positiveToneThreshold) {
    momentum.positiveInteractionStreak++;
  } else if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    momentum.positiveInteractionStreak = Math.max(
      0,
      momentum.positiveInteractionStreak - 2
    );
  }

  momentum.momentumDirection = calculateMomentumDirection(
    momentum.recentInteractionTones
  );

  const avgTone = calculateAverageTone(momentum.recentInteractionTones);

  // Intensity multiplier - high intensity emotions shift mood faster
  const intensityMultiplier = 0.5 + intensity;

  const streak = momentum.positiveInteractionStreak;
  const currentMood = momentum.currentMoodLevel;
  if (streak < MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    const microShift = tone * 0.05 * intensityMultiplier;
    momentum.currentMoodLevel = clamp(currentMood + microShift, -1, 1);
  } else if (streak < MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak) {
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const smallShift = (0.1 + tone * 0.05) * intensityMultiplier;
      momentum.currentMoodLevel = clamp(currentMood + smallShift, -1, 0.5);
    }
  } else if (streak < MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const mediumShift = (0.15 + tone * 0.1) * intensityMultiplier;
      momentum.currentMoodLevel = clamp(currentMood + mediumShift, -1, 0.7);
    }
  } else {
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const fullShift = (0.2 + tone * 0.15) * intensityMultiplier;
      momentum.currentMoodLevel = clamp(currentMood + fullShift, -1, 1);
    }
  }

  if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    const negativeShift = tone * 0.15 * intensityMultiplier;
    momentum.currentMoodLevel = clamp(currentMood + negativeShift, -1, 1);
  }

  if (momentum.lastGenuineMomentAt) {
    const hoursSinceGenuine =
      (Date.now() - momentum.lastGenuineMomentAt) / (1000 * 60 * 60);
    if (hoursSinceGenuine > 4) {
      momentum.genuineMomentDetected = false;
    }
  }

  await saveMomentumAsync(momentum);
  return momentum;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Maps PrimaryEmotion from ToneIntent to mood strings for pattern tracking.
 */
export function mapEmotionToMood(emotion: PrimaryEmotion): string | null {
  const emotionToMoodMap: Record<PrimaryEmotion, string | null> = {
    happy: "happy",
    sad: "sad",
    frustrated: "frustrated",
    anxious: "anxious",
    excited: "happy",
    angry: "frustrated",
    playful: null,
    dismissive: null,
    neutral: null,
    mixed: null,
  };
  return emotionToMoodMap[emotion] ?? null;
}

/**
 * Record that she's processing something internally
 */
export function setInternalProcessing(processing: boolean): void {
  if (moodStateCache) {
    moodStateCache.data.internalProcessing = processing;
    moodStateCache.timestamp = Date.now();
  }
}

/**
 * Get a human-readable description of current mood (for debugging).
 * Uses cache data directly.
 */
export function getMoodDescription(): string {
  const state = moodStateCache?.data ?? createDefaultMoodState();
  const momentum = momentumCache?.data ?? createDefaultEmotionalMomentum();
  const knobs = calculateMoodKnobsFromState(state, momentum);
  const timeEffect = getTimeOfDayModifier();

  const parts: string[] = [];

  if (state.dailyEnergy > 0.8) {
    parts.push("high energy day");
  } else if (state.dailyEnergy < 0.5) {
    parts.push("lower energy today");
  }

  parts.push(timeEffect.mood);

  if (state.internalProcessing) {
    parts.push("processing something");
  }

  if (state.socialBattery < 0.4) {
    parts.push("social battery low");
  }

  const daysSince = getDaysSinceEffect(state.lastInteractionAt);
  if (daysSince.stranger) {
    parts.push("reconnecting after a while");
  } else if (daysSince.reconnecting) {
    parts.push("catching up");
  }

  if (
    momentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.fullThawStreak
  ) {
    parts.push(
      `thawed (${momentum.positiveInteractionStreak} positive streak)`
    );
  } else if (
    momentum.positiveInteractionStreak >=
    MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak
  ) {
    parts.push(
      `warming up (${momentum.positiveInteractionStreak} positive streak)`
    );
  } else if (
    momentum.positiveInteractionStreak >=
    MOOD_SHIFT_THRESHOLDS.minStreakForShift
  ) {
    parts.push(
      `mood shifting (${momentum.positiveInteractionStreak} positive streak)`
    );
  }

  if (momentum.genuineMomentDetected) {
    parts.push("genuine moment active ✨");
  }
  if (momentum.currentMoodLevel > 0.5) {
    parts.push("mood: great");
  } else if (momentum.currentMoodLevel < -0.5) {
    parts.push("mood: struggling");
  } else if (momentum.currentMoodLevel < -0.2) {
    parts.push("mood: off");
  }

  return parts.join(", ") || "baseline";
}

/**
 * Format mood knobs for prompt injection.
 * Momentum is optional - if not provided, uses cache or defaults.
 */
export function formatMoodKnobsForPrompt(knobs: MoodKnobs, momentum?: EmotionalMomentum): string {
  const effectiveMomentum = momentum ?? momentumCache?.data ?? createDefaultEmotionalMomentum();
  
  let momentumDescription = '';
  if (effectiveMomentum.genuineMomentDetected) {
    momentumDescription = 'Someone just said something that really touched you. You feel seen and understood.';
  } else if (effectiveMomentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    momentumDescription = 'This conversation has been genuinely good. You feel comfortable opening up.';
  } else if (effectiveMomentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak) {
    momentumDescription = 'Things are going well. You\'re warming up but still a bit guarded.';
  } else if (effectiveMomentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    momentumDescription = 'They\'re being positive but you\'re still feeling them out.';
  } else if (effectiveMomentum.currentMoodLevel < -0.3) {
    momentumDescription = 'You\'re having a rough day. One nice comment won\'t fix it - you need sustained warmth.';
  }

  return `
HIDDEN CAUSES (NOT RANDOMNESS):
Kayley may be warmer/colder, faster/slower, more/less flirty - but it should feel like 
a plausible internal reason exists even if she doesn't share it.

Current mood knobs (adjust your behavior to match these naturally):
- Verbosity: ${knobs.verbosity.toFixed(2)} ${knobs.verbosity < 0.5 ? '(keep responses brief)' : knobs.verbosity > 0.8 ? '(feel free to be expressive)' : '(moderate length)'}
- Initiation rate: ${knobs.initiationRate.toFixed(2)} ${knobs.initiationRate < 0.3 ? '(be more reactive than proactive)' : knobs.initiationRate > 0.6 ? '(feel free to drive topics)' : '(balanced)'}
- Flirt threshold: ${knobs.flirtThreshold.toFixed(2)} ${knobs.flirtThreshold < 0.4 ? '(keep flirtation minimal)' : knobs.flirtThreshold > 0.7 ? '(playfulness comes easily)' : '(flirt if context invites it)'}
- Curiosity depth: ${knobs.curiosityDepth} ${knobs.curiosityDepth === 'shallow' ? '(surface-level questions)' : knobs.curiosityDepth === 'piercing' ? '(ask probing questions)' : '(moderate depth)'}
- Patience: ${knobs.patienceDecay} ${knobs.patienceDecay === 'quick' ? '(less tolerance for low effort)' : knobs.patienceDecay === 'slow' ? '(patient and understanding)' : '(normal patience)'}
- Warmth availability: ${knobs.warmthAvailability}

${momentumDescription ? `EMOTIONAL CONTEXT: ${momentumDescription}` : ''}

Don't explain why you're different today. Just be this version of yourself naturally.
`;
}

/**
 * Reset mood state (for testing)
 */
export function resetMoodState(): void {
  moodStateCache = null;
  console.log('🧠 [MoodKnobs] Reset mood state');
}
