/**
 * Timezone Utilities for Greeting Prompt
 *
 * All dates in Supabase are stored as UTC.
 * Locally, we need to work in CST (Central Standard Time).
 */

const CST_TIMEZONE = "America/Chicago";

/**
 * Convert a UTC date from the database to CST
 */
export function utcToCst(utcDate: Date | string): Date {
  const date = typeof utcDate === "string" ? new Date(utcDate) : utcDate;

  // Create a formatter that outputs in CST
  const cstString = date.toLocaleString("en-US", { timeZone: CST_TIMEZONE });
  return new Date(cstString);
}

/**
 * Get current time in CST
 */
export function getCurrentCstDate(): Date {
  const now = new Date();
  const cstString = now.toLocaleString("en-US", { timeZone: CST_TIMEZONE });
  return new Date(cstString);
}

/**
 * Get current hour in CST (0-23)
 */
export function getCurrentCstHour(): number {
  const now = new Date();
  return parseInt(
    now.toLocaleString("en-US", { timeZone: CST_TIMEZONE, hour: "numeric", hour12: false }),
    10
  );
}

/**
 * Get today's date in CST (year, month, day only - no time)
 */
export function getTodayCst(): { year: number; month: number; day: number } {
  const now = new Date();
  const cstDate = new Date(now.toLocaleString("en-US", { timeZone: CST_TIMEZONE }));
  return {
    year: cstDate.getFullYear(),
    month: cstDate.getMonth() + 1, // 1-indexed
    day: cstDate.getDate(),
  };
}

/**
 * Format a date for display in CST
 */
export function formatDateCst(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    timeZone: CST_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
