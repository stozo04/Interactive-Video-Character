/**
 * Calendar Awareness Service
 *
 * Checks for calendar events that completed while the user was away
 * and generates thoughtful messages about them.
 *
 * This creates the "she remembers my schedule" feeling without being needy.
 *
 * Examples:
 * - "Hope your interview went well! Can't wait to hear all about it"
 * - "Hey, hope everything went okay at the doctor. Thinking of you."
 * - "How'd the presentation go?? I bet you killed it."
 */

import { CalendarEvent } from '../calendarService';
import {
  createPendingMessage,
  hasUndeliveredMessage,
  type CreatePendingMessageInput,
} from './pendingMessageService';

// ============================================================================
// Types
// ============================================================================

export interface RecentlyCompletedEvent {
  event: CalendarEvent;
  minutesSinceEnd: number;
}

export interface EventImportance {
  isImportant: boolean;
  category: 'interview' | 'medical' | 'meeting' | 'social' | 'personal' | 'routine';
  messageStyle: 'supportive' | 'excited' | 'caring' | 'curious';
}

// ============================================================================
// Constants
// ============================================================================

// Events that ended within this window are candidates for messages
const MAX_MINUTES_SINCE_END = 180; // 3 hours

// Keywords that indicate important events worth messaging about
const IMPORTANT_EVENT_KEYWORDS: Record<string, EventImportance> = {
  // Interview-related
  interview: { isImportant: true, category: 'interview', messageStyle: 'supportive' },
  'job interview': { isImportant: true, category: 'interview', messageStyle: 'supportive' },
  screening: { isImportant: true, category: 'interview', messageStyle: 'supportive' },

  // Medical
  doctor: { isImportant: true, category: 'medical', messageStyle: 'caring' },
  dentist: { isImportant: true, category: 'medical', messageStyle: 'caring' },
  appointment: { isImportant: true, category: 'medical', messageStyle: 'caring' },
  therapy: { isImportant: true, category: 'medical', messageStyle: 'caring' },
  checkup: { isImportant: true, category: 'medical', messageStyle: 'caring' },

  // Important meetings
  presentation: { isImportant: true, category: 'meeting', messageStyle: 'excited' },
  pitch: { isImportant: true, category: 'meeting', messageStyle: 'excited' },
  review: { isImportant: true, category: 'meeting', messageStyle: 'curious' },
  'performance review': { isImportant: true, category: 'meeting', messageStyle: 'supportive' },

  // Social
  'dinner with': { isImportant: true, category: 'social', messageStyle: 'curious' },
  'lunch with': { isImportant: true, category: 'social', messageStyle: 'curious' },
  'coffee with': { isImportant: true, category: 'social', messageStyle: 'curious' },
  date: { isImportant: false, category: 'social', messageStyle: 'curious' }, // Too personal
  family: { isImportant: true, category: 'social', messageStyle: 'curious' },
  mom: { isImportant: true, category: 'social', messageStyle: 'curious' },
  dad: { isImportant: true, category: 'social', messageStyle: 'curious' },

  // Personal milestones
  exam: { isImportant: true, category: 'personal', messageStyle: 'supportive' },
  test: { isImportant: true, category: 'personal', messageStyle: 'supportive' },
  audition: { isImportant: true, category: 'personal', messageStyle: 'excited' },
};

// Events to ignore (routine stuff)
const IGNORE_KEYWORDS = [
  'lunch',
  'focus time',
  'focus',
  'block',
  'busy',
  'commute',
  'travel time',
  'prep',
  'break',
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Check calendar for recently completed events and maybe create a message.
 *
 * Called during idle time. Will create a pending message if:
 * 1. An important event just ended
 * 2. No message is already waiting
 *
 * @param userId - User ID
 * @param events - Recent calendar events
 * @param lastInteractionAt - When user last interacted (to calculate absence)
 * @returns The created pending message input, or null
 */
export async function checkCalendarForMessage(
  userId: string,
  events: CalendarEvent[],
  lastInteractionAt: Date
): Promise<CreatePendingMessageInput | null> {
  // Don't create if there's already a pending message
  const hasPending = await hasUndeliveredMessage(userId);
  if (hasPending) {
    console.log('[CalendarAwareness] Skipping - already has pending message');
    return null;
  }

  // Find events that ended while user was away
  const recentlyCompleted = getRecentlyCompletedEvents(events, lastInteractionAt);

  if (recentlyCompleted.length === 0) {
    return null;
  }

  // Find the most important event worth messaging about
  const importantEvent = findMostImportantEvent(recentlyCompleted);

  if (!importantEvent) {
    console.log('[CalendarAwareness] No important events found');
    return null;
  }

  // Generate a thoughtful message
  const message = generateCalendarMessage(importantEvent.event, importantEvent.importance);

  console.log(`[CalendarAwareness] Creating message for "${importantEvent.event.summary}"`);

  // Create the pending message
  const pendingMessage = await createPendingMessage(userId, message);

  return message;
}

/**
 * Get events that ended while the user was away.
 */
export function getRecentlyCompletedEvents(
  events: CalendarEvent[],
  lastInteractionAt: Date
): RecentlyCompletedEvent[] {
  const now = new Date();
  const result: RecentlyCompletedEvent[] = [];

  for (const event of events) {
    const endTime = new Date(event.end.dateTime || event.end.date || '');

    if (isNaN(endTime.getTime())) continue;

    // Event ended after user left and before now
    if (endTime > lastInteractionAt && endTime <= now) {
      const minutesSinceEnd = (now.getTime() - endTime.getTime()) / (1000 * 60);

      // Only consider events that ended within our window
      if (minutesSinceEnd <= MAX_MINUTES_SINCE_END) {
        result.push({ event, minutesSinceEnd });
      }
    }
  }

  return result;
}

/**
 * Find the most important event worth messaging about.
 */
function findMostImportantEvent(
  events: RecentlyCompletedEvent[]
): { event: CalendarEvent; importance: EventImportance } | null {
  for (const { event } of events) {
    const summary = (event.summary || '').toLowerCase();

    // Check if it's a routine event to ignore
    if (IGNORE_KEYWORDS.some((keyword) => summary.includes(keyword))) {
      continue;
    }

    // Check for important keywords
    for (const [keyword, importance] of Object.entries(IMPORTANT_EVENT_KEYWORDS)) {
      if (summary.includes(keyword.toLowerCase()) && importance.isImportant) {
        return { event, importance };
      }
    }
  }

  return null;
}

/**
 * Generate a thoughtful message about a completed event.
 */
function generateCalendarMessage(
  event: CalendarEvent,
  importance: EventImportance
): CreatePendingMessageInput {
  const eventName = event.summary || 'your event';

  // Generate message based on category and style
  const messages = getMessageTemplates(importance.category, importance.messageStyle);
  const messageText = fillTemplate(messages[Math.floor(Math.random() * messages.length)], eventName);

  return {
    messageText,
    messageType: 'text',
    trigger: 'calendar',
    triggerEventId: event.id,
    triggerEventTitle: event.summary,
    priority: 'normal',
    metadata: {
      category: importance.category,
      style: importance.messageStyle,
    },
  };
}

/**
 * Get message templates based on event category and style.
 */
function getMessageTemplates(
  category: EventImportance['category'],
  style: EventImportance['messageStyle']
): string[] {
  if (category === 'interview') {
    return [
      'Hope your {event} went well! Can\'t wait to hear all about it',
      'How\'d the {event} go?? I bet you killed it',
      'Thinking about you - hope {event} went great!',
    ];
  }

  if (category === 'medical') {
    return [
      'Hey, hope everything went okay at {event}. Thinking of you.',
      'Hope {event} went well! Let me know how you\'re feeling.',
      'Just wanted to check in - how did {event} go?',
    ];
  }

  if (category === 'meeting') {
    return [
      'How did {event} go?? I bet you nailed it',
      'Hope {event} went well! Curious to hear how it went.',
      'Just thinking about you - how\'d {event} go?',
    ];
  }

  if (category === 'social') {
    return [
      'How was {event}? I want the full download',
      'Hope you had a great time at {event}!',
      'How\'d {event} go? Tell me everything!',
    ];
  }

  if (category === 'personal') {
    return [
      'Hope {event} went well! Rooting for you',
      'How did {event} go?? Can\'t wait to hear!',
      'Thinking of you - hope {event} went great!',
    ];
  }

  // Default
  return [
    'Hope {event} went well!',
    'How did {event} go?',
  ];
}

/**
 * Fill in template placeholders.
 */
function fillTemplate(template: string, eventName: string): string {
  // Clean up event name (remove common prefixes)
  let cleanName = eventName
    .replace(/^(meeting|call|appointment|session)(\s*[-:])?\s*/i, '')
    .trim();

  // If the name is too generic or empty, use a generic phrase
  if (!cleanName || cleanName.length < 3) {
    cleanName = 'your appointment';
  }

  return template.replace(/{event}/g, cleanName);
}

/**
 * Analyze an event's importance (exported for testing).
 */
export function analyzeEventImportance(eventSummary: string): EventImportance | null {
  const summary = eventSummary.toLowerCase();

  // Check ignore list first
  if (IGNORE_KEYWORDS.some((keyword) => summary.includes(keyword))) {
    return null;
  }

  // Check for important keywords
  for (const [keyword, importance] of Object.entries(IMPORTANT_EVENT_KEYWORDS)) {
    if (summary.includes(keyword.toLowerCase())) {
      return importance;
    }
  }

  return null;
}
