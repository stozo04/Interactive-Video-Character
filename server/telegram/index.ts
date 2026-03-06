/**
 * Telegram Bridge Entry Point
 *
 * Run: npm run telegram:dev
 *
 * NOTE: envShim is loaded via --import flag in the npm script,
 * NOT imported here. It must run before ANY module reads import.meta.env.
 */

import { createServer } from 'node:http';
import { startTelegramBot } from './telegramClient';
import { startEmailBridge } from './telegramEmailBridge';
import { startTelegramEngineeringTicketBridge } from './telegramEngineeringTicketBridge';
import { startGmailPoller } from '../services/gmailPoller';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[Telegram]';
const runtimeLog = log.fromContext({ source: 'telegramIndex', route: 'telegram' });
const HEALTH_PORT = Number(process.env.TELEGRAM_HEALTH_PORT);

function startHealthServer() {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (req.method === 'GET' && pathname === '/health') {
      runtimeLog.info('Health check requested', { source: 'telegramIndex' });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, transport: 'telegram' }));
      return;
    }

    runtimeLog.warning('Health server received unknown route', {
      source: 'telegramIndex',
      method: req.method,
      pathname,
    });
    res.statusCode = 404;
    res.end();
  });

  server.listen(HEALTH_PORT, () => {
    runtimeLog.info('Telegram health server listening', {
      source: 'telegramIndex',
      port: HEALTH_PORT,
    });
  });
}

async function main() {
  console.log(`${LOG_PREFIX} Starting Telegram bridge...`);
  runtimeLog.info('Telegram bridge initialization starting', {
    source: 'telegramIndex',
    nodeVersion: process.version,
    platform: process.platform,
    timestamp: new Date().toISOString(),
  });

  startHealthServer();

  try {
    // Start the bot (long polling — no QR, no lock file needed)
    await startTelegramBot();

    // Poll Gmail directly — no browser needed for email notifications
    startGmailPoller();

    // Forward any browser-caught emails that haven't been sent to Telegram yet
    startEmailBridge();

    // Forward engineering ticket lifecycle notifications to Telegram
    startTelegramEngineeringTicketBridge();

    console.log(`${LOG_PREFIX} Bridge running. Waiting for messages...`);
    runtimeLog.info('Telegram bridge initialized', {
      source: 'telegramIndex',
      status: 'listening',
    });
  } catch (initError) {
    const errorMessage = initError instanceof Error ? initError.message : String(initError);
    runtimeLog.error('Failed to initialize Telegram bridge', {
      source: 'telegramIndex',
      error: errorMessage,
    });
    console.error(`${LOG_PREFIX} Failed to initialize:`, initError);
    throw initError;
  }
}

main().catch((err) => {
  console.error(`${LOG_PREFIX} Fatal error:`, err);
  runtimeLog.critical('Telegram bridge fatal error - process terminating', {
    source: 'telegramIndex',
    error: err instanceof Error ? err.message : String(err),
    exitCode: 1,
  });
  process.exit(1);
});
