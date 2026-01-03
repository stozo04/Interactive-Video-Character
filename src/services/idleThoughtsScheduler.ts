// src/services/idleThoughtsScheduler.ts
/**
 * Idle Thoughts Scheduler Service (Part Two: Kayley Lives Her Life)
 *
 * Background service that periodically checks for user absence and:
 * 1. Generates idle thoughts (original Part One behavior)
 * 2. Generates Kayley's life experiences (activities, mishaps, discoveries)
 * 3. Checks calendar for completed events and creates messages
 * 4. Maybe generates rare gift messages (5% chance, max once/day)
 *
 * Architecture:
 * - Runs setInterval every 10 minutes (configurable)
 * - Checks lastInteractionAt from mood_states
 * - Generates content if user away >= threshold
 * - Content surfaces naturally in greetings and conversation
 *
 * Integration:
 * - Started on app initialization (App.tsx)
 * - Stopped on app unmount
 * - Works with existing presenceDirector/ongoingThreads systems
 * - Integrates with new idleLife module
 */

import { getMoodState } from './stateService';
import { generateIdleThought, MIN_ABSENCE_MINUTES_FOR_THOUGHT } from './spontaneity/idleThoughts';
import { createUserThreadAsync } from './ongoingThreads';

// Idle Life services (Part Two)
import {
  generateKayleyExperience,
  buildExperienceContext,
  checkCalendarForMessage,
  maybeGenerateGiftMessage,
  hasUndeliveredMessage,
} from './idleLife';
import type { CalendarEvent } from './calendarService';

// ============================================
// Configuration
// ============================================

export const IDLE_THOUGHTS_CONFIG = {
  /** Check for user absence every 1 minute (TESTING MODE) */
  checkIntervalMs: 1 * 60 * 1000,  // 1 minute (change to 10 * 60 * 1000 for production)

  /** Generate thought after user is away this long */
  minAbsenceMinutes: 10,  // 1 minute (change to 10 for production)

  /** Intensity for idle thought threads (high for proactive surfacing) */
  thoughtIntensity: 0.7,

  /** Run immediately on start (optional) */
  runImmediatelyOnStart: true,
};

// ============================================
// Scheduler State
// ============================================

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// Optional: Calendar events provider (set by App.tsx if calendar is connected)
let calendarEventsProvider: (() => Promise<CalendarEvent[]>) | null = null;

/**
 * Set the calendar events provider function.
 * Called from App.tsx when calendar is connected.
 */
export function setCalendarEventsProvider(
  provider: () => Promise<CalendarEvent[]>
): void {
  calendarEventsProvider = provider;
  console.log('[IdleScheduler] Calendar events provider set');
}

// ============================================
// Core Logic
// ============================================


/**
 * Generate an idle thought and convert it to an ongoing thread.
 * (Original Part One behavior)
 *
 * @param absenceDurationHours - Hours the user has been away
 * @param kayleyMood - Current mood string
 */
async function processIdleThought(
  absenceDurationHours: number,
  kayleyMood: string
): Promise<void> {
  try {
    console.log('💭 [IdleThoughts] Generating idle thought...');
    const thought = await generateIdleThought(absenceDurationHours, kayleyMood);

    if (!thought) {
      console.log('[IdleThoughts] No thought generated (cooldown or error)');
      return;
    }

    console.log(`💭 [IdleThoughts] Generated: "${thought.content.slice(0, 60)}..."`);

    // Convert to ongoing thread for proactive surfacing
    await createUserThreadAsync(
      'idle reflection',
      thought.content,
      IDLE_THOUGHTS_CONFIG.thoughtIntensity
    );

    console.log(`✅ [IdleThoughts] Converted to ongoing thread (intensity: ${IDLE_THOUGHTS_CONFIG.thoughtIntensity})`);
  } catch (error) {
    console.error('[IdleThoughts] Error processing idle thought:', error);
  }
}

/**
 * Process all idle-time activities (Part Two: Kayley Lives Her Life).
 * This is the main periodic task run by the scheduler.
 *
 * Flow:
 * 1. Check if user is away long enough
 * 2. Generate idle thought (Part One - ongoing threads)
 * 3. Generate Kayley experience (Part Two - life activities)
 * 4. Check calendar for completed events (Part Two)
 * 5. Maybe generate gift message (Part Two - rare, max once/day)
 *
 */
async function processIdleTick(): Promise<void> {
  try {
    // Get mood state to check absence duration
    const moodState = await getMoodState();
    const now = Date.now();
    const minutesAway = (now - moodState.lastInteractionAt) / (1000 * 60);
    const hoursAway = minutesAway / 60;

    // First check: scheduler's own threshold
    if (minutesAway < IDLE_THOUGHTS_CONFIG.minAbsenceMinutes) {
      return; // User not away long enough
    }

    console.log(`🌙 [IdleScheduler] User away ${Math.round(minutesAway)} min (${hoursAway.toFixed(1)} hours)`);

    // Get Kayley's current mood
    const kayleyMood = 'neutral'; // TODO: Could derive from mood state

    // ========================================
    // 1. IDLE THOUGHTS (Part One)
    // ========================================
    // Only run if user has been away long enough for thought generation
    if (minutesAway >= MIN_ABSENCE_MINUTES_FOR_THOUGHT) {
      await processIdleThought(hoursAway, kayleyMood);
    }

    // ========================================
    // 2. KAYLEY EXPERIENCES (Part Two)
    // ========================================
    // Generate a life experience (70% chance)
    try {
      const context = await buildExperienceContext();
      const experience = await generateKayleyExperience(context);
      if (experience) {
        console.log(`🎭 [IdleScheduler] Generated experience: "${experience.content.slice(0, 40)}..."`);
      }
    } catch (error) {
      console.error('[IdleScheduler] Error generating experience:', error);
    }

    // ========================================
    // 3. CALENDAR AWARENESS (Part Two)
    // ========================================
    // Check for events that ended while user was away
    const hasPending = await hasUndeliveredMessage();
    if (!hasPending && calendarEventsProvider) {
      try {
        const events = await calendarEventsProvider();
        const lastInteractionDate = new Date(moodState.lastInteractionAt);
        const calendarMessage = await checkCalendarForMessage(events, lastInteractionDate);
        if (calendarMessage) {
          console.log(`📅 [IdleScheduler] Created calendar message: "${calendarMessage.messageText.slice(0, 40)}..."`);
        }
      } catch (error) {
        console.error('[IdleScheduler] Error checking calendar:', error);
      }
    }

    // ========================================
    // 4. GIFT MESSAGES (Part Two)
    // ========================================
    // Maybe generate a rare gift message (5% chance, max once/day)
    const stillNoPending = await hasUndeliveredMessage();
    if (!stillNoPending) {
      try {
        const giftMessage = await maybeGenerateGiftMessage(hoursAway);
        if (giftMessage) {
          console.log(`🎁 [IdleScheduler] Created gift message: "${giftMessage.messageText.slice(0, 40)}..."`);
        }
      } catch (error) {
        console.error('[IdleScheduler] Error generating gift message:', error);
      }
    }

  } catch (error) {
    console.error('[IdleScheduler] Error in idle tick:', error);
  }
}

// ============================================
// Scheduler Control
// ============================================

/**
 * Start the idle thoughts scheduler.
 *
 * Runs in background, checking every 10 minutes for user absence.
 * When user is away >= threshold:
 * - Generates idle thoughts (Part One)
 * - Generates Kayley experiences (Part Two)
 * - Checks calendar for completed events (Part Two)
 * - Maybe generates gift messages (Part Two)
 */
export function startIdleThoughtsScheduler(): void {
  // Stop existing scheduler if any
  stopIdleThoughtsScheduler();

  const interval = IDLE_THOUGHTS_CONFIG.checkIntervalMs;
  const minutes = interval / 1000 / 60;

  console.log(`🌙 [IdleScheduler] Starting (checks every ${minutes} min, threshold: ${IDLE_THOUGHTS_CONFIG.minAbsenceMinutes} min)`);

  // Run once immediately on start (optional)
  if (IDLE_THOUGHTS_CONFIG.runImmediatelyOnStart) {
    processIdleTick().catch(error => {
      console.error('[IdleScheduler] Error in immediate run:', error);
    });
  }

  // Schedule periodic checks
  schedulerInterval = setInterval(() => {
    processIdleTick().catch(error => {
      console.error('[IdleScheduler] Error in scheduled run:', error);
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
  setCalendarEventsProvider,
  IDLE_THOUGHTS_CONFIG,
};
