/**
 * WhatsApp Bridge Entry Point
 *
 * Run: npm run whatsapp:dev
 *
 * NOTE: envShim is loaded via --import flag in the npm script,
 * NOT imported here. It must run before ANY module reads import.meta.env.
 */

import { startWhatsAppClient } from "./baileyClient";
import { handleWhatsAppMessage } from "./whatsappHandler";

const LOG_PREFIX = "[WhatsApp]";

async function main() {
  console.log(`${LOG_PREFIX} Starting WhatsApp bridge...`);

  await startWhatsAppClient(async (sock, text, jid, replyJid) => {
    await handleWhatsAppMessage(sock, text, jid, replyJid);
  });

  console.log(`${LOG_PREFIX} Waiting for QR scan or session restore...`);
}

main().catch((err) => {
  console.error(`${LOG_PREFIX} Fatal error:`, err);
  process.exit(1);
});
