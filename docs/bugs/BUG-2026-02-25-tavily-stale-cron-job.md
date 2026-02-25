# BUG-2026-02-25: Stale Tavily Cron Job Fails on Every Server Startup

**Date:** 2026-02-25
**Severity:** Medium
**Source:** `server/scheduler/cronScheduler.ts`
**Status:** Open

---

## Summary

On server startup, the `CronScheduler` immediately fires a cron job that calls `runWebSearch()`, which requires a Tavily API key. Since Tavily was only a POC and the key is not (and should never be) configured, the job throws a hard error and marks itself as failed in Supabase. This happens on every startup.

---

## Log Evidence

```
[CronScheduler] Processing due jobs { dueCount: 1 }
[CronScheduler] Job failed {
  jobId: '768c4882-10c8-4546-b4cb-8b52e6d0152c',
  errorMessage: 'Missing Tavily API key (TAVILY_API_KEY or VITE_TAVILY_API_KEY).',
  nextRunAt: '2026-02-26T02:00:00.000Z'
}
```

---

## Root Cause

Two separate issues compound into this bug:

### Issue A — Dead Code: Tavily is Still in `cronScheduler.ts`

Tavily was integrated as a POC for web search inside cron jobs. It was never promoted to production use. However, the code was never removed:

- `getTavilyApiKey()` — checks for `TAVILY_API_KEY` or `VITE_TAVILY_API_KEY`
- `runWebSearch(query)` — throws if key is missing; calls `https://api.tavily.com/search`
- `buildFallbackSummary()` — helper for Tavily results
- `TavilyResult` interface — Tavily-specific type
- `summarizeSearchResults()` still depends on Tavily results as input

Every non-promise-mirror cron job will call `runWebSearch()`. If no Tavily key exists, it throws immediately.

### Issue B — Stale Cron Job Row in Supabase

There is at least one row in the `cron_jobs` table with `status = 'active'` that references a Tavily-based search query. This row was likely created during the POC and was never cleaned up. It fires on startup because `next_run_at` is in the past.

**Job ID in logs:** `768c4882-10c8-4546-b4cb-8b52e6d0152c`

---

## Impact

- Every server startup logs a job failure.
- The stale job re-schedules itself (`nextRunAt: 2026-02-26T02:00:00.000Z`), so it fires daily, indefinitely.
- If this were a new cron job added by the user, it would silently never work.
- Misleading noise in server logs and in the `cron_job_runs` table in Supabase.

---

## Resolution Steps

### Step 1 — Remove Tavily code from `cronScheduler.ts`

Delete the following from `server/scheduler/cronScheduler.ts`:
- The `TavilyResult` interface
- `getTavilyApiKey()` function
- `runWebSearch()` function
- `buildFallbackSummary()` function
- The `isPromiseMirrorJob` branch that calls `runWebSearch()`
- All references to Tavily results passed into `summarizeSearchResults()`

Replace cron job execution with either:
- A stub that logs "web search not available" and skips gracefully, OR
- A different search provider integration if web search is desired in the future

### Step 2 — Delete the stale cron job row from Supabase

Run this in the Supabase SQL editor:

```sql
-- Verify first
SELECT id, title, search_query, status, next_run_at
FROM cron_jobs
WHERE id = '768c4882-10c8-4546-b4cb-8b52e6d0152c';

-- Delete if confirmed stale
DELETE FROM cron_jobs
WHERE id = '768c4882-10c8-4546-b4cb-8b52e6d0152c';
```

Also audit for any other active cron jobs that use Tavily-style search queries:

```sql
SELECT id, title, search_query, status
FROM cron_jobs
WHERE status = 'active'
  AND search_query NOT LIKE 'promise_reminder:%';
```

### Step 3 — Search remaining codebase for Tavily references

```bash
grep -r -i "tavily" --include="*.ts" --include="*.tsx" --include="*.env*" .
```

Remove any remaining references. Do not add `TAVILY_API_KEY` to any `.env` file.

---

## Files to Modify

| File | Change |
|------|--------|
| `server/scheduler/cronScheduler.ts` | Remove all Tavily code; replace job executor with graceful skip or new provider |
| Supabase `cron_jobs` table | Delete stale row `768c4882-10c8-4546-b4cb-8b52e6d0152c` |
| Any `.env` / `.env.local` files | Confirm `TAVILY_API_KEY` is not present |
