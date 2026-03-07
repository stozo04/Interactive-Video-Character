/**
 * Calendar Actions Handler
 *
 * Processes structured calendar_action objects from AI responses.
 * Uses gogcli for all Google Calendar operations (no direct API calls).
 */

import type { CalendarEvent } from '../../types';

/**
 * Structured calendar action from AI response
 */
export interface CalendarAction {
  action: 'create' | 'delete' | 'list';
  // Create fields
  summary?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  // Delete fields
  event_id?: string;
  event_ids?: string[];
  delete_all?: boolean;
}

/**
 * Context needed to process calendar actions
 */
export interface CalendarActionContext {
  currentEvents: CalendarEvent[];
}

/**
 * Result of processing a calendar action
 */
export interface CalendarActionResult {
  handled: boolean;
  action?: 'create' | 'delete';
  eventSummary?: string;
  deletedCount?: number;
  error?: string;
}

/**
 * Process a structured calendar action from AI response.
 * Note: calendar_action is now a function tool handled in memoryService.ts.
 * This handler is kept for backward compatibility with any JSON-field callers.
 */
export async function processCalendarAction(
  calendarAction: CalendarAction | null | undefined,
  context: CalendarActionContext
): Promise<CalendarActionResult> {
  if (!calendarAction || !calendarAction.action) {
    return { handled: false };
  }

  const {
    createCalendarEvent,
    deleteCalendarEvent,
  } = await import('../../../server/services/gogService');

  try {
    if (calendarAction.action === 'delete') {
      let eventIdsToDelete: string[] = [];

      if (calendarAction.delete_all) {
        eventIdsToDelete = context.currentEvents.map((e) => e.id);
      } else if (calendarAction.event_ids && calendarAction.event_ids.length > 0) {
        eventIdsToDelete = calendarAction.event_ids;
      } else if (calendarAction.event_id) {
        eventIdsToDelete = [calendarAction.event_id];
      }

      if (eventIdsToDelete.length === 0) {
        return { handled: false };
      }

      let deletedCount = 0;
      for (const eventId of eventIdsToDelete) {
        const ok = await deleteCalendarEvent(eventId);
        if (ok) deletedCount++;
      }

      return {
        handled: true,
        action: 'delete',
        deletedCount,
      };
    }

    if (calendarAction.action === 'create') {
      if (!calendarAction.summary || !calendarAction.start || !calendarAction.end) {
        console.warn('Calendar create action missing required fields');
        return { handled: false };
      }

      await createCalendarEvent({
        summary: calendarAction.summary,
        start: calendarAction.start,
        end: calendarAction.end,
        timeZone: calendarAction.timeZone || 'America/Chicago',
      });

      return {
        handled: true,
        action: 'create',
        eventSummary: calendarAction.summary,
      };
    }

    return { handled: false };
  } catch (error) {
    console.error('Failed to execute calendar_action:', error);
    return {
      handled: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
