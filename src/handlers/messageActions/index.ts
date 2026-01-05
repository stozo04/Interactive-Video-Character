/**
 * Message Action Handlers
 *
 * Consolidated exports for all message action handlers.
 * These process various action types from AI responses.
 *
 * Extracted from App.tsx as part of Phase 5 refactoring.
 */

// Calendar actions
export {
  processCalendarAction,
  parseCalendarTagFromResponse,
  processCalendarTag,
  type CalendarAction,
  type CalendarActionContext,
  type CalendarActionResult,
  type CalendarTagParseResult,
} from './calendarActions';

// Task actions
export {
  processTaskAction,
  parseTaskActionFromResponse,
  detectTaskCompletionFallback,
  type TaskAction,
  type TaskActionHandlers,
  type TaskActionResult,
} from './taskActions';

// News actions
export {
  processNewsAction,
  formatNewsForAI,
  type NewsAction,
  type NewsActionResult,
} from './newsActions';

// Selfie actions
export {
  processSelfieAction,
  type SelfieAction,
  type SelfieActionContext,
  type SelfieActionResult,
} from './selfieActions';
