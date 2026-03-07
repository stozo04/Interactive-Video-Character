// server/services/gogService.ts
//
// Thin wrapper around the `gog` CLI (gogcli) for Google service access.
// Replaces direct Google REST API calls + OAuth token management.
// All token refresh is handled by gogcli internally.

import { execFile } from 'node:child_process';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[GogService]';
const runtimeLog = log.fromContext({ source: 'gogService', route: 'server/gog' });

// Default timeout for CLI commands (15 seconds — most complete in < 3s)
const DEFAULT_TIMEOUT_MS = 15_000;
// Longer timeout for send/modify operations
const WRITE_TIMEOUT_MS = 30_000;

// GOG_ACCOUNT env var should be set, or pass --account to commands
const GOG_ACCOUNT = process.env.GOG_ACCOUNT || '';

// ============================================================================
// Core execution
// ============================================================================

interface GogExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a gog CLI command and return raw stdout/stderr.
 * Throws on non-zero exit code or timeout.
 */
function execGogRaw(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GogExecResult> {
  return new Promise((resolve, reject) => {
    // Always request JSON output and inject account if configured
    const fullArgs = ['--json', ...args];
    if (GOG_ACCOUNT && !args.includes('--account')) {
      fullArgs.unshift('--account', GOG_ACCOUNT);
    }

    runtimeLog.info('Executing gog command', {
      source: 'gogService',
      args: fullArgs.join(' '),
    });

    const startMs = Date.now();

    execFile('gog', fullArgs, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startMs;

      if (error) {
        runtimeLog.error('gog command failed', {
          source: 'gogService',
          args: fullArgs.join(' '),
          exitCode: (error as any).code ?? null,
          stderr: stderr?.substring(0, 500) || '',
          durationMs,
        });
        reject(new GogError(
          `gog ${args[0]} failed: ${stderr || error.message}`,
          (error as any).code ?? 1,
          stderr,
        ));
        return;
      }

      runtimeLog.info('gog command completed', {
        source: 'gogService',
        args: fullArgs.join(' '),
        durationMs,
        stdoutLength: stdout?.length ?? 0,
      });

      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
      });
    });
  });
}

/**
 * Execute a gog command and parse JSON output.
 */
async function execGogJson<T = unknown>(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const result = await execGogRaw(args, timeoutMs);
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    runtimeLog.error('Failed to parse gog JSON output', {
      source: 'gogService',
      args: args.join(' '),
      stdout: result.stdout.substring(0, 500),
    });
    throw new GogError(`Failed to parse JSON from gog ${args[0]}`, 0, result.stdout);
  }
}

export class GogError extends Error {
  exitCode: number;
  stderr: string;

  constructor(message: string, exitCode: number, stderr: string) {
    super(message);
    this.name = 'GogError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// ============================================================================
// Gmail: Search
// ============================================================================

export interface GogEmailResult {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  body?: string;
}

/**
 * Search Gmail using Gmail search syntax. Returns structured results.
 */
export async function searchEmails(query: string, maxResults = 5): Promise<GogEmailResult[]> {
  const clamped = Math.min(Math.max(maxResults, 1), 10);
  runtimeLog.info('searchEmails', { source: 'gogService', query, maxResults: clamped });

  // gog gmail search returns an array of thread objects
  const raw = await execGogJson<any>(
    ['gmail', 'search', query, '--max', String(clamped)],
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
      // Non-fatal — snippet is enough
    }
  }

  runtimeLog.info('searchEmails complete', { source: 'gogService', query, resultsCount: results.length });
  return results;
}

// ============================================================================
// Gmail: Read
// ============================================================================

/**
 * Fetch full email body for a single message.
 */
export async function fetchEmailBody(messageId: string): Promise<string> {
  try {
    const raw = await execGogJson<any>(['gmail', 'get', messageId]);
    // gogcli message detail includes body/text
    return raw?.body || raw?.text || raw?.snippet || '';
  } catch (err) {
    runtimeLog.warning('fetchEmailBody failed', {
      source: 'gogService',
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
  return execGogJson(['gmail', 'thread', 'get', threadId]);
}

// ============================================================================
// Gmail: History (polling)
// ============================================================================

/**
 * Get Gmail history changes since a given historyId.
 * Returns raw gogcli output for the poller to process.
 */
export async function getGmailHistory(sinceHistoryId: string): Promise<any> {
  return execGogJson(['gmail', 'history', '--since', sinceHistoryId]);
}

// ============================================================================
// Gmail: Actions (archive, send, reply)
// ============================================================================

/**
 * Archive a thread by removing the INBOX label.
 */
export async function archiveThread(threadId: string): Promise<boolean> {
  runtimeLog.info('archiveThread', { source: 'gogService', threadId });
  try {
    await execGogRaw(
      ['gmail', 'thread', 'modify', threadId, '--remove', 'INBOX'],
      WRITE_TIMEOUT_MS,
    );
    runtimeLog.info('archiveThread succeeded', { source: 'gogService', threadId });
    return true;
  } catch (err) {
    runtimeLog.error('archiveThread failed', {
      source: 'gogService',
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
  runtimeLog.info('archiveEmail (via batch modify)', { source: 'gogService', messageId });
  try {
    await execGogRaw(
      ['gmail', 'batch', 'modify', messageId, '--remove', 'INBOX'],
      WRITE_TIMEOUT_MS,
    );
    runtimeLog.info('archiveEmail succeeded', { source: 'gogService', messageId });
    return true;
  } catch (err) {
    runtimeLog.error('archiveEmail failed', {
      source: 'gogService',
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
  runtimeLog.info('sendReply', { source: 'gogService', replyToMessageId, to, subject: subject.substring(0, 50) });

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
    );
    runtimeLog.info('sendReply succeeded', { source: 'gogService', to, replyToMessageId });
    return true;
  } catch (err) {
    runtimeLog.error('sendReply failed', {
      source: 'gogService',
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
  runtimeLog.info('sendEmail', { source: 'gogService', to, subject: subject.substring(0, 50) });

  const signature = `\n\n-- Kayley\n(Steven's AI companion, responding on his behalf)`;
  const fullBody = body + signature;

  try {
    await execGogRaw(
      ['gmail', 'send', '--to', to, '--subject', subject, '--body', fullBody],
      WRITE_TIMEOUT_MS,
    );
    runtimeLog.info('sendEmail succeeded', { source: 'gogService', to });
    return true;
  } catch (err) {
    runtimeLog.error('sendEmail failed', {
      source: 'gogService',
      to,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ============================================================================
// Gmail: Labels
// ============================================================================

/**
 * Get inbox stats (unread count, etc.)
 */
export async function getInboxStats(): Promise<{ messagesTotal: number; messagesUnread: number }> {
  try {
    const raw = await execGogJson<any>(['gmail', 'labels', 'get', 'INBOX']);
    return {
      messagesTotal: raw?.messagesTotal ?? 0,
      messagesUnread: raw?.messagesUnread ?? 0,
    };
  } catch {
    return { messagesTotal: 0, messagesUnread: 0 };
  }
}

// ============================================================================
// Calendar: Events
// ============================================================================

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

  runtimeLog.info('listCalendarEvents', { source: 'gogService', args: args.join(' ') });

  const raw = await execGogJson<any>(args);

  // gogcli returns { events: [...] } or an array
  const events: any[] = Array.isArray(raw) ? raw : (raw?.events || []);

  // Filter cancelled/declined (same logic as before)
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
  start: string;     // ISO datetime
  end: string;       // ISO datetime
  location?: string;
  attendees?: string; // comma-separated emails
  timeZone?: string;
}): Promise<any> {
  runtimeLog.info('createCalendarEvent', { source: 'gogService', summary: options.summary });

  const args = [
    'calendar', 'create',
    options.timeZone ? options.start : 'primary',
  ];

  // If timeZone was specified, calendar ID is 'primary' which is the first positional arg
  if (!options.timeZone) {
    // First positional arg is calendarId
    args.length = 0;
    args.push('calendar', 'create', 'primary');
  }

  args.push('--summary', options.summary);
  args.push('--from', options.start);
  args.push('--to', options.end);

  if (options.location) {
    args.push('--location', options.location);
  }
  if (options.attendees) {
    args.push('--attendees', options.attendees);
  }

  const result = await execGogJson<any>(args, WRITE_TIMEOUT_MS);
  runtimeLog.info('createCalendarEvent succeeded', { source: 'gogService', summary: options.summary });
  return result;
}

/**
 * Delete a calendar event.
 */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  runtimeLog.info('deleteCalendarEvent', { source: 'gogService', eventId });
  try {
    await execGogRaw(
      ['calendar', 'delete', 'primary', eventId, '--force'],
      WRITE_TIMEOUT_MS,
    );
    runtimeLog.info('deleteCalendarEvent succeeded', { source: 'gogService', eventId });
    return true;
  } catch (err) {
    runtimeLog.error('deleteCalendarEvent failed', {
      source: 'gogService',
      eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ============================================================================
// General CLI (for google_cli tool)
// ============================================================================

// Top-level commands allowed for the google_cli tool
const ALLOWED_COMMANDS = new Set([
  'gmail', 'calendar', 'contacts', 'drive', 'tasks', 'time',
]);

// Per-service write permissions. Services not listed here are read-only.
// Maps service → set of allowed write subcommands.
const ALLOWED_WRITE_SUBCOMMANDS: Record<string, Set<string>> = {
  gmail:    new Set(['send', 'modify', 'batch']),               // send + archive (modify/batch for label changes). No delete.
  calendar: new Set(['create', 'update', 'delete']),            // full CRUD
  tasks:    new Set(['create', 'add', 'update', 'done', 'undo', 'delete', 'clear']), // full CRUD
  contacts: new Set(['create', 'update']),                      // CRU — no delete
  drive:    new Set(['create', 'upload', 'update', 'mkdir']),   // CRU — no delete
};

// Subcommands that are ALWAYS blocked regardless of service
const ALWAYS_BLOCKED = new Set([
  'vacation', 'delegates', 'filters',  // gmail admin settings
]);

/**
 * Execute a general gog command for the google_cli tool.
 * Write operations are allowed per-service according to ALLOWED_WRITE_SUBCOMMANDS.
 */
export async function execGeneralCommand(command: string): Promise<string> {
  const parts = command.trim().split(/\s+/);
  const topLevel = parts[0];

  if (!topLevel || !ALLOWED_COMMANDS.has(topLevel)) {
    throw new GogError(
      `Command "${topLevel}" is not allowed. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`,
      1, '',
    );
  }

  // Check for always-blocked subcommands
  const hasAlwaysBlocked = parts.some(p => ALWAYS_BLOCKED.has(p));
  if (hasAlwaysBlocked) {
    throw new GogError(
      `Blocked subcommand in "${command}". Admin settings cannot be changed via this tool.`,
      1, '',
    );
  }

  // Check write subcommands against per-service allowlist
  const serviceWriteAllowed = ALLOWED_WRITE_SUBCOMMANDS[topLevel] || new Set();
  const writeSubcommands = new Set(['send', 'delete', 'create', 'update', 'modify', 'batch', 'remove', 'add', 'done', 'undo', 'clear', 'upload', 'mkdir']);

  for (const part of parts.slice(1)) {
    if (writeSubcommands.has(part) && !serviceWriteAllowed.has(part)) {
      throw new GogError(
        `Write operation "${part}" is not allowed for ${topLevel}. Allowed writes: ${serviceWriteAllowed.size > 0 ? [...serviceWriteAllowed].join(', ') : 'none (read-only)'}`,
        1, '',
      );
    }
  }

  // Determine timeout — use write timeout if any write subcommand is present
  const isWrite = parts.some(p => serviceWriteAllowed.has(p));
  const timeout = isWrite ? WRITE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  runtimeLog.info('execGeneralCommand', { source: 'gogService', command, isWrite });

  const result = await execGogRaw(parts, timeout);
  return result.stdout;
}
