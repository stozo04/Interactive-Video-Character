/**
 * Greeting Prompt Module
 *
 * Barrel export for all greeting-specific prompt builders.
 * These are used in buildSystemPromptForGreeting to create a lean,
 * focused "start of day" experience.
 */

// Timezone Utilities (CST conversion)
export {
  utcToCst,
  getCurrentCstDate,
  getCurrentCstHour,
  getTodayCst,
  formatDateCst,
} from "./timezoneUtils";

// Time of Day
export {
  buildCurrentWorldContext,
  type TimeOfDayCategory,
} from "./timeOfDay";

// Holiday Awareness (database-backed)
export {
  buildHolidayContext,
  getHolidayContext,
  getHolidayContextSync,
  fetchHolidays,
  clearHolidaysCache,
  type Holiday,
  type HolidayContext,
} from "./holidayContext";

// Last Interaction
export {
  buildLastInteractionContext,
  getLastInteractionContext,
  calculateDaysSince,
  type AbsenceCategory,
  type LastInteractionContext,
} from "./lastInteraction";

// Important Dates (birthdays, anniversaries)
export {
  buildImportantDatesContext,
  processImportantDates,
  parseMonthDay,
  type ImportantDate,
  type ImportantDatesContext,
} from "./importantDates";

// Past Events (calendar follow-ups)
export {
  buildPastEventsContext,
  filterPastEventsSinceLastInteraction,
  type PastEvent,
  type PastEventsContext,
} from "./pastEventsContext";

// Check-in Guidance (bidirectional + websearch)
export {
  buildCheckInGuidance,
  buildMajorNewsPrompt,
  type KayleyLifeUpdate,
} from "./checkInGuidance";
