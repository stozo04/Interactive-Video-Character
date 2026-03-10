# Lessons Learned — 2026-03-10

## Tickets / Topics Covered
- Autonomous Agent Mode (Phases 1-3)
- SSE streaming infrastructure
- Tool visibility in web UI
- Background task management
- Concurrent chat (send while processing)
- Workspace agent command execution

---

## What Was Built

### Phase 1: SSE Infrastructure + Tool Visibility

**Problem:** All tool execution was invisible — users saw bouncing dots until everything finished. No way to know what Kayley was doing.

**Solution:** Server-Sent Events streaming with per-request EventEmitter.

**Key design decision:** Instrument the existing `callTool()` in `toolBridge.ts` rather than switching to manual Gemini function calling. The SDK's `automaticFunctionCalling` already calls our `callTool()` for every tool invocation. Adding event emissions gives full visibility without rewriting the tool loop. The SDK handles retry logic, multi-tool batching, and conversation state for free.

**New files:**
- `server/services/ai/sseTypes.ts` — Event types, tool display name map, sanitization helpers
- `server/services/ai/turnEventBus.ts` — Per-request EventEmitter with auto-incrementing callIndex
- `src/components/ToolCallBox.tsx` — Collapsible UI component with running/success/failed states + live elapsed timer

**Modified files:**
- `toolBridge.ts` — Emits `tool_start`/`tool_end` around `executeMemoryTool`
- `messageOrchestrator.ts` — Emits `action_start`/`action_end` for selfie/video generation
- `agentRoutes.ts` — New `POST /agent/message/stream` SSE route
- `agentClient.ts` — New `sendMessageStream()` using `fetch` + `ReadableStream` reader
- `App.tsx` — SSE callbacks, `activeToolCalls` state, `attachToolCalls` helper
- `ChatPanel.tsx` — Renders `ToolCallBox` for historical and active tool calls
- `types.ts` — `ToolCallDisplay` interface, `toolCalls?` on `ChatMessage`

### Phase 2: Expanded Tool Set

**Decision:** Keep existing `workspace_action` and `web_search` tools — they already have approval gates, policy checks, and structured tracking. Added capabilities to them instead of creating raw replacements.

**Changes:**
- Added `command` action to `workspace_action` — executes shell commands via `execSync` in `workspaceAgentRoutes.ts`
- Added `web_fetch` tool — fetches URL, strips HTML tags, returns text content
- Minimal blocked-commands list matching Claude Code's trust model (only catastrophic: format, mkfs, dd, shutdown, passwd, etc.)
- System prompt sections 21 (web_fetch), 22 (autonomous agent mode), 23 (background tasks)

### Phase 3: Background Tasks + Concurrent Chat

**Background tasks:**
- `server/services/backgroundTaskManager.ts` — Manages child processes via `spawn`
- Ring buffer output (200 lines), 1-hour TTL cleanup, same blocked-commands list
- Three new Gemini tools: `start_background_task`, `check_task_status`, `cancel_task`

**Concurrent chat — the hard problem:**
Gemini SDK chat sessions are stateful — you can't send a new message while `sendMessage()` is still running.

**Solution:** Per-session Promise chain (`withSessionLock`) in `agentRoutes.ts`. Queued messages wait for the prior turn to finish, then execute immediately. Client-side: `pendingRequestCount` counter (not boolean) allows multiple requests in flight without blocking the UI.

---

## Gotchas & Traps

### `EventSource` only supports GET — use fetch + ReadableStream for POST SSE
The browser's `EventSource` API only works with GET requests. Since `/agent/message/stream` is POST (needs request body), `agentClient.ts` uses `fetch()` with a `ReadableStream` reader and manual SSE line parsing.

### `shell: true` type conflict with `encoding: 'utf8'` in execSync
Node.js TypeScript types have `ExecSyncOptionsWithStringEncoding` where `shell` expects a string path (not boolean) when `encoding` is specified. Fix: cast `shell: true as unknown as string`. Works fine at runtime — it's a types-only issue.

### Local CalendarEvent interface vs src/types.ts CalendarEvent
`serverGeminiService.ts` had a local `CalendarEvent` interface with `responseStatus?: string` (plain string). The `DailyLogisticsContext` in `dailyCatchupBuilder.ts` imports `CalendarEvent` from `src/types.ts` which has `responseStatus` as a string literal union (`"needsAction" | "declined" | ...`). Fix: delete the local interface, import from `src/types.ts`.

### isProcessingAction as boolean blocks concurrent sends
A boolean `isProcessingAction` state in `App.tsx` can only be true/false — it can't track multiple concurrent requests. Converting to `pendingRequestCount` (increment on start, decrement on finish) with derived `isProcessingAction = pendingRequestCount > 0` preserves all downstream consumers while enabling concurrency.

### eventBus interface must be minimal in src/ code
`ToolExecutionContext.eventBus` is typed as `{ emit(event: string, data: unknown): boolean }` — a minimal interface, not the concrete `TurnEventBus` class. This keeps `src/` code free of Node.js `EventEmitter` imports since `src/` targets the browser.

---

## Architecture Patterns Worth Remembering

### Per-request EventEmitter pattern
Create a `TurnEventBus` per HTTP request in the route handler. Thread it through the call stack as an optional parameter. Consumers check `if (context?.eventBus)` before emitting. This avoids global event bus cross-request leakage.

### Tool display name map
`sseTypes.ts` has `TOOL_DISPLAY_NAMES: Record<string, string>` mapping internal names to human-readable names. Default fallback: convert `snake_case` to `Title Case`. This is the single source of truth for UI labels.

### attachToolCalls pattern
In `App.tsx`, tool calls accumulate in a local array during the SSE stream. On `turn_complete`, the `attachToolCalls()` helper finds the first model message and attaches the array. Tool calls persist on `ChatMessage.toolCalls` so they appear when scrolling through history.

---

## What Future Sessions Should Know

1. **Phase 4 (token streaming) is not yet built.** This would use Gemini's `sendMessageStream` to stream text token-by-token interleaved with tool boxes.
2. **Edge clients (Telegram/WhatsApp) don't get tool visibility yet.** They use the non-streaming endpoint. A simplified text update system ("Searching your codebase...", "Running tests...") could be added.
3. **The `withSessionLock` approach means queued messages wait.** If Kayley's first turn takes 30 seconds (many tool calls), the second message waits 30 seconds. This is correct for Gemini SDK but could feel slow. Phase 4 may address this with persistent SSE connections.
