// server/whatsapp/emailBridge.ts
//
// Polls Supabase for email announcements that haven't been forwarded to WhatsApp yet
// and sends them proactively to Steven.
//
// Flow:
//   Browser announces email → writes kayley_email_actions row (action_taken='pending',
//                              whatsapp_sent_at=NULL, kayley_summary=<announcement>)
//   emailBridge polls → finds row → sends kayley_summary to WA → sets whatsapp_sent_at
//
// After whatsapp_sent_at is set, whatsappHandler.ts knows to inject this email as
// context the next time Steven sends any WA message.

import { getActiveSock, sentMessageIds } from './baileyClient';
import { supabaseAdmin as supabase } from '../services/supabaseAdmin';
import { getTokenAgeDays } from '../services/googleTokenService';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[EmailBridge]';
const runtimeLog = log.fromContext({ source: 'emailBridge', route: 'whatsapp/email' });
const POLL_INTERVAL_MS  = 10_000;
const HEALTH_CHECK_MS   = 6 * 60 * 60 * 1000; // check token health every 6 hours
const TOKEN_WARN_DAYS   = 6;   // warn at day 6 (1 day before 7-day expiry)
const TOKEN_EXPIRE_DAYS = 7;

// Steven's WhatsApp JID — set WHATSAPP_STEVEN_JID in your .env.local
// Format: 15551234567@s.whatsapp.net
const STEVEN_JID = process.env.WHATSAPP_STEVEN_JID;

/**
 * Starts the polling loop.
 * Call once from index.ts after the WA client initialises.
 */
export function startEmailBridge(): void {
  if (!STEVEN_JID) {
    console.warn(`${LOG_PREFIX} WHATSAPP_STEVEN_JID not set — email-to-WhatsApp bridge disabled`);
    runtimeLog.warning('Email bridge disabled: WHATSAPP_STEVEN_JID not configured', {
      source: 'emailBridge',
    });
    return;
  }

  console.log(`${LOG_PREFIX} Email bridge started (polling every ${POLL_INTERVAL_MS / 1000}s)`);
  runtimeLog.info('Email bridge started', { source: 'emailBridge', pollIntervalMs: POLL_INTERVAL_MS });

  // First poll fires after 3s (gives the WA connection a moment to settle)
  setTimeout(() => {
    void pollPendingEmails();
    setInterval(() => void pollPendingEmails(), POLL_INTERVAL_MS);
  }, 3_000);

  // Token health check — runs every 6 hours, warns Steven via WA before day 7 expiry
  setTimeout(() => {
    void checkTokenHealth();
    setInterval(() => void checkTokenHealth(), HEALTH_CHECK_MS);
  }, 30_000); // first check after 30s (give WA connection time to open)
}

async function checkTokenHealth(): Promise<void> {
  const sock = getActiveSock();
  if (!sock || !STEVEN_JID) return;

  try {
    const ageDays = await getTokenAgeDays();

    if (ageDays === null) {
      // No issued_at recorded yet — token was stored before this column existed, skip
      return;
    }

    runtimeLog.info('Google token health check', {
      source: 'emailBridge',
      ageDays: ageDays.toFixed(1),
      warnThreshold: TOKEN_WARN_DAYS,
    });

    if (ageDays >= TOKEN_EXPIRE_DAYS) {
      // Already expired — Kayley tells Steven Gmail actions are broken
      const msg = `Hey, heads up — my Google connection has expired (it resets every 7 days in dev mode). Gmail stuff won't work until you open the app and sign back in. Takes 10 seconds!`;
      const sent = await sock.sendMessage(STEVEN_JID!, { text: msg });
      if (sent?.key?.id) sentMessageIds.add(sent.key.id);
      runtimeLog.warning('Google refresh token expired, notified Steven via WA', { source: 'emailBridge', ageDays });
      console.warn(`${LOG_PREFIX} ⚠️ Google refresh token expired (${ageDays.toFixed(1)} days old)`);

    } else if (ageDays >= TOKEN_WARN_DAYS) {
      // Expiring tomorrow — proactive nudge
      const daysLeft = (TOKEN_EXPIRE_DAYS - ageDays).toFixed(1);
      const msg = `Quick heads up — my Google connection expires in about ${daysLeft} day(s). Just open the app whenever you get a chance and it'll renew automatically!`;
      const sent = await sock.sendMessage(STEVEN_JID!, { text: msg });
      if (sent?.key?.id) sentMessageIds.add(sent.key.id);
      runtimeLog.info('Google token expiry warning sent to Steven', { source: 'emailBridge', ageDays, daysLeft });
      console.log(`${LOG_PREFIX} ⚠️ Token expiry warning sent (${ageDays.toFixed(1)} days old)`);
    }
  } catch (err) {
    runtimeLog.error('Token health check failed', {
      source: 'emailBridge',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function pollPendingEmails(): Promise<void> {
  const sock = getActiveSock();
  if (!sock) return; // WA not connected yet

  const { data, error } = await supabase
    .from('kayley_email_actions')
    .select('id, kayley_summary, gmail_message_id')
    .eq('action_taken', 'pending')
    .not('announced_at', 'is', null)      // browser has announced it
    .is('whatsapp_sent_at', null)          // not yet forwarded to WA
    .order('announced_at', { ascending: true })
    .limit(5);

  if (error) {
    runtimeLog.error('Supabase poll failed', { source: 'emailBridge', error: error.message });
    return;
  }

  if (!data?.length) return;

  runtimeLog.info('Found pending email notifications to forward', {
    source: 'emailBridge',
    count: data.length,
  });

  for (const row of data) {
    if (!row.kayley_summary) {
      runtimeLog.warning('Row missing kayley_summary, skipping', {
        source: 'emailBridge',
        id: row.id,
        gmailMessageId: row.gmail_message_id,
      });
      continue;
    }

    try {
      const sent = await sock.sendMessage(STEVEN_JID!, { text: row.kayley_summary });
      if (sent?.key?.id) {
        sentMessageIds.add(sent.key.id); // prevent echo loop
      }

      await supabase
        .from('kayley_email_actions')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', row.id);

      console.log(`${LOG_PREFIX} Forwarded email notification to WA:`, row.gmail_message_id);
      runtimeLog.info('Email notification forwarded to WhatsApp', {
        source: 'emailBridge',
        gmailMessageId: row.gmail_message_id,
        summaryLength: row.kayley_summary.length,
      });
    } catch (err) {
      runtimeLog.error('Failed to forward email notification', {
        source: 'emailBridge',
        id: row.id,
        gmailMessageId: row.gmail_message_id,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`${LOG_PREFIX} Failed to send email notification:`, err);
    }
  }
}
