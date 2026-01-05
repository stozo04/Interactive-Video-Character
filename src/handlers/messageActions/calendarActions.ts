/**
 * Calendar Actions Handler
 *
 * Processes calendar-related actions from AI responses.
 * Handles both structured calendar_action objects and legacy tag-based parsing.
 *
 * Extracted from App.tsx as part of Phase 5 refactoring.
 */

import {
  calendarService,
  type CalendarEvent,
  type NewEventPayload,
} from '../../services/calendarService';
import { extractJsonObject } from '../../utils/jsonUtils';

/**
 * Structured calendar action from AI response
 */
export interface CalendarAction {
  action: 'create' | 'delete';
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
 * Result of parsing calendar tag from response text
 */
export interface CalendarTagParseResult {
  type: 'create' | 'delete';
  data: Record<string, unknown>;
  textBeforeTag: string;
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

/**
 * Parse [CALENDAR_CREATE] or [CALENDAR_DELETE] tags from response text
 *
 * This is a fallback for when the AI doesn't use the structured calendar_action field.
 */
export function parseCalendarTagFromResponse(
  textResponse: string
): CalendarTagParseResult | null {
  const createIndex = textResponse.indexOf('[CALENDAR_CREATE]');
  const deleteIndex = textResponse.indexOf('[CALENDAR_DELETE]');

  // Determine which tag appears first (if any)
  let tagIndex = -1;
  let tagType: 'create' | 'delete' | null = null;
  let tagLength = 0;

  if (createIndex !== -1 && (deleteIndex === -1 || createIndex < deleteIndex)) {
    tagIndex = createIndex;
    tagType = 'create';
    tagLength = '[CALENDAR_CREATE]'.length;
  } else if (deleteIndex !== -1) {
    tagIndex = deleteIndex;
    tagType = 'delete';
    tagLength = '[CALENDAR_DELETE]'.length;
  }

  if (tagIndex === -1 || !tagType) {
    return null;
  }

  try {
    const afterTag = textResponse.substring(tagIndex + tagLength).trim();
    const jsonString = extractJsonObject(afterTag);

    if (!jsonString) {
      console.warn(`Could not find valid JSON after [CALENDAR_${tagType.toUpperCase()}] tag`);
      return null;
    }

    const data = JSON.parse(jsonString);
    const textBeforeTag = textResponse.substring(0, tagIndex).trim();

    return {
      type: tagType,
      data,
      textBeforeTag,
    };
  } catch (error) {
    console.error(`Failed to parse [CALENDAR_${tagType?.toUpperCase()}] tag:`, error);
    return null;
  }
}

/**
 * Process a calendar tag parsed from response text
 */
export async function processCalendarTag(
  parsed: CalendarTagParseResult,
  context: CalendarActionContext
): Promise<CalendarActionResult> {
  const { accessToken, currentEvents } = context;

  try {
    if (parsed.type === 'create') {
      const eventData = parsed.data as {
        summary?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
      };

      if (!eventData.summary || !eventData.start?.dateTime || !eventData.end?.dateTime) {
        throw new Error('Missing required fields (summary, start.dateTime, end.dateTime)');
      }

      console.log('📅 Creating event from tag:', eventData);
      await calendarService.createEvent(accessToken, eventData as NewEventPayload);

      return {
        handled: true,
        action: 'create',
        eventSummary: eventData.summary,
      };
    }

    if (parsed.type === 'delete') {
      const deleteData = parsed.data as { id?: string; summary?: string };

      let eventToDelete: CalendarEvent | undefined;

      if (deleteData.id) {
        eventToDelete = currentEvents.find((e) => e.id === deleteData.id);
        if (!eventToDelete) {
          console.warn(`Event with ID "${deleteData.id}" not found, attempting API call anyway`);
        }
      } else if (deleteData.summary) {
        const searchSummary = deleteData.summary.toLowerCase();
        eventToDelete = currentEvents.find(
          (e) =>
            e.summary.toLowerCase() === searchSummary ||
            e.summary.toLowerCase().includes(searchSummary) ||
            searchSummary.includes(e.summary.toLowerCase())
        );
      }

      const eventIdToDelete = deleteData.id || eventToDelete?.id;
      const eventName = deleteData.summary || eventToDelete?.summary || 'the event';

      if (!eventIdToDelete) {
        throw new Error('No event ID available for deletion');
      }

      console.log('🗑️ Deleting event from tag:', eventIdToDelete);
      await calendarService.deleteEvent(accessToken, eventIdToDelete);

      return {
        handled: true,
        action: 'delete',
        eventSummary: eventName,
        deletedCount: 1,
      };
    }

    return { handled: false };
  } catch (error) {
    console.error('Failed to process calendar tag:', error);
    return {
      handled: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
