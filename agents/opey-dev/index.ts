// agents/opey-dev/index.ts
// Standalone entry point for Opey-Dev agent process.
// Run with: npm run opey:dev

import { createServer } from "node:http";
import { startOpeyDev } from "./main";
import { log } from "../../lib/logger";

const LOG_PREFIX = "[Opey-Dev]";
const OPEY_HEALTH_PORT = 4013;
const runtimeLog = log.fromContext({ source: "opey-dev/index", route: "opey-dev/startup" });

runtimeLog.info("Opey-Dev standalone process starting", {
  nodeVersion: process.version,
  pid: process.pid,
});

const workspaceRoot = process.cwd();
const handle = startOpeyDev({ workspaceRoot });

runtimeLog.info("Opey-Dev poll loop started", { workspaceRoot });

const healthServer = createServer((req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

  if (method === "GET" && url.pathname === "/health") {
    const status = handle.getStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      alive: status.alive,
      currentTicketId: status.currentTicketId,
      lastPollAt: status.lastPollAt,
    }));
    return;
  }

  if (method === "POST" && url.pathname === "/restart") {
    runtimeLog.warning("Opey-Dev restart requested via health server", {
      source: "opey-dev/index",
      route: "opey-dev/restart",
    });
    handle.restart();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Opey poll loop restarted." }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Route not found." }));
});

healthServer.listen(OPEY_HEALTH_PORT, "127.0.0.1", () => {
  runtimeLog.info("Opey-Dev health server started", {
    source: "opey-dev/index",
    route: "opey-dev/health",
    port: OPEY_HEALTH_PORT,
  });
});

function shutdown(signal: string): void {
  console.log(`${LOG_PREFIX} Shutdown requested`, { signal });
  runtimeLog.warning("Opey-Dev shutdown initiated", { signal });
  healthServer.close();
  handle.stop();

  // Give pending log writes a moment to flush
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  runtimeLog.critical("Uncaught exception in Opey-Dev process", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  console.error(`${LOG_PREFIX} Uncaught exception:`, err);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  runtimeLog.critical("Unhandled promise rejection in Opey-Dev process", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  console.error(`${LOG_PREFIX} Unhandled rejection:`, reason);
});
