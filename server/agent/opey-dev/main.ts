// ./server/agent/opey-dev/main.ts
// Entry point (The Boss) — polls for new tickets every 30s

import { execSync } from "node:child_process";
import { SupabaseTicketStore } from "./ticketStore";
import { WorktreeManager } from "./worktreeManager";
import { runOpeyLoop } from "./orchestrator";
import { runOpeyLoop as runOpeyLoopOpenAI } from "./orchestrator-openai";
import { log } from "../../runtimeLogger";
import { createPullRequest } from "./githubOps";

const LOG_PREFIX = "[Opey-Dev]";
const POLL_INTERVAL_MS = 30_000;
const SHELL_OPTS = process.platform === "win32" ? { shell: "bash" as const } : {};
const CLARIFICATION_MARKER = "--- CLARIFICATION ---";

/** Check if the worktree has any commits ahead of main. */
function hasCommitsAheadOfMain(workPath: string): boolean {
  try {
    const result = execSync("git log main..HEAD --oneline", { cwd: workPath, ...SHELL_OPTS }).toString().trim();
    return result.length > 0;
  } catch {
    return false;
  }
}


// Choose orchestrator: "claude" or "openai" (default: "claude")
const ORCHESTRATOR_BACKEND = process.env.OPEY_BACKEND ?? "claude";

let isProcessing = false;

async function processNextTicket(
  store: SupabaseTicketStore,
  manager: WorktreeManager,
): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  let ticketId: string | undefined;

  try {
    const ticket = await store.getNextTicket();
    if (!ticket) return;
    ticketId = ticket.id;

    log.info(`${LOG_PREFIX} Picked up ticket`, { source: "main.ts", ticketId, title: ticket.title });

    // Claim the ticket immediately so it won't be re-polled on failure
    await store.updateStatus(ticketId, "implementing");

    const { workPath } = manager.create(ticketId);
    await store.updateStatus(ticketId, "implementing", { worktreePath: workPath });

    log.info(`${LOG_PREFIX} Starting Opey loop (${ORCHESTRATOR_BACKEND})`, { source: "main.ts", ticketId, workPath });
    // const orchestrator = ORCHESTRATOR_BACKEND === "openai" ? runOpeyLoopOpenAI : runOpeyLoop;
    const orchestrator = runOpeyLoopOpenAI;
    const output = await orchestrator(ticket, workPath, log);

    // Did Opey actually implement anything?
    const madeChanges = hasCommitsAheadOfMain(workPath);

    if (!madeChanges) {
      // No commits — Opey didn't implement. Check if this is a first-pass clarification request.
      // Raw Supabase row uses snake_case; EngineeringTicket type uses camelCase
      const details: string = (ticket as any).additional_details ?? ticket.additionalDetails ?? "";
      const alreadyClarified = details.includes(CLARIFICATION_MARKER);

      if (!alreadyClarified) {
        // First pass with no changes = clarification request (max 1 loop)
        log.info(`${LOG_PREFIX} Opey requested clarification (no commits, first pass)`, { source: "main.ts", ticketId });
        await store.updateStatus(ticketId, "needs_clarification", { clarificationQuestions: output });
        manager.cleanup(ticketId);
        return;
      }

      // Already had a clarification loop — Opey tried but couldn't produce changes
      await store.updateStatus(ticketId, "completed", { failureReason: "No changes made after clarification" });
      log.warning(`${LOG_PREFIX} Completed with no changes (post-clarification)`, { source: "main.ts", ticketId });
      manager.cleanup(ticketId);
      return;
    }

    // Opey made changes — create PR
    log.info(`${LOG_PREFIX} Creating pull request`, { source: "main.ts", ticketId });
    const prUrl = await createPullRequest(workPath, ticket);

    if (prUrl) {
      await store.updateStatus(ticketId, "completed", { prUrl });
      log.info(`${LOG_PREFIX} Mission accomplished! PR: ${prUrl}`, { source: "main.ts", ticketId });
    } else {
      // Has commits but PR creation failed
      await store.updateStatus(ticketId, "failed", { failureReason: "Commits exist but PR creation failed" });
      log.error(`${LOG_PREFIX} PR creation failed despite commits`, { source: "main.ts", ticketId });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error(`${LOG_PREFIX} Ticket processing failed`, { source: "main.ts", error: message, ticketId });
    if (ticketId) {
      await store.updateStatus(ticketId, "failed", { failureReason: message }).catch(() => {});
    }
  } finally {
    isProcessing = false;
  }
}

export interface OpeyDevHandle {
  stop: () => void;
}

export function startOpeyDev(opts: {
  supabaseUrl: string;
  supabaseKey: string;
  workspaceRoot: string;
}): OpeyDevHandle {
  const missing: string[] = [];
  if (!opts.supabaseUrl) missing.push("supabaseUrl");
  if (!opts.supabaseKey) missing.push("supabaseKey");
  if (!opts.workspaceRoot) missing.push("workspaceRoot");

  if (missing.length > 0) {
    console.error(`${LOG_PREFIX} DISABLED — missing config: ${missing.join(", ")}`);
    return { stop: () => {} };
  }

  console.log(`${LOG_PREFIX} Starting`, {
    pollIntervalSec: POLL_INTERVAL_MS / 1000,
    backend: ORCHESTRATOR_BACKEND,
    supabaseUrl: opts.supabaseUrl,
    supabaseKey: `${opts.supabaseKey.slice(0, 20)}...`,
    workspaceRoot: opts.workspaceRoot,
  });

  const store = new SupabaseTicketStore(opts.supabaseUrl, opts.supabaseKey);
  const manager = new WorktreeManager(opts.workspaceRoot);

  // Run immediately, then poll
  void processNextTicket(store, manager);

  const interval = setInterval(() => {
    void processNextTicket(store, manager);
  }, POLL_INTERVAL_MS);

  return {
    stop: () => {
      console.log(`${LOG_PREFIX} Stopping poll loop`);
      clearInterval(interval);
    },
  };
}
