# Lessons Learned — WhatsApp Bridge Health & Restart — 2026-03-03

## Feature
Add a health status indicator for the WhatsApp bridge to the Settings panel (alongside Multi-agent), and a "Restart WhatsApp" button in the Admin Dashboard.

## Codebase Discoveries
- The WhatsApp bridge runs as a **separate standalone process** (`npm run whatsapp:dev`) with no HTTP server of its own — it is not a child of the main server (`server/index.ts`, port 4010).
- `server/whatsapp/baileyClient.ts` owns the socket lifecycle. `_activeSock` is set when the socket object is created (before the connection is open), so it is not a reliable "connected" signal. The correct signal is `connection === 'open'` in the `connection.update` event.
- The bridge uses a file lock at `.whatsapp-auth/bridge.lock` to prevent duplicate instances. Any restart sequence must release this lock before spawning the new process, or the new instance will exit immediately with a lock error.
- `runtimeLog` is defined via `log.fromContext({ source: "whatsappIndex", route: "whatsapp" })` and must be declared **before** any function that references it — `const` does not hoist.
- The main server's multi-agent health uses `getMultiAgentHealth()` in `src/services/multiAgentService.ts`. All new service health functions belong in the same file following the same `fetch` + `parseResponse` pattern.
- The Settings panel gates "character-level" features (Proactive Features, Auto-post) by checking whether `proactiveSettings` prop is truthy — that prop is only passed when a character is selected in `App.tsx`.

## Approach That Worked

### Health endpoint
- Added a minimal `createServer` on port 4011 (`WHATSAPP_HEALTH_PORT`) inside the bridge's `index.ts`.
- Added `_isConnected: boolean` to `baileyClient.ts`, set to `true` on `connection === 'open'` and `false` on `connection === 'close'`.
- Exported `isWhatsAppConnected()` and used it in `GET /health` → `{ ok: true, connected: boolean }`.

### Restart endpoint
- `POST /restart` responds 200, then on `res.finish`:
  1. Calls `releaseSingleInstanceLock()` to remove the lock file.
  2. Spawns a new process using `spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' })` — this re-uses the exact node + tsx + envShim + entry-point args the current process was launched with.
  3. Calls `child.unref()` so the child survives the parent's exit.
  4. `setTimeout(() => process.exit(0), 200)` gives the child time to acquire the lock before the parent dies.
- No external process manager (PM2, systemd) required.

### Frontend wiring
- `getWhatsAppHealth()` and `restartWhatsApp()` added to `multiAgentService.ts` via a `getWhatsAppBaseUrl()` helper that mirrors the existing `getBaseUrl()` pattern for multi-agent.
- In DEV, `getWhatsAppBaseUrl()` returns `"/whatsapp-bridge"` (a relative path) so requests go through the Vite proxy instead of hitting the bridge port directly — avoids both the IPv6 bug and CORS.
- In production, it falls back to `VITE_WHATSAPP_BRIDGE_URL` env var, then `http://localhost:4011`.
- Settings panel runs both health checks in `Promise.all` on a single "Refresh" click.
- Admin Dashboard reuses the existing `multiAgentError` state for WhatsApp restart errors — no need for a separate error state.

## Gotchas & Bugs
- Do NOT call `console.log` for server-side events — use `runtimeLog.info/warning/error`. The `fromContext` logger writes to Supabase `server_runtime_logs` and is the source of truth for debugging.
- The `function startHealthServer()` declaration must come **after** `const LOG_PREFIX` and `const runtimeLog` in the file — referencing them from inside a function body is fine at call time, but the reversed file order is confusing and error-prone.
- `getActiveSock() !== null` is NOT equivalent to "connected" — the socket is assigned before the handshake completes. Always use the dedicated `isWhatsAppConnected()` function.
- **Node 18+ resolves `localhost` to `::1` (IPv6), not `127.0.0.1` (IPv4).** The Vite proxy targets and any server `listen()` calls that use `"localhost"` will get ECONNREFUSED if the server only binds IPv4. Always use `127.0.0.1` explicitly in Vite proxy targets.
- **Browser → local service calls bypass the Vite proxy and hit CORS.** Never call a local backend port directly from frontend service code using an absolute `http://localhost:PORT` URL in DEV. Use a relative path (e.g. `"/whatsapp-bridge"`) so Vite proxies it. Follow the `getBaseUrl()` pattern in `multiAgentService.ts`: return `""` or a prefix in DEV, absolute URL in prod.

## What Future Opey Should Know
- To add a new service health row to the Settings panel, add a `get<Service>Health()` function to `multiAgentService.ts`, add state vars to `SettingsPanel.tsx`, fold it into the `Promise.all` in `loadServerHealth`, and render a dot + label row matching the existing pattern (green-400 / red-400 / amber-400).
- To add an in-code restart for any standalone Node process: embed a minimal HTTP server, release any lock files, then use `spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' })` + `child.unref()` + delayed `process.exit(0)`.
- `VITE_WHATSAPP_BRIDGE_URL` must be added to `.env.example` when adding a new service URL — it is the canonical reference for env var documentation.
- Every new local service added to the stack needs a corresponding Vite proxy entry in `vite.config.ts` using `127.0.0.1` (not `localhost`) as the target, and the frontend service function must use a relative path in DEV via the same `getXxxBaseUrl()` helper pattern.

---

# Lessons Learned — Admin Runtime Logs: Server vs Web Tab — 2026-03-03

## Feature
Add a "Web Runtime Logs" tab inside the Admin Dashboard's Runtime Logs mode to surface client-side logs (written by `clientLogger.ts`) separately from server-side logs.

## Codebase Discoveries
- `clientLogger.ts` writes to the same `server_runtime_logs` Supabase table as the server logger, with `source: 'client'` hardcoded. The `LOG_PREFIX = '[ClientLogger]'` constant is **only** used in `emitLocal()` for browser console output — it is never prepended to the message stored in Supabase.
- `runtimeLogger.ts` (server) does **not** hardcode `source: 'server'`. The `source` column is populated from `entry.source` or inferred from `details.source` — so server logs write service names like `'serverAudio'`, `'whatsapp'`, or `null`. There is no row with `source = 'server'` literally.
- The `source` column is doing **double duty**: it acts as an origin flag for client logs (`'client'`) and a service/route label for server logs (`'serverAudio'`, `'whatsapp'`, etc.).

## Approach That Worked
- **Web Logs tab**: filter `source = 'client'` — `clientLogger` is the only writer that consistently sets this value, so it is a reliable anchor.
- **Server Logs tab**: filter `source != 'client'` — catches all service-named and null-source server entries without requiring a schema change.
- No new database column needed. A proposed `application` column would require a migration and updates to both loggers with no practical gain over the `neq('source', 'client')` approach.
- Sub-tab switcher uses the same pill button pattern already present in the dashboard (e.g., Facts / Agent tabs).

## Gotchas & Bugs
- Filtering `source = 'server'` for the server tab returns zero rows — none of the server-side callers write that literal string. Always use `neq` to exclude the known client value instead.
- `listServerRuntimeLogsAdmin` needed a `source` parameter added. The filter logic branches: `eq('source', 'client')` for web, `neq('source', 'client')` for server, no filter for `'all'`.

## What Future Opey Should Know
- `clientLogger.ts` (browser) and `runtimeLogger.ts` (server) share `server_runtime_logs`. The only reliable discriminator is `source = 'client'` for browser-originated rows; everything else is server-originated.
- If a third origin is ever added (e.g. mobile), it will appear in the Server Logs tab unless it also sets `source: 'client'`. At that point, adding a dedicated `application` column becomes worthwhile.
- The `LOG_PREFIX` constant in both loggers is purely cosmetic for local console output — it has no effect on what lands in Supabase.

---

# Lessons Learned — Opey ↔ Kayley Communication Pipeline — 2026-03-03

## Feature
Wire Opey's ticket lifecycle events (needs_clarification, completed, failed, pr_ready) into Kayley's proactive notification system so Kayley naturally relays status and questions to Steven without group chat complexity.

## Codebase Discoveries
- **`engineeringTicketWatcher.ts`** already existed with a full Supabase Realtime subscription on `engineering_tickets` UPDATE events — it was already calling `triggerSystemMessage` for `completed`, `failed`, and `pr_ready`. The completion pipeline was effectively built and forgotten.
- **`triggerSystemMessage`** in `App.tsx` is the correct mechanism for Kayley to proactively speak. It injects a [SYSTEM] prompt through her full pipeline, causing her to send an unprompted message.
- `subscribeWorkspaceAgentEvents` (from `projectAgentService.ts`) was causing a CORS + 404 console error on every page load. The endpoint `/agent/events` was never implemented on the server — the watcher was trying to open an SSE stream to `http://localhost:4010/agent/events` which doesn't exist. The correct real-time mechanism is the Supabase Realtime subscription in `engineeringTicketWatcher.ts`, not SSE.
- The `source` column on `server_runtime_logs` is overloaded: `clientLogger` writes `source: 'client'`; server loggers write service names (`'serverAudio'`, `'whatsapp'`) or `null`. There is no row with `source = 'server'` literally. The correct filter for server logs is `neq('source', 'client')`.
- `needs_clarification` was suppressed via `shouldAvoidClarification` / `NO_QUESTION_MARKERS` as a workaround because the relay to Steven was never built. The status code path in `main.ts` was always there, just never reachable.
- `engineering_ticket_events` deduplication in `engineeringTicketWatcher` originally used `row.id` as the set key — meaning once a ticket fired `needs_clarification`, it would NEVER fire again for that ticket in the same browser session. Fixed to `${row.id}-${row.updated_at}` so each status transition gets a unique key.
- **QA statuses do not exist** in this project: `ready_for_qa`, `qa_testing`, `qa_changes_requested`, `qa_approved` were defined in types but never used. Canonical status list: `created`, `intake_acknowledged`, `needs_clarification`, `requirements_ready`, `planning`, `implementing`, `pr_preparing`, `pr_ready`, `completed`, `failed`, `escalated_human`, `cancelled`.

## Approach That Worked — Kayley as Relay
Single conversational surface: Opey writes to Supabase, Kayley reads via Realtime, delivers to Steven via `triggerSystemMessage`. No group chat, no SSE, no new server endpoints.

### Clarification flow (end-to-end):
1. Opey sets `needs_clarification` + stores questions in `clarification_questions` column
2. Supabase Realtime fires UPDATE event → `engineeringTicketWatcher` picks it up
3. App.tsx injects [SYSTEM] prompt with questions + ticketId → Kayley relays naturally
4. Steven answers in chat → Kayley calls `submit_clarification(ticketId, response)` tool
5. Tool calls `POST /multi-agent/tickets/:id/clarify` → resets ticket to `created`
6. Opey's 30s poll picks it up → sets `implementing` → continues

### Clarification cap:
`shouldAvoidClarification()` counts `--- CLARIFICATION ---` markers in `additional_details`. After 3 rounds it suppresses further clarification and either ships or fails.

## Tool additions (submit_clarification)
Touch points for adding a new Kayley tool: `aiSchema.ts` (schema + type + GeminiTool definition + union type), `memoryService.ts` (MemoryToolName + ToolCallArgs + case handler), `multiAgentService.ts` (API call function), `toolsAndCapabilities.ts` (strategy rule).

## Gotchas & Bugs
- **Deduplication key must include `updated_at`**, not just `row.id`. Using `row.id` alone means the same ticket can never re-trigger Kayley, even after going through multiple status cycles.
- **`source = 'server'` returns zero rows.** Never filter runtime logs this way. Use `neq('source', 'client')` for server-side entries.
- **The clarify endpoint MUST reset to `created`**, not `implementing`, or the 30s poll loop will never pick the ticket back up (it queries `status = 'created'` only). The `implementing` step happens naturally when the poll fires.
- **`subscribeWorkspaceAgentEvents` default URL is `http://localhost:4010`** — an absolute URL that bypasses the Vite proxy, causing CORS. If this feature is ever built out, use a relative path (`/agent`) through the Vite proxy the same way WhatsApp bridge does.

## What Future Opey Should Know
- To add a new status that Kayley proactively notifies about: add it to `NOTIFY_STATUSES` in `engineeringTicketWatcher.ts` and add a branch in the `ticketTerminatedRef.current` handler in `App.tsx`.
- The canonical ticket status list (no QA): `created` → `intake_acknowledged` → `needs_clarification` ↔ `implementing` → `pr_preparing` → `pr_ready` → `completed` | `failed` | `escalated_human` | `cancelled`.
- `requirements_ready` and `planning` are manual/placeholder statuses — Opey skips straight to `implementing`.
- The migration file for re-adding `needs_clarification` to the DB constraint is at `server/agent/opey-dev/migrations/add_needs_clarification_status.sql`.

---

# Lessons Learned — Orchestrator ENAMETOOLONG on Windows — 2026-03-03

## Feature
Opey failing to spawn Codex CLI with `spawn ENAMETOOLONG` on Windows.

## Root Cause
`orchestrator-openai.ts` was passing the **full assembled prompt** (`soulPrompt + lessonContext + ticketPrompt`) as the last positional CLI argument to Codex. On Windows, `CreateProcess` has a hard ~32,767 character limit for the entire command line. The combined prompt (SOUL.md + all lessons_learned/*.md + ticket details) easily exceeds this, causing Node's `spawn()` to throw `ENAMETOOLONG` before Codex even starts.

This is a **Windows-only** issue. Linux/Mac have an `ARG_MAX` of 2MB+, so the same prompt passes fine there.

The problem gets **worse over time** as lessons_learned grows — every new session appends more text, making the issue more likely to recur if the fix is ever reverted.

## Fix Applied
`server/agent/opey-dev/orchestrator-openai.ts`:
1. Added `import * as os from "node:os"`.
2. Before spawning, write `fullPrompt` to `os.tmpdir()/opey-<ticketId>.md`.
3. Pass a short **boot argument** to Codex instead of the full prompt:
   ```
   Your complete task instructions are in this file — read it before doing anything:
   <absolute temp path>
   Implement everything described in that file.
   ```
4. In the `finally` block, `fs.unlinkSync(promptFile)` cleans up the temp file regardless of success or failure.

## Gotchas
- **Failed ticket must be manually reset.** When the error occurs, `main.ts` catches the spawn error and sets `status = 'failed'`. To retry, run `UPDATE engineering_tickets SET status = 'created' WHERE id = '<id>';` in Supabase, then restart Opey.
- **Codex can read absolute paths outside its cwd.** The temp file lives in `os.tmpdir()` (e.g. `C:\Users\gates\AppData\Local\Temp\`), which is outside the worktree. Codex as an AI agent reads it without issue.
- **`promptFile` must be declared outside the try block** so the `finally` block can access it. Initialise to `null` and guard with `if (promptFile)` before unlinking.

## What Future Opey Should Know
- **Never pass large text as a CLI argument on Windows.** If you are spawning any external process with a long string (system prompt, full file contents, etc.), write it to `os.tmpdir()` first and pass the path or a short instruction referencing the path.
- If Opey fails with `spawn ENAMETOOLONG`, the fix is always the same: move the long argument into a temp file.
- Lessons learned files grow over time — the orchestrator already concatenates every `.md` in `lessons_learned/`. Keep individual files reasonably sized; split large files if they exceed ~500 lines.

---

# Lessons Learned — spawn ENAMETOOLONG & Prompt Temp-File Pattern — 2026-03-03

## Root Cause
Both orchestrators (`orchestrator.ts` and `orchestrator-openai.ts`) were passing the full assembled prompt as a command-line argument to the CLI subprocess. On Windows, `CreateProcess` has a hard ~32,767 character limit for the entire command line. The combined prompt (SOUL.md + all `lessons_learned/*.md` files concatenated + ticket details) easily exceeds this, causing Node's `spawn()` to throw `ENAMETOOLONG` before the CLI ever starts.

This problem **gets worse over time** — every new lessons file added to `lessons_learned/` grows the combined prompt and makes the error more likely to recur.

## Fix Applied to Both Orchestrators
1. Added `import * as os from "node:os"`.
2. Before spawning, write `fullPrompt` to `os.tmpdir()/opey-<ticketId>.md`.
3. Pass a short **boot arg** to the CLI instead of the full prompt:
   ```
   Your complete task instructions are in this file — read it before doing anything:
   C:\...\opey-<ticketId>.md
   Implement everything described in that file.
   ```
4. `finally` block calls `fs.unlinkSync(promptFile)` to clean up.

**`orchestrator.ts` specific:** `--append-system-prompt soulPrompt` was also removed from args because it was a second long CLI arg. The soul content now lives in the temp file alongside the ticket prompt.

## Gotchas
- **Failed ticket must be manually reset after ENAMETOOLONG.** `main.ts` catches the spawn error and sets `status = 'failed'`. To retry: `UPDATE engineering_tickets SET status = 'created' WHERE id = '<id>';` in Supabase, then restart Opey.
- **`promptFile` must be declared outside the try block** (initialised to `null`) so the `finally` block can access it.
- **Keep lessons_learned files concise.** They are concatenated on every run. A single file that grows to 500+ lines will push the temp file past what Codex comfortably processes in one shot.

## What Future Opey Should Know
- **Never pass large text as a CLI argument on Windows.** If spawning any external process with a system prompt, ticket body, or file content, write it to `os.tmpdir()` first and pass the file path (or a short instruction referencing it).
- If you hit `spawn ENAMETOOLONG`, the fix is always the same pattern: move the long arg to a temp file.
- Your task instructions live in `os.tmpdir()/opey-<ticketId>.md`. Read that file first. Do not commit it.

---

# Lessons Learned — Self-Healing Orchestrator Architecture — 2026-03-03

## Feature
When an infrastructure error (spawn failure, missing binary, OS limit) prevents Opey from launching, `main.ts` now invokes a meta-Opey instance to diagnose and patch the orchestrator, then restarts itself and retries the ticket — up to 3 times.

## Architecture

```
Infrastructure error in processNextTicket()
  → isTaskFailure check (excludes "Claude Code exited with code" and "Codex CLI exited with code")
  → attemptSelfHeal(err, store, ticketId)
      → read/write os.tmpdir()/opey-heal-count-<ticketId>.txt  (persists across restarts)
      → write os.tmpdir()/opey-self-heal-<ticketId>.md         (error + both orchestrator sources)
      → spawn meta-Claude/Codex with short boot arg
      → meta-agent reads file, patches orchestrator on disk, exits
      → reset ticket to 'created'
      → spawn(process.execPath, process.argv.slice(1), { detached: true }) + process.exit(0)
  → new Opey process starts, polls, picks up 'created' ticket, retries
```

Max 3 self-heal attempts per ticket (tracked via temp count file, not in-memory, so it survives restarts). After 3 failures the ticket is marked `failed` and the count file is cleaned up.

## Key Implementation Details
- **`isTaskFailure` check** in `main.ts` distinguishes infra errors from task errors. Only infra errors trigger self-heal. Task failures (Claude/Codex ran but produced no useful output) go straight to `failed`.
- **Both orchestrator files included** in the meta-prompt (`orchestrator.ts` + `orchestrator-openai.ts`) so the meta-agent can patch whichever one caused the error.
- **The meta-Codex boot arg is intentionally short** — it points at the self-heal temp file. This avoids the same ENAMETOOLONG problem that may have triggered self-heal in the first place.
- **Process restart uses the WhatsApp bridge pattern:** `spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' })` + `child.unref()` + `setTimeout(() => process.exit(0), 300)`.
- **`OPEY_BACKEND`** env var selects the active orchestrator (`claude` = default, `openai` = Codex). The orchestrator is no longer hardcoded.

## Gotchas
- After a successful self-heal, the `return true` in `attemptSelfHeal` causes `processNextTicket`'s catch block to `return` early — the `finally` block still runs and resets `isProcessing = false`. The 300ms `setTimeout` for `process.exit(0)` fires while the process is technically idle.
- The self-heal count file lives in `os.tmpdir()`. If the OS clears tmpdir between runs (rare but possible), the attempt counter resets — effectively giving Opey more than 3 chances. Acceptable tradeoff vs. adding a DB column.
- If the meta-agent also fails with ENAMETOOLONG on the self-heal spawn, the boot arg for self-heal is already short (it just points at the temp file path), so this should never recurse.

## What Future Opey Should Know
- You have a self-healing safety net. If you crash due to an infra error, a meta version of you will read the error and your source code, fix the bug, and restart you automatically.
- When you are the **meta-agent** (your prompt references `opey-self-heal-<ticketId>.md`): read that file, fix the bug at the absolute path shown, and exit. That is your only job. Do not implement the original ticket.
- Ticket events `self_heal_attempted` and `self_heal_succeeded` appear in the Admin Dashboard event log — use them to audit what was self-patched.
- The active backend is selected by `OPEY_BACKEND` env var. Default is `claude` (orchestrator.ts). Set to `openai` for Codex (orchestrator-openai.ts).

---

# Lessons Learned — Autonomous Policy Missing → Codex Writes Plan and Stalls — 2026-03-03

## What Happened
Ticket `de26c739` (bug: file attachment validation) was sent to Codex. Instead of implementing, Codex:
1. Read the codebase correctly
2. Wrote a plan section to `tasks/todo.md` with checkboxes marked `- [ ] Patch implementation (pending approval)`
3. Said "Please confirm the plan in `tasks/todo.md` so I can proceed with the code changes"
4. Exited

`hasCommitsAheadOfMain()` saw the `tasks/todo.md` commit → returned true → `main.ts` thought Opey had shipped → created a PR with only a todo checklist.

## Root Cause
`buildClarificationPolicy` (later renamed `buildAutonomousPolicy`) only injected "no questions" guidance for `skill`-type tickets. `bug` and `feature` tickets received **no autonomy policy at all**. Codex defaulted to its trained cautious behavior: write a plan, ask a human, wait.

The `--dangerously-bypass-approvals-and-sandbox` CLI flag controls the *tool approval* layer (file edits, shell commands). It does **not** suppress the model's own decision to pause and ask for human review. That must be handled in the prompt.

## Fix
- `buildClarificationPolicy` / `buildAutonomousPolicy` in **both** orchestrators now **always** returns the autonomous operation policy, regardless of ticket type.
- Core rules injected into every prompt:
  - Never write a plan to `tasks/todo.md` or any file and stop waiting for confirmation
  - Never pause asking for approval — implement directly, commit, exit
  - The only acceptable output is working code committed to the repository
  - If ambiguous, make a reasonable assumption, state it in the commit message, proceed
- `SOUL.md` updated: removed "push back with one precise question" from Step 0; added hard rules to the Won't list.

## What Future Opey Should Know
- **`tasks/todo.md` is a trap.** Writing to it feels productive but is stalling. Never touch it. If you feel the urge to write a checklist and ask for approval, that urge is wrong — implement and commit instead.
- **The autonomy policy is in your prompt.** Look for the `## Autonomous Operation — Non-Negotiable` section. It overrides any trained tendency to pause.
- **The only signal for "I need more information" is producing zero commits.** `main.ts` detects that and triggers the Kayley clarification pipeline. Do not try to ask for input through any other mechanism.
- **`--dangerously-bypass-approvals-and-sandbox` does not make you autonomous.** It only bypasses the CLI's file-edit confirmation prompts. Your decision to implement vs. write a plan is entirely governed by the instructions in your prompt.

---

# Lessons Learned — Google OAuth `invalid_client` — Cross-Project Credential Mismatch — 2026-03-03

## Symptom
Server logs showed repeated `[GmailPoller] Poll error (failure #N): [GoogleTokenService] Token refresh failed (401): { "error": "invalid_client", "error_description": "Unauthorized" }` even though:
- The WhatsApp bridge was up and healthy
- Re-authenticating in the browser had no effect (tried dozens of times)
- The `GOOGLE_CLIENT_SECRET` in `.env.local` appeared to match the GCP credentials page

## Root Cause
**Two completely different GCP projects were involved — Supabase Auth used one, the server used the other.**

| Layer | Client ID (project prefix) |
|---|---|
| Supabase Auth Dashboard | `187136154081-ef6v5s143...` |
| `.env.local` / server | `967289760135-gs5mklm3...` |

When the user signs in via `supabase.auth.signInWithOAuth({ provider: 'google' })`, Supabase exchanges the OAuth code using **its own stored credentials** (the ones configured in Supabase Dashboard → Auth → Providers → Google). The resulting `provider_refresh_token` is cryptographically bound to *that* client ID.

The server's `googleTokenService.ts` then reads that refresh token from `google_api_auth_tokens` and posts it to Google's token endpoint using the **`.env.local` client ID + secret** — a completely different GCP project. Google rejects it with `invalid_client` every single time, regardless of how many times the user re-authenticates.

## Why Re-Authenticating Never Fixed It
Every re-authentication generated a new refresh token issued by the Supabase-configured project (`187136154081-...`). The server kept trying to refresh it with the `.env.local` project (`967289760135-...`). The mismatch was structural — no amount of re-auth would fix it without aligning the credentials.

## Distinguishing `invalid_client` vs `invalid_grant`
- `invalid_client` — the **OAuth app credentials** (client_id / client_secret) are wrong or mismatched. The token endpoint doesn't recognise the client making the request.
- `invalid_grant` — the **refresh token itself** is bad, expired, or revoked (e.g. 7-day Testing-mode expiry, password change, manual revoke).

These require different fixes. Seeing `invalid_client` means look at credentials, not the refresh token.

## Fix
1. **Supabase Dashboard → Authentication → Providers → Google**: update Client ID and Client Secret to match `.env.local` exactly (same GCP project, same OAuth client).
2. **Re-authenticate once in the browser**: generates a new refresh token issued by the now-aligned client.
3. **Restart server**: picks up fresh token, refreshes successfully, runs 24/7.

## The 7-Day Expiry Problem (Related)
Google refresh tokens for OAuth apps in **Testing** mode expire after 7 days. This forces re-authentication every week. Fix: GCP Console → OAuth consent screen → **Publish App** (Production). Production refresh tokens do not expire unless explicitly revoked. Steven only needs to authenticate once after this change.

## What Future Opey Should Know
- **Always verify** that the Client ID in Supabase Auth settings matches `VITE_GOOGLE_CLIENT_ID` in `.env.local`. They are stored separately and drift silently.
- **Service accounts cannot access personal Gmail.** IAM roles (Owner, Editor, etc.) control GCP infrastructure access — not user-owned Google data. OAuth 2.0 with user consent is required for Gmail/Calendar on a personal account. Do not go down the service account path for this.
- **The refresh token chain**: Supabase issues it → `GoogleAuthContext` saves to `google_api_auth_tokens` → `googleTokenService` refreshes it. All three links must use the same GCP client credentials or the chain breaks.
- If `invalid_client` recurs after this fix, check whether the Supabase Dashboard credentials were accidentally changed (e.g. someone rotating secrets in GCP without updating Supabase).
