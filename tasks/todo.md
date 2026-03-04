## Global Note: Dev Infra (Workspace Agent + Multi-Agent)

- The UI uses Vite dev proxy for `/multi-agent` to avoid CORS when the external multi-agent server runs on `http://localhost:4010`.
- In dev, `src/services/multiAgentService.ts` uses same-origin requests (empty base URL) unless `VITE_WORKSPACE_AGENT_URL` is explicitly set.
- Production still needs a real backend route or proper CORS headers on the external service.

---

## Plan: Daily Checklist Task Render Fix + Autonomy Update

1) Ensure task creation updates UI even if the insert returns no row data:
- `src/hooks/useTasks.ts`
2) Add regression test coverage for the fallback refresh path:
- `src/hooks/__tests__/useTasks.test.ts`
3) Update autonomy/workflow instructions and capture lessons:
- `AGENTS.md`
- `tasks/lessons.md`
- `server/agent/opey-dev/lessons_learned/2026-03-04_Fix_Task_Rendering.md`
4) Verification (do not run without approval):
- `npm test -- --run src/hooks/__tests__/useTasks.test.ts`
- `npm run build`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Read-only inspection completed (`src/hooks/useTasks.ts`, `src/components/TaskPanel.tsx`, `src/services/taskService.ts`, `src/hooks/__tests__/useTasks.test.ts`, `AGENTS.md`, `tasks/lessons.md`).
- [x] Patch implementation.
- [ ] Verification run (not executed).

## Review Notes
- Goal: new tasks should appear immediately even if Supabase insert returns no row data due to RLS or select restrictions.
- Implemented a refresh fallback on null create responses and added a regression test to guard the behavior.

---

## Plan: Multi-Agent API Routes (Workspace Agent Server)

1) Add multi-agent HTTP routes with CORS + JSON parsing:
- `server/routes/multiAgentRoutes.ts`
2) Wire multi-agent routes into the server request handler:
- `server/index.ts`
3) Map Supabase tables to API payloads for tickets, events, turns, chats:
- `server/routes/multiAgentRoutes.ts`
4) Verification (if approved):
- `npm run agent:dev`
- `curl -i -X POST http://localhost:4010/multi-agent/tickets -H "Content-Type: application/json" --data "{\"requestSummary\":\"test\"}"`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- This exposes `/multi-agent/*` routes from the local Workspace Agent server so the Vite dev proxy has a real target.

---

## Plan: Multi-Agent Health Check (Server + Admin UI)

1) Add a lightweight `/multi-agent/health` endpoint:
- `server/routes/multiAgentRoutes.ts`
2) Add client helper for the health endpoint:
- `src/services/multiAgentService.ts`
3) Add Admin Dashboard trigger + status display:
- `src/components/AdminDashboardView.tsx`
4) Verification (if approved):
- `npm run agent:dev`
- `npm run dev`
- `curl -i http://localhost:4010/multi-agent/health`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- Health check should be lightweight and avoid heavy queries.

---

## Plan: Multi-Agent Admin UI (Disable Chats + Turns)

1) Stop calling chat session and ticket turns endpoints in Admin Dashboard:
- `src/components/AdminDashboardView.tsx`
2) Replace chat/turns UI with "coming soon" placeholders:
- `src/components/AdminDashboardView.tsx`
3) Verification (if approved):
- `npm run dev`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- Tickets + events remain active; chats/turns are disabled until backend is ready.

---

## Plan: Admin Dashboard Runtime Logs View (Descending + Severity Filter)

1) Add admin service query/types for `server_runtime_logs` with descending order and optional severity filter:
- `src/services/adminService.ts`
2) Add a `Runtime Logs` mode in the admin dashboard with loading/error state, refresh control, and severity filter UI:
- `src/components/AdminDashboardView.tsx`
3) Render runtime logs as a readable card/list view with severity badges, metadata chips, and collapsible JSON details:
- `src/components/AdminDashboardView.tsx`
4) Verification (if approved):
- `npm run dev`
- Open `AdminDashboardView` and confirm runtime logs load newest-first
- Change severity filter (`all`, `info`, `warning`, `error`, `critical`) and confirm filtering updates

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Read-only inspection completed (`AdminDashboardView` has no runtime logs panel yet; `adminService` has no `server_runtime_logs` query helper).
- [x] Patch implementation (approved; added runtime logs mode + descending query + severity filter UI).
- [ ] Verification run (if approved).

## Review Notes
- `server_runtime_logs` already has indexed columns for `created_at` and `severity`, so the requested sort/filter pattern is a good fit for the current schema.

---

## Plan: Claudy QA Recovery Auto-Trigger In `processNextStep`

1) Add a Claudy recovery auto-trigger hook in `processNextStep(...)` similar to Opey, but only for QA-ready tickets:
- `server/agent/multiAgent/orchestrator.ts`
2) Make the Claudy recovery trigger idempotent and safe:
- `server/agent/multiAgent/orchestrator.ts`
3) Verification (if approved):
- `npm run agent:dev`
- Resume/process a ticket already in `ready_for_qa` and confirm Claudy review starts automatically
- Confirm no duplicate Claudy review turn is recorded when one already exists in the current cycle

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Read-only diagnosis completed (Claudy is auto-triggered in queue-settled/execution paths, but not from `processNextStep` recovery path).
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- This is a recovery/idempotency gap, not the primary Claudy handoff path. The main auto-trigger currently happens in `handleWorkspaceRunsSettled(...)` and in the Opey execution-mode path after patch checkpoint collection.

---

## Plan: Opey Codex Exec Exit Code 2 (Windows Prompt Argument)

1) Confirm `Codex CLI exited with code 2` root cause in Opey execution mode and compare against installed `codex exec --help` flags:
- `server/agent/dev/opey.ts`
- `server/agent/multiAgent/codexCliRunner.ts`
- `server/agent/multiAgent/cliExec.ts`
2) Patch Codex execution-mode prompt delivery to avoid passing large multi-line prompts as a shell positional argument on Windows:
- `server/agent/multiAgent/codexCliRunner.ts`
3) Verification (if approved):
- `npm run agent:dev`
- Trigger the same bug ticket flow and confirm logs show `requestOpeyExecutionTurn agent complete` (or at least a richer Codex stderr than only exit code 2)
- Confirm the ticket does not immediately transition to `escalated_human` from `implementing` due to `Codex CLI exited with code 2`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Read-only diagnosis completed (`codex exec --help` confirms current flags are valid).
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- Likely root cause is Windows `cmd.exe` argument parsing/length issues from `spawn(..., { shell: true })` plus a large multi-line execution prompt passed as a positional `codex exec [PROMPT]` argument.
- Structured Opey planning turns already send prompt via stdin and do not show this failure signature, which further points to execution-mode prompt transport rather than unsupported flags.

---

## Plan: Kera Bug Intake Missing BUG.md Scaffold

1) Confirm expected intake/scaffold flow and identify where bug artifact creation should occur:
- `server/agent/assistant/kera.ts`
- `server/agent/multiAgent/orchestrator.ts`
- `server/agent/multiAgent/artifactService.ts`
- `server/agent/multiAgent/intakeWatcher.ts`
2) Inspect runtime evidence from provided logs/HAR to confirm actual failure path (pending approval):
- `c:/Users/gates/Downloads/logs2.txt`
- `c:/Users/gates/Downloads/convo.txt`
- `c:/Users/gates/Downloads/console.txt`
- `c:/Users/gates/Downloads/local.har`
3) Patch intake progression so Kera-created tickets reach worktree + artifact scaffolding:
- `server/agent/assistant/kera.ts`
- `server/agent/multiAgent/orchestrator.ts`
4) Add or update regression test for bug ticket scaffold behavior:
- `src/services/__tests__/multiAgentWorkflow.test.ts`
5) Verification (if approved):
- `npm test -- --run src/services/__tests__/multiAgentWorkflow.test.ts`
- `curl.exe -sS -X POST http://localhost:4010/multi-agent/tickets -H "Content-Type: application/json" --data "{\"requestType\":\"bug\",\"title\":\"Test bug\",\"requestSummary\":\"Repro steps\"}"`
- `git worktree list`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Initial code-path diagnosis completed (no caller reaches bug scaffold).
- [x] External log inspection completed (`logs2.txt`, `console.txt`, `convo.txt`); `local.har` not needed for root cause.
- [x] Patch implemented.
- [x] Regression test added (not executed yet).
- [ ] Verification run (if approved).

## Review Notes
- Current code shows `scaffoldBugArtifacts()` exists, but `scaffoldArtifacts()` has no call sites and Kera intake only calls `startTicket()`.
- Bug docs are expected inside the ticket worktree (`.worktrees/<ticketId>/bugs/<slug>/BUG.md`), not the main repo root.
- `server_runtime_logs` was empty because `[RuntimeLogger] Supabase env missing; logging disabled.` happened before `.env` finished loading (singleton logger initialized at import time).

---

## Plan: Runtime Logger Enablement (Supabase Persistence)

1) Fix runtime logger initialization timing so it does not permanently disable before `.env` is loaded:
- `server/agent/multiAgent/runtimeLogger.ts`
2) Keep warnings readable and non-spammy when env is truly missing:
- `server/agent/multiAgent/runtimeLogger.ts`
3) Verification (if approved):
- `npm run agent:dev`
- trigger a multi-agent action and confirm rows appear in `server_runtime_logs`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Runtime logger patch implemented.
- [ ] Verification run (if approved).

## Review Notes
- Preferred fix is lazy logger client initialization (robust across entrypoints), instead of relying only on import ordering in `server/index.ts`.

---

## Plan: Opey Planning Turn Hangs In Codex CLI

1) Confirm stop point and whether Opey starts at all:
- `C:\Users\gates\Downloads\server_logs.txt`
- `C:\Users\gates\Downloads\server_runtime_logs.txt`
- `C:\Users\gates\Downloads\logs2.txt`
2) Patch Opey/Codex invocation to be ticket-worktree scoped and non-interactive (no approval prompt deadlock):
- `server/agent/dev/opey.ts`
- `server/agent/multiAgent/codexCliRunner.ts`
3) Improve CLI exec timeout/termination diagnostics for next failure:
- `server/agent/multiAgent/cliExec.ts`
4) Verification (if approved):
- `npm run agent:dev`
- Trigger bug ticket and confirm `engineering_agent_turns` gets Opey planning row
- Confirm server logs show `requestOpeyTurn agent complete` or `requestOpeyTurn agent failed`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Log inspection completed (`BUG.md` scaffold now works; stop occurs inside Codex CLI call).
- [x] Runner patch implemented.
- [ ] Verification run (if approved).

## Review Notes
- `server_runtime_logs` confirms Opey and `CodexCliRunner` start, then no follow-up complete/failed logs, so the block is inside `runCliCommand(...)`.
- `codex exec --help` confirms stdin prompt is supported; approval/interactive behavior is the more likely deadlock than prompt delivery.

---

## Plan: Claudy Autonomy + Bug Template Prefill + Runtime Log Metadata

1) Enable Claudy fully autonomous review turns in the ticket worktree (consistent with Opey):
- `server/agent/qa/claudy.ts`
- `server/agent/multiAgent/claudeCliRunner.ts`
- `server/agent/multiAgent/cliExec.ts` (already supports `cwd`)
2) Prefill bug scaffold sections from intake ticket data (no extra LLM call by default):
- `server/agent/multiAgent/artifactService.ts`
- `server/docs/bug_template.md` (only if placeholder markers are needed)
3) Enrich `server_runtime_logs` top-level metadata columns from known context/details:
- `server/agent/multiAgent/runtimeLogger.ts`
4) Verification (if approved):
- `npm run agent:dev`
- Trigger bug ticket and inspect generated `BUG.md` contents in `.worktrees/<ticketId>/bugs/<slug>/BUG.md`
- Trigger Claudy review turn and confirm it runs in worktree without permission prompts
- Query `server_runtime_logs` and confirm `agent_name` / `ticket_id` are populated

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented.
- [ ] Verification run (if approved).

## Review Notes
- Claudy now runs in the ticket worktree with autonomous CLI permissions and one-turn bounded execution.
- Bug scaffold now prefills summary/repro/expected/actual/notes from intake ticket data (deterministic, no extra LLM call).
- Runtime logger now backfills metadata columns (`agent_name`, `ticket_id`, etc.) from `source`/details when top-level fields are omitted.

---

## Plan: Orchestrator Console `undefined` Suffix Cleanup

1) Fix orchestrator console wrapper so `baseConsole.log` does not receive an `undefined` details arg:
- `server/agent/multiAgent/orchestrator.ts`
2) Add structured details to the `processNextStep complete` log so `ticket_id` is populated in `server_runtime_logs` for that row:
- `server/agent/multiAgent/orchestrator.ts`
3) Verification (if approved):
- `npm run agent:dev`
- Trigger one ticket flow and confirm no `... undefined` suffix in server stdout
- Confirm `processNextStep complete` row includes `ticket_id` in `server_runtime_logs`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented.
- [ ] Verification run (if approved).

## Review Notes
- This is a console formatting issue in the orchestrator wrapper, not a workflow failure. Latest logs show Opey planning completed and ticket advanced to `planning`.

---

## Plan: Workspace Run Queue Handoff (Orchestrator -> Executor)

1) Fix orchestrator-linked workspace runs so the first queued run is actually started (not only enqueued):
- `server/agent/multiAgent/workspaceRunLinker.ts`
2) Preserve serial queue behavior while draining subsequent runs in order:
- `server/agent/multiAgent/workspaceRunLinker.ts`
3) Add structured linker logs for queued/start/complete states so stdout shows progress after orchestrator finishes:
- `server/agent/multiAgent/workspaceRunLinker.ts`
4) Verification (if approved):
- `npm run agent:dev`
- Trigger the same bug ticket flow and confirm logs continue after `processNextStep complete` with `WorkspaceRunLinker` execution logs
- Confirm `workspace_agent_runs` rows for the linked run IDs progress beyond `accepted`/`pending`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Queue handoff patch implemented in `WorkspaceRunLinker`.
- [ ] Verification run (if approved).

## Review Notes
- Root cause is likely that `WorkspaceRunLinker` enqueued runs but never kicked off queue draining in the orchestrator path, unlike the `/agent/runs` HTTP route path which explicitly starts `executeQueuedRun(...)`.

---

## Plan: Safe Command Action (Autonomous Tests/Builds)

1) Add allowlisted workspace `command` action support for safe npm scripts:
- `server/agent/policyEngine.ts`
- `server/agent/executor.ts`
- `server/agent/runStore.ts`
- `server/agent/supabaseRunStore.ts`
2) Translate deterministic Opey semantic actions into executor-supported actions:
- `server/agent/multiAgent/workspaceRunLinker.ts`
3) Add Supabase migration so `workspace_agent_run_steps.type` accepts `command`:
- `supabase/migrations/20260223_workspace_agent_command_step_type.sql`
4) Verification (if approved):
- `npm run agent:dev`
- Trigger bug ticket flow and confirm `runTests` links/executions use `command`
- Confirm `workspace_agent_runs` + `workspace_agent_run_steps` capture command exit code/output

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (`command` action + executor support + Opey action translation).
- [x] Migration file created (not executed).
- [ ] Verification run (if approved).

## Review Notes
- This adds a minimal allowlisted command path for autonomous `npm` test/build/lint scripts within the ticket worktree. It does not automate `manualVerify` browser checks yet.

---

## Plan: Claudy QA Auto-Review (Replace `manualVerify` Workspace Runs)

1) Defer Opey `manualVerify` actions from the workspace executor and log them as Claudy QA review responsibilities:
- `server/agent/multiAgent/workspaceRunLinker.ts`
- `server/agent/multiAgent/orchestrator.ts`
2) Add a linker -> orchestrator queue-settled callback so the orchestrator knows when a ticket's workspace runs are done:
- `server/agent/multiAgent/workspaceRunLinker.ts`
- `server/index.ts`
3) Auto-trigger Claudy review after workspace runs settle, with bug + Opey + run-result context:
- `server/agent/multiAgent/orchestrator.ts`
4) Verification (if approved):
- `npm run agent:dev`
- Trigger bug ticket flow and confirm `manualVerify` no longer creates a failing workspace run
- Confirm logs show `ticket runs settled` -> `auto-trigger Claudy review`
- Confirm `engineering_agent_turns` gets a Claudy review turn and verdict

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (defer `manualVerify`, queue-settled callback, auto-trigger Claudy review).
- [ ] Verification run (if approved).

## Review Notes
- `manualVerify` is an LLM QA judgment step, not a deterministic workspace executor action. This patch routes it to Claudy and adds explicit logs for queue settlement + QA handoff.

---

## Plan: Opey Planning vs Implementation Handoff (No File Edits Bug)

1) Defer non-executable semantic planning placeholders (e.g., `inspectUITextSources`, `applyFix`) instead of letting them fail as workspace runs:
- `server/agent/multiAgent/workspaceRunLinker.ts`
2) Auto-trigger an Opey `implementation` turn after planning workspace runs settle, with a strict prompt requiring concrete executor actions (`read/search/write/command/status`):
- `server/agent/multiAgent/orchestrator.ts`
3) Trigger Claudy review after Opey implementation/rework runs settle even if Opey omitted `manualVerify`:
- `server/agent/multiAgent/orchestrator.ts`
4) Add regression tests + verbose logs:
- `src/services/__tests__/multiAgentWorkflow.test.ts`
- `server/agent/multiAgent/workspaceRunLinker.ts`
- `server/agent/multiAgent/orchestrator.ts`
5) Verification (if approved):
- `npm run agent:dev`
- Trigger typo bug flow and confirm an Opey `implementation` turn is auto-triggered
- Confirm unsupported semantic planning actions are logged as deferred (not failed runs)
- Confirm Claudy review auto-triggers after implementation runs settle

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (defer semantic placeholders + auto-trigger Opey implementation + Claudy review fallback trigger).
- [x] Added linker regression tests for semantic action deferral.
- [ ] Verification run (if approved).

## Review Notes
- Root cause of “no Opey file edits” is that planning turns emitted semantic actions (`inspectUITextSources`, `applyFix`) the workspace executor cannot execute. The fix separates planning placeholders from implementation execution and adds an explicit implementation turn handoff.

---

## Plan: Runtime Error Logs for Handled Workspace Failures

1) Emit runtime `error`/`warning` logs in executor for handled non-success outcomes (not only thrown exceptions):
- `server/agent/executor.ts`
2) Map workspace linker completion log severity to run status (`failed` => error, `verification_failed` => warning):
- `server/agent/multiAgent/workspaceRunLinker.ts`
3) Verification (if approved):
- `npm run agent:dev`
- Trigger a failing `runTests` workspace run
- Query `server_runtime_logs` for `source in ('executor','workspaceRunLinker') and severity in ('warning','error')`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (executor/linker runtime failure severity logging).
- [ ] Verification run (if approved).

## Review Notes
- `server_runtime_logs` previously showed no `error` rows for failed test runs because handled failures were persisted only to `workspace_agent_runs` / `workspace_agent_run_steps`; runtime `error` logs were emitted only for thrown exceptions.

---

## Plan: Prevent False Opey Implementation Completion on Timeout/Empty Actions

1) Stop JSON repair retries for non-retryable CLI failures (timeouts) so timeouts do not become fake valid empty envelopes:
- `server/agent/multiAgent/agentCliRunner.ts`
- `server/agent/multiAgent/codexCliRunner.ts`
- `server/agent/multiAgent/claudeCliRunner.ts`
2) Prevent Opey `implementation` / `rework` turns with empty `requestedActions` from auto-advancing without an explicit directive (`verdict`/`needsHuman`/`nextStateHint`):
- `server/agent/multiAgent/orchestrator.ts`
3) Verification (if approved):
- `npm run agent:dev`
- Trigger typo bug flow and force/observe an Opey implementation timeout
- Confirm no `implementing -> ready_for_qa` transition occurs on empty implementation actions
- Confirm logs show `Skipping repair retry (non-retryable failure)` and `empty execution turn (no auto-advance)`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (non-retryable timeout failures + empty implementation guard).
- [ ] Verification run (if approved).

## Review Notes
- Root cause: Opey implementation timeout was retried with a JSON repair prompt, and the repair response returned a valid but empty `requestedActions` envelope. Orchestrator auto-advanced before checking for empty actions, causing false completion with no code changes.

---

## Plan: Persist Codex CLI Diagnostics (Opey) to Supabase

1) Add a Codex diagnostics collector that tails local Codex logs (Windows-first path discovery under `%USERPROFILE%\\.codex\\log[s]`) and safely redacts/truncates content:
- `server/agent/multiAgent/codexDiagnostics.ts`
2) Capture and persist diagnostics snapshots to `server_runtime_logs` on Codex timeout / invalid JSON / abnormal exit:
- `server/agent/multiAgent/codexCliRunner.ts`
3) Verification (if approved):
- `npm run agent:dev`
- Trigger an Opey timeout or invalid JSON turn
- Query `server_runtime_logs` for `source in ('codexCliRunner','codexDiagnostics')`
- Confirm rows include `ticket_id`, log file path, highlights, and log-tail chunks

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (Codex diagnostics capture + Supabase runtime log persistence).
- [ ] Verification run (if approved).

## Review Notes
- Diagnostics are captured on failure only (timeout / invalid JSON / abnormal exit) and stored as structured `server_runtime_logs` rows (`source='codexDiagnostics'`) with a summary row, log-tail chunks, and CLI stdout/stderr excerpts. Content is redacted and byte-capped before persistence.

---

## Plan: Explicit Patch Checkpoint Before Claudy QA

1) Add a patch collector to snapshot `git status`, `git diff --stat`, and `git diff`, persist diagnostic chunks to `server_runtime_logs`, and write patch artifacts into the ticket worktree:
- `server/agent/multiAgent/patchCollector.ts`
2) Defer Opey implementation/rework auto-advance until workspace runs settle and patch checkpoint passes:
- `server/agent/multiAgent/orchestrator.ts`
3) Block QA handoff when patch checkpoint shows no code changes, and record patch artifacts/events to Supabase:
- `server/agent/multiAgent/orchestrator.ts`
4) Include patch checkpoint artifacts and diffstat context in Claudy review prompt:
- `server/agent/multiAgent/orchestrator.ts`
5) Verification (if approved):
- `npm run agent:dev`
- Trigger typo bug flow
- Confirm `requestOpeyTurn defer autoAdvance` appears for implementation turns with actions
- Confirm `patch_checkpoint_completed` (or `empty_patch_blocked`) event rows are written
- Confirm patch artifacts (`patch_summary`, `patch_status`, `patch_diffstat`, `patch_diff`) appear in `engineering_artifacts`
- Confirm Claudy prompt handoff only occurs after a non-empty patch checkpoint

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (patch collector + patch gate + Claudy patch context).
- [ ] Verification run (if approved).

## Review Notes
- This patch adds a real `patch` checkpoint between Opey implementation and Claudy review so tickets do not advance to QA without detected code changes.

---

## Plan: PR Auto-Handoff + Opey Shell Command Normalization + CI/PR Evidence

1) Auto-trigger PR preparation after `qa_approved` using `processNextStep(...)` and watcher support for `qa_approved` tickets:
- `server/agent/multiAgent/orchestrator.ts`
- `server/agent/multiAgent/intakeWatcher.ts`
2) Normalize common Opey `shell_command` actions to executor-supported actions (`read`, `search`, `command`, `status`) and defer unsupported shell commands with clear reasons:
- `server/agent/multiAgent/workspaceRunLinker.ts`
- `src/services/__tests__/multiAgentWorkflow.test.ts`
3) Harden CI workflow for PRs (`npm ci`, non-watch tests, build step):
- `.github/workflows/ci.yml`
4) Enrich PR body with patch checkpoint artifacts, diffstat, changed files, and workspace run summaries:
- `server/agent/multiAgent/prCreator.ts`
- `server/agent/multiAgent/orchestrator.ts`
5) Verification (if approved):
- `npm run agent:dev`
- Run a ticket through `qa_approved` and confirm watcher triggers `pr_preparing` automatically
- Confirm PR body includes automation evidence section
- Confirm CI uses `npm ci`, `npm test -- --run`, and `npm run build`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (PR auto-handoff + shell_command normalization + CI/PR evidence).
- [ ] Verification run (if approved).

## Review Notes
- `qa_approved -> pr_preparing` was allowed by the state machine but not reachable automatically because no watcher/process step handled `qa_approved`; this patch closes that orchestration gap and improves PR traceability.

---

## Plan: Opey Implementation Timeout + Codex Diagnostics Stale Log Guard

1) Increase Opey Codex timeout for `implementation` / `rework` turns (keep planning at 90s):
- `server/agent/dev/opey.ts`
2) Prevent misleading Codex diagnostics snapshots when the shared local Codex log file is stale (mtime older than the Opey run window):
- `server/agent/multiAgent/codexDiagnostics.ts`
3) Verification (if approved):
- `npm run agent:dev`
- Replay the typo bug flow
- Confirm Opey implementation `CliExec` starts with a timeout > `90000`
- Confirm timeout failures (if any) log `snapshot skipped stale log file` instead of unrelated Codex session chunks

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (purpose-based Opey timeout + stale Codex diagnostics guard).
- [ ] Verification run (if approved).

## Review Notes
- The recent Opey failure was a genuine `CliExec` hard timeout at exactly `90000ms` during the implementation turn. This patch raises the implementation/rework budget and prevents shared Codex diagnostic log tails from polluting Supabase incident data when the log file mtime is older than the run start.

---

## Plan: Opey Reliability Follow-up (Heartbeat + Prompt Trim + runChecks Alias)

1) Add periodic Codex heartbeat logs during long Opey turns so long-running implementation calls show progress instead of appearing dead:
- `server/agent/multiAgent/codexCliRunner.ts`
2) Trim Opey implementation prompt context (plan excerpt, run summaries, deferred actions) to reduce prompt bloat and remove hardcoded typo text:
- `server/agent/multiAgent/orchestrator.ts`
3) Normalize `runChecks` planning action alias to the executor `command` action (same path as `runValidation`) so planning runs do not fail as unsupported:
- `server/agent/multiAgent/workspaceRunLinker.ts`
4) Verification (if approved):
- `npm run agent:dev`
- Replay the typo bug flow
- Confirm `server_runtime_logs` includes `[CodexCliRunner] runTurn heartbeat` during long implementation turns
- Confirm planning no longer emits failed `runChecks` executor runs
- Confirm Opey implementation prompt still generates concrete `write/command` actions

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (heartbeat logs + implementation prompt trimming + `runChecks` normalization).
- [ ] Verification run (if approved).

## Review Notes
- The timeout budget increase removed the old 90s cutoff, but Opey implementation can still exceed the larger budget. This follow-up improves observability (heartbeat logs), removes unnecessary prompt bulk, and closes a remaining planning action alias (`runChecks`) that was still failing as unsupported.

---

## Plan: Patch Checkpoint Meaningful Change Gate (Ignore Workflow Artifacts)

1) Fix patch checkpoint semantics so workflow artifact paths (`bugs/`, `patches/`) do not count as implementation code changes:
- `server/agent/multiAgent/patchCollector.ts`
2) Update QA handoff gating/event logs to record both "any changes" and "meaningful changes":
- `server/agent/multiAgent/orchestrator.ts`
3) Verification (if approved):
- `npm run agent:dev`
- Replay a bug ticket that only produces `BUG.md`
- Confirm patch checkpoint reports `hasAnyChanges=true` and `hasChanges=false`
- Confirm `empty_patch_blocked` fires and QA handoff is blocked

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (artifact-only patch changes no longer satisfy QA gate).
- [ ] Verification run (if approved).

## Review Notes
- Patch checkpoint files showed `STATUS.txt` = `?? bugs/` with empty `DIFFSTAT.txt` and `PATCH.diff`, but `SUMMARY.json` still marked `hasChanges=true`. This patch separates raw git status changes from meaningful implementation changes so Kera scaffolds and patch artifacts do not falsely pass the QA gate.

---

## Plan: Opey Source-Edit Recovery (Alias Normalization + Empty-Patch Rework Loop)

1) Normalize additional Opey action aliases (snake_case) so planning actions execute or defer correctly:
- `server/agent/multiAgent/workspaceRunLinker.ts`
2) When patch checkpoint detects no meaningful code changes after Opey implementation/rework, auto-trigger a bounded Opey rework turn with explicit feedback:
- `server/agent/multiAgent/orchestrator.ts`
3) Strengthen Opey implementation/rework prompt instructions to require a concrete `write` action (or explicit `blocked` / `needsHuman`):
- `server/agent/multiAgent/orchestrator.ts`
4) Verification (if approved):
- `npm run agent:dev`
- Replay the typo bug flow
- Confirm planning aliases (`read_file`, `search_repo`, `run_project_checks`) no longer fail as unsupported
- Confirm empty-patch checkpoint logs `auto-trigger Opey rework (empty patch)` with attempt counts
- Confirm either a real source `write` action occurs (non-artifact `PATCH.diff`) or bounded escalation after `maxDevAttempts`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Code patch implemented (snake_case alias normalization + bounded empty-patch rework auto-trigger + stronger write requirement prompt).
- [ ] Verification run (if approved).

## Review Notes
- The workflow is now correctly blocking QA when only `bugs/` changes exist. This follow-up targets the remaining root cause: Opey often returns read/search-only implementation turns. The orchestrator now feeds that failure back into a bounded rework loop and explicitly demands a concrete `write` action (or a clear blocked/human escalation).

---

## Plan: Opey Skill Loader + No-Questions Enforcement (Opey-Dev)

1) Add skill loader that parses SKILL.md frontmatter and metadata, supports referenced `skills/<name>/SKILL.md`:
- `server/agent/opey-dev/skillLoader.ts`
2) Inject skill context and no-questions policy into Codex/Claude prompt:
- `server/agent/opey-dev/orchestrator-openai.ts`
- `server/agent/opey-dev/orchestrator.ts`
3) Skip clarification fallback when skill tickets forbid questions:
- `server/agent/opey-dev/main.ts`
4) Verification (if approved):
- Run a skill ticket with embedded SKILL.md and confirm no clarification loop

## Progress
- [x] Skill loader added with requirements detection and SKILL.md reference parsing.
- [x] Skill context + no-questions policy injected into Opey prompts.
- [x] Clarification fallback bypassed for skill/no-questions tickets.
- [ ] Verification not run (requires approval).

## Review Notes
- Goal: Opey should handle skill tickets without asking questions while keeping bug/feature tickets intact.

---

## Plan: WhatsApp Baileys Conflict Loop Guard (Status 440)

1) Add explicit conflict/replaced detection for status `440` and `reason=conflict/replaced`, and stop auto-reconnect with a clear recovery log:
- `server/whatsapp/baileyClient.ts`
2) (Optional) Add a single-instance lock to prevent two local bridge processes from sharing `.whatsapp-auth`:
- `server/whatsapp/index.ts`
3) Verification (if approved):
- `npm run whatsapp:dev`
- Confirm on conflict: reconnect stops and logs instruct to close other WA sessions or clear `.whatsapp-auth`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [ ] Patch implementation (pending approval).
- [ ] Verification run (if approved).

## Review Notes
- Root issue appears to be a session replacement (conflict/440) from another linked WA Web session or duplicate local process; reconnecting immediately just loops.

---

## Plan: Gemini Interactions Invalid Argument Guard

1) Add request validation/sanitization before sending Interactions API requests (drop invalid media parts, enforce non-empty text input, log payload summary):
- `src/services/geminiChatService.ts`
2) Improve error logs to include sanitized input summary and model/system prompt lengths for quick diagnosis:
- `src/services/geminiChatService.ts`
3) Verification (if approved):
- `npm run whatsapp:dev`
- Send text-only and image messages; confirm no `invalid_request` and logs show sanitized payload summary

## Progress
- [x] Plan added to `tasks/todo.md`.
- [ ] Patch implementation (pending approval).
- [ ] Verification run (if approved).

## Review Notes
- Current errors show `invalid_request` from the Interactions API; likely malformed/empty input or invalid media part. Guardrails should prevent sending invalid payloads and improve diagnostics.

---

## Plan: WhatsApp GIF "This content is not available" Fix

1) Inspect GIF send flow and message payload requirements:
- `server/whatsapp/whatsappHandler.ts`
- `src/services/messageOrchestrator.ts`
2) Implement safer GIF sending (explicit mimetype, stricter validation, better host coverage/logs):
- `server/whatsapp/whatsappHandler.ts`
3) Verification (if approved):
- `npm run whatsapp:dev`
- Trigger a GIF action and confirm the received message renders (no "This content is not available")

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Read-only inspection completed (`whatsappHandler`, `messageOrchestrator`).
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- The current GIF send path uses a fetched buffer with `gifPlayback: true` but does not set `mimetype`, and only allows a narrow host set (no `media0/1.giphy.com`, `media1.tenor.com`, `c.tenor.com`).
- Follow-up likely needs size guard + fetch headers + richer logs for GIF MP4 payloads that still render as "content not available".

---

## Plan: Enforce Valid, Public GIF URLs (Giphy Canonicalization + Validation)

1) Inspect GIF validation/sending path and add canonicalization for Giphy "v1" URLs:
- `server/whatsapp/whatsappHandler.ts`
2) Add validation guardrails to ensure fetched media is public, MP4, and within size limits; fallback to text when invalid:
- `server/whatsapp/whatsappHandler.ts`
3) Verification (if approved):
- `npm run whatsapp:dev`
- Trigger a GIF action with a Giphy `v1` URL and confirm it renders (or clean fallback when invalid)

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Read-only inspection (additional) completed.
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- The reported URL is `media.giphy.com/media/v1.*` which often requires canonicalization to `media.giphy.com/media/<id>/giphy.mp4` to be publicly accessible.

---

## Plan: Gemini Interactions Proxy 500 Guardrails

1) Inspect Interactions API request/response handling and error paths:
- `src/services/geminiChatService.ts`
2) Add retry + richer diagnostics for 5xx proxy errors (request summary + response metadata):
- `src/services/geminiChatService.ts`
3) Verification (if approved):
- `npm run whatsapp:dev`
- Send a message and confirm no `Proxy error: Internal Server Error` (or logs show retries + clearer diagnostics)

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Read-only inspection completed (`geminiChatService`).
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- Current error is thrown from `createInteraction` on non-2xx responses; there is no retry or 5xx-specific context logged.
- Added persistent logging hook to emit proxy errors via `server/runtimeLogger.ts` (server) or `clientLogger` (browser).

---

## Plan: GIPHY-Only GIF Search + MP4 Rendition Selection

1) Update GIF action schema/prompt to emit a query/tag instead of a URL:
- `src/services/aiSchema.ts`
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
2) Translate `gif_action.query` into a server-side GIPHY search + MP4 rendition pick:
- `src/services/messageOrchestrator.ts`
- `server/whatsapp/whatsappHandler.ts`
3) Enforce size + content-type validation, with text fallback when no GIF found:
- `server/whatsapp/whatsappHandler.ts`
4) Verification (if approved):
- `npm run whatsapp:dev`
- Trigger a GIF action and confirm a valid MP4 renders (or fallback text when none found)

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Read-only inspection completed.
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- This uses GIPHY only and avoids LLM-provided URLs by selecting a rendition from the GIPHY API.

---

## Plan: Kayley Lessons Learned (Append-Only Memory Lane)

1) Add Supabase migration for lessons learned (1 row per CST day, append-only bullets):
- `supabase/migrations/20260303_kayley_lessons_learned.sql`
2) Add lessons learned tool schemas + tool declarations:
- `src/services/aiSchema.ts`
3) Implement lessons learned storage/retrieval + tool handler using `clientLogger` for success/failure paths:
- `src/services/memoryService.ts`
4) Add system prompt section for Lessons Learned and inject into greeting + non-greeting prompts:
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
5) Update tool usage guidance + catalog entry:
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
- `src/services/toolCatalog.ts`
6) Update docs:
- `src/services/docs/Memory_and_Callbacks.md`
- `docs/features/Lessons_Learned.md`
- `docs/README.md`
7) Verification (if approved):
- `npm test -- --run`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- Lessons are append-only like daily notes; bounded in prompt to avoid token bloat.

---

## Plan: Settings Panel Extra Divider (Random Check-ins -> Server Status)

1) Identify the separator causing the extra line between Random Check-ins and Server Status:
- `src/components/SettingsPanel.tsx`
2) Adjust the divider so only a single separator renders between sections (conditional border class or remove redundant border):
- `src/components/SettingsPanel.tsx`
3) Verification (if approved):
- `npm run dev`
- Open Settings Panel and confirm only one divider between Random Check-ins and Server Status

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Read-only inspection completed (`SettingsPanel.tsx`).
- [ ] Patch implementation (pending approval).
- [ ] Verification run (if approved).

## Review Notes
- Extra divider likely caused by `border-b` on the Proactive Features container plus `border-t` on the Server Status container.

---

## Plan: Chat Attachment Validation (Allow .md Files)

1) Confirm current attachment flow and validation points (image-only):
- `src/components/ChatPanel.tsx`
- `src/utils/clipboardImage.ts`
- `src/utils/__tests__/clipboardImage.test.ts`
- `src/types.ts`
2) Implement minimal attachment support for `.md` by reading file text and injecting into the outbound chat message (no image preview):
- `src/components/ChatPanel.tsx`
- `src/utils/clipboardImage.ts`
- `src/types.ts`
3) Update tests for new attachment validation/processing:
- `src/utils/__tests__/clipboardImage.test.ts`
4) Verification (if approved):
- `npm test -- --run src/utils/__tests__/clipboardImage.test.ts`
- `npm run dev` (manual: attach `.md` and confirm no image-only error)

## Progress
- [x] Plan added to `tasks/todo.md`.
- [ ] Patch implementation (pending approval).
- [ ] Verification run (if approved).

## Review Notes
- Assumption: `.md` attachments should be sent as text content (not as images) by injecting file contents into the chat message.

---

## Plan: Chat Attachment UI Bubble + Inline .md Payload

1) Extend chat attachment model to support markdown files with a UI bubble (name, size) and remove-only control:
- `src/components/ChatPanel.tsx`
- `src/types.ts` (if a new attachment type is needed)
2) Accept `.md` and `text/markdown` uploads (up to 1MB) and allow multiple attachments per message:
- `src/components/ChatPanel.tsx`
3) Embed markdown attachment contents into the outbound message payload using:
- `<attached_file name="filename.md">...contents...</attached_file>`
- `src/components/ChatPanel.tsx`
- `src/App.tsx` (if send signature needs extension)
4) Keep image attachments working as-is:
- `src/utils/clipboardImage.ts`
- `src/utils/__tests__/clipboardImage.test.ts`
5) Verification (if approved):
- `npm test -- --run src/utils/__tests__/clipboardImage.test.ts`
- `npm run dev` (manual: attach multiple `.md` files, confirm bubble + no image-only error)

## Progress
- [x] Plan added to `tasks/todo.md`.
- [ ] Patch implementation (pending plan verification).
- [ ] Verification run (if approved).

## Review Notes
- Requirement: UI shows attachments as a clean bubble, but the send payload inlines the file contents inside `<attached_file name="...">...</attached_file>`.
- Constraints: 1MB max per file, multiple attachments allowed, accept `.md` extension or `text/markdown` MIME type.

---

## Plan: Google OAuth Env Single Source of Truth (No VITE Client ID)

1) Standardize server env loading paths so both the workspace server and WhatsApp bridge use the same root env strategy:
- `server/index.ts`
- `server/envShim.ts`
2) Standardize Google OAuth server refresh credentials to non-VITE names only:
- `server/services/googleTokenService.ts`
3) Remove stale frontend-only type/utility references to `VITE_GOOGLE_CLIENT_ID`:
- `src/services/googleAuth.ts`
- `src/types/vite-env.d.ts`
4) Update env/docs references to prevent future drift:
- `.env.example`
- `README.md`
- `server/README.md`
5) Verification (if approved):
- `npm run whatsapp:dev`
- `npm run dev`
- `npm test -- --run`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Patch implementation (approved).
- [ ] Verification run (if approved).

## Review Notes
- Root cause target: prevent OAuth `invalid_client` by eliminating mixed env paths and mixed key naming (`VITE_GOOGLE_CLIENT_ID` vs `GOOGLE_CLIENT_ID`) in server token refresh.
- This patch keeps one server credential source (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) and one root env path strategy (`.env.local` -> `.env`).
