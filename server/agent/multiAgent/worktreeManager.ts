import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveCurrentBranch } from "../gitOps";
import { log } from "./runtimeLogger";

// Info returned after creating a worktree.
export interface WorktreeInfo {
  path: string;
  branch: string;
}

interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const LOG_PREFIX = "[WorktreeManager]";
const DEFAULT_TIMEOUT_MS = 25_000;
const runtimeLog = log.fromContext({ source: "worktreeManager" });

// WorktreeManager creates isolated git worktrees per ticket.
export class WorktreeManager {
  public constructor(private readonly workspaceRoot: string) {}

  // Create a new worktree for a ticket.
  public async createWorktree(ticketId: string): Promise<WorktreeInfo> {
    const baseBranch = await resolveCurrentBranch(this.workspaceRoot);
    if (!baseBranch || baseBranch === "HEAD") {
      throw new Error(`${LOG_PREFIX} Cannot create worktree: not on a branch.`);
    }

    const worktreeRoot = path.resolve(this.workspaceRoot, ".worktrees");
    const worktreePath = path.resolve(worktreeRoot, ticketId);
    const branchName = `ticket/${ticketId}`;

    // Ensure .worktrees directory exists.
    await fs.mkdir(worktreeRoot, { recursive: true });

    if (await pathExists(worktreePath)) {
      throw new Error(`${LOG_PREFIX} Worktree path already exists: ${worktreePath}`);
    }

    runtimeLog.info(`${LOG_PREFIX} createWorktree`, {
      ticketId,
      baseBranch,
      branchName,
      worktreePath,
    });

    const result = await runGitCommand(this.workspaceRoot, [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      baseBranch,
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        `${LOG_PREFIX} git worktree add failed: ${result.stderr || result.stdout}`,
      );
    }

    return {
      path: worktreePath,
      branch: branchName,
    };
  }

  // Remove a worktree for a ticket (force delete).
  public async cleanupWorktree(ticketId: string): Promise<void> {
    const worktreePath = path.resolve(this.workspaceRoot, ".worktrees", ticketId);
    runtimeLog.info(`${LOG_PREFIX} cleanupWorktree`, { ticketId, worktreePath });

    const result = await runGitCommand(this.workspaceRoot, [
      "worktree",
      "remove",
      "--force",
      worktreePath,
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        `${LOG_PREFIX} git worktree remove failed: ${result.stderr || result.stdout}`,
      );
    }
  }
}

// Small helper to check if a path exists.
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

// Execute a git command with timeout and capture stdout/stderr.
async function runGitCommand(
  workspaceRoot: string,
  args: string[],
): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd: workspaceRoot,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: typeof exitCode === "number" ? exitCode : 1,
        stdout,
        stderr,
      });
    });
  });
}
