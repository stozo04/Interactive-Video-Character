/**
 * Past Events Context for Greeting Prompt
 *
 * Provides context about calendar events that happened since the last interaction.
 * Enables follow-up questions like "How was [event]?" if it happened
 * since the user last talked to Kayley.
 */

import { utcToCst, getCurrentCstDate, formatDateCst } from "./timezoneUtils";

export interface PastEvent {
  id: string;
  summary: string;
  date: Date;
  daysSince: number;
}

export interface PastEventsContext {
  hasEvents: boolean;
  events: PastEvent[];
  lastInteractionDate: Date | null;
}

/**
 * Filter calendar events that happened between last interaction and now
 * Converts UTC dates from database to CST
 */
export function filterPastEventsSinceLastInteraction(
  events: Array<{
    id: string;
    summary: string;
    start: { dateTime?: string; date?: string };
  }>,
  lastInteractionDateUtc: Date | string | null
): PastEvent[] {
  if (!lastInteractionDateUtc || !events || events.length === 0) {
    return [];
  }

  const lastInteraction = utcToCst(lastInteractionDateUtc);
  const now = getCurrentCstDate();
  const pastEvents: PastEvent[] = [];

  for (const event of events) {
    const eventDateStr = event.start.dateTime || event.start.date;
    if (!eventDateStr) continue;

    // Calendar events are typically in UTC or local timezone - convert to CST
    const eventDate = utcToCst(eventDateStr);

    // Event must be after last interaction AND before now
    if (eventDate > lastInteraction && eventDate < now) {
      const daysSince = Math.floor(
        (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      pastEvents.push({
        id: event.id,
        summary: event.summary,
        date: eventDate,
        daysSince,
      });
    }
  }

  // Sort by most recent first
  return pastEvents.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * Build the past events section for the greeting prompt
 */
export function buildPastEventsContext(
  pastEvents: PastEvent[],
  lastInteractionDateUtc: Date | string | null
): string {
  if (!pastEvents || pastEvents.length === 0) {
    return ""; // No past events to follow up on
  }

  const lastInteraction = lastInteractionDateUtc
    ? utcToCst(lastInteractionDateUtc)
    : null;

  // Limit to most significant/recent events (max 3)
  const eventsToMention = pastEvents.slice(0, 3);

  let prompt = `
====================================================
CALENDAR EVENTS SINCE LAST CONVERSATION
====================================================
You haven't talked since ${lastInteraction ? formatDateCst(lastInteraction) : "a while ago"}.
These events happened since then - consider following up:

`;

  for (const event of eventsToMention) {
    const dayWord =
      event.daysSince === 0
        ? "today"
        : event.daysSince === 1
          ? "yesterday"
          : `${event.daysSince} days ago`;

    prompt += `- "${event.summary}" (${dayWord})\n`;
  }

  prompt += `
FOLLOW-UP GUIDANCE:
- Ask how it went! "How was [event]?"
- Show genuine interest in their experience
- Don't force it if they want to talk about something else
`;

  return prompt;
}
