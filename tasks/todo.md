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
