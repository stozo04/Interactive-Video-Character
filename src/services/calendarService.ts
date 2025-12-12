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
  /**
   * Get upcoming events for the next 24 hours
   */
  async getUpcomingEvents(accessToken: string): Promise<CalendarEvent[]> {
    try {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const params = new URLSearchParams({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: tomorrow.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '10',
      });

      const response = await fetch(
        `${BASE_URL}/calendars/primary/events?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status === 401) {
        console.error('Calendar API: Token expired or invalid');
        this.dispatchEvent(new CustomEvent('auth-error'));
        throw new Error('Authentication failed. Please reconnect your Google account.');
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Calendar API error:', response.status, errorText);
        throw new Error(`Failed to fetch calendar events: ${response.statusText}`);
      }

      const data = await response.json();
      const events: CalendarEvent[] = data.items || [];

      console.log(`📅 Fetched ${events.length} upcoming events`);
      return events;
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      throw error;
    }
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
   * Get events for the current week (Sunday to Saturday)
   * Used for proactive calendar check-ins
   */
  async getWeekEvents(accessToken: string): Promise<CalendarEvent[]> {
    try {
      const now = new Date();
      
      // Get Sunday of current week
      const sunday = new Date(now);
      sunday.setDate(now.getDate() - now.getDay());
      sunday.setHours(0, 0, 0, 0);
      
      // Get Saturday end of current week
      const saturday = new Date(sunday);
      saturday.setDate(sunday.getDate() + 6);
      saturday.setHours(23, 59, 59, 999);

      const params = new URLSearchParams({
        calendarId: 'primary',
        timeMin: sunday.toISOString(),
        timeMax: saturday.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      });

      const response = await fetch(
        `${BASE_URL}/calendars/primary/events?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status === 401) {
        console.error('Calendar API: Token expired or invalid');
        this.dispatchEvent(new CustomEvent('auth-error'));
        throw new Error('Authentication failed. Please reconnect your Google account.');
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Calendar API error:', response.status, errorText);
        throw new Error(`Failed to fetch week calendar events: ${response.statusText}`);
      }

      const data = await response.json();
      const events: CalendarEvent[] = data.items || [];

      console.log(`📅 Fetched ${events.length} events for the week (Sun-Sat)`);
      return events;
    } catch (error) {
      console.error('Error fetching week calendar events:', error);
      throw error;
    }
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
