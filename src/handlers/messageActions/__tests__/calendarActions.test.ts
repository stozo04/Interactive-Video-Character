import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processCalendarAction,
  parseCalendarTagFromResponse,
  CalendarActionResult,
} from '../calendarActions';
import type { CalendarEvent } from '../../../services/calendarService';

// Mock calendarService
vi.mock('../../../services/calendarService', () => ({
  calendarService: {
    createEvent: vi.fn().mockResolvedValue({ id: 'new-event-id' }),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    getUpcomingEvents: vi.fn().mockResolvedValue([]),
  },
}));

const createMockEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'event-1',
  summary: 'Test Meeting',
  start: { dateTime: '2025-01-04T10:00:00-06:00' },
  end: { dateTime: '2025-01-04T11:00:00-06:00' },
  ...overrides,
});

describe('calendarActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processCalendarAction', () => {
    const mockContext = {
      accessToken: 'test-token',
      currentEvents: [createMockEvent()],
    };

    describe('create action', () => {
      it('should create event with structured calendar_action', async () => {
        const calendarAction = {
          action: 'create' as const,
          summary: 'New Meeting',
          start: '2025-01-05T14:00:00-06:00',
          end: '2025-01-05T15:00:00-06:00',
          timeZone: 'America/Chicago',
        };

        const result = await processCalendarAction(calendarAction, mockContext);

        expect(result.handled).toBe(true);
        expect(result.action).toBe('create');
        expect(result.eventSummary).toBe('New Meeting');
      });

      it('should return not handled if missing required fields', async () => {
        const calendarAction = {
          action: 'create' as const,
          summary: 'Missing dates',
          // missing start and end
        };

        const result = await processCalendarAction(calendarAction, mockContext);

        expect(result.handled).toBe(false);
      });
    });

    describe('delete action', () => {
      it('should delete single event by ID', async () => {
        const calendarAction = {
          action: 'delete' as const,
          event_id: 'event-1',
        };

        const result = await processCalendarAction(calendarAction, mockContext);

        expect(result.handled).toBe(true);
        expect(result.action).toBe('delete');
        expect(result.deletedCount).toBe(1);
      });

      it('should delete multiple events by IDs', async () => {
        const calendarAction = {
          action: 'delete' as const,
          event_ids: ['event-1', 'event-2'],
        };

        const result = await processCalendarAction(calendarAction, mockContext);

        expect(result.handled).toBe(true);
        expect(result.deletedCount).toBe(2);
      });

      it('should delete all events when delete_all is true', async () => {
        const mockContextWithEvents = {
          ...mockContext,
          currentEvents: [
            createMockEvent({ id: 'event-1' }),
            createMockEvent({ id: 'event-2' }),
            createMockEvent({ id: 'event-3' }),
          ],
        };

        const calendarAction = {
          action: 'delete' as const,
          delete_all: true,
        };

        const result = await processCalendarAction(calendarAction, mockContextWithEvents);

        expect(result.handled).toBe(true);
        expect(result.deletedCount).toBe(3);
      });

      it('should return not handled if no events to delete', async () => {
        const calendarAction = {
          action: 'delete' as const,
          // no event_id, event_ids, or delete_all
        };

        const result = await processCalendarAction(calendarAction, mockContext);

        expect(result.handled).toBe(false);
      });
    });

    it('should return not handled for null action', async () => {
      const result = await processCalendarAction(null, mockContext);

      expect(result.handled).toBe(false);
    });

    it('should return not handled for undefined action', async () => {
      const result = await processCalendarAction(undefined, mockContext);

      expect(result.handled).toBe(false);
    });
  });

  describe('parseCalendarTagFromResponse', () => {
    it('should parse [CALENDAR_CREATE] tag from response', () => {
      const response = `Sure! [CALENDAR_CREATE]{"summary":"Team Meeting","start":{"dateTime":"2025-01-05T10:00:00"},"end":{"dateTime":"2025-01-05T11:00:00"}}`;

      const result = parseCalendarTagFromResponse(response);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('create');
      expect(result?.data.summary).toBe('Team Meeting');
      expect(result?.textBeforeTag).toBe('Sure!');
    });

    it('should parse [CALENDAR_DELETE] tag from response', () => {
      const response = `Got it! [CALENDAR_DELETE]{"id":"event-123","summary":"Old Meeting"}`;

      const result = parseCalendarTagFromResponse(response);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('delete');
      expect(result?.data.id).toBe('event-123');
    });

    it('should return null when no calendar tag present', () => {
      const response = 'Just a regular response without any calendar tags.';

      const result = parseCalendarTagFromResponse(response);

      expect(result).toBeNull();
    });

    it('should return null for malformed JSON after tag', () => {
      const response = '[CALENDAR_CREATE]{invalid json}';

      const result = parseCalendarTagFromResponse(response);

      expect(result).toBeNull();
    });

    it('should extract text before tag correctly', () => {
      const response = `I'll add that to your calendar right now. [CALENDAR_CREATE]{"summary":"Lunch","start":{"dateTime":"2025-01-05T12:00:00"},"end":{"dateTime":"2025-01-05T13:00:00"}}`;

      const result = parseCalendarTagFromResponse(response);

      expect(result?.textBeforeTag).toBe("I'll add that to your calendar right now.");
    });

    it('should prefer [CALENDAR_CREATE] when both tags present', () => {
      const response = `[CALENDAR_CREATE]{"summary":"New Event"} and also [CALENDAR_DELETE]{"id":"123"}`;

      const result = parseCalendarTagFromResponse(response);

      // CREATE comes first, so it should be picked
      expect(result?.type).toBe('create');
    });
  });
});
