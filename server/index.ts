import { createServer } from "node:http";
import path from "node:path";
import dotenv from "dotenv";
import { routeAnthropicRequest } from "./routes/anthropicRoutes";
import { startOpeyDev } from "./agent/opey-dev/main";
import { startCronScheduler } from "./scheduler/cronScheduler";

const LOG_PREFIX = "[WorkspaceAgent]";
const DEFAULT_PORT = 4010;

// 1) Load environment variables from .env so local dev keys are available.
const port = DEFAULT_PORT;
const envResult = dotenv.config({ path: path.resolve(process.cwd(), ".env") });
if (envResult.error) {
  console.warn(`${LOG_PREFIX} .env load failed`, { error: envResult.error.message });
} else {
  console.log(`${LOG_PREFIX} .env loaded`, { parsed: Boolean(envResult.parsed) });
}

// 2) Decide the root folder the workspace agent is allowed to operate inside.
// We always use the current working directory (the folder you launched the server from).
// Example: if you run `npm run agent:dev` from `C:\\Users\\gates\\Personal\\Interactive-Video-Character`,
// then `process.cwd()` resolves to that folder and becomes the workspace root.
const workspaceRoot = process.cwd();

// 3) Read Supabase config (these are required for persistence).
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error(`${LOG_PREFIX} Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.`);
  process.exit(1);
}

// 3.5) Initialize runtime logger for Supabase log persistence.
initializeRuntimeLogger({
  supabaseUrl,
  supabaseKey: supabaseServiceRoleKey,
});

// 4) Start Opey development agent system.
const opeyDevHandle = startOpeyDev({
  supabaseUrl,
  supabaseKey: supabaseServiceRoleKey,
  workspaceRoot,
});

// 5) Background services.
// Cron scheduler: handles scheduled “Kayley” digests and promise reminders.
const cronScheduler = startCronScheduler({
  supabaseUrl,
  supabaseServiceRoleKey,
  tickMs: Number(process.env.CRON_TICK_MS || 60_000),
  schedulerId: process.env.CRON_SCHEDULER_ID || `scheduler_${process.pid}`,
});

// 6) HTTP server: routes incoming requests to the right handler.
const server = createServer(async (req, res) => {
  try {
    // a) Anthropic-specific routes (Claude CLI runner).
    const handledAnthropic = await routeAnthropicRequest(req, res);
    if (handledAnthropic) return;

    // b) If no route matched, return 404 JSON.
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Route not found." }));
  } catch (error) {
    console.error(`${LOG_PREFIX} Request handler crashed`, {
      method: req.method,
      url: req.url,
      error,
    });

    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Internal server error." }));
  }
});

// 7) Start listening for HTTP requests.
server.listen(port, () => {
  console.log(`${LOG_PREFIX} Server listening`, {
    port,
    workspaceRoot,
    persistence: "supabase",
  });
});

// 8) Graceful shutdown: stop background loops, then close the HTTP server.
function shutdown(signal: string): void {
  console.log(`${LOG_PREFIX} Shutdown requested`, { signal });
  opeyDevHandle.stop();
  cronScheduler.stop();
  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
function initializeRuntimeLogger(arg0: { supabaseUrl: string; supabaseKey: string; }) {
  throw new Error("Function not implemented.");
}

