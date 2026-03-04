// server/telegram/telegramEmailBridge.ts
//
// Polls Supabase for email announcements that haven't been forwarded to Telegram yet
// and sends them proactively to Steven.
//
// Flow:
//   Browser announces email → writes kayley_email_actions row (action_taken='pending',
//                              whatsapp_sent_at=NULL, kayley_summary=<announcement>)
//   telegramEmailBridge polls → finds row → sends kayley_summary → sets whatsapp_sent_at
//
// Note: whatsapp_sent_at is reused as "messenger_sent_at" — no migration needed.

import { bot, getStevenChatId } from './telegramClient';
import { supabaseAdmin as supabase } from '../services/supabaseAdmin';
import { getTokenAgeDays } from '../services/googleTokenService';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[EmailBridge]';
const runtimeLog = log.fromContext({ source: 'telegramEmailBridge', route: 'telegram/email' });
const POLL_INTERVAL_MS  = 10_000;
const HEALTH_CHECK_MS   = 6 * 60 * 60 * 1000; // 6 hours
const TOKEN_WARN_DAYS   = 6;
const TOKEN_EXPIRE_DAYS = 7;

/**
 * Starts the email bridge polling loop.
 * Call once from index.ts after the bot starts.
 */
export function startEmailBridge(): void {
  const stevenChatId = getStevenChatId();

  if (!stevenChatId) {
    console.warn(`${LOG_PREFIX} TELEGRAM_STEVEN_CHAT_ID not set — email bridge disabled`);
    runtimeLog.warning('Email bridge disabled: TELEGRAM_STEVEN_CHAT_ID not configured', {
      source: 'telegramEmailBridge',
    });
    return;
  }

  console.log(`${LOG_PREFIX} Email bridge started (polling every ${POLL_INTERVAL_MS / 1000}s)`);
  runtimeLog.info('Email bridge started', { source: 'telegramEmailBridge', pollIntervalMs: POLL_INTERVAL_MS });

  // First poll after 3s (gives the bot connection a moment to settle)
  setTimeout(() => {
    void pollPendingEmails();
    setInterval(() => void pollPendingEmails(), POLL_INTERVAL_MS);
  }, 3_000);

  // Token health check — every 6 hours, warns Steven before day 7 expiry
  setTimeout(() => {
    void checkTokenHealth();
    setInterval(() => void checkTokenHealth(), HEALTH_CHECK_MS);
  }, 30_000);
}

async function checkTokenHealth(): Promise<void> {
  const chatId = getStevenChatId();
  if (!chatId) return;

  try {
    const ageDays = await getTokenAgeDays();
    if (ageDays === null) return;

    runtimeLog.info('Google token health check', {
      source: 'telegramEmailBridge',
      ageDays: ageDays.toFixed(1),
    });

    if (ageDays >= TOKEN_EXPIRE_DAYS) {
      const msg = `Hey, heads up — my Google connection has expired (it resets every 7 days in dev mode). Gmail stuff won't work until you open the app and sign back in. Takes 10 seconds!`;
      await bot.api.sendMessage(chatId, msg);
      runtimeLog.warning('Google refresh token expired, notified Steven via Telegram', {
        source: 'telegramEmailBridge',
        ageDays,
      });
    } else if (ageDays >= TOKEN_WARN_DAYS) {
      const daysLeft = (TOKEN_EXPIRE_DAYS - ageDays).toFixed(1);
      const msg = `Quick heads up — my Google connection expires in about ${daysLeft} day(s). Just open the app whenever you get a chance and it'll renew automatically!`;
      await bot.api.sendMessage(chatId, msg);
      runtimeLog.info('Google token expiry warning sent to Steven', {
        source: 'telegramEmailBridge',
        ageDays,
        daysLeft,
      });
    }
  } catch (err) {
    runtimeLog.error('Token health check failed', {
      source: 'telegramEmailBridge',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function pollPendingEmails(): Promise<void> {
  const chatId = getStevenChatId();
  if (!chatId) return;

  const { data, error } = await supabase
    .from('kayley_email_actions')
    .select('id, kayley_summary, gmail_message_id')
    .eq('action_taken', 'pending')
    .not('announced_at', 'is', null)
    .is('whatsapp_sent_at', null)
    .order('announced_at', { ascending: true })
    .limit(5);

  if (error) {
    runtimeLog.error('Supabase poll failed', { source: 'telegramEmailBridge', error: error.message });
    return;
  }

  if (!data?.length) return;

  runtimeLog.info('Found pending email notifications to forward', {
    source: 'telegramEmailBridge',
    count: data.length,
  });

  for (const row of data) {
    if (!row.kayley_summary) {
      runtimeLog.warning('Row missing kayley_summary, skipping', {
        source: 'telegramEmailBridge',
        id: row.id,
      });
      continue;
    }

    try {
      await bot.api.sendMessage(chatId, row.kayley_summary);

      await supabase
        .from('kayley_email_actions')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', row.id);

      console.log(`${LOG_PREFIX} Forwarded email notification to Telegram:`, row.gmail_message_id);
      runtimeLog.info('Email notification forwarded to Telegram', {
        source: 'telegramEmailBridge',
        gmailMessageId: row.gmail_message_id,
      });
    } catch (err) {
      runtimeLog.error('Failed to forward email notification', {
        source: 'telegramEmailBridge',
        id: row.id,
        gmailMessageId: row.gmail_message_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
