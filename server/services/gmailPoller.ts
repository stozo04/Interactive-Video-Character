// server/services/gmailPoller.ts
//
// Server-side Gmail polling via gogcli — runs 24/7.
// No browser, no OAuth token management, no history API.
//
// Flow:
//   1. Every 60s: run `gog gmail search 'newer_than:1d in:inbox' --json`
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
  fetchEmailHtml,
  archiveEmail as gogArchiveEmail,
  type GogEmailResult,
} from './gogService';
import { generateEmailAnnouncement } from '../../src/services/emailProcessingService';
import { supabaseAdmin as supabase } from './supabaseAdmin';
import { bot, getStevenChatId } from '../../telegram/telegramClient';
import { InputFile } from 'grammy';
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

// VIP senders that should always be announced regardless of Gmail category.
// These run as a separate search so category filters (e.g. -category:updates)
// never silently swallow them. Add new entries as `from:<domain>` Gmail queries.
const VIP_SENDER_QUERIES: string[] = [
  'from:procaresoftware.com', // Mila's daycare daily summaries
];

const PROCARE_SENDER_DOMAIN = 'procaresoftware.com';
const MAX_EMAIL_PHOTOS = 2;
const PHOTO_FETCH_TIMEOUT_MS = 15_000;
const IMAGE_SRC_PATTERN = /<img\b[^>]*\bsrc=(['"])(.*?)\1/gi;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizePhotoUrl(rawUrl: string): string {
  const decoded = decodeHtmlEntities(rawUrl).replace(/\s+/g, '');
  const wrappedIndex = decoded.indexOf('#https://');
  if (wrappedIndex >= 0) {
    return decoded.slice(wrappedIndex + 1);
  }

  const wrappedHttpIndex = decoded.indexOf('#http://');
  if (wrappedHttpIndex >= 0) {
    return decoded.slice(wrappedHttpIndex + 1);
  }

  return decoded;
}

function extractPhotoUrlsFromHtml(html: string): string[] {
  if (!html) return [];

  const urls = new Set<string>();

  for (const match of html.matchAll(IMAGE_SRC_PATTERN)) {
    const rawSrc = match[2]?.trim();
    if (!rawSrc) continue;

    const normalized = normalizePhotoUrl(rawSrc);
    if (
      normalized.includes('private.cdn.procareconnect.com/photos/') ||
      normalized.includes('googleusercontent.com/meips/')
    ) {
      urls.add(normalized);
    }
  }

  return [...urls].slice(0, MAX_EMAIL_PHOTOS);
}

async function fetchPhotoBuffer(photoUrl: string, photoIndex: number): Promise<InputFile | null> {
  try {
    const response = await fetch(photoUrl, {
      signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      runtimeLog.warning('Email photo fetch failed', {
        source: 'gmailPoller',
        photoIndex,
        photoUrl,
        status: response.status,
      });
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      runtimeLog.warning('Email photo fetch returned non-image content', {
        source: 'gmailPoller',
        photoIndex,
        photoUrl,
        contentType,
      });
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const extension = contentType.includes('png') ? 'png' : 'jpg';
    return new InputFile(Buffer.from(arrayBuffer), `email-photo-${photoIndex + 1}.${extension}`);
  } catch (err) {
    runtimeLog.warning('Email photo fetch threw', {
      source: 'gmailPoller',
      photoIndex,
      photoUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function sendEmailPhotosToTelegram(
  chatId: number,
  email: NewEmailPayload,
  senderEmail: string,
): Promise<void> {
  if (!senderEmail.endsWith(PROCARE_SENDER_DOMAIN)) {
    return;
  }

  const html = await fetchEmailHtml(email.id);
  if (!html) {
    runtimeLog.info('Skipping email photo forwarding because HTML body is unavailable', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      senderEmail,
    });
    return;
  }

  const photoUrls = extractPhotoUrlsFromHtml(html);
  if (photoUrls.length === 0) {
    runtimeLog.info('No forwardable email photos found in HTML', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      senderEmail,
    });
    return;
  }

  const photoFiles = (
    await Promise.all(photoUrls.map((photoUrl, index) => fetchPhotoBuffer(photoUrl, index)))
  ).filter((file): file is InputFile => file !== null);

  if (photoFiles.length === 0) {
    runtimeLog.warning('Email photo forwarding skipped because all photo fetches failed', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      senderEmail,
      requestedCount: photoUrls.length,
    });
    return;
  }

  for (const photoFile of photoFiles) {
    await bot.api.sendPhoto(chatId, photoFile);
  }

  runtimeLog.info('Email photos sent to Telegram', {
    source: 'gmailPoller',
    gmailMessageId: email.id,
    senderEmail,
    photoCount: photoFiles.length,
  });
}

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
    return;
  }

  try {
    await sendEmailPhotosToTelegram(chatId, email, senderEmail);
  } catch (err) {
    runtimeLog.error('Failed to send email photos to Telegram', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      senderEmail,
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
    // Main search: recent inbox emails excluding noisy categories.
    // Gmail only supports d/m/y time units — no hours/minutes.
    // Dedup on kayley_email_actions.gmail_message_id prevents re-announcement.
    const mainQuery = 'newer_than:1d in:inbox -category:promotions -category:social -category:updates';
    const vipQueries = VIP_SENDER_QUERIES.map(q => `newer_than:1d ${q}`);

    const [mainResults, ...vipResults] = await Promise.all([
      searchEmails(mainQuery, 10),
      ...vipQueries.map(q => searchEmails(q, 5)),
    ]);

    // Merge and deduplicate by messageId — VIP results punch through category filters.
    const seen = new Set<string>();
    const results: typeof mainResults = [];
    for (const r of [...mainResults, ...vipResults.flat()]) {
      if (!seen.has(r.messageId)) {
        seen.add(r.messageId);
        results.push(r);
      }
    }

    runtimeLog.info('Poll results', {
      source: 'gmailPoller',
      mainCount: mainResults.length,
      vipCount: vipResults.flat().length,
      totalUnique: results.length,
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
