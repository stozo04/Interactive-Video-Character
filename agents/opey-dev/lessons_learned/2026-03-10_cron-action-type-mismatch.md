# Lessons Learned — 2026-03-10 — Cron Action Type Mismatch

## Ticket
Add a nightly log cleanup job to purge `server_runtime_logs` and `engineering_ticket_events` older than 7 days.

## The Bug I Introduced
I implemented the handler as `"log_cleanup"` in `JOB_HANDLERS` but wrote the SQL migration with `action_type = 'runtime_log_cleanup'`. These are different strings. The scheduler threw `Unknown action_type: runtime_log_cleanup` on the first tick and every tick after.

This is the exact same failure that was found in the `code_cleaner` / Tidy bug on the same day.

## Root Cause
The `action_type` string is a **runtime contract** — an implicit interface between:
- `JOB_HANDLERS["log_cleanup"]` in `cronScheduler.ts` (code)
- `cron_jobs.action_type = 'runtime_log_cleanup'` in the SQL migration (DB)

Neither side has type safety. TypeScript cannot catch this. It only blows up at runtime.

## The Fix That Was Needed
The SQL migration action_type must exactly match the JOB_HANDLERS key — character for character:

```sql
-- WRONG
action_type = 'runtime_log_cleanup'

-- RIGHT (matches JOB_HANDLERS key)
action_type = 'log_cleanup'
```

## What Future Opey MUST Do

### For any cron job feature:

1. **Read `server/scheduler/README.md` first.** It has the authoritative handler inventory table. Your new handler must appear in that table.

2. **Treat action_type as a named contract.** Before committing, explicitly cross-check:
   - The key in `JOB_HANDLERS` in `cronScheduler.ts`
   - The `action_type` value in your SQL migration
   - The `action_type` value in any `cron_jobs` DB rows you reference

   They must be identical. Do a literal string comparison in your head. Not "close enough" — identical.

3. **Update the README handler inventory table** (`server/scheduler/README.md` → "Main server handler inventory"). Add your new action_type to the table. This is how future engineers (and future you) know what's registered.

4. **The architecture:** Two pollers read `cron_jobs` — the main server scheduler and the Tidy agent. Main server owns: `web_search`, `maintenance_reminder`, `monthly_memory_rollover`, `promise_mirror`, `persona_evolution`, `log_cleanup`. Tidy owns: `code_cleaner`, `tidy_branch_cleanup`. Adding a new type to the wrong poller = `Unknown action_type` at 2am.

## Generalized Principle
Any time a string literal appears in BOTH code AND an external system (DB row, migration, config file, API contract), it is a runtime contract. Step 4 (Verify) must include an explicit check that these match — not just that the code compiles.
