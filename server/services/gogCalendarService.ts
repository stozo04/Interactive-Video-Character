// server/services/gogCalendarService.ts
//
// Calendar-specific gogcli operations.

import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { log } from '../runtimeLogger';
import {
  DEFAULT_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  execGogJson,
  execGogRaw,
} from './gogCore';

const runtimeLog = log.fromContext({ source: 'gogCalendarService', route: 'server/gog/calendar' });
const CALLER = 'gogCalendarService';

const CALENDAR_DEFAULT_TIMEZONE = 'America/Chicago';
const LOCAL_ISO_NO_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

export interface GogCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
  attendees?: Array<{ self?: boolean; responseStatus?: string; email?: string }>;
}

/**
 * List calendar events for a time range.
 */
export async function listCalendarEvents(options: {
  from?: string;   // ISO string or relative like "today"
  to?: string;     // ISO string or relative
  days?: number;   // Shorthand: next N days from now
  calendarId?: string;
  max?: number;
}): Promise<GogCalendarEvent[]> {
  const args = ['calendar', 'events'];

  // Calendar ID (default: primary)
  args.push(options.calendarId || 'primary');

  if (options.days) {
    args.push('--days', String(options.days));
  } else if (options.from && options.to) {
    args.push('--from', options.from, '--to', options.to);
  } else if (options.from) {
    args.push('--from', options.from);
    if (!options.to) {
      // Default to 7 days if only from is given
      args.push('--days', '7');
    }
  } else {
    // Default: today
    args.push('--today');
  }

  if (options.max) {
    args.push('--max', String(options.max));
  }

  runtimeLog.info('listCalendarEvents', { source: CALLER, args: args.join(' ') });

  const raw = await execGogJson<any>(args, DEFAULT_TIMEOUT_MS, CALLER);

  // gogcli returns { events: [...] } or an array
  const events: any[] = Array.isArray(raw) ? raw : (raw?.events || []);

  // Filter cancelled/declined
  return events.filter((event: any) => {
    if (event.status === 'cancelled') return false;
    if (event.attendees) {
      const self = event.attendees.find((a: any) => a.self);
      if (self?.responseStatus === 'declined') return false;
    }
    return true;
  });
}

/**
 * Fetch events in a specific time window (ISO dates).
 * Used by calendarHeartbeat.
 */
export async function fetchCalendarWindow(
  timeMin: Date,
  timeMax: Date,
): Promise<GogCalendarEvent[]> {
  return listCalendarEvents({
    from: timeMin.toISOString(),
    to: timeMax.toISOString(),
    max: 10,
  });
}

/**
 * Create a calendar event.
 */
export async function createCalendarEvent(options: {
  summary: string;
  start: string;      // ISO datetime
  end: string;        // ISO datetime
  location?: string;
  attendees?: string; // comma-separated emails
  timeZone?: string;
}): Promise<any> {
  runtimeLog.info('createCalendarEvent', { source: CALLER, summary: options.summary });
  // Product requirement: all calendar times are interpreted in CST.
  const resolvedTimeZone = CALENDAR_DEFAULT_TIMEZONE;
  const normalizedStart = normalizeCalendarDateTimeForGog(options.start, resolvedTimeZone);
  const normalizedEnd = normalizeCalendarDateTimeForGog(options.end, resolvedTimeZone);

  const args = ['calendar', 'create', 'primary'];

  args.push('--summary', options.summary);
  args.push('--from', normalizedStart);
  args.push('--to', normalizedEnd);

  if (options.location) {
    args.push('--location', options.location);
  }
  if (options.attendees) {
    args.push('--attendees', options.attendees);
  }

  runtimeLog.info('createCalendarEvent normalized_window', {
    source: CALLER,
    summary: options.summary,
    timeZone: resolvedTimeZone,
    startRaw: options.start,
    endRaw: options.end,
    startNormalized: normalizedStart,
    endNormalized: normalizedEnd,
  });

  const result = await execGogJson<any>(args, WRITE_TIMEOUT_MS, CALLER);
  runtimeLog.info('createCalendarEvent succeeded', { source: CALLER, summary: options.summary });
  return result;
}

/**
 * Update a calendar event.
 */
export async function updateCalendarEvent(options: {
  eventId: string;
  summary?: string;
  start?: string;
  end?: string;
  location?: string;
}): Promise<boolean> {
  runtimeLog.info('updateCalendarEvent', {
    source: CALLER,
    eventId: options.eventId,
    hasSummary: !!options.summary,
    hasStart: !!options.start,
    hasEnd: !!options.end,
    hasLocation: !!options.location,
  });

  const args = ['calendar', 'update', 'primary', options.eventId];
  if (options.summary) {
    args.push('--summary', options.summary);
  }
  if (options.start) {
    args.push('--from', options.start);
  }
  if (options.end) {
    args.push('--to', options.end);
  }
  if (options.location) {
    args.push('--location', options.location);
  }

  try {
    await execGogRaw(args, WRITE_TIMEOUT_MS, CALLER);
    runtimeLog.info('updateCalendarEvent succeeded', {
      source: CALLER,
      eventId: options.eventId,
    });
    return true;
  } catch (err) {
    runtimeLog.error('updateCalendarEvent failed', {
      source: CALLER,
      eventId: options.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function normalizeCalendarDateTimeForGog(value: string, timeZone: string): string {
  const trimmed = value.trim();
  if (!LOCAL_ISO_NO_ZONE_RE.test(trimmed)) {
    return trimmed;
  }

  // Convert local wall-clock time in target timezone -> RFC3339 with UTC offset.
  const utcDate = fromZonedTime(trimmed, timeZone);
  return formatInTimeZone(utcDate, timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * Delete a calendar event.
 */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  runtimeLog.info('deleteCalendarEvent', { source: CALLER, eventId });
  try {
    await execGogRaw(
      ['calendar', 'delete', 'primary', eventId, '--force'],
      WRITE_TIMEOUT_MS,
      CALLER,
    );
    runtimeLog.info('deleteCalendarEvent succeeded', { source: CALLER, eventId });
    return true;
  } catch (err) {
    runtimeLog.error('deleteCalendarEvent failed', {
      source: CALLER,
      eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

