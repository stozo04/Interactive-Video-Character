# OpenClaw Pi Engine Integration Design (No-Code Guide)

## Purpose
This document explains how to integrate OpenClaw's Pi engine capabilities into the current Kayley Adams codebase. It is a no-code technical guide for an intern and focuses on architecture choices, data contracts, and where integration points live in this repo.

## Audience
- Interns or new contributors who need a clear map of how Pi fits into the existing system
- Engineers evaluating integration approach (in-process library vs IPC)

## What Is The Pi Engine (In This Context)
Treat the Pi engine as a deterministic decision and execution layer that can:
- Accept structured data (conversation, context, tool catalog)
- Decide what to do (plan, tool calls, response formatting)
- Maintain internal state (session memory, long-running workflows)
- Expose extensions (connectors and tools)

The rest of this document maps these four primitives into the Kayley architecture.

---

## Architectural Options
There are two viable integration modes. You must pick one. You can also start with IPC and later move in-process if latency becomes critical.

### Option A: In-Process Dynamic Library
**What it is**
- Pi engine is delivered as a dynamic library (e.g., `pi_engine.dll` on Windows, `.so` on Linux).
- The Node.js server loads it directly (FFI / native addon). Calls are function invocations, not network requests.

**Why you might choose it**
- Lowest latency and no network hops
- No separate process to manage

**Risks / tradeoffs**
- Crash risk: a bug in the native library can crash the whole Node server.
- Deployment complexity: native binaries per OS/architecture.
- Harder to instrument and restart safely.

**When it is a good fit**
- You already have a stable, well-tested native Pi library.
- Latency is a hard requirement (sub-10ms).

### Option B: Inter-Process Communication (IPC)
**What it is**
- Pi engine runs as a separate process (sidecar) and communicates over HTTP, gRPC, WebSocket, or stdio.
- The Node server treats it like a local service.

**Why you might choose it**
- Isolation: crashes in Pi don't bring down the main server.
- Easier to deploy and version independently.
- Works well with the existing tool orchestration model.

**Risks / tradeoffs**
- Slightly higher latency.
- Requires a process manager (start/stop/health checks).

**When it is a good fit**
- You want safe iteration and fast debugging.
- You need easier instrumentation and clear logs.

### Recommendation For This Repo
Start with **IPC**. The Kayley system already has multiple processes (server, Telegram, WhatsApp) and existing health checks. IPC fits the operational model and reduces crash risk during early integration.

---

## The Four Foundational Primitives

### 1. Data
**Definition**
Data is everything Pi receives and returns. In practice this is a structured payload that contains conversation context, memory, tool catalog, and user intent.

**What Data looks like here**
- Conversation history (recent `ChatMessage[]`)
- Context synthesis artifacts (daily summary, topic exhaustion info)
- Tool catalog (what Kayley can do)
- User profile and memory facts (from Supabase)

**Where Data currently lives**
- Conversation history: `conversation_history` table
- Memory facts: `user_facts`, `character_facts`, `user_patterns`
- Tool catalog: `src/services/toolCatalog.ts`

**Integration example (no code, conceptual)**
- Build a `PiRequest` payload that includes:
  - `messages`: last N chat turns
  - `memory`: recent facts + daily synthesis summary
  - `tools`: list of tool descriptors (name + schema + description)
  - `session`: sessionId, client (web/telegram/whatsapp)

Pi returns a `PiResponse` with:
- `assistantMessage`: final natural-language response
- `toolCalls`: optional list of tool invocations
- `stateDelta`: optional state mutations to persist

### 2. Execution
**Definition**
Execution is the runtime sequence: how a user message is processed, how Pi makes decisions, and how outputs are applied.

**Current execution flow (simplified)**
1. Request arrives at `/agent/message` or `/agent/message/stream`.
2. `messageOrchestrator` builds context and calls the Gemini service.
3. Gemini returns response + tool calls.
4. `executeMemoryTool()` executes the tools.
5. Response is returned to the client.

**Integration target**
Pi becomes a decision engine in steps 2-3:
- Replace or wrap the LLM decision with Pi's decision layer.
- Pi can either call the LLM internally or delegate to existing LLM services.

**Integration example (IPC flow)**
- `messageOrchestrator` sends `PiRequest` to local Pi service.
- Pi returns `PiResponse` with tool calls.
- The existing `executeMemoryTool()` handles tool calls.
- The final assistant message is returned as-is.

### 3. State
**Definition**
State is persistent or long-lived memory Pi maintains across turns. It includes session context, queued tasks, and intermediate plan steps.

**Where state should live**
- Long-term: Supabase tables (authoritative, queryable).
- Short-term: in-memory cache keyed by `sessionId` (volatile, 2hr TTL like chat sessions).

**State responsibilities**
- Track Pi's own session markers (last decision, unresolved plan)
- Store tool results that Pi needs later
- Keep idempotency keys (avoid repeated tool calls for the same intent)

**Integration example**
- Pi returns a `stateDelta` object (e.g., `{ planId, stepIndex, lastToolCallId }`).
- The server persists it to a new table (e.g., `pi_session_state`).
- On next request, the server hydrates Pi with that state.

### 4. Extensions
**Definition**
Extensions are the external capabilities Pi can invoke. In Kayley, these are already modeled as tool calls.

**Mapping to Kayley tools**
- Each Pi extension maps to a Gemini-style tool (or a sub-set of them).
- The tool catalog in `src/services/toolCatalog.ts` already lists many of these.

**Extension examples**
- `calendar_action` (create/update/delete events)
- `google_task_action` (task CRUD)
- `web_search` or `web_fetch`
- `workspace_action` (shell commands and file ops)

**Integration example**
- Pi sees an extension called `calendar_action` and produces:
  - `toolCalls: [{ name: "calendar_action", args: { action: "list", ... } }]`
- The server routes this into `executeMemoryTool()`.
- Result is sent back to Pi (if Pi expects tool feedback) or directly to the user.

---

## Concrete Integration Examples

### Example 1: IPC Pi Service (Recommended)
**Goal**: Send a message to Pi, get tool calls and a response.

Flow:
1. `messageOrchestrator` builds a `PiRequest` (messages + memory + tools).
2. `PiClient` sends it to `http://127.0.0.1:<pi-port>/v1/decide`.
3. Pi returns `PiResponse` with `assistantMessage` + `toolCalls`.
4. `executeMemoryTool()` runs the tool calls.
5. The final response is returned to the client.

Operational notes:
- Add a health check endpoint for Pi (e.g., `/health`).
- Log both request and response summary to `server_runtime_logs` with `source: "piEngine"`.
- Apply the same SSE tool visibility: emit `tool_start`/`tool_end` around tool calls.

### Example 2: In-Process Library
**Goal**: Use a local native Pi library for very low latency.

Flow:
1. Node loads `pi_engine.dll` at startup.
2. Each request passes a JSON payload to the library.
3. The library returns a JSON response.

Operational notes:
- Run Pi calls in a worker thread to avoid blocking the Node event loop.
- Wrap calls in a circuit breaker to avoid crashing the server.
- Maintain a strict version pin between server and library.

---

## Where The Integration Touches The Codebase
These are the high-level files and subsystems you will coordinate with (no code changes here, just orientation):

- Request entry: `server/routes/agentRoutes.ts`
- Orchestration: `server/services/messageOrchestrator.ts`
- LLM service: `server/services/ai/serverGeminiService.ts`
- Tool execution: `src/services/memoryService.ts` (server-side use via `executeMemoryTool()`)
- Tool catalog: `src/services/toolCatalog.ts`
- System prompt: `src/services/system_prompts/` (Pi should either replace or augment this logic)

---

## Decision Checklist (Use Before You Implement)
- Decide integration mode: in-process vs IPC.
- Define `PiRequest` and `PiResponse` contract (document it in this file or a new schema doc).
- Decide whether Pi will call the LLM internally or delegate to existing Gemini service.
- Decide how Pi session state is stored (new table vs in-memory only).
- Decide how tool call results are returned to Pi (sync or async).

---

## Integration Phases (Suggested)
1. **Phase 0: Contract only**
   - Write the `PiRequest`/`PiResponse` schema.
   - Stub the Pi client and log request/response shapes.

2. **Phase 1: Read-only Pi**
   - Pi receives data and returns a draft response, no tool calls.
   - Compare Pi output to existing Gemini output (shadow mode).

3. **Phase 2: Tooling**
   - Allow Pi to request tool calls.
   - Pipe tool results back to Pi for final response.

4. **Phase 3: Statefulness**
   - Persist Pi session state across turns.
   - Add idempotency rules and replay protection.

---

## Risks And Mitigations
- **Risk: Latency spikes**
  - Mitigation: use IPC with local service; cache tool catalogs; reduce payload size.

- **Risk: Silent mismatches in tool names**
  - Mitigation: single source of truth for tool names; validate on both sides.

- **Risk: State drift**
  - Mitigation: store state in Supabase and include `stateVersion` in every Pi request/response.

---

## What The Intern Should Do First
1. Read `server/README.md` and `agents/opey-dev/PRODUCT_KNOWLEDGE.md`.
2. Sketch `PiRequest` and `PiResponse` on paper and list required fields.
3. Decide IPC vs in-process with a short one-page summary.
4. Identify which existing tools Pi should be allowed to call first (start small).

---

## Glossary
- **Pi Engine**: OpenClaw decision/runtime engine being integrated.
- **IPC**: Inter-process communication, usually HTTP/gRPC/stdio.
- **Tool Call**: A structured request to perform an external action.
- **SSE**: Server-Sent Events used by the web UI for live tool visibility.
