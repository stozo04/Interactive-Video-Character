// src/services/emailProcessingService.ts
//
// Lightweight Gemini calls specifically for email processing.
// NO full pipeline machinery here — just focused generateContent calls.
//
// Three jobs:
//   1. generateEmailAnnouncement()  — Kayley reacts to a new email
//   2. generateEmailConfirmation()  — Kayley confirms after taking action
//   3. composePolishedReply()       — Takes Steven's rough intent + calendar context,
//                                     returns a well-written email body ready to send

import { GoogleGenAI } from '@google/genai';
import { clientLogger } from './clientLogger';
import type { NewEmailPayload, CalendarEvent } from '../types';

const log = clientLogger.scoped('EmailService');

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GEMINI_MODEL   = import.meta.env.VITE_GEMINI_MODEL   as string;

// Lazy-init so we don't blow up if the key is missing at import time
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return _ai;
}

// ============================================================
// Types
// ============================================================

export type EmailActionTaken = 'archive' | 'reply' | 'dismiss';

// ============================================================
// ANNOUNCEMENT
// Kayley sees the email for the first time and reacts.
// ============================================================

/**
 * Generates Kayley's casual announcement about a new email.
 * - Summarizes in 1-2 sentences
 * - Says whether it looks like spam/junk
 * - Asks Steven what he wants to do
 *
 * @param userContext - Optional pre-formatted string of user facts so Kayley
 *   recognizes the sender (e.g. "Steven Gates" → she knows who that is).
 *
 * Returns plain text — App.tsx handles TTS and chat history.
 */
export async function generateEmailAnnouncement(
  email: NewEmailPayload,
  userContext?: string,
): Promise<string> {
  log.info('Generating email announcement', { messageId: email.id, from: email.from, subject: email.subject });

  // Best available content: prefer full body, fall back to snippet, then subject only
  const rawContent = email.body?.trim() || email.snippet?.trim() || '';
  const bodyPreview = rawContent.slice(0, 600) + (rawContent.length > 600 ? '...' : '');
  const bodyLine = bodyPreview || '(no body preview available)';

  const contextSection = userContext
    ? `\nThings you know about Steven and the people in his life:\n${userContext}\n`
    : '';

  const prompt = `You are Kayley, Steven's best friend and AI companion. You just noticed a new email in his inbox.
${contextSection}
Keep it super casual — like you're texting a friend. 2-3 sentences max.
- Tell him who it's from and what it's about (1-2 sentences) — if you recognize the sender from your context, use their name naturally
- If it looks like spam or junk, say so honestly
- End by asking what he wants to do: archive it, reply, or just ignore it

Email details:
From: ${email.from}
Subject: ${email.subject}
Body: ${bodyLine}

Do NOT say "Hey" as your opener. Be natural. Do NOT ask clarifying questions.`;

  try {
    const result = await getAI().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const text = result.text?.trim() ?? '';
    log.info('Announcement generated', { messageId: email.id, length: text.length });
    return text || `Got an email from ${email.from} — subject: "${email.subject}". Want me to do anything with it?`;
  } catch (err) {
    log.error('Failed to generate email announcement', { messageId: email.id, err: String(err) });
    // Safe fallback — Kayley still notifies Steven even if Gemini is down
    return `New email from ${email.from}: "${email.subject}". Want me to archive it or leave it?`;
  }
}

// ============================================================
// CONFIRMATION
// Kayley confirms what she just did after executing an action.
// ============================================================

/**
 * Generates Kayley's casual confirmation after taking an email action.
 * - 1 sentence, in Kayley's voice
 * - Matches the action taken (archive / reply / dismissed)
 *
 * Returns plain text — App.tsx handles TTS and chat history.
 */
export async function generateEmailConfirmation(
  action: EmailActionTaken,
  email: NewEmailPayload
): Promise<string> {
  log.info('Generating email confirmation', { action, messageId: email.id });

  // Extract a readable name from the "From" field (e.g. "Cindy Walther <cindy@...>" → "Cindy Walther")
  const fromName = email.from.replace(/<[^>]+>/, '').trim() || email.from;

  const actionDescriptions: Record<EmailActionTaken, string> = {
    archive: `archived the email from ${fromName} about "${email.subject}"`,
    reply:   `sent a reply to ${fromName} about "${email.subject}"`,
    dismiss: `left the email from ${fromName} alone (no action taken)`,
  };

  const prompt = `You are Kayley, Steven's best friend. You just ${actionDescriptions[action]}.

Give a quick, casual 1-sentence confirmation. Be natural — a little personality is good.
For a reply, mention you'll let him know if they respond.
Keep it short. No need for a sign-off.`;

  try {
    const result = await getAI().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const text = result.text?.trim() ?? '';
    log.info('Confirmation generated', { action, messageId: email.id });
    return text || defaultConfirmation(action, fromName);
  } catch (err) {
    log.error('Failed to generate email confirmation', { action, messageId: email.id, err: String(err) });
    return defaultConfirmation(action, fromName);
  }
}

/** Safe fallback confirmations if Gemini call fails */
function defaultConfirmation(action: EmailActionTaken, fromName: string): string {
  switch (action) {
    case 'archive': return `Done — archived that one from ${fromName}!`;
    case 'reply':   return `Sent! I'll let you know if ${fromName} writes back.`;
    case 'dismiss': return `Got it, leaving it alone.`;
  }
}

// ============================================================
// COMPOSE POLISHED REPLY
// Takes Steven's rough shorthand intent and turns it into a
// well-written, friendly email body. Automatically pulls in
// calendar events if they're relevant to what he said.
// ============================================================

/**
 * Converts Steven's rough reply intent into a polished email body.
 *
 * Steven might type "tell her I'm travelling" or "let him know super busy this week"
 * from his phone. This turns that into a proper, warm email Kayley would be proud to send.
 *
 * Calendar events are injected automatically — Kayley uses them if relevant
 * (e.g. mentions travel dates, busy periods) without Steven having to spell it out.
 *
 * Returns the email body ONLY — no greeting, no signature (those are handled elsewhere).
 */
export async function composePolishedReply(
  userIntent: string,
  originalEmail: NewEmailPayload,
  calendarEvents: CalendarEvent[]
): Promise<string> {
  log.info('Composing polished reply', {
    messageId: originalEmail.id,
    intentLength: userIntent.length,
    calendarEventCount: calendarEvents.length,
  });

  // Format upcoming events for context.
  // Exclude all-day events (date-only, no dateTime) — those are holidays/observances
  // that have no business appearing in a reply about an unrelated topic.
  const timedEvents = calendarEvents.filter(e => !!e.start?.dateTime);
  const calendarContext = timedEvents.length > 0
    ? timedEvents.slice(0, 10).map(e => {
        const start = e.start?.dateTime || 'unknown time';
        const end   = e.end?.dateTime   || '';
        return `• ${e.summary} — ${start}${end ? ` to ${end}` : ''}`;
      }).join('\n')
    : null;

  const prompt = `You are Kayley, Steven's AI companion. Your job is to write a polished, friendly email reply on his behalf.

The email you're replying to:
From: ${originalEmail.from}
Subject: ${originalEmail.subject}
Body: ${(originalEmail.body || originalEmail.snippet || '').slice(0, 400)}

Steven's response (may be rough shorthand — he might be on his phone or busy):
"${userIntent}"
${calendarContext ? `\nSteven's upcoming calendar (for reference ONLY — do NOT mention any of these unless Steven's message explicitly references scheduling, travel, availability, or a specific event):\n${calendarContext}` : ''}

Write the email body only. Rules:
- Write as Kayley, Steven's AI companion — you are relaying Steven's message, NOT impersonating him
- Refer to Steven in third person (e.g. "Steven said he'll...", "He mentioned...", "I let him know and he said...")
- Warm and friendly, not stiff or corporate
- Only reference calendar events if Steven's intent explicitly mentions dates, scheduling, or availability — never volunteer calendar details unprompted
- Keep it concise — 2-4 sentences is usually right
- Do NOT start with "Dear" — casual openers like "Hey!" or the person's name are fine
- Do NOT include a sign-off or signature (that's added automatically)
- Do NOT write as if you are Steven — you are his assistant passing along his message`;

  try {
    const result = await getAI().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const text = result.text?.trim() ?? '';
    log.info('Polished reply composed', { messageId: originalEmail.id, length: text.length });
    return text || userIntent; // fallback to raw intent if Gemini fails
  } catch (err) {
    log.error('Failed to compose polished reply', { messageId: originalEmail.id, err: String(err) });
    return userIntent; // never block the send — use raw intent as fallback
  }
}
