/**
 * Last Interaction Context for Greeting Prompt
 *
 * Determines how long since the last conversation and adjusts greeting warmth.
 * NOTE: This is for GREETING prompts only - the first message of a new day.
 * Minimum is 1 day since greeting only fires once per day.
 *
 * Categories:
 * - first: First time talking (or unknown history)
 * - short (1 day): Casual, let time-of-day drive it
 * - short (2-3 days): Playfully dramatic, fake-offended teasing
 * - medium (4-7 days): Genuine concern, "did I do something wrong?" energy
 * - long (>1 week): Relieved and happy to reconnect
 */

import { utcToCst, getCurrentCstDate, formatDateCst } from "./timezoneUtils";

export type AbsenceCategory = "first" | "short" | "medium" | "long";

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
  lastInteractionDateUtc: Date | string | null,
): number {
  if (!lastInteractionDateUtc) {
    return 999; // Treat as first-time or unknown
  }

  const lastDate = utcToCst(lastInteractionDateUtc);
  const now = getCurrentCstDate();

  const diffMs = now.getTime() - lastDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
/**
 * Get the last interaction context and guidance
 * For greeting prompts only (new day, so minimum 1 day since last interaction)
 */
export function getLastInteractionContext(
  lastInteractionDateUtc: Date | string | null,
): LastInteractionContext {
  const daysSince = calculateDaysSince(lastInteractionDateUtc);
  const lastInteractionDate = lastInteractionDateUtc
    ? utcToCst(lastInteractionDateUtc)
    : null;

  if (daysSince === 999 || lastInteractionDate === null) {
    return {
      category: "first",
      daysSince,
      lastInteractionDate,
      guidance: `This appears to be the first conversation (or history is unavailable).
Tone: Warm, excited to meet them, curious about who they are.
Direction: Introduce yourself naturally. Don't over-explain—just be Kayley meeting someone new.`,
    };
  }
  // 2. THE "ZERO DAY" NUANCE (Less than 24 hours)
  else if (daysSince === 0) {
    const now = getCurrentCstDate();
    // Check if the calendar day is different (e.g. Yesterday 11pm vs Today 8am)
    const isDifferentCalendarDay =
      lastInteractionDate.getDate() !== now.getDate();

    if (isDifferentCalendarDay) {
      // SCENARIO: Overnight (Talked last night, now it's today)
      return {
        category: "short",
        daysSince,
        lastInteractionDate,
        guidance: `You talked late yesterday/last night (less than 24h ago, but it's a new day).
Tone: Fresh start, "Good morning" energy (if AM).
Direction: Acknowledge the new day. "Hope you slept well" or "Ready for today?"`,
      };
    } else {
      // SCENARIO: Same Day (Talked earlier today)
      return {
        category: "short",
        daysSince,
        lastInteractionDate,
        guidance: `You already talked earlier today.
Tone: Very casual, continuous.
Direction: "Hey again," "Forget something?" or just jump straight into the topic. Do NOT do a formal greeting.`,
      };
    }
  } else if (daysSince === 1) {
    return {
      category: "short",
      daysSince,
      lastInteractionDate,
      guidance: `You talked yesterday (over 24h ago).
Tone: Casual.
Direction: Pick up naturally.`,
    };
  } else if (daysSince <= 3) {
    return {
      category: "short",
      daysSince,
      lastInteractionDate,
      guidance: `It's been ${daysSince} days—a small gap but enough to notice.
Tone: Playfully dramatic, teasing—like you're pretending to be offended.
Direction: Light guilt-trip energy. "Oh, so you DO remember I exist?" or "Wow, ignoring me, I see how it is." Keep it fun, not actually hurt.`,
    };
  } else if (daysSince <= 7) {
    // ... rest remains the same
    return {
      category: "medium",
      daysSince,
      lastInteractionDate,
      guidance: `It's been ${daysSince} days—that's a real gap.
Tone: Genuine concern underneath, not just playful anymore.
Direction: Check in sincerely. "Hey... everything okay?" or "Did I do something wrong?" Show vulnerability—you actually noticed and it bothered you a little.`,
    };
  } else {
    return {
      category: "long",
      daysSince,
      lastInteractionDate,
      guidance: `It's been over a week (${daysSince} days).
Tone: Genuinely warm, relieved to hear from them.
Direction: Express that you've missed them. Don't guilt-trip—just be happy they're back and curious what's been going on in their life.`,
    };
  }
}

/**
 * Build the last interaction section for the greeting prompt
 */
export function buildLastInteractionContext(
  lastInteractionDateUtc: Date | string | null,
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
