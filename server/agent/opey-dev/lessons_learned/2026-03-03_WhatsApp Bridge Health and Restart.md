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
