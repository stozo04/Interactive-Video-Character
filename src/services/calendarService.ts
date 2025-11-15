// src/services/calendarService.ts

// This is the data we'll use in the app
export interface CalendarEvent {
    id: string;
    summary: string; // The title of the event
    start: {
      dateTime: string; // ISO string (e.g., "2025-11-15T09:30:00-06:00")
      timeZone: string;
    };
    end: {
      dateTime: string; // ISO string
      timeZone: string;
    };
  }
  
  // This is the payload for creating a new event
  export interface NewEventPayload {
    summary: string;
    start: {
      dateTime: string; // e.g., "2025-11-16T10:00:00"
      timeZone: string; // e.g., "America/Chicago"
    };
    end: {
      dateTime: string;
      timeZone: string;
    };
  }
  
  /**
   * This service will also use an EventTarget to notify the app
   * of API errors.
   */
  class CalendarService extends EventTarget {
    private apiBase = "https://www.googleapis.com/calendar/v3/calendars/primary";
  
    /**
     * Handles API errors, specifically 401 (Unauthorized)
     */
    private handleApiError(response: Response) {
      if (response.status === 401) {
        this.dispatchEvent(new CustomEvent("auth-error"));
      }
      throw new Error(`Calendar API error: ${response.statusText}`);
    }
  
    /**
     * Fetches upcoming events for the next 24 hours.
     */
    async getUpcomingEvents(accessToken: string): Promise<CalendarEvent[]> {
      const now = new Date();
      const timeMin = now.toISOString();
      
      // Get events for the next 24 hours
      const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  
      const params = new URLSearchParams({
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: 'true', // Expands recurring events
        orderBy: 'startTime',
        maxResults: '10', // Get the next 10 events
      });
  
      const response = await fetch(`${this.apiBase}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
  
      if (!response.ok) {
        return this.handleApiError(response);
      }
  
      const data = await response.json();
      return data.items || [];
    }
  
    /**
     * Creates a new event on the user's primary calendar.
     */
    async createEvent(
      accessToken: string,
      event: NewEventPayload
    ): Promise<CalendarEvent> {
      const response = await fetch(`${this.apiBase}/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });
  
      if (!response.ok) {
        return this.handleApiError(response);
      }
  
      const newEvent = await response.json();
      return newEvent;
    }
  
    /**
     * Deletes an event by its ID.
     * Note: This is harder for an AI to use, as it needs the eventId.
     */
    async deleteEvent(accessToken: string, eventId: string): Promise<void> {
      const response = await fetch(`${this.apiBase}/events/${eventId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
  
      if (!response.ok) {
        return this.handleApiError(response);
      }
      
      // No content is returned on a successful 204 delete
    }
  }
  
  // Create a single instance that the whole app can use
  export const calendarService = new CalendarService();