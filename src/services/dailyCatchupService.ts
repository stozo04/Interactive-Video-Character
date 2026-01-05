// src/services/dailyCatchupService.ts

/**
 * Daily Catch-up Service
 *
 * Manages localStorage persistence for first-login-of-the-day detection.
 * The actual catch-up content is now built directly into the greeting
 * via buildDailyLogisticsSection in dailyCatchupBuilder.ts.
 *
 * Used by:
 * - geminiChatService.generateGreeting() to check/mark briefing state
 */

// ============================================================================
// CONSTANTS
// ============================================================================

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
// TYPE RE-EXPORTS
// ============================================================================

export type { DailyLogisticsContext } from './system_prompts/builders/dailyCatchupBuilder';
