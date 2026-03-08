import { createServer } from "node:http";
import path from "node:path";
import dotenv from "dotenv";
import { routeAnthropicRequest } from "./routes/anthropicRoutes";
import { createMultiAgentRouter } from "./routes/multiAgentRoutes";
import { createWorkspaceAgentRouter } from "./routes/workspaceAgentRoutes";
import { createAgentRouter } from "./routes/agentRoutes";
import { startOpeyDev } from "./agent/opey-dev/main";
import { startCronScheduler } from "./scheduler/cronScheduler";
import { startCalendarHeartbeat } from "./services/calendarHeartbeat";
import { startXMentionHeartbeat } from "./services/xMentionHeartbeat";
import { log } from "./runtimeLogger";
import "./restartTrigger"; // kept in tsx watch dependency graph for Kayley's self-healing restart mechanic

const LOG_PREFIX = "[WorkspaceAgent]";
const DEFAULT_PORT = 4010;
const runtimeLog = log.fromContext({ source: "serverIndex", route: "server/startup" });

runtimeLog.info("Server initialization starting", {
  source: "serverIndex",
  nodeVersion: process.version,
  platform: process.platform,
  timestamp: new Date().toISOString(),
});

// 1) Load environment variables from one source path strategy:
//    root .env.local (highest) then root .env (fallback).
//    dotenv.config skips keys already set, so load highest-priority first.
const port = DEFAULT_PORT;
const repoRoot = process.cwd();

runtimeLog.info("Loading environment configuration files", {
  source: "serverIndex",
  repoRoot,
  priority: ".env.local -> .env",
});

const loadedEnvFiles: string[] = [];
[
  path.resolve(repoRoot, ".env.local"),
  path.resolve(repoRoot, ".env"),
].forEach((envPath) => {
  const r = dotenv.config({ path: envPath });
  if (!r.error) {
    console.log(`${LOG_PREFIX} loaded env`, { file: envPath });
    loadedEnvFiles.push(envPath);
    runtimeLog.info("Environment file loaded", {
      source: "serverIndex",
      envPath,
      keysLoaded: Object.keys(r.parsed ?? {}).length,
    });
  } else {
    runtimeLog.info("Environment file not found or already loaded", {
      source: "serverIndex",
      envPath,
    });
  }
});

runtimeLog.info("Environment configuration loaded", {
  source: "serverIndex",
  filesLoaded: loadedEnvFiles.length,
  files: loadedEnvFiles.join(", "),
});

// 2) Decide the root folder the workspace agent is allowed to operate inside.
// We always use the current working directory (the folder you launched the server from).
// Example: if you run `npm run agent:dev` from `C:\\Users\\gates\\Personal\\Interactive-Video-Character`,
// then `process.cwd()` resolves to that folder and becomes the workspace root.
const workspaceRoot = process.cwd();

runtimeLog.info("Workspace root configured", {
  source: "serverIndex",
  workspaceRoot,
});

// 3) Read Supabase config (these are required for persistence).
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

runtimeLog.info("Supabase configuration loading", {
  source: "serverIndex",
  hasSupabaseUrl: !!supabaseUrl,
  hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  hasAnonKey: !!process.env.SUPABASE_ANON_KEY,
});

if (!supabaseUrl || !supabaseServiceRoleKey) {
  const errorMessage = "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables";
  runtimeLog.critical("Server startup failed - missing required configuration", {
    source: "serverIndex",
    error: errorMessage,
    hasSupabaseUrl: !!supabaseUrl,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasAnonKey: !!process.env.SUPABASE_ANON_KEY,
    exitCode: 1,
  });
  console.error(`${LOG_PREFIX} ${errorMessage}`);
  process.exit(1);
}

runtimeLog.info("Supabase configuration validated", {
  source: "serverIndex",
  hasSupabaseUrl: true,
  hasServiceRoleKey: !!supabaseServiceRoleKey,
});

// 4) Start Opey development agent system.
runtimeLog.info("Starting Opey development agent system", {
  source: "serverIndex",
  workspaceRoot,
});

const opeyDevHandle = startOpeyDev({
  workspaceRoot,
});

runtimeLog.info("Opey development agent system started", {
  source: "serverIndex",
});

// Create multi-agent router
runtimeLog.info("Creating multi-agent router", {
  source: "serverIndex",
});

const routeMultiAgentRequest = createMultiAgentRouter({
  supabaseUrl,
  supabaseServiceRoleKey,
  opey: {
    getStatus: () => opeyDevHandle.getStatus(),
    restart: () => opeyDevHandle.restart(),
  },
});

runtimeLog.info("Multi-agent router created", {
  source: "serverIndex",
});

runtimeLog.info("Creating workspace agent router", {
  source: "serverIndex",
});

const routeWorkspaceAgentRequest = createWorkspaceAgentRouter({
  workspaceRoot,
});

runtimeLog.info("Workspace agent router created", {
  source: "serverIndex",
  workspaceRoot,
});

// Create agent router (Kayley brain — single entry point for all clients)
runtimeLog.info("Creating agent router", { source: "serverIndex" });
const routeAgentRequest = createAgentRouter();
runtimeLog.info("Agent router created", { source: "serverIndex" });

// 5) Background services.
// Cron scheduler: handles scheduled "Kayley" digests and promise reminders.
const cronTickMs = Number(process.env.CRON_TICK_MS || 60_000);
const cronSchedulerId = process.env.CRON_SCHEDULER_ID || `scheduler_${process.pid}`;

runtimeLog.info("Starting cron scheduler for scheduled tasks", {
  source: "serverIndex",
  tickMs: cronTickMs,
  schedulerId: cronSchedulerId,
  purpose: "scheduled digests and promise reminders",
});

const cronScheduler = startCronScheduler({
  supabaseUrl,
  supabaseServiceRoleKey,
  tickMs: cronTickMs,
  schedulerId: cronSchedulerId,
});

runtimeLog.info("Cron scheduler started", {
  source: "serverIndex",
  schedulerId: cronSchedulerId,
  tickMs: cronTickMs,
});

// Calendar heartbeat: 15-minute interval, 8am-7pm CST
const calendarHeartbeat = startCalendarHeartbeat();
runtimeLog.info("Calendar heartbeat started", { source: "serverIndex" });

// X mention heartbeat: 5-minute interval, proactive mention notifications
const xMentionHeartbeat = startXMentionHeartbeat();
runtimeLog.info("X mention heartbeat started", { source: "serverIndex" });

// 6) HTTP server: routes incoming requests to the right handler.
runtimeLog.info("Creating HTTP server", {
  source: "serverIndex",
  port,
});

const server = createServer(async (req, res) => {
  const requestId = `${req.method}_${req.url}_${Date.now()}`;

  try {
    runtimeLog.info("Incoming HTTP request", {
      source: "serverIndex",
      requestId,
      method: req.method,
      url: req.url,
      remoteAddress: req.socket.remoteAddress,
    });

    if (req.method === "GET") {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("ok");
        return;
      }
    }

    // a) Agent routes (Kayley brain — primary path for all clients).
    const handledAgent = await routeAgentRequest(req, res);
    if (handledAgent) {
      runtimeLog.info("Request handled by agent router", {
        source: "serverIndex",
        requestId,
        statusCode: res.statusCode,
      });
      return;
    }

    // b) Anthropic-specific routes (Claude CLI runner).
    runtimeLog.info("Attempting to route through Anthropic handler", {
      source: "serverIndex",
      requestId,
      url: req.url,
    });

    const handledAnthropic = await routeAnthropicRequest(req, res);
    if (handledAnthropic) {
      runtimeLog.info("Request handled by Anthropic router", {
        source: "serverIndex",
        requestId,
        statusCode: res.statusCode,
      });
      return;
    }

    // b) Workspace agent routes (file ops).
    runtimeLog.info("Attempting to route through workspace agent handler", {
      source: "serverIndex",
      requestId,
      url: req.url,
    });

    const handledWorkspaceAgent = await routeWorkspaceAgentRequest(req, res);
    if (handledWorkspaceAgent) {
      runtimeLog.info("Request handled by workspace agent router", {
        source: "serverIndex",
        requestId,
        statusCode: res.statusCode,
      });
      return;
    }

    // b) Multi-agent routes (tickets, events, chats).
    runtimeLog.info("Attempting to route through multi-agent handler", {
      source: "serverIndex",
      requestId,
      url: req.url,
    });

    const handledMultiAgent = await routeMultiAgentRequest(req, res);
    if (handledMultiAgent) {
      runtimeLog.info("Request handled by multi-agent router", {
        source: "serverIndex",
        requestId,
        statusCode: res.statusCode,
      });
      return;
    }

    // c) If no route matched, return 404 JSON.
    runtimeLog.warning("No route matched request", {
      source: "serverIndex",
      requestId,
      method: req.method,
      url: req.url,
    });

    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Route not found." }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.constructor.name : "unknown";

    runtimeLog.error("Request handler crashed with exception", {
      source: "serverIndex",
      requestId,
      method: req.method,
      url: req.url,
      error: errorMessage,
      errorType,
      remoteAddress: req.socket.remoteAddress,
    });

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
runtimeLog.info("Starting HTTP server listener", {
  source: "serverIndex",
  port,
});

server.listen(port, () => {
  console.log(`${LOG_PREFIX} Server listening`, {
    port,
    workspaceRoot,
    persistence: "supabase",
  });

  runtimeLog.info("HTTP server listening and ready to accept requests", {
    source: "serverIndex",
    port,
    workspaceRoot,
    persistence: "supabase",
    timestamp: new Date().toISOString(),
  });
});

server.on("error", (err) => {
  runtimeLog.error("HTTP server error", {
    source: "serverIndex",
    error: err instanceof Error ? err.message : String(err),
    errorType: err instanceof Error ? err.constructor.name : "unknown",
    port,
  });
  console.error(`${LOG_PREFIX} Server error:`, err);
});

// 8) Graceful shutdown: stop background loops, then close the HTTP server.
function shutdown(signal: string): void {
  console.log(`${LOG_PREFIX} Shutdown requested`, { signal });

  runtimeLog.warning("Server shutdown initiated", {
    source: "serverIndex",
    signal,
    timestamp: new Date().toISOString(),
  });

  runtimeLog.info("Stopping Opey development agent system", {
    source: "serverIndex",
  });
  opeyDevHandle.stop();

  runtimeLog.info("Stopping cron scheduler", {
    source: "serverIndex",
  });
  cronScheduler.stop();

  runtimeLog.info("Stopping calendar heartbeat", {
    source: "serverIndex",
  });
  calendarHeartbeat.stop();

  runtimeLog.info("Stopping X mention heartbeat", {
    source: "serverIndex",
  });
  xMentionHeartbeat.stop();

  runtimeLog.info("Closing HTTP server", {
    source: "serverIndex",
    gracefulTimeoutMs: 5000,
  });

  server.close(() => {
    runtimeLog.info("HTTP server closed successfully", {
      source: "serverIndex",
    });
    console.log(`${LOG_PREFIX} Server closed, exiting gracefully`);
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  const forceExitTimer = setTimeout(() => {
    runtimeLog.critical("Graceful shutdown timeout, forcing process exit", {
      source: "serverIndex",
      timeoutMs: 5000,
    });
    console.error(`${LOG_PREFIX} Graceful shutdown timeout, forcing exit`);
    process.exit(1);
  }, 5_000);

  forceExitTimer.unref();
}

// Signal handlers for graceful shutdown
process.on("SIGINT", () => {
  runtimeLog.info("SIGINT signal received", {
    source: "serverIndex",
    signal: "SIGINT",
  });
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  runtimeLog.info("SIGTERM signal received", {
    source: "serverIndex",
    signal: "SIGTERM",
  });
  shutdown("SIGTERM");
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  runtimeLog.critical("Uncaught exception in main process", {
    source: "serverIndex",
    error: err instanceof Error ? err.message : String(err),
    errorType: err instanceof Error ? err.constructor.name : "unknown",
    stack: err instanceof Error ? err.stack : undefined,
  });
  console.error(`${LOG_PREFIX} Uncaught exception:`, err);
  shutdown("uncaughtException");
});

// Handle unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  runtimeLog.critical("Unhandled promise rejection", {
    source: "serverIndex",
    reason: reason instanceof Error ? reason.message : String(reason),
    promiseId: (promise as any)?._id ?? "unknown",
  });
  console.error(`${LOG_PREFIX} Unhandled rejection:`, reason);
});
