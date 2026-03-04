// server/scheduler/tidyBranchCleanupHandler.ts
//
// Weekly cron handler that deletes stale tidy-* remote branches older than
// MAX_AGE_DAYS. Prevents GitHub from accumulating orphaned branches from
// Tidy runs where the server crashed before manager.cleanup() could run.

import { execSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../runtimeLogger";
import type { SupabaseClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_PREFIX = "[TidyBranchCleanup]";
const REPO_ROOT = path.resolve(__dirname, "../..");
const MAX_AGE_DAYS = 7;
const SHELL_OPTS = process.platform === "win32" ? { shell: "bash" as const } : {};

function run(cmd: string): string {
  return execSync(cmd, { cwd: REPO_ROOT, ...SHELL_OPTS }).toString().trim();
}

export async function runTidyBranchCleanup(
  _job: { id: string; payload: Record<string, unknown> },
  _client: SupabaseClient
): Promise<{ summary: string; metadata: Record<string, unknown>; skipSuccessMessage: boolean }> {
  log.info(`${LOG_PREFIX} Starting stale branch cleanup`, {
    source: "tidyBranchCleanupHandler.ts",
    maxAgeDays: MAX_AGE_DAYS,
  });

  // 1. Fetch + prune so our local ref list matches remote
  try {
    run("git fetch --prune origin");
    log.info(`${LOG_PREFIX} Fetched and pruned remote refs`, { source: "tidyBranchCleanupHandler.ts" });
  } catch (err) {
    log.warning(`${LOG_PREFIX} git fetch --prune failed — continuing with stale refs`, {
      source: "tidyBranchCleanupHandler.ts",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. List all remote tidy-* branches with their last committer timestamp (unix epoch)
  let output: string;
  try {
    output = run(
      "git for-each-ref --format=%(refname:short) %(committerdate:unix) refs/remotes/origin/tidy-*"
    );
  } catch {
    log.info(`${LOG_PREFIX} No tidy-* remote branches found`, { source: "tidyBranchCleanupHandler.ts" });
    return {
      summary: "No tidy-* remote branches found.",
      metadata: { deleted: [], kept: [] },
      skipSuccessMessage: true,
    };
  }

  if (!output) {
    return {
      summary: "No tidy-* remote branches found.",
      metadata: { deleted: [], kept: [] },
      skipSuccessMessage: true,
    };
  }

  const now = Date.now();
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const deleted: string[] = [];
  const kept: string[] = [];
  const failed: string[] = [];

  for (const line of output.split("\n").filter(Boolean)) {
    // format: "origin/tidy-1234567890 1709500000"
    const [refName, timestampStr] = line.trim().split(" ");
    const branchName = refName.replace(/^origin\//, ""); // "tidy-1234567890"
    const commitTimestamp = parseInt(timestampStr, 10) * 1000;
    const ageMs = now - commitTimestamp;
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (ageMs > maxAgeMs) {
      try {
        run(`git push origin --delete ${branchName}`);
        deleted.push(branchName);
        log.info(`${LOG_PREFIX} Deleted stale branch`, {
          source: "tidyBranchCleanupHandler.ts",
          branch: branchName,
          ageDays,
        });
      } catch (err) {
        failed.push(branchName);
        log.error(`${LOG_PREFIX} Failed to delete branch`, {
          source: "tidyBranchCleanupHandler.ts",
          branch: branchName,
          ageDays,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      kept.push(branchName);
      log.info(`${LOG_PREFIX} Keeping active branch`, {
        source: "tidyBranchCleanupHandler.ts",
        branch: branchName,
        ageDays,
      });
    }
  }

  const parts: string[] = [];
  if (deleted.length > 0) parts.push(`Deleted ${deleted.length} stale branch(es): ${deleted.join(", ")}`);
  if (kept.length > 0) parts.push(`${kept.length} active branch(es) kept`);
  if (failed.length > 0) parts.push(`${failed.length} deletion(s) failed: ${failed.join(", ")}`);

  const summary = parts.length > 0 ? parts.join(" — ") : "Nothing to clean up.";

  log.info(`${LOG_PREFIX} Cleanup complete`, {
    source: "tidyBranchCleanupHandler.ts",
    deleted: deleted.length,
    kept: kept.length,
    failed: failed.length,
  });

  return {
    summary,
    metadata: { deleted, kept, failed, maxAgeDays: MAX_AGE_DAYS },
    skipSuccessMessage: true,
  };
}
