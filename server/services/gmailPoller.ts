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
import { getActiveSock, sentMessageIds } from '../whatsapp/baileyClient';
import { log } from '../runtimeLogger';

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

const POLL_INTERVAL_MS      = 60_000;
const HISTORY_DB_KEY        = 'server_gmail_history_id'; // stored in google_api_config
const HISTORY_SHIM_KEY      = 'gmail_history_id';        // gmailService's hardcoded key

const STEVEN_JID = process.env.WHATSAPP_STEVEN_JID;

// Prevent overlapping polls if one takes longer than the interval
let isPolling = false;

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
  await supabase
    .from('google_api_config')
    .upsert(
      { config_key: HISTORY_DB_KEY, config_value: historyId },
      { onConflict: 'config_key' }
    );
}

// ============================================================================
// EMAIL PROCESSING
// ============================================================================

async function processNewEmail(email: NewEmailPayload): Promise<void> {
  if (!STEVEN_JID) return;

  // 1. Dedup — browser may have already caught and announced this email
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

  // 5. Send announcement to Steven's WhatsApp
  const sock = getActiveSock();
  if (!sock) {
    runtimeLog.warning('WA socket not available, email announcement dropped', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
    });
    return;
  }

  try {
    const sent = await sock.sendMessage(STEVEN_JID!, { text: announcement });
    if (sent?.key?.id) sentMessageIds.add(sent.key.id);
    console.log(`${LOG_PREFIX} ✅ Email notification sent to WA: "${email.subject}" from ${email.from}`);
    runtimeLog.info('Email announcement sent to WhatsApp', {
      source: 'gmailPoller',
      gmailMessageId: email.id,
      announcementLength: announcement.length,
    });
  } catch (err) {
    runtimeLog.error('Failed to send email announcement to WA', {
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

async function pollGmail(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

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
  } catch (err) {
    if (err instanceof Error && err.message === 'GOOGLE_REFRESH_TOKEN_EXPIRED') {
      return; // token health check in emailBridge handles the WA notification
    }
    runtimeLog.error('Gmail poll error', {
      source: 'gmailPoller',
      error: err instanceof Error ? err.message : String(err),
    });
    console.error(`${LOG_PREFIX} Poll error:`, err instanceof Error ? err.message : err);
  } finally {
    isPolling = false;
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

export function startGmailPoller(): void {
  if (!STEVEN_JID) {
    console.warn(`${LOG_PREFIX} WHATSAPP_STEVEN_JID not set — Gmail poller disabled`);
    return;
  }

  attachEmailListener();

  console.log(`${LOG_PREFIX} Started (polling every ${POLL_INTERVAL_MS / 1000}s)`);
  runtimeLog.info('Gmail poller started', {
    source: 'gmailPoller',
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  // First poll after 5s to give the WA connection time to open
  setTimeout(() => {
    void pollGmail();
    setInterval(() => void pollGmail(), POLL_INTERVAL_MS);
  }, 5_000);
}
