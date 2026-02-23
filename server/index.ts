import { createServer } from "node:http";
import path from "node:path";
import dotenv from "dotenv";
import { ObservableRunStore } from "./agent/observableRunStore";
import { WorkspaceRunEventHub } from "./agent/runEvents";
import { WorkspaceRunQueue } from "./agent/runQueue";
import { SupabaseRunStore } from "./agent/supabaseRunStore";
import { SupabaseTicketStore } from "./agent/multiAgent/ticketStore";
import { MultiAgentOrchestrator } from "./agent/multiAgent/orchestrator";
import { MultiAgentArtifactService } from "./agent/multiAgent/artifactService";
import { OpeyDeveloperAgent } from "./agent/dev/opey";
import { KeraCoordinator } from "./agent/assistant/kera";
import { ClaudyQaAgent } from "./agent/qa/claudy";
import { WorktreeManager } from "./agent/multiAgent/worktreeManager";
import { SupabaseChatSessionStore } from "./agent/multiAgent/chatSessionStore";
import { TeamChatRouter } from "./agent/multiAgent/teamChatRouter";
import { WorkspaceRunLinker } from "./agent/multiAgent/workspaceRunLinker";
import { startIntakeWatcher } from "./agent/multiAgent/intakeWatcher";
import { routeAgentRequest } from "./routes/agentRoutes";
import { routeAnthropicRequest } from "./routes/anthropicRoutes";
import { routeMultiAgentRequest } from "./routes/multiAgentRoutes";
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

// 4) Create shared run infrastructure for workspace runs (queue + event hub + storage).
// - WorkspaceRunEventHub: in-memory event bus for run status updates (used by SSE/UI).
// - WorkspaceRunQueue: serializes workspace runs so only one executes at a time.
// - ObservableRunStore: wraps the real store and emits events on run changes.
// - SupabaseRunStore: persistence layer for run records and steps.
const eventHub = new WorkspaceRunEventHub();
const runQueue = new WorkspaceRunQueue();
const runStore = new ObservableRunStore(
  new SupabaseRunStore({
  supabaseUrl,
  supabaseServiceRoleKey,
  }),
  eventHub,
);
// WorkspaceRunLinker: converts Opey requested actions into workspace runs and
// logs ticket events/artifacts to keep the audit trail linked.
const workspaceRunLinker = new WorkspaceRunLinker({
  runStore,
  runQueue,
});

// 5) Create multi-agent stores + services.
const ticketStore = new SupabaseTicketStore({
  supabaseUrl,
  supabaseServiceRoleKey,
});
const chatStore = new SupabaseChatSessionStore({
  supabaseUrl,
  supabaseServiceRoleKey,
});
const teamChatRouter = new TeamChatRouter(chatStore);
const artifactService = new MultiAgentArtifactService({
  ticketStore,
  runStore,
});
// WorktreeManager: creates per-ticket git worktrees (isolated work folders).
const worktreeManager = new WorktreeManager(workspaceRoot);
// KeraCoordinator: intake agent that turns a request into a ticket and status updates.
const keraCoordinator = new KeraCoordinator(ticketStore);
// OpeyDeveloperAgent: developer agent that plans/implements changes.
const opeyAgent = new OpeyDeveloperAgent();
// ClaudyQaAgent: QA/review agent that checks Opey’s work and gives verdicts.
const claudyAgent = new ClaudyQaAgent();
// 6) Orchestrator coordinates the full ticket workflow.
const multiAgentOrchestrator = new MultiAgentOrchestrator({
  ticketStore,
  artifactService,
  runStore,
  worktreeManager,
  opeyAgent,
  keraCoordinator,
  claudyAgent,
  workspaceRunLinker,
});
// Circular reference: Kera needs orchestrator access, but orchestrator already holds Kera.
keraCoordinator.setOrchestrator(multiAgentOrchestrator);
// Circular callback: linker notifies orchestrator when a ticket's queued workspace runs settle.
workspaceRunLinker.setOnTicketRunsSettled((event) =>
  multiAgentOrchestrator.handleWorkspaceRunsSettled(event),
);

// 7) Background services.
// Cron scheduler: handles scheduled “Kayley” digests and promise reminders.
const cronScheduler = startCronScheduler({
  supabaseUrl,
  supabaseServiceRoleKey,
  tickMs: Number(process.env.CRON_TICK_MS || 60_000),
  schedulerId: process.env.CRON_SCHEDULER_ID || `scheduler_${process.pid}`,
});
// Intake watcher: auto-starts tickets that are still in `created` state.
const intakeWatcher = startIntakeWatcher({
  // Ticket store is the source of truth for ticket data in Supabase.
  ticketStore,
  // Orchestrator drives the workflow (moves tickets forward and triggers agents).
  orchestrator: multiAgentOrchestrator,
  // How often to scan for new tickets in `created` status.
  tickMs: Number(process.env.MULTI_AGENT_INTAKE_TICK_MS || 15_000),
  // Safety cap so we only start N tickets per tick (prevents overload).
  maxPerTick: Number(process.env.MULTI_AGENT_INTAKE_MAX_PER_TICK || 10),
  // Helpful name for logs so you can identify this watcher instance.
  watcherId: process.env.MULTI_AGENT_INTAKE_WATCHER_ID || `intake_${process.pid}`,
});

// 8) HTTP server: routes incoming requests to the right handler.
const server = createServer(async (req, res) => {
  try {
    // a) Anthropic-specific routes (Claude CLI runner).
    const handledAnthropic = await routeAnthropicRequest(req, res);
    if (handledAnthropic) return;

    // b) Workspace agent routes (create runs, poll runs, approvals).
    const handled = await routeAgentRequest(req, res, {
      runStore,
      runEventHub: eventHub,
      runQueue,
      workspaceRoot,
    });

    if (handled) {
      return;
    }

    // c) Multi-agent routes (tickets, turns, events, chat sessions).
    const handledMultiAgent = await routeMultiAgentRequest(req, res, {
      ticketStore,
      orchestrator: multiAgentOrchestrator,
      chatStore,
      teamChatRouter,
    });
    if (handledMultiAgent) {
      return;
    }

    // d) If no route matched, return 404 JSON.
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

// 9) Start listening for HTTP requests.
server.listen(port, () => {
  console.log(`${LOG_PREFIX} Server listening`, {
    port,
    workspaceRoot,
    persistence: "supabase",
    queue: "serial_single_run",
  });
});

// 10) Graceful shutdown: stop background loops, then close the HTTP server.
function shutdown(signal: string): void {
  console.log(`${LOG_PREFIX} Shutdown requested`, { signal });
  cronScheduler.stop();
  intakeWatcher.stop();
  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
