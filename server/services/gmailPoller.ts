// server/services/gmailPoller.ts
//
// Server-side Gmail polling via gogcli — runs 24/7.
// No browser, no OAuth token management, no history API.
//
// Flow:
//   1. Every 60s: run `gog gmail search 'newer_than:2m in:inbox' --json`
//   2. For each new message: dedup check (kayley_email_actions) → category filter
//      → auto-archive check → fetch full body → generate announcement
//      → write to kayley_email_actions → send to Steven's Telegram
//
// Coordination:
//   - UNIQUE constraint on gmail_message_id handles races — first writer wins
//   - whatsapp_sent_at is set immediately so emailBridge doesn't double-send

import {
  searchEmails,
  fetchEmailBody,
  archiveEmail as gogArchiveEmail,
  type GogEmailResult,
} from './gogService';
import { generateEmailAnnouncement } from '../../src/services/emailProcessingService';
import { supabaseAdmin as supabase } from './supabaseAdmin';
import { bot, getStevenChatId } from '../telegram/telegramClient';
import { log } from '../runtimeLogger';
import {
  checkAutoArchiveRule,
  extractEmailAddress,
  extractDisplayName,
} from './autoArchiveService';

const LOG_PREFIX = '[GmailPoller]';
const runtimeLog = log.fromContext({ source: 'gmailPoller', route: 'server/gmail' });

// ============================================================================
// USER FACTS -- loaded once per poll so Kayley recognises senders
// ============================================================================

async function loadUserFactsContext(): Promise<string> {
  try {
    const { data } = await supabase
      .from('user_facts')
      .select('fact_key, fact_value')
      .order('category', { ascending: true });

    if (!data?.length) return '';
    const lines = data.map((f: { fact_key: string; fact_value: string }) => `- ${f.fact_key}: ${f.fact_value}`);
    return `Known facts about Steven and the people in his life:\n${lines.join('\n')}`;
  } catch {
    return ''; // non-fatal
  }
}

const POLL_INTERVAL_MS      = 60_000;       // normal cadence
const POLL_BACKOFF_MS       = 5 * 60_000;   // cadence after repeated failures
const FAIL_THRESHOLD        = 3;            // consecutive failures before alert + backoff

const STEVEN_CHAT_ID = getStevenChatId();

// Prevent overlapping polls
let isPolling = false;

// Self-healing state
let consecutiveFailures = 0;
let sentFailureAlert    = false;

async function sendTelegramAlert(message: string): Promise<void> {
  const chatId = getStevenChatId();
  if (!chatId) return;
  try {
    await bot.api.sendMessage(chatId, message);
  } catch {
    console.error(`${LOG_PREFIX} Could not send Telegram alert`);
  }
}

// ============================================================================
// IGNORED LABELS (same filtering as before)
// ============================================================================

const IGNORED_SENDERS_PATTERNS = [
  // Add patterns to skip if needed
];

// ============================================================================
// AUTO-ARCHIVE FAST PATH
// ============================================================================

interface NewEmailPayload {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: string;
}

function gogResultToPayload(r: GogEmailResult): NewEmailPayload {
  return {
    id: r.messageId,
    threadId: r.threadId,
    from: r.from,
    subject: r.subject,
    snippet: r.snippet,
    body: r.body || '',
    receivedAt: r.date,
  };
}

async function handleAutoArchive(email: NewEmailPayload, senderEmail: string): Promise<void> {
  // Dedup
  const { data: existing } = await supabase
    .from('kayley_email_actions')
    .select('id')
    .eq('gmail_message_id', email.id)
    .maybeSingle();

  if (existing) return;

  // Archive via gogcli
  let archiveSuccess = false;
  try {
    archiveSuccess = await gogArchiveEmail(email.id);
  } catch (err) {
    runtimeLog.error('Auto-archive failed', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const now = new Date().toISOString();
  const displayName = extractDisplayName(email.from) || senderEmail;

  const { error: insertErr } = await supabase.from('kayley_email_actions').insert({
    gmail_message_id: email.id,
    gmail_thread_id:  email.threadId,
    from_address:     email.from,
    subject:          email.subject,
    action_taken:     archiveSuccess ? 'archive' : 'pending',
    kayley_summary:   `[Auto-archived] ${email.subject}`,
    announced_at:     now,
    whatsapp_sent_at: now,
    actioned_at:      archiveSuccess ? now : null,
  });

  if (insertErr?.code === '23505') return; // race — already inserted

  if (insertErr) {
    runtimeLog.error('Failed to insert auto-archive row', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      error: insertErr.message,
    });
  }

  // Brief Telegram notification
  const chatId = getStevenChatId();
  if (!chatId) return;

  const notification = archiveSuccess
    ? `Got an email from ${displayName} -- auto-archived it for you.`
    : `Got an email from ${displayName} ("${email.subject}") but had trouble auto-archiving it.`;

  try {
    await bot.api.sendMessage(chatId, notification);
    runtimeLog.info('Auto-archive notification sent', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      senderEmail,
    });
  } catch (err) {
    runtimeLog.error('Failed to send auto-archive notification', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// EMAIL PROCESSING
// ============================================================================

async function processNewEmail(email: NewEmailPayload): Promise<void> {
  const chatId = getStevenChatId();
  if (!chatId) return;

  // 0. Auto-archive check
  const senderEmail = extractEmailAddress(email.from);
  const isAutoArchive = await checkAutoArchiveRule(senderEmail);
  if (isAutoArchive) {
    runtimeLog.info('Auto-archive rule matched', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      senderEmail,
    });
    await handleAutoArchive(email, senderEmail);
    return;
  }

  // 1a. Dedup
  const { data: existing } = await supabase
    .from('kayley_email_actions')
    .select('id')
    .eq('gmail_message_id', email.id)
    .maybeSingle();

  if (existing) {
    runtimeLog.info('Email already in DB, skipping', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
    });
    return;
  }

  // 1b. Reply-echo guard
  if (email.threadId) {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentReply } = await supabase
      .from('kayley_email_actions')
      .select('id, actioned_at')
      .eq('gmail_thread_id', email.threadId)
      .eq('action_taken', 'reply')
      .gte('actioned_at', fiveMinutesAgo)
      .maybeSingle();

    if (recentReply) {
      runtimeLog.info('Skipping email -- reply-echo in same thread', {
        source: 'gmailPoller',
        gmailMessageId: email.id,
        threadId: email.threadId,
      });
      return;
    }
  }

  // 2. Fetch full body if not already present
  if (!email.body) {
    try {
      const body = await fetchEmailBody(email.id);
      if (body) email = { ...email, body };
    } catch {
      // Non-fatal
    }
  }

  runtimeLog.info('Generating announcement', {
    source: 'gmailPoller',
    gmailMessageId: email.id,
    from: email.from,
    subject: email.subject,
    hasBody: !!email.body,
  });

  // 3. Load user facts
  const userContext = await loadUserFactsContext();

  // 4. Generate announcement
  const announcement = await generateEmailAnnouncement(email, userContext);

  // 5. Write to DB
  const now = new Date().toISOString();
  const { error: insertErr } = await supabase.from('kayley_email_actions').insert({
    gmail_message_id: email.id,
    gmail_thread_id:  email.threadId,
    from_address:     email.from,
    subject:          email.subject,
    action_taken:     'pending',
    kayley_summary:   announcement,
    announced_at:     now,
    whatsapp_sent_at: now,
  });

  if (insertErr) {
    if (insertErr.code === '23505') {
      runtimeLog.info('Email inserted by another process in race window', {
        source: 'gmailPoller',
        gmailMessageId: email.id,
      });
      return;
    }
    runtimeLog.error('Failed to insert kayley_email_actions row', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      error: insertErr.message,
    });
  }

  // 6. Send to Telegram
  try {
    await bot.api.sendMessage(chatId, announcement);
    runtimeLog.info('Email announcement sent to Telegram', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      announcementLength: announcement.length,
    });
  } catch (err) {
    runtimeLog.error('Failed to send announcement to Telegram', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// POLL LOOP
// ============================================================================

async function pollGmail(): Promise<number> {
  if (isPolling) return POLL_INTERVAL_MS;
  isPolling = true;
  runtimeLog.info('Checking for new mail via gogcli', { source: 'gmailPoller' });

  try {
    // Search for recent inbox emails (last 2 minutes to cover polling gaps)
    const results = await searchEmails('newer_than:2m in:inbox', 10);

    runtimeLog.info('Poll results', {
      source: 'gmailPoller',
      resultCount: results.length,
    });

    for (const result of results) {
      const payload = gogResultToPayload(result);
      await processNewEmail(payload);
    }

    // Success -- reset failure streak
    if (consecutiveFailures > 0) {
      runtimeLog.info('Gmail poll recovered', {
        source: 'gmailPoller',
        previousFailures: consecutiveFailures,
      });
    }
    consecutiveFailures = 0;
    sentFailureAlert    = false;
    return POLL_INTERVAL_MS;

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    consecutiveFailures++;

    runtimeLog.error('Gmail poll error', {
      source: 'gmailPoller',
      error: errMsg,
      consecutiveFailures,
    });

    if (consecutiveFailures >= FAIL_THRESHOLD && !sentFailureAlert) {
      sentFailureAlert = true;
      const alert =
        `Gmail polling has failed ${consecutiveFailures} times in a row.\n` +
        `Last error: ${errMsg.substring(0, 120)}\n\n` +
        `Backing off to every ${POLL_BACKOFF_MS / 60_000} minutes.`;
      await sendTelegramAlert(alert);
    }

    return consecutiveFailures >= FAIL_THRESHOLD ? POLL_BACKOFF_MS : POLL_INTERVAL_MS;

  } finally {
    isPolling = false;
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

export function startGmailPoller(): void {
  if (!STEVEN_CHAT_ID) {
    console.warn(`${LOG_PREFIX} TELEGRAM_STEVEN_CHAT_ID not set -- Gmail poller disabled`);
    return;
  }

  runtimeLog.info('Gmail poller started (gogcli)', {
    source: 'gmailPoller',
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  // Recursive setTimeout for dynamic backoff
  const scheduleNext = (delay: number) => {
    setTimeout(async () => {
      const nextDelay = await pollGmail();
      scheduleNext(nextDelay);
    }, delay);
  };

  // First poll after 5s
  setTimeout(async () => {
    const firstDelay = await pollGmail();
    scheduleNext(firstDelay);
  }, 5_000);
}
