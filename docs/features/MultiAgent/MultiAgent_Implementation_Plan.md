# Multi-Agent Engineering Workflow Implementation Plan

Created: 2026-02-22
Status: Planning (no code changes in this document)

## Goal

Build a server-side multi-agent engineering workflow where:

- Kayley routes engineering work to Kera (assistant/coordinator)
- Kera manages intake, ticketing, and handoff
- Opey implements changes using the existing workspace agent execution system
- Claudy reviews/tests and either approves or returns findings
- The system persists all status/history so you can monitor and intervene

This plan is intentionally staged so you can get a reliable system first, then add higher autonomy (multi-LLM debate, PR creation, etc.) without creating an expensive or unsafe loop.

## Locked Decisions (2026-02-22)

These decisions are now fixed for v1 unless intentionally changed later.

- Ticket model:
  - One shared base ticket template for `skill`, `bug`, and `feature`
  - Differentiated by `request_type`
- Ticket creation:
  - Kayley creates tickets immediately in v1
  - Clarifications happen after intake via the engineering team
- Completion target:
  - Automation terminal status is `pr_ready`
  - Actual PR is created in v1 and recorded as an event (`pr_created`) with `pr_url`
- Agent runtimes (no API calls for engineering agents):
  - `Kera` = `codex` CLI (smaller/cheaper config)
  - `Opey` = `codex` CLI (stronger config)
  - `Claudy` = `claude` / Claude Code CLI (review/QA)
- Turn execution mode:
  - one-shot CLI invocation per agent turn (v1)
  - persistent CLI sessions deferred to later phase
- Turn output format:
  - structured JSON required for every agent turn
  - orchestrator validates/parses before applying any state transition
- Execution model:
  - `dangerous + bounded`
  - Agents can run dangerous commands inside a contained environment and ticket worktree
  - Bounds are mandatory (timeouts, pass limits, command caps, kill switch, audit trail)
- Workspace isolation:
  - One `git worktree` per ticket
  - One active engineering ticket at a time for v1
- PR creation method:
  - `gh` CLI in the contained environment
- Traceability rule:
  - All engineering work must be attached to a ticket
  - Direct agent/team chat may exist, but execution work must create or attach to a ticket first

## ASCII Workflow Diagram (v1)

```text
Steven
  |
  | asks for Skill / Bug / Feature
  v
Kayley (chat persona)
  |
  | delegate_to_engineering / ask_status
  v
Kera (codex CLI, one-shot, lower-cost config)
  |
  | creates ticket immediately (shared base template)
  | request_type = skill | bug | feature
  v
+--------------------------------------------------+
| engineering_tickets                              |
| - status                                         |
| - runtime limits                                 |
| - worktree path/branch                           |
| - PR url (later)                                 |
+--------------------------------------------------+
  |
  | append lifecycle events + agent turns
  v
+--------------------------------------------------+
| MultiAgentOrchestrator (deterministic)           |
| - one active ticket at a time (v1)               |
| - bounded runtime / command / pass limits        |
| - kill switch / escalation                       |
+--------------------------------------------------+
  |
  | create ticket branch + git worktree
  v
+--------------------------------------------------+
| WorktreeManager                                   |
| - one git worktree per ticket                     |
| - contained execution path                        |
+--------------------------------------------------+
  |
  | implementation turn
  v
Opey (codex CLI, one-shot, stronger config)
  |
  | emits structured JSON (requested_actions, summary, next_state_hint)
  | requests dangerous+bounded commands in ticket worktree
  v
+--------------------------------------------------+
| Runtime Boundary / Execution Layer               |
| (workspace agent + CLI command runner)           |
| - read/write/search/test/build/commit/push       |
| - transcript capture (stdout/stderr)             |
| - bounds + timeouts enforced                     |
+--------------------------------------------------+
  |
  | code changes + logs + test results
  v
Claudy (Claude Code CLI, one-shot reviewer)
  |
  | emits structured JSON verdict
  |
  +---------------------- APPROVED ------------------------+
  |                                                        |
  +-- CHANGES_REQUESTED --> feedback loop --> Opey -------+
  |
  +-- BLOCKED / LIMIT_EXCEEDED / AMBIGUOUS ---------------+
                           |
                           v
                  +----------------------+
                  | ESCALATED_HUMAN      |
                  | Steven decides:      |
                  | - clarify            |
                  | - resume             |
                  | - cancel             |
                  +----------------------+

If Claudy APPROVES:
  |
  v
+--------------------------------------------------+
| PR Service (`gh` CLI)                            |
| - push ticket branch                             |
| - gh pr create                                   |
| - record `pr_created` event + `pr_url`           |
+--------------------------------------------------+
  |
  v
Ticket status = PR_READY

Status query path (any time):
Steven -> Kayley -> Kera -> Orchestrator -> ticket summary
                                  |
                                  +--> status / blockers / QA state / PR link

Stretch goal (later):
Steven -> Direct chat with Kera/Opey/Claudy/Team
  |
  +--> discussion-only (default)
  +--> execution requires create/attach ticket first (traceability rule)
```

## What I Understood (from your notes)

You want a feature pipeline for requests like:

- `Skill` requests (new capabilities)
- `Feature` requests (UI/integrations/new product behavior)
- `Bug` requests (fixes)

Desired behavior includes:

- durable tracking in a database
- explicit status transitions
- agent handoffs (Kera -> Opey -> Claudy -> Opey loop)
- QA feedback iterations
- final notification back to Kayley/Steven
- safeguards against infinite review loops

## Important Pushback (Recommended Design Changes)

These changes keep the system simpler and safer while still matching your intent.

### 1. Do not use folders as the primary queue

Your notes suggest "handing off to a folder" that Claudy watches. That can work, but I strongly recommend:

- DB record = source of truth
- server worker loop = orchestrator
- filesystem folders = artifacts only (skills, scripts, generated files)

Why:

- folder watchers are harder to make reliable across crashes/restarts
- status and retries become messy
- duplicate processing is more likely
- debugging is harder than querying a table

### 2. Do not let LLMs write directly to disk first

Use your existing workspace agent run system as the execution boundary:

- it already has policy checks
- approval states exist
- run statuses are persisted
- there is an event stream and queue

This is the best part of your current architecture and should remain the "hands" of the dev/QA agents.

### 3. Keep the orchestrator deterministic even with multiple LLM agents

The multi-agent debate idea is strong, but if the state machine itself is not deterministic, you will be debugging:

- orchestration
- persistence
- tool execution
- CLI process orchestration (`codex`, `claude`)
- prompt quality
- loop control

all at once.

Recommended order:

- v1: deterministic workflow engine + Kera/Opey/Claudy roles + bounded execution
- v2: improve debate/review quality and richer QA automation
- v3: expand concurrency / team chat / broader autonomy

### 4. Do not auto-create the final skill scaffold at intake time

Your current idea creates the skill folder immediately after request intake. Better:

- create a ticket first
- clarify requirements
- only scaffold files after requirements are accepted/frozen for that cycle

Why:

- avoids lots of abandoned half-baked skill folders
- better audit trail
- easier retries/replanning

If you still want early scaffolding, use a `draft/` or `_wip` artifact status and mark it explicitly.

### 5. Infinite QA loops must be prevented in the workflow engine, not just prompts

Prompting helps, but the real guardrail must be code:

- `max_review_cycles`
- `max_implementation_attempts`
- `max_agent_turns_per_cycle`
- escalation status that requires human decision

## Current Repo Foundations (What already exists)

These are strong building blocks and should be reused.

- Existing workspace agent execution engine with policy/approval/verification:
  - `server/agent/executor.ts`
  - `server/agent/policyEngine.ts`
  - `server/routes/agentRoutes.ts`
  - `server/agent/runStore.ts`
  - `server/agent/supabaseRunStore.ts`
- Existing queue + events:
  - `server/agent/runQueue.ts`
  - `server/agent/runEvents.ts`
  - `server/agent/observableRunStore.ts`
- Existing (currently empty) role files for your multi-agent personas:
  - `server/agent/assistant/kera.ts`
  - `server/agent/dev/opey.ts`
  - `server/agent/qa/claudy.ts`
- Existing skill template you can reuse as default scaffold:
  - `server/docs/skill_template.md`

## Proposed Architecture (Recommended)

### Node server is the manager (orchestrator)

This matches your understanding and is the correct model.

- LLMs are "brains"
- your Node server is the "manager/body"
- only the server can:
  - spawn/manage local CLI processes for the engineering agents
  - execute tools
  - update DB status
  - enforce loop limits and approvals

### Core components

1. `MultiAgentTicketService` (DB CRUD + status transitions)
2. `MultiAgentOrchestrator` (workflow engine/state machine)
3. `KeraCoordinator` (`codex` CLI, low-cost config; intake + communication formatting + status responses)
4. `OpeyDeveloperAgent` (`codex` CLI, stronger config; implementation planning + workspace actions)
5. `ClaudyQAAgent` (Claude Code CLI; review/testing plan + QA verdict)
6. `ArtifactService` (skill folders/scripts/generated docs)
7. `WorktreeManager` (one git worktree per ticket)
8. `AgentCliRunner` (one-shot CLI invocation wrapper + transcripts + JSON parsing)
9. `MultiAgentRoutes` (ticket APIs + admin/manual actions + future direct-chat endpoints)

### Key rule

Agents never mutate files directly.

They produce intents/plans, and the server executes actions via the orchestration/runtime boundary.

In v1, "dangerous" means execution approvals are relaxed inside the contained per-ticket worktree, but bounds/logging/kill-switches still apply.

## Data Model (Supabase) - Recommended v1

Your notes mention `FEATURE_REQUEST` and `DISCUSSION`. I recommend a slightly more structured schema.

### `engineering_tickets`

One row per request from Kayley/Kera.

Suggested fields:

- `id`
- `request_type` (`skill`, `feature`, `bug`)
- `title`
- `request_summary`
- `additional_details`
- `source` (`kayley`, `admin`, `manual`, `whatsapp`, etc.)
- `status`
- `priority`
- `is_ui_related` (boolean)
- `created_by`
- `assigned_dev_agent` (nullable)
- `assigned_qa_agent` (nullable)
- `current_cycle` (int)
- `max_cycles`
- `max_dev_attempts`
- `artifact_root_path` (nullable)
- `worktree_path` (nullable)
- `worktree_branch` (nullable)
- `execution_profile` (`dangerous_bounded`)
- `runtime_limits` (jsonb)
- `final_pr_url` (nullable)
- `pr_created_at` (nullable)
- `failure_reason` (nullable)
- `created_at`
- `updated_at`

### `engineering_ticket_events`

Append-only lifecycle history (best debugging tool).

Examples:

- ticket_created
- intake_acknowledged
- requirements_clarification_requested
- requirements_frozen
- implementation_started
- workspace_run_requested
- workspace_run_completed
- qa_started
- qa_rejected
- qa_approved
- pr_creation_started
- pr_created
- pr_creation_failed
- escalated_to_human
- pr_ready
- completed

Suggested fields:

- `id`
- `ticket_id`
- `event_type`
- `actor_type` (`system`, `kera`, `opey`, `claudy`, `human`)
- `actor_name`
- `summary`
- `payload` (jsonb)
- `created_at`

### `engineering_agent_turns`

Store the "conversation/meeting" turns between Opey and Claudy (and optionally Kera).

Suggested fields:

- `id`
- `ticket_id`
- `cycle_number`
- `turn_index`
- `agent_role` (`kera`, `opey`, `claudy`)
- `runtime` (`codex_cli`, `claude_code_cli`, `manual`, etc.)
- `purpose` (`intake`, `planning`, `review`, `rework`, `status_update`)
- `prompt_excerpt` (redacted/truncated)
- `response_excerpt` (redacted/truncated)
- `verdict` (nullable, e.g. `approved`, `rejected`, `needs_human`)
- `metadata` (jsonb)
- `created_at`

Notes:

- Store CLI command/profile/model identifiers used per turn in `metadata` so you can compare behavior/cost later.

### `engineering_artifacts`

Track outputs without forcing filesystem discovery to be the truth source.

Suggested fields:

- `id`
- `ticket_id`
- `artifact_type` (`skill_folder`, `skill_md`, `script`, `patch`, `qa_report`, `pr_summary`)
- `path`
- `status` (`draft`, `generated`, `validated`, `rejected`, `final`)
- `created_by_agent`
- `workspace_run_id` (nullable link to existing workspace agent runs)
- `created_at`
- `updated_at`

### `engineering_reviews` (optional v1, useful by v2)

If you want structured QA findings instead of only free-text turns.

Suggested fields:

- `id`
- `ticket_id`
- `cycle_number`
- `reviewer` (`claudy`)
- `verdict` (`approved`, `changes_requested`, `blocked`)
- `severity` (`none`, `low`, `medium`, `high`, `critical`)
- `summary`
- `findings` (jsonb array)
- `created_at`

## Workflow Statuses (Recommended)

Keep statuses explicit but not too granular. Granularity belongs in events.

Recommended `engineering_tickets.status` enum:

- `created`
- `intake_acknowledged`
- `needs_clarification`
- `requirements_ready`
- `planning`
- `implementing`
- `ready_for_qa`
- `qa_testing`
- `qa_changes_requested`
- `qa_approved`
- `pr_preparing`
- `pr_ready`
- `completed`
- `failed`
- `escalated_human`
- `cancelled`

Why this set:

- human-readable
- enough to drive UI and automation
- avoids overfitting every internal micro-step into the main status enum

v1 automation target:

- `pr_ready` (with `pr_created` event and `pr_url` present)
- `completed` can remain reserved for post-merge/manual closure

## Multi-Step Implementation Plan

This is the recommended order to build the feature.

### Phase 0: Scope Decisions (before coding)

Lock down v1 boundaries so the implementation does not balloon.

Locked decisions (completed):

- shared ticket template for `skill` / `bug` / `feature`
- Kayley creates tickets immediately
- Opey = `codex` CLI (stronger config), Kera = `codex` CLI (smaller config), Claudy = `claude` CLI
- one active ticket at a time
- one `git worktree` per ticket
- dangerous bounded execution in contained env
- actual PR creation via `gh` CLI
- automation end-state = `pr_ready`
- one-shot CLI invocations per turn + structured JSON output (all three agents)

Deliverable:

- this doc finalized with v1 choices and bounds

### Phase 1: Database Schema + Services (foundation)

Add durable ticketing + event history before any autonomous behavior.

Implementation:

- Create migration for multi-agent workflow tables
  - `supabase/migrations/<timestamp>_multi_agent_workflow.sql`
- Add server DB service for tickets/events/turns/artifacts
  - `server/agent/<new>/ticketStore.ts` (or similar)
- Add server-side status transition helpers (centralize allowed transitions)

Why first:

- every later phase needs persistence
- easier recovery after crashes
- better observability from day one

### Phase 2: Orchestrator State Machine (deterministic source of truth)

Build the workflow engine as deterministic code before relying on model behavior.

Implementation:

- Add `MultiAgentOrchestrator` module with:
  - `startTicket(ticketId)`
  - `resumeTicket(ticketId)`
  - `processNextStep(ticketId)`
- Add explicit transition rules:
  - `created -> intake_acknowledged`
  - `requirements_ready -> planning`
  - `planning -> implementing`
  - `implementing -> ready_for_qa`
  - etc.
- Add loop/circuit-breaker config:
  - `MAX_REVIEW_CYCLES`
  - `MAX_DEV_ATTEMPTS_PER_CYCLE`
  - `MAX_AGENT_TURNS_PER_CYCLE`
  - `MAX_RUNTIME_MINUTES_PER_TICKET`
  - `MAX_COMMANDS_PER_TICKET`
  - `MAX_TEST_RUNS_PER_PASS`
- Add ticket execution locking:
  - one active ticket at a time (v1 scheduler constraint)
- Add worktree lifecycle hooks:
  - create worktree on ticket start
  - persist path/branch
  - cleanup policy after `pr_ready` / `failed` / `escalated_human`

Output at this phase:

- tickets can move through states via deterministic/manual actions
- worktree lifecycle is managed by code, not agents
- no production model calls required yet

### Phase 3: Kayley -> Kera Intake + Ticket Creation (v1)

Implement Kera as the intake/coordinator agent in v1 using a smaller/cheaper `codex` CLI configuration (one-shot per turn).

Implementation:

- `server/agent/assistant/kera.ts`
  - normalize request payload into ticket shape
  - classify type (`skill` / `feature` / `bug`) into shared base template
  - create ticket immediately (even if ambiguous)
  - set `needs_clarification` when requirements are incomplete
  - generate acknowledgement/status messages for Kayley
  - answer status queries by reading orchestrator state / ticket events
- Add route(s) / tool(s) for Kayley-facing engineering handoff
  - `delegate_to_engineering` (create ticket)
  - `get_engineering_ticket_status`
  - `list_active_engineering_tickets` (v1 should usually return one)
- Add route(s) for admin/manual creation and inspection
  - `server/routes/<new multiAgentRoutes>.ts`
- Optional:
  - add "request intake form" in admin UI

Notes:

- Kayley is not technical and should not be forced to clarify before ticket creation.
- The engineering team can request clarification after intake through Kera.

### Phase 4: Artifact Scaffolding + Skill Template Reuse (Skill tickets only)

Once requirements are ready, create the skill scaffold using your current workspace agent.

Implementation:

- Add an artifact generator service:
  - copies/derives from `server/docs/skill_template.md`
  - creates `skills/<skill-name>/SKILL.md`
  - creates `skills/<skill-name>/scripts/`
  - optionally creates `skills/<skill-name>/scripts/<skill-name>.ts`
- Execute file creation through existing workspace agent (`write`, `mkdir`)
- Record resulting `workspace_run_id` in `engineering_artifacts`

Important:

- scaffold creation should still happen after requirements are clear enough for the current cycle
- generated artifacts should be linked to ticket + workspace run IDs
- skill tickets use this phase; bug/feature tickets may skip or use different artifact templates

### Phase 5: Opey Implementation Agent (`codex` CLI, dangerous bounded)

Implement Opey (`codex` CLI) using the workspace agent/runtime boundary inside the per-ticket worktree.

Implementation:

- `server/agent/dev/opey.ts`
  - takes ticket + requirements + existing artifacts
  - produces implementation plan
  - requests workspace actions and commands in the ticket worktree
  - records turns + rationale
  - emits structured JSON envelope every turn
- Add dangerous bounded runtime profile for Opey:
  - no interactive prompts
  - bounded by command count, runtime, and pass limits
  - all commands/logs/diffs recorded to ticket events/turns
- Allow tests/build in v1, but cap attempts/runs
- Track per-cycle attempts and stop after limit (`v1: 2 implementation passes`)

Recommendation:

- v1 Opey should prefer:
  - `read`
  - `search`
  - `write`
  - `mkdir`
  - `status`
  - test/build commands
  - `commit` / `push` / `gh pr create` when the orchestrator reaches PR preparation stage

Notes:

- "Dangerous" does not mean unlimited. The orchestrator still enforces bounds and can kill the run.
- Keep branch/worktree naming deterministic so PR creation is predictable.

### Phase 6: Claudy QA Agent (Anthropic reviewer/tester)

Implement Claudy in v1 as a Claude Code CLI QA reviewer (one-shot per turn). This agent must be built as part of v1.

Implementation:

- `server/agent/qa/claudy.ts`
  - reads ticket requirements + Opey plan + artifacts
  - generates findings and verdict
  - writes structured review result
  - can request clarification questions via Kera when requirements are ambiguous
  - emits structured JSON envelope every turn
- On `changes_requested`:
  - move ticket to `qa_changes_requested`
  - hand feedback back to Opey
- On `approved`:
  - move to `qa_approved`

Optional later in this phase:

- UI feature path can request browser/headless validation, but only after:
  - clear test command/tool exists
  - runtime bounds are defined
  - logs are persisted

### Phase 7: Human Escalation and Deadlock Handling (must-have before autonomy)

This phase prevents credit burn and silent loops.

Implementation:

- Add hard stop rules in orchestrator:
  - exceeded review cycles
  - exceeded implementation passes (`v1: 2`)
  - repeated identical QA feedback
  - repeated workspace failures
  - ambiguous requirements
  - runtime limit exceeded
  - command budget exhausted
- Transition to `escalated_human`
- Store an escalation summary with:
  - what was attempted
  - current blocker
  - decisions needed from Steven

This directly solves the infinite-loop risk from your notes.

### Phase 8: Admin Monitoring UI + Manual Controls

You already have an admin dashboard and workspace run monitor. Extend that.

Implementation:

- Add multi-agent ticket list/detail panel to `src/components/AdminDashboardView.tsx`
- Show:
  - ticket status
  - lifecycle events
  - agent turns
  - linked workspace runs
  - review cycles
  - escalation prompts
- Add manual actions:
  - pause/resume ticket
  - force status transition (admin only)
  - add clarification note
  - retry from step/cycle
  - terminate active ticket run (kill switch)
  - open worktree path / branch info
  - re-run PR creation step if `pr_creation_failed`

This is the feature that makes the system manageable in practice.

### Phase 9: Kayley Delegation + Status Integration (v1 requirement)

Implementation:

- Add a Kayley-facing tool like `delegate_to_engineering` (or similar) in:
  - `src/services/aiSchema.ts`
  - `src/services/memoryService.ts`
  - prompt/tool guidance files
- Tool creates a ticket instead of directly running engineering actions
- Kayley receives status summaries from Kera (not raw dev logs)
- Add a status tool/query path so Steven can ask Kayley:
  - current ticket status
  - blockers/clarifications
  - latest QA findings
  - PR link when available

Notes:

- Keep Kayley non-technical. She should relay Kera summaries, not raw terminal output.

### Phase 10: Cross-CLI Review/Debate Hardening (`codex` CLI + Claude Code)

This is the advanced phase, and your idea is excellent here.

Recommended v1/v2 pattern:

- Opey (`codex` CLI, implementation) has tool access
- Claudy (reviewer) has no tool access
- server manager passes drafts/results between them
- manager enforces turn limits and approval gates

Required safeguards:

- `MAX_DEBATE_TURNS` (3-5)
- forced resolution policy on final turn
- escalation to human if no approval
- repeated-feedback detection
- token/cost budget per ticket

### Phase 11 (Stretch Goal): Direct Agent / Team Chat (Bypass Kayley)

Goal:

- Allow Steven to open a chat directly with `Kera`, `Opey`, `Claudy`, or the whole team.

Modes:

- `direct_agent` chat (single persona)
- `team_room` chat (orchestrator routes turns across Kera/Opey/Claudy)
- `ticket_attached` discussion (preferred for active work)
- `freeform` discussion (allowed, but non-executing by default)

Traceability rule:

- All engineering work/actions/changes must be attached to a ticket.
- Freeform discussion can exist without a ticket.
- If a freeform discussion becomes actionable, create or attach a ticket before execution.

Guardrails:

- Default mode is discussion-only (brainstorm/review/status/questions)
- Execution mode requires an attached ticket and goes through the orchestrator
- Direct chat must not bypass bounded runtime controls

Nice-to-have:

- "Attach to ticket" action to convert useful direct chat into audit-tracked ticket notes/turns

## Suggested File Layout (Server)

Proposed new modules (names can vary):

- `server/agent/multiAgent/orchestrator.ts`
- `server/agent/multiAgent/types.ts`
- `server/agent/multiAgent/ticketStore.ts`
- `server/agent/multiAgent/statusMachine.ts`
- `server/agent/multiAgent/eventLogger.ts`
- `server/agent/multiAgent/artifactService.ts`
- `server/agent/multiAgent/agentCliRunner.ts`
- `server/agent/multiAgent/codexCliRunner.ts`
- `server/agent/multiAgent/claudeCliRunner.ts`
- `server/agent/multiAgent/agentTurnSchemas.ts`
- `server/agent/multiAgent/worktreeManager.ts`
- `server/agent/multiAgent/runtimeBounds.ts`
- `server/agent/multiAgent/prService.ts`
- `server/agent/multiAgent/teamChatRouter.ts` (stretch goal)
- `server/routes/multiAgentRoutes.ts`

And implement role logic in existing persona files:

- `server/agent/assistant/kera.ts`
- `server/agent/dev/opey.ts`
- `server/agent/qa/claudy.ts`

## Execution Profile and Bounds (Dangerous + Bounded)

v1 execution profile is intentionally dangerous inside a contained environment, but still bounded for reliability and traceability.

Design rule:

- Remove most permission prompts inside the contained per-ticket worktree.
- Keep hard runtime bounds, logging, and kill switches enforced by the orchestrator.

### For v1

- Auto-allow:
  - ticket creation
  - DB status updates
  - worktree creation/cleanup
  - file scaffolding (`mkdir`, `write`) in the ticket worktree
  - command execution in the contained ticket worktree
  - `commit`, `push`, and `gh pr create` in the ticket branch/worktree
- Human-only:
  - merge to main
  - production deployments
  - secrets/config changes

### Bounded Runtime Controls (recommended v1 defaults)

- `max_active_tickets = 1`
- `max_implementation_passes = 2`
- `max_qa_cycles = 2`
- `max_agent_turns_per_cycle = 8`
- `max_runtime_minutes_per_ticket = 45`
- `max_commands_per_ticket = 40`
- `max_test_runs_per_pass = 2`
- `max_pr_create_attempts = 2`
- `max_cli_stdout_kb_per_turn = 512`
- `max_cli_stderr_kb_per_turn = 256`
- `max_invalid_json_retries_per_turn = 1`

These are not security restrictions. They are reliability and cost controls.

### CLI Turn Contract (v1)

All three engineering agents (`Kera`, `Opey`, `Claudy`) run as one-shot local CLI invocations.

Requirements:

- Prompt/context is provided by the orchestrator (ticket snapshot + recent turns + purpose)
- CLI must return a single structured JSON envelope per turn
- Orchestrator validates JSON before:
  - writing agent turn record
  - applying state transition
  - executing requested actions
- On invalid JSON:
  - retry once with a repair prompt (recommended)
  - if still invalid, record failure event and escalate/retry per workflow rules

Recommended implementation approach:

- Define a shared `zod` schema for agent turn envelopes in `server/agent/multiAgent/agentTurnSchemas.ts`
- Capture raw stdout/stderr transcripts in DB/file logs for debugging
- Store parsed JSON plus validation outcome in `engineering_agent_turns.metadata`

### Worktree Isolation Rules

- Create one `git worktree` per ticket
- Use one branch per ticket (deterministic naming)
- Run all Opey/Claudy execution against that worktree
- Never run engineering-ticket commands in the main repo working tree
- Persist worktree path/branch in the ticket record and event log

### PR Creation (`gh` CLI)

v1 target behavior:

- Orchestrator reaches `pr_preparing`
- Opey prepares commit(s) and pushes ticket branch
- PR service runs `gh pr create`
- On success:
  - record `pr_created` event with `pr_url`
  - set ticket status to `pr_ready`
- On failure:
  - record `pr_creation_failed`
  - keep ticket in `pr_preparing` or move to `escalated_human` (based on retry budget)

### Logging

Log structured events with clear prefixes:

- `[MultiAgentOrchestrator]`
- `[Kera]`
- `[Opey]`
- `[Claudy]`

This fits your code style preference and makes debugging much easier.

## Verification Plan (when implementation starts)

Do not mark complete until these work.

### Unit/Integration

- Ticket status transition tests
- Loop limit / circuit breaker tests
- Duplicate event/idempotency tests
- Kera tests
- Opey -> workspace run linking tests
- Claudy review verdict parsing tests

### Manual scenarios

1. Skill request success path
- create `skill` ticket
- Kera intake acknowledged
- scaffold created
- Opey writes draft
- Claudy approves
- PR is created via `gh` CLI
- ticket reaches `pr_ready` with `pr_url`

2. QA rejects path
- Claudy returns findings
- Opey reworks
- cycle count increments

3. Deadlock/escalation path
- repeated rejections or max cycles exceeded
- ticket becomes `escalated_human`
- clear summary is available in UI

4. Approval gate path
- if you later re-enable approvals outside contained mode, verify pause/resume behavior

5. Kayley status query path
- Kayley creates ticket from a non-technical request
- Steven asks Kayley for status later
- Kera returns ticket status/blockers/QA state/PR link summary
## Decisions Summary (Resolved)

Resolved by Steven for v1:

1. Ticket types
- Shared base template for `skill`, `bug`, and `feature`

2. Execution profile
- `dangerous + bounded` in a contained environment

3. Kayley integration
- Kayley creates tickets immediately in v1
- Engineering team asks clarifying questions after ticket creation if needed
- Kayley can query engineering status and relay it back

4. Completion definition
- Terminal automation status = `pr_ready`
- PR is actually created in v1 and attached to the ticket as event/url

5. Provider assignments
- `Kera` = `codex` CLI (smaller config)
- `Opey` = `codex` CLI (stronger config)
- `Claudy` = `claude` / Claude Code CLI

6. Workspace isolation
- One `git worktree` per ticket
- One active engineering ticket at a time (v1)

7. PR creation method
- `gh` CLI

8. Traceability for direct chats (stretch)
- All engineering work must be attached to a ticket
- Freeform chats are allowed but execution must create/attach a ticket first

## Remaining Decisions (Implementation Details)

These are smaller implementation choices, not architecture blockers.

1. Exact model IDs for each role
- `Kera` codex CLI model/profile (low-cost)
- `Opey` codex CLI model/profile (primary coder)
- `Claudy` Claude Code CLI model/profile (reviewer)
- Exact CLI command flags needed to force structured JSON output

2. CLI runner contract details
- exact `codex` command invocation pattern (one-shot mode)
- exact `claude` / Claude Code command invocation pattern (one-shot mode)
- stdout/stderr transcript storage strategy (DB only vs DB + files)
- invalid JSON repair prompt text and retry behavior

3. Worktree lifecycle policy
- Cleanup immediately on `pr_ready` vs retain until merge/manual close
- Retention TTL for failed/escalated tickets

4. PR auth/runtime setup
- How `gh` will be authenticated in the contained environment
- Whether PR templates/labels/reviewers are auto-applied in v1

5. Browser QA scope for `feature` tickets
- Disabled in v1 vs limited smoke tests

6. Direct team chat persistence (stretch)
- Separate chat session table vs reusing `engineering_agent_turns` with session metadata

## Risks and Mitigations

### Risk: orchestration complexity explodes

Mitigation:

- phase the rollout
- keep v1 deterministic
- use DB-backed event history

### Risk: agent deadlocks / infinite loops

Mitigation:

- hard-coded limits in orchestrator
- escalation status
- repeated-feedback detection

### Risk: unsafe file or shell operations

Mitigation:

- dangerous bounded execution only in per-ticket worktrees/branches
- hard runtime/command/test/pass limits in orchestrator
- kill switch + event logging + linked workspace runs
- one active ticket at a time in v1

### Risk: poor observability

Mitigation:

- append-only event table
- link tickets to workspace run IDs
- admin UI timeline

## Notes from Codebase Inspection (for future reference)

Read/inspected while drafting this plan:

- `docs/features/MultiAgent/MultiAgent_Notes.txt`
- `docs/features/MultiAgent/Additional_Notes.txt`
- `docs/features/MultiAgent/skills.txt`
- `server/agent/executor.ts`
- `server/agent/policyEngine.ts`
- `server/agent/runStore.ts`
- `server/agent/supabaseRunStore.ts`
- `server/routes/agentRoutes.ts`
- `server/agent/runQueue.ts`
- `server/agent/runEvents.ts`
- `server/agent/observableRunStore.ts`
- `server/index.ts`
- `server/agent/assistant/kera.ts`
- `server/agent/dev/opey.ts`
- `server/agent/qa/claudy.ts`
- `server/docs/skill_template.md`
- `src/services/projectAgentService.ts`
- `src/services/aiSchema.ts`

## One Additional Security Note

I noticed server-side Supabase credentials are currently hardcoded in `server/index.ts`.

Recommendation before expanding this feature:

- move them to environment variables
- fail fast if missing
- avoid printing secret values in logs

This matters more once multi-agent orchestration starts writing more ticket/run data on the server.
