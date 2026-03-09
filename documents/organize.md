# Plan: Decouple Agents + Edge Devices + Root Logger

## Context

**Problem 1 (hot-reload cascade):** Opey-Dev and Tidy are child processes/in-process handlers of `server/index.ts`. When they save files in `server/`, tsx watch restarts the server, killing the agents mid-work.

**Problem 2 (monolithic feel):** Telegram and WhatsApp are already separate processes, but they live inside `server/` which makes the codebase feel monolithic. Moving them to top-level directories makes the architecture visible in the file tree.

**Problem 3 (logger duplication):** Two identical loggers (`server/runtimeLogger.ts` and `src/services/clientLogger.ts`) writing to the same `server_runtime_logs` table — unnecessary maintenance burden.

**Non-problem:** `supabase/` stays at project root (shared infrastructure, Supabase CLI convention, used by 34 browser files + 12 server files)

---

## Phase 1: Root Logger — `lib/logger.ts`

**New file: `lib/logger.ts`**

Single logger that works in both Node.js and browser environments. Combines the APIs of both existing loggers:

- **From `runtimeLogger.ts`:** `log.verbose/info/warning/error/critical()`, `log.fromContext({ source, agentName, ticketId, ... })`, `log.write()`
- **From `clientLogger.ts`:** `log.scoped(name)`, `log.withRequestId(id, source)`

**Environment detection:**
```typescript
const isNode = typeof process !== 'undefined' && process.versions?.node != null;
```
- Node: lazy-create Supabase client from `process.env.SUPABASE_URL` + `process.env.SUPABASE_SERVICE_ROLE_KEY`
- Browser: use `import.meta.env.VITE_SUPABASE_URL` + `import.meta.env.VITE_SUPABASE_ANON_KEY`
- Same lazy-init + warn-once pattern from current `runtimeLogger.ts`

**Why `lib/` at root?** Agents need to import it without pulling in `server/` transitive deps. Root-level `lib/` avoids tsx watch triggers from `server/`.

**Existing loggers stay in place.** Tidy will clean them up in a future pass. New code and agent code uses `lib/logger.ts`.

### Files
- **Create:** `lib/logger.ts`

---

## Phase 2: Opey-Dev as Standalone Process

**Goal:** Server restart no longer kills Opey.

### Step 2a: Create standalone entry point

**New file: `server/agent/opey-dev/index.ts`**

Extract from `startOpeyDev()` in `main.ts` (lines 350-410):
1. Load env via dotenv (same as server/index.ts lines 39-58)
2. Create `SupabaseTicketStore` + `BranchManager`
3. Run `pruneAllStaleWorktrees()` + `failOrphanedTickets()`
4. Start the poll loop (`processNextTicket` every 30s)
5. Handle SIGINT/SIGTERM gracefully (clear interval, log shutdown)
6. Import logger from `lib/logger.ts`

### Step 2b: Add npm script

**Modify: `package.json`** — add:
```
"opey:dev": "npx tsx watch --ignore '.worktrees/**' --ignore 'node_modules/**' --ignore 'src/**' --ignore 'server/agent/**' --import ./server/envShim.ts server/agent/opey-dev/index.ts"
```

Key: `--ignore 'server/agent/**'` prevents Opey's own file saves from restarting itself. Changes to shared `server/services/` still trigger restart (those are genuine dependency changes).

### Step 2c: Remove Opey from server/index.ts

**Modify: `server/index.ts`**
- Remove `import { startOpeyDev }` (line 8)
- Remove `startOpeyDev()` call and `opeyDevHandle` variable (lines 110-121)
- Remove `opeyDevHandle.stop()` from shutdown (line 364)
- Remove `opey` option from `createMultiAgentRouter` call (lines 131-135)

### Step 2d: Update multiAgentRoutes

**Modify: `server/routes/multiAgentRoutes.ts`**
- `/multi-agent/opey/health` → return `{ ok: true, message: "Opey runs as a standalone process" }` (or read heartbeat from Supabase if we want real status later)
- `/multi-agent/opey/restart` → return `{ ok: false, message: "Opey is a standalone process — restart from its terminal" }`
- Remove `opey` from `MultiAgentRouterOptions` interface

### Files
- **Create:** `server/agent/opey-dev/index.ts`
- **Modify:** `package.json`, `server/index.ts`, `server/routes/multiAgentRoutes.ts`

---

## Phase 3: Tidy as Standalone Process

**Goal:** Tidy runs independently, server restart doesn't kill active Claude CLI sessions.

### Step 3a: Create standalone entry point

**New file: `server/agent/tidy/index.ts`**

Standalone process that:
1. Loads env via dotenv
2. Creates its own Supabase client
3. Polls `cron_jobs` table every 60s for the `code_cleaner` job
4. If `next_run_at <= now` and `status = 'active'`, calls `runCodeCleanerBatch()`
5. Updates `next_run_at` after completion
6. Also handles `tidy_branch_cleanup` job on the same loop
7. Handles SIGINT/SIGTERM
8. Uses `lib/logger.ts`

### Step 3b: Remove Tidy from cronScheduler

**Modify: `server/scheduler/cronScheduler.ts`**
- Remove `code_cleaner` and `tidy_branch_cleanup` from `JOB_HANDLERS` map (lines 387-393)
- Remove imports: `runCodeCleanerBatch`, `runTidyBranchCleanup`
- Cron scheduler keeps running for other jobs (digests, promise reminders, etc.)

### Step 3c: Add npm script

**Modify: `package.json`** — add:
```
"tidy:dev": "npx tsx watch --ignore '.worktrees/**' --ignore 'node_modules/**' --ignore 'src/**' --ignore 'server/agent/**' --import ./server/envShim.ts server/agent/tidy/index.ts"
```

### Files
- **Create:** `server/agent/tidy/index.ts`
- **Modify:** `package.json`, `server/scheduler/cronScheduler.ts`

---

## Phase 4: Update PowerShell Startup Script

**Modify: `scripts/start-agent-window.ps1`**

Add two new process launch blocks (same pattern as existing agent + telegram blocks):

1. **Opey-Dev window** — title "Opey Dev", runs `npm run opey:dev`. No port check needed (Opey doesn't listen on a port). Use window-title detection or just launch unconditionally (Supabase ticket locking prevents double-processing).
2. **Tidy window** — title "Tidy Agent", runs `npm run tidy:dev`. Same approach.

### Files
- **Modify:** `scripts/start-agent-window.ps1`

---

## Phase 5: Move Telegram to Top-Level Directory

**Goal:** `server/telegram/` → `telegram/` — file tree reflects architecture.

### Step 5a: Move files

Move all 8 files from `server/telegram/` to `telegram/`:
- `index.ts`, `telegramClient.ts`, `telegramHandler.ts`, `telegramEmailBridge.ts`
- `telegramEngineeringTicketBridge.ts`, `serverAudio.ts`, `serverSticker.ts`, `restartTrigger.ts`

### Step 5b: Update import paths in all 8 files

| Old import | New import |
|---|---|
| `../runtimeLogger` | `../lib/logger` (use root logger) |
| `../services/*` | `../server/services/*` |
| `../../src/services/*` | `../src/services/*` |
| `../../src/handlers/*` | `../src/handlers/*` |
| `../../src/types` | `../src/types` |

Local imports (e.g., `./telegramClient`) stay unchanged.

### Step 5c: Update npm script

**Modify: `package.json`** — change:
```
"telegram:dev": "npx tsx watch --ignore '.worktrees/**' --ignore 'node_modules/**' --ignore 'src/**' --import ./server/envShim.ts telegram/index.ts"
```

### Step 5d: Update any server imports of telegram

Check if anything in `server/` imports from `server/telegram/` and update paths.

### Files
- **Move:** 8 files from `server/telegram/` → `telegram/`
- **Modify:** all 8 files (import paths), `package.json`

---

## Phase 6: Move WhatsApp to Top-Level Directory

**Goal:** `server/whatsapp/` → `whatsapp/` — same treatment as Telegram.

### Step 6a: Move files

Move all 8 files from `server/whatsapp/` to `whatsapp/`:
- `index.ts`, `baileyClient.ts`, `whatsappHandler.ts`, `emailBridge.ts`
- `xMentionBridge.ts`, `engineeringTicketBridge.ts`, `serverAudio.ts`, `serverSticker.ts`

### Step 6b: Update import paths in all 8 files

Same import mapping as Telegram:

| Old import | New import |
|---|---|
| `../runtimeLogger` | `../lib/logger` (use root logger) |
| `../services/*` | `../server/services/*` |
| `../../src/services/*` | `../src/services/*` |
| `../../src/handlers/*` | `../src/handlers/*` |
| `../../src/types` | `../src/types` |

### Step 6c: Update npm script

**Modify: `package.json`** — change:
```
"whatsapp:dev": "npx tsx --import ./server/envShim.ts whatsapp/index.ts"
```

### Step 6d: Update any server imports of whatsapp

Check if anything in `server/` imports from `server/whatsapp/` and update paths.

### Files
- **Move:** 8 files from `server/whatsapp/` → `whatsapp/`
- **Modify:** all 8 files (import paths), `package.json`

---

## Phase 7: Update Agent Imports to Root Logger

**Switch these files from `import { log } from "../../runtimeLogger"` to `import { log } from "../../../lib/logger"`:**

- `server/agent/opey-dev/main.ts`
- `server/agent/opey-dev/ticketStore.ts`
- `server/agent/opey-dev/branchManager.ts`
- `server/agent/opey-dev/githubOps.ts`
- `server/agent/opey-dev/processManager.ts`
- `server/agent/opey-dev/executor.ts`
- `server/agent/tidy/orchestrator.ts`
- `server/scheduler/codeCleanerHandler.ts` (if still used by tidy's standalone entry point)

### Files
- **Modify:** 6-8 agent files (import path change only)

---

## Execution Order

1. Create `lib/logger.ts` (new file, zero risk, testable in isolation)
2. Create `server/agent/opey-dev/index.ts` (standalone entry point)
3. Add `opey:dev` to `package.json` and test standalone launch
4. Remove Opey coupling from `server/index.ts` + `multiAgentRoutes.ts`
5. Create `server/agent/tidy/index.ts` (standalone entry point)
6. Remove Tidy handlers from `cronScheduler.ts`
7. Add `tidy:dev` to `package.json`
8. Move `server/telegram/` → `telegram/`, update all imports
9. Move `server/whatsapp/` → `whatsapp/`, update all imports
10. Update `start-agent-window.ps1` with Opey + Tidy windows + updated Telegram/WhatsApp paths
11. Switch agent file imports to root logger

---

## Verification

1. **Root logger:** Import in a test file, call `log.info("test")`, verify row appears in `server_runtime_logs`
2. **Opey standalone:** Run `npm run opey:dev` in one terminal, `npm run agent:dev` in another. Edit a file in `server/services/`. Verify server restarts but Opey keeps running.
3. **Tidy standalone:** Run `npm run tidy:dev`. Verify it picks up the `code_cleaner` cron job and runs a batch. Verify server restart doesn't kill it.
4. **Telegram moved:** Run `npm run telegram:dev`. Verify bot starts, handles messages, email bridge works.
5. **WhatsApp moved:** Run `npm run whatsapp:dev`. Verify client connects, handles messages.
6. **Full startup:** Run `npm run dev`. Verify PowerShell opens windows for: Server, Telegram, Opey, Tidy. Verify Vite starts in main terminal.
7. **Hot-reload isolation:** While Opey is processing a ticket, manually touch a file in `server/`. Verify Opey's Claude CLI session survives.

---

## Final Directory Structure (after all phases)

```
Interactive-Video-Character/
├── lib/                    # Shared utilities (logger)
│   └── logger.ts
├── server/                 # Central hub (port 4010)
│   ├── agent/              # Agent code (own processes)
│   │   ├── opey-dev/       # Opey-Dev (standalone, npm run opey:dev)
│   │   └── tidy/           # Tidy (standalone, npm run tidy:dev)
│   ├── routes/
│   ├── scheduler/          # Cron (minus tidy handlers)
│   ├── services/           # Shared server services
│   ├── index.ts            # Server entry point
│   └── runtimeLogger.ts    # Legacy (Tidy cleans up later)
├── telegram/               # Telegram edge device (own process, own terminal)
├── whatsapp/               # WhatsApp edge device (own process, own terminal)
├── src/                    # React browser app (Vite)
├── supabase/               # Database migrations (shared infrastructure)
└── scripts/
    └── start-agent-window.ps1
```

---

## What This Does NOT Change

- `server/runtimeLogger.ts` and `src/services/clientLogger.ts` remain (Tidy cleans up later)
- `supabase/` stays at project root
- Agent-to-server communication stays Supabase-mediated
- Shared services stay in `server/services/` (imported by all processes)
