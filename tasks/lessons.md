## Lessons Learned

### 2026-02-20 - Match UI promises to implemented navigation
- Pattern: I discussed an in-app Agent Dashboard, but the app still only exposed `Admin Dashboard` in settings.
- Prevention Rule:
- Before claiming a UI entry exists, verify the actual component wiring in:
- `src/components/SettingsPanel.tsx`
- `src/App.tsx`
- If the entry does not exist yet, state it explicitly and patch wiring in the same change.

### 2026-02-20 - Treat persistence fallback as product policy, not implementation preference
- Pattern: I proposed Supabase persistence with an in-memory fallback, but user policy required no fallback.
- Prevention Rule:
- When user states a reliability/security policy (e.g., "no fallback"), enforce it as a hard startup requirement and fail fast with explicit env errors.

### 2026-02-20 - Integrate into existing UI structure when directed
- Pattern: I proposed replacing a changed Agent tab layout, but user requested keeping the existing tab structure and integrating within one tab.
- Prevention Rule:
- When UI structure is user-directed, preserve that structure and attach new functionality within it unless explicitly told to refactor.

### 2026-02-20 - Promise mirror cron jobs must execute fulfillment, not only reminder summaries
- Pattern: Timed selfie promise was mirrored into cron and marked as a successful cron run, but no actual fulfillment payload was queued/delivered to chat.
- Prevention Rule:
- For `promise_reminder:*` cron jobs, scheduler must queue a concrete pending delivery artifact (`pending_messages`) and mark the source promise fulfilled atomically.
- Verification should include: cron run success + pending message row + visible chat delivery (text/photo) path.

### 2026-02-20 - Pending message consumers must scope by source to avoid backlog spam
- Pattern: Global polling consumed unrelated historical `pending_messages` rows, causing repeated unsolicited promise/thought texts every ~30s.
- Prevention Rule:
- Any automated consumer must filter by explicit `metadata.source` and a freshness window; never consume the full undelivered queue by default.

### 2026-02-22 - Confirm provider integration mode (API vs local CLI) before finalizing agent architecture
- Pattern: I planned Kera/Opey/Claudy around provider API clients, but user intends to run them through local subscriptions via `codex` CLI / `claude` CLI tools (no API calls).
- Prevention Rule:
- For multi-agent/provider designs, explicitly confirm the execution mode for each agent role first:
- local CLI (`codex`, `claude`, etc.) vs SDK/API calls
- auth source (local logged-in subscription vs API key)
- process isolation model (worktree/container)

### 2026-02-23 - Confirm exact external diagnostic filenames before log analysis
- Pattern: A provided external file path included a typo (`convo.txt'l`), which would block or misdirect log inspection.
- Prevention Rule:
- Before reading user-provided logs or artifacts, validate/copy the exact path string and ask for a correction when any filename looks malformed.
- Delay log conclusions until the corrected path is confirmed.
- Multi-agent action design: keep deterministic workspace executor actions (read/write/search/command) separate from LLM judgment steps. Treat `manualVerify` as a Claudy QA review trigger, not a workspace run action, to avoid false "failed" runs and preserve the Opey↔Claudy feedback loop.
- Opey planning turns should be treated as discovery/planning, not direct file mutation. If planning emits semantic placeholders (`applyFix`, `inspectUITextSources`), defer them and auto-trigger a separate implementation turn constrained to concrete executor actions (`read/search/write/command/status`).
- If handled failures (non-zero test exit, policy denial, unsupported action) are important for ops debugging, emit runtime `warning`/`error` logs for those outcomes explicitly; exception-only logging is not enough.
- Do not run JSON-repair retries for transport/runtime CLI failures (e.g., timeouts). Repair prompts can turn hard failures into misleading valid-but-empty envelopes that incorrectly advance orchestration state.
- For external CLI agents (Codex/Claude), capture local diagnostic logs on timeout/parse failures and persist structured excerpts to runtime logging with ticket correlation. Process stdout/stderr lengths alone are not enough for root-cause debugging.
- When Opey uses the same Codex CLI timeout for planning and implementation, implementation turns can fail at the hard cutoff even if planning succeeds. Set purpose-based time budgets (`planning` shorter, `implementation/rework` longer) and log the timeout value in the agent turn context.
- Codex diagnostic snapshots can be misleading if they tail a shared local CLI log file without checking recency. Guard on log-file mtime vs the run start timestamp and skip/flag stale snapshots instead of persisting unrelated session history as ticket diagnostics.
- For long-running CLI agent turns, add periodic heartbeat logs with elapsed time and timeout budget. Start/timeout/close logs alone leave a long observability gap that looks like a deadlock during real runs.
- Opey implementation prompts should stay compact and generic: cap prior-plan excerpts/run summaries/deferred-action details and avoid hardcoded issue text in prompt templates, or prompt bloat can slow turns and leak ticket-specific assumptions across bugs.
- Patch checkpoints must distinguish workflow artifacts from meaningful implementation changes. Untracked scaffold paths like `bugs/` (and generated `patches/` bundles) can make `git status` non-empty even when `git diff` is empty, causing false-positive QA handoffs unless filtered.
- Opey action vocab drifts between camelCase and snake_case (`readFile` vs `read_file`, `runChecks` vs `run_project_checks`). Normalize common aliases before executor dispatch, or planning runs will fail as unsupported and starve implementation of useful evidence.
- When Opey implementation completes with read/search-only actions and patch checkpoint finds no meaningful code changes, use a bounded automatic rework loop with explicit patch-checkpoint feedback (attempt count + ignored artifact paths + write requirement) instead of repeatedly stalling in `implementing`.
- If the workflow conceptually has a `patch` phase, make it explicit in orchestration (diff/status checkpoint + gating) instead of inferring success from an implementation turn alone.
- State-machine transitions being allowed is not enough; each lifecycle stage that should auto-progress (for example `qa_approved -> pr_preparing`) also needs an actual trigger path (`processNextStep` and/or a watcher) or it will stall silently.
