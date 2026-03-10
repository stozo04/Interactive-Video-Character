# Software Engineering Guide: Autonomous Agent SSE Pipeline

## Overview

This guide covers the SSE streaming infrastructure, autonomous agent tooling, background task management, and concurrent chat system. It is the reference for anyone modifying tool visibility, adding new tools, or changing how the web client communicates with the server.

---

## Architecture Diagram

```
┌─────────────┐     POST /agent/message/stream     ┌──────────────────┐
│  Web Client  │ ──────────────────────────────────► │  agentRoutes.ts  │
│  (App.tsx)   │ ◄─── SSE events (tool_start, etc.) │                  │
└─────────────┘                                      └────────┬─────────┘
                                                              │
                                                     Creates TurnEventBus
                                                     Wraps in withSessionLock
                                                              │
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │ messageOrchestrator  │
                                                   │                      │
                                                   │ • Passes eventBus    │
                                                   │ • Emits action_start │
                                                   │   / action_end for   │
                                                   │   selfie/video gen   │
                                                   └──────────┬───────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │ serverGeminiService  │
                                                   │                      │
                                                   │ • Threads eventBus   │
                                                   │   to createCallable  │
                                                   │   Tools() context    │
                                                   └──────────┬───────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │    toolBridge.ts     │
                                                   │                      │
                                                   │ • Emits tool_start   │
                                                   │ • Calls executeMem   │
                                                   │   oryTool()          │
                                                   │ • Emits tool_end     │
                                                   └──────────────────────┘
```

```
┌─────────────┐     POST /agent/message            ┌──────────────────┐
│  Telegram /  │ ──────────────────────────────────► │  agentRoutes.ts  │
│  WhatsApp    │ ◄─── JSON OrchestratorResult       │  (no eventBus)   │
└─────────────┘                                      └──────────────────┘
```

---

## SSE Event Types

Defined in `server/services/ai/sseTypes.ts`:

| Event | When | Payload |
|-------|------|---------|
| `turn_start` | Request received | `{ type, timestamp }` |
| `tool_start` | Before `executeMemoryTool` | `{ toolName, toolDisplayName, toolArgs, callIndex, timestamp }` |
| `tool_end` | After `executeMemoryTool` | `{ toolName, callIndex, durationMs, success, resultSummary, timestamp }` |
| `action_start` | Before media generation | `{ actionName, actionDisplayName, timestamp }` |
| `action_end` | After media generation | `{ actionName, durationMs, success, timestamp }` |
| `turn_complete` | Full result ready | `{ type, result: OrchestratorResult, timestamp }` |
| `turn_error` | Fatal error | `{ type, error, timestamp }` |

### Helper functions in sseTypes.ts

- `getToolDisplayName(toolName)` — Maps internal name to human label (e.g., `gmail_search` → `"Searching emails"`)
- `truncateResultSummary(result, maxLen)` — Truncates tool result to ~200 chars for display
- `sanitizeToolArgs(args)` — Removes sensitive fields (passwords, tokens) from tool args before sending to client

---

## Key Files Reference

### Server

| File | Purpose |
|------|---------|
| `server/services/ai/sseTypes.ts` | SSE event type definitions, display name map, sanitization |
| `server/services/ai/turnEventBus.ts` | Per-request EventEmitter with auto-incrementing callIndex |
| `server/services/ai/toolBridge.ts` | Emits tool_start/tool_end; retry count logic; classifier shadow |
| `server/services/messageOrchestrator.ts` | Emits action_start/action_end for media generation |
| `server/routes/agentRoutes.ts` | SSE route handler + `withSessionLock()` |
| `server/services/backgroundTaskManager.ts` | Background child process lifecycle |
| `server/routes/workspaceAgentRoutes.ts` | Workspace agent (file ops + command execution) |

### Client

| File | Purpose |
|------|---------|
| `src/services/agentClient.ts` | `sendMessageStream()` — fetch + ReadableStream SSE parser |
| `src/components/ToolCallBox.tsx` | Collapsible tool execution box (running/success/failed states) |
| `src/components/ChatPanel.tsx` | Renders ToolCallBox for historical + active tool calls |
| `src/App.tsx` | SSE callbacks, `pendingRequestCount`, `activeToolCalls` state |
| `src/types.ts` | `ToolCallDisplay` interface, `toolCalls?` on `ChatMessage` |

### System Prompt

| Section | File Location | Purpose |
|---------|--------------|---------|
| Section 12 | `toolsAndCapabilities.ts` | Workspace agent (updated with `command` action) |
| Section 21 | `toolsAndCapabilities.ts` | web_fetch usage guidance |
| Section 22 | `toolsAndCapabilities.ts` | Autonomous Agent Mode (investigate-plan-execute-verify) |
| Section 23 | `toolsAndCapabilities.ts` | Background task guidance (when to use, monitoring pattern) |

---

## How to Add a New Gemini Function Tool

Follow the flat pattern:

1. **Declare the tool** in `src/services/aiSchema.ts`:
   - Add a Zod schema (e.g., `MyToolSchema`)
   - Add to `MemoryToolArgs` union type
   - Add a tool declaration object to `GeminiMemoryToolDeclarations` array
   - Add to `MemoryToolDeclarationName` union

2. **Handle the tool** in `src/services/memoryService.ts`:
   - Add to `MemoryToolName` union
   - Add argument types to `ToolCallArgs` interface
   - Add `case 'my_tool':` in `executeMemoryTool()` switch

3. **Add display name** in `server/services/ai/sseTypes.ts`:
   - Add entry to `TOOL_DISPLAY_NAMES` map

4. **Add catalog entry** in `src/services/toolCatalog.ts` (optional but recommended)

5. **Add system prompt guidance** in `src/services/system_prompts/tools/toolsAndCapabilities.ts`

SSE visibility is automatic — `toolBridge.ts` emits events for ALL tools.

---

## Concurrent Chat: How withSessionLock Works

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

**Why this exists:** Gemini SDK chat sessions are stateful. You can't call `sendMessage()` while a previous call is still running (tool loop in progress). The Promise chain serializes turns per session.

**Client side:** `App.tsx` uses `pendingRequestCount` (a number, not boolean). Each `handleSendMessage` call increments on start, decrements on finish. The derived `isProcessingAction = pendingRequestCount > 0` still drives typing indicators and idle checks.

---

## Background Task Manager

`server/services/backgroundTaskManager.ts` manages long-running child processes.

### Task Lifecycle

```
startBackgroundTask()
  → spawn(command, { shell: true })
  → status: "running"
  → stdout/stderr → ring buffer (200 lines max)
  → on close: status = "completed" | "failed"
  → on error: status = "failed"
  → TTL: 1 hour after completion → auto-deleted
```

### Security

Same `BLOCKED_COMMANDS` set as workspace agent: `format`, `mkfs`, `dd`, `shutdown`, `reboot`, `halt`, `poweroff`, `passwd`, `useradd`, `userdel`, `env`, `printenv`.

Working directory is validated against workspace root — cannot escape.

### Gemini Tools

| Tool | Args | Returns |
|------|------|---------|
| `start_background_task` | `command`, `label`, `cwd?` | Task object with ID |
| `check_task_status` | `task_id` | Status + last output lines |
| `cancel_task` | `task_id` | Success boolean |

---

## Workspace Agent Command Execution

Added in Phase 2 to `workspaceAgentRoutes.ts`:

```
POST /workspace-agent/runs
{
  "action": "command",
  "args": {
    "command": "python --version",
    "cwd": "agents/kayley",    // optional, relative to workspace root
    "timeout_ms": 30000        // optional, max 60000
  }
}
```

Uses `execSync` (synchronous, blocks until complete). For commands > 10 seconds, Kayley should use `start_background_task` instead.

---

## Testing Checklist

1. **SSE basic:** `POST /agent/message/stream` with "what's on my calendar?". Verify: `turn_start` → `tool_start` → `tool_end` → `turn_complete`.
2. **Multi-tool:** "Search emails for Atmos and check calendar". Verify multiple tool boxes.
3. **Web UI:** Verify collapsible boxes with display names, durations, expand/collapse.
4. **Backward compat:** Send via Telegram. Verify identical behavior (no SSE).
5. **Error handling:** Trigger a tool failure. Verify `tool_end` shows failed state.
6. **History persistence:** Scroll up. Verify tool boxes persist on historical messages.
7. **Concurrent chat:** Send a message while previous is processing. Verify both complete.
8. **Background tasks:** "Install something in the background". Verify start → check → complete flow.
