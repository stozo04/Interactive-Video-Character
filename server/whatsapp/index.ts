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
import { log } from "../runtimeLogger";

const LOG_PREFIX = "[WhatsApp]";
const runtimeLog = log.fromContext({ source: "whatsappIndex", route: "whatsapp" });

async function main() {
  console.log(`${LOG_PREFIX} Starting WhatsApp bridge...`);
  runtimeLog.info("WhatsApp bridge initialization starting", {
    source: "whatsappIndex",
    nodeVersion: process.version,
    platform: process.platform,
    timestamp: new Date().toISOString(),
  });

  try {
    runtimeLog.info("Starting WhatsApp client with message handler", {
      source: "whatsappIndex",
      messageHandlerType: "async",
    });

    await startWhatsAppClient(async (sock, text, jid, replyJid, userContent) => {
      runtimeLog.info("WhatsApp message handler callback invoked", {
        source: "whatsappIndex",
        jid,
        textLength: text.length,
        hasUserContent: !!userContent,
      });

      try {
        runtimeLog.info("Processing WhatsApp message through handler", {
          source: "whatsappIndex",
          jid,
          replyJid,
          hasUserContent: !!userContent,
        });

        await handleWhatsAppMessage(sock, text, jid, replyJid, userContent);

        runtimeLog.info("WhatsApp message processed successfully", {
          source: "whatsappIndex",
          jid,
        });
      } catch (handlerError) {
        runtimeLog.error("Failed to handle WhatsApp message", {
          source: "whatsappIndex",
          jid,
          replyJid,
          error: handlerError instanceof Error ? handlerError.message : String(handlerError),
          errorType: handlerError instanceof Error ? handlerError.constructor.name : "unknown",
        });
        // Continue processing other messages even if one fails
      }
    });

    console.log(`${LOG_PREFIX} Waiting for QR scan or session restore...`);
    runtimeLog.info("WhatsApp bridge initialized and waiting for connection", {
      source: "whatsappIndex",
      status: "listening",
      message: "Waiting for QR scan or session restore",
    });
  } catch (initError) {
    const errorMessage = initError instanceof Error ? initError.message : String(initError);
    const errorStack = initError instanceof Error ? initError.stack : undefined;

    runtimeLog.error("Failed to initialize WhatsApp bridge client", {
      source: "whatsappIndex",
      error: errorMessage,
      errorType: initError instanceof Error ? initError.constructor.name : "unknown",
      hasStack: !!errorStack,
    });

    console.error(`${LOG_PREFIX} Failed to initialize WhatsApp client:`, initError);
    throw initError;
  }
}

main().catch((err) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorStack = err instanceof Error ? err.stack : undefined;

  console.error(`${LOG_PREFIX} Fatal error:`, err);

  runtimeLog.critical("WhatsApp bridge fatal error - process terminating", {
    source: "whatsappIndex",
    error: errorMessage,
    errorType: err instanceof Error ? err.constructor.name : "unknown",
    hasStack: !!errorStack,
    exitCode: 1,
  });

  process.exit(1);
});
