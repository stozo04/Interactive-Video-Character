// telegram/telegramEmailBridge.ts
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
import { supabaseAdmin as supabase } from '../server/services/supabaseAdmin';
import { log } from '../lib/logger';
import {
  appendConversationHistory,
  getTodaysInteractionId,
} from '../src/services/conversationHistoryService';

const LOG_PREFIX = '[EmailBridge]';
const runtimeLog = log.fromContext({ source: 'telegramEmailBridge', route: 'telegram/email' });
const POLL_INTERVAL_MS  = 10_000;

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

  // Token health check removed — gogcli handles token refresh automatically
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

      // Persist the announcement to conversation_history so the LLM remembers
      // it announced this email on the next user turn.
      const interactionId = await getTodaysInteractionId();
      const bridgeLogId = crypto.randomUUID();
      // NO TOKENS CAPTURED - NO LLM
      appendConversationHistory(
        [{ role: 'model', text: row.kayley_summary }],
        interactionId ?? undefined,
        bridgeLogId,
      ).catch((err) => {
        runtimeLog.error('Failed to persist email announcement to conversation_history', {
          source: 'telegramEmailBridge',
          gmailMessageId: row.gmail_message_id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      console.log(`${LOG_PREFIX} Forwarded email notification to Telegram:`, row.gmail_message_id);
      runtimeLog.info('Email notification forwarded to Telegram', {
        source: 'telegramEmailBridge',
        gmailMessageId: row.gmail_message_id,
        bridgeLogId,
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
