# OpenClaw Pi Engine Integration Plan (Kayley)

## Objective

Integrate the OpenClaw Pi engine into this codebase so Kayley can perform intelligent, autonomous file CRUD operations in the project workspace while preserving safety, auditability, and UI tool visibility.

Key outcomes:

- Kayley can read, write, and edit project files via a new tool backed by Pi.
- Operations are scoped to a safe workspace root and avoid secrets by default.
- The UI shows Pi tool execution progress and results.
- The integration uses the official Pi SDK and follows OpenClaw's embedded Pi architecture.

## References Used

- Pi coding agent README (tools, CLI modes, SDK entry point).
- Pi SDK guide (createAgentSession, tool factories, session events).
- OpenClaw Pi integration architecture (embedded SDK, tool splitting).
- OpenClaw Pi integration overview (CLI vs embedded, session storage differences).
- OpenClaw exec approvals model (approval flow reference).

## Design Decision

Use the Pi SDK (embedded) in the server process rather than spawning the Pi CLI. The OpenClaw embedded runner uses createAgentSession() with tool overrides and a custom resource loader. We will mirror that architecture to get deterministic tool control, event streaming, and safe path enforcement.

## Proposed Architecture (High Level)

1. A new server-side Pi engine service creates and manages Pi agent sessions using the SDK.
2. A new Kayley tool (example: pi_workspace_action) sends a structured request to the Pi engine.
3. The Pi engine limits available tools to file CRUD and read-only discovery (no raw shell by default).
4. The engine emits tool events; the UI displays progress in the existing ToolCallBox.
5. Results are summarized and returned to Kayley through the normal tool result path.

## Where It Fits In This Codebase

Integration touch points (by file):

- src/services/aiSchema.ts - add tool schema and docs for pi_workspace_action.
- src/services/memoryService.ts - execute the new tool by calling server Pi engine.
- server/services/piEngine.ts - new service wrapping Pi SDK sessions.
- server/routes/agentRoutes.ts - optional SSE bridging for tool events.
- server/services/ai/sseTypes.ts - add display name for the tool.
- src/services/system_prompts/tools/toolsAndCapabilities.ts - teach Kayley how to use the tool safely.
- src/services/toolCatalog.ts - expose the tool for discovery.

## Pi SDK Usage Summary (What We Will Implement)

Pi's SDK provides createAgentSession() and a built-in tool set:

- Default tool set includes read, write, edit, bash.
- Read-only tool set includes read, grep, find, ls.
- When specifying a custom cwd plus explicit tools, use factory functions like createCodingTools(cwd) so tool paths resolve correctly.

We will create a Pi session with:

- cwd set to the repo root (workspace root).
- tools set to a restricted set (read-only + edit/write only, no bash initially).
- customTools empty initially, unless we need to inject a project-specific safety tool.

## Phase 0 - Prep and Safety Constraints

1. Define the workspace root (project root) and block any path that escapes it.
2. Define blocked path patterns:
   - .env*, .git/, **/*secret*, **/*token*, **/*key*, **/*credentials*
3. Define allowed operations:
   - Read: read, ls, find, grep
   - Write/edit: write, edit
4. Explicitly disallow bash in Phase 1.

## Phase 1 - Server Pi Engine Service

Create server/services/piEngine.ts to manage Pi SDK sessions.

Responsibilities:

- Create or reuse a Pi AgentSession per sessionId (map to Kayley's chat session).
- Configure the session using createAgentSession() with:
  - cwd set to workspace root
  - tools set via createCodingTools(cwd) or a mix of createReadOnlyTools(cwd) + createEditTool(cwd) + createWriteTool(cwd)
  - SessionManager.inMemory() initially
- Subscribe to session.subscribe() events to capture:
  - tool start/end events for UI visibility
  - streaming text for logs
- Provide a minimal runPiPrompt() method:
  - input: user intent, instructions, and optional context
  - output: structured summary and raw tool results

SDK mechanics reference:

- createAgentSession() is the entry point for embedded usage.
- Sessions provide event streaming via session.subscribe().

## Phase 2 - Tool Definition for Kayley

Add a new Gemini function tool, pi_workspace_action, with a narrow schema.

Suggested schema:

- goal - short instruction to Pi (string)
- context - optional hints (string)
- expected_files - optional list of paths (string[])
- safety_mode - read_only | edit (default: read_only)

Behavior:

- read_only maps to a tool set with read, find, grep, ls.
- edit maps to read, edit, write, find, grep, ls.

Why this schema:

- Keeps Pi's prompt surface small.
- Avoids raw shell access.
- Makes it easy to audit and gate edit operations.

## Phase 3 - Bridge Into Existing Tool Pipeline

1. Implement the executeMemoryTool case in src/services/memoryService.ts:
   - Validate input schema.
   - Call the new Pi engine service.
   - Return the summary and file list to Kayley.
2. Add a UI label in server/services/ai/sseTypes.ts:
   - pi_workspace_action -> "Pi workspace agent"
3. Add tool declaration and catalog entries:
   - src/services/aiSchema.ts
   - src/services/toolCatalog.ts
4. Add prompt guidance in src/services/system_prompts/tools/toolsAndCapabilities.ts:
   - Clear instructions on when to use Pi vs direct tools.
   - Explicit rules: "Do not use Pi for secrets or .env files."

## Phase 4 - UI Visibility (Optional but Recommended)

Use existing SSE plumbing to surface Pi events:

- Emit tool_start and tool_end from the Pi engine based on session events.
- Use the existing TurnEventBus to stream them to the web UI.
- Include a short progress summary (e.g., "Reading 3 files", "Editing 1 file").

Pi provides event hooks such as tool_execution_start, tool_execution_end, and streaming text deltas.

## Phase 5 - CRUD Workflow Examples

Example A: Read-only investigation

- User: "Find where the calendar tool is wired."
- Kayley calls pi_workspace_action with safety_mode=read_only and goal describing the search.
- Pi uses find/grep to locate references.
- Kayley responds with file paths and line references.

Example B: Safe edit

- User: "Update the tool label in the UI."
- Kayley calls pi_workspace_action with safety_mode=edit.
- Pi reads, edits, and writes the file.
- Kayley returns a summary + file list.

## Phase 6 - Guardrails and Approvals

OpenClaw's exec approval flow illustrates a strong pattern: commands that require approval return an approval id and wait for operator resolution. We should reuse this concept for edits that touch sensitive areas.

Concrete rules:

- Require explicit approval for edits in:
  - server/ and supabase/ (production risk)
  - any file matching *.sql or .env*
- If approval is required:
  - return a "pending approval" tool response
  - surface a structured approval prompt in the UI
  - only proceed after approval

## Phase 7 - Session Persistence Strategy

Pi stores sessions under ~/.pi/agent/sessions/ by default. OpenClaw stores embedded sessions under ~/.openclaw/agents/<agentId>/sessions/.

Recommended approach:

- Start with SessionManager.inMemory() for simplicity.
- Add optional persistence later if we want full Pi history outside Supabase.

## Testing Plan

Unit tests:

- Pi engine path guard rejects .. and absolute paths outside workspace.
- Tool set selection matches safety_mode.
- Blocked path patterns are enforced.

Integration tests:

- read_only action can read and grep inside src/.
- edit action can update a safe file and returns a summary.
- Attempted edit to .env.local is blocked.

Manual verification:

- Use the web UI to request a read-only search.
- Confirm ToolCallBox shows "Pi workspace agent" events.
- Confirm Kayley summarizes the results accurately.

## Rollout Plan

1. Add the tool and server engine behind a feature flag:
   - PI_ENGINE_ENABLED
2. Default to read_only in production.
3. Enable edit for local dev only at first.
4. Add the approval UI before enabling edit in production.

## Risks and Mitigations

- Risk: Pi edits the wrong file.
  - Mitigation: require expected_files for edit actions, block if mismatched.
- Risk: secrets leakage.
  - Mitigation: block sensitive file patterns and redact outputs.
- Risk: long-running operations.
  - Mitigation: enforce timeouts per Pi prompt.

## Acceptance Criteria

- Kayley can perform read-only searches and returns file locations.
- Kayley can perform controlled edits on safe files in dev.
- The UI shows Pi tool activity with start/end status.
- Sensitive paths are blocked consistently.
