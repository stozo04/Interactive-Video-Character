# Opey Product Knowledge Base

This document captures deep product knowledge that doesn't belong in the user-facing READMEs but is essential context for any engineering work on this codebase. Read it at the start of every session, after `README.md` and `server/README.md`.

---

## The Product in One Paragraph

**Kayley Adams** is a fictional AI companion character — 28 years old, Austin TX, model/content creator, plays guitar, has a cat named Luna. She is NOT a generic assistant. She has personality, long-term memory, relationships, and genuine agency. Her "brain" runs on Google Gemini (server-side). She talks to Steven (VeeVee) via a React web app, Telegram, and WhatsApp. Every client is thin — all intelligence runs on the Node.js server at port 4010.

**Steven Gates** is the sole developer and user. Dallas TX, daughter Mila (~3 years old), works at Associa. He built this with AI assistance. He cares deeply about Kayley feeling *real* — not robotic, not generic. A broken tool means Kayley can't do something she promised. A memory bug is a relationship bug.

---

## Adding a New Gemini Function Tool (The Pattern)

Every new function tool requires exactly **4 touch points** — miss any one and things silently break:

1. **`src/services/aiSchema.ts`** — Add a Zod schema (`export const XxxSchema = z.object({...})`), infer the args type, add to `MemoryToolArgs` union, add to `PendingToolCall.tool` union, and add to `GeminiMemoryToolDeclarations` array.

2. **`src/services/memoryService.ts`** — Add tool name to `MemoryToolName` union, add args interface to `ToolCallArgs`, add `case 'tool_name':` handler to `executeMemoryTool()` switch.

3. **`server/services/ai/sseTypes.ts`** — Add `tool_name: 'Human readable description'` to `TOOL_DISPLAY_NAMES` so the web UI shows a meaningful label in the ToolCallBox during SSE streaming.

4. **`src/services/toolCatalog.ts`** — Add an entry to `TOOL_CATALOG` array so Kayley's tool-discovery idle action can surface it naturally.

**Optional but common:**
- **`src/services/system_prompts/tools/toolsAndCapabilities.ts`** — Add usage guidance to Kayley's cheat sheet if she needs behavioral instructions about when/how to call the tool.

**Named-contract trap:** The string `'tool_name'` must match exactly across all 4 files. TypeScript won't catch mismatches — they fail silently at runtime. Do a literal character-for-character check before committing.

**`normalizeAiResponse()` rule:** Any new field added to `aiSchema.ts`'s `AiActionResponseSchema` (the JSON response shape, not function tools) MUST also be added to `normalizeAiResponse()` in `server/services/ai/serverGeminiService.ts` or it gets silently stripped from every response. This caused multiple bugs — do not forget it.

---

## System Prompt Architecture

Kayley's system prompt is assembled in `src/services/system_prompts/builders/systemPromptBuilder.ts`.

Two build paths:
- `buildSystemPromptForGreeting()` — lean version for first-login daily greeting
- `buildSystemPromptForNonGreeting()` — full version with memory, tasks, context synthesis, etc.

The tool cheat sheet lives in `src/services/system_prompts/tools/toolsAndCapabilities.ts`. It is a numbered list of rules/sections injected verbatim into every prompt. Key section numbers:
- **Section 4** — Tool selector rules (which tool to use when)
- **Section 14** — Google Workspace (gogcli) command cheat sheet
- **Section 18** — `query_database` tool (Kayley can query `server_runtime_logs`)
- **Section 19** — Self-healing protocol (Kayley can restart the server via restart trigger)
- **Section 20** — Voice note policy (`send_as_voice` field)
- **Section 21** — `web_fetch` tool
- **Section 22** — Autonomous agent mode
- **Section 23** — Background tasks

When adding new tool instructions, append a new numbered section. Never renumber existing sections — they are referenced in lessons learned and bug reports.

---

## Background Services Startup Order (`server/index.ts`)

Services start in this order after the HTTP server is listening:
1. Cron scheduler (`startCronScheduler`)
2. Calendar heartbeat (`startCalendarHeartbeat`) — 15-min loop, 8am–7pm CST
3. X mention heartbeat (`startXMentionHeartbeat`) — 5-min loop
4. Kayley Pulse Dashboard (`startKayleyPulseDashboard`) — 10-min loop, 15s initial delay

All return `{ stop: () => void }` handles that are called in the `shutdown()` function. When adding a new background service, always wire both start and stop.

---

## Key Supabase Tables

| Table | Purpose | Notes |
|-------|---------|-------|
| `conversation_history` | Every AI turn (user + model rows) | Has `request_id`, token columns on model rows |
| `server_runtime_logs` | All logs from server + client | Primary debugging tool — query this first |
| `user_facts` | Persistent facts about Steven | 185 rows (pruned 2026-03-08). Never store credentials here. |
| `character_facts` | Kayley's invented facts about herself | 59 rows (pruned 2026-03-08) |
| `fact_embeddings` | Vector embeddings for semantic fact lookup | Multi-row per fact (source_type + source_id + model + version) |
| `user_patterns` | Behavioral observations about Steven | Written by `store_character_info` via `recordObservation()` |
| `engineering_tickets` | Opey's work queue | Statuses: created → implementing → completed / failed / needs_clarification |
| `engineering_ticket_events` | Event log per ticket | Insert-only audit trail |
| `engineering_agent_turns` | Each agent turn for a ticket | For Opey UI display |
| `kayley_email_actions` | Email action state machine | Dedup key: `gmail_message_id` |
| `cron_jobs` | Scheduled job definitions | Opey/Tidy schedules live here |
| `x_mentions` | X (Twitter) mention records | Delivery queue fields: `telegram_sent_at`, `whatsapp_sent_at`, etc. |

**Supabase conventions:**
- All PKs: `uuid_generate_v4()`
- All timestamps: `timestamptz`
- Every mutable table has `created_at` + `updated_at` + `update_updated_at_column` trigger
- Use `CHECK` constraints for enums rather than Postgres `ENUM` types
- Migrations live in `supabase/migrations/` — name them `YYYYMMDD_description.sql`
- Never write DDL directly to Supabase. Always write a migration file and commit it.

---

## Memory Tool Naming Convention

Three memory write tools exist — they are NOT interchangeable:

| Tool | Stores To | Used For |
|------|-----------|---------|
| `store_user_info` | `user_facts` | New facts Kayley learns about Steven |
| `store_self_info` | `character_facts` | Facts Kayley invents about herself (opinions, memories) |
| `store_character_info` | `user_patterns` | Behavioral observations/patterns about Steven |

`store_character_info` calls `recordObservation()` in `src/services/userPatterns.ts` — NOT a direct DB write. Do not confuse with `user_facts`.

The shadow memory classifier (`server/services/memoryClassifier.ts`) fires after every successful write from any of these three tools. It logs to `server_runtime_logs` (source: `memoryClassifier`) but does not alter the write — Stage 1 shadow mode only.

---

## Dual-Provider Image Rule (Critical)

Any change to image reference selection or content loading **must be applied to BOTH Gemini and Grok paths**. They share `referenceSelector.ts` but have separate functions:

- `selectReferenceImageForGemini` / `selectReferenceImageForGrok`
- `getReferenceImageContentForGemini` / `getReferenceImageContentForGrok` (sync, Vite, browser-only)
- `fetchReferenceImageContentForGemini` / `fetchReferenceImageContentForGrok` (async, Node-safe fallbacks)

`import.meta.glob` (Vite) does NOT work server-side. The sync functions return null on the server. Always use the async `fetch*` fallbacks for server paths (Telegram selfies, etc.).

Key files: `src/utils/referenceImages/index.ts`, `src/services/imageGeneration/referenceSelector.ts`, `src/services/imageGenerationService.ts`.

---

## Logging Rules

**`server/**` code** → use `server/runtimeLogger.ts` (or the newer `lib/logger.ts`). Writes to `server_runtime_logs` Supabase table.

**`src/**` code** → use `src/services/clientLogger.ts`. Also writes to `server_runtime_logs`.

**Never use bare `console.log()`** in production code. It only shows in the terminal/DevTools and disappears. Logs must be queryable.

Always include a `source` field in log details so logs are traceable to the file. The logger auto-promotes `source`, `ticketId`, `agentName`, `runId`, `requestId` into indexed columns.

---

## ESM Gotcha — No `__dirname`

All `.ts` files in this repo are ESM. `__dirname` is undefined. Always use:

```typescript
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

This applies to any new file that needs to resolve sibling files, data files, or script paths.

---

## tsx Watch — Restart Trigger Pattern

The server runs under `tsx watch`. To restart programmatically (e.g. Kayley's self-heal), touch a trigger file:

- Server: `server/restartTrigger.ts`
- Telegram: `server/telegram/restartTrigger.ts`

Both files are imported by their respective entry points and kept in the tsx watch dependency graph. Touching them (any write) triggers a hot restart. Do NOT call `process.exit()` directly — it kills in-flight requests with no cleanup.

**tsx `--ignore` flag order matters:** `--ignore` flags MUST come before `--import ./server/envShim.ts` in the package.json script or Node crashes on startup.

---

## SSE Streaming Pattern

Web client uses `POST /agent/message/stream` (SSE) instead of `POST /agent/message`. The `TurnEventBus` (per-request EventEmitter) threads through:

```
agentRoutes.ts → messageOrchestrator.ts → serverGeminiService.ts → toolBridge.ts
```

`toolBridge.ts` emits `tool_start`/`tool_end` around every `executeMemoryTool` call. The `ToolCallBox` component in `src/components/ToolCallBox.tsx` renders these as collapsible boxes with live elapsed timers.

Telegram and WhatsApp use `POST /agent/message` (no eventBus) — zero behavior change.

**Tool retry loop:** `toolBridge.ts` has a `failureCount` closure. Failures 1–2 tell Kayley how many attempts remain and nudge her to try differently. Failure 3 = hard stop, report to Steven.

---

## Idle Thinking Service

`src/services/idleThinkingService.ts` runs every ~15 minutes when Steven hasn't messaged Kayley. It picks from 6 action types:

- Send a spontaneous message
- Generate a selfie
- Run context synthesis
- Store a character fact
- Browse the web
- Propose a new tool capability

Daily caps are tracked in `idle_action_log` via the `canRunAction` / `recordActionRun` pattern.

---

## Context Synthesis (Phase 1 Complete, Phase 1b Next)

Instead of dumping all raw memory into every system prompt (~4000+ tokens), the system uses a three-layer architecture:

1. Static shell (always included)
2. Daily synthesis document (generated once/day, cached)
3. Topic exhaustion tracker (prevents re-raising known subjects)

Key files: `server/services/contextSynthesisService.ts`, `server/services/topicExhaustionService.ts`.

Status: Code complete, migrations not yet run in production. Phase 1b (conversation working memory anchor) is next — see `docs/context_synthesis_thoughts.md`.

---

## Gmail Search — Time Unit Gotcha

Gmail search only supports `d` (days), `m` (months), `y` (years) in time filters. `newer_than:2m` means **2 months**, NOT 2 minutes. There is no hours/minutes unit. Using `newer_than:1d` is the finest practical granularity. This caused a flood of old emails on 2026-03-07 after a DB gap — do not repeat.

---

## Calendar Events — On-Demand Only

Calendar events are **not** injected into the system prompt. Kayley calls `calendar_action` with `action='list'` on demand when she needs to check the calendar. The `calendarHeartbeat.ts` service checks for *upcoming events in the next ~20 minutes* and *recently ended events* to generate proactive messages — but this is server-side push, not system prompt injection.

---

## WhatsApp Specifics

WhatsApp runs as a completely separate process (port 4011). It has its own health endpoint and its own `xMentionBridge.ts` consumer. The WhatsApp socket lives in the WhatsApp process — the main server cannot send WhatsApp messages directly. Instead it queues announcements in Supabase (`x_mentions` table with `whatsapp_sent_at` field) and the WhatsApp process polls and delivers.

Restart mechanic: The main server can signal the WhatsApp bridge to restart via a detached-spawn pattern (same as Opey process management).

---

## Opey Worktree Architecture

Opey works in `.worktrees/<ticketId>` — a real git worktree, not just a branch. His CWD is the worktree directory. `../../..` is the main repo root but he should never need to touch it. The tsx watch ignore list includes `.worktrees/**`, so Opey's file writes cannot trigger server restarts.

After the PR is created (success or fail), the worktree is cleaned up. Vitest excludes `.worktrees/**` from test discovery.

**Branch naming:** `opey-dev/<ticketId>` — always branched from `main`, never from HEAD.

---

## Hard Rules (Never Violate)

1. **Never store credentials, passwords, tokens, or API keys in `user_facts` or `character_facts`.** They are user-visible memory. This happened once (2026-03-08) — it was deleted immediately.
2. **Never use `import.meta.glob` in server-side code.** It's Vite-only. Use async file reads or `fetch` instead.
3. **Never use bare `console.log()` in production code.** Use the appropriate logger.
4. **Never delete rows from Supabase tables.** The Opey DB permission model forbids DELETE. If you need to remove data, mark it as archived/inactive or write a note in the ticket.
5. **Never add dependencies without justification.** Every package is a maintenance liability. Prefer native Node.js capabilities.
6. **Never touch unrelated code while fixing a bug.** Scope discipline is non-negotiable. One gap, one fix.
7. **Any new field in `aiSchema.ts`'s `AiActionResponseSchema` must also be added to `normalizeAiResponse()` in `serverGeminiService.ts`.**
8. **Image generation changes must be applied to BOTH Gemini and Grok paths.** No exceptions.
