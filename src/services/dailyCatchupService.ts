// src/services/dailyCatchupService.ts

/**
 * Daily Catch-up Service
 *
 * Manages the logic for when to trigger the first-login-of-the-day catch-up.
 * Handles localStorage persistence, timing, and context gathering.
 *
 * Extracted from App.tsx as part of the refactoring effort.
 */

import { getTopLoopToSurface } from './presenceDirector';
import {
  buildDailyCatchupPrompt,
  type DailyCatchupContext,
  type OpenLoopContext,
} from './system_prompts/builders/dailyCatchupBuilder';
import type { CalendarEvent } from './calendarService';
import type { Task } from '../types';

// ============================================================================
// CONSTANTS
// ============================================================================

const CATCHUP_DELAY_MS = 5000; // 5 second delay before triggering
const STORAGE_KEY_PREFIX = 'last_briefing_';

// ============================================================================
// STATE CHECK FUNCTIONS
// ============================================================================

/**
 * Get the localStorage key for a character's last briefing date
 */
function getStorageKey(characterId: string): string {
  return `${STORAGE_KEY_PREFIX}${characterId}`;
}

/**
 * Check if the user has already been briefed today
 */
export function hasBeenBriefedToday(characterId: string): boolean {
  const today = new Date().toDateString();
  const lastBriefingDate = localStorage.getItem(getStorageKey(characterId));
  return lastBriefingDate === today;
}

/**
 * Mark that the user has been briefed today
 */
export function markBriefedToday(characterId: string): void {
  const today = new Date().toDateString();
  localStorage.setItem(getStorageKey(characterId), today);
  console.log(`📅 [DailyCatchup] Marked briefing complete for ${characterId}`);
}

/**
 * Clear the briefing state (useful for testing)
 */
export function clearBriefingState(characterId: string): void {
  localStorage.removeItem(getStorageKey(characterId));
}

// ============================================================================
// CONTEXT GATHERING
// ============================================================================

/**
 * Gather all context needed for the daily catch-up
 */
export async function gatherCatchupContext(options: {
  upcomingEvents: CalendarEvent[];
  emailCount: number;
  tasks: Task[];
  isCalendarConnected: boolean;
  isGmailConnected: boolean;
}): Promise<DailyCatchupContext> {
  // Fetch open loop for personal continuity
  let openLoop: OpenLoopContext | null = null;

  try {
    const topLoop = await getTopLoopToSurface();
    if (topLoop) {
      openLoop = {
        topic: topLoop.topic,
        suggestedFollowup: topLoop.suggestedFollowup,
      };
    }
  } catch (error) {
    console.warn('[DailyCatchup] Failed to fetch open loop:', error);
  }

  return {
    upcomingEvents: options.upcomingEvents,
    emailCount: options.emailCount,
    tasks: options.tasks,
    openLoop,
    isCalendarConnected: options.isCalendarConnected,
    isGmailConnected: options.isGmailConnected,
  };
}

// ============================================================================
// MAIN ORCHESTRATION
// ============================================================================

export interface ScheduleCatchupOptions {
  characterId: string;
  upcomingEvents: CalendarEvent[];
  emailCount: number;
  isCalendarConnected: boolean;
  isGmailConnected: boolean;
  refreshTasks: () => Promise<Task[]>;
  hasUserInteracted: () => boolean;
  onTrigger: (prompt: string) => void;
}

export interface CatchupTimer {
  cancel: () => void;
}

/**
 * Schedule the daily catch-up if appropriate
 *
 * This function:
 * 1. Checks if already briefed today
 * 2. Sets up a delayed timer
 * 3. Checks user interaction before firing
 * 4. Gathers context and builds prompt
 * 5. Triggers the callback with the prompt
 *
 * @returns A CatchupTimer with a cancel method, or null if already briefed
 */
export function scheduleDailyCatchup(
  options: ScheduleCatchupOptions
): CatchupTimer | null {
  const {
    characterId,
    upcomingEvents,
    emailCount,
    isCalendarConnected,
    isGmailConnected,
    refreshTasks,
    hasUserInteracted,
    onTrigger,
  } = options;

  // Check if already briefed today
  if (hasBeenBriefedToday(characterId)) {
    console.log('☕ [DailyCatchup] Already briefed today.');
    return null;
  }

  console.log('🌅 [DailyCatchup] Scheduling daily catch-up in 5 seconds...');

  const timerId = setTimeout(async () => {
    // Stop if user has already typed/clicked
    if (hasUserInteracted()) {
      console.log('👤 [DailyCatchup] User busy, skipping briefing.');
      return;
    }

    console.log('🌅 [DailyCatchup] Triggering Daily Catch-up...');

    try {
      // Refresh tasks at briefing time
      const currentTasks = await refreshTasks();

      // Gather all context
      const context = await gatherCatchupContext({
        upcomingEvents,
        emailCount,
        tasks: currentTasks,
        isCalendarConnected,
        isGmailConnected,
      });

      // Build the prompt
      const prompt = buildDailyCatchupPrompt(context);

      // Trigger the callback
      onTrigger(prompt);

      // Mark as briefed
      markBriefedToday(characterId);
    } catch (error) {
      console.error('[DailyCatchup] Failed to trigger catch-up:', error);
    }
  }, CATCHUP_DELAY_MS);

  return {
    cancel: () => {
      clearTimeout(timerId);
      console.log('🚫 [DailyCatchup] Cancelled scheduled catch-up');
    },
  };
}

// ============================================================================
// CONVENIENCE EXPORT
// ============================================================================

export { buildDailyCatchupPrompt, getTimeContext } from './system_prompts/builders/dailyCatchupBuilder';
export type { DailyCatchupContext, OpenLoopContext, TimeContext } from './system_prompts/builders/dailyCatchupBuilder';
