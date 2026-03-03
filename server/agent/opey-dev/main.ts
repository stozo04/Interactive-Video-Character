// ./server/agent/opey-dev/main.ts
// Entry point (The Boss) — polls for new tickets every 30s

import { execSync } from "node:child_process";
import { SupabaseTicketStore } from "./ticketStore";
import { BranchManager } from "./branchManager";
import { runOpeyLoop } from "./orchestrator";
import { runOpeyLoop as runOpeyLoopOpenAI } from "./orchestrator-openai";
import { log } from "../../runtimeLogger";
import { createPullRequest } from "./githubOps";

const LOG_PREFIX = "[Opey-Dev]";
const POLL_INTERVAL_MS = 30_000;
const SHELL_OPTS = process.platform === "win32" ? { shell: "bash" as const } : {};
const CLARIFICATION_MARKER = "--- CLARIFICATION ---";
const NO_QUESTION_MARKERS = [
  /no clarifications?/i,
  /no questions?/i,
  /do not ask questions/i,
  /you can not ask questions/i,
];

/** Check if the branch has any commits ahead of main. */
function hasCommitsAheadOfMain(workPath: string): boolean {
  try {
    const result = execSync("git log main..HEAD --oneline", { cwd: workPath, ...SHELL_OPTS }).toString().trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

/** Check if the branch has uncommitted changes (staged or unstaged). */
function hasUncommittedChanges(workPath: string): boolean {
  try {
    const result = execSync("git status --porcelain", { cwd: workPath, ...SHELL_OPTS }).toString().trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

/** Commit any uncommitted changes Codex left behind. */
function commitUnstagedWork(workPath: string, ticketTitle: string): void {
  execSync("git add -A", { cwd: workPath, ...SHELL_OPTS });
  const msg = `feat: ${ticketTitle}`;
  execSync(`git commit -m "${msg}"`, { cwd: workPath, ...SHELL_OPTS });
}

function getTicketType(ticket: any): string {
  const type =
    ticket?.request_type ??
    ticket?.requestType ??
    ticket?.type ??
    "";
  return String(type).toLowerCase();
}

function getTicketDetails(ticket: any): string {
  const details =
    ticket?.additional_details ??
    ticket?.additionalDetails ??
    ticket?.details ??
    ticket?.description ??
    "";
  return typeof details === "string" ? details : "";
}

function shouldAvoidClarification(ticket: any): boolean {
  const type = getTicketType(ticket);
  const details = getTicketDetails(ticket);
  return type === "skill" || NO_QUESTION_MARKERS.some((pattern) => pattern.test(details));
}


// Choose orchestrator: "claude" or "openai" (default: "claude")
const ORCHESTRATOR_BACKEND = process.env.OPEY_BACKEND ?? "claude";

let isProcessing = false;

async function processNextTicket(
  store: SupabaseTicketStore,
  manager: BranchManager,
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

    const { workPath, branch } = manager.create(ticketId);
    await store.updateStatus(ticketId, "implementing", { branch });

    // Callback passed into the orchestrator so it can write events to the DB
    // without knowing anything about Supabase itself.
    const emitEvent = (eventType: string, summary: string, payload?: Record<string, unknown>) =>
      store.addEvent(ticketId!, eventType, summary, payload ?? {});

    log.info(`${LOG_PREFIX} Starting Opey loop (${ORCHESTRATOR_BACKEND})`, { source: "main.ts", ticketId, workPath });
    // const orchestrator = ORCHESTRATOR_BACKEND === "openai" ? runOpeyLoopOpenAI : runOpeyLoop;
    const orchestrator = runOpeyLoopOpenAI;
    const output = await orchestrator(ticket, workPath, log, emitEvent);
    const avoidClarification = shouldAvoidClarification(ticket);

    // Did Opey actually implement anything?
    let madeChanges = hasCommitsAheadOfMain(workPath);

    // Codex sometimes edits files but forgets to commit — commit on its behalf
    if (!madeChanges && hasUncommittedChanges(workPath)) {
      log.info(`${LOG_PREFIX} Codex left uncommitted changes — committing on its behalf`, { source: "main.ts", ticketId });
      try {
        commitUnstagedWork(workPath, ticket.title ?? "Opey implementation");
        madeChanges = true;
      } catch (commitErr) {
        log.error(`${LOG_PREFIX} Auto-commit failed`, { source: "main.ts", ticketId, error: String(commitErr) });
      }
    }

    if (!madeChanges) {
      // No commits AND no uncommitted changes — Opey truly didn't implement.
      const details = getTicketDetails(ticket);
      const alreadyClarified = details.includes(CLARIFICATION_MARKER);

      if (!avoidClarification && !alreadyClarified) {
        // First pass with no changes = clarification request (max 1 loop)
        log.info(`${LOG_PREFIX} Opey requested clarification (no commits, first pass)`, { source: "main.ts", ticketId });
        await store.updateStatus(ticketId, "needs_clarification", { clarificationQuestions: output });
        manager.cleanup(ticketId);
        return;
      }

      // No clarification path — mark failed or completed with explicit reason
      const failureReason = avoidClarification
        ? "No changes made (no-questions mode)."
        : "No changes made after clarification.";
      await store.updateStatus(ticketId, "failed", { failureReason });
      log.warning(`${LOG_PREFIX} Completed with no changes`, { source: "main.ts", ticketId, failureReason });
      manager.cleanup(ticketId);
      return;
    }

    // Opey made changes — create PR
    log.info(`${LOG_PREFIX} Creating pull request`, { source: "main.ts", ticketId });
    const prUrl = await createPullRequest(workPath, ticket);

    if (prUrl) {
      await store.updateStatus(ticketId, "completed", { prUrl });
      log.info(`${LOG_PREFIX} Mission accomplished! PR: ${prUrl} — staying on branch for testing`, { source: "main.ts", ticketId, branch });
    } else {
      // Has commits but PR creation failed
      await store.updateStatus(ticketId, "failed", { failureReason: "Commits exist but PR creation failed" });
      log.error(`${LOG_PREFIX} PR creation failed despite commits — branch preserved for inspection`, { source: "main.ts", ticketId, branch });
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
  const manager = new BranchManager(opts.workspaceRoot);

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
