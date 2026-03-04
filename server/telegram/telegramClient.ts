/**
 * Telegram Bot Client
 *
 * Grammy bot instance. Routes incoming messages to the handler.
 * Exports bot, getTelegramBot(), getStevenChatId().
 */

import { Bot } from 'grammy';
import { handleTelegramMessage } from './telegramHandler';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[Telegram]';
const runtimeLog = log.fromContext({ source: 'telegramClient', route: 'telegram/client' });

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in environment');
}

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
export const getTelegramBot = () => bot;
export const getStevenChatId = (): number => {
  const id = process.env.TELEGRAM_STEVEN_CHAT_ID;
  if (!id) return 0; // 0 = not configured yet
  return Number(id);
};

bot.on('message', async (ctx) => {
  const chatId = ctx.chat.id;
  const stevenChatId = getStevenChatId();

  // If TELEGRAM_STEVEN_CHAT_ID not configured yet, log the incoming chat ID
  if (!stevenChatId) {
    console.log(`${LOG_PREFIX} Message from chat ID: ${chatId} — set TELEGRAM_STEVEN_CHAT_ID=${chatId} in .env.local to activate`);
    await ctx.reply(`Hi! I'm Kayley. Set TELEGRAM_STEVEN_CHAT_ID=${chatId} in .env.local and restart me.`);
    return;
  }

  // Only process messages from Steven
  if (chatId !== stevenChatId) {
    runtimeLog.warning('Message from unknown chat ID, ignoring', {
      source: 'telegramClient',
      chatId,
      stevenChatId,
    });
    return;
  }

  try {
    await handleTelegramMessage(ctx);
  } catch (err) {
    runtimeLog.error('Unhandled error in message handler', {
      source: 'telegramClient',
      chatId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export async function startTelegramBot(): Promise<void> {
  runtimeLog.info('Starting Telegram bot (long polling)', { source: 'telegramClient' });
  console.log(`${LOG_PREFIX} Starting bot...`);

  // Clear any existing webhook — required for long polling to receive messages.
  // If the token was ever used with a webhook URL, Telegram will silently drop
  // all getUpdates calls until the webhook is removed.
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    console.log(`${LOG_PREFIX} Webhook cleared (long polling active)`);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Could not clear webhook:`, err);
  }

  bot.start({
    onStart: (botInfo) => {
      console.log(`${LOG_PREFIX} Bot @${botInfo.username} is running`);
      runtimeLog.info('Telegram bot started', {
        source: 'telegramClient',
        username: botInfo.username,
        botId: botInfo.id,
      });
    },
  }).catch((err) => {
    runtimeLog.error('Telegram bot polling error', {
      source: 'telegramClient',
      error: err instanceof Error ? err.message : String(err),
    });
    console.error(`${LOG_PREFIX} Bot error:`, err);
  });
}
