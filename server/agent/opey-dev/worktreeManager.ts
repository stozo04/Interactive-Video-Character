// ./server/agent/opey-dev/worktreeManager.ts
// Isolation (The Sandbox)

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "../../runtimeLogger";

export class WorktreeManager {
  private baseDir: string;
  constructor(private root: string) {
    this.baseDir = path.join(root, ".worktrees");
    if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir);
  }

  create(ticketId: string) {
    const workPath = path.join(this.baseDir, ticketId);
    const branch = `opey-dev/${ticketId}`;

    log.info("Creating worktree", {
      source: "worktreeManager.ts",
      ticketId,
      workPath,
      branch,
    });

    // Clean up stale worktree/branch from a previous run of this ticket
    this.pruneStale(ticketId, workPath, branch);

    try {
      execSync(`git worktree add -b ${branch} ${workPath} main`, { cwd: this.root });
      return { workPath, branch };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error("Failed to create worktree", {
        source: "worktreeManager.ts",
        ticketId,
        error: message,
      });
      throw err;
    }
  }

  /** Remove leftover worktree dir and branch so create() can start fresh. */
  private pruneStale(ticketId: string, workPath: string, branch: string) {
    try {
      execSync(`git worktree remove --force ${workPath}`, { cwd: this.root, stdio: "ignore" });
      log.info("Removed stale worktree", { source: "worktreeManager.ts", ticketId });
    } catch {
      // No worktree to remove — that's fine
    }

    try {
      execSync(`git branch -D ${branch}`, { cwd: this.root, stdio: "ignore" });
      log.info("Deleted stale branch", { source: "worktreeManager.ts", ticketId, branch });
    } catch {
      // No branch to delete — that's fine
    }
  }

  cleanup(ticketId: string) {
    try {
      const workPath = path.join(this.baseDir, ticketId);
      log.warning("Cleaning up worktree", {
        source: "worktreeManager.ts",
        ticketId,
        workPath,
      });
      execSync(`git worktree remove --force ${workPath}`, { cwd: this.root });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error("Failed to cleanup worktree", {
        source: "worktreeManager.ts",
        ticketId,
        error: message,
      });
      throw err;
    }
  }
}
