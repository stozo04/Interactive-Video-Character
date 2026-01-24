/**
 * Greeting Module Tests
 *
 * Tests for all greeting-specific prompt builders:
 * - timezoneUtils (CST conversion)
 * - timeOfDay (Early/Normal/Late detection)
 * - holidayContext (Holiday detection + follow-up)
 * - lastInteraction (Days since last conversation)
 * - importantDates (Birthday/anniversary detection)
 * - pastEventsContext (Calendar events since last interaction)
 * - checkInGuidance (Bidirectional check-in + websearch)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ============================================
// TIMEZONE UTILS TESTS
// ============================================
import {
  utcToCst,
  getCurrentCstDate,
  getCurrentCstHour,
  getTodayCst,
  formatDateCst,
} from "../timezoneUtils";

describe("timezoneUtils", () => {
  describe("utcToCst", () => {
    it("should convert UTC Date to CST Date object", () => {
      const utcDate = new Date("2025-01-15T12:00:00.000Z");
      const cstDate = utcToCst(utcDate);
      expect(cstDate).toBeInstanceOf(Date);
    });

    it("should handle string input", () => {
      const cstDate = utcToCst("2025-01-15T18:00:00.000Z");
      expect(cstDate).toBeInstanceOf(Date);
    });

    it("should handle date-only strings", () => {
      const cstDate = utcToCst("2025-01-15");
      expect(cstDate).toBeInstanceOf(Date);
    });

    it("should produce a valid date", () => {
      const cstDate = utcToCst("2025-07-04T12:00:00.000Z");
      expect(cstDate.getFullYear()).toBe(2025);
      expect(cstDate.getMonth()).toBe(6); // July is 6 (0-indexed)
    });
  });

  describe("getCurrentCstDate", () => {
    it("should return a Date object", () => {
      const now = getCurrentCstDate();
      expect(now).toBeInstanceOf(Date);
    });
  });

  describe("getCurrentCstHour", () => {
    it("should return hour between 0 and 23", () => {
      const hour = getCurrentCstHour();
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
    });
  });

  describe("getTodayCst", () => {
    it("should return year, month, day object", () => {
      const today = getTodayCst();
      expect(today).toHaveProperty("year");
      expect(today).toHaveProperty("month");
      expect(today).toHaveProperty("day");
      expect(today.month).toBeGreaterThanOrEqual(1);
      expect(today.month).toBeLessThanOrEqual(12);
      expect(today.day).toBeGreaterThanOrEqual(1);
      expect(today.day).toBeLessThanOrEqual(31);
    });
  });

  describe("formatDateCst", () => {
    it("should format date as readable string with month and day", () => {
      const formatted = formatDateCst("2025-01-15T12:00:00.000Z");
      expect(formatted).toContain("Jan");
      expect(formatted).toContain("15");
    });

    it("should handle Date object", () => {
      const formatted = formatDateCst(new Date("2025-07-04T12:00:00.000Z"));
      expect(formatted).toContain("Jul");
    });

    it("should include weekday", () => {
      const formatted = formatDateCst("2025-01-15T12:00:00.000Z");
      // Jan 15, 2025 is a Wednesday
      expect(formatted).toMatch(/Wed|Thu/); // Depends on timezone
    });
  });
});

// ============================================
// TIME OF DAY TESTS
// ============================================
import {
  getTimeOfDayContext,
  buildTimeOfDayContext,
  type TimeOfDayCategory,
} from "../timeOfDay";

describe("timeOfDay", () => {
  describe("getTimeOfDayContext", () => {
    it("should return early for hours before 8am", () => {
      const context = getTimeOfDayContext(5);
      expect(context.category).toBe("early");
      expect(context.hour).toBe(5);
    });

    it("should return early for 7am", () => {
      const context = getTimeOfDayContext(7);
      expect(context.category).toBe("early");
    });

    it("should return normal for 8am", () => {
      const context = getTimeOfDayContext(8);
      expect(context.category).toBe("normal");
    });

    it("should return normal for 10am", () => {
      const context = getTimeOfDayContext(10);
      expect(context.category).toBe("normal");
    });

    it("should return late for 11am and after", () => {
      const context = getTimeOfDayContext(11);
      expect(context.category).toBe("late");
    });

    it("should return late for afternoon hours", () => {
      const context = getTimeOfDayContext(14);
      expect(context.category).toBe("late");
    });

    it("should return late for evening hours", () => {
      const context = getTimeOfDayContext(20);
      expect(context.category).toBe("late");
    });

    it("should use current hour when not provided", () => {
      const context = getTimeOfDayContext();
      expect(["early", "normal", "late"]).toContain(context.category);
    });

    it("should include guidance string", () => {
      const context = getTimeOfDayContext(5);
      expect(context.guidance).toContain("early");
    });
  });

  describe("buildTimeOfDayContext", () => {
    it("should return prompt with TIME OF DAY CONTEXT header", () => {
      const prompt = buildTimeOfDayContext(5);
      expect(prompt).toContain("TIME OF DAY CONTEXT");
    });

    it("should include concerned guidance for early hours", () => {
      const prompt = buildTimeOfDayContext(5);
      expect(prompt.toLowerCase()).toContain("concern");
    });

    it("should include sarcastic guidance for late hours", () => {
      const prompt = buildTimeOfDayContext(13);
      expect(prompt.toLowerCase()).toContain("sarcas");
    });

    it("should include warm guidance for normal hours", () => {
      const prompt = buildTimeOfDayContext(9);
      expect(prompt.toLowerCase()).toContain("warm");
    });

    it("should include the hour in the output", () => {
      const prompt = buildTimeOfDayContext(9);
      expect(prompt).toContain("9:00");
    });
  });
});

// ============================================
// HOLIDAY CONTEXT TESTS
// ============================================
import {
  getHolidayContext,
  getHolidayContextSync,
  buildHolidayContext,
  clearHolidaysCache,
  type Holiday,
} from "../holidayContext";

// Mock supabase for holiday tests
vi.mock("../../../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({
              data: [
                // 2025 holidays
                { id: "1", name: "New Year's Day", month: 1, day: 1, year: 2025, greeting: "Happy New Year!", follow_up_question: "How was New Year's?" },
                { id: "2", name: "Valentine's Day", month: 2, day: 14, year: 2025, greeting: "Happy Valentine's Day!", follow_up_question: "How was Valentine's Day?" },
                { id: "3", name: "Christmas Eve", month: 12, day: 24, year: 2025, greeting: "Merry Christmas Eve!", follow_up_question: "How was Christmas Eve?" },
                { id: "4", name: "Christmas", month: 12, day: 25, year: 2025, greeting: "Merry Christmas!", follow_up_question: "How was Christmas?" },
              ],
              error: null,
            })),
          })),
        })),
      })),
    })),
  },
}));

describe("holidayContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearHolidaysCache(); // Clear cache before each test
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getHolidayContext (async)", () => {
    it("should detect Christmas on Dec 25", async () => {
      vi.setSystemTime(new Date("2025-12-25T14:00:00.000Z"));
      const context = await getHolidayContext(null);
      expect(context.isHoliday).toBe(true);
      expect(context.holiday?.name).toBe("Christmas");
    });

    it("should detect New Year on Jan 1", async () => {
      vi.setSystemTime(new Date("2025-01-01T14:00:00.000Z"));
      const context = await getHolidayContext(null);
      expect(context.isHoliday).toBe(true);
      expect(context.holiday?.name).toBe("New Year's Day");
    });

    it("should detect Valentine's Day on Feb 14", async () => {
      vi.setSystemTime(new Date("2025-02-14T14:00:00.000Z"));
      const context = await getHolidayContext(null);
      expect(context.isHoliday).toBe(true);
      expect(context.holiday?.name).toBe("Valentine's Day");
    });

    it("should detect upcoming holiday within 3 days", async () => {
      vi.setSystemTime(new Date("2025-12-23T14:00:00.000Z")); // 2 days before Christmas
      const context = await getHolidayContext(null);
      expect(context.isNearHoliday).toBe(true);
      expect(context.nearbyHoliday?.name).toBe("Christmas Eve");
      expect(context.daysUntil).toBe(1);
    });

    it("should detect passed holidays since last interaction", async () => {
      vi.setSystemTime(new Date("2025-12-27T14:00:00.000Z"));
      // Last interaction was before Christmas
      const lastInteraction = "2025-12-23T14:00:00.000Z";
      const context = await getHolidayContext(lastInteraction);
      expect(context.passedHolidays.length).toBeGreaterThan(0);
      expect(context.passedHolidays.some(h => h.holiday.name === "Christmas")).toBe(true);
    });

    it("should return not holiday on regular days", async () => {
      vi.setSystemTime(new Date("2025-03-15T14:00:00.000Z")); // Random mid-March day
      const context = await getHolidayContext(null);
      expect(context.isHoliday).toBe(false);
    });

    it("should always have passedHolidays array", async () => {
      vi.setSystemTime(new Date("2025-03-15T14:00:00.000Z"));
      const context = await getHolidayContext(null);
      expect(Array.isArray(context.passedHolidays)).toBe(true);
    });
  });

  describe("buildHolidayContext (async)", () => {
    it("should return empty string when no holidays nearby", async () => {
      // Use a date far from any holidays (mid-August)
      vi.setSystemTime(new Date("2025-08-15T14:00:00.000Z"));
      const prompt = await buildHolidayContext(null);
      expect(prompt).toBe("");
    });

    it("should mention today's holiday", async () => {
      vi.setSystemTime(new Date("2025-12-25T14:00:00.000Z"));
      const prompt = await buildHolidayContext(null);
      expect(prompt).toContain("Christmas");
      expect(prompt).toContain("HOLIDAY CONTEXT");
    });

    it("should include follow-up for passed holidays", async () => {
      vi.setSystemTime(new Date("2025-12-27T14:00:00.000Z"));
      const prompt = await buildHolidayContext("2025-12-23T14:00:00.000Z");
      expect(prompt).toContain("HOLIDAY FOLLOW-UP");
    });
  });
});

// ============================================
// LAST INTERACTION TESTS
// ============================================
import {
  calculateDaysSince,
  getLastInteractionContext,
  buildLastInteractionContext,
} from "../lastInteraction";

describe("lastInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("calculateDaysSince", () => {
    it("should return 0 for today", () => {
      const days = calculateDaysSince("2025-01-15T10:00:00.000Z");
      expect(days).toBe(0);
    });

    it("should return 1 for yesterday", () => {
      const days = calculateDaysSince("2025-01-14T14:00:00.000Z");
      expect(days).toBe(1);
    });

    it("should return correct days for week ago", () => {
      const days = calculateDaysSince("2025-01-08T14:00:00.000Z");
      expect(days).toBe(7);
    });

    it("should return 999 for null input (treat as very long absence)", () => {
      const days = calculateDaysSince(null);
      expect(days).toBe(999);
    });

    it("should handle Date object input", () => {
      const days = calculateDaysSince(new Date("2025-01-10T14:00:00.000Z"));
      expect(days).toBe(5);
    });
  });

  describe("getLastInteractionContext", () => {
    it("should return short category for 1-3 days", () => {
      const context = getLastInteractionContext("2025-01-13T14:00:00.000Z"); // 2 days ago
      expect(context.category).toBe("short");
      expect(context.daysSince).toBe(2);
    });

    it("should return medium category for 4-7 days", () => {
      const context = getLastInteractionContext("2025-01-10T14:00:00.000Z"); // 5 days ago
      expect(context.category).toBe("medium");
    });

    it("should return long category for >7 days", () => {
      const context = getLastInteractionContext("2025-01-01T14:00:00.000Z"); // 14 days ago
      expect(context.category).toBe("long");
    });

    it("should return long category for null (999 days)", () => {
      const context = getLastInteractionContext(null);
      expect(context.category).toBe("long");
      expect(context.daysSince).toBe(999);
    });

    it("should include guidance string", () => {
      const context = getLastInteractionContext("2025-01-13T14:00:00.000Z");
      expect(context.guidance).toBeTruthy();
    });
  });

  describe("buildLastInteractionContext", () => {
    it("should include LAST INTERACTION CONTEXT header", () => {
      const prompt = buildLastInteractionContext("2025-01-13T14:00:00.000Z");
      expect(prompt).toContain("LAST INTERACTION CONTEXT");
    });

    it("should mention days since last conversation", () => {
      const prompt = buildLastInteractionContext("2025-01-13T14:00:00.000Z");
      expect(prompt).toContain("2");
    });

    it("should show Unknown for null date", () => {
      const prompt = buildLastInteractionContext(null);
      expect(prompt).toContain("Unknown");
    });
  });
});

// ============================================
// IMPORTANT DATES TESTS
// ============================================
import {
  parseMonthDay,
  processImportantDates,
  buildImportantDatesContext,
  type ImportantDatesContext,
} from "../importantDates";

describe("importantDates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-07-01T14:00:00.000Z")); // July 1st
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("parseMonthDay", () => {
    it("should parse 'July 4th' format", () => {
      const result = parseMonthDay("July 4th");
      expect(result).toEqual({ month: 7, day: 4 });
    });

    it("should parse 'December 25' format", () => {
      const result = parseMonthDay("December 25");
      expect(result).toEqual({ month: 12, day: 25 });
    });

    it("should parse '01-15' format (dash)", () => {
      const result = parseMonthDay("01-15");
      expect(result).toEqual({ month: 1, day: 15 });
    });

    it("should parse '7-4' format (dash)", () => {
      const result = parseMonthDay("7-4");
      expect(result).toEqual({ month: 7, day: 4 });
    });

    it("should parse YYYY-MM-DD format", () => {
      const result = parseMonthDay("2025-07-04");
      expect(result).toEqual({ month: 7, day: 4 });
    });

    it("should return null for invalid format", () => {
      const result = parseMonthDay("invalid date");
      expect(result).toBeNull();
    });

    it("should handle lowercase month names", () => {
      const result = parseMonthDay("january 1st");
      expect(result).toEqual({ month: 1, day: 1 });
    });

    it("should return null for slash format (not supported)", () => {
      // Only MM-DD dash format is supported, not MM/DD slash
      const result = parseMonthDay("01/15");
      expect(result).toBeNull();
    });
  });

  describe("processImportantDates", () => {
    const mockDateFacts = [
      { id: "1", fact_text: "July 1st", category: "birthday" },
      { id: "2", fact_text: "July 4th", category: "anniversary" },
      { id: "3", fact_text: "June 28th", category: "birthday" },
      { id: "4", fact_text: "December 25th", category: "birthday" },
    ];

    it("should identify today's dates", () => {
      const context = processImportantDates(mockDateFacts, null);
      expect(context.todayDates.length).toBe(1);
      expect(context.todayDates[0].category).toBe("birthday");
    });

    it("should identify upcoming dates within 7 days", () => {
      const context = processImportantDates(mockDateFacts, null);
      expect(context.upcomingDates.some(d => d.date === "July 4th")).toBe(true);
    });

    it("should identify passed dates since last interaction", () => {
      // Last interaction was June 25th, June 28th birthday should be passed
      const context = processImportantDates(mockDateFacts, "2025-06-25T14:00:00.000Z");
      expect(context.passedDates.some(d => d.date === "June 28th")).toBe(true);
    });

    it("should return empty arrays for no date facts", () => {
      const context = processImportantDates([], null);
      expect(context.todayDates).toEqual([]);
      expect(context.upcomingDates).toEqual([]);
      expect(context.passedDates).toEqual([]);
    });

    it("should skip unparseable dates", () => {
      const invalidFacts = [
        { id: "1", fact_text: "some random text", category: "birthday" },
      ];
      const context = processImportantDates(invalidFacts, null);
      expect(context.todayDates).toEqual([]);
      expect(context.upcomingDates).toEqual([]);
      expect(context.passedDates).toEqual([]);
    });
  });

  describe("buildImportantDatesContext", () => {
    it("should return empty string for no dates", () => {
      const context: ImportantDatesContext = {
        todayDates: [],
        upcomingDates: [],
        passedDates: [],
      };
      const prompt = buildImportantDatesContext(context);
      expect(prompt).toBe("");
    });

    it("should mention today's special date", () => {
      const context: ImportantDatesContext = {
        todayDates: [{
          id: "1",
          label: "birthday: July 1st",
          category: "birthday",
          date: "July 1st",
          parsedMonth: 7,
          parsedDay: 1,
          daysUntil: 0,
          isToday: true,
          isPassed: false,
        }],
        upcomingDates: [],
        passedDates: [],
      };
      const prompt = buildImportantDatesContext(context);
      expect(prompt).toContain("TODAY IS SPECIAL");
      expect(prompt).toContain("birthday");
    });

    it("should mention upcoming dates", () => {
      const context: ImportantDatesContext = {
        todayDates: [],
        upcomingDates: [{
          id: "2",
          label: "anniversary: July 4th",
          category: "anniversary",
          date: "July 4th",
          parsedMonth: 7,
          parsedDay: 4,
          daysUntil: 3,
          isToday: false,
          isPassed: false,
        }],
        passedDates: [],
      };
      const prompt = buildImportantDatesContext(context);
      expect(prompt).toContain("UPCOMING");
      expect(prompt).toContain("anniversary");
    });

    it("should include follow-up for passed dates", () => {
      const context: ImportantDatesContext = {
        todayDates: [],
        upcomingDates: [],
        passedDates: [{
          id: "3",
          label: "birthday: June 28th",
          category: "birthday",
          date: "June 28th",
          parsedMonth: 6,
          parsedDay: 28,
          daysUntil: 368,
          isToday: false,
          isPassed: true,
          daysSincePassed: 3,
        }],
      };
      const prompt = buildImportantDatesContext(context);
      expect(prompt).toContain("MISSED IMPORTANT DATES");
      expect(prompt).toContain("birthday");
    });
  });
});

// ============================================
// PAST EVENTS CONTEXT TESTS
// ============================================
import {
  filterPastEventsSinceLastInteraction,
  buildPastEventsContext,
  type PastEvent,
} from "../pastEventsContext";

describe("pastEventsContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("filterPastEventsSinceLastInteraction", () => {
    const mockEvents = [
      { id: "1", summary: "Team Meeting", start: { dateTime: "2025-01-14T10:00:00.000Z" } },
      { id: "2", summary: "Doctor Appointment", start: { dateTime: "2025-01-13T15:00:00.000Z" } },
      { id: "3", summary: "Future Event", start: { dateTime: "2025-01-20T10:00:00.000Z" } },
      { id: "4", summary: "Old Event", start: { dateTime: "2025-01-05T10:00:00.000Z" } },
    ];

    it("should return events between last interaction and now", () => {
      // Last interaction was Jan 12
      const result = filterPastEventsSinceLastInteraction(mockEvents, "2025-01-12T14:00:00.000Z");
      expect(result.length).toBe(2);
      expect(result.some(e => e.summary === "Team Meeting")).toBe(true);
      expect(result.some(e => e.summary === "Doctor Appointment")).toBe(true);
    });

    it("should not include future events", () => {
      const result = filterPastEventsSinceLastInteraction(mockEvents, "2025-01-12T14:00:00.000Z");
      expect(result.some(e => e.summary === "Future Event")).toBe(false);
    });

    it("should not include events before last interaction", () => {
      const result = filterPastEventsSinceLastInteraction(mockEvents, "2025-01-12T14:00:00.000Z");
      expect(result.some(e => e.summary === "Old Event")).toBe(false);
    });

    it("should return empty array for null last interaction", () => {
      const result = filterPastEventsSinceLastInteraction(mockEvents, null);
      expect(result).toEqual([]);
    });

    it("should return empty array for empty events", () => {
      const result = filterPastEventsSinceLastInteraction([], "2025-01-12T14:00:00.000Z");
      expect(result).toEqual([]);
    });

    it("should sort by most recent first", () => {
      const result = filterPastEventsSinceLastInteraction(mockEvents, "2025-01-12T14:00:00.000Z");
      if (result.length >= 2) {
        expect(result[0].summary).toBe("Team Meeting"); // Jan 14 is more recent than Jan 13
      }
    });

    it("should handle date-only events", () => {
      const dateOnlyEvents = [
        { id: "5", summary: "All Day Event", start: { date: "2025-01-13" } },
      ];
      const result = filterPastEventsSinceLastInteraction(dateOnlyEvents, "2025-01-12T14:00:00.000Z");
      expect(result.length).toBe(1);
    });
  });

  describe("buildPastEventsContext", () => {
    it("should return empty string for no events", () => {
      const prompt = buildPastEventsContext([], null);
      expect(prompt).toBe("");
    });

    it("should mention event summaries", () => {
      const pastEvents: PastEvent[] = [
        { id: "1", summary: "Job Interview", date: new Date("2025-01-14"), daysSince: 1 },
      ];
      const prompt = buildPastEventsContext(pastEvents, "2025-01-12T14:00:00.000Z");
      expect(prompt).toContain("Job Interview");
    });

    it("should include CALENDAR EVENTS header", () => {
      const pastEvents: PastEvent[] = [
        { id: "1", summary: "Doctor Visit", date: new Date("2025-01-13"), daysSince: 2 },
      ];
      const prompt = buildPastEventsContext(pastEvents, "2025-01-10T14:00:00.000Z");
      expect(prompt).toContain("CALENDAR EVENTS");
    });

    it("should limit to 3 events", () => {
      const manyEvents: PastEvent[] = [
        { id: "1", summary: "Event 1", date: new Date("2025-01-14"), daysSince: 1 },
        { id: "2", summary: "Event 2", date: new Date("2025-01-13"), daysSince: 2 },
        { id: "3", summary: "Event 3", date: new Date("2025-01-12"), daysSince: 3 },
        { id: "4", summary: "Event 4", date: new Date("2025-01-11"), daysSince: 4 },
        { id: "5", summary: "Event 5", date: new Date("2025-01-10"), daysSince: 5 },
      ];
      const prompt = buildPastEventsContext(manyEvents, "2025-01-05T14:00:00.000Z");
      // Should only mention first 3
      expect(prompt).toContain("Event 1");
      expect(prompt).toContain("Event 2");
      expect(prompt).toContain("Event 3");
      expect(prompt).not.toContain("Event 4");
    });

    it("should show relative time (yesterday, X days ago)", () => {
      const pastEvents: PastEvent[] = [
        { id: "1", summary: "Yesterday Event", date: new Date("2025-01-14"), daysSince: 1 },
        { id: "2", summary: "Old Event", date: new Date("2025-01-10"), daysSince: 5 },
      ];
      const prompt = buildPastEventsContext(pastEvents, "2025-01-08T14:00:00.000Z");
      expect(prompt).toContain("yesterday");
      expect(prompt).toContain("5 days ago");
    });
  });
});

// ============================================
// CHECK-IN GUIDANCE TESTS
// ============================================
import {
  buildCheckInGuidance,
  buildWebsearchGuidance,
  type KayleyLifeUpdate,
} from "../checkInGuidance";

describe("checkInGuidance", () => {
  describe("buildCheckInGuidance", () => {
    it("should return bidirectional check-in guidance header", () => {
      const prompt = buildCheckInGuidance();
      expect(prompt).toContain("BIDIRECTIONAL CHECK-IN");
    });

    it("should mention sharing and asking", () => {
      const prompt = buildCheckInGuidance();
      expect(prompt).toContain("SHARE YOUR LIFE");
      expect(prompt).toContain("ASK ABOUT THEM");
    });

    it("should include Kayley life updates when provided", () => {
      const updates: KayleyLifeUpdate[] = [
        {
          storylineTitle: "New Project",
          latestUpdate: "Started working on a video edit",
          updatedAt: new Date(),
        },
      ];
      const prompt = buildCheckInGuidance(updates);
      expect(prompt).toContain("New Project");
      expect(prompt).toContain("Started working on a video edit");
    });

    it("should handle empty updates array", () => {
      const prompt = buildCheckInGuidance([]);
      expect(prompt).toContain("No major life updates");
    });

    it("should handle undefined updates", () => {
      const prompt = buildCheckInGuidance(undefined);
      expect(prompt).toContain("No major life updates");
    });
  });

  describe("buildWebsearchGuidance", () => {
    it("should return empty for very recent interaction (0 days)", () => {
      const prompt = buildWebsearchGuidance(0);
      expect(prompt).toBe("");
    });

    it("should include guidance for 1+ day absence", () => {
      const prompt = buildWebsearchGuidance(1);
      expect(prompt).toContain("MAJOR NEWS AWARENESS");
    });

    it("should mention web search capability", () => {
      const prompt = buildWebsearchGuidance(5);
      expect(prompt).toContain("search");
    });

    it("should set high threshold for what to mention", () => {
      const prompt = buildWebsearchGuidance(10);
      expect(prompt).toContain("THRESHOLD");
    });
  });
});
