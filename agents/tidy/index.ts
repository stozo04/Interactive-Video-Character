// agents/tidy/index.ts
// Standalone entry point for Tidy agent process.
// Run with: npm run tidy:dev
//
// Polls `cron_jobs` table for `code_cleaner` and `tidy_branch_cleanup` jobs
// on the same interval as the old cronScheduler handler.

import { createClient } from "@supabase/supabase-js";
import { log } from "../../lib/logger";
import { runCodeCleanerBatch } from "../../server/scheduler/codeCleanerHandler";
import { runTidyBranchCleanup } from "../../server/scheduler/tidyBranchCleanupHandler";

const LOG_PREFIX = "[Tidy]";
const TICK_MS = 60_000;
const TIDY_JOB_TYPES = ["code_cleaner", "tidy_branch_cleanup"] as const;

const runtimeLog = log.fromContext({ source: "tidy/index", route: "tidy/startup" });

runtimeLog.info("Tidy standalone process starting", {
  nodeVersion: process.version,
  pid: process.pid,
  tickMs: TICK_MS,
});

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseKey) {
  runtimeLog.critical("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

type JobHandler = (
  job: { id: string; payload: Record<string, unknown> },
  client: typeof supabase,
) => Promise<{ summary: string; metadata: Record<string, unknown>; skipSuccessMessage?: boolean }>;

const handlers: Record<string, JobHandler> = {
  code_cleaner: runCodeCleanerBatch,
  tidy_branch_cleanup: runTidyBranchCleanup,
};

let isProcessing = false;

async function tick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const now = new Date().toISOString();

    const { data: jobs, error } = await supabase
      .from("cron_jobs")
      .select("*")
      .in("action_type", TIDY_JOB_TYPES)
      .eq("status", "active")
      .lte("next_run_at", now)
      .order("next_run_at", { ascending: true });

    if (error) {
      runtimeLog.error("Failed to query cron_jobs", { error: error.message });
      return;
    }

    if (!jobs || jobs.length === 0) return;

    for (const job of jobs) {
      const handler = handlers[job.action_type];
      if (!handler) continue;

      runtimeLog.info(`Processing job: ${job.action_type}`, {
        source: "tidy/index",
        jobId: job.id,
        actionType: job.action_type,
      });

      // Claim the job by setting status to running
      const { error: claimErr } = await supabase
        .from("cron_jobs")
        .update({ status: "running" })
        .eq("id", job.id)
        .eq("status", "active");

      if (claimErr) {
        runtimeLog.warning("Failed to claim job — another process may have it", {
          source: "tidy/index",
          jobId: job.id,
          error: claimErr.message,
        });
        continue;
      }

      try {
        const result = await handler(
          { id: job.id, payload: job.payload ?? {} },
          supabase,
        );

        runtimeLog.info(`Job completed: ${job.action_type}`, {
          source: "tidy/index",
          jobId: job.id,
          summary: result.summary,
        });

        // Compute next_run_at (simple: add 24h for daily, 7d for weekly)
        const nextRun = new Date();
        if (job.schedule_type === "weekly") {
          nextRun.setDate(nextRun.getDate() + 7);
        } else {
          nextRun.setDate(nextRun.getDate() + 1);
        }
        // Respect schedule_hour/schedule_minute if set
        if (job.schedule_hour != null) nextRun.setHours(job.schedule_hour);
        if (job.schedule_minute != null) nextRun.setMinutes(job.schedule_minute);

        await supabase
          .from("cron_jobs")
          .update({
            status: "active",
            next_run_at: nextRun.toISOString(),
          })
          .eq("id", job.id);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        runtimeLog.error(`Job failed: ${job.action_type}`, {
          source: "tidy/index",
          jobId: job.id,
          error: errMsg,
        });

        // Reset to active so it can be retried next tick
        await supabase
          .from("cron_jobs")
          .update({ status: "active" })
          .eq("id", job.id);
      }
    }
  } catch (err) {
    runtimeLog.error("Unexpected error in Tidy tick", {
      source: "tidy/index",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isProcessing = false;
  }
}

// Start polling
const interval = setInterval(() => void tick(), TICK_MS);
void tick(); // Run immediately on startup

runtimeLog.info("Tidy poll loop started", { tickMs: TICK_MS });

function shutdown(signal: string): void {
  console.log(`${LOG_PREFIX} Shutdown requested`, { signal });
  runtimeLog.warning("Tidy shutdown initiated", { signal });
  clearInterval(interval);
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  runtimeLog.critical("Uncaught exception in Tidy process", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  console.error(`${LOG_PREFIX} Uncaught exception:`, err);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  runtimeLog.critical("Unhandled promise rejection in Tidy process", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  console.error(`${LOG_PREFIX} Unhandled rejection:`, reason);
});
