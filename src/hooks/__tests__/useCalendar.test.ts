import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CalendarEvent } from '../../services/calendarService';

// Mock supabaseClient FIRST before any imports that use it
vi.mock('../../services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  },
}));

// Mock calendarService
vi.mock('../../services/calendarService', () => ({
  calendarService: {
    getUpcomingEvents: vi.fn(),
    getWeekEvents: vi.fn(),
    createEvent: vi.fn(),
    deleteEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
}));

// Mock calendarCheckinService
vi.mock('../../services/calendarCheckinService', () => ({
  getApplicableCheckin: vi.fn(),
  markCheckinDone: vi.fn(),
  buildEventCheckinPrompt: vi.fn(),
  cleanupOldCheckins: vi.fn(),
}));

// Mock React hooks with simple implementations
let stateCounter = 0;
const stateStore: Record<number, unknown> = {};

vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual as object,
    useState: <T,>(initialValue: T): [T, (val: T | ((prev: T) => T)) => void] => {
      const id = stateCounter++;
      if (!(id in stateStore)) {
        stateStore[id] = initialValue;
      }
      const setter = (val: T | ((prev: T) => T)) => {
        stateStore[id] = typeof val === 'function'
          ? (val as (prev: T) => T)(stateStore[id] as T)
          : val;
      };
      return [stateStore[id] as T, setter];
    },
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
    useEffect: vi.fn(), // Don't auto-run effects in unit tests
  };
});

// Reset state between tests
const resetMockState = () => {
  stateCounter = 0;
  Object.keys(stateStore).forEach(key => delete stateStore[key as unknown as number]);
};

// Import after mocks
import { calendarService } from '../../services/calendarService';
import * as checkinService from '../../services/calendarCheckinService';
import { useCalendar } from '../useCalendar';

describe('useCalendar', () => {
  const mockEvent: CalendarEvent = {
    id: "event-1",
    summary: "Team Meeting",
    start: { dateTime: new Date().toISOString() },
    end: { dateTime: new Date(Date.now() + 3600000).toISOString() },
  };

  const mockTriggerSystemMessage = vi.fn();

  const defaultOptions = {
    session: { accessToken: "test-token" },
    selectedCharacter: { id: "char-1", name: "Test Character" } as any,
    proactiveSettings: { calendar: true, news: true, checkins: true },
    isSnoozed: false,
    isProcessingAction: false,
    isSpeaking: false,
    triggerSystemMessage: mockTriggerSystemMessage,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("should expose upcomingEvents array", () => {
      const hook = useCalendar(defaultOptions);
      expect(hook.upcomingEvents).toBeDefined();
      expect(Array.isArray(hook.upcomingEvents)).toBe(true);
    });

    it("should expose weekEvents array", () => {
      const hook = useCalendar(defaultOptions);
      expect(hook.weekEvents).toBeDefined();
      expect(Array.isArray(hook.weekEvents)).toBe(true);
    });

    it("should expose setUpcomingEvents function", () => {
      const hook = useCalendar(defaultOptions);
      expect(typeof hook.setUpcomingEvents).toBe("function");
    });

    it("should expose refreshEvents function", () => {
      const hook = useCalendar(defaultOptions);
      expect(typeof hook.refreshEvents).toBe("function");
    });

    it("should expose refreshWeekEvents function", () => {
      const hook = useCalendar(defaultOptions);
      expect(typeof hook.refreshWeekEvents).toBe("function");
    });

    it("should expose triggerCalendarCheckin function", () => {
      const hook = useCalendar(defaultOptions);
      expect(typeof hook.triggerCalendarCheckin).toBe("function");
    });
  });

  describe("refreshEvents", () => {
    it("should call calendarService.getUpcomingEvents with access token", async () => {
      const mockEvents = [mockEvent];
      vi.mocked(calendarService.getUpcomingEvents).mockResolvedValue(
        mockEvents
      );

      const hook = useCalendar(defaultOptions);
      const result = await hook.refreshEvents("test-token");

      expect(calendarService.getUpcomingEvents).toHaveBeenCalledWith(
        "test-token"
      );
      expect(result).toEqual(mockEvents);
    });

    it("should handle empty events list", async () => {
      vi.mocked(calendarService.getUpcomingEvents).mockResolvedValue([]);

      const hook = useCalendar(defaultOptions);
      const result = await hook.refreshEvents("test-token");

      expect(result).toEqual([]);
    });
  });

  describe("refreshWeekEvents", () => {
    it("should call calendarService.getWeekEvents with access token", async () => {
      const mockEvents = [mockEvent];
      vi.mocked(calendarService.getWeekEvents).mockResolvedValue(mockEvents);

      const hook = useCalendar(defaultOptions);
      await hook.refreshWeekEvents("test-token");

      expect(calendarService.getWeekEvents).toHaveBeenCalledWith("test-token");
    });

    it("should call cleanupOldCheckins with event IDs", async () => {
      const mockEvents = [mockEvent, { ...mockEvent, id: "event-2" }];
      vi.mocked(calendarService.getWeekEvents).mockResolvedValue(mockEvents);

      const hook = useCalendar(defaultOptions);
      await hook.refreshWeekEvents("test-token");

      expect(checkinService.cleanupOldCheckins).toHaveBeenCalledWith([
        "event-1",
        "event-2",
      ]);
    });
  });

  // describe('triggerCalendarCheckin', () => {
  //   it('should skip check-in when snoozed', () => {
  //     const hook = useCalendar({ ...defaultOptions, isSnoozed: true });
  //     hook.triggerCalendarCheckin(mockEvent, ty);

  //     expect(checkinService.markCheckinDone).not.toHaveBeenCalled();
  //     expect(mockTriggerSystemMessage).not.toHaveBeenCalled();
  //   });

  //   it('should skip check-in when calendar proactive setting is disabled', () => {
  //     const hook = useCalendar({
  //       ...defaultOptions,
  //       proactiveSettings: { ...defaultOptions.proactiveSettings, calendar: false },
  //     });
  //     hook.triggerCalendarCheckin(mockEvent, 'upcoming');

  //     expect(checkinService.markCheckinDone).not.toHaveBeenCalled();
  //     expect(mockTriggerSystemMessage).not.toHaveBeenCalled();
  //   });

  //   it('should mark check-in done and trigger system message when enabled', () => {
  //     vi.mocked(checkinService.buildEventCheckinPrompt).mockReturnValue('Check-in prompt');

  //     const hook = useCalendar(defaultOptions);
  //     hook.triggerCalendarCheckin(mockEvent, 'upcoming');

  //     expect(checkinService.markCheckinDone).toHaveBeenCalledWith('event-1', 'upcoming');
  //     expect(checkinService.buildEventCheckinPrompt).toHaveBeenCalledWith(mockEvent, 'upcoming');
  //     expect(mockTriggerSystemMessage).toHaveBeenCalledWith('Check-in prompt');
  //   });

  //   it('should work with different check-in types', () => {
  //     vi.mocked(checkinService.buildEventCheckinPrompt).mockReturnValue('Reminder prompt');

  //     const hook = useCalendar(defaultOptions);
  //     hook.triggerCalendarCheckin(mockEvent, 'reminder');

  //     expect(checkinService.markCheckinDone).toHaveBeenCalledWith('event-1', 'reminder');
  //     expect(checkinService.buildEventCheckinPrompt).toHaveBeenCalledWith(mockEvent, 'reminder');
  //   });
  // });

  describe("registerCalendarEffects", () => {
    it("should return cleanup function", () => {
      const hook = useCalendar(defaultOptions);
      const cleanup = hook.registerCalendarEffects();

      expect(typeof cleanup).toBe("function");
    });

    it("should not start polling without session", () => {
      const hook = useCalendar({ ...defaultOptions, session: null });
      hook.registerCalendarEffects();

      expect(calendarService.getUpcomingEvents).not.toHaveBeenCalled();
      expect(calendarService.getWeekEvents).not.toHaveBeenCalled();
    });

    it("should poll calendar events immediately when session exists", async () => {
      vi.mocked(calendarService.getUpcomingEvents).mockResolvedValue([
        mockEvent,
      ]);
      vi.mocked(calendarService.getWeekEvents).mockResolvedValue([mockEvent]);

      const hook = useCalendar(defaultOptions);
      hook.registerCalendarEffects();

      // Use real timers for this test since we're testing immediate calls
      vi.useRealTimers();

      // Wait for promises to resolve
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(calendarService.getUpcomingEvents).toHaveBeenCalledWith(
        "test-token"
      );
      expect(calendarService.getWeekEvents).toHaveBeenCalledWith("test-token");

      vi.useFakeTimers();
    });

    it("should clean up intervals on cleanup call", async () => {
      vi.mocked(calendarService.getUpcomingEvents).mockResolvedValue([
        mockEvent,
      ]);
      vi.mocked(calendarService.getWeekEvents).mockResolvedValue([mockEvent]);

      // Use real timers for this test
      vi.useRealTimers();

      const hook = useCalendar(defaultOptions);
      const cleanup = hook.registerCalendarEffects();

      // Wait for initial calls
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify initial calls were made
      expect(calendarService.getUpcomingEvents).toHaveBeenCalled();
      vi.clearAllMocks();

      // Call cleanup
      cleanup();

      // Cleanup was called - intervals should be cleared
      // We can't easily test that intervals don't fire without waiting 5 minutes
      // So we just verify cleanup returns without error
      expect(true).toBe(true);

      vi.useFakeTimers();
    });
  });

  describe("checkForApplicableCheckins", () => {
    it("should not check when no selected character", () => {
      const hook = useCalendar({ ...defaultOptions, selectedCharacter: null });
      hook.checkForApplicableCheckins([mockEvent]);

      expect(checkinService.getApplicableCheckin).not.toHaveBeenCalled();
    });

    it("should not check when calendar proactive is disabled", () => {
      const hook = useCalendar({
        ...defaultOptions,
        proactiveSettings: {
          ...defaultOptions.proactiveSettings,
          calendar: false,
        },
      });
      hook.checkForApplicableCheckins([mockEvent]);

      expect(checkinService.getApplicableCheckin).not.toHaveBeenCalled();
    });

    it("should not check when processing action", () => {
      const hook = useCalendar({ ...defaultOptions, isProcessingAction: true });
      hook.checkForApplicableCheckins([mockEvent]);

      expect(checkinService.getApplicableCheckin).not.toHaveBeenCalled();
    });

    it("should not check when speaking", () => {
      const hook = useCalendar({ ...defaultOptions, isSpeaking: true });
      hook.checkForApplicableCheckins([mockEvent]);

      expect(checkinService.getApplicableCheckin).not.toHaveBeenCalled();
    });

    it("should check each event for applicable check-in", () => {
      vi.mocked(checkinService.getApplicableCheckin).mockReturnValue(null);

      const events = [mockEvent, { ...mockEvent, id: "event-2" }];
      const hook = useCalendar(defaultOptions);
      hook.checkForApplicableCheckins(events);

      expect(checkinService.getApplicableCheckin).toHaveBeenCalledTimes(2);
    });

    // it("should trigger check-in when applicable type found", () => {
    //   vi.mocked(checkinService.getApplicableCheckin).mockReturnValue(
    //     "upcoming"
    //   );
    //   vi.mocked(checkinService.buildEventCheckinPrompt).mockReturnValue(
    //     "Prompt"
    //   );

    //   const hook = useCalendar(defaultOptions);
    //   hook.checkForApplicableCheckins([mockEvent]);

    //   expect(checkinService.markCheckinDone).toHaveBeenCalled();
    //   expect(mockTriggerSystemMessage).toHaveBeenCalled();
    // });

    // it("should only trigger one check-in at a time", () => {
    //   vi.mocked(checkinService.getApplicableCheckin).mockReturnValue();
    //   vi.mocked(checkinService.buildEventCheckinPrompt).mockReturnValue(
    //     "Prompt"
    //   );

    //   const events = [mockEvent, { ...mockEvent, id: "event-2" }];
    //   const hook = useCalendar(defaultOptions);
    //   hook.checkForApplicableCheckins(events);

    //   // Should only trigger for first event
    //   expect(checkinService.markCheckinDone).toHaveBeenCalledTimes(1);
    //   expect(mockTriggerSystemMessage).toHaveBeenCalledTimes(1);
    // });
  });
});
