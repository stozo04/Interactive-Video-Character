// ./server/agent/opey-dev/branchManager.ts
// Isolation (The Sandbox) — one branch per ticket, runs in the repo root

import { execSync } from "node:child_process";
import { log } from "../../runtimeLogger";

const SHELL_OPTS = process.platform === "win32" ? { shell: "bash" as const } : {};

export class BranchManager {
  constructor(private root: string) {}

  create(ticketId: string) {
    const branch = `opey-dev/${ticketId}`;

    log.info("Creating branch", {
      source: "branchManager.ts",
      ticketId,
      branch,
    });

    // Land on main and remove any stale branch from a previous run of this ticket
    this.pruneStale(ticketId, branch);

    try {
      execSync(`git checkout -b ${branch}`, { cwd: this.root, ...SHELL_OPTS });
      return { workPath: this.root, branch };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error("Failed to create branch", {
        source: "branchManager.ts",
        ticketId,
        error: message,
      });
      throw err;
    }
  }

  /** Return to main and delete the stale branch if it exists. */
  private pruneStale(ticketId: string, branch: string) {
    try {
      execSync("git checkout main", { cwd: this.root, stdio: "ignore", ...SHELL_OPTS });
    } catch {
      // Already on main, or nothing to worry about
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
    log.info("Cleaning up branch", {
      source: "branchManager.ts",
      ticketId,
      branch,
    });

    try {
      // --force discards any uncommitted changes the agent may have left behind
      execSync("git checkout --force main", { cwd: this.root, ...SHELL_OPTS });
      execSync(`git branch -D ${branch}`, { cwd: this.root, ...SHELL_OPTS });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error("Failed to cleanup branch", {
        source: "branchManager.ts",
        ticketId,
        error: message,
      });
      throw err;
    }
  }
}
