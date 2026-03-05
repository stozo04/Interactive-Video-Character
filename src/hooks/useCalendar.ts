/**
 * useCalendar Hook
 *
 * Manages calendar state, polling, and proactive check-ins.
 * Extracted from App.tsx as part of Phase 3 refactoring.
 *
 * @see src/hooks/useCalendar.README.md for usage documentation
 */

import { useState, useCallback, Dispatch, SetStateAction } from 'react';
import {
  calendarService,
  CalendarServiceError,
  CalendarServiceErrorKind,
  type CalendarEvent,
} from '../services/calendarService';
import {
  getApplicableCheckin,
  markCheckinDone,
  buildEventCheckinPrompt,
  cleanupOldCheckins,
  type CheckinType,
} from '../services/calendarCheckinService';
import {
  createOpenLoop,
  findCalendarEventLoop,
  updateLoopCalendarData
} from '../services/presenceDirector';
import type { ProactiveSettings } from '../types';

/**
 * Polling intervals (in milliseconds)
 */
const CALENDAR_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const CHECKIN_CHECK_INTERVAL = 2 * 60 * 1000; // 2 minutes
const INITIAL_CHECKIN_DELAY = 30000; // 30 seconds

const isCalendarRateLimitError = (error: unknown): error is CalendarServiceError => {
  return error instanceof CalendarServiceError && error.kind === CalendarServiceErrorKind.RateLimit;
};


type CalendarPollSubscriber = {
  setUpcomingEvents: Dispatch<SetStateAction<CalendarEvent[]>>;
  setWeekEvents: Dispatch<SetStateAction<CalendarEvent[]>>;
};

const createCalendarPoller = () => {
  const subscribers = new Set<CalendarPollSubscriber>();
  let accessToken: string | null = null;
  let upcomingIntervalId: NodeJS.Timeout | null = null;
  let weekIntervalId: NodeJS.Timeout | null = null;

  const setAccessToken = (token: string) => {
    if (accessToken !== token) {
      accessToken = token;
    }
  };

  const notifyUpcoming = (events: CalendarEvent[]) => {
    subscribers.forEach(subscriber => subscriber.setUpcomingEvents(events));
  };

  const notifyWeek = (events: CalendarEvent[]) => {
    subscribers.forEach(subscriber => subscriber.setWeekEvents(events));
  };

  const pollUpcoming = async () => {
    if (!accessToken) return;
    try {
      const events = await calendarService.getUpcomingEvents(accessToken);
      notifyUpcoming(events);
    } catch (e) {
      if (isCalendarRateLimitError(e)) {
        console.warn(`[useCalendar] Calendar poll rate limited. Retry after ${Math.ceil((e.retryAfterMs ?? 0) / 1000)}s.`);
        return;
      }
      console.error('[useCalendar] Calendar poll failed:', e);
    }
  };

  const pollWeek = async () => {
    if (!accessToken) return;
    try {
      const events = await calendarService.getWeekEvents(accessToken);
      notifyWeek(events);
      cleanupOldCheckins(events.map(e => e.id));
    } catch (e) {
      if (isCalendarRateLimitError(e)) {
        console.warn(`[useCalendar] Week calendar poll rate limited. Retry after ${Math.ceil((e.retryAfterMs ?? 0) / 1000)}s.`);
        return;
      }
      console.error('[useCalendar] Week calendar poll failed:', e);
    }
  };

  const start = () => {
    if (upcomingIntervalId || weekIntervalId) return;
    pollUpcoming();
    pollWeek();
    upcomingIntervalId = setInterval(pollUpcoming, CALENDAR_POLL_INTERVAL);
    weekIntervalId = setInterval(pollWeek, CALENDAR_POLL_INTERVAL);
  };

  const stop = () => {
    if (upcomingIntervalId) {
      clearInterval(upcomingIntervalId);
      upcomingIntervalId = null;
    }
    if (weekIntervalId) {
      clearInterval(weekIntervalId);
      weekIntervalId = null;
    }
  };

  const subscribe = (subscriber: CalendarPollSubscriber, token: string) => {
    subscribers.add(subscriber);
    setAccessToken(token);
    start();
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        stop();
      }
    };
  };

  return { subscribe, setAccessToken };
};

const calendarPoller = createCalendarPoller();

/**
 * Options for the useCalendar hook
 */
export interface UseCalendarOptions {
  /** Google auth session with access token */
  session: { accessToken: string } | null;

  /** Whether auth is currently connected */
  isAuthConnected: boolean;

  /** Selected character (needed for check-in triggers) */
  selectedCharacter: { id: string; name: string } | null;

  /** Proactive settings (calendar must be enabled for check-ins) */
  proactiveSettings: ProactiveSettings;

  /** Whether check-ins are snoozed */
  isSnoozed: boolean;

  /** Whether an action is currently being processed */
  isProcessingAction: boolean;

  /** Whether the character is currently speaking */
  isSpeaking: boolean;

  /** Function to trigger a system message (for check-ins) */
  triggerSystemMessage: (prompt: string) => void;
}

/**
 * Return type for the useCalendar hook
 */
export interface UseCalendarResult {
  /** Today's upcoming events */
  upcomingEvents: CalendarEvent[];

  /** This week's events (for proactive check-ins) */
  weekEvents: CalendarEvent[];

  /** Direct setter for upcoming events */
  setUpcomingEvents: Dispatch<SetStateAction<CalendarEvent[]>>;

  /** Direct setter for week events */
  setWeekEvents: Dispatch<SetStateAction<CalendarEvent[]>>;

  /** Refresh upcoming events from calendar API */
  refreshEvents: (accessToken: string) => Promise<CalendarEvent[]>;

  /** Refresh week events from calendar API */
  refreshWeekEvents: (accessToken: string) => Promise<void>;

  /** Trigger a specific calendar check-in */
  triggerCalendarCheckin: (event: CalendarEvent, type: CheckinType) => void;

  /** Register polling effects - returns cleanup function */
  registerCalendarEffects: () => () => void;

  /** Manually check for applicable check-ins */
  checkForApplicableCheckins: (events: CalendarEvent[]) => void;
}

/**
 * Hook for managing calendar state and proactive check-ins.
 *
 * @example
 * ```typescript
 * const {
 *   upcomingEvents,
 *   weekEvents,
 *   refreshEvents,
 *   triggerCalendarCheckin,
 *   registerCalendarEffects,
 * } = useCalendar({
 *   session,
 *   isAuthConnected,
 *   selectedCharacter,
 *   proactiveSettings,
 *   isSnoozed,
 *   isProcessingAction,
 *   isSpeaking,
 *   triggerSystemMessage,
 * });
 *
 * // Register effects in a useEffect
 * useEffect(() => {
 *   return registerCalendarEffects();
 * }, [registerCalendarEffects]);
 * ```
 */
export function useCalendar(options: UseCalendarOptions): UseCalendarResult {
  const {
    session,
    isAuthConnected,
    selectedCharacter,
    proactiveSettings,
    isSnoozed,
    isProcessingAction,
    isSpeaking,
    triggerSystemMessage,
  } = options;

  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>([]);

  /**
   * Refresh upcoming events from the calendar API
   */
  const refreshEvents = useCallback(async (accessToken: string): Promise<CalendarEvent[]> => {
    if (!isAuthConnected) {
      console.warn('[useCalendar] Skipping refreshEvents: auth not connected');
      return [];
    }
    // console.log('[useCalendar] Refreshing upcoming events...');
    const events = await calendarService.getUpcomingEvents(accessToken);
    // console.log(`[useCalendar] Loaded ${events.length} upcoming event(s)`);
    setUpcomingEvents(events);
    return events;
  }, [isAuthConnected]);

  /**
   * Refresh week events from the calendar API
   */
  const refreshWeekEvents = useCallback(async (accessToken: string): Promise<void> => {
    if (!isAuthConnected) {
      console.warn('[useCalendar] Skipping refreshWeekEvents: auth not connected');
      return;
    }
    // console.log('[useCalendar] Refreshing week events...');
    const events = await calendarService.getWeekEvents(accessToken);
    // console.log(`[useCalendar] Loaded ${events.length} week event(s)`);
    setWeekEvents(events);
    // Clean up old check-in states for events no longer in this week
    cleanupOldCheckins(events.map(e => e.id));
  }, [isAuthConnected]);

  /**
   * Trigger a calendar check-in for a specific event
   */
  const triggerCalendarCheckin = useCallback(async (event: CalendarEvent, type: CheckinType) => {
    // Respect snooze and proactive settings
    if (isSnoozed || !proactiveSettings.calendar) {
      // console.log(`📅 [useCalendar] Skipping check-in (snoozed: ${isSnoozed}, calendar: ${proactiveSettings.calendar})`);
      return;
    }

    // Mark this check-in as done to avoid duplicates
    markCheckinDone(event.id, type);

    // For future events, create/update an open loop to prevent contradictory follow-ups
    if (type === 'day_before' || type === 'approaching' || type === 'starting_soon') {
      const eventStart = new Date(event.start.dateTime || event.start.date || '');

      // Only create/update loop if we have a valid date
      if (!isNaN(eventStart.getTime())) {
        try {
          // Determine salience based on check-in type
          const salience = type === 'starting_soon' ? 0.9 : type === 'approaching' ? 0.7 : 0.6;

          // Check for existing loop (by event ID or topic similarity)
          const existingLoop = await findCalendarEventLoop(event.id, event.summary || 'event');

          if (existingLoop) {
            // Update existing loop with calendar metadata if missing
            const needsUpdate =
              !existingLoop.sourceCalendarEventId ||
              !existingLoop.eventDateTime ||
              existingLoop.salience < salience;

            if (needsUpdate) {
              await updateLoopCalendarData(
                existingLoop.id,
                eventStart,
                event.id,
                Math.max(existingLoop.salience, salience) // Use higher salience
              );
              // console.log(`📅 [useCalendar] Updated existing loop for: ${event.summary}`);
            } else {
              // console.log(`📅 [useCalendar] Loop already exists with metadata: ${event.summary}`);
            }
          } else {
            // Create new loop
            await createOpenLoop('pending_event', event.summary || 'event', {
              eventDateTime: eventStart,
              sourceCalendarEventId: event.id,
              salience,
              triggerContext: `Calendar event: ${event.summary}`,
            });
            // console.log(`📅 [useCalendar] Created open loop for future event: ${event.summary}`);
          }
        } catch (error) {
          console.error(`📅 [useCalendar] Failed to manage open loop:`, error);
        }
      }
    }

    // Build and send the prompt
    const prompt = buildEventCheckinPrompt(event, type);
    // console.log(`📅 [useCalendar] Triggering ${type} check-in for: ${event.summary}`);
    triggerSystemMessage(prompt);
  }, [isSnoozed, proactiveSettings.calendar, triggerSystemMessage]);

  /**
   * Check events for applicable check-ins
   */
  const checkForApplicableCheckins = useCallback((events: CalendarEvent[]) => {
    // Skip if conditions aren't met
    if (!selectedCharacter || !proactiveSettings.calendar) {
      return;
    }

    // Don't trigger if already processing or speaking
    if (isProcessingAction || isSpeaking) {
      return;
    }

    // Check each event
    for (const event of events) {
      const applicableType = getApplicableCheckin(event);
      if (applicableType) {
        triggerCalendarCheckin(event, applicableType);
        break; // One check-in at a time
      }
    }
  }, [selectedCharacter, proactiveSettings.calendar, isProcessingAction, isSpeaking, triggerCalendarCheckin]);

  /**
   * Register calendar polling effects
   * Returns a cleanup function that should be called on unmount
   */
  const registerCalendarEffects = useCallback((): (() => void) => {
    if (!session || !isAuthConnected) {
      // console.log('[useCalendar] No session, skipping calendar effects');
      return () => {};
    }

    const accessToken = session.accessToken;
    calendarPoller.setAccessToken(accessToken);

    const unsubscribe = calendarPoller.subscribe(
      {
        setUpcomingEvents,
        setWeekEvents,
      },
      accessToken
    );

    return () => {
      unsubscribe();
    };
  }, [session, isAuthConnected, setUpcomingEvents, setWeekEvents]);

  return {
    upcomingEvents,
    weekEvents,
    setUpcomingEvents,
    setWeekEvents,
    refreshEvents,
    refreshWeekEvents,
    triggerCalendarCheckin,
    registerCalendarEffects,
    checkForApplicableCheckins,
  };
}
