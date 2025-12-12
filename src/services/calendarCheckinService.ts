// src/services/calendarCheckinService.ts

/**
 * Calendar Check-in Service
 * Manages smart proactive check-ins for calendar events
 * - Day before previews
 * - Approaching reminders
 * - Starting soon alerts
 * - Post-event follow-ups
 */

import type { CalendarEvent } from './calendarService';

export type CheckinType = 'day_before' | 'approaching' | 'starting_soon' | 'post_event';

const STORAGE_KEY = 'kayley_event_checkins';

/**
 * Get the current check-in state from localStorage
 */
export function getCheckinState(): Map<string, CheckinType[]> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return new Map();
  
  try {
    const entries: [string, CheckinType[]][] = JSON.parse(stored);
    return new Map(entries);
  } catch (e) {
    console.warn('Failed to parse check-in state, resetting');
    return new Map();
  }
}

/**
 * Mark a check-in as done for an event
 */
export function markCheckinDone(eventId: string, type: CheckinType): void {
  const state = getCheckinState();
  const existing = state.get(eventId) || [];
  
  if (!existing.includes(type)) {
    existing.push(type);
    state.set(eventId, existing);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.entries()]));
    console.log(`✅ Marked ${type} check-in done for event ${eventId}`);
  }
}

/**
 * Check if a specific check-in has been done for an event
 */
export function hasCheckinBeenDone(eventId: string, type: CheckinType): boolean {
  const state = getCheckinState();
  return state.get(eventId)?.includes(type) ?? false;
}

/**
 * Determine which check-in type (if any) should trigger for an event
 * Returns null if no check-in is applicable
 */
export function getApplicableCheckin(event: CalendarEvent): CheckinType | null {
  const now = new Date();
  const start = new Date(event.start.dateTime || event.start.date || '');
  const end = new Date(event.end.dateTime || event.end.date || '');
  
  // Skip if invalid dates
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return null;
  }
  
  const hoursUntilStart = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
  const minutesSinceEnd = (now.getTime() - end.getTime()) / (1000 * 60);

  // Post-event: 15-60 minutes after end
  if (minutesSinceEnd >= 15 && minutesSinceEnd <= 60) {
    if (!hasCheckinBeenDone(event.id, 'post_event')) {
      return 'post_event';
    }
  }
  
  // Starting soon: 15-30 minutes before
  if (hoursUntilStart > 0.25 && hoursUntilStart <= 0.5) {
    if (!hasCheckinBeenDone(event.id, 'starting_soon')) {
      return 'starting_soon';
    }
  }
  
  // Approaching: 1-3 hours before
  if (hoursUntilStart > 1 && hoursUntilStart <= 3) {
    if (!hasCheckinBeenDone(event.id, 'approaching')) {
      return 'approaching';
    }
  }
  
  // Day before: 12-24 hours before
  if (hoursUntilStart > 12 && hoursUntilStart <= 24) {
    if (!hasCheckinBeenDone(event.id, 'day_before')) {
      return 'day_before';
    }
  }
  
  return null;
}

/**
 * Build a natural prompt based on check-in type
 */
export function buildEventCheckinPrompt(event: CalendarEvent, type: CheckinType): string {
  const eventName = event.summary || 'Untitled Event';
  const startTime = new Date(event.start.dateTime || event.start.date || '');
  const timeStr = startTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayStr = startTime.toLocaleDateString([], { weekday: 'long' });

  switch (type) {
    case 'day_before':
      return `
[SYSTEM EVENT: UPCOMING_EVENT_PREVIEW]
The user has "${eventName}" scheduled for tomorrow (${dayStr}) at ${timeStr}.

Your goal: Casually mention this upcoming event.
- Be curious/supportive: "I see you have ${eventName} tomorrow..."
- Offer to help: "Need me to change it?" or "Anything I can help you prep?"
- Match the vibe to the event type (excited for vacation, supportive for appointments)
- Keep it short and natural (1-2 sentences)
      `.trim();
      
    case 'approaching':
      return `
[SYSTEM EVENT: EVENT_APPROACHING]
The user has "${eventName}" coming up in a few hours (at ${timeStr}).

Your goal: Gentle reminder with offer to help.
- "Your ${eventName} is coming up at ${timeStr}..."
- Offer prep help if relevant
- Keep it brief and helpful (1-2 sentences)
      `.trim();
      
    case 'starting_soon':
      return `
[SYSTEM EVENT: EVENT_STARTING_SOON]
The user has "${eventName}" starting very soon (at ${timeStr}).

Your goal: Quick heads-up reminder.
- "Heads up - ${eventName} is in about 20 minutes!"
- Keep it very short and actionable (1 sentence)
      `.trim();
      
    case 'post_event':
      return `
[SYSTEM EVENT: EVENT_ENDED]
The user just finished "${eventName}".

Your goal: Check in about how it went.
- "How did ${eventName} go?"
- Offer to remember key takeaways: "Anything important to note?"
- If they share info, use store_user_info to save it
- Be warm and curious (1-2 sentences)
      `.trim();
  }
}

/**
 * Clean up old check-in states (events from previous weeks)
 */
export function cleanupOldCheckins(currentWeekEventIds: string[]): void {
  const state = getCheckinState();
  const currentIds = new Set(currentWeekEventIds);
  let removed = 0;
  
  for (const eventId of state.keys()) {
    if (!currentIds.has(eventId)) {
      state.delete(eventId);
      removed++;
    }
  }
  
  if (removed > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.entries()]));
    console.log(`🧹 Cleaned up ${removed} old event check-in states`);
  }
}

/**
 * Get a human-readable description of a check-in type
 */
export function getCheckinTypeDescription(type: CheckinType): string {
  switch (type) {
    case 'day_before':
      return 'Day before preview';
    case 'approaching':
      return 'Approaching reminder';
    case 'starting_soon':
      return 'Starting soon alert';
    case 'post_event':
      return 'Post-event follow-up';
  }
}

/**
 * Clear all check-in state (useful for testing)
 */
export function clearCheckinState(): void {
  localStorage.removeItem(STORAGE_KEY);
  console.log('🧹 Cleared all event check-in states');
}

