// server/services/gogGmailService.ts
//
// Gmail-specific gogcli operations.

import { log } from '../runtimeLogger';
import {
  DEFAULT_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  execGogJson,
  execGogRaw,
} from './gogCore';

const runtimeLog = log.fromContext({ source: 'gogGmailService', route: 'server/gog/gmail' });
const CALLER = 'gogGmailService';

export interface GogEmailResult {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  body?: string;
}

function extractMessageBody(raw: any): string {
  return raw?.body || raw?.text || raw?.snippet || '';
}

function extractMessageHtml(raw: any): string {
  if (!raw || typeof raw !== 'object') {
    return '';
  }

  const htmlCandidates = [
    raw.html,
    raw.bodyHtml,
    raw.htmlBody,
    raw.content?.html,
    raw.payload?.body?.html,
    raw.payload?.html,
  ];

  for (const candidate of htmlCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return '';
}

/**
 * Search Gmail using Gmail search syntax. Returns structured results.
 */
export async function searchEmails(query: string, maxResults = 5): Promise<GogEmailResult[]> {
  const clamped = Math.min(Math.max(maxResults, 1), 10);
  runtimeLog.info('searchEmails', { source: CALLER, query, maxResults: clamped });

  // gog gmail search returns an array of thread objects
  const raw = await execGogJson<any>(
    ['gmail', 'search', query, '--max', String(clamped)],
    DEFAULT_TIMEOUT_MS,
    CALLER,
  );

  // gogcli search returns { threads: [...] } or an array directly
  const threads: any[] = Array.isArray(raw) ? raw : (raw?.threads || raw?.messages || []);

  const results: GogEmailResult[] = [];

  for (const thread of threads) {
    // Each thread may have messages; we take the first/latest
    const msg = thread.messages?.[0] || thread;

    results.push({
      messageId: msg.id || msg.messageId || '',
      threadId: thread.threadId || thread.id || msg.threadId || '',
      from: msg.from || msg.sender || '',
      subject: msg.subject || '',
      date: msg.date || msg.internalDate || '',
      snippet: msg.snippet || '',
      body: msg.body || msg.text || undefined,
    });
  }

  // If first result has no body, fetch it
  if (results.length > 0 && !results[0].body && results[0].messageId) {
    try {
      const body = await fetchEmailBody(results[0].messageId);
      if (body) {
        results[0].body = body.length > 800 ? body.slice(0, 800) + '...' : body;
      }
    } catch {
      // Non-fatal; snippet is enough
    }
  }

  runtimeLog.info('searchEmails complete', { source: CALLER, query, resultsCount: results.length });
  return results;
}

/**
 * Fetch full email body for a single message.
 */
export async function fetchEmailBody(messageId: string): Promise<string> {
  try {
    const raw = await execGogJson<any>(['gmail', 'get', messageId], DEFAULT_TIMEOUT_MS, CALLER);
    return extractMessageBody(raw);
  } catch (err) {
    runtimeLog.warning('fetchEmailBody failed', {
      source: CALLER,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  }
}

/**
 * Fetch full email HTML for a single message.
 */
export async function fetchEmailHtml(messageId: string): Promise<string> {
  try {
    const raw = await execGogJson<any>(['gmail', 'get', messageId], DEFAULT_TIMEOUT_MS, CALLER);
    return extractMessageHtml(raw);
  } catch (err) {
    runtimeLog.warning('fetchEmailHtml failed', {
      source: CALLER,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  }
}

/**
 * Get a full thread (all messages).
 */
export async function getThread(threadId: string): Promise<any> {
  return execGogJson(['gmail', 'thread', 'get', threadId], DEFAULT_TIMEOUT_MS, CALLER);
}

/**
 * Get Gmail history changes since a given historyId.
 * Returns raw gogcli output for the poller to process.
 */
export async function getGmailHistory(sinceHistoryId: string): Promise<any> {
  return execGogJson(['gmail', 'history', '--since', sinceHistoryId], DEFAULT_TIMEOUT_MS, CALLER);
}

/**
 * Archive a thread by removing the INBOX label.
 */
export async function archiveThread(threadId: string): Promise<boolean> {
  runtimeLog.info('archiveThread', { source: CALLER, threadId });
  try {
    await execGogRaw(
      ['gmail', 'thread', 'modify', threadId, '--remove', 'INBOX'],
      WRITE_TIMEOUT_MS,
      CALLER,
    );
    runtimeLog.info('archiveThread succeeded', { source: CALLER, threadId });
    return true;
  } catch (err) {
    runtimeLog.error('archiveThread failed', {
      source: CALLER,
      threadId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Archive a single message by modifying its labels.
 * Falls back to thread-level archive since gogcli prefers thread operations.
 */
export async function archiveEmail(messageId: string): Promise<boolean> {
  runtimeLog.info('archiveEmail (via batch modify)', { source: CALLER, messageId });
  try {
    await execGogRaw(
      ['gmail', 'batch', 'modify', messageId, '--remove', 'INBOX'],
      WRITE_TIMEOUT_MS,
      CALLER,
    );
    runtimeLog.info('archiveEmail succeeded', { source: CALLER, messageId });
    return true;
  } catch (err) {
    runtimeLog.error('archiveEmail failed', {
      source: CALLER,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Send a reply to an existing email thread.
 */
export async function sendReply(
  replyToMessageId: string,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  runtimeLog.info('sendReply', { source: CALLER, replyToMessageId, to, subject: subject.substring(0, 50) });

  const reSubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const signature = `\n\n-- Kayley\n(Steven's AI companion, responding on his behalf)`;
  const fullBody = body + signature;

  try {
    await execGogRaw(
      [
        'gmail', 'send',
        '--reply-to-message-id', replyToMessageId,
        '--quote',
        '--to', to,
        '--subject', reSubject,
        '--body', fullBody,
      ],
      WRITE_TIMEOUT_MS,
      CALLER,
    );
    runtimeLog.info('sendReply succeeded', { source: CALLER, to, replyToMessageId });
    return true;
  } catch (err) {
    runtimeLog.error('sendReply failed', {
      source: CALLER,
      replyToMessageId,
      to,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Send a new email (not a reply).
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  runtimeLog.info('sendEmail', { source: CALLER, to, subject: subject.substring(0, 50) });

  const signature = `\n\n-- Kayley\n(Steven's AI companion, responding on his behalf)`;
  const fullBody = body + signature;

  try {
    await execGogRaw(
      ['gmail', 'send', '--to', to, '--subject', subject, '--body', fullBody],
      WRITE_TIMEOUT_MS,
      CALLER,
    );
    runtimeLog.info('sendEmail succeeded', { source: CALLER, to });
    return true;
  } catch (err) {
    runtimeLog.error('sendEmail failed', {
      source: CALLER,
      to,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Get inbox stats (unread count, etc.)
 */
export async function getInboxStats(): Promise<{ messagesTotal: number; messagesUnread: number }> {
  try {
    const raw = await execGogJson<any>(['gmail', 'labels', 'get', 'INBOX'], DEFAULT_TIMEOUT_MS, CALLER);
    return {
      messagesTotal: raw?.messagesTotal ?? 0,
      messagesUnread: raw?.messagesUnread ?? 0,
    };
  } catch {
    return { messagesTotal: 0, messagesUnread: 0 };
  }
}
