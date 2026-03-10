# Plan: Kayley Autonomous Agent Mode

## Context

Today, Kayley's tools are limited (memory lookups, email, calendar, database queries) and all work is invisible — the user sees bouncing dots until everything finishes. The goal is to transform Kayley into a **fully autonomous agent** that can:

- Run shell commands, read/write any file, search the codebase
- Research the web (search + fetch pages)
- Chain tools toward a goal (investigate → plan → execute → verify)
- Run long-running tasks in the background
- Chat with the user while working
- Show all tool execution as collapsible boxes in the web UI (like Claude Code / OpenClaw)

**Example flow (from real Claude Code session):** Kayley checks Python version → checks GPU → creates venv → installs PyTorch (background) → discovers Python version incompatibility → kills download → recreates venv with correct Python → reinstalls → smoke tests → fixes path issue → verifies end-to-end. User chats freely throughout ("updates?", "where is it downloading to?", "yay!!!").

**Edge clients** (Telegram/WhatsApp): Get simplified text updates, not raw tool output.

---

## Phasing

### Phase 1: SSE Infrastructure + Tool Visibility (COMPLETE)
- SSE streaming endpoint for web client
- Tool execution boxes in the UI (collapsible, showing existing tool calls)
- Keep existing POST endpoint for Telegram/WhatsApp unchanged

### Phase 2: Expanded Tool Set (COMPLETE)
- Added `command` action to workspace_action (shell execution via execSync)
- Added `web_fetch` tool (fetch URL → strip HTML → return text)
- Minimal blocked-commands list (same trust as Claude Code)
- System prompt sections 21 (web_fetch), 22 (autonomous agent mode), 23 (background tasks)

### Phase 3: Background Tasks + Concurrent Chat (COMPLETE)
- Background task management (start_background_task, check_task_status, cancel_task)
- User can send messages while Kayley is working (pendingRequestCount counter)
- Server serializes Gemini SDK turns via withSessionLock() Promise chains

### Phase 4: Token Streaming + Full Polish (NOT STARTED)
- Stream text token-by-token (Gemini `sendMessageStream`)
- Text interleaved with tool boxes in real-time
- Edge client simplified updates ("Searching your codebase...", "Running tests...")

---

## Phase 1 Implementation (Detailed)

### Step 1: SSE Event Types (`server/services/ai/sseTypes.ts` — NEW)

```typescript
type SSEEventType =
  | 'turn_start'      // Turn has begun
  | 'tool_start'      // Tool about to execute
  | 'tool_end'        // Tool finished (success/fail)
  | 'action_start'    // Post-AI action (selfie gen, video gen)
  | 'action_end'      // Post-AI action finished
  | 'turn_complete'   // Full OrchestratorResult ready
  | 'turn_error';     // Fatal error

interface SSEToolStartEvent {
  type: 'tool_start';
  toolName: string;           // internal name: "gmail_search"
  toolDisplayName: string;    // human name: "Searching emails"
  toolArgs: Record<string, unknown>;  // sanitized args
  callIndex: number;          // 0-based within this turn
  timestamp: number;
}

interface SSEToolEndEvent {
  type: 'tool_end';
  toolName: string;
  callIndex: number;
  durationMs: number;
  success: boolean;
  resultSummary: string;      // truncated ~200 chars
  timestamp: number;
}
```

**Tool display name map:** `recall_memory` → "Searching memories", `gmail_search` → "Searching emails", `calendar_action` → "Checking calendar", `store_user_info` → "Saving info about you", `query_database` → "Querying database", `read_agent_file` → "Reading file", `write_agent_file` → "Writing file", etc.

### Step 2: TurnEventBus (`server/services/ai/turnEventBus.ts` — NEW)

Per-request EventEmitter. Created in the route handler, threaded to tool bridge. Not global — avoids cross-request leakage.

```typescript
import { EventEmitter } from 'node:events';

export class TurnEventBus extends EventEmitter {
  private _callIndex = 0;
  nextCallIndex(): number { return this._callIndex++; }
}
```

### Step 3: Add `eventBus` to ToolExecutionContext

**File:** `src/services/memoryService.ts` (~line 1380)

Add optional field using a minimal interface (not the concrete class) so `src/` code doesn't need Node.js imports:

```typescript
export interface ToolExecutionContext {
  currentEvents?: Array<{ id: string; summary: string }>;
  userMessage?: string;
  conversationScopeId?: string;
  eventBus?: { emit(event: string, data: unknown): boolean };
}
```

### Step 4: Instrument `toolBridge.ts` with event emissions

**File:** `server/services/ai/toolBridge.ts`

In `callTool()`, wrap the existing `executeMemoryTool` call:

- **Before** `executeMemoryTool`: emit `tool_start` with tool name, sanitized args, callIndex from bus
- **After success**: emit `tool_end` with success=true, duration, truncated result string
- **After failure**: emit `tool_end` with success=false, duration, error message

~10 lines of event emission around the existing try/catch. All existing logic (logging, classifier shadow, retry count) stays untouched.

### Step 5: Thread eventBus through the call stack

**Files:**
- `src/handlers/messageActions/types.ts` — add optional `eventBus?` to `OrchestratorInput`
- `server/services/ai/serverGeminiService.ts` — pull eventBus from options, pass to `createCallableTools({ ..., eventBus })`
- `server/services/messageOrchestrator.ts` — emit `action_start`/`action_end` for selfie/video/gif generation (these are long ops)

All optional fields. Telegram/WhatsApp never pass an eventBus → zero behavior change.

### Step 6: SSE route (`server/routes/agentRoutes.ts` — MODIFY)

Add `POST /agent/message/stream` alongside existing `POST /agent/message`:

1. Parse body (same validation as existing handler)
2. Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
3. Create `TurnEventBus` instance
4. Wire bus events → `res.write()` in SSE format: `data: ${JSON.stringify(event)}\n\n`
5. Emit `turn_start`
6. Call `processUserMessage({ ..., eventBus })` — same orchestrator
7. On completion: emit `turn_complete` with full `OrchestratorResult`, then `res.end()`
8. On error: emit `turn_error`, then `res.end()`

Existing `POST /agent/message` stays unchanged forever (Telegram/WhatsApp use it).

### Step 7: Client streaming (`src/services/agentClient.ts` — MODIFY)

New `sendMessageStream()` method using `fetch` + `ReadableStream` reader (not `EventSource` which only supports GET):

```typescript
interface StreamCallbacks {
  onToolStart?: (event: SSEToolStartEvent) => void;
  onToolEnd?: (event: SSEToolEndEvent) => void;
  onActionStart?: (event: SSEActionStartEvent) => void;
  onActionEnd?: (event: SSEActionEndEvent) => void;
  onComplete: (result: OrchestratorResult) => void;
  onError: (error: string) => void;
}

async function sendMessageStream(
  request: AgentMessageRequest,
  callbacks: StreamCallbacks
): Promise<void>
```

Falls back to regular `sendMessage()` on connection failure.

### Step 8: UI types (`src/types.ts` — MODIFY)

```typescript
interface ToolCallDisplay {
  callIndex: number;
  toolName: string;
  toolDisplayName: string;
  status: 'running' | 'success' | 'failed';
  durationMs?: number;
  resultSummary?: string;
  startedAt: number;
}

interface ChatMessage {
  // ... existing fields ...
  toolCalls?: ToolCallDisplay[];  // tool executions that preceded this response
}
```

### Step 9: ToolCallBox component (`src/components/ToolCallBox.tsx` — NEW)

Collapsible box rendered inline in chat. Visual states:

- **Running:** Pulsing dot animation, tool display name, live elapsed timer
- **Success:** Green check, tool display name, duration badge, expand/collapse toggle
- **Failed:** Red X, tool display name, duration, error summary, expand toggle

Collapsed (default): `[✓] Searched emails for "atmos energy"  342ms  [▾]`
Expanded: Shows tool name, sanitized args, result summary

Styled as dark grey boxes matching the chat panel aesthetic.

### Step 10: Wire into ChatPanel + App.tsx

**`App.tsx`:**
- New state: `activeToolCalls: ToolCallDisplay[]`
- Switch to `agentClient.sendMessageStream()`
- `onToolStart`: append to activeToolCalls with status 'running'
- `onToolEnd`: update matching entry to 'success'/'failed'
- `onComplete`: attach accumulated toolCalls to model's ChatMessage, clear active state

**`ChatPanel.tsx`:**
- Render `ToolCallBox` components for each `msg.toolCalls` entry above message text
- During active processing: show running tool boxes above the typing indicator

---

## Phase 2 Implementation (New Tools — Next PR)

### New Gemini Function Tools

| Tool | Purpose | Security |
|------|---------|----------|
| `exec_command` | Run shell commands (bash/PowerShell) | Allowlisted commands OR user approval for unknown. No `rm -rf /`, no `format`, no credential exfil. |
| `read_file` | Read any file in the project directory | Scoped to project root. Can read .env (Kayley needs this for self-diagnosis). Log all reads. |
| `write_file` | Write/create files in project directory | Scoped to project root. Cannot write outside. Log all writes. |
| `search_codebase` | Grep/glob across codebase | Read-only. Returns matching files/lines with context. |
| `web_search` | Search the internet | Read-only. Returns search result snippets. |
| `web_fetch` | Fetch and read a web page | Read-only. Returns page content as markdown. URL allowlisting optional. |

### Implementation pattern (same as existing tools)

Each tool follows the flat pattern from MEMORY.md:
1. Add declaration to `GeminiMemoryToolDeclarations` in `aiSchema.ts`
2. Add to `MemoryToolName` union + `ToolCallArgs` in `memoryService.ts`
3. Add `case` in `executeMemoryTool()` switch

### Security model

**Project-scoped:** File read/write operations scoped to the project root directory. No upward traversal (`../../../etc/passwd`).

**Command execution:** Two tiers:
- **Auto-approved:** Read-only commands (ls, cat, grep, find, python --version, nvidia-smi, pip list, git status, git log, node --version, npm list)
- **Requires confirmation:** Write commands, installs, process management. Confirmation via a new SSE event `approval_required` → UI shows approval dialog → user approves/denies → server continues.

**Logging:** Every tool execution logged to `server_runtime_logs` with full args and result.

### System prompt additions

New section in `toolsAndCapabilities.ts` teaching Kayley:
- When to use codebase tools (debugging, investigating issues, setting up features)
- How to chain tools (check system → plan → execute → verify)
- How to narrate progress for the user
- When to ask for approval vs. proceed autonomously
- Background task patterns (kick off long process → check status → report)

---

## Phase 3 Implementation (Background Tasks + Concurrent Chat — Future PR)

### Background task system

New server-side task manager:
- `startBackgroundTask(command, label)` → returns taskId
- `checkTaskStatus(taskId)` → running/completed/failed + output tail
- `cancelTask(taskId)` → kills process
- Tasks persist output to temp files, Kayley can read them

New Gemini function tools: `start_background_task`, `check_task_status`, `cancel_task`

### Concurrent conversation

The hard problem: Gemini SDK chat sessions are stateful — you can't send a new message while a previous `sendMessage()` is still running (tool loop in progress).

**Approach:** Queue user messages. When a turn completes and there are queued messages, start the next turn immediately with the queued message. The SSE stream stays open across turns.

Alternative: Separate "quick chat" from "work mode" — quick messages go through a lightweight Gemini call (no tools), while the autonomous work continues in the background.

---

## Files Summary (Phase 1 only)

| File | Change |
|------|--------|
| `server/services/ai/sseTypes.ts` | **NEW** — SSE event type definitions + tool display name map |
| `server/services/ai/turnEventBus.ts` | **NEW** — Per-turn EventEmitter |
| `src/services/memoryService.ts` | **MODIFY** — Add `eventBus?` to `ToolExecutionContext` |
| `server/services/ai/toolBridge.ts` | **MODIFY** — Emit tool_start/tool_end events in callTool() |
| `src/handlers/messageActions/types.ts` | **MODIFY** — Add `eventBus?` to `OrchestratorInput` |
| `server/services/ai/serverGeminiService.ts` | **MODIFY** — Thread eventBus to tool bridge |
| `server/services/messageOrchestrator.ts` | **MODIFY** — Emit action_start/action_end for media generation |
| `server/routes/agentRoutes.ts` | **MODIFY** — Add `POST /agent/message/stream` SSE route |
| `src/services/agentClient.ts` | **MODIFY** — Add `sendMessageStream()` method |
| `src/types.ts` | **MODIFY** — Add `ToolCallDisplay`, extend `ChatMessage` |
| `src/components/ToolCallBox.tsx` | **NEW** — Collapsible tool execution box component |
| `src/components/ChatPanel.tsx` | **MODIFY** — Render ToolCallBox inline with messages |
| `src/App.tsx` | **MODIFY** — Wire streaming callbacks + tool call state |

---

## Key Architecture Decision

**Why NOT switch to manual Gemini function calling:** The SDK's `automaticFunctionCalling` already calls our `callTool()` for every tool invocation. Instrumenting `callTool()` with event emissions gives us full visibility without rewriting the tool loop. The SDK handles retry logic, multi-tool batching, and conversation state for free.

---

## Verification (Phase 1)

1. **SSE test:** POST to `/agent/message/stream` with "what's on my calendar tomorrow?". Verify events: `turn_start` → `tool_start` (calendar_action) → `tool_end` → `turn_complete`.
2. **Multi-tool test:** "Search my emails for the Atmos bill and check my calendar". Verify multiple tool boxes appear in sequence.
3. **Web UI test:** Same messages in browser. Verify collapsible tool boxes appear with display names, durations, expand/collapse.
4. **Backward compat:** Send message via Telegram. Verify identical behavior (no eventBus, no streaming).
5. **Error test:** Trigger a tool failure. Verify `tool_end` shows failed state with error summary.
6. **History test:** Scroll up in chat. Verify tool boxes persist on historical messages (attached to ChatMessage).
