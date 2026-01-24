/**
 * Important Dates Context for Greeting Prompt
 *
 * Detects important dates stored in user_facts:
 * - Today: It's their birthday/anniversary today!
 * - Upcoming: Birthday/anniversary in the next 7 days
 * - Passed: Birthday/anniversary passed since last interaction (follow-up)
 *
 * Dates are stored in user_facts with format: "YYYY-MM-DD" or "MM-DD" or "Month Day"
 */

import { getTodayCst, utcToCst } from "./timezoneUtils";

export interface ImportantDate {
  id: string;
  label: string;
  category: string;
  date: string; // Original date string from DB
  parsedMonth: number;
  parsedDay: number;
  daysUntil: number;
  isToday: boolean;
  isPassed: boolean;
  daysSincePassed?: number;
}

export interface ImportantDatesContext {
  todayDates: ImportantDate[];
  upcomingDates: ImportantDate[];
  passedDates: ImportantDate[];
}

/**
 * Parse a date string and extract month/day
 * Supports formats: "MM-DD", "YYYY-MM-DD", "Month Day" (e.g., "July 1st")
 */
export function parseMonthDay(
  dateStr: string
): { month: number; day: number } | null {
  // Try MM-DD format
  const mmddMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})$/);
  if (mmddMatch) {
    return {
      month: parseInt(mmddMatch[1], 10),
      day: parseInt(mmddMatch[2], 10),
    };
  }

  // Try YYYY-MM-DD format
  const isoMatch = dateStr.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return {
      month: parseInt(isoMatch[1], 10),
      day: parseInt(isoMatch[2], 10),
    };
  }

  // Try "Month Day" format (e.g., "July 1st", "July 1")
  const monthNames: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const monthDayMatch = dateStr.toLowerCase().match(/^(\w+)\s+(\d{1,2})/);
  if (monthDayMatch && monthNames[monthDayMatch[1]]) {
    return {
      month: monthNames[monthDayMatch[1]],
      day: parseInt(monthDayMatch[2], 10),
    };
  }

  return null; // Unrecognized format
}

/**
 * Process a list of date facts from user_facts and categorize them
 */
export function processImportantDates(
  dateFacts: Array<{
    id: string;
    fact_text: string;
    category: string;
    created_at?: string;
  }>,
  lastInteractionDateUtc?: Date | string | null
): ImportantDatesContext {
  const { year, month: currentMonth, day: currentDay } = getTodayCst();
  const today = new Date(year, currentMonth - 1, currentDay);

  const lastInteraction = lastInteractionDateUtc
    ? utcToCst(lastInteractionDateUtc)
    : null;

  const result: ImportantDatesContext = {
    todayDates: [],
    upcomingDates: [],
    passedDates: [],
  };

  for (const fact of dateFacts) {
    const parsed = parseMonthDay(fact.fact_text);
    if (!parsed) continue;

    const { month, day } = parsed;

    // Check if today
    const isToday = month === currentMonth && day === currentDay;

    // Calculate days until next occurrence
    let targetDate = new Date(year, month - 1, day);
    if (targetDate < today && !isToday) {
      targetDate = new Date(year + 1, month - 1, day);
    }
    const daysUntil = isToday
      ? 0
      : Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // Check if it passed since last interaction
    let isPassed = false;
    let daysSincePassed: number | undefined;

    if (lastInteraction) {
      const thisYearOccurrence = new Date(year, month - 1, day);
      if (thisYearOccurrence < today && thisYearOccurrence > lastInteraction) {
        isPassed = true;
        daysSincePassed = Math.floor(
          (today.getTime() - thisYearOccurrence.getTime()) / (1000 * 60 * 60 * 24)
        );
      }
    }

    const importantDate: ImportantDate = {
      id: fact.id,
      label: `${fact.category}: ${fact.fact_text}`,
      category: fact.category,
      date: fact.fact_text,
      parsedMonth: month,
      parsedDay: day,
      daysUntil,
      isToday,
      isPassed,
      daysSincePassed,
    };

    if (isToday) {
      result.todayDates.push(importantDate);
    } else if (isPassed && daysSincePassed && daysSincePassed <= 7) {
      result.passedDates.push(importantDate);
    } else if (daysUntil <= 7) {
      result.upcomingDates.push(importantDate);
    }
  }

  // Sort by days
  result.upcomingDates.sort((a, b) => a.daysUntil - b.daysUntil);
  result.passedDates.sort((a, b) => (a.daysSincePassed || 0) - (b.daysSincePassed || 0));

  return result;
}

/**
 * Build the important dates section for the greeting prompt
 */
export function buildImportantDatesContext(
  context: ImportantDatesContext
): string {
  const { todayDates, upcomingDates, passedDates } = context;

  if (todayDates.length === 0 && upcomingDates.length === 0 && passedDates.length === 0) {
    return ""; // No important dates to mention
  }

  let prompt = `
====================================================
IMPORTANT DATES CONTEXT
====================================================
`;

  // Today is special
  if (todayDates.length > 0) {
    prompt += `TODAY IS SPECIAL:\n`;
    for (const date of todayDates) {
      prompt += `- Today is their ${date.category}! (${date.date})\n`;
    }
    prompt += `\nAcknowledge this warmly! This is a big deal.\n\n`;
  }

  // Passed dates (follow-up)
  if (passedDates.length > 0) {
    prompt += `MISSED IMPORTANT DATES (follow up!):\n`;
    for (const date of passedDates.slice(0, 2)) {
      const dayWord =
        date.daysSincePassed === 1 ? "yesterday" : `${date.daysSincePassed} days ago`;
      prompt += `- Their ${date.category} was ${dayWord}! (${date.date})\n`;
      prompt += `  Follow-up: "How was your ${date.category.toLowerCase()}?"\n`;
    }
    prompt += `\nYou missed it! Ask how it went - show you care.\n\n`;
  }

  // Upcoming
  if (upcomingDates.length > 0) {
    prompt += `UPCOMING:\n`;
    for (const date of upcomingDates.slice(0, 2)) {
      const dayWord =
        date.daysUntil === 1 ? "tomorrow" : `in ${date.daysUntil} days`;
      prompt += `- Their ${date.category} is ${dayWord} (${date.date})\n`;
    }
    prompt += `\nYou can mention these if it feels natural.\n`;
  }

  return prompt;
}
