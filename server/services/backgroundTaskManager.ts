// server/services/backgroundTaskManager.ts
//
// Manages background child processes that Kayley can start, monitor, and cancel.
// Tasks persist stdout/stderr output and are tracked by UUID.

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { log } from "../runtimeLogger";
import { APPROVAL_PATTERNS, BLOCKED_COMMANDS, GREP_EXCLUDE_OPTIONS } from "./commandSafety";

const runtimeLog = log.fromContext({ source: "backgroundTaskManager" });

// ============================================================================
// Types
// ============================================================================

export type BackgroundTaskStatus = "running" | "completed" | "failed" | "cancelled";

export interface BackgroundTask {
  id: string;
  label: string;
  command: string;
  cwd: string;
  status: BackgroundTaskStatus;
  exitCode: number | null;
  output: string[];       // ring buffer of recent lines
  startedAt: number;
  finishedAt: number | null;
  pid: number | null;
}

/** Notification queued when a background task finishes, drained on next turn. */
export interface TaskCompletionNotification {
  taskId: string;
  label: string;
  status: BackgroundTaskStatus;
  exitCode: number | null;
  durationMs: number;
  tailOutput: string[];
}

interface InternalTask extends BackgroundTask {
  process: ChildProcess | null;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_OUTPUT_LINES = 200;
const TASK_TTL_MS = 60 * 60 * 1000; // 1 hour after completion
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 min
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — kill if exceeded
const NOTIFICATION_TAIL_LINES = 10;

// ============================================================================
// Task Store + Notification Queue
// ============================================================================

const tasks = new Map<string, InternalTask>();

/** Pending exit notifications — drained by agentRoutes on next turn. */
const pendingNotifications: TaskCompletionNotification[] = [];

// Periodic cleanup of old completed tasks
setInterval(() => {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (task.status !== "running" && task.finishedAt && now - task.finishedAt > TASK_TTL_MS) {
      tasks.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS);

// ============================================================================
// Public API
// ============================================================================

export function startBackgroundTask(opts: {
  command: string;
  label: string;
  cwd?: string;
  workspaceRoot: string;
  timeoutMs?: number;
  /** Whether the user has approved a dangerous command pattern. */
  approved?: boolean;
  /** Pre-existing child process (for auto-background promotion from workspace agent) */
  existingChild?: import("node:child_process").ChildProcess;
  /** Pre-existing output lines captured before promotion */
  existingOutput?: string[];
}): BackgroundTask {
  const { command, label, workspaceRoot } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Security: check base command (skip if existingChild — already validated by caller)
  if (!opts.existingChild) {
    const baseCmd = command.split(/\s+/)[0].replace(/^.*[/\\]/, "");
    if (BLOCKED_COMMANDS.has(baseCmd.toLowerCase())) {
      throw new Error(`Command "${baseCmd}" is blocked for safety.`);
    }

    // Approval gate: same patterns as workspace_action command
    const approvalMatch = APPROVAL_PATTERNS.find((p) => p.pattern.test(command));
    if (approvalMatch && !opts.approved) {
      throw new Error(
        `APPROVAL_REQUIRED: This command requires Steven's approval before execution.\n` +
        `Command: ${command}\n` +
        `Reason: ${approvalMatch.reason}\n` +
        `Ask Steven if he wants you to proceed. If he approves, re-call start_background_task ` +
        `with the same command and set approved=true.`
      );
    }
  }

  // Resolve cwd
  let cwd = workspaceRoot;
  if (opts.cwd) {
    const resolved = path.resolve(workspaceRoot, opts.cwd);
    if (!resolved.startsWith(workspaceRoot)) {
      throw new Error("Working directory escapes workspace root.");
    }
    cwd = resolved;
  }

  const id = crypto.randomUUID();

  const child = opts.existingChild ?? spawn(command, [], {
    cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: "0", GREP_OPTIONS: GREP_EXCLUDE_OPTIONS },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const task: InternalTask = {
    id,
    label,
    command,
    cwd,
    status: "running",
    exitCode: null,
    output: opts.existingOutput ? [...opts.existingOutput] : [],
    startedAt: Date.now(),
    finishedAt: null,
    pid: child.pid ?? null,
    process: child,
  };

  tasks.set(id, task);

  const appendLine = (line: string) => {
    task.output.push(line);
    if (task.output.length > MAX_OUTPUT_LINES) {
      task.output.shift();
    }
  };

  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) appendLine(line);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) appendLine(`[stderr] ${line}`);
  });

  // Timeout: kill if exceeds limit
  const killTimer = setTimeout(() => {
    if (task.status !== "running" || !task.process) return;
    try {
      task.process.kill("SIGTERM");
    } catch {
      // Process may have already exited
    }
    task.status = "failed";
    task.finishedAt = Date.now();
    task.process = null;
    appendLine(`[timeout] Task killed after ${Math.round(timeoutMs / 1000)}s timeout.`);

    enqueueNotification(task);

    runtimeLog.warning("Background task timed out", {
      taskId: id,
      label,
      timeoutMs,
      durationMs: task.finishedAt - task.startedAt,
    });
  }, timeoutMs);

  child.on("close", (code) => {
    clearTimeout(killTimer);
    task.exitCode = code;
    task.status = code === 0 ? "completed" : "failed";
    task.finishedAt = Date.now();
    task.process = null;

    enqueueNotification(task);

    runtimeLog.info("Background task finished", {
      taskId: id,
      label,
      status: task.status,
      exitCode: code,
      durationMs: task.finishedAt - task.startedAt,
    });
  });

  child.on("error", (err) => {
    clearTimeout(killTimer);
    task.status = "failed";
    task.finishedAt = Date.now();
    task.process = null;
    appendLine(`[error] ${err.message}`);

    enqueueNotification(task);

    runtimeLog.error("Background task error", {
      taskId: id,
      label,
      error: err.message,
    });
  });

  runtimeLog.info("Background task started", {
    taskId: id,
    label,
    command,
    pid: child.pid,
    timeoutMs,
    promoted: !!opts.existingChild,
  });

  return toPublic(task);
}

export function checkTaskStatus(taskId: string): BackgroundTask | null {
  const task = tasks.get(taskId);
  if (!task) return null;
  return toPublic(task);
}

export function cancelTask(taskId: string): boolean {
  const task = tasks.get(taskId);
  if (!task) return false;
  if (task.status !== "running" || !task.process) return false;

  try {
    task.process.kill("SIGTERM");
  } catch {
    // Process may have already exited
  }
  task.status = "cancelled";
  task.finishedAt = Date.now();
  task.process = null;

  runtimeLog.info("Background task cancelled", { taskId });
  return true;
}

export function listActiveTasks(): BackgroundTask[] {
  return Array.from(tasks.values())
    .filter((t) => t.status === "running")
    .map(toPublic);
}

/**
 * Drain all pending task completion notifications.
 * Called by agentRoutes on each new turn to inject into the conversation context.
 */
export function drainTaskNotifications(): TaskCompletionNotification[] {
  if (pendingNotifications.length === 0) return [];
  return pendingNotifications.splice(0, pendingNotifications.length);
}

// ============================================================================
// Helpers
// ============================================================================

function toPublic(task: InternalTask): BackgroundTask {
  const { process: _proc, ...pub } = task;
  return pub;
}

function enqueueNotification(task: InternalTask): void {
  pendingNotifications.push({
    taskId: task.id,
    label: task.label,
    status: task.status,
    exitCode: task.exitCode,
    durationMs: (task.finishedAt ?? Date.now()) - task.startedAt,
    tailOutput: task.output.slice(-NOTIFICATION_TAIL_LINES),
  });
}
