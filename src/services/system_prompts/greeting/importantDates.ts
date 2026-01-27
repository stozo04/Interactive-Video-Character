/**
 * Important Dates Context for Greeting Prompt
 *
 * Detects important dates stored in user_facts:
 * - Today: It's their birthday/anniversary today!
 * - Upcoming: Birthday/anniversary in the next 7 days
 * - Passed: Birthday/anniversary passed since last interaction (follow-up)
 *
 * Dates are stored in user_facts with:
 * - key: date string (e.g., "07-01", "2026-07-01", "July 1st")
 * - value: description (e.g., "Steven's Birthday", "Wedding Anniversary")
 */

import { DailyLogisticsContext, ImportantDateFacts } from "../builders/dailyCatchupBuilder";
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
  dateStr: string,
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
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
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
  dateFacts: ImportantDateFacts[],
  lastInteractionDateUtc: Date | string,
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
    console.log("FACT: ", fact);
    const parsed = parseMonthDay(fact.key);
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
      : Math.ceil(
          (targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );

    // Check if it passed since last interaction
    let isPassed = false;
    let daysSincePassed: number | undefined;
    console.log("lastInteraction: ", lastInteraction);
    if (lastInteraction) {
      const thisYearOccurrence = new Date(year, month - 1, day);
      if (thisYearOccurrence < today && thisYearOccurrence > lastInteraction) {
        isPassed = true;
        daysSincePassed = Math.floor(
          (today.getTime() - thisYearOccurrence.getTime()) /
            (1000 * 60 * 60 * 24),
        );
      }
    }

    const importantDate: any = {
      label: `${fact.key}: ${fact.value}`,
      date: fact.value,
      parsedMonth: month,
      parsedDay: day,
      daysUntil,
      isToday,
      isPassed,
      daysSincePassed,
    };

    console.log("importantDate: ", importantDate);

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
  result.passedDates.sort(
    (a, b) => (a.daysSincePassed || 0) - (b.daysSincePassed || 0),
  );
  console.log("result: ", result);
  return result;
}

/**
 * Build the important dates section for the greeting prompt
 */
export function buildImportantDatesContext(
  dailyLogisticsContext: DailyLogisticsContext
): string {
  let importantDatesContext: ImportantDatesContext = {
    todayDates: [],
    upcomingDates: [],
    passedDates: [],
  };

  if (dailyLogisticsContext?.importantDateFacts) {
    importantDatesContext = processImportantDates(
      dailyLogisticsContext.importantDateFacts.map((f) => ({
        key: f.key,
        value: f.value,
      })),
      dailyLogisticsContext?.lastInteractionDateUtc
    );
  }

  if (
    importantDatesContext.todayDates.length === 0 &&
    importantDatesContext.upcomingDates.length === 0 &&
    importantDatesContext.passedDates.length === 0
  ) {
    return "";
  }

  let prompt = `
====================================================
IMPORTANT DATES CONTEXT
====================================================
`;

  // Today is special
  if (importantDatesContext.todayDates.length > 0) {
    const dateList = importantDatesContext.todayDates
      .map((date) => `- ${date.label}`)
      .join("\n");

    prompt += `TODAY IS SPECIAL:
${dateList}

Tone: Warm, celebratory—this matters to them.
Direction: Acknowledge it genuinely. Make them feel seen.

`;
  }

  // Passed dates (follow-up)
  if (importantDatesContext.passedDates.length > 0) {
    const dateList = importantDatesContext.passedDates
      .slice(0, 2)
      .map(({ label, daysSincePassed }) => {
        const dayWord =
          daysSincePassed === 1 ? "yesterday" : `${daysSincePassed} days ago`;
        return `- ${label} was ${dayWord}`;
      })
      .join("\n");

    prompt += `SINCE YOU LAST TALKED:
${dateList}

Tone: Curious, caring—you want to hear how it went.
Direction: Ask about it naturally. Show genuine interest, not just checking a box.

`;
  }

  // Upcoming
  if (importantDatesContext.upcomingDates.length > 0) {
    const dateList = importantDatesContext.upcomingDates
      .slice(0, 2)
      .map(({ label, daysUntil }) => {
        const dayWord = daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
        return `- ${label} is ${dayWord}`;
      })
      .join("\n");

    prompt += `UPCOMING:
${dateList}

Tone: Anticipatory, sweet.
Direction: Mention if it fits naturally—ask about plans or express excitement for them. Don't force it.

`;
  }

  return prompt;
}