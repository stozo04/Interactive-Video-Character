/**
 * Past Events Context for Greeting Prompt
 *
 * Provides context about calendar events that happened since the last interaction.
 * Enables natural follow-up about events that occurred while you weren't talking.
 */

import { DailyLogisticsContext } from "../builders";
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
  dailyLogisticsContext: DailyLogisticsContext
): string {
  let pastEvents: PastEvent[] = [];
  if (
    dailyLogisticsContext?.pastCalendarEvents &&
    dailyLogisticsContext?.lastInteractionDateUtc
  ) {
    pastEvents = filterPastEventsSinceLastInteraction(
      dailyLogisticsContext.pastCalendarEvents,
      dailyLogisticsContext.lastInteractionDateUtc
    );
  }

  if (!pastEvents || pastEvents.length === 0) {
    return "";
  }

  // Limit to most recent events (max 3)
  const eventsToMention = pastEvents.slice(0, 3);

  const eventList = eventsToMention
    .map(({ summary, daysSince }) => {
      const dayWord =
        daysSince === 0
          ? "earlier today"
          : daysSince === 1
            ? "yesterday"
            : `${daysSince} days ago`;
      return `- "${summary}" (${dayWord})`;
    })
    .join("\n");

  return `
====================================================
PAST EVENTS (since you last talked)
====================================================
These happened since your last conversation:
${eventList}

Tone: Curious, interested in how things went.
Direction: Ask about one or two if it feels natural. Don't rapid-fire questions about all of them—pick what seems most significant or interesting.
`;
}