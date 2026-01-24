/**
 * Last Interaction Context for Greeting Prompt
 *
 * Determines how long since the last conversation and adjusts greeting warmth.
 * NOTE: This is for GREETING prompts only - the first message of a new session.
 * Minimum is 1 day since greeting implies a new session.
 *
 * Categories:
 * - 1-3 days: "Haven't talked in a bit"
 * - 4-7 days: "It's been a minute!"
 * - >1 week: "I've missed you!"
 */

import { utcToCst, getCurrentCstDate, formatDateCst } from "./timezoneUtils";

export type AbsenceCategory = "short" | "medium" | "long";

export interface LastInteractionContext {
  category: AbsenceCategory;
  daysSince: number;
  lastInteractionDate: Date | null;
  guidance: string;
}

/**
 * Calculate days since last interaction
 * Converts UTC database date to CST for comparison
 */
export function calculateDaysSince(
  lastInteractionDateUtc: Date | string | null
): number {
  if (!lastInteractionDateUtc) {
    return 999; // Treat as very long absence
  }

  const lastDate = utcToCst(lastInteractionDateUtc);
  const now = getCurrentCstDate();

  const diffMs = now.getTime() - lastDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get the last interaction context and guidance
 * For greeting prompts only (new session, so minimum 1 day absence)
 */
export function getLastInteractionContext(
  lastInteractionDateUtc: Date | string | null
): LastInteractionContext {
  const daysSince = calculateDaysSince(lastInteractionDateUtc);
  const lastInteractionDate = lastInteractionDateUtc
    ? utcToCst(lastInteractionDateUtc)
    : null;

  if (daysSince <= 3) {
    return {
      category: "short",
      daysSince,
      lastInteractionDate,
      guidance: `It's been ${daysSince} day${daysSince > 1 ? "s" : ""} since you talked. Acknowledge the small gap.
Examples: "Hey! Haven't talked in a bit" or "How've you been the last couple days?"
Tone: Warm, slightly curious about what they've been up to.`,
    };
  } else if (daysSince <= 7) {
    return {
      category: "medium",
      daysSince,
      lastInteractionDate,
      guidance: `It's been ${daysSince} days since you last talked. Show you noticed.
Examples: "It's been a minute!" or "Where have you been hiding?"
Tone: Playfully missing them, curious, happy they're back.`,
    };
  } else {
    return {
      category: "long",
      daysSince,
      lastInteractionDate,
      guidance: `It's been over a week (${daysSince} days) since you talked. Express genuine warmth.
Examples: "I've missed you!" or "It's so good to hear from you!"
Tone: Warm, genuinely happy to reconnect, ask what's been going on.`,
    };
  }
}

/**
 * Build the last interaction section for the greeting prompt
 */
export function buildLastInteractionContext(
  lastInteractionDateUtc: Date | string | null
): string {
  const context = getLastInteractionContext(lastInteractionDateUtc);

  const lastDateStr = context.lastInteractionDate
    ? formatDateCst(context.lastInteractionDate)
    : "Unknown";

  return `
====================================================
LAST INTERACTION CONTEXT
====================================================
Days since last conversation: ${context.daysSince === 999 ? "Unknown (first time?)" : context.daysSince}
Last talked: ${lastDateStr}
${context.guidance}
`;
}
