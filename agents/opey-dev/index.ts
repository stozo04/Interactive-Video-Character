// agents/opey-dev/index.ts
// Standalone entry point for Opey-Dev agent process.
// Run with: npm run opey:dev

import { startOpeyDev } from "./main";
import { log } from "../../lib/logger";

const LOG_PREFIX = "[Opey-Dev]";
const runtimeLog = log.fromContext({ source: "opey-dev/index", route: "opey-dev/startup" });

runtimeLog.info("Opey-Dev standalone process starting", {
  nodeVersion: process.version,
  pid: process.pid,
});

const workspaceRoot = process.cwd();
const handle = startOpeyDev({ workspaceRoot });

runtimeLog.info("Opey-Dev poll loop started", { workspaceRoot });

function shutdown(signal: string): void {
  console.log(`${LOG_PREFIX} Shutdown requested`, { signal });
  runtimeLog.warning("Opey-Dev shutdown initiated", { signal });
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
