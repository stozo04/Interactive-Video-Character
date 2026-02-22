# Kayley Workspace Agent Implementation Plan

## Objective

Enable Kayley to safely read and write files in this project folder and execute controlled git workflows from chat.

Target user workflows:

1. "Kayley, create a new folder."
2. "Kayley, commit these changes."
3. "Kayley, push to origin/main." (separate confirmation step)

## Findings From Current Codebase

## Existing architecture

- The app is a Vite + React + TypeScript frontend (`package.json`).
- Chat flow is orchestrated through `src/App.tsx` -> `src/services/messageOrchestrator.ts` -> `activeService.generateResponse(...)`.
- Tool calling already exists through schema + executor:
  - `src/services/aiSchema.ts` declares tools.
  - `src/services/geminiChatService.ts` executes function call loops.
  - `src/services/memoryService.ts` is the runtime tool executor (`executeMemoryTool`).
- Vite currently provides dev-only middleware endpoints in `vite.config.ts` (`/api/save-selfie`, `/api/save-video`), but there is no dedicated backend service for workspace/terminal operations.

## Gaps for your goal

- No server-side terminal or command execution service exists today.
- No filesystem safety layer (path guard, blocked path policy, symlink checks) exists for agentic file access.
- No approval workflow exists for dangerous operations like `git push` or generic shell commands.
- No audit trail exists for command plans, approvals, and execution logs.

## Key risks and edge cases

- Prompt injection leading to unsafe shell execution.
- Path traversal or symlink escape outside project root.
- Secret exfiltration from `.env*`, files containing `token`, `key`, `credentials`, or `.git`.
- Destructive operations (`rm`, force push, reset, checkout discard) without explicit consent.
- Push to wrong branch/remote.
- Hanging commands or partial failure states.
- Concurrent edits while a run is executing.

## Recommended Architecture

Use a separate local backend service with policy-driven execution. Do not give the LLM unrestricted shell by default.

### High-level flow

1. User asks Kayley to do a workspace action.
2. Kayley calls a new tool (example: `workspace_action`) with intent + parameters.
3. Frontend tool executor forwards request to local agent server.
4. Server planner produces a typed execution plan (steps).
5. Policy engine validates each step and marks `requires_approval` where needed.
6. Frontend shows planned steps and asks for approval when required.
7. Server executes approved steps and streams status/logs.
8. Kayley summarizes results in chat with file paths and command outcome.

### Why this design

- Keeps risky execution off the browser runtime.
- Creates explicit trust boundaries.
- Enables deterministic controls and auditability.
- Still supports "terminal behind the app" behavior.

## Core Components

## 1) Agent server (new)

Suggested files:

- `server/index.ts`
- `server/routes/agentRoutes.ts`
- `server/agent/planner.ts`
- `server/agent/executor.ts`
- `server/agent/policyEngine.ts`
- `server/agent/pathGuard.ts`
- `server/agent/fsOps.ts`
- `server/agent/gitOps.ts`
- `server/agent/shellOps.ts`
- `server/agent/runStore.ts`

## 2) Safety and policy

Implement strict allow/deny policy before execution.

Policy dimensions:

- `operation_type`: `read`, `write`, `mkdir`, `move`, `delete`, `git_commit`, `git_push`, `shell`.
- `path_scope`: must remain under `WORKSPACE_AGENT_ROOT`.
- `sensitivity`: deny reads/writes for secrets and `.git` internals unless explicitly whitelisted.
- `approval_required`: true for `delete`, `git_push`, `shell`, and bulk writes.
- `timeout_ms`: command-level timeout plus max output bytes.

## 3) Typed capabilities first, shell second

Primary execution should use typed operations:

- `mkdir`
- `list_dir`
- `read_file`
- `write_file`
- `edit_file_patch`
- `git_status`
- `git_diff`
- `git_add`
- `git_commit`
- `git_push`

Generic shell should be a fallback only, behind stricter approval and command filtering.

## 4) Audit log

Every run should store:

- user message
- generated plan
- policy decisions
- approvals/rejections
- executed commands
- stdout/stderr summary
- final outcome

## 5) OpenClaw-aligned background runtime model

For reliable "agent behind chat" behavior, treat execution as a managed background runtime.

Core model:

1. `exec`-style start API creates a run and returns immediately (`accepted` + `runId`).
2. Execution continues asynchronously in worker context.
3. `process`-style control APIs manage lifecycle (`list`, `poll`, `log`, `write`, `kill`, `clear`).
4. Tool policy applies at gateway layer before command execution.
5. Approval mode is explicit and configurable (`off`, `on_miss`, `always`).
6. Security mode is explicit and configurable (allowlist/strict profiles).

Operational consequences:

- HTTP request timeout is decoupled from command runtime.
- Long-running commands are observable and cancellable.
- Interactive tasks can receive stdin (`write`) when allowed.
- Logs are bounded, redacted, and queryable by run/process id.

## 5.1) OpenClaw tool configuration parity audit

This section compares the current project tool system to OpenClaw's tool model and lists migration steps.

References reviewed:

- `https://docs.openclaw.ai/tools`
- `https://docs.openclaw.ai/tools/exec`
- `https://docs.openclaw.ai/tools/exec-approvals`
- `https://docs.openclaw.ai/background-process`
- `https://docs.openclaw.ai/gateway/configuration-reference`

Parity matrix:

| Capability | OpenClaw model | Current project status | Migration needed |
|---|---|---|---|
| Tool registry source | Configurable tool policy and merged tool list | Hardcoded declarations in `src/services/aiSchema.ts` | Add central tool policy config and effective-tool compiler |
| Allow/Deny policy | `tools.allow` + `tools.deny` with deny precedence | No global allow/deny matrix; ad hoc logic in code | Add explicit allow/deny policy layer before tool exposure |
| Tool profiles | `profile=minimal/coding/messaging/full` | No profile abstraction | Add profile presets and runtime profile selection |
| Provider overrides | `tools.byProvider` overrides by LLM provider | Same tool set exposed regardless of provider | Add provider-specific tool policy map |
| Tool groups | `group:*` shorthand expansion | No group shorthand | Add group aliases for maintainability (`group:workspace`, `group:x`, etc.) |
| Exec runtime | `exec` for command start | Custom `workspace_action` via local API (`mkdir` only) | Introduce `exec`-style contract for non-trivial operations |
| Background process control | `process` list/poll/log/write/kill/clear | No general process manager endpoints yet | Implement process manager API and event/log store |
| Approval/security knobs | ask + security modes in command tools | Partial hardcoded policy, no mode matrix | Add explicit approval/security config and enforcement |
| Loop detection config | Central loop/circuit-breaker style controls | Local duplicate guard in `geminiChatService` only | Add policy-driven loop detection thresholds |
| Model guidance + schema duality | Tools exposed by schema plus prompt guidance | Already present (`aiSchema.ts` + `toolsAndCapabilities.ts`) | Keep; refactor to derive from same source of truth |

Key finding:

- Current implementation is aligned with the architecture direction (tool calls + local gateway), but it is not yet configuration-equivalent to OpenClaw's policy-driven tool system.

Required migrations:

1. Tool policy config migration:
- Add `server/agent/toolPolicy.ts` with:
  - `allow`
  - `deny`
  - `profile`
  - `byProvider`
  - `groups`
- Add effective-tool resolver to compile runtime-exposed tools per session/provider.

2. API contract migration:
- Keep `workspace_action(action=mkdir)` as compatibility layer for current behavior.
- Add `exec`/`process` endpoints and move long-running actions to async process lifecycle.
- Mark legacy synchronous run path as deprecated once process control is stable.

3. Approval/security migration:
- Add mode matrix:
  - `approval_mode`: `off`, `on_miss`, `always`
  - `security_mode`: `deny`, `allowlist`, `full`
- Enforce deny-first behavior at policy engine.

4. Prompt/tool definition migration:
- Generate tool guidance from policy-backed metadata where possible.
- Reduce divergence between:
  - `src/services/aiSchema.ts`
  - `src/services/toolCatalog.ts`
  - `src/services/system_prompts/tools/toolsAndCapabilities.ts`

5. Observability migration:
- Add persistent run/process logs and redacted event stream for troubleshooting.
- Add runbook commands for `start/status/restart/logs`.

Recommended compatibility strategy:

1. Phase-in without breaking current chat behavior:
- Keep `workspace_action mkdir` live.
- Internally map it to new execution engine.
2. Add new actions behind flags:
- `search_files`, `search_content`, `git_status`, `git_diff` first.
3. Migrate risky actions only after approval/security modes ship:
- `write_file`, `commit`, `push`, generic shell fallback.

## 6) Execution truthfulness and verification (critical)

The agent must be evidence-driven and never claim success without a passing post-check.

Required rules:

1. Do not claim "done" unless verification step passed.
2. Every execution response must include structured status:
   - `success`
   - `partial_success`
   - `failed`
   - `verification_failed`
3. If execution succeeds but verification fails, return `verification_failed`, not `success`.
4. Never hide uncertainty. If confirmation is not possible, explicitly state "could not confirm."
5. Perform file-existence prechecks before search commands to avoid false negatives from missing paths.
6. Redact sensitive values in logs and chat output:
   - `*_API_KEY`
   - `*_TOKEN`
   - `*_SECRET`
   - `*_PASSWORD`
7. Preserve raw stderr/stdout internally, but expose only redacted logs to UI/LLM.
8. Require a post-action verifier for operations that mutate shell/profile/env files.

## API Contract (Concrete)

## Endpoints

- `POST /agent/runs`
- `POST /agent/runs/:id/approve`
- `POST /agent/runs/:id/reject`
- `GET /agent/runs/:id`
- `GET /agent/runs/:id/events`

OpenClaw-style process controls (add in next implementation phase):

- `GET /agent/processes`
- `GET /agent/processes/:id`
- `GET /agent/processes/:id/logs`
- `POST /agent/processes/:id/write`
- `POST /agent/processes/:id/kill`
- `POST /agent/processes/:id/clear`

Config endpoints (optional but recommended for admin UI):

- `GET /agent/policy`
- `PATCH /agent/policy`
- `GET /agent/runtime`
- `POST /agent/runtime/restart`

## Example create run payload

```json
{
  "prompt": "Create a folder called scripts/archive",
  "context": {
    "workspaceRoot": "C:/Users/gates/Personal/Interactive-Video-Character",
    "branch": "feature/my-branch"
  }
}
```

## Example planned step

```json
{
  "stepId": "s1",
  "type": "mkdir",
  "args": {
    "path": "scripts/archive"
  },
  "requiresApproval": false,
  "policyNotes": []
}
```

## Example git push step (approval required)

```json
{
  "stepId": "s5",
  "type": "git_push",
  "args": {
    "remote": "origin",
    "branch": "main"
  },
  "requiresApproval": true,
  "policyNotes": [
    "Network write operation",
    "Potentially irreversible remote change"
  ]
}
```

## Run result schema (evidence-first)

All tool results from backend to frontend should follow this shape:

```json
{
  "runId": "run_01J...",
  "status": "verification_failed",
  "summary": "Removed one export, but could not verify complete cleanup across all target files.",
  "steps": [
    {
      "stepId": "s1",
      "type": "edit_file",
      "status": "success",
      "exitCode": 0,
      "evidence": [
        "Updated ~/.bashrc line 142"
      ]
    },
    {
      "stepId": "s2",
      "type": "verify",
      "status": "failed",
      "exitCode": 1,
      "evidence": [
        "GEMINI_API_KEY still found in ~/.bashrc"
      ]
    }
  ],
  "redactedLogs": [
    "~/.bashrc: export GEMINI_API_KEY='***REDACTED***'"
  ],
  "nextActionRequired": "manual_confirmation_or_retry"
}
```

Notes:

- `status` is authoritative for user-facing language.
- `evidence` must point to concrete artifacts (file path, command, exit code, lines).
- `redactedLogs` are safe to show in chat.
- No "success" wording is allowed when top-level status is not `success`.

Run and process states (recommended):

- Run states: `accepted`, `pending`, `running`, `awaiting_approval`, `success`, `failed`, `verification_failed`, `canceled`.
- Process states: `starting`, `running`, `completed`, `failed`, `killed`, `timed_out`.
- Terminal events: `stdout`, `stderr`, `status_changed`, `approval_required`, `approval_resolved`.

## Frontend + Tool Integration Plan

## New frontend service

Add:

- `src/services/projectAgentService.ts`

Responsibilities:

- call backend run endpoints
- stream run status/events
- normalize errors into user-readable messages

## Chat tool integration

Add a new LLM tool using the existing pattern:

- `src/services/aiSchema.ts`
- `src/services/memoryService.ts`
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
- `src/services/toolCatalog.ts`

Suggested tool name: `workspace_action`.

Tool actions:

- `mkdir`
- `read_file`
- `write_file`
- `edit_file_patch`
- `list_dir`
- `search_files`
- `search_content`
- `stat_path`
- `commit`
- `push`
- `git_status`
- `git_diff`

Important: document "when/how" in `toolsAndCapabilities.ts` so the model actually uses it consistently.

Action naming guidance:

- Avoid a generic `status` action because it is ambiguous.
- Use `git_status` for repository state.
- Use `GET /agent/runs/:id` for run progress/status (outside `workspace_action`).

LLM role vs search executor:

- The LLM decides when discovery is needed.
- The backend executes safe search primitives (`search_files`, `search_content`) with policy controls.
- The LLM should not improvise raw shell search if explicit search actions exist.

Search action schemas (minimum contract):

```json
{
  "action": "search_files",
  "args": {
    "query": "gemini",
    "rootPath": ".",
    "fileTypes": ["ts", "tsx", "md"],
    "includeHidden": false,
    "maxResults": 100
  }
}
```

```json
{
  "action": "search_content",
  "args": {
    "query": "GEMINI_API_KEY",
    "rootPath": ".",
    "fileTypes": ["ts", "tsx", "md", "env"],
    "caseSensitive": false,
    "maxResults": 50,
    "maxBytesPerHit": 400
  }
}
```

Search response requirements:

- Return path, line number, and truncated snippet only.
- Include `truncated: true` when limits are hit.
- Redact secret-like values before returning snippets.

## UI additions

In `src/App.tsx`:

- show pending approval cards for risky steps
- show run progress and completion summary
- show exact files affected and git target before approval

## Git Workflow Design (2-step approvals)

## Commit flow

1. Gather candidate files with `git status`.
2. Show selected files + proposed commit message.
3. User approves commit.
4. Execute `git add` + `git commit`.

## Push flow

1. Show exact target: `<remote>/<branch>`.
2. User approves push separately.
3. Execute push and return result.

This prevents accidental remote writes from a single ambiguous prompt.

## Security Rules (Must-have)

1. Enforce workspace root jail for every file operation.
2. Block sensitive patterns by default:
   - `.env*`
   - `**/*secret*`
   - `**/*token*`
   - `**/*key*`
   - `**/*credentials*`
3. Deny destructive git commands:
   - `git reset --hard`
   - `git checkout -- <file>`
   - `git push --force`
4. Require explicit approval for:
   - `delete` operations
   - `git push`
   - generic `shell` execution
5. Require timeout + output caps on every command.
6. Persist audit logs for every run.
7. Never emit raw secrets in logs or chat summaries.
8. For env/profile mutations, require explicit post-check output in final response.
9. Apply sensitive-path deny rules to search actions (`search_files`, `search_content`).
10. Enforce bounded search outputs (`maxResults`, `maxBytesPerHit`) and explicit truncation flags.

## Phased Implementation Checklist

## Phase 0: Spec and policy

- Create detailed spec with operation matrix, approval matrix, and threat model.
- File: `docs/plans/kayley-workspace-agent.md`

## Phase 1: Backend skeleton

- Add server entrypoint and run routes.
- Files: `server/index.ts`, `server/routes/agentRoutes.ts`, `server/agent/runStore.ts`

## Phase 2: Safe execution primitives

- Implement path guard, policy engine, fs ops, git ops, shell fallback.
- Files: `server/agent/pathGuard.ts`, `server/agent/policyEngine.ts`, `server/agent/fsOps.ts`, `server/agent/gitOps.ts`, `server/agent/shellOps.ts`

## Phase 3: Planner + executor

- Convert intent into steps, enforce policy, execute sequentially, persist logs.
- Files: `server/agent/planner.ts`, `server/agent/executor.ts`

## Phase 3.5: Async process control plane (OpenClaw-style)

- Refactor run creation to return immediately (`accepted`) and execute in background worker.
- Add process lifecycle APIs (`list`, `poll`, `logs`, `write`, `kill`, `clear`).
- Add bounded log buffers and event stream store.
- Files:
  - `server/agent/queue.ts`
  - `server/agent/processManager.ts`
  - `server/routes/processRoutes.ts`
  - `server/agent/logBuffer.ts`

## Phase 4: Frontend integration

- Add project agent service and approval UI.
- Files: `src/services/projectAgentService.ts`, `src/App.tsx`

## Phase 5: LLM tool integration

- Add `workspace_action` declaration and execution bridge.
- Files: `src/services/aiSchema.ts`, `src/services/memoryService.ts`, `src/services/system_prompts/tools/toolsAndCapabilities.ts`, `src/services/toolCatalog.ts`

## Phase 6: Testing and rollout

- Add policy, path, git, and integration tests.
- Files:
  - `server/__tests__/policyEngine.test.ts`
  - `server/__tests__/pathGuard.test.ts`
  - `server/__tests__/gitOps.test.ts`
  - `src/services/__tests__/workspaceToolIntegration.test.ts`
- Roll out behind feature flags:
  - `WORKSPACE_AGENT_ENABLED`
  - `WORKSPACE_AGENT_ROOT`
  - `WORKSPACE_AGENT_REQUIRE_APPROVAL`
  - `WORKSPACE_AGENT_ALLOW_PUSH`

## Phase 6.5: Approval and security modes

- Add explicit approval mode settings:
  - `approval_mode=off`
  - `approval_mode=on_miss`
  - `approval_mode=always`
- Add explicit security mode/profile settings:
  - strict allowlist profile for production usage
  - relaxed profile for local development
- Enforce "deny wins" when allow/deny rules conflict.
- Files:
  - `server/agent/policyConfig.ts`
  - `server/agent/policyEngine.ts`
  - `server/routes/policyRoutes.ts`

## Phase 7: Truthfulness and verification hardening

- Add validation tests for status mapping (`success` vs `verification_failed`).
- Add redaction tests for key/token/secret patterns.
- Add file-existence precheck tests for verifier commands.
- Add regression test: "agent must not claim completion when verifier fails."
- Add search policy tests to verify blocked paths are excluded.
- Add search output-bound tests to verify truncation and max result limits.
- Suggested files:
  - `server/__tests__/executionStatus.test.ts`
  - `server/__tests__/redaction.test.ts`
  - `server/__tests__/verificationPrecheck.test.ts`
  - `server/__tests__/searchPolicy.test.ts`
  - `server/__tests__/searchOutputBounds.test.ts`

## Verification commands (proposed only)

Do not run until approved:

- `npm run build`
- `npm test -- --run`
- `npm run dev` (frontend + new agent server)

## Acceptance Scenarios

## Scenario A: Create folder

1. User: "Kayley, create folder `src/tools/experiments`."
2. Tool call: `workspace_action(action=mkdir, path=src/tools/experiments)`.
3. Backend policy validates path in root.
4. Execute mkdir.
5. Chat reply confirms created path.

## Scenario B: Commit + push

1. User: "Kayley commit these changes."
2. Agent returns changed files + draft commit message.
3. User approves commit.
4. Commit executes and returns commit hash.
5. User: "Push it."
6. Agent shows `origin/<branch>`.
7. User approves push.
8. Push executes and result is reported.

## Scenario C: Env var cleanup confirmation

1. User asks to remove legacy env var from shell profiles.
2. Agent performs planned edits.
3. Agent runs verifier across existing files only.
4. If key reference still exists, return `verification_failed`.
5. Chat response says cleanup is not yet confirmed and shows redacted evidence.

## Scenario D: Search where warning is coming from

1. User asks: "Find where this warning is triggered."
2. Tool call: `workspace_action(action=search_content, args={ query: "...", rootPath: "src" })`.
3. Backend executes policy-constrained search and returns bounded results.
4. Agent summarizes likely source files and requests approval before any edits.

## Scenario E: Long-running command with process controls

1. User asks for an operation that may run longer than request timeout.
2. Agent returns `accepted` run with process id immediately.
3. UI polls or streams process logs/events.
4. User can cancel with process kill action.
5. Final run status is written with redacted logs and verification evidence.

## Runtime defaults (current)

- Queue model: single active run at a time (serial queue).
- Approval-required actions: `commit`, `push`, `delete`.
- Verification-required actions: `commit`, `push`, `delete`.
- Live updates: SSE stream with run events plus 20-second heartbeat messages to avoid silent waits.

## Service supervision runbook (implementation steps)

1. Run agent as managed service in development and production-like local runs.
2. Add health endpoint (`GET /agent/health`) and readiness checks.
3. Add restart-safe run/process persistence in Supabase (no in-memory fallback).
4. Add operational commands/scripts for:
- `start`
- `status`
- `restart`
- `logs`
5. Document incident handling:
- stuck process kill
- queue drain on shutdown
- post-crash run reconciliation

## Supabase persistence decision (implemented)

As of February 20, 2026, workspace agent runs are persisted in Supabase and the gateway is configured to fail fast if Supabase credentials are missing.

Required env vars for `server/index.ts`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Behavior:

- No fallback to in-memory run storage.
- If either env var is missing, agent startup throws an explicit error.
- Admin Dashboard -> Agent now reflects persisted run history across gateway restarts.

## Final recommendation

Build this as a separate local agent server with typed capabilities and strict approvals. Avoid direct unrestricted shell execution from model output. This gives you the same practical experience as a "terminal behind the app" with significantly better safety and control.
