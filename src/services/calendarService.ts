// src/services/calendarService.ts

/**
 * Google Calendar Service
 * Handles fetching events and creating new calendar events
 */

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

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
        const errorText = await response.text();
        console.error("Calendar API error:", response.status, errorText);
        throw new Error(
          `Failed to fetch calendar events: ${response.statusText}`
        );
      }

      const data = await response.json();
      const rawEvents: CalendarEvent[] = data.items || [];
      const events = this.filterValidEvents(rawEvents);
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
    startDate.setHours(0, 0, 0, 0);
    
    // Look ahead 7 days from now
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    endDate.setHours(23, 59, 59, 999);

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
