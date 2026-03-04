# Tidy — Automated Code Hygiene Agent

Tidy is a nightly Claude Code agent that walks through the codebase 5 files at a time,
cleaning up low-risk issues and opening a PR for Steven to review each morning.

He is not Opey. Opey builds. Tidy sweeps.

---

## What Tidy Does

Every night at midnight (America/Chicago), Tidy picks the next 5 files in the project,
runs his checklist, commits any changes file-by-file, and opens a pull request.

### The 5 Transforms (and nothing else)

| # | Transform | What it does |
|---|---|---|
| 1 | **Remove commented-out code** | Deletes dead code blocks that were commented out. Leaves explanatory comments alone. |
| 2 | **Remove unused imports** | Drops import statements for symbols never referenced in the file. |
| 3 | **Standardize logging** | Replaces bare `console.*` calls with the correct project logger (see Logger Rules below). |
| 4 | **Standardize catch blocks** | Adds a minimal log to silently-swallowed empty catch blocks. |
| 5 | ~~Write missing tests~~ | ⛔ Disabled — re-enable in SOUL.md once Tidy's judgment is validated. |

Tidy will **never** change logic, rename symbols, refactor architecture, or touch files
outside his assigned batch.

---

## The `// TIDY:` Protocol

You and Tidy communicate through comments in the code.

### Leave instructions FOR Tidy

```typescript
// TIDY: Remove this dead code
// TIDY: This import is unused
// TIDY: Standardize the error handling in this catch block
```

Plain `// TIDY:` = an instruction. When Tidy processes that file, he acts on it
(if it's within his 5 transforms) and **removes the comment** when done.

### Tidy leaves notes FOR you

```typescript
// TIDY: ⚠️ This function has no error handling — needs human review
// TIDY: ⚠️ Possible race condition on line 47
// TIDY: ⚠️ This logic is duplicated in serviceB.ts
```

`// TIDY: ⚠️` = Tidy saw something, flagged it, and did NOT touch it.
These stay in the code until a human acts on them.

### The rule of thumb

- No `⚠️` → instruction for Tidy, he removes it when done
- Has `⚠️` → note from Tidy, needs human review

---

## Logger Rules

Tidy enforces the correct logger for each part of the codebase.
**Using the wrong logger is treated as a bug**, not a style issue — bare console calls
disappear into the terminal and never reach Supabase.

### `server/**` → runtimeLogger

```typescript
import { log } from '../../runtimeLogger'; // adjust relative path

const LOG_PREFIX = "[MyService]";

log.info(`${LOG_PREFIX} Task created`, { source: 'myService.ts', taskId });
log.warning(`${LOG_PREFIX} Retry limit approaching`, { source: 'myService.ts', attempt });
log.error(`${LOG_PREFIX} DB write failed`, { source: 'myService.ts', error: err.message });
log.critical(`${LOG_PREFIX} Service unreachable`, { source: 'myService.ts', url });

// Context-bound (auto-attaches source/ticketId to every call)
const ctxLog = log.fromContext({ source: 'myService.ts', ticketId: ticket.id });
ctxLog.info('Starting');
ctxLog.error('Failed', { exitCode });
```

### `src/**` → clientLogger

```typescript
import { clientLogger } from './clientLogger'; // adjust relative path

const LOG_PREFIX = "[MyService]";

// Flat calls
clientLogger.info(`${LOG_PREFIX} Task created`, { taskId });
clientLogger.error(`${LOG_PREFIX} Insert failed`, { error: err.message });

// Scoped logger (preferred — auto-prefixes every message)
const log = clientLogger.scoped('MyService');
log.info('Fetching tasks');
log.error('Failed to toggle task', { taskId, error: err.message });
```

### Severity guide

| Level | When to use |
|---|---|
| `info` | Normal operation, state changes, lifecycle events |
| `warning` | Unexpected but handled — fallback triggered, retry needed |
| `error` | Operation failed — user-visible impact likely |
| `critical` | Service down, data loss possible, needs immediate attention |

---

## How File Rotation Works

Tidy never processes the same 5 files two nights in a row.

**The file list** is built by walking `src/` then `server/` recursively,
collecting all `.ts` and `.tsx` files (excluding `*.test.ts`, `*.d.ts`, `node_modules`, `dist`,
and Tidy's own directory).

**The cursor** is an integer stored in the cron job's `payload` field in Supabase:

```
Night 1 → cursor: 0  → files  1–5
Night 2 → cursor: 5  → files  6–10
Night 3 → cursor: 10 → files 11–15
...
Night N → cursor wraps back to 0 → starts over from the top
```

After each batch, the handler advances the cursor:
```typescript
nextCursor = (batchStart + BATCH_SIZE) % allFiles.length;
```

The modulo (`%`) handles the wrap automatically. If the codebase has 47 files and the
cursor is at 45, Tidy cleans files 45–46 (2 files), then resets to 0 the next night.

**To check where Tidy is right now:**
```sql
SELECT payload FROM cron_jobs WHERE action_type = 'code_cleaner';
-- { "cursor": 35 }  ← currently on file 35 of N total
```

**Note on file additions/deletions:** If files are added or removed between runs, the
list re-indexes and the cursor lands on a different file than expected. This is harmless —
Tidy covers everything eventually regardless of shifts.

---

## Reporting

Tidy runs through the standard cron infrastructure, so every run is automatically logged:

- **`cron_job_runs`** — one row per nightly run (status, start/end time, summary, PR URL)
- **`cron_job_events`** — granular events within each run

Query Tidy's history:
```sql
SELECT started_at, status, summary
FROM cron_job_runs
WHERE action_type = 'code_cleaner'
ORDER BY started_at DESC;
```

---

## File Structure

```
server/agent/tidy/
  SOUL.md          ← Tidy's personality and behavioral rules (read by Claude)
  IDENTITY.md      ← Quick-reference identity card
  README.md        ← This file
  orchestrator.ts  ← Spawns Claude Code CLI with Tidy's soul
  migrations/
    001_create_tidy_cron_job.sql  ← Run once in Supabase to activate
```

The cron handler lives at:
```
server/scheduler/codeCleanerHandler.ts
```

---

## Activation

Run the migration once in the Supabase SQL editor:

```
server/agent/tidy/migrations/001_create_tidy_cron_job.sql
```

Tidy will fire tonight at midnight CST. Check the PR in the morning.

---

## Relationship to Opey

| | Opey | Tidy |
|---|---|---|
| **Role** | Captain-level engineer | Janitor |
| **Triggered by** | Steven (via engineering tickets) | Cron (midnight, automatic) |
| **Scope** | Full implementations, new features, bug fixes | 5 mechanical transforms only |
| **Autonomy** | Makes architectural decisions | Skips anything uncertain, leaves a note |
| **PR size** | Can be large | Always small |
| **Soul** | Ambitious, ships big things | Conservative, stays in his lane |

They share `BranchManager` and `createPullRequest` infrastructure but have completely
separate souls, orchestrators, and operating parameters.
