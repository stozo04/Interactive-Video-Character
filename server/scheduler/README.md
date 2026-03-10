# Cron Job System

## Architecture

There are **two separate pollers** that both read the `cron_jobs` Supabase table. They own different job types and must never overlap.

```
┌─────────────────────────────────────────────────────────────┐
│                      cron_jobs (Supabase)                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          │                                 │
          ▼                                 ▼
 ┌─────────────────────┐          ┌──────────────────────┐
 │   Main Server       │          │   Tidy Agent         │
 │   cronScheduler.ts  │          │   agents/tidy/       │
 │   (port 4010)       │          │   (port 4014)        │
 │                     │          │                      │
 │ Handles:            │          │ Handles:             │
 │  • web_search       │          │  • code_cleaner      │
 │  • maintenance_     │          │  • tidy_branch_      │
 │    reminder         │          │    cleanup           │
 │  • monthly_memory_  │          │                      │
 │    rollover         │          │ npm run tidy:dev     │
 │  • promise_mirror   │          └──────────────────────┘
 └─────────────────────┘
```

### Rule: Which poller owns which job?

| Job needs... | → Lives in |
|---|---|
| Gemini, Supabase, conversation pipeline | Main server (`cronScheduler.ts`) |
| Heavy/independent tooling (git, PRs, linters) | Standalone agent process |

Adding a new job type to the wrong poller will result in an `Unknown action_type` error at runtime.

### Main server handler inventory

| `action_type` | What it does |
|---|---|
| `web_search` | Fetches news/info via Tavily, summarizes with Gemini, delivers to Kayley |
| `maintenance_reminder` | Kayley-to-Steven reminder messages |
| `monthly_memory_rollover` | Rolls over memory summaries in Supabase |
| `promise_mirror` | Reflects back promises Kayley made to Steven |
| `persona_evolution` | Reviews last 24h of conversation, proposes behavioral note updates |
| `log_cleanup` | Deletes `server_runtime_logs` + `engineering_ticket_events` rows older than 7 days |

> **Keep this table in sync with `JOB_HANDLERS` in `cronScheduler.ts`.** If you add or rename a handler, update this table. A mismatch between the handler key here and the `action_type` value in the DB is the #1 cause of `Unknown action_type` failures.

---

## Adding a New Job Type

### To the main server scheduler

1. Add a handler to `JOB_HANDLERS` in `cronScheduler.ts`:
   ```ts
   const JOB_HANDLERS: Record<string, JobHandler> = {
     "your_new_type": async (job, client, schedulerId) => {
       // ... do work ...
       return { summary: "Done.", metadata: {} };
     },
   };
   ```
2. Insert a row into `cron_jobs` with `action_type = 'your_new_type'`.
3. Done — the scheduler picks it up on the next tick.

### As a new standalone agent

1. Create `agents/your-agent/index.ts` with its own poll loop (use `agents/tidy/index.ts` as the template).
2. Add your job type(s) to `EXTERNALLY_HANDLED_JOB_TYPES` in `cronScheduler.ts`:
   ```ts
   export const EXTERNALLY_HANDLED_JOB_TYPES = [
     "code_cleaner",
     "tidy_branch_cleanup",
     "your_new_type",   // ← add here
   ] as const;
   ```
   This tells the main scheduler to **never claim** these jobs, even if they appear in the table.
3. Insert a row into `cron_jobs` with `action_type = 'your_new_type'`.

**IMPORTANT:** Steps 1 and 2 must happen together. If you add a job type to the DB without adding it to either `JOB_HANDLERS` or `EXTERNALLY_HANDLED_JOB_TYPES`, every tick will throw `Unknown action_type: your_new_type` and mark the run failed.

---

## Removing a Job Type

If you remove a handler from `JOB_HANDLERS` to move it to a standalone agent:

1. Add it to `EXTERNALLY_HANDLED_JOB_TYPES` **in the same commit**.
2. Update `cronScheduler.test.ts` if the filter string assertion needs updating.

This is how the `code_cleaner` bug happened — the handlers were removed but `EXTERNALLY_HANDLED_JOB_TYPES` didn't exist yet, so the main scheduler kept claiming and failing those jobs.

---

## Verifying What Each Tick Polls

Every tick the main scheduler logs a `"Fetched cron jobs successfully"` entry in `server_runtime_logs`. Query it:

```sql
SELECT
  occurred_at,
  details->>'jobCount'     AS job_count,
  details->>'actionTypes'  AS action_types,
  details->>'excludedTypes' AS excluded_types
FROM server_runtime_logs
WHERE source = 'CronScheduler'
  AND message = 'Fetched cron jobs successfully'
ORDER BY occurred_at DESC
LIMIT 20;
```

A healthy row:

```
job_count | action_types | excluded_types
----------+--------------+--------------------------------
0         |              | code_cleaner,tidy_branch_cleanup
1         | web_search   | code_cleaner,tidy_branch_cleanup
```

- `excluded_types` is always present — confirms the filter is active even on empty ticks.
- If `code_cleaner` ever appears in `action_types`, the filter broke.

To check Tidy's runs:

```sql
SELECT occurred_at, message, details->>'jobId' AS job_id, details->>'actionType' AS action_type
FROM server_runtime_logs
WHERE source = 'tidy/index'
ORDER BY occurred_at DESC
LIMIT 20;
```

---

## The `cron_runs` Table

Every execution (success or failure) is recorded in `cron_runs`:

```sql
SELECT scheduled_for, started_at, finished_at, status, error, action_type
FROM cron_runs
WHERE cron_job_id = '<your-job-uuid>'
ORDER BY scheduled_for DESC
LIMIT 10;
```

`last_run_status` and `last_error` on the `cron_jobs` row itself show the most recent outcome at a glance.

---

## Health Endpoints

| Process | Health URL |
|---|---|
| Main server | `GET http://localhost:4010/agent/health` |
| Tidy agent | `GET http://localhost:4014/health` |

The Tidy agent also accepts `POST http://localhost:4014/restart` to reset its poll loop without restarting the process.
