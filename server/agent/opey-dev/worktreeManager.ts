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
    try {
      const workPath = path.join(this.baseDir, ticketId);
      const branch = `opey/${ticketId}`;
      log.info("Creating worktree", {
        source: "worktreeManager.ts",
        ticketId,
        workPath,
        branch,
      });
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
