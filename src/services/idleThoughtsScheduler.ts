// src/services/idleThoughtsScheduler.ts
/**
 * Idle Thoughts Scheduler Service
 *
 * Background service that periodically checks for user absence and generates
 * idle thoughts, converting them into ongoing threads for natural surfacing.
 *
 * Architecture:
 * - Runs setInterval every 10 minutes (configurable)
 * - Checks lastInteractionAt from mood_states
 * - Generates idle thought if user away >= 10 minutes
 * - Converts thought → ongoing thread (unified mental model)
 *
 * Integration:
 * - Started on app initialization (App.tsx)
 * - Stopped on app unmount
 * - Works with existing presenceDirector/ongoingThreads systems
 */

import { getMoodState } from './stateService';
import { generateIdleThought, MIN_ABSENCE_MINUTES_FOR_THOUGHT } from './spontaneity/idleThoughts';
import { createUserThreadAsync } from './ongoingThreads';

// ============================================
// Configuration
// ============================================

export const IDLE_THOUGHTS_CONFIG = {
  /** Check for user absence every 1 minute (TESTING MODE) */
  checkIntervalMs: 1 * 60 * 1000,  // 1 minute (change to 10 * 60 * 1000 for production)

  /** Generate thought after user is away this long */
  minAbsenceMinutes: 1,  // 1 minute (change to 10 for production)

  /** Intensity for idle thought threads (high for proactive surfacing) */
  thoughtIntensity: 0.7,

  /** Run immediately on start (optional) */
  runImmediatelyOnStart: true,
};

// ============================================
// Scheduler State
// ============================================

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// ============================================
// Core Logic
// ============================================

/**
 * Check if user has been away long enough to generate a thought.
 *
 * @param userId - User ID
 * @returns True if user has been away >= MIN_ABSENCE_MINUTES_FOR_THOUGHT
 */
async function shouldGenerateThought(userId: string): Promise<boolean> {
  try {
    const moodState = await getMoodState(userId);
    const now = Date.now();
    const minutesAway = (now - moodState.lastInteractionAt) / (1000 * 60);

    // Use the actual minimum required by generateIdleThought
    const shouldGenerate = minutesAway >= MIN_ABSENCE_MINUTES_FOR_THOUGHT;

    if (shouldGenerate) {
      console.log(`💭 [IdleThoughts] User away ${Math.round(minutesAway)} min (threshold: ${MIN_ABSENCE_MINUTES_FOR_THOUGHT} min)`);
    }

    return shouldGenerate;
  } catch (error) {
    console.error('[IdleThoughts] Error checking if should generate thought:', error);
    return false;
  }
}

/**
 * Generate an idle thought and convert it to an ongoing thread.
 * This is the main periodic task run by the scheduler.
 *
 * Flow:
 * 1. Check if user is away long enough
 * 2. Generate idle thought using existing service
 * 3. Convert thought → ongoing thread (user_reflection theme)
 * 4. Thread will surface naturally via selectProactiveThread()
 *
 * @param userId - User ID
 */
async function processIdleThought(userId: string): Promise<void> {
  try {
    // Check if user is away and get mood state
    const moodState = await getMoodState(userId);
    const now = Date.now();
    const minutesAway = (now - moodState.lastInteractionAt) / (1000 * 60);

    // First check: scheduler's own threshold (for testing, can be lower)
    if (minutesAway < IDLE_THOUGHTS_CONFIG.minAbsenceMinutes) {
      return; // User not away long enough for scheduler check
    }

    // Second check: actual minimum required by generateIdleThought (10 minutes)
    // This prevents errors when scheduler threshold is lower than the actual requirement
    if (minutesAway < MIN_ABSENCE_MINUTES_FOR_THOUGHT) {
      return; // User not away long enough for thought generation
    }

    // Calculate absence duration in hours
    const absenceDurationHours = minutesAway / 60;

    // Get Kayley's current mood (use 'neutral' as default if not available)
    const kayleyMood = 'neutral'; // Could be enhanced to fetch from mood state

    console.log(`💭 [IdleThoughts] User away ${Math.round(minutesAway)} min (threshold: ${MIN_ABSENCE_MINUTES_FOR_THOUGHT} min)`);

    // Generate idle thought
    console.log('💭 [IdleThoughts] Generating idle thought...');
    const thought = await generateIdleThought(userId, absenceDurationHours, kayleyMood);

    if (!thought) {
      console.log('[IdleThoughts] No thought generated (cooldown or error)');
      return;
    }

    console.log(`💭 [IdleThoughts] Generated: "${thought.content.slice(0, 60)}..."`);

    // Convert to ongoing thread
    // This integrates with existing mental model - thought becomes
    // another thing on Kayley's mind that can surface proactively
    await createUserThreadAsync(
      userId,
      'idle reflection',  // trigger (what caused this thought)
      thought.content,     // current state (the thought itself)
      IDLE_THOUGHTS_CONFIG.thoughtIntensity  // 0.7 = high intensity
    );

    console.log(`✅ [IdleThoughts] Converted to ongoing thread (intensity: ${IDLE_THOUGHTS_CONFIG.thoughtIntensity})`);

  } catch (error) {
    console.error('[IdleThoughts] Error processing idle thought:', error);
  }
}

// ============================================
// Scheduler Control
// ============================================

/**
 * Start the idle thoughts scheduler.
 *
 * Runs in background, checking every 10 minutes for user absence.
 * When user is away >= 10 minutes, generates an idle thought and
 * converts it to an ongoing thread.
 *
 * @param userId - User ID
 */
export function startIdleThoughtsScheduler(userId: string): void {
  // Stop existing scheduler if any
  stopIdleThoughtsScheduler();

  const interval = IDLE_THOUGHTS_CONFIG.checkIntervalMs;
  const minutes = interval / 1000 / 60;

  console.log(`💭 [IdleThoughts] Starting scheduler (checks every ${minutes} min, threshold: ${IDLE_THOUGHTS_CONFIG.minAbsenceMinutes} min)`);

  // Run once immediately on start (optional)
  if (IDLE_THOUGHTS_CONFIG.runImmediatelyOnStart) {
    processIdleThought(userId).catch(error => {
      console.error('[IdleThoughts] Error in immediate run:', error);
    });
  }

  // Schedule periodic checks
  schedulerInterval = setInterval(() => {
    processIdleThought(userId).catch(error => {
      console.error('[IdleThoughts] Error in scheduled run:', error);
    });
  }, interval);
}

/**
 * Stop the idle thoughts scheduler.
 * Call this on app unmount to clean up.
 */
export function stopIdleThoughtsScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[IdleThoughts] Scheduler stopped');
  }
}

/**
 * Check if scheduler is currently running.
 * Useful for debugging.
 */
export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

// ============================================
// Exports
// ============================================

export default {
  startIdleThoughtsScheduler,
  stopIdleThoughtsScheduler,
  isSchedulerRunning,
  IDLE_THOUGHTS_CONFIG,
};
