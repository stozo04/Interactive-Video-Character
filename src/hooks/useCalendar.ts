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

/**
 * Options for the useCalendar hook
 */
export interface UseCalendarOptions {
  /** Google auth session with access token */
  session: { accessToken: string } | null;

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
    console.log('📅 [useCalendar] Refreshing upcoming events...');
    const events = await calendarService.getUpcomingEvents(accessToken);
    console.log(`📅 [useCalendar] Loaded ${events.length} upcoming event(s)`);
    setUpcomingEvents(events);
    return events;
  }, []);

  /**
   * Refresh week events from the calendar API
   */
  const refreshWeekEvents = useCallback(async (accessToken: string): Promise<void> => {
    console.log('📅 [useCalendar] Refreshing week events...');
    const events = await calendarService.getWeekEvents(accessToken);
    console.log(`📅 [useCalendar] Loaded ${events.length} week event(s)`);
    setWeekEvents(events);
    // Clean up old check-in states for events no longer in this week
    cleanupOldCheckins(events.map(e => e.id));
  }, []);

  /**
   * Trigger a calendar check-in for a specific event
   */
  const triggerCalendarCheckin = useCallback(async (event: CalendarEvent, type: CheckinType) => {
    // Respect snooze and proactive settings
    if (isSnoozed || !proactiveSettings.calendar) {
      console.log(`📅 [useCalendar] Skipping check-in (snoozed: ${isSnoozed}, calendar: ${proactiveSettings.calendar})`);
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
              console.log(`📅 [useCalendar] Updated existing loop for: ${event.summary}`);
            } else {
              console.log(`📅 [useCalendar] Loop already exists with metadata: ${event.summary}`);
            }
          } else {
            // Create new loop
            await createOpenLoop('pending_event', event.summary || 'event', {
              eventDateTime: eventStart,
              sourceCalendarEventId: event.id,
              salience,
              triggerContext: `Calendar event: ${event.summary}`,
            });
            console.log(`📅 [useCalendar] Created open loop for future event: ${event.summary}`);
          }
        } catch (error) {
          console.error(`📅 [useCalendar] Failed to manage open loop:`, error);
        }
      }
    }

    // Build and send the prompt
    const prompt = buildEventCheckinPrompt(event, type);
    console.log(`📅 [useCalendar] Triggering ${type} check-in for: ${event.summary}`);
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
    const intervalIds: NodeJS.Timeout[] = [];
    const timeoutIds: NodeJS.Timeout[] = [];

    if (!session) {
      console.log('📅 [useCalendar] No session, skipping calendar effects');
      return () => {};
    }

    const accessToken = session.accessToken;

    // Poll upcoming events
    const pollUpcoming = async () => {
      try {
        console.log('📅 [useCalendar] Polling upcoming events...');
        const events = await calendarService.getUpcomingEvents(accessToken);
        setUpcomingEvents(events);
      } catch (e) {
        console.error('📅 [useCalendar] Calendar poll failed:', e);
      }
    };

    // Poll week events
    const pollWeekEvents = async () => {
      try {
        console.log('📅 [useCalendar] Polling week events...');
        const events = await calendarService.getWeekEvents(accessToken);
        setWeekEvents(events);
        cleanupOldCheckins(events.map(e => e.id));
      } catch (e) {
        console.error('📅 [useCalendar] Week calendar poll failed:', e);
      }
    };

    // Start polling immediately
    pollUpcoming();
    pollWeekEvents();

    // Set up intervals
    intervalIds.push(setInterval(pollUpcoming, CALENDAR_POLL_INTERVAL));
    intervalIds.push(setInterval(pollWeekEvents, CALENDAR_POLL_INTERVAL));

    console.log('📅 [useCalendar] Calendar effects registered');

    // Return cleanup function
    return () => {
      console.log('📅 [useCalendar] Cleaning up calendar effects');
      intervalIds.forEach(clearInterval);
      timeoutIds.forEach(clearTimeout);
    };
  }, [session]);

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
