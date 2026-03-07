// server/services/calendarHeartbeat.ts
//
// 15-minute heartbeat that checks Google Calendar for:
//   - Events starting in the next ~20 minutes (upcoming alerts)
//   - Events that ended in the last ~20 minutes (follow-up check-ins)
//
// Time-gated: 8am-7pm CST only.
// Delivers to Telegram + WhatsApp.
// Persists messages to conversation_history so Kayley remembers what she said.

import { fetchCalendarWindow as gogFetchCalendarWindow, type GogCalendarEvent } from './gogService';
import { ai, GEMINI_MODEL } from './ai/geminiClient';
import { bot, getStevenChatId } from '../telegram/telegramClient';
import { getActiveSock } from '../whatsapp/baileyClient';
import {
  appendConversationHistory,
  getTodaysInteractionId,
} from '../../src/services/conversationHistoryService';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[CalendarHeartbeat]';
const runtimeLog = log.fromContext({ source: 'calendarHeartbeat', route: 'server/heartbeat' });

const TICK_MS = 15 * 60 * 1000;       // 15 minutes
const WINDOW_MS = 20 * 60 * 1000;     // 20-minute window (covers drift)
const TIMEZONE = 'America/Chicago';

// Dedup: track alerted events so we don't re-alert on the next tick.
// Key: "eventId:upcoming" or "eventId:followup"
const alertedEvents = new Set<string>();
let lastDedupeReset = '';

// ============================================================================
// Helpers
// ============================================================================

// Use GogCalendarEvent from gogService (same shape)
type HeartbeatCalendarEvent = GogCalendarEvent;

function getCstHour(): number {
  const cstStr = new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
  return new Date(cstStr).getHours();
}

function isWithinActiveHours(): boolean {
  const hour = getCstHour();
  return hour >= 8 && hour < 19;
}

function resetDedupeIfNewDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastDedupeReset) {
    alertedEvents.clear();
    lastDedupeReset = today;
  }
}

function dedupeKey(eventId: string, type: 'upcoming' | 'followup'): string {
  return `${eventId}:${type}`;
}

// ============================================================================
// Calendar API (via gogcli)
// ============================================================================

// fetchCalendarWindow is now imported from gogService
// Filtering (cancelled/declined) is handled inside gogService.fetchCalendarWindow

// ============================================================================
// Message Generation (Gemini)
// ============================================================================

async function generateHeartbeatMessage(
  event: HeartbeatCalendarEvent,
  type: 'upcoming' | 'followup',
): Promise<string | null> {
  const eventTime = event.start.dateTime
    ? new Date(event.start.dateTime).toLocaleTimeString('en-US', {
        timeZone: TIMEZONE,
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'all day';

  const locationLine = event.location ? `Location: ${event.location}` : '';
  const descriptionLine = event.description ? `Description: ${event.description}` : '';

  const typeInstruction =
    type === 'upcoming'
      ? 'Generate a brief heads-up about this upcoming event. Match tone to the event type (playful for restaurants/social, supportive for medical, excited for concerts/fun). 1-2 sentences max.'
      : [
          'Decide if this event warrants a follow-up check-in.',
          'Events worth following up on: medical appointments, concerts, important meetings, dates, interviews, travel.',
          'Events NOT worth following up on: generic reminders, lunch breaks, routine standups, "test" events.',
          'If it does NOT warrant a follow-up, respond with exactly: SKIP',
          'If it DOES warrant a follow-up, generate a brief caring check-in (1-2 sentences). Ask how it went, match tone to the event type.',
        ].join('\n');

  const prompt = [
    `EVENT: "${event.summary}" at ${eventTime}`,
    locationLine,
    descriptionLine,
    '',
    typeInstruction,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.7,
      systemInstruction:
        'You are Kayley Adams, a warm and caring AI companion. Write a brief message (1-2 sentences) as if texting your boyfriend Steven about a calendar event. Be natural, not robotic. No excessive emojis.',
      maxOutputTokens: 150,
    },
  });

  const text = response.text?.trim() || '';

  // For follow-ups, the model may respond with SKIP
  if (type === 'followup' && text.toUpperCase().startsWith('SKIP')) {
    return null;
  }

  return text || `Hey! You have "${event.summary}" ${type === 'upcoming' ? 'coming up soon' : 'that just ended'}.`;
}

// ============================================================================
// Delivery
// ============================================================================

async function deliverMessage(message: string): Promise<void> {
  // Telegram
  const chatId = getStevenChatId();
  if (chatId) {
    try {
      await bot.api.sendMessage(chatId, message);
      runtimeLog.info('Heartbeat delivered to Telegram', { source: 'calendarHeartbeat' });
    } catch (err) {
      runtimeLog.error('Failed to deliver to Telegram', {
        source: 'calendarHeartbeat',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // WhatsApp
  const sock = getActiveSock();
  const stevenJid = process.env.WHATSAPP_STEVEN_JID;
  if (sock && stevenJid) {
    try {
      await sock.sendMessage(stevenJid, { text: message });
      runtimeLog.info('Heartbeat delivered to WhatsApp', { source: 'calendarHeartbeat' });
    } catch (err) {
      runtimeLog.error('Failed to deliver to WhatsApp', {
        source: 'calendarHeartbeat',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function persistMessage(message: string): Promise<void> {
  try {
    const interactionId = await getTodaysInteractionId();
    const logId = crypto.randomUUID();
    await appendConversationHistory(
      [{ role: 'model', text: message }],
      interactionId ?? undefined,
      logId,
    );
  } catch (err) {
    runtimeLog.error('Failed to persist heartbeat to conversation_history', {
      source: 'calendarHeartbeat',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// Tick
// ============================================================================

async function tick(): Promise<void> {
  if (!isWithinActiveHours()) {
    return; // Silent skip outside 8am-7pm CST
  }

  resetDedupeIfNewDay();

  const now = new Date();

  try {
    // --- Upcoming events (starting in the next ~20 min) ---
    const upcomingEvents = await gogFetchCalendarWindow(
      now,
      new Date(now.getTime() + WINDOW_MS),
    );

    for (const event of upcomingEvents) {
      if (!event.start.dateTime) continue; // Skip all-day events
      const key = dedupeKey(event.id, 'upcoming');
      if (alertedEvents.has(key)) continue;

      runtimeLog.info('Upcoming event detected', {
        source: 'calendarHeartbeat',
        eventId: event.id,
        summary: event.summary,
        startTime: event.start.dateTime,
      });

      const message = await generateHeartbeatMessage(event, 'upcoming');
      if (message) {
        await deliverMessage(message);
        await persistMessage(message);
      }
      alertedEvents.add(key);
    }

    // --- Recently ended events (ended in the last ~20 min) ---
    const recentEvents = await gogFetchCalendarWindow(
      new Date(now.getTime() - WINDOW_MS),
      now,
    );

    for (const event of recentEvents) {
      if (!event.end.dateTime) continue; // Skip all-day events
      const endTime = new Date(event.end.dateTime);
      if (endTime > now) continue; // Event hasn't ended yet

      const key = dedupeKey(event.id, 'followup');
      if (alertedEvents.has(key)) continue;

      runtimeLog.info('Recently ended event detected', {
        source: 'calendarHeartbeat',
        eventId: event.id,
        summary: event.summary,
        endTime: event.end.dateTime,
      });

      const message = await generateHeartbeatMessage(event, 'followup');
      if (message) {
        await deliverMessage(message);
        await persistMessage(message);
      }
      // Mark as alerted even if SKIP (so we don't re-evaluate)
      alertedEvents.add(key);
    }
  } catch (err) {
    runtimeLog.error('Calendar heartbeat tick failed', {
      source: 'calendarHeartbeat',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

let intervalId: NodeJS.Timeout | null = null;

export function startCalendarHeartbeat(): { stop: () => void } {
  console.log(
    `${LOG_PREFIX} Starting (every ${TICK_MS / 60000} min, 8am-7pm CST)`,
  );
  runtimeLog.info('Calendar heartbeat started', {
    source: 'calendarHeartbeat',
    tickMs: TICK_MS,
    activeHours: '8am-7pm CST',
  });

  // First tick after a short delay (let Telegram/WhatsApp connect first)
  setTimeout(() => {
    tick().catch((err) => {
      runtimeLog.error('Initial heartbeat tick failed', {
        source: 'calendarHeartbeat',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 15_000);

  intervalId = setInterval(() => {
    tick().catch((err) => {
      runtimeLog.error('Heartbeat tick failed', {
        source: 'calendarHeartbeat',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, TICK_MS);

  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log(`${LOG_PREFIX} Stopped`);
        runtimeLog.info('Calendar heartbeat stopped', { source: 'calendarHeartbeat' });
      }
    },
  };
}
