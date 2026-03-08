// ./server/agent/opey-dev/branchManager.ts
// Isolation (The Sandbox) — one git worktree per ticket, fully isolated from the main working tree

import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { log } from "../../runtimeLogger";

const SHELL_OPTS = process.platform === "win32" ? { shell: "bash" as const } : {};

export class BranchManager {
  constructor(private root: string) {
    this.verifyGitWorktreeSupport();
  }

  /**
   * Verify that `git worktree` is available (requires git 2.5+).
   * Throws at startup rather than failing silently mid-ticket.
   */
  private verifyGitWorktreeSupport(): void {
    try {
      execSync("git worktree list", { cwd: this.root, stdio: "ignore", ...SHELL_OPTS });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("git worktree is not supported — requires git 2.5+. Opey cannot isolate tickets.", {
        source: "branchManager.ts",
        error: message,
      });
      throw new Error(`git worktree not available (requires git 2.5+): ${message}`);
    }
  }

  /**
   * Called once at startup to remove any worktrees left behind by a previous
   * server crash mid-run. pruneStale() only covers same-ticket reruns; this
   * covers ALL leftover worktrees regardless of which ticket they belonged to.
   */
  pruneAllStaleWorktrees(): void {
    const worktreesDir = path.join(this.root, ".worktrees");
    if (!fs.existsSync(worktreesDir)) return;

    let dirs: string[];
    try {
      dirs = fs.readdirSync(worktreesDir);
    } catch {
      return;
    }

    for (const dir of dirs) {
      const worktreePath = path.join(worktreesDir, dir);
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd: this.root, stdio: "ignore", ...SHELL_OPTS });
        log.info("Pruned stale worktree at startup", { source: "branchManager.ts", worktreePath });
      } catch {
        // Already gone or unregistered — let git worktree prune clean it up
      }
    }

    // Also prune any git-registered worktrees whose directories are already missing
    try {
      execSync("git worktree prune", { cwd: this.root, stdio: "ignore", ...SHELL_OPTS });
    } catch {
      // Best effort
    }
  }

  create(ticketId: string) {
    const branch = `opey-dev/${ticketId}`;
    const worktreePath = path.join(this.root, ".worktrees", ticketId);

    log.info("Creating worktree", {
      source: "branchManager.ts",
      ticketId,
      branch,
      worktreePath,
    });

    // Remove any stale worktree from a previous run of this ticket
    this.pruneStale(ticketId, branch, worktreePath);

    try {
      fs.mkdirSync(path.join(this.root, ".worktrees"), { recursive: true });
      execSync(`git worktree add "${worktreePath}" -b ${branch}`, { cwd: this.root, ...SHELL_OPTS });
      return { workPath: worktreePath, branch };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error("Failed to create worktree", {
        source: "branchManager.ts",
        ticketId,
        error: message,
      });
      throw err;
    }
  }

  /** Remove the stale worktree and branch from a previous run of this ticket, if they exist. */
  private pruneStale(ticketId: string, branch: string, worktreePath: string) {
    try {
      execSync(`git worktree remove --force "${worktreePath}"`, { cwd: this.root, stdio: "ignore", ...SHELL_OPTS });
      log.info("Removed stale worktree", { source: "branchManager.ts", ticketId, worktreePath });
    } catch {
      // No stale worktree — that's fine
    }

    try {
      execSync(`git branch -D ${branch}`, { cwd: this.root, stdio: "ignore", ...SHELL_OPTS });
      log.info("Deleted stale branch", { source: "branchManager.ts", ticketId, branch });
    } catch {
      // No stale branch — that's fine
    }
  }

  cleanup(ticketId: string) {
    const branch = `opey-dev/${ticketId}`;
    const worktreePath = path.join(this.root, ".worktrees", ticketId);

    log.info("Cleaning up worktree", {
      source: "branchManager.ts",
      ticketId,
      branch,
    });

    try {
      execSync(`git worktree remove --force "${worktreePath}"`, { cwd: this.root, ...SHELL_OPTS });
      execSync(`git branch -D ${branch}`, { cwd: this.root, ...SHELL_OPTS });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error("Failed to cleanup worktree", {
        source: "branchManager.ts",
        ticketId,
        error: message,
      });
      throw err;
    }
  }
}
