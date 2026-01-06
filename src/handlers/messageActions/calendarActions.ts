/**
 * Calendar Actions Handler
 *
 * Processes structured calendar_action objects from AI responses.
 */

import {
  calendarService,
  type CalendarEvent,
  type NewEventPayload,
} from '../../services/calendarService';

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
  accessToken: string;
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
 * Process a structured calendar action from AI response
 */
export async function processCalendarAction(
  calendarAction: CalendarAction | null | undefined,
  context: CalendarActionContext
): Promise<CalendarActionResult> {
  if (!calendarAction || !calendarAction.action) {
    return { handled: false };
  }

  const { accessToken, currentEvents } = context;

  try {
    if (calendarAction.action === 'delete') {
      return await handleDeleteAction(calendarAction, accessToken, currentEvents);
    }

    if (calendarAction.action === 'create') {
      return await handleCreateAction(calendarAction, accessToken);
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

/**
 * Handle calendar delete action
 */
async function handleDeleteAction(
  action: CalendarAction,
  accessToken: string,
  currentEvents: CalendarEvent[]
): Promise<CalendarActionResult> {
  let eventIdsToDelete: string[] = [];

  if (action.delete_all) {
    console.log('🗑️ Delete ALL events requested');
    eventIdsToDelete = currentEvents.map((e) => e.id);
  } else if (action.event_ids && action.event_ids.length > 0) {
    console.log(`🗑️ Deleting ${action.event_ids.length} events`);
    eventIdsToDelete = action.event_ids;
  } else if (action.event_id) {
    console.log(`🗑️ Deleting single event: ${action.event_id}`);
    eventIdsToDelete = [action.event_id];
  }

  if (eventIdsToDelete.length === 0) {
    return { handled: false };
  }

  let deletedCount = 0;
  for (const eventId of eventIdsToDelete) {
    try {
      await calendarService.deleteEvent(accessToken, eventId);
      deletedCount++;
      console.log(`✅ Deleted event: ${eventId}`);
    } catch (deleteErr) {
      console.error(`❌ Failed to delete event ${eventId}:`, deleteErr);
    }
  }

  console.log(`✅ Successfully deleted ${deletedCount}/${eventIdsToDelete.length} events`);

  return {
    handled: true,
    action: 'delete',
    deletedCount,
  };
}

/**
 * Handle calendar create action
 */
async function handleCreateAction(
  action: CalendarAction,
  accessToken: string
): Promise<CalendarActionResult> {
  if (!action.summary || !action.start || !action.end) {
    console.warn('Calendar create action missing required fields');
    return { handled: false };
  }

  console.log(`📅 Creating event via calendar_action: ${action.summary}`);

  const eventData: NewEventPayload = {
    summary: action.summary,
    start: {
      dateTime: action.start,
      timeZone: action.timeZone || 'America/Chicago',
    },
    end: {
      dateTime: action.end,
      timeZone: action.timeZone || 'America/Chicago',
    },
  };

  await calendarService.createEvent(accessToken, eventData);
  console.log('✅ Event created successfully');

  return {
    handled: true,
    action: 'create',
    eventSummary: action.summary,
  };
}
