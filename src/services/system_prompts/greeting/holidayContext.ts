/**
 * Holiday Context for Greeting Prompt
 *
 * Checks if today is a major holiday, if one is upcoming, or if one passed
 * since the last interaction (for follow-up questions).
 *
 * Holidays are stored in the database (holidays table) and should be
 * updated annually for variable holidays like Easter, Thanksgiving, etc.
 */

import { supabase } from "../../supabaseClient";
import { getTodayCst, utcToCst } from "./timezoneUtils";

export interface Holiday {
  id: string;
  name: string;
  month: number; // 1-12
  day: number;
  year: number;
  greeting: string | null;
  followUpQuestion: string | null;
}

export interface HolidayContext {
  isHoliday: boolean;
  holiday?: Holiday;
  isNearHoliday: boolean;
  nearbyHoliday?: Holiday;
  daysUntil?: number;
  passedHolidays: Array<{ holiday: Holiday; daysSince: number }>;
}

// Cache holidays for 1 hour to avoid repeated DB calls
let holidaysCache: Holiday[] | null = null;
let holidaysCacheTime: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch holidays from database for current and next year
 * Caches results for 1 hour
 */
export async function fetchHolidays(): Promise<Holiday[]> {
  const now = Date.now();

  // Return cached if still valid
  if (holidaysCache && now - holidaysCacheTime < CACHE_TTL_MS) {
    return holidaysCache;
  }

  const { year } = getTodayCst();

  // Fetch holidays for current year and next year
  const { data, error } = await supabase
    .from("holidays")
    .select("id, name, month, day, year, greeting, follow_up_question")
    .in("year", [year, year + 1])
    .order("month")
    .order("day");

  if (error) {
    console.error("[HolidayContext] Error fetching holidays:", error);
    return holidaysCache || []; // Return stale cache or empty
  }

  // Map DB fields to interface
  holidaysCache = (data || []).map((h) => ({
    id: h.id,
    name: h.name,
    month: h.month,
    day: h.day,
    year: h.year,
    greeting: h.greeting,
    followUpQuestion: h.follow_up_question,
  }));
  holidaysCacheTime = now;

  console.log(`[HolidayContext] Loaded ${holidaysCache.length} holidays from DB`);
  return holidaysCache;
}

/**
 * Clear the holidays cache (useful for testing or after DB updates)
 */
export function clearHolidaysCache(): void {
  holidaysCache = null;
  holidaysCacheTime = 0;
}

/**
 * Check if today is a holiday, one is upcoming, or one passed since last interaction
 */
export async function getHolidayContext(
  lastInteractionDateUtc?: Date | string | null
): Promise<HolidayContext> {
  const { year, month, day } = getTodayCst();
  const today = new Date(year, month - 1, day);

  const lastInteraction = lastInteractionDateUtc
    ? utcToCst(lastInteractionDateUtc)
    : null;

  const result: HolidayContext = {
    isHoliday: false,
    isNearHoliday: false,
    passedHolidays: [],
  };

  // Fetch holidays from database
  const holidays = await fetchHolidays();

  if (holidays.length === 0) {
    console.warn("[HolidayContext] No holidays found in database");
    return result;
  }

  // Filter to current year's holidays
  const currentYearHolidays = holidays.filter((h) => h.year === year);

  // Check for exact holiday match (today)
  const todayHoliday = currentYearHolidays.find(
    (h) => h.month === month && h.day === day
  );

  if (todayHoliday) {
    result.isHoliday = true;
    result.holiday = todayHoliday;
  }

  // Check for upcoming holidays within 3 days
  for (const holiday of currentYearHolidays) {
    const holidayDate = new Date(year, holiday.month - 1, holiday.day);

    // Skip past holidays
    if (holidayDate <= today) continue;

    const diffTime = holidayDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0 && diffDays <= 3) {
      result.isNearHoliday = true;
      result.nearbyHoliday = holiday;
      result.daysUntil = diffDays;
      break; // Only report one upcoming holiday
    }
  }

  // Check for holidays that passed since last interaction (for follow-up)
  if (lastInteraction) {
    for (const holiday of currentYearHolidays) {
      const holidayDate = new Date(year, holiday.month - 1, holiday.day);

      // Holiday must be: after last interaction AND before today
      if (holidayDate < today && holidayDate > lastInteraction) {
        const daysSince = Math.floor(
          (today.getTime() - holidayDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Only include if within the last 7 days
        if (daysSince <= 7) {
          result.passedHolidays.push({ holiday, daysSince });
        }
      }
    }

    // Sort by most recent first
    result.passedHolidays.sort((a, b) => a.daysSince - b.daysSince);
  }

  return result;
}

/**
 * Synchronous version using cached data only (for backward compatibility)
 * Falls back to empty context if cache is not populated
 */
export function getHolidayContextSync(
  lastInteractionDateUtc?: Date | string | null
): HolidayContext {
  const { year, month, day } = getTodayCst();
  const today = new Date(year, month - 1, day);

  const lastInteraction = lastInteractionDateUtc
    ? utcToCst(lastInteractionDateUtc)
    : null;

  const result: HolidayContext = {
    isHoliday: false,
    isNearHoliday: false,
    passedHolidays: [],
  };

  // Use cached holidays only
  if (!holidaysCache || holidaysCache.length === 0) {
    return result;
  }

  const currentYearHolidays = holidaysCache.filter((h) => h.year === year);

  // Check for exact holiday match (today)
  const todayHoliday = currentYearHolidays.find(
    (h) => h.month === month && h.day === day
  );

  if (todayHoliday) {
    result.isHoliday = true;
    result.holiday = todayHoliday;
  }

  // Check for upcoming holidays within 3 days
  for (const holiday of currentYearHolidays) {
    const holidayDate = new Date(year, holiday.month - 1, holiday.day);

    if (holidayDate <= today) continue;

    const diffTime = holidayDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0 && diffDays <= 3) {
      result.isNearHoliday = true;
      result.nearbyHoliday = holiday;
      result.daysUntil = diffDays;
      break;
    }
  }

  // Check for passed holidays
  if (lastInteraction) {
    for (const holiday of currentYearHolidays) {
      const holidayDate = new Date(year, holiday.month - 1, holiday.day);

      if (holidayDate < today && holidayDate > lastInteraction) {
        const daysSince = Math.floor(
          (today.getTime() - holidayDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSince <= 7) {
          result.passedHolidays.push({ holiday, daysSince });
        }
      }
    }

    result.passedHolidays.sort((a, b) => a.daysSince - b.daysSince);
  }

  return result;
}

/**
 * Build the holiday section for the greeting prompt
 */
export async function buildHolidayContext(
  lastInteractionDateUtc?: Date | string | null
): Promise<string> {
  const context = await getHolidayContext(lastInteractionDateUtc);

  let prompt = "";

  // Today is a holiday
  if (context.isHoliday && context.holiday) {
    prompt += `
====================================================
HOLIDAY CONTEXT
====================================================
Today is ${context.holiday.name}!
${context.holiday.greeting ? `Suggested greeting: "${context.holiday.greeting}"` : ""}
Acknowledge the holiday naturally in your greeting.
`;
  }

  // Upcoming holiday
  if (context.isNearHoliday && context.nearbyHoliday && !context.isHoliday) {
    const dayWord =
      context.daysUntil === 1 ? "tomorrow" : `in ${context.daysUntil} days`;
    prompt += `
====================================================
UPCOMING HOLIDAY CONTEXT
====================================================
${context.nearbyHoliday.name} is ${dayWord}.
You can mention excitement about the upcoming holiday if it feels natural.
`;
  }

  // Holidays that passed since last interaction (follow-up)
  if (context.passedHolidays.length > 0) {
    prompt += `
====================================================
HOLIDAY FOLLOW-UP
====================================================
These holidays happened since you last talked:
`;
    for (const { holiday, daysSince } of context.passedHolidays.slice(0, 2)) {
      const dayWord =
        daysSince === 1 ? "yesterday" : `${daysSince} days ago`;
      prompt += `- ${holiday.name} was ${dayWord}
  Follow-up: "${holiday.followUpQuestion || `How was ${holiday.name}?`}"
`;
    }
    prompt += `
Ask how it went! Show genuine interest.
`;
  }

  return prompt;
}
