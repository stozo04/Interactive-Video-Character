## Plan: Cron Jobs for Kayley (Server Scheduler + Chat Tool + Admin UI)

1) Add Supabase schema for scheduled jobs and run history:
- `supabase/migrations/20260220_cron_jobs.sql`
- Tables for jobs + run logs with status, schedule, timezone, and delivery state.
2) Add frontend cron service for CRUD + scheduling calculations + pending digest delivery state:
- `src/services/cronJobService.ts`
3) Add server-side scheduler worker (background loop) that:
- Claims due jobs safely
- Executes web search
- Summarizes results with LLM (with fallback if key missing)
- Stores run logs + next run timestamp
- `server/scheduler/cronScheduler.ts`
- wire startup in `server/index.ts`
4) Add LLM tool for Kayley-managed cron jobs:
- `src/services/aiSchema.ts`
- `src/services/memoryService.ts`
- `src/services/toolCatalog.ts`
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
5) Add prompt context for pending scheduled digests and a tool action to mark delivered:
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
- `src/services/system_prompts/context/scheduledDigestsContext.ts`
6) Add Admin UI for manual view/edit/delete/pause/resume/run-now:
- `src/components/AdminDashboardView.tsx`
7) Verification (if approved):
- `npm run build`
- `npm test -- --run`
- Manual: create one-time near-future job, confirm run record + summary, confirm pending digest appears and can be marked delivered.

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Migration added.
- [x] Frontend cron service added.
- [x] Server scheduler added and wired.
- [x] Tool schema/runtime/prompt updates added.
- [x] Admin UI cron management added.
- [ ] Verification run (if approved).

## Review Notes
- Goal: Kayley can create/manage cron jobs in chat, server executes jobs on schedule, and UI provides manual controls.

---

## Plan: Auto-Launch Agent On npm run dev

1) Add a PowerShell helper script to open `npm run agent:dev` in a separate terminal window when needed.
2) Prevent duplicate agent windows by checking if port `4010` is already listening.
3) Update npm scripts in `package.json`:
- add `dev:web` for Vite
- add `dev:ensure-agent` for the helper
- make `dev` run helper first, then Vite
4) Verification (if approved):
- `npm run dev`
- confirm one new PowerShell window opens with `npm run agent:dev`
- rerun `npm run dev` and confirm no extra agent window opens when agent is already running

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Helper script added.
- [x] Package scripts updated.
- [ ] Verification run (if approved).

## Review Notes
- Goal: reduce startup mistakes by making `npm run dev` bootstrap the local agent automatically.

---

## Plan: Workspace Action Immediate Ack (Option 2)

1) Keep gateway run submission async and keep SSE status updates in chat.
2) Short-circuit workspace-only tool turns in:
- `src/services/geminiChatService.ts`
- Return deterministic immediate assistant response from tool result without waiting for the second model continuation.
3) Preserve interaction continuity best-effort:
- fire tool-result continuation in background
- record interaction-id redirect map and use it on next turn when available
4) Keep all non-workspace tools on existing synchronous loop behavior.
5) Verification (if approved):
- `npm run dev`
- `npm run agent:dev`
- Manual: ask for write action, confirm immediate ack appears before final model continuation delay window.

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Workspace-only immediate-ack short-circuit.
- [x] Background continuation + interaction redirect mapping.
- [ ] Verification run (if approved).

## Review Notes
- Goal: remove wait on second Gemini continuation call for workspace-only tool turns.
- Continuity uses best-effort interaction-id redirects after background continuation resolves.

---

## Plan: Async Workspace Tool Flow In Chat (Non-Blocking)

1) Keep workspace action execution on gateway, but make chat tool calls return immediately after run acceptance.
2) Update workspace action client in:
- `src/services/projectAgentService.ts`
- Add optional non-blocking mode (`waitForTerminal: false`) to skip polling.
3) Update tool runtime bridge in:
- `src/services/memoryService.ts`
- Return clear queued/running/approval messages with run id (instead of waiting for final success/failure).
4) Stream run lifecycle updates into chat in:
- `src/App.tsx`
- Subscribe to workspace SSE events and post plain-English progress/completion bubbles.
- Backfill on reconnect using recent run list so terminal outcomes are not missed.
5) Update policy prompt wording in:
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
- Instruct Kayley to announce start/queue and only confirm completion on terminal success.
6) Verification (if approved):
- `npm run agent:dev`
- `npm run dev`
- `npm run build`
- `npm test -- --run`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Non-blocking workspace request mode.
- [x] Tool runtime async response update.
- [x] Chat SSE progress/completion updates.
- [x] Prompt guidance update.
- [ ] Verification run (if approved).

## Review Notes
- Goal: remove “typing lock” caused by waiting for workspace runs to finish before chat can continue.
- Chat now receives workspace run lifecycle updates over SSE with reconnect backfill.

---

## Plan: Workspace Agent Expanded Actions + Live Updates (Option B Config)

1) Keep current gateway startup config path per user choice (Option B), but enforce action-level guardrails in runtime policy.
2) Expand `workspace_action` scope to support:
- `mkdir`
- `read`
- `write`
- `status`
- `search`
- `commit`
- `push`
- `delete`
3) Enforce stricter safety rule:
- `commit`, `push`, and `delete` must never execute without verification checks.
- `delete` requires approval.
- `commit` and `push` require approval.
4) Add run states for approval and verification outcomes:
- `requires_approval`
- `verification_failed`
5) Add live update transport:
- SSE endpoint for run updates
- frontend EventSource subscription in Admin -> Agent mode
 - 20s heartbeat events to avoid radio silence
 - serial run queue (single active run)
6) Keep dashboard as main operator surface:
- run timeline
- pending approvals
- verification evidence

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Finalize approval policy for `commit`/`push` (user confirmation).
- [x] Backend action engine expansion.
- [x] SSE live updates.
- [x] Frontend tool/schema updates.
- [x] 20s heartbeat updates added to SSE stream and Admin Agent panel.
- [x] Single-run queue enforced at gateway (next run starts after terminal state).
- [ ] Verification run (if approved).

## Review Notes
- User selected Option B startup config and requested no commit/push/delete execution without verification.
- User confirmed `commit`, `push`, and `delete` all require approval.

---

## Plan: Workspace Agent Supabase Persistence (No In-Memory Fallback)

1) Add Supabase schema for agent runs and run steps in:
- `supabase/migrations/20260220_workspace_agent_runs.sql`
2) Add Supabase-backed run store in:
- `server/agent/supabaseRunStore.ts`
3) Switch gateway to require Supabase env and remove in-memory fallback in:
- `server/index.ts`
4) Update gateway execution + routes to use async run store interface in:
- `server/agent/runStore.ts`
- `server/agent/executor.ts`
- `server/routes/agentRoutes.ts`
5) Verification (if approved):
- `npm run agent:dev`
- `npm run dev`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Supabase migration added.
- [x] Supabase run store added.
- [x] Gateway switched to required Supabase persistence (no fallback).
- [x] Async run store integration completed.
- [ ] Verification run (if approved).

## Review Notes
- User explicitly requested no in-memory fallback.
- Agent process now fails fast at startup if required Supabase env vars are missing.

---

## Plan: Admin Dashboard Agent Monitor (Health + Runs)

1) Expose gateway read endpoints for dashboard visibility:
- `GET /agent/health`
- `GET /agent/runs?limit=...`
2) Extend in-memory run store to support run listing/count for UI.
3) Add frontend read APIs in `src/services/projectAgentService.ts`.
4) Integrate an `Agent` mode into `src/components/AdminDashboardView.tsx`:
- health badge
- recent runs list
- step/evidence detail panel
- refresh and auto-refresh controls
5) Keep `Settings` navigation unchanged:
- use existing `Admin Dashboard` entry (no new separate settings button)
6) Verification (if approved):
- `npm run agent:dev`
- `npm run dev`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Endpoint + store updates.
- [x] Frontend service updates.
- [x] Admin dashboard UI integration.
- [ ] Verification run (if approved).

## Review Notes
- User correction captured: avoid a separate dashboard route in settings; agent monitor should live inside Admin Dashboard.

---

## Plan: Gateway-First Async Run Lifecycle (mkdir)

1) Change workspace run creation to async:
- `POST /agent/runs` returns `202 accepted` immediately.
2) Execute mkdir run in background worker on gateway.
3) Keep `GET /agent/runs/:id` as poll endpoint for current status.
4) Update frontend agent bridge to poll until terminal status:
- `success`
- `failed`
- `verification_failed`
5) Keep scope small:
- action remains `mkdir` only
- no process write/kill endpoints yet
6) Verification (if approved):
- `npm run build`
- `npm test -- --run`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Run lifecycle switched to `accepted -> background execution`.
- [x] Frontend polling flow implemented.
- [ ] Verification run (if approved).

## Review Notes
- Purpose: move privileged local changes into gateway-managed lifecycle before adding more actions.

---

## Plan: OpenClaw Tool Configuration Parity Audit (Docs)

1) Compare current tool architecture to OpenClaw tool model:
- tool policy (`allow`/`deny`)
- profiles and provider overrides
- runtime (`exec` + `process`)
- approval/security knobs
- loop detection policy
2) Document gaps and required migrations in:
- `docs/features/Kayley_Workspace_Agent_Implementation_Plan.md`
3) Keep this docs-only; no code/runtime changes in this step.

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Parity audit documented.

## Review Notes
- Goal is implementation guidance only: what to change and in what order.

---

## Plan: OpenClaw-Aligned Runtime Docs Update

1) Update workspace agent feature plan with OpenClaw-style runtime concepts:
- asynchronous run lifecycle
- background process management controls
- approval/security mode matrix
- service supervision runbook
2) Keep update docs-only in:
- `docs/features/Kayley_Workspace_Agent_Implementation_Plan.md`
3) Verification (if approved): docs review only (no command execution needed).

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Feature plan doc updated.

## Review Notes
- This update refines implementation sequencing; no runtime code changes in this step.

---

## Plan: Workspace Agent Chat Wiring (Phase 2 - mkdir tool only)

1) Add frontend bridge service for workspace agent API:
- `src/services/projectAgentService.ts`
2) Add `workspace_action` tool schema (mkdir-only) in:
- `src/services/aiSchema.ts`
3) Add `workspace_action` runtime execution path in:
- `src/services/memoryService.ts`
4) Add prompt/tool-catalog guidance so LLM knows when to call it:
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
- `src/services/toolCatalog.ts`
5) Keep scope strict:
- only `action="mkdir"`
- no read/write/git/search in this phase
6) Verification (if approved):
- `npm run build`
- `npm test -- --run`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Frontend bridge service added.
- [x] Tool schema declarations updated.
- [x] Runtime execution path updated.
- [x] Prompt/catalog guidance updated.
- [ ] Verification run (if approved).

## Review Notes
- Goal is end-to-end chat-triggered folder creation with policy + verification from backend run status.

---

## Plan: Workspace Agent Vertical Slice (Phase 1 - mkdir only)

1) Create backend skeleton for agent runs with minimal endpoints:
- `POST /agent/runs`
- `GET /agent/runs/:id`
2) Implement in-memory run store and deterministic run lifecycle state.
3) Add root-jail path guard and policy gate for `mkdir` action only.
4) Execute safe `mkdir` operation with verification (`directory exists` check).
5) Wire initial TypeScript modules:
- `server/index.ts`
- `server/routes/agentRoutes.ts`
- `server/agent/runStore.ts`
- `server/agent/pathGuard.ts`
- `server/agent/policyEngine.ts`
- `server/agent/fsOps.ts`
6) Keep this slice backend-only (no frontend tool wiring yet).
7) Verification (if approved):
- `npm run build`
- `npm test -- --run`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Backend skeleton created.
- [x] Path guard + mkdir policy implemented.
- [x] mkdir execution + verification implemented.
- [ ] Verification run (if approved).

## Review Notes
- Scope intentionally limited to a single safe action (`mkdir`) to validate architecture before adding write/search/git operations.
- Added files:
- `server/index.ts`
- `server/routes/agentRoutes.ts`
- `server/agent/runStore.ts`
- `server/agent/pathGuard.ts`
- `server/agent/policyEngine.ts`
- `server/agent/fsOps.ts`

---

## Plan: Runtime Stability Fixes (Phase 2B Follow-Up)

1) Fix context synthesis watermark query to use valid timestamp columns per table in `src/services/contextSynthesisService.ts`.
2) Include `storyline_updates` watermark so storyline edits invalidate synthesis freshness checks.
3) Remove API key from Interactions request URL in `src/services/geminiChatService.ts` (header-only key).
4) Verification (if approved): `npm test -- --run`, then manual non-greeting turn to confirm:
- no `life_storylines.updated_at` 400
- no `key=` in Interactions request URL.

## Progress
- [x] Watermark source mapping patched (`life_storylines.created_at`, `storyline_updates.created_at`).
- [x] Interactions URL patched to remove `?key=` query parameter.
- [x] Active recall semantic timeout stabilization patched to race late semantic completion vs lexical fallback.
- [x] Interactions tool-loop hardening patched (dynamic `create_life_storyline` gating + duplicate call suppression).
- [x] Fallback prompt sections bounded with hardcoded constants (daily notes, Mila milestones, curiosity facts, answered idle questions).
- [x] Active recall timeout logging refined to avoid false fallback warnings when semantic recovers.
- [x] Calendar prompt date-only handling fixed to prevent birthday/reminder timezone drift from appearing as timed events on wrong day.
- [x] Calendar ownership guardrails added (prompt policy + calendar context + live injected label + persona temporal grounding).
- [ ] Verification not run (requires approval).

## Review Notes
- Focused fixes only; no schema mutations and no behavior changes outside watermark/read-path logging and request URL construction.

---

## Plan: Feature Notes Article (Tool Suggestions / Agency Gap)

1) Capture plan + scope based on commit `78448025dc68969f0a5f9653fe7ac7634c43717d`.
2) Draft blog post with required sections and constraints in `docs/Feature_Notes.txt`.
3) Fix encoding artifacts in `docs/Feature_Notes.txt` (e.g., smart quotes, en dashes).
4) Optional verification (if approved): `npm test -- --run`.

## Progress
- [x] Plan captured
- [x] Draft written in `docs/Feature_Notes.txt`
- [x] Encoding cleaned in `docs/Feature_Notes.txt`
- [ ] Verification run (if approved)

## Review Notes
- Draft complete; awaiting any edits or verification requests.

---

## Plan: Mila Moments Tool Call (Append-Only Notes)

1) Review existing daily notes flow and tool plumbing (`src/services/memoryService.ts`, `src/services/aiSchema.ts`, `src/services/system_prompts/tools/toolsAndCapabilities.ts`, `src/services/system_prompts/builders/systemPromptBuilder.ts`).
2) Define `mila_milestone_notes` table schema (UTC `created_at`, optional `note_entry_date`) + helper functions + migration under `supabase/migrations/`.
3) Add `mila_note` + `retrieve_mila_notes` tool schemas, args types, declarations, and pending tool list updates (`src/services/aiSchema.ts`).
4) Implement tool execution + retrieval by month (`src/services/memoryService.ts`).
5) Add tool usage guidance (`src/services/system_prompts/tools/toolsAndCapabilities.ts`).
6) Inject Mila milestones prompt section (similar to DAILY NOTES) (`src/services/system_prompts/builders/systemPromptBuilder.ts`).
7) Update tool catalog (`src/services/toolCatalog.ts`).
8) Verification (if approved): `npm test -- --run -t "snapshot"`, `npm test -- --run`.

## Progress
- [x] Migration, services, schemas, prompts, and tool catalog updated.
- [x] Verification run (user-confirmed).

## Review Notes
- Verified by user. Ready to commit.

---

## Plan: Mila Milestones Documentation + No .single() Guidance

1) Add feature doc for Mila milestones in `docs/features/`.
2) Update tool integration guidance to avoid `.single()` when rows may be absent (`docs/AI_Notes_Tool_Integration_Checklist.md`).
3) Verification (if approved): none required (docs only).

## Progress
- [x] Documentation created and checklist updated.

## Review Notes
- Done; no verification needed.

---

## Plan: Stop Silent Google OAuth On Startup (Option 1) + Bug Update

1) Document findings and fix plan in `docs/bugs/BUG-2026-02-01-google-auth-gmail-401.md`.
2) Update Google auth startup logic to avoid silent OAuth on load in `src/contexts/GoogleAuthContext.tsx`.
3) Adjust any related messaging or guardrails if needed in `src/services/googleAuth.ts` and `src/components/AuthWarningBanner.tsx`.
4) Verification (if approved): `npm test -- --run` and/or `npm run dev`.

## Progress
- [x] Bug doc updated with findings + fix
- [x] Silent OAuth on startup disabled
- [x] Guardrails/messaging reviewed
- [ ] Verification run (if approved)

## Review Notes
- Pending approval to patch.

---

## Plan: Improve IdleThinking "Theme Recently Used" Log

1) Confirm desired log detail and format in `src/services/idleThinkingService.ts`.
2) Update the log message and context payload for the theme-skip case.
3) Verification (if approved): `npm test -- --run`.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: Canonicalize User Facts + Pinned Facts + Data Cleanup

1) Define canonical keys (e.g., identity.nickname) and pinning flag behavior.
2) Normalize existing data in C:\Users\gates\Downloads\user_facts_rows.json and return cleaned JSON.
3) Update server-side fact normalization + tool rules to enforce canonical keys.
4) Optional: add dynamic pinned-facts section to greeting prompt (if approved).
5) Verification (if approved): 
pm test -- --run.

---

## Plan: AI Returns Empty Object Response ({}) Bug

1) Get console log file path and HAR file path (confirm safe to inspect).
2) Review logs + HAR to capture request/response payloads, HTTP status, and parsing flow.
3) Identify likely root-cause area(s) in code and note risks/edge cases.
4) Draft a bug document in `docs/bugs/` with findings, evidence, and next steps.
5) Verification (if approved): `npm test -- --run`.

## Progress
- [x] Logs and HAR reviewed.
- [x] Root cause identified (tool loop hits max iterations, no text output).
- [x] Bug doc created in `docs/bugs/BUG-2026-02-11-ai-empty-object-response.md`.
- [ ] Verification not run (requires approval).

## Review Notes
- Ready for review.

---

## Plan: Phase 2 Codex Implementation Document

1) Reconcile existing Phase 2 concept with current production architecture (`synthesis` + `anchor` + non-greeting prompt flow).
2) Define implementation-ready service contract for per-turn active recall (Phase 2a lexical, Phase 2b optional semantic).
3) Map exact file touch points and rollout flags for low-risk integration.
4) Create a new implementation document in `docs/phase2_implementation_codex.md`.
5) Verification (if approved): `npm run build`, `npm test -- --run`.

## Progress
- [x] Existing docs + relevant services inspected.
- [x] Drafted and created implementation document in `docs/phase2_implementation_codex.md`.
- [ ] Verification not run (requires approval).

## Review Notes
- Document focuses on a shippable Phase 2a with deterministic scoring and fail-open behavior.

---

## Plan: Phase 2A Best-Of-Both Final Plan

1) Merge the product framing from `docs/phase2_plan.md` with concrete implementation details from `docs/phase2_implementation_codex.md`.
2) Resolve identified plan gaps: numeric confidence mapping, lexical-gated scoring, integration path through `geminiChatService`, and explicit prompt/latency caps.
3) Create a new final planning doc in `docs/phase2_plan_final.md` without overwriting existing drafts.
4) Verification (if approved): `npm run build`, `npm test -- --run`.

## Progress
- [x] Merge strategy defined from both docs.
- [x] Final merged plan document created.
- [ ] Verification not run (requires approval).

## Review Notes
- Created `docs/phase2_plan_final.md` with merged product framing + implementation-ready technical details.

---

## Plan: Phase 2A Uncommitted Implementation Review

1) Compare uncommitted Phase 2A code to `docs/phase2_plan_final.md`.
2) Validate integration path (`geminiChatService` -> `systemPromptBuilder` -> `activeRecallService`).
3) Identify severity-ordered defects and plan drift.
4) Record findings/questions in a docs review file.

## Progress
- [x] Uncommitted diffs inspected for Phase 2A files.
- [x] Plan-vs-code comparison completed.
- [x] Review written to `docs/phase2a_implementation_review.md`.
- [ ] Verification not run (requires approval).

## Review Notes
- Primary residual issue: lexical gating rule from the finalized plan is not implemented yet.

---

## Plan: Expand Phase 2B in Final Plan Doc

1) Re-read `docs/phase2_plan_final.md` and identify missing Phase 2B implementation detail.
2) Merge prior semantic retrieval ideas with current Phase 2A guardrails.
3) Expand Phase 2B with migration design, sync pipeline, runtime mode flags, fallback behavior, and acceptance criteria.
4) Keep verification commands proposed only (do not run).

## Progress
- [x] Phase 2B gaps identified.
- [x] `docs/phase2_plan_final.md` expanded with detailed Phase 2B sections.
- [ ] Verification not run (requires approval).

## Review Notes
- Phase 2B now includes schema, sync triggers, hybrid retrieval mode, rollout/rollback, observability, and acceptance criteria.

---

## Plan: Build Phase 2B

1) Extend `src/services/activeRecallService.ts` to support retrieval modes (`lexical`, `hybrid`, `semantic`) with semantic-first fallback chain.
2) Add `src/services/factEmbeddingsService.ts` for embedding generation, semantic match RPC calls, and source sync helpers.
3) Wire embedding sync hooks into fact/storyline write paths:
- `src/services/memoryService.ts`
- `src/services/characterFactsService.ts`
- `src/services/storylineService.ts`
4) Add semantic index migration in `supabase/migrations/20260213_phase2b_fact_embeddings.sql`.
5) Verification (if approved): `npm run build`, `npm test -- --run`.

## Progress
- [x] Retrieval mode support implemented in `src/services/activeRecallService.ts`.
- [x] Embedding service created at `src/services/factEmbeddingsService.ts`.
- [x] Write-path sync hooks added for user facts, character facts, and storylines.
- [x] Migration created at `supabase/migrations/20260213_phase2b_fact_embeddings.sql`.
- [ ] Verification not run (requires approval).

## Review Notes
- Implementation is fail-open: semantic path degrades to lexical, then empty section.

---

## Plan: Context Synthesis Review + Codex Solution Doc

1) Review `docs/context_synthesis_thoughts.md` and extract strengths, risks, and unresolved design gaps.
2) Create a new solution document in `docs/context_synthesis_thoughts_codex_solution.md` with:
- problem restatement
- review of current proposal
- recommended architecture
- phased implementation
- observability, guardrails, and rollback
3) Propose verification commands (if approved): `Get-Content docs/context_synthesis_thoughts_codex_solution.md`, `git diff -- docs/context_synthesis_thoughts_codex_solution.md`.

## Progress
- [x] Existing context synthesis doc reviewed.
- [x] Plan approved by user.
- [x] New solution doc drafted.

## Review Notes
- Created `docs/context_synthesis_thoughts_codex_solution.md` with a critical review of the current proposal and a revised architecture (versioned snapshots, per-turn relevance selector, and conversation anchor).

---

## Plan: Phase 1 Code Review Document

1) Re-read `docs/context_synthesis_thoughts.md` and extract revised Phase 1 expectations.
2) Review all uncommitted Phase 1 changes (`src/services/**`, `supabase/migrations/**`) against the plan.
3) Create `docs/phase1_Review.md` with severity-ordered findings, evidence, and targeted recommendations.
4) Document open questions and verification gaps (tests/build not executed).

## Progress
- [x] Updated plan reviewed.
- [x] Uncommitted code/migrations inspected.
- [x] Review document drafted in `docs/phase1_Review.md`.

## Review Notes
- Completed review doc with severity-ordered findings and file/line evidence.

---

## Plan: Phase 1 Re-Review (Post-Fixes)

1) Re-check prior 10 findings against current uncommitted code.
2) Validate each fix with file-level evidence.
3) Identify any new bugs/oversights introduced by the latest changes.
4) Overwrite `docs/phase1_Review.md` with updated conclusions.

## Progress
- [x] Prior findings re-validated against current code.
- [x] New risks/oversights assessed.
- [x] `docs/phase1_Review.md` overwritten with updated review.

## Review Notes
- All original 10 findings are addressed; residual/new items are mostly medium/low risk (topic key quality, hot-path query overhead, migration schema guard edge case).

---

## Plan: Phase 1 Re-Review (Third Pass)

1) Re-validate all previously reported findings against the latest uncommitted code.
2) Confirm user-reported fixes in `contextSynthesisService.ts`, `topicExhaustionService.ts`, and migration SQL.
3) Identify any new bugs/oversights introduced by those fixes.
4) Overwrite `docs/phase1_Review.md` with updated findings.

## Progress
- [x] Prior findings re-checked.
- [x] Latest 3 fix claims validated in code.
- [x] New/residual issues documented.
- [x] `docs/phase1_Review.md` overwritten.

## Review Notes
- Third-pass review completed. Prior findings are resolved; remaining items are new/residual robustness concerns around runtime schema validation for `seed_topics`, strictness of topic-key filtering, and idempotent seeding under concurrency.

---

## Plan: Verify Remaining Phase 1 Findings (Pre-Anchor)

1) Re-read `docs/phase1_Review.md` and list unresolved findings.
2) Validate fixes in `src/services/contextSynthesisService.ts`, `src/services/topicExhaustionService.ts`, and `supabase/migrations/20260213_topic_exhaustion.sql`.
3) Check for new regressions in the same code paths.
4) Deliver a severity-ordered code review result before starting conversation-anchor work.

## Progress
- [x] Review request acknowledged and scope defined.
- [x] Findings re-validated against current code.
- [x] New regressions assessed.
- [x] Final verification review delivered.

## Review Notes
- Verification complete: all items from `docs/phase1_Review.md` are fixed in code. One new robustness risk identified in `src/services/contextSynthesisService.ts` (topic array element type not validated before `isQualityTopicKey`).

---

## Plan: Phase 1b Conversation Anchor Design Doc

1) Translate agreed Phase 1b goals into an implementation-ready plan in `docs/`.
2) Include proactive guardrails for freshness, cadence, first-turn missing `interactionId`, contradiction handling, and prompt size limits.
3) Define migration schema, service API contract, update heuristics, prompt injection order, and rollback strategy.
4) Add a focused test plan and acceptance criteria.

## Progress
- [x] Scope and risk guardrails confirmed with user.
- [x] Phase 1b design doc drafted in `docs/`.
- [x] Review summary delivered.

## Review Notes
- Created `docs/phase1b_conversation_anchor_plan.md` with detailed schema, service contracts, update heuristics, prompt injection order, rollout/rollback, and test matrix.

---

## Plan: Fix X Media Upload 403 (Add media.write scope + guardrails)

1) Confirm current upload/auth flow and token scopes in `src/services/xTwitterService.ts`.
2) Update OAuth scope to include `media.write` and add a clear guardrail if scope is missing.
3) Ensure upload errors preserve response details for debugging (no behavior change beyond logging).
4) Verification (if approved): reconnect X account, then `npm run dev` and attempt a tweet with media.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: Align X Media Upload With X Best Practices (Binary Upload + Size Guard)

1) Adjust `uploadMedia` to send raw binary (`media`) instead of base64 `media_data` to avoid Content-Transfer-Encoding requirements in `src/services/xTwitterService.ts`.
2) Add explicit size/type checks for images (<= 5 MB; JPG/PNG/GIF/WEBP) with clear errors in `src/services/xTwitterService.ts`.
3) Make `media_category=tweet_image` explicit in the upload request for clarity.
4) Verification (if approved): reconnect X account, then `npm run dev` and attempt a tweet with a generated image.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: Switch Media Upload To X v2 Endpoint (OAuth2-Compatible)

1) Update media upload to call `/api/x/2/media/upload` with `multipart/form-data` or JSON per docs in `src/services/xTwitterService.ts`.
2) Parse v2 response (`data.id`) and use it as the media id for tweet creation in `src/services/xTwitterService.ts`.
3) Keep existing size/type guards and scope checks.
4) Verification (if approved): reconnect X account, then `npm run dev` and attempt a media tweet.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: X Media Upload UX Guardrail + Tests

1) Add X token scope check for UI in `src/services/xTwitterService.ts`.
2) Surface a missing `media.write` banner in `src/components/SettingsPanel.tsx`.
3) Add a focused unit test for media upload response parsing in `src/services/__tests__/xTwitterService.test.ts`.
4) Verification (if approved): `npm test -- --run -t "xTwitterService"` (or full `npm test -- --run`).

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: X Posting Mode Lookup 406 (Use maybeSingle)

1) Update the `user_facts` lookup for `x_posting_mode` to use `.maybeSingle()` in `src/services/idleThinkingService.ts`.
2) Update the settings panel lookup to use `.maybeSingle()` in `src/components/SettingsPanel.tsx`.
3) Confirm no behavior regressions when the row is missing (defaults still apply).
4) Verification (if approved): `npm test -- --run`.

## Progress
- [x] Updated `x_posting_mode` lookups to use `.maybeSingle()`.
- [ ] Verification not run (requires approval).

## Review Notes
- Ready for review.

---

## Plan: Active Recall Timeout Noise Reduction

1) Switch active recall config to code constants (no env dependency) in `src/services/activeRecallService.ts`.
2) Increase default timeout values to reduce false timeout errors on normal latency.
3) Log timeout failures as warning (expected fail-open), keep non-timeout failures as error.
4) Verification (if approved): `npm run build`, `npm test -- --run`, manual chat turn to inspect console logs.

## Progress
- [x] Plan captured in `tasks/todo.md`.
- [x] Patch completed in `src/services/activeRecallService.ts`.
- [ ] Verification pending approval.

## Review Notes
- Requested by user: keep config as constants, no env files.

---

## Plan: Phase 2 Runtime Validation + Sequential Fixes

1) Create a runtime validation review doc from:
- `C:\Users\gates\Downloads\convo.txt`
- `C:\Users\gates\Downloads\non-greeting.txt`
- `C:\Users\gates\Downloads\non-greeting-network-1.txt`
- `C:\Users\gates\Downloads\non-greeting-network-2.txt`
2) Capture severity-ranked findings, expected-vs-actual behavior, and concrete remediation order.
3) Execute fixes one-by-one only after user confirmation per step.
4) Verification (if approved later): `npm run build`, `npm test -- --run`, targeted manual non-greeting conversation replay.

## Progress
- [x] Runtime artifacts reviewed (read-only).
- [x] Findings summarized for user.
- [x] Documentation created in `docs/phase2_runtime_validation_review.md`.
- [x] Step 1 approved and implemented in `src/services/geminiChatService.ts`.
- [x] Step 2 approved and implemented in `src/services/activeRecallService.ts`.
- [x] Step 3 approved and implemented in `src/services/activeRecallService.ts`.
- [x] Step 4 approved and implemented in `src/services/system_prompts/builders/systemPromptBuilder.ts`.
- [ ] Next sequential fix pending user approval.
- [ ] Verification pending approval.

## Review Notes
- Initial runtime audit indicates active recall is wired and fail-open, but semantic retrieval is not materially contributing in sampled turns.
- Step 1 logging redaction is implemented; runtime verification is still pending.
- Step 2 relevance tightening is implemented; runtime verification is required to confirm lower recall noise.
- Step 3 semantic tuning is implemented; runtime verification is required to confirm higher semantic contribution rate.
- Step 4 fallback prompt bloat reduction is implemented; runtime verification is required to confirm improved prompt focus.


---

## Plan: Cron Failure Visibility + Cron Activity Log

1) Add cron activity event storage:
- `supabase/migrations/20260220_cron_job_events.sql`
- table for lifecycle logs (created/updated/deleted/paused/resumed/run-triggered/run-success/run-failed/etc.)
2) Add cron event and failure queue support in service:
- `src/services/cronJobService.ts`
- add event types + list API + write helper
- add query for pending failed cron alerts
3) Add scheduled prompt context for failed runs:
- `src/services/system_prompts/context/scheduledDigestsContext.ts`
- include failed-run alerts alongside successful digests and use mark action after sharing
4) Add immediate failure chat message from scheduler:
- `server/scheduler/cronScheduler.ts`
- on execution failure, insert model message row into `conversation_history` and mark failed run delivered
5) Add admin Cron Jobs activity log panel:
- `src/components/AdminDashboardView.tsx`
- show event timeline including create/edit/delete and run success/failure
6) Verification (if approved):
- `npm run build`
- `npm test -- --run`

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Migration added.
- [x] Cron service updates.
- [x] Prompt context updates.
- [x] Scheduler failure notification updates.
- [x] Admin Cron activity log UI updates.
- [ ] Verification run (if approved).

## Review Notes
- Goal: avoid silent cron failures and provide visible lifecycle logs in chat + admin UI.

---

## Plan: Fix Timed Promise Selfie Delivery

1) Ensure promise mirror cron execution queues a real pending promise delivery (not summary-only).
2) Mark source promise fulfilled when queued by scheduler.
3) Add client pending-message consumption loop in chat to deliver queued messages (including selfie generation).
4) Verification (if approved):
- `npm run build`
- Manual timed promise test at near-future time.

## Progress
- [x] Scheduler queues pending promise deliveries for `promise_reminder:*` cron jobs.
- [x] Scheduler marks corresponding promise as fulfilled.
- [x] Chat consumes pending messages every 30s in `chat` view and renders selfie messages with image when applicable.
- [ ] Verification run (if approved).

## Review Notes
- Root cause: cron mirror previously logged reminder success but did not execute fulfillment path.

Update: Scoped pending-message delivery to cron source and added cron success/failure text queueing so cron outputs surface in chat without draining unrelated backlog.

Update: Pending cron delivery now uses fetch-then-ack (ack only after chat append success) to prevent silent drops.

---

## Plan: WhatsApp Reply JID (LID vs PN)

1) Confirm current reply routing in:
- `server/whatsapp/whatsappHandler.ts`
2) Decide desired behavior for self-chat LID:
- reply to `WHATSAPP_PHONE_JID` only, or send to both `@lid` and `@s.whatsapp.net`
3) Implement reply JID selection + logging (minimal change):
- `server/whatsapp/whatsappHandler.ts`
4) Optional: log local account JID on connect to help set env var:
- `server/whatsapp/baileyClient.ts`
5) Verification (if approved):
- Manual: send self-chat message and confirm delivery appears on phone and (optionally) UI dashboard.

## Progress
- [x] Plan added to `tasks/todo.md`.
- [x] Normalization helper added in `server/whatsapp/baileyClient.ts`.
- [x] Reply JID plumbed through `server/whatsapp/whatsappHandler.ts`.
- [ ] Verification pending approval.

## Review Notes
- Goal: ensure WhatsApp replies appear on the phone when inbound JID is `@lid`.

---

## Plan: WhatsApp US JID Normalization (SenderPn/LID)

1) Add a small normalization helper to prefer `senderPn`/`participantPn` when available:
- `server/whatsapp/baileyClient.ts`
2) If inbound `remoteJid` ends with `@lid`, map to `@s.whatsapp.net` using:
- `remoteJidAlt` or `participantPn` when present
3) Pass the normalized reply JID into the handler so replies land on the phone:
- `server/whatsapp/whatsappHandler.ts`
4) Add structured logs for normalization decisions (US numbers only, no BR fixes).
5) Verification (if approved):
- Manual: send a self-chat message and confirm the reply appears on the phone and in the intended thread.

## Progress
- [x] Plan added to `tasks/todo.md`.
- [ ] Waiting on approval to patch.

## Review Notes
- Scope: US numbers only; avoid Brazil-specific digit correction or contact merge logic.

---

## Plan: Grok Selfie Random Reference Fallback (WhatsApp)

1) Add a Grok-safe reference picker that can return a random URL when selection fails:
- `src/utils/referenceImages/index.ts`
2) Use the random URL fallback in Grok selfie generation when `selectedReferenceURL` is missing:
- `src/services/imageGenerationService.ts`
3) Add explicit structured logs for missing reference + fallback choice:
- `src/services/imageGenerationService.ts`
4) Verification (if approved):
- Manual: WhatsApp selfie request with Grok enabled
- `npm test -- --run`

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Goal: avoid Grok 422 “image.url missing” by always providing a valid reference URL.

---

## Plan: Save WhatsApp Selfies Server-Side (No /api/save-selfie)

1) Skip client-only auto-save when running in Node to avoid invalid relative URL:
- `src/services/imageGenerationService.ts`
2) Save WhatsApp selfie images directly in the server handler:
- `server/whatsapp/whatsappHandler.ts`
3) Add structured logs for saved file path/filename:
- `server/whatsapp/whatsappHandler.ts`
4) Verification (if approved):
- Manual WhatsApp selfie request

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Goal: keep dev web auto-save working while persisting WhatsApp selfies in `selfies/`.

---

## Plan: WhatsApp GIF/Video URL Validation + Logging

1) Add a shared media fetch/validation helper to verify URL fetchability, status, content-type, and non-empty payload:
- `server/whatsapp/whatsappHandler.ts`
2) Use the validator for GIF MP4 sending with explicit fallback text/logs when invalid:
- `server/whatsapp/whatsappHandler.ts`
3) Use the validator for standard video sending with explicit fallback text/logs when invalid:
- `server/whatsapp/whatsappHandler.ts`
4) Verification (if approved):
- Manual: trigger a GIF and video response, confirm either media sends or fallback text with clear logs.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Goal: prevent made-up `gifUrl`/`videoUrl` from being sent; only send verified MP4 content.

---

## Plan: WhatsApp Media Understanding (Images + GIF/Video)

1) Inbound media capture:
- Use `downloadMediaMessage` for images, stickers, and video/GIF in `server/whatsapp/baileyClient.ts`.
2) Image/sticker understanding:
- Convert sticker WebP to JPEG via `sharp`.
- Send `image_text` input to Gemini (text + base64) from `server/whatsapp/baileyClient.ts` → `handleWhatsAppMessage`.
3) Video/GIF understanding:
- Option A: Extract first frame using ffmpeg (system dependency) and send as `image_text`.
- Option B: If no frame extraction, send a text placeholder only (no visual understanding).
4) Wire messageOrchestrator to accept `image_text` user content for WhatsApp path if needed:
- `src/services/messageOrchestrator.ts`
5) Verification (if approved):
- Manual: send image, sticker, GIF MP4, and video; confirm logs and Kayley’s descriptions.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Decision needed: allow ffmpeg dependency for video/GIF frame extraction, or accept text-only understanding for video/GIF.
