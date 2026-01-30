// src/services/dailyCatchupService.ts

import { StorageKey } from "@/utils/enums";

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
// STATE CHECK FUNCTIONS
// ============================================================================

/**
 * Check if the user has already been briefed today
 */
export function hasBeenBriefedToday(): boolean {
  const today = new Date().toDateString();
  console.log("today: ", today)
  const lastBriefingDate = localStorage.getItem(StorageKey.LastBriefing);
  console.log("lastBriefingDate: ", lastBriefingDate)
  return lastBriefingDate === today;
}

/**
 * Mark that the user has been briefed today
 */
export function markBriefedToday(): void {
  localStorage.setItem(StorageKey.LastBriefing, new Date().toDateString());
  console.log(`📅 [DailyCatchup] Marked briefing complete for ${StorageKey.LastBriefing}`);
}

/**
 * Clear the briefing state (useful for testing)
 */
export function clearBriefingState(): void {
  localStorage.removeItem(StorageKey.LastBriefing);
}

