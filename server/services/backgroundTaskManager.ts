// server/services/backgroundTaskManager.ts
//
// Manages background child processes that Kayley can start, monitor, and cancel.
// Tasks persist stdout/stderr output and are tracked by UUID.

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { log } from "../runtimeLogger";

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

interface InternalTask extends BackgroundTask {
  process: ChildProcess | null;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_OUTPUT_LINES = 200;
const TASK_TTL_MS = 60 * 60 * 1000; // 1 hour after completion
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 min

// Same blocked list as workspace agent exec_command
const BLOCKED_COMMANDS = new Set([
  "format", "mkfs", "dd",
  "shutdown", "reboot", "halt", "poweroff",
  "passwd", "useradd", "userdel",
  "env", "printenv",
]);

// ============================================================================
// Task Store
// ============================================================================

const tasks = new Map<string, InternalTask>();

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
}): BackgroundTask {
  const { command, label, workspaceRoot } = opts;

  // Security: check base command
  const baseCmd = command.split(/\s+/)[0].replace(/^.*[/\\]/, "");
  if (BLOCKED_COMMANDS.has(baseCmd.toLowerCase())) {
    throw new Error(`Command "${baseCmd}" is blocked for safety.`);
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

  const child = spawn(command, [], {
    cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const task: InternalTask = {
    id,
    label,
    command,
    cwd,
    status: "running",
    exitCode: null,
    output: [],
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

  child.on("close", (code) => {
    task.exitCode = code;
    task.status = code === 0 ? "completed" : "failed";
    task.finishedAt = Date.now();
    task.process = null;

    runtimeLog.info("Background task finished", {
      taskId: id,
      label,
      status: task.status,
      exitCode: code,
      durationMs: task.finishedAt - task.startedAt,
    });
  });

  child.on("error", (err) => {
    task.status = "failed";
    task.finishedAt = Date.now();
    task.process = null;
    appendLine(`[error] ${err.message}`);

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

  task.process.kill("SIGTERM");
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

// ============================================================================
// Helpers
// ============================================================================

function toPublic(task: InternalTask): BackgroundTask {
  const { process: _proc, ...pub } = task;
  return pub;
}
