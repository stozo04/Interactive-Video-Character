// server/services/gmailPoller.ts
//
// Server-side Gmail polling — runs inside the WA bridge process 24/7.
// The browser no longer needs to be open for email notifications to reach WhatsApp.
//
// Flow:
//   1. Every 60s: fetch a fresh Google token, sync history ID from Supabase into
//      the in-memory localStorage shim, call gmailService.pollForNewMail()
//   2. gmailService fires a 'new-mail' event with any newly arrived messages
//   3. For each message: dedup check → fetch full body → generate announcement
//      → write to kayley_email_actions → send to Steven's WhatsApp
//   4. Persist updated history ID back to Supabase so server restarts don't
//      re-process old emails
//
// Coordination with browser:
//   - If browser is ALSO open, both may detect the same email
//   - UNIQUE constraint on gmail_message_id handles the race — first writer wins
//   - Loser gets a 23505 (unique violation) and skips the WA send silently
//   - emailBridge.ts only forwards rows where whatsapp_sent_at IS NULL;
//     this service sets whatsapp_sent_at immediately, so emailBridge backs off

import { gmailService } from '../../src/services/gmailService';
import type { NewEmailPayload } from '../../src/services/gmailService';
import { getValidGoogleToken } from './googleTokenService';
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
// USER FACTS — loaded once per poll so Kayley recognises senders
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
    return ''; // non-fatal — announcement still works without context
  }
}

const POLL_INTERVAL_MS      = 60_000;       // normal cadence
const POLL_BACKOFF_MS       = 5 * 60_000;   // cadence after repeated failures
const FAIL_THRESHOLD        = 3;            // consecutive failures before WA alert + backoff
const HISTORY_DB_KEY        = 'server_gmail_history_id'; // stored in google_api_config
const HISTORY_SHIM_KEY      = 'gmail_history_id';        // gmailService's hardcoded key

const STEVEN_CHAT_ID = getStevenChatId();

// Prevent overlapping polls if one takes longer than the interval
let isPolling = false;

// Self-healing state
let consecutiveFailures = 0;
let sentFailureAlert    = false; // only send WA notification once per failure streak

async function sendTelegramAlert(message: string): Promise<void> {
  const chatId = getStevenChatId();
  if (!chatId) return;
  try {
    await bot.api.sendMessage(chatId, message);
  } catch {
    // Non-fatal — if Telegram is also down, just log
    console.error(`${LOG_PREFIX} Could not send Telegram alert`);
  }
}

// ============================================================================
// HISTORY ID PERSISTENCE
// Keeps the Gmail cursor durable across server restarts via google_api_config
// ============================================================================

async function loadHistoryId(): Promise<string | null> {
  const { data } = await supabase
    .from('google_api_config')
    .select('config_value')
    .eq('config_key', HISTORY_DB_KEY)
    .maybeSingle();
  return data?.config_value ?? null;
}

async function saveHistoryId(historyId: string): Promise<void> {
  const { error } = await supabase
    .from('google_api_config')
    .upsert(
      { config_key: HISTORY_DB_KEY, config_value: historyId },
      { onConflict: 'config_key' }
    );
  if (error) {
    console.error(`${LOG_PREFIX} Failed to persist history ID (next restart may re-process old mail):`, error.message);
  }
}

// ============================================================================
// AUTO-ARCHIVE FAST PATH
// If the sender is in email_auto_archive_rules, skip the announcement entirely,
// archive silently, and send a brief one-liner to WA instead.
// ============================================================================

async function handleAutoArchive(email: NewEmailPayload, senderEmail: string): Promise<void> {
  // Dedup — same guard as the normal flow
  const { data: existing } = await supabase
    .from('kayley_email_actions')
    .select('id')
    .eq('gmail_message_id', email.id)
    .maybeSingle();

  if (existing) return; // already processed (browser caught it, or duplicate event)

  // Archive via Gmail API
  let archiveSuccess = false;
  try {
    const accessToken = await getValidGoogleToken();
    archiveSuccess = await gmailService.archiveEmail(accessToken, email.id);
  } catch (err) {
    runtimeLog.error('Auto-archive Gmail call failed', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const now = new Date().toISOString();
  const displayName = extractDisplayName(email.from) || senderEmail;

  // Write DB row as already actioned so it never bubbles up as "pending"
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

  if (insertErr?.code === '23505') return; // race condition — already inserted, fine

  if (insertErr) {
    runtimeLog.error('Failed to insert auto-archive row', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      error: insertErr.message,
    });
  }

  // Brief Telegram notification — no announcement, no question, just a heads-up
  const chatId = getStevenChatId();
  if (!chatId) return;

  const notification = archiveSuccess
    ? `Got an email from ${displayName} — auto-archived it for you. 🗑️`
    : `Got an email from ${displayName} ("${email.subject}") but had trouble auto-archiving it.`;

  try {
    await bot.api.sendMessage(chatId, notification);
    console.log(`${LOG_PREFIX} 🗑️  Auto-archived email from ${senderEmail}: "${email.subject}"`);
  } catch (err) {
    runtimeLog.error('Failed to send auto-archive notification to Telegram', {
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

  // 0. Auto-archive check — runs BEFORE dedup and announcement
  const senderEmail = extractEmailAddress(email.from);
  const isAutoArchive = await checkAutoArchiveRule(senderEmail);
  if (isAutoArchive) {
    runtimeLog.info('Auto-archive rule matched — skipping announcement', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      senderEmail,
    });
    await handleAutoArchive(email, senderEmail);
    return;
  }

  // 1a. Dedup — browser may have already caught and announced this email
  const { data: existing } = await supabase
    .from('kayley_email_actions')
    .select('id')
    .eq('gmail_message_id', email.id)
    .maybeSingle();

  if (existing) {
    runtimeLog.info('Email already in DB (browser caught it first), skipping', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
    });
    return;
  }

  // 1b. Reply-echo guard — if Kayley replied to this thread within the last 5 minutes,
  // skip this new message. Prevents self-addressed test emails and auto-responders from
  // appearing as new announcements immediately after Kayley sends a reply.
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
      runtimeLog.info('Skipping email — reply-echo in same thread within 5 minutes', {
        source: 'gmailPoller',
        gmailMessageId: email.id,
        threadId: email.threadId,
        repliedAt: recentReply.actioned_at,
      });
      return;
    }
  }

  // 2. Fetch full body for a richer announcement (history API only returns snippet)
  try {
    const accessToken = await getValidGoogleToken();
    const body = await gmailService.fetchMessageBody(accessToken, email.id);
    if (body) email = { ...email, body };
  } catch {
    // Non-fatal — generateEmailAnnouncement falls back to snippet
  }

  runtimeLog.info('Generating announcement for server-polled email', {
    source: 'gmailPoller',
    gmailMessageId: email.id,
    from: email.from,
    subject: email.subject,
    hasBody: !!email.body,
  });

  // 3. Load user facts so Kayley recognizes the sender
  const userContext = await loadUserFactsContext();

  // 4. Generate Kayley's announcement
  const announcement = await generateEmailAnnouncement(email, userContext);

  // 6. Write to DB — set whatsapp_sent_at immediately so emailBridge doesn't double-send
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
      // Race condition: browser inserted between our dedup check and insert — fine
      runtimeLog.info('Email inserted by browser in race window, skipping WA send', {
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
    // Continue and try to send to WA anyway — better to duplicate than miss
  }

  // 5. Send announcement to Steven via Telegram
  try {
    await bot.api.sendMessage(chatId, announcement);
    console.log(`${LOG_PREFIX} ✅ Email notification sent to Telegram: "${email.subject}" from ${email.from}`);
    runtimeLog.info('Email announcement sent to Telegram', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      announcementLength: announcement.length,
    });
  } catch (err) {
    runtimeLog.error('Failed to send email announcement to Telegram', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// EVENT LISTENER (attached once)
// ============================================================================

let listenerAttached = false;

function attachEmailListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;

  gmailService.addEventListener('new-mail', (event) => {
    const emails = (event as CustomEvent<NewEmailPayload[]>).detail;
    runtimeLog.info('Server Gmail poller detected new emails', {
      source: 'gmailPoller',
      count: emails.length,
    });
    console.log(`${LOG_PREFIX} Detected ${emails.length} new email(s)`);
    for (const email of emails) {
      void processNewEmail(email);
    }
  });

  gmailService.addEventListener('auth-error', () => {
    // Token may have become stale mid-poll; next poll will get a fresh one
    runtimeLog.warning('Gmail auth-error received — next poll will refresh token', {
      source: 'gmailPoller',
    });
  });
}

// ============================================================================
// POLL LOOP
// ============================================================================

// Returns the delay to use before the next poll
async function pollGmail(): Promise<number> {
  if (isPolling) return POLL_INTERVAL_MS;
  isPolling = true;
  console.log(`${LOG_PREFIX} Checking for new mail...`);

  try {
    const accessToken = await getValidGoogleToken();

    // Sync persisted history ID into the shim so gmailService picks it up
    const storedHistoryId = await loadHistoryId();
    if (storedHistoryId) {
      localStorage.setItem(HISTORY_SHIM_KEY, storedHistoryId);
    }

    await gmailService.pollForNewMail(accessToken);

    // Persist the updated history ID so server restarts don't re-process old mail
    const updatedHistoryId = localStorage.getItem(HISTORY_SHIM_KEY);
    if (updatedHistoryId && updatedHistoryId !== storedHistoryId) {
      await saveHistoryId(updatedHistoryId);
      runtimeLog.info('Gmail history ID updated', {
        source: 'gmailPoller',
        historyId: updatedHistoryId,
      });
    }

    // Success — reset failure streak
    if (consecutiveFailures > 0) {
      console.log(`${LOG_PREFIX} ✅ Poll succeeded after ${consecutiveFailures} failure(s) — resuming normal cadence`);
      runtimeLog.info('Gmail poll recovered', { source: 'gmailPoller', previousFailures: consecutiveFailures });
    }
    consecutiveFailures = 0;
    sentFailureAlert    = false;
    return POLL_INTERVAL_MS;

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    if (err instanceof Error && err.message === 'GOOGLE_REFRESH_TOKEN_EXPIRED') {
      // Handled by emailBridge / whatsappHandler — don't double-alert
      runtimeLog.warning('Gmail poll skipped: refresh token expired', { source: 'gmailPoller' });
      consecutiveFailures++;
      return POLL_BACKOFF_MS;
    }

    consecutiveFailures++;
    runtimeLog.error('Gmail poll error', {
      source: 'gmailPoller',
      error: errMsg,
      consecutiveFailures,
    });
    console.error(`${LOG_PREFIX} Poll error (failure #${consecutiveFailures}):`, errMsg);

    // After hitting the threshold: back off + send a one-time WA alert
    if (consecutiveFailures >= FAIL_THRESHOLD && !sentFailureAlert) {
      sentFailureAlert = true;
      const alert =
        `⚠️ Gmail polling has failed ${consecutiveFailures} times in a row.\n` +
        `Last error: ${errMsg.substring(0, 120)}\n\n` +
        `I'm backing off to every ${POLL_BACKOFF_MS / 60_000} minutes. ` +
        `You may need to reopen the app and re-authenticate.`;
      console.error(`${LOG_PREFIX} Sending failure alert to Telegram`);
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
    console.warn(`${LOG_PREFIX} TELEGRAM_STEVEN_CHAT_ID not set — Gmail poller disabled`);
    return;
  }

  attachEmailListener();

  console.log(`${LOG_PREFIX} Started (polling every ${POLL_INTERVAL_MS / 1000}s)`);
  runtimeLog.info('Gmail poller started', {
    source: 'gmailPoller',
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  // Recursive setTimeout instead of setInterval — allows dynamic backoff after failures
  const scheduleNext = (delay: number) => {
    setTimeout(async () => {
      const nextDelay = await pollGmail();
      scheduleNext(nextDelay);
    }, delay);
  };

  // First poll after 5s to give the WA connection time to open, then self-schedule
  setTimeout(async () => {
    const firstDelay = await pollGmail();
    scheduleNext(firstDelay);
  }, 5_000);
}
