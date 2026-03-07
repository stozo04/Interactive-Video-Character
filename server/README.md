# Server (Workspace Agent)

This folder hosts the Workspace Agent server that powers multi-agent workflows and auxiliary services used by the Vite UI. It runs a Node HTTP server, orchestrates the Opey dev loop, and schedules background jobs.

## Entry Point

- `server/index.ts`

## What It Does

- Starts the central Agent HTTP server (default port `4010`).
- Loads environment variables from root `.env.local` and root `.env` (highest to lowest priority).
- Starts background services:
  - Opey dev ticket polling loop (reads `engineering_tickets`).
  - Cron scheduler for scheduled digests and reminders.
- Serves `/agent/*` routes — the **central AI intelligence gateway** for all clients (Web, Telegram, WhatsApp).
- Serves `/multi-agent/*` API routes for tickets, events, turns, and chats (Supabase-backed).
- Provides liveness endpoints at `/agent/health` and `/multi-agent/health`.

## Dev Setup (High Level)

1. Install dependencies at repo root:

```bash
npm install
```

2. Start the UI + dev proxy:

```bash
npm run dev
```

3. Start the server (separate terminal):

```bash
npm run agent:dev
```

## Kayley Agent API

The `/agent` routes are the **single entry point** for all AI interactions. Every client (Web, Telegram, WhatsApp) routes through here. The server holds all intelligence — clients are thin.

Base path: `/agent`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/health` | `GET` | `{ status: "ok", sessions: <n> }` — active SDK Chat sessions |
| `/agent/message` | `POST` | Process a user message. Returns `OrchestratorResult`. |
| `/agent/greeting` | `POST` | Generate a first-login daily greeting. |

### POST /agent/message — Request Body

```typescript
{
  message: string;             // User's text message
  messageForAI?: string;       // Optional alternate text sent to LLM (e.g. image descriptions)
  sessionId: string;           // Client-scoped ID, e.g. "web-main", "telegram-123"
  chatHistory?: ChatMessage[]; // Recent turns for context
  tasks?: Task[];
  isMuted?: boolean;
  pendingEmail?: NewEmailPayload;
  userContent?: {              // For image/audio input
    type: 'text' | 'audio' | 'image_text';
    // ... type-specific fields
  };
}
```

### Architecture

```
server/services/ai/
  geminiClient.ts          ← Singleton GoogleGenAI instance (server-only API key)
  chatSessionManager.ts    ← SDK Chat session lifecycle, TTL eviction (2hr)
  toolBridge.ts            ← Wraps executeMemoryTool as SDK CallableTool
  serverGeminiService.ts   ← Implements IAIChatService, automatic function calling

server/routes/agentRoutes.ts  ← HTTP gateway for /agent/*
```

### SDK Chat Sessions

Sessions are stored in-memory keyed by `sessionId`. On server restart, history is reloaded from the `conversation_history` Supabase table. Sessions expire after 2 hours of inactivity.

---

## CORS / Proxy Notes

- In development, the Vite dev server proxies `/multi-agent` to `http://localhost:4010` to avoid CORS preflight failures.
- The frontend uses same-origin requests in dev unless `VITE_WORKSPACE_AGENT_URL` is explicitly set.
- In production, you must expose a backend route for `/multi-agent` or configure CORS on the external multi-agent service.
- A `404 {"error":"Route not found."}` for `/multi-agent/*` usually means this server is not running or the request is hitting a different service without the route handler.

## Multi-Agent API

Base path: `/multi-agent`

- `GET /multi-agent/health` -> `{ ok: true, latencyMs }`
- `GET /multi-agent/tickets?limit=25`
- `POST /multi-agent/tickets`
- `GET /multi-agent/tickets/:id`
- `POST /multi-agent/tickets/:id/transition`
- `POST /multi-agent/tickets/:id/clarify` — relay a clarification answer (resets ticket to `created`)
- `GET /multi-agent/tickets/:id/events?limit=100`
- `GET /multi-agent/tickets/:id/turns?limit=100`
- `GET /multi-agent/chats?limit=25`
- `POST /multi-agent/chats`
- `GET /multi-agent/chats/:id/messages?limit=100`
- `POST /multi-agent/chats/:id/messages`
- `POST /multi-agent/server/restart` — touch trigger file to restart tsx watch

## Environment Variables

Required for persistence (values not listed here):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`)

Required for Kayley AI:

- `GEMINI_API_KEY` — server-only, never exposed to the browser
- `GEMINI_MODEL` — e.g. `gemini-2.5-flash`

Required for Google Workspace (gogcli):

- `GOG_ACCOUNT` — the Gmail address authorized with gogcli (e.g. `gates.steven@gmail.com`)
- `ZONEINFO` — path to Go timezone database zip (required on Windows/MINGW). e.g. `C:/Users/gates/.local/share/zoneinfo.zip`

Optional:

- `OPEY_BACKEND` (e.g., `claude` or `openai`)
- `CRON_TICK_MS`
- `CRON_SCHEDULER_ID`

---

## Google Workspace Access (gogcli)

All Google API access (Gmail, Calendar, Contacts, Drive, Tasks, etc.) goes through **gogcli** (`gog`), a Go CLI binary that wraps Google APIs and handles OAuth token refresh automatically via the OS keyring (Windows Credential Manager).

**There is no browser-side Google OAuth.** The app loads straight to the character selection screen. All Google operations run server-side through the `gog` binary.

### How Kayley Uses Google Workspace (The 3-Step Process)

Kayley (the AI) does NOT directly know CLI commands. She interacts with Google through a **telephone game** with 3 layers:

```
Step 1: TELL HER IT EXISTS
  Kayley's system prompt (toolsAndCapabilities.ts) contains a "cheat sheet" of
  available commands. This is literally her instruction manual. If a command
  isn't in the cheat sheet, she doesn't know it exists.

Step 2: GIVE HER A BUTTON TO PRESS
  Tool declarations in aiSchema.ts define "buttons" Kayley can press.
  She has two main tools for Google:
    - gmail_search  → dedicated typed tool for email search (high-frequency)
    - calendar_action → dedicated typed tool for calendar CRUD (high-frequency)
    - google_cli    → general-purpose tool for EVERYTHING else

  When Kayley wants to do something Google-related, she calls one of these
  tools with parameters (e.g., { command: "tasks add MyList 'Buy groceries'" }).

Step 3: WIRE THE BUTTON TO GOGCLI
  The handler in memoryService.ts catches the tool call and translates it into
  a gog CLI command via gogService.ts. The output is parsed and returned to
  Kayley as text she can reason about.

  Example flow:
    User: "What's on my Google Tasks?"
    Kayley calls: google_cli({ command: "tasks list" })
    memoryService.ts → gogService.execGeneralCommand("tasks list")
    gogService.ts → execFile('gog', ['--json', '--account', 'user@gmail.com', 'tasks', 'list'])
    gog binary → Google Tasks API → JSON response
    Response flows back up → Kayley reads it → responds naturally
```

**To add a new Google capability** (e.g., Google Sheets):
1. Add the service name to `ALLOWED_COMMANDS` in `gogService.ts`
2. Add write subcommands to `ALLOWED_WRITE_SUBCOMMANDS` if needed
3. Add example commands to the cheat sheet in `toolsAndCapabilities.ts`
4. That's it. No new tool declarations needed — `google_cli` handles it.

### Key Files

| File | What It Does |
|------|--------------|
| `server/services/gogService.ts` | Core wrapper. Spawns `gog` CLI via `child_process.execFile`. Contains the **permission allowlist**, typed wrappers for hot-path operations, and the general `execGeneralCommand` function. |
| `src/services/aiSchema.ts` | Tool declarations (the "buttons" Kayley can press). Contains `google_cli` tool definition. |
| `src/services/memoryService.ts` | Tool handler. Catches `google_cli` calls from Kayley and routes to `gogService.execGeneralCommand()`. |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | The cheat sheet. Rule 14 contains every Google command Kayley knows about. |
| `server/services/gmailPoller.ts` | Background poller. Uses `searchEmails()` from gogService every 10s to find new emails. |
| `server/services/calendarHeartbeat.ts` | Background service. Uses `fetchCalendarWindow()` from gogService every 15min for event reminders. |

### Permission Allowlist (gogService.ts)

The `google_cli` tool enforces per-service write permissions. This is the **source of truth** for what Kayley can and cannot do:

```
SERVICE     ALLOWED WRITES                                          BLOCKED
─────────── ─────────────────────────────────────────────────────── ──────────
gmail       send, modify, batch (archive via label removal)         delete
calendar    create, update, delete                                  (none)
tasks       create, add, update, done, undo, delete, clear          (none)
contacts    create, update                                          delete
drive       create, upload, update, mkdir                            delete
time        (read-only, no writes)                                  all writes
```

**Always blocked** regardless of service: `vacation`, `delegates`, `filters` (Gmail admin settings).

The allowlist lives in two constants in `gogService.ts`:
- `ALLOWED_COMMANDS` — which top-level services are accessible (gmail, calendar, contacts, drive, tasks, time)
- `ALLOWED_WRITE_SUBCOMMANDS` — per-service map of which write operations are permitted

If a command fails the allowlist check, Kayley gets an error message explaining what's blocked and why.

### Typed Wrappers (Hot Path)

For operations Kayley does constantly, there are dedicated typed wrapper functions in `gogService.ts` that bypass the general allowlist and provide better error handling:

| Function | Used By | What It Does |
|----------|---------|--------------|
| `searchEmails(query, max)` | `gmail_search` tool, `gmailPoller.ts` | Gmail search with structured results |
| `fetchEmailBody(messageId)` | `gmailPoller.ts`, `telegramHandler.ts` | Fetch full email body |
| `archiveEmail(messageId)` | `telegramHandler.ts`, `whatsappHandler.ts` | Archive by removing INBOX label |
| `sendReply(messageId, to, subject, body)` | `telegramHandler.ts`, `whatsappHandler.ts` | Reply to an email thread |
| `sendEmail(to, subject, body)` | `memoryService.ts` (email_action) | Send a new email |
| `listCalendarEvents(options)` | `calendar_action` tool | List events with date/range filters |
| `createCalendarEvent(options)` | `calendar_action` tool | Create a calendar event |
| `deleteCalendarEvent(eventId)` | `calendar_action` tool | Delete a calendar event |
| `fetchCalendarWindow(min, max)` | `calendarHeartbeat.ts` | Fetch events in a time window |

### Initial Setup (One-Time)

1. **Install gogcli:** Download the binary from https://github.com/steipete/gogcli and place it on PATH (e.g., `~/.local/bin/gog`).

2. **Load OAuth credentials:** Go to Google Cloud Console > Credentials > create a **Desktop** OAuth client > download JSON. Then:
   ```bash
   gog auth credentials set ~/path/to/credentials.json
   ```

3. **Authorize your Google account:**
   ```bash
   gog auth add your-email@gmail.com --services all
   ```
   This opens a browser. Sign in and grant permissions. The refresh token is stored in Windows Credential Manager and auto-refreshes forever (no 7-day expiry).

4. **Set environment variables** in `.env.local`:
   ```
   GOG_ACCOUNT=your-email@gmail.com
   ZONEINFO=C:/Users/yourname/.local/share/zoneinfo.zip
   ```

5. **Get the timezone database** (Windows/MINGW only — Go can't find system timezones):
   ```bash
   curl -fsSL "https://github.com/golang/go/raw/master/lib/time/zoneinfo.zip" -o ~/.local/share/zoneinfo.zip
   ```
   Also add to `~/.bashrc` for terminal use:
   ```bash
   export ZONEINFO="C:/Users/yourname/.local/share/zoneinfo.zip"
   ```

6. **Verify:**
   ```bash
   gog gmail search "is:unread" --json --account your-email@gmail.com
   gog calendar list --json --account your-email@gmail.com
   ```

### What Was Deleted (2026-03-07)

The entire browser-side Google OAuth flow was removed. These files no longer exist:

| Deleted File | What It Was |
|--------------|-------------|
| `src/services/gmailService.ts` | Browser-side Gmail API wrapper (direct REST calls) |
| `src/services/googleAuth.ts` | Google OAuth GAPI init + token management |
| `src/services/calendarService.ts` | Browser-side Calendar API wrapper |
| `src/services/googleApiService.ts` | Google API helper utilities |
| `src/services/calendarCheckinService.ts` | Browser-side event check-in tracker |
| `server/services/googleTokenService.ts` | Server-side token persistence + refresh |
| `src/hooks/useGmail.ts` | Gmail React hook |
| `src/hooks/useCalendar.ts` | Calendar polling React hook |
| `src/contexts/GoogleAuthContext.tsx` | Google auth React context + provider |
| `src/components/GmailConnectButton.tsx` | Gmail sign-in button |
| `src/components/GoogleTab.tsx` | Admin dashboard Google API settings tab |
| `src/components/LoginPage.tsx` | Google sign-in gate page |
| `src/components/AuthWarningBanner.tsx` | Auth status warning banner |

Also removed from the pipeline: `googleAccessToken` and `upcomingEvents` were threaded through 15+ files (App.tsx, agentClient, agentRoutes, messageOrchestrator, serverGeminiService, etc.). All references deleted. Calendar events are now fetched on-demand via the `calendar_action` tool, not pre-loaded per message.

## Process Management

```bash
# See all running node processes
tasklist | grep node

# Kill all node processes
taskkill //F //IM node.exe
```

## Troubleshooting

- If you see CORS errors in the browser console, make sure:
  - the server is running on `http://localhost:4010`, and
  - the Vite dev server is running on `http://localhost:3000`.
- If the server exits immediately, confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
- If `/multi-agent/*` returns 404, confirm `npm run agent:dev` is running and that the request is not going to a different server on port `4010`.

## Opey Dev Agent

Opey is an autonomous dev agent that polls `engineering_tickets` and implements them in isolated git worktrees.

### Orchestrator Backend

Opey supports two execution backends, selected via the `OPEY_BACKEND` environment variable:

| Value | File | CLI |
|-------|------|-----|
| `claude` (default) | `orchestrator.ts` | Claude Code CLI (`claude`) |
| `openai` | `orchestrator-openai.ts` | OpenAI Codex CLI (`codex`) |

Set `OPEY_BACKEND=openai` to switch to the Codex backend. Unset or `claude` runs the Claude backend.

### Prompt Delivery via Temp File

Both orchestrators write the full assembled prompt (SOUL.md + lessons_learned + ticket details) to a temp file in `os.tmpdir()` before spawning the CLI. The CLI receives only a short boot instruction:

```
Your complete task instructions are in this file — read it before doing anything:
C:\...\AppData\Local\Temp\opey-<ticketId>.md
Implement everything described in that file.
```

**Why:** Windows `CreateProcess` has a ~32KB command-line limit. The combined prompt (all lessons files concatenated, SOUL.md, ticket details) can exceed that, causing `spawn ENAMETOOLONG`. The temp file sidesteps the limit entirely. The file is deleted in the orchestrator's `finally` block.

### Self-Healing Architecture

When an infrastructure error prevents the CLI from launching (e.g. `ENAMETOOLONG`, `ENOENT`, binary not found), `main.ts` enters a self-heal loop rather than immediately marking the ticket failed:

```
Infrastructure error caught in main.ts
         ↓
attemptSelfHeal() — up to 3 attempts per ticket
         ↓
Read attempt count from os.tmpdir()/opey-heal-count-<ticketId>.txt
         ↓
Write meta-prompt to os.tmpdir()/opey-self-heal-<ticketId>.md
(contains: error message + full source of both orchestrators)
         ↓
Spawn a meta-Claude/Codex run with short boot arg pointing at that file
         ↓
Meta-Claude patches the orchestrator source on disk
         ↓
✅ Exit 0 → reset ticket to 'created', restart Opey process, retry
❌ Non-zero exit → return false → ticket marked 'failed'
         ↓
After 3 failed attempts → give up, delete count file, mark 'failed'
```

Key implementation files:
- `server/agent/opey-dev/main.ts` — `attemptSelfHeal()` function
- `server/agent/opey-dev/orchestrator.ts` — Claude backend
- `server/agent/opey-dev/orchestrator-openai.ts` — Codex backend

The process restart uses the same detached-spawn pattern as the WhatsApp bridge restart:
```ts
spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' })
child.unref();
setTimeout(() => process.exit(0), 300);
```

### Clarification Loop

When Opey produces no commits AND no uncommitted file changes, the ticket is set to `needs_clarification` with his output stored in `clarification_questions`. Kayley (the AI companion) detects this via Supabase Realtime in the web app, relays the questions to the user, and POSTs the answer to `/multi-agent/tickets/:id/clarify`. Telegram and WhatsApp now have server-side engineering ticket bridges that proactively push `needs_clarification`, `completed`, `failed`, and `pr_ready` status updates even when no browser tab is open. The ticket resets to `created` with the Q&A appended to `additional_details`. Max **3 clarification rounds** — tracked by counting `--- CLARIFICATION ---` markers in `additional_details`. After 3 rounds Opey ships best-effort or fails.

### Auto-Commit

Claude/Codex sometimes edits files but forgets to `git commit`. If `hasCommitsAheadOfMain()` is false but `hasUncommittedChanges()` is true, `main.ts` commits on the agent's behalf and proceeds to PR creation.

### Worktree Branching

Worktrees branch from `main`, not `HEAD`. This is critical — if they branched from a dev branch, `git log main..HEAD` would show pre-existing commits and the clarification detection would never fire.

### Worktree Cleanup

After PR creation (success or fail), the worktree is cleaned up. Previously this only happened in the clarification/failure paths, leaving orphaned worktrees that could block future checkouts and cause Vitest to pick up duplicate test files.

## Tidy — Nightly Code Hygiene Agent

Tidy is a conservative Claude Code agent that runs every night at midnight CST. He picks 5 files per run, applies 4 safe mechanical transforms, commits file-by-file, and opens a PR for Steven to review in the morning.

### The 4 Transforms

| # | Transform |
|---|---|
| 1 | Remove commented-out dead code |
| 2 | Remove unused imports |
| 3 | Standardize logging (`runtimeLogger` in `server/`, `clientLogger` in `src/`) |
| 4 | Standardize silent catch blocks |

### File Rotation

Tidy tracks processed files via a `processedFiles` set stored in the cron job's `payload` JSONB column. After each batch, the set grows. When all files are processed, it resets and the loop starts over. This survives file additions/deletions without cursor drift.

### `// TIDY:` Protocol

Leave instructions for Tidy directly in the code:

```typescript
// TIDY: This import is unused
// TIDY: Standardize the catch block below
```

Tidy acts on plain `// TIDY:` comments and removes them when done. He leaves `// TIDY: ⚠️` notes for things that need human review and are out of his scope.

### File Structure

```
server/agent/tidy/
  SOUL.md          ← Tidy's personality (conservative janitor, not architect)
  IDENTITY.md      ← Quick-reference identity card
  README.md        ← Full documentation
  orchestrator.ts  ← Thin Claude Code CLI spawner
  migrations/
    001_create_tidy_cron_job.sql         ← Daily midnight run
    002_create_tidy_branch_cleanup_cron.sql  ← Weekly stale branch cleanup
server/scheduler/
  codeCleanerHandler.ts      ← Batch selection, TIDY comment scan, PR creation
  tidyBranchCleanupHandler.ts ← Deletes tidy-* branches older than 7 days
```

### Activation

Run both migrations once in the Supabase SQL editor. Tidy fires tonight at midnight CST.

---

## Lessons Learned

- A Vite proxy avoids CORS in development, but it does not create backend routes. The server still must implement `/multi-agent/*`.
- A `{"error":"Route not found."}` response means the request reached a server that does not recognize the route (not a browser CORS issue).
- A lightweight health endpoint (`/multi-agent/health`) is a fast way to confirm server + Supabase connectivity before debugging UI failures.
- **Closing a terminal on Windows does not kill child processes.** Node processes survive and keep running on the same port. Use `taskkill //F //IM node.exe` to clean up.
- **`tsx watch` restarts on file changes, not process exit.** To restart the server programmatically, touch a trigger file (`server/.restart-trigger`) instead of calling `process.exit()`.
- **Worktrees must branch from `main`.** Branching from `HEAD` (which could be any dev branch) means `git log main..HEAD` sees pre-existing commits, breaking any "did the agent make changes?" detection.
- **Codex doesn't always commit its work.** The agent can edit files and exit 0 without running `git commit`. Always check for uncommitted changes as a fallback before assuming "no changes = clarification."
- **Vitest picks up test files in worktrees.** Add `.worktrees/**` to `vite.config.ts` `test.exclude` to prevent orphaned worktrees from causing duplicate/stale test failures in CI.
- **Do not spawn `.cmd` files directly on Node 18.14+.** CVE-2024-27980 broke it — use a direct `.exe` path or `{ shell: true }` to route through cmd.exe.
- **Embedded newlines in spawn args throw `EINVAL` on Windows.** Keep all CLI boot arg strings single-line.
- **Claude Code on this machine is a standalone `.exe`, not an npm global.** Path: `C:\Users\gates\AppData\Roaming\Claude\claude-code\2.1.34\claude.exe`. Don't assume `claude.cmd` exists.
- **VS Code buffers cause silent file reversions.** When Claude edits a file that VS Code has open, VS Code may overwrite the change on next save. Commit immediately to make the change visible in git. Ask the user to close the tab before editing critical infrastructure files.
