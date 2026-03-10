# Autonomous Agent Mode — Feature Documentation

## What Changed

Kayley evolved from a chatbot that runs invisible tool calls behind bouncing dots into a fully autonomous agent with real-time tool visibility, shell command execution, web research, background task management, and concurrent chat. The web UI now shows exactly what Kayley is doing as she does it, just like Claude Code.

---

## The Problem (Before)

- **Invisible work:** User sends a message, sees bouncing dots for 5-30 seconds, gets a response. No idea what happened in between.
- **Limited tools:** Kayley could search emails, manage calendar, read/write memory — but couldn't run commands, read project files, fetch web pages, or manage processes.
- **Blocking UI:** While Kayley was processing, the user couldn't type or send another message.
- **No background work:** Long-running operations (installs, builds) would block the entire conversation.

## The Solution (After)

- **Real-time tool visibility:** Every tool call appears as a collapsible box in the chat — showing what's running, what succeeded/failed, and how long it took.
- **Autonomous agent capabilities:** Shell commands, file read/write, codebase search, web search + fetch, background task management.
- **Concurrent chat:** Users can send messages while Kayley is still working on the previous request.
- **Background tasks:** Long-running commands run in the background. Kayley monitors and reports progress.

---

## Implementation — Phase by Phase

### Phase 1: SSE Infrastructure + Tool Visibility

**Goal:** Make tool execution visible in the web UI.

**Approach:** Instead of switching away from Gemini SDK's `automaticFunctionCalling` (which would require rewriting the entire tool loop), we instrumented the existing `callTool()` function in `toolBridge.ts` with event emissions. The SDK continues to handle retry logic, multi-tool batching, and conversation state automatically.

**The TurnEventBus pattern:**
A per-request `EventEmitter` is created in the route handler and threaded through the entire call stack as an optional parameter. This avoids global state and cross-request event leakage.

```
agentRoutes.ts (creates TurnEventBus)
  → messageOrchestrator.ts (passes to AI service, emits action events)
    → serverGeminiService.ts (passes to createCallableTools context)
      → toolBridge.ts (emits tool_start/tool_end around every tool call)
```

**SSE streaming endpoint:** `POST /agent/message/stream` returns events as they happen:
```
data: {"type":"turn_start","timestamp":1710100000000}

data: {"type":"tool_start","toolName":"calendar_action","toolDisplayName":"Checking calendar","callIndex":0,"timestamp":1710100000100}

data: {"type":"tool_end","toolName":"calendar_action","callIndex":0,"durationMs":342,"success":true,"resultSummary":"Found 3 events...","timestamp":1710100000442}

data: {"type":"turn_complete","result":{...OrchestratorResult...},"timestamp":1710100001000}
```

**Client-side streaming:** `agentClient.ts` uses `fetch()` + `ReadableStream` reader (not `EventSource`, which only supports GET). Falls back to regular `sendMessage()` on connection failure.

**ToolCallBox component:** Collapsible box with three visual states:
- **Running:** Pulsing dot + display name + live elapsed timer (100ms interval)
- **Success:** Green check + display name + duration badge + expand/collapse
- **Failed:** Red X + display name + duration + error summary

Tool calls attach to `ChatMessage.toolCalls` so they persist in chat history.

**Backward compatibility:** Telegram and WhatsApp use `POST /agent/message` (no eventBus passed) — zero behavior change.

### Phase 2: Expanded Tool Set

**Design decision:** Keep existing `workspace_action` and `web_search` tools rather than creating raw replacements. They already have approval gates, policy checks, and structured run tracking. Added `command` action to `workspace_action` and created a new `web_fetch` tool.

**Command execution via workspace_action:**
```json
{
  "action": "command",
  "args": {
    "command": "python --version",
    "cwd": "agents/kayley",
    "timeout_ms": 30000
  }
}
```

Uses `execSync` in `workspaceAgentRoutes.ts`. Blocked commands: only truly catastrophic system-level operations (format, mkfs, dd, shutdown, reboot, halt, poweroff, passwd, useradd, userdel, env, printenv). Kayley has the same trust level as Claude Code — she can use rm, mkdir, mv, git, npm, pip, etc.

**web_fetch tool:** Fetches a URL, strips HTML tags, returns plain text. Used for reading articles, documentation, API responses.

**System prompt updates:** Three new sections in `toolsAndCapabilities.ts`:
- **Section 21 (web_fetch):** When and how to use web page fetching
- **Section 22 (Autonomous Agent Mode):** The investigate-plan-execute-verify pattern, tool chaining examples, progress narration, when NOT to go autonomous
- **Section 23 (Background Tasks):** When to use background vs synchronous commands, monitoring pattern, cancellation

### Phase 3: Background Tasks + Concurrent Chat

**Background task manager** (`server/services/backgroundTaskManager.ts`):
- Manages child processes via `child_process.spawn`
- Ring buffer output (200 lines max) — captures stdout and stderr
- 1-hour TTL after completion, 5-minute cleanup interval
- Same blocked-commands security as workspace agent
- Three new Gemini tools: `start_background_task`, `check_task_status`, `cancel_task`

**Concurrent chat — the hard problem:**
Gemini SDK chat sessions are stateful. You can't call `chat.sendMessage()` while a previous call is still in its tool loop. Two approaches were considered:

1. **Separate "quick chat" from "work mode"** — Quick messages go through a lightweight Gemini call (no tools), while autonomous work continues in background. **Rejected** — user wanted all messages through the same call.

2. **Per-session Promise chain** — Queue messages server-side. When a turn completes and there are queued messages, start the next turn immediately. **Chosen approach.**

```typescript
// agentRoutes.ts
const sessionTurnChains = new Map<string, Promise<void>>();

function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionTurnChains.get(sessionId) ?? Promise.resolve();
  const current = prev.then(fn, fn);
  sessionTurnChains.set(sessionId, current.then(() => {}, () => {}));
  return current;
}
```

**Client-side concurrency:**
`App.tsx` replaced `isProcessingAction` (boolean) with `pendingRequestCount` (number). Each `handleSendMessage` increments on start, decrements on finish. Derived `isProcessingAction = pendingRequestCount > 0` preserves all downstream consumers (useCharacterActions, idle checks, ChatPanel typing indicator).

`ChatPanel.tsx` removed `isSending` guards from textarea, handleSubmit, canSend, and onKeyDown — users can type and send freely while previous requests are in flight.

---

## Files Changed (Complete List)

### New Files
| File | Purpose |
|------|---------|
| `server/services/ai/sseTypes.ts` | SSE event types, display name map, sanitization helpers |
| `server/services/ai/turnEventBus.ts` | Per-request EventEmitter with auto-incrementing callIndex |
| `src/components/ToolCallBox.tsx` | Collapsible tool execution box UI component |
| `server/services/backgroundTaskManager.ts` | Background child process lifecycle manager |

### Modified Files
| File | Changes |
|------|---------|
| `server/services/ai/toolBridge.ts` | Emits `tool_start`/`tool_end` SSE events |
| `server/services/ai/serverGeminiService.ts` | Threads eventBus to tool bridge context |
| `server/services/messageOrchestrator.ts` | Emits `action_start`/`action_end` for media gen |
| `server/routes/agentRoutes.ts` | SSE route + `withSessionLock()` |
| `server/routes/workspaceAgentRoutes.ts` | Added `command` action with execSync |
| `src/services/agentClient.ts` | Added `sendMessageStream()` |
| `src/services/aiSchema.ts` | web_fetch, workspace command, 3 background task tools |
| `src/services/memoryService.ts` | eventBus on context, web_fetch + background task handlers |
| `src/services/toolCatalog.ts` | web_fetch + background task catalog entries |
| `src/types.ts` | `ToolCallDisplay`, `toolCalls?` on `ChatMessage` |
| `src/components/ChatPanel.tsx` | Renders ToolCallBox, allows input while processing |
| `src/App.tsx` | `pendingRequestCount`, SSE callbacks, `activeToolCalls` |
| `src/handlers/messageActions/types.ts` | `eventBus?` on `OrchestratorInput` |
| `src/services/aiService.ts` | `eventBus?` on `AIChatOptions` |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Sections 21-23 |

---

## Security Model

**Command execution (workspace_action + background tasks):**
- Minimal blocked-commands list: `format`, `mkfs`, `dd`, `shutdown`, `reboot`, `halt`, `poweroff`, `passwd`, `useradd`, `userdel`, `env`, `printenv`
- Working directory validated against workspace root — cannot escape
- All tool calls logged to `server_runtime_logs` with full args and results
- Background tasks have 60-second timeout for synchronous commands, no limit for background

**File operations (workspace_action read/write/search):**
- Scoped to workspace root — path traversal blocked
- All reads and writes logged

**Web operations:**
- `web_search` — read-only, returns search result snippets
- `web_fetch` — read-only, returns page content as text

---

## What's NOT Built Yet (Phase 4)

- **Token streaming:** Gemini's `sendMessageStream` to stream text token-by-token interleaved with tool boxes
- **Edge client updates:** Simplified text updates for Telegram/WhatsApp ("Searching your codebase...", "Running tests...")
- **Approval gates:** UI dialog for destructive operations (currently all non-blocked commands auto-execute)
- **Persistent SSE connections:** Currently one SSE connection per message; a persistent connection would enable server-initiated events
