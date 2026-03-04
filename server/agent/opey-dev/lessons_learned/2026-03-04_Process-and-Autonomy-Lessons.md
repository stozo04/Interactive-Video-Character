# Lessons Learned — Process & Autonomy — 2026-03-04

## Autonomy & Approval Gates

- **AGENTS.md is for human-supervised Claude Code sessions, not for Opey.**
  When running autonomously, ALL approval gates in AGENTS.md are suspended.
  Do not write a plan to `tasks/todo.md` and wait. Implement directly, commit, exit.

- **When the user grants full autonomy, act on it immediately.**
  Do not pause for additional approval requests after autonomy has been granted.
  Update `AGENTS.md` if instructed, then proceed without further check-ins.

- **Lessons go in `server/agent/opey-dev/lessons_learned/`, NOT `tasks/lessons.md`.**
  `tasks/lessons.md` is pre-approved by AGENTS.md so it's tempting to write there — but
  `loadLessonsContext()` only reads `lessons_learned/*.md`. Lessons written to `tasks/lessons.md`
  are never injected into future prompts. They are effectively lost.

## Clarification Loop

- **No commits = needs_clarification.** If Opey exits without committing any source code,
  `main.ts` routes the ticket to `needs_clarification` and Kayley asks Steven for more info.
  The fix is always to make at least one meaningful commit — not to ask questions.

- **When a request is vague, propose a concrete interpretation and ship.**
  State the assumption in the commit message. Do not stall.

## Execution Model

- **Confirm provider integration mode before designing agent architecture.**
  Opey/Codex run through local CLI subscriptions (`codex` CLI), not API calls.
  Auth is local subscription, not API key.

- **Set purpose-based time budgets.**
  Planning turns can be shorter; implementation/rework turns need longer timeouts.
  Log the timeout value in the agent turn context.

- **Untracked scaffold paths (`bugs/`, `patches/`) can make `git status` non-empty
  even when no meaningful code was written.** Filter these before checking for commits
  or they trigger false-positive QA handoffs.

## Codex Behavior Patterns

- **Codex sometimes edits files but forgets to commit.** `main.ts` auto-commits uncommitted
  changes on Opey's behalf — but only if they exist. If Codex stops before writing any files,
  there is nothing to auto-commit.

- **Codex action vocab drifts between camelCase and snake_case** (`readFile` vs `read_file`,
  `runChecks` vs `run_project_checks`). Normalize aliases before executor dispatch.

- **Do not run JSON-repair retries for transport/runtime CLI failures (timeouts).**
  Repair prompts can convert hard failures into misleading valid-but-empty envelopes
  that incorrectly advance orchestration state.

- **For long-running CLI turns, add periodic heartbeat logs with elapsed time and timeout budget.**
  Start/timeout/close logs alone leave a long observability gap.

- **Codex diagnostic snapshots are misleading if they tail a shared local CLI log without
  checking recency.** Guard on log-file mtime vs run-start timestamp; skip stale snapshots.

## Orchestration & State Machine

- **State-machine transitions being *allowed* is not enough.**
  Each lifecycle stage that should auto-progress (e.g., `qa_approved → pr_preparing`)
  also needs an actual trigger path or it will stall silently.

- **Patch checkpoints must distinguish workflow artifacts from meaningful implementation changes.**
  Untracked `bugs/` or `patches/` directories make `git status` non-empty even when
  `git diff` is empty — causing false-positive QA handoffs.

- **When Opey implementation completes with read/search-only actions and the patch checkpoint
  finds no code changes, use a bounded automatic rework loop** with explicit feedback
  (attempt count + ignored artifact paths + write requirement) instead of repeatedly stalling.
