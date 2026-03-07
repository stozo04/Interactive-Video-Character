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
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[EmailBridge]';
const runtimeLog = log.fromContext({ source: 'emailBridge', route: 'whatsapp/email' });
const POLL_INTERVAL_MS  = 10_000;

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

  // Token health check removed — gogcli handles token refresh automatically
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
