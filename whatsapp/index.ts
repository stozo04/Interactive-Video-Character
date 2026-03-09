/**
 * WhatsApp Bridge Entry Point
 *
 * Run: npm run whatsapp:dev
 *
 * NOTE: envShim is loaded via --import flag in the npm script,
 * NOT imported here. It must run before ANY module reads import.meta.env.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { startWhatsAppClient, isWhatsAppConnected } from "./baileyClient";
import { handleWhatsAppMessage } from "./whatsappHandler";
import { startEmailBridge } from "./emailBridge";
import { startXMentionBridge } from "./xMentionBridge";
import { startWhatsAppEngineeringTicketBridge } from "./engineeringTicketBridge";
import { startGmailPoller } from "../server/services/gmailPoller";
import { log } from "../lib/logger";
import fs from "fs";
import path from "path";

const LOG_PREFIX = "[WhatsApp]";
const runtimeLog = log.fromContext({ source: "whatsappIndex", route: "whatsapp" });
const HEALTH_PORT = Number(process.env.WHATSAPP_HEALTH_PORT ?? 4011);

function startHealthServer() {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    if (req.method === "GET" && pathname === "/health") {
      const connected = isWhatsAppConnected();
      runtimeLog.info("Health check requested", { source: "whatsappIndex", connected });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, connected }));
      return;
    }

    if (req.method === "POST" && pathname === "/restart") {
      runtimeLog.info("Restart requested via API — preparing to respawn", { source: "whatsappIndex" });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, message: "WhatsApp bridge restarting..." }));
      res.on("finish", () => {
        runtimeLog.info("Releasing lock and spawning new bridge process", {
          source: "whatsappIndex",
          execPath: process.execPath,
          argv: process.argv.slice(1),
        });
        releaseSingleInstanceLock();
        const child = spawn(process.execPath, process.argv.slice(1), {
          detached: true,
          stdio: "ignore",
          cwd: process.cwd(),
          env: process.env as NodeJS.ProcessEnv,
        });
        child.unref();
        setTimeout(() => process.exit(0), 200);
      });
      return;
    }

    runtimeLog.warning("Health server received unknown route", {
      source: "whatsappIndex",
      method: req.method,
      pathname,
    });
    res.statusCode = 404;
    res.end();
  });
  server.listen(HEALTH_PORT, () => {
    runtimeLog.info("WhatsApp health server listening", {
      source: "whatsappIndex",
      port: HEALTH_PORT,
    });
  });
}
const AUTH_DIR = ".whatsapp-auth";
const LOCK_FILE = path.join(AUTH_DIR, "bridge.lock");

function acquireSingleInstanceLock(): boolean {
  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const handle = fs.openSync(LOCK_FILE, "wx");
    fs.writeFileSync(handle, String(process.pid));
    fs.closeSync(handle);
    return true;
  } catch (error: any) {
    const code = typeof error?.code === "string" ? error.code : "unknown";
    console.error(`${LOG_PREFIX} Another WhatsApp bridge appears to be running (lock: ${LOCK_FILE}).`);
    runtimeLog.error("WhatsApp bridge lock acquisition failed", {
      source: "whatsappIndex",
      lockFile: LOCK_FILE,
      errorCode: code,
      errorMessage: error?.message ?? String(error),
    });
    return false;
  }
}

function releaseSingleInstanceLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (error: any) {
    runtimeLog.warning("Failed to release WhatsApp bridge lock", {
      source: "whatsappIndex",
      lockFile: LOCK_FILE,
      errorMessage: error?.message ?? String(error),
    });
  }
}

async function main() {
  let stopXMentionBridge: (() => void) | null = null;

  console.log(`${LOG_PREFIX} Starting WhatsApp bridge...`);
  runtimeLog.info("WhatsApp bridge initialization starting", {
    source: "whatsappIndex",
    nodeVersion: process.version,
    platform: process.platform,
    timestamp: new Date().toISOString(),
  });

  if (!acquireSingleInstanceLock()) {
    console.error(`${LOG_PREFIX} Exiting due to existing lock. Stop other bridge processes and retry.`);
    process.exit(1);
  }

  process.on("exit", () => releaseSingleInstanceLock());
  process.on("SIGINT", () => {
    stopXMentionBridge?.();
    releaseSingleInstanceLock();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopXMentionBridge?.();
    releaseSingleInstanceLock();
    process.exit(0);
  });

  startHealthServer();

  try {
    runtimeLog.info("Starting WhatsApp client with message handler", {
      source: "whatsappIndex",
      messageHandlerType: "async",
    });

    await startWhatsAppClient(async (sock, text, jid, replyJid, userContent, inboundMessageId) => {
      runtimeLog.info("WhatsApp message handler callback invoked", {
        source: "whatsappIndex",
        jid,
        inboundMessageId: inboundMessageId ?? null,
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

        await handleWhatsAppMessage(sock, text, jid, replyJid, userContent, inboundMessageId);

        runtimeLog.info("WhatsApp message processed successfully", {
          source: "whatsappIndex",
          jid,
          inboundMessageId: inboundMessageId ?? null,
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

    // Poll Gmail directly — no browser needed for email notifications
    startGmailPoller();

    // Forward any browser-caught emails that haven't been sent to WA yet
    startEmailBridge();

    // Forward queued X mention notifications from the main server
    stopXMentionBridge = startXMentionBridge().stop;

    // Forward engineering ticket lifecycle notifications to WhatsApp
    startWhatsAppEngineeringTicketBridge();

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
  } finally {
    stopXMentionBridge?.();
    releaseSingleInstanceLock();
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
