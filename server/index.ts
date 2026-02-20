import { createServer } from "node:http";
import path from "node:path";
import { ObservableRunStore } from "./agent/observableRunStore";
import { WorkspaceRunEventHub } from "./agent/runEvents";
import { WorkspaceRunQueue } from "./agent/runQueue";
import { SupabaseRunStore } from "./agent/supabaseRunStore";
import { routeAgentRequest } from "./routes/agentRoutes";
import { routeAnthropicRequest } from "./routes/anthropicRoutes";
import { startCronScheduler } from "./scheduler/cronScheduler";

const LOG_PREFIX = "[WorkspaceAgent]";
const DEFAULT_PORT = 4010;

const port =  DEFAULT_PORT;
const workspaceRoot = process.env.WORKSPACE_AGENT_ROOT
  ? path.resolve(process.env.WORKSPACE_AGENT_ROOT)
  : process.cwd();

const supabaseUrl = 'https://bqyfplifeyvkilkoneph.supabase.co';
const supabaseServiceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxeWZwbGlmZXl2a2lsa29uZXBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU4MzA2NTQsImV4cCI6MjA1MTQwNjY1NH0.ydowrDwep95J1DlPalzdCIKlk5XAxNWClySjvPn-gVc";

const eventHub = new WorkspaceRunEventHub();
const runQueue = new WorkspaceRunQueue();
const runStore = new ObservableRunStore(
  new SupabaseRunStore({
  supabaseUrl,
  supabaseServiceRoleKey,
  }),
  eventHub,
);

const cronScheduler = startCronScheduler({
  supabaseUrl,
  supabaseServiceRoleKey,
  tickMs: Number(process.env.CRON_TICK_MS || 60_000),
  schedulerId: process.env.CRON_SCHEDULER_ID || `scheduler_${process.pid}`,
});

const server = createServer(async (req, res) => {
  try {
    const handledAnthropic = await routeAnthropicRequest(req, res);
    if (handledAnthropic) return;

    const handled = await routeAgentRequest(req, res, {
      runStore,
      runEventHub: eventHub,
      runQueue,
      workspaceRoot,
    });

    if (handled) {
      return;
    }

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

server.listen(port, () => {
  console.log(`${LOG_PREFIX} Server listening`, {
    port,
    workspaceRoot,
    persistence: "supabase",
    queue: "serial_single_run",
  });
});

function shutdown(signal: string): void {
  console.log(`${LOG_PREFIX} Shutdown requested`, { signal });
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
