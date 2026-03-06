// src/services/calendarService.ts

/**
 * Google Calendar Service
 * Handles fetching events and creating new calendar events
 */

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

export enum CalendarServiceErrorKind {
  RateLimit = 'rate_limit',
}

export class CalendarServiceError extends Error {
  kind: CalendarServiceErrorKind;
  retryAfterMs?: number;
  status?: number;

  constructor(message: string, kind: CalendarServiceErrorKind, options?: { retryAfterMs?: number; status?: number }) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = options?.retryAfterMs;
    this.status = options?.status;
  }
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  status?: string;
  location?: string;
  // Add this field to track accept/decline status
  attendees?: Array<{
    self?: boolean;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
}

export interface NewEventPayload {
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: string;
}

/**
 * Event-driven architecture for Calendar service
 */
class CalendarService extends EventTarget {
  private rateLimitCooldownUntil = 0;
  private rateLimitBackoffMs = 0;
  private readonly rateLimitBaseMs = 30_000;
  private readonly rateLimitMaxMs = 5 * 60_000;

  private isRateLimitError(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const errorPayload = payload as {
      error?: {
        status?: string;
        errors?: Array<{ reason?: string }>;
        details?: Array<{ reason?: string }>;
      };
    };

    const error = errorPayload.error;
    const errorReason = error?.errors?.[0]?.reason;
    const detailReason = error?.details?.[0]?.reason;

    return (
      errorReason === 'rateLimitExceeded' ||
      detailReason === 'RATE_LIMIT_EXCEEDED' ||
      error?.status === 'PERMISSION_DENIED'
    );
  }

  private getRetryAfterMs(response: Response): number | undefined {
    const retryAfterSeconds = response.headers.get('Retry-After');
    if (!retryAfterSeconds) return undefined;
    const parsed = Number(retryAfterSeconds);
    if (Number.isNaN(parsed)) return undefined;
    return Math.max(0, parsed * 1000);
  }

  private enterRateLimitCooldown(retryAfterMs?: number): number {
    const nextBackoff = this.rateLimitBackoffMs
      ? Math.min(this.rateLimitBackoffMs * 2, this.rateLimitMaxMs)
      : this.rateLimitBaseMs;
    this.rateLimitBackoffMs = retryAfterMs ?? nextBackoff;
    this.rateLimitCooldownUntil = Date.now() + this.rateLimitBackoffMs;
    return this.rateLimitBackoffMs;
  }

  private filterValidEvents(events: CalendarEvent[]): CalendarEvent[] {
    return events.filter(event => {
      // 1. Exclude cancelled events
      if (event.status === 'cancelled') return false;
  
      // 2. Exclude events where the user explicitly declined
      if (event.attendees) {
        const selfAttendee = event.attendees.find(a => a.self);
        if (selfAttendee && selfAttendee.responseStatus === 'declined') {
          return false;
        }
      }
  
      return true;
    });
  }


   /**
   * Get events for a specific timeframe
   */
  async getEvents(accessToken: string, timeMin: string, timeMax: string, maxResults: number = 25): Promise<CalendarEvent[]> {
    try {
      if (Date.now() < this.rateLimitCooldownUntil) {
        const retryAfterMs = Math.max(0, this.rateLimitCooldownUntil - Date.now());
        throw new CalendarServiceError(
          `Calendar API rate limited. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
          CalendarServiceErrorKind.RateLimit,
          { retryAfterMs }
        );
      }

      const params = new URLSearchParams({
        calendarId: "primary",
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: maxResults.toString(),
      });

      const response = await fetch(
        `${BASE_URL}/calendars/primary/events?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.status === 401) {
        console.error("Calendar API: Token expired or invalid");
        this.dispatchEvent(new CustomEvent("auth-error"));
        throw new Error(
          "Authentication failed. Please reconnect your Google account."
        );
      }

      if (!response.ok) {
        let errorText = '';
        let errorJson: unknown = null;
        try {
          errorJson = await response.json();
          errorText = JSON.stringify(errorJson);
        } catch {
          errorText = await response.text();
        }
        console.error("Calendar API error:", response.status, errorText);

        if (response.status === 403 && this.isRateLimitError(errorJson)) {
          const retryAfterMs = this.getRetryAfterMs(response);
          const cooldownMs = this.enterRateLimitCooldown(retryAfterMs);
          throw new CalendarServiceError(
            `Calendar API rate limited. Retry after ${Math.ceil(cooldownMs / 1000)}s.`,
            CalendarServiceErrorKind.RateLimit,
            { retryAfterMs: cooldownMs, status: response.status }
          );
        }
        throw new Error(
          `Failed to fetch calendar events: ${response.statusText}`
        );
      }

      const data = await response.json();
      const rawEvents: CalendarEvent[] = data.items || [];
      const events = this.filterValidEvents(rawEvents);
      this.rateLimitBackoffMs = 0;
      this.rateLimitCooldownUntil = 0;
      // console.log(`📅 Fetched ${events.length} valid events between ${timeMin} and ${timeMax}`);
      return events;
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      throw error;
    }
  }

  /**
   * Get upcoming events for the next 7 days
   */
  async getUpcomingEvents(accessToken: string): Promise<CalendarEvent[]> {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return this.getEvents(accessToken, now.toISOString(), nextWeek.toISOString(), 15);
  }

  /**
   * Create a new calendar event
   */
  async createEvent(
    accessToken: string,
    eventData: NewEventPayload
  ): Promise<CalendarEvent> {
    try {
      const response = await fetch(`${BASE_URL}/calendars/primary/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventData),
      });

      if (response.status === 401) {
        console.error('Calendar API: Token expired or invalid');
        this.dispatchEvent(new CustomEvent('auth-error'));
        throw new Error('Authentication failed. Please reconnect your Google account.');
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Calendar API error:', response.status, errorText);
        throw new Error(`Failed to create calendar event: ${response.statusText}`);
      }

      const event: CalendarEvent = await response.json();
      console.log('✅ Calendar event created:', event.summary);
      return event;
    } catch (error) {
      console.error('Error creating calendar event:', error);
      throw error;
    }
  }

   /**
   * Get events for the next 7 days
   * Used for proactive calendar check-ins
   */
  async getWeekEvents(accessToken: string): Promise<CalendarEvent[]> {
    const now = new Date();
    
    // Start from beginning of today to catch any current/missed events
    const startDate = new Date(now);
    startDate.setUTCHours(0, 0, 0, 0);

    // Look ahead 7 days from now
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    endDate.setUTCHours(23, 59, 59, 999);

    return this.getEvents(accessToken, startDate.toISOString(), endDate.toISOString(), 50);
  }

  /**
   * Delete a calendar event by ID
   */
  async deleteEvent(accessToken: string, eventId: string): Promise<void> {
    try {
      const response = await fetch(
        `${BASE_URL}/calendars/primary/events/${eventId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.status === 401) {
        console.error('Calendar API: Token expired or invalid');
        this.dispatchEvent(new CustomEvent('auth-error'));
        throw new Error('Authentication failed. Please reconnect your Google account.');
      }

      if (!response.ok && response.status !== 204) {
        const errorText = await response.text();
        console.error('Calendar API error:', response.status, errorText);
        throw new Error(`Failed to delete calendar event: ${response.statusText}`);
      }

      console.log('✅ Calendar event deleted:', eventId);
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const calendarService = new CalendarService();
