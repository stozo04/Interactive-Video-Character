// ./server/agent/opey-dev/main.ts
// Entry point (The Boss) — polls for new tickets every 30s

import { execSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SupabaseTicketStore } from "./ticketStore";
import { BranchManager } from "./branchManager";
import { runOpeyLoop } from "./orchestrator";
import { runOpeyLoop as runOpeyLoopOpenAI } from "./orchestrator-openai";
import { log } from "../../runtimeLogger";
import { createPullRequest } from "./githubOps";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_PREFIX = "[Opey-Dev]";
const POLL_INTERVAL_MS = 30_000;
const SHELL_OPTS = process.platform === "win32" ? { shell: "bash" as const } : {};
const CLARIFICATION_MARKER = "--- CLARIFICATION ---";
// Must match CODEX_MODEL in orchestrator-openai.ts
const SELF_HEAL_CODEX_MODEL = "gpt-5.2-codex";
const MAX_SELF_HEAL_ATTEMPTS = 3;
const MAX_CLARIFICATION_ROUNDS = 3;

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
  const details = getTicketDetails(ticket);
  // Count how many times clarification has already happened on this ticket
  const rounds = (details.match(new RegExp(CLARIFICATION_MARKER, "g")) ?? []).length;
  return rounds >= MAX_CLARIFICATION_ROUNDS;
}


// Choose orchestrator: "claude" or "openai" (default: "claude")
const ORCHESTRATOR_BACKEND = process.env.OPEY_BACKEND ?? "claude";

// ---------------------------------------------------------------------------
// Self-healing: when an infrastructure error prevents Codex from launching,
// Opey spawns a meta-Codex run to patch the orchestrator, then restarts itself.
// Attempt count is tracked in a temp file (survives the restart, ticket-scoped).
// ---------------------------------------------------------------------------

async function attemptSelfHeal(
  err: Error,
  store: SupabaseTicketStore,
  ticketId: string,
): Promise<boolean> {
  // Count how many self-heal attempts we've already made for this ticket.
  const countFile = path.join(os.tmpdir(), `opey-heal-count-${ticketId}.txt`);
  const attempt = fs.existsSync(countFile)
    ? parseInt(fs.readFileSync(countFile, "utf-8"), 10) + 1
    : 1;

  if (attempt > MAX_SELF_HEAL_ATTEMPTS) {
    log.warning(`${LOG_PREFIX} Self-heal limit reached (${MAX_SELF_HEAL_ATTEMPTS}) — giving up`, {
      source: "main.ts", ticketId,
    });
    try { fs.unlinkSync(countFile); } catch { /* ignore */ }
    return false;
  }

  log.info(`${LOG_PREFIX} Infrastructure error detected — self-heal attempt ${attempt}/${MAX_SELF_HEAL_ATTEMPTS}`, {
    source: "main.ts", ticketId, error: err.message,
  });

  // Persist attempt count so the restarted process knows where we left off.
  fs.writeFileSync(countFile, String(attempt), "utf-8");

  // Record in ticket event log.
  await store.addEvent(
    ticketId,
    "self_heal_attempted",
    `Infrastructure error — self-repair attempt ${attempt}/${MAX_SELF_HEAL_ATTEMPTS}`,
    { error: err.message, attempt },
  );

  // Include both orchestrators in the meta-prompt — Codex fixes whichever caused the error.
  const orchestratorFiles = [
    "orchestrator.ts", "orchestrator.js",
    "orchestrator-openai.ts", "orchestrator-openai.js",
  ]
    .map((f) => path.join(__dirname, f))
    .filter((p) => fs.existsSync(p));

  const orchestratorSource = orchestratorFiles
    .map((p) => `### ${path.basename(p)}\n\`\`\`typescript\n${fs.readFileSync(p, "utf-8")}\n\`\`\``)
    .join("\n\n") || "(files not found)";

  // Write a full meta-prompt to a temp file (avoids Windows CLI length limits
  // — the same problem we're self-healing is handled here from the start).
  const metaPromptFile = path.join(os.tmpdir(), `opey-self-heal-${ticketId}.md`);
  fs.writeFileSync(metaPromptFile, [
    "# Opey Self-Heal Task",
    "",
    "The Opey orchestrator crashed with this error:",
    "",
    "```",
    err.message,
    "```",
    "",
    "## Orchestrator files (one or both may be the source of the bug)",
    "",
    `Directory: ${__dirname}`,
    "",
    orchestratorSource,
    "",
    "Fix the bug that caused the error above. Edit the relevant file(s) at their absolute paths.",
    "Do not ask questions. Do not create new files. One focused fix only.",
    "Delete this instructions file when done.",
  ].join("\n"), "utf-8");

  const bootArg = `Self-heal task. Read instructions from: ${metaPromptFile}`;

  // Spawn meta-Codex (same Windows vs Unix logic as orchestrator-openai.ts).
  let healChild: ChildProcess | null = null;
  let metaPromptCleaned = false;
  try {
    let spawnCmd: string;
    let spawnArgs: string[];
    if (process.platform === "win32") {
      const npmRoot = execSync("npm root -g").toString().trim();
      const codexScript = path.join(npmRoot, "@openai", "codex", "bin", "codex.js");
      spawnCmd = "node";
      spawnArgs = [codexScript, "exec", "-m", SELF_HEAL_CODEX_MODEL,
        "--dangerously-bypass-approvals-and-sandbox", "--ephemeral", "--color", "never", bootArg];
    } else {
      spawnCmd = "codex";
      spawnArgs = ["exec", "-m", SELF_HEAL_CODEX_MODEL,
        "--dangerously-bypass-approvals-and-sandbox", "--ephemeral", "--color", "never", bootArg];
    }

    const repoRoot = path.join(__dirname, "..", "..", "..");
    healChild = spawn(spawnCmd, spawnArgs, { stdio: "pipe", cwd: repoRoot });

    healChild.stdout?.on("data", (chunk: Buffer) => {
      log.info(`${LOG_PREFIX} [Self-Heal] ${chunk.toString().trim()}`, { source: "main.ts", ticketId });
    });
    healChild.stderr?.on("data", (chunk: Buffer) => {
      log.info(`${LOG_PREFIX} [Self-Heal] ${chunk.toString().trim()}`, { source: "main.ts", ticketId });
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      healChild!.on("close", resolve);
      healChild!.on("error", reject);
    });

    try { fs.unlinkSync(metaPromptFile); metaPromptCleaned = true; } catch { /* ignore */ }

    if (exitCode !== 0) {
      log.error(`${LOG_PREFIX} Self-heal Codex exited with code ${exitCode}`, {
        source: "main.ts", ticketId, exitCode,
      });
      return false;
    }
  } finally {
    if (healChild && !healChild.killed) healChild.kill();
    if (!metaPromptCleaned) {
      try { fs.unlinkSync(metaPromptFile); } catch { /* ignore */ }
    }
  }

  // Self-heal succeeded — reset ticket to 'created' so the restarted process
  // picks it up, then restart.
  log.info(`${LOG_PREFIX} Self-heal succeeded — resetting ticket and restarting process`, {
    source: "main.ts", ticketId, attempt,
  });
  await store.addEvent(
    ticketId,
    "self_heal_succeeded",
    `Orchestrator patched — restarting and retrying ticket (attempt ${attempt}/${MAX_SELF_HEAL_ATTEMPTS})`,
    { attempt },
  );
  await store.updateStatus(ticketId, "created").catch(() => {});

  // Restart Opey (same pattern used by WhatsApp bridge restart).
  const restartChild = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  restartChild.unref();
  setTimeout(() => process.exit(0), 300);
  return true;
}

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
    const orchestrator = ORCHESTRATOR_BACKEND === "openai" ? runOpeyLoopOpenAI : runOpeyLoop;
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
      if (!avoidClarification) {
        // No changes = ask for clarification (up to MAX_CLARIFICATION_ROUNDS times)
        log.info(`${LOG_PREFIX} Opey requested clarification`, { source: "main.ts", ticketId });
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

    // Distinguish task failures (Claude/Codex ran but produced no useful output) from
    // infrastructure failures (spawn/OS error, the CLI never launched).
    // Only self-heal on infra failures — task failures go straight to 'failed'.
    const isTaskFailure =
      message.startsWith("Claude Code exited with code") ||
      message.startsWith("Codex CLI exited with code");

    if (!isTaskFailure && ticketId) {
      const healed = await attemptSelfHeal(
        err instanceof Error ? err : new Error(message),
        store,
        ticketId,
      );
      if (healed) return; // process is restarting — don't mark ticket failed
    }

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
