# Multi-Agent Engineering Workflow - Code Review

**Date:** 2026-02-22
**Reviewer:** Claude Opus 4.6
**Branch:** `multiAgent`
**Reference:** `docs/features/MultiAgent/MultiAgent_Implementation_Plan.md`

---

## Executive Summary

The codebase establishes a solid foundation for the multi-agent engineering workflow. The type system, DB schema, status machine, ticket store, event logger, and admin UI are well-structured and follow existing project conventions. However, several **critical gaps** prevent the system from functioning end-to-end, and there are bugs that would cause runtime failures. The most impactful issues are: the orchestrator's `processNextStep` is a no-op, the worktree manager is fully stubbed, CLI runner invocations are incorrectly structured, and turn indexing is broken.

**Verdict:** Good architectural skeleton. Not runnable end-to-end yet. Needs targeted fixes before smoke testing.

---

## Table of Contents

1. [Critical Bugs (will crash or silently fail)](#1-critical-bugs)
2. [Missing Implementations (plan says v1, code is absent)](#2-missing-implementations)
3. [Logic Bugs (wrong behavior, won't crash)](#3-logic-bugs)
4. [Design Issues (will cause pain later)](#4-design-issues)
5. [Security Concerns](#5-security-concerns)
6. [Positive Observations](#6-positive-observations)
7. [File-by-File Summary](#7-file-by-file-summary)

---

## 1. Critical Bugs

### 1.1 `processNextStep` is a no-op

**File:** `server/agent/multiAgent/orchestrator.ts:93-100`
**Plan ref:** Phase 2 - "Orchestrator State Machine (deterministic source of truth)"

```typescript
public async processNextStep(ticketId: string): Promise<EngineeringTicket> {
  console.log(`${LOG_PREFIX} processNextStep ticket=${ticketId}`);
  const ticket = await this.requireTicket(ticketId);
  await this.applyEscalationPolicy(ticket);
  console.log(
    `${LOG_PREFIX} no-op transition policy (status=${ticket.status}).`,
  );
  return ticket;  // <-- always returns unchanged ticket
}
```

This is the **core workflow driver** per the plan. It should inspect the ticket's current status and determine the next action (invoke Kera, Opey, Claudy, scaffold artifacts, prepare PR, etc.). Currently it applies escalation checks and returns immediately. No ticket will ever progress automatically through the pipeline.

**Impact:** The entire autonomous workflow doesn't function. Every status transition requires manual API calls.

**Recommendation:** Implement the state-machine dispatch logic:
```typescript
switch (ticket.status) {
  case "intake_acknowledged":
  case "requirements_ready":
    // invoke Kera or move to planning
    break;
  case "planning":
    // scaffold artifacts, transition to implementing
    break;
  case "implementing":
    // invoke Opey turn
    break;
  case "ready_for_qa":
    // invoke Claudy turn
    break;
  // ... etc
}
```

---

### 1.2 WorktreeManager is entirely stubbed

**File:** `server/agent/multiAgent/worktreeManager.ts:9-18`
**Plan ref:** Phase 2 - "Worktree lifecycle hooks"

Both `createWorktree` and `cleanupWorktree` throw `Error("not implemented")`. The orchestrator references `ticket.worktreePath` in multiple places (`requestOpeyTurn`, `scaffoldArtifacts`) and will throw when it's missing.

**Impact:** Any path that needs a worktree (scaffolding, Opey implementation, PR creation) will fail.

**Recommendation:** Implement using `git worktree add`:
```typescript
import { execFile } from "node:child_process";
// git worktree add .worktrees/ticket-<id> -b ticket/<id>
```

---

### 1.3 CLI runners use incorrect invocation patterns

**File:** `server/agent/multiAgent/codexCliRunner.ts:24-29`
**File:** `server/agent/multiAgent/claudeCliRunner.ts:24-29`
**Plan ref:** Phase 5/6 - CLI Turn Contract

**Codex CLI:**
```typescript
const result = await runCliCommand({
  command: "codex",
  args: ["--model", model, "--yolo"],
  input: wrappedPrompt,
  // ...
});
```

The `codex` CLI does not support `--yolo` as a flag. The correct flag for non-interactive one-shot mode needs verification against the actual codex CLI docs. Also, stdin piping may not work as the prompt delivery mechanism -- most CLIs expect `-p "prompt"` or a file argument.

**Claude CLI:**
```typescript
args: ["--model", model, "--dangerously-skip-permissions"],
```

Missing critical flags:
- No `-p` flag to pass the prompt (stdin piping may not deliver the prompt correctly to Claude Code CLI)
- No `--output-format json` to enforce structured JSON output
- No `--max-turns 1` to enforce one-shot behavior

**Impact:** Neither CLI runner will produce the expected structured JSON envelope. All turns will fail JSON validation and be retried once, then throw.

**Recommendation:** Verify exact CLI invocation patterns against each tool's docs. For Claude Code:
```typescript
args: [
  "--model", model,
  "--dangerously-skip-permissions",
  "--output-format", "json",
  "--max-turns", "1",
  "-p", wrappedPrompt,  // pass prompt as arg, not stdin
],
```

---

### 1.4 `cliExec.ts` spawn error can leave promise hanging

**File:** `server/agent/multiAgent/cliExec.ts:45-47`

```typescript
child.on("error", (error) => {
  console.error(`${LOG_PREFIX} Spawn error`, { error });
});
```

If the command binary doesn't exist (e.g., `codex` not installed), the `"error"` event fires but the promise is **never resolved**. The `"close"` event may not fire after a spawn error, leaving the promise hanging indefinitely.

**Impact:** Server hangs waiting for a CLI turn that will never complete.

**Fix:**
```typescript
child.on("error", (error) => {
  clearTimeout(timeout);
  console.error(`${LOG_PREFIX} Spawn error`, { error });
  resolve({
    exitCode: null,
    stdout,
    stderr: stderr + `\nSpawn error: ${error.message}`,
    timedOut: false,
  });
});
```

---

### 1.5 `artifactService.ts` races with background execution

**File:** `server/agent/multiAgent/artifactService.ts:395-412`

```typescript
await executeRunInBackground({
  runStore: this.runStore,
  runId: run.id,
  workspaceRoot: worktreeRoot,
});

const updatedRun = await this.runStore.getRun(run.id);
// checks updatedRun.status !== "success"
```

`executeRunInBackground` (name implies async/background). If it truly runs in background, the immediately following `getRun` will fetch the run in `pending` or `running` status, not `success`, causing a false failure.

**Impact:** All artifact scaffolding will throw "Workspace action failed" even when the action succeeds.

**Recommendation:** Either:
- Rename/confirm `executeRunInBackground` actually awaits completion before returning, OR
- Poll/wait for terminal status before checking

---

### 1.6 KeraCoordinator wired without orchestrator in `server/index.ts`

**File:** `server/index.ts:59`

```typescript
const keraCoordinator = new KeraCoordinator(ticketStore); // no orchestrator!
```

But the orchestrator receives this same instance:
```typescript
const multiAgentOrchestrator = new MultiAgentOrchestrator({
  // ...
  keraCoordinator,
  // ...
});
```

Meanwhile, `multiAgentRoutes.ts:171-172` creates a **new** KeraCoordinator with the orchestrator:
```typescript
const coordinator = new KeraCoordinator(
  context.ticketStore,
  context.orchestrator,  // has orchestrator
);
```

**Impact:** Two different KeraCoordinator instances with different capabilities. The one inside the orchestrator (used by `requestKeraTurn`) can never call `startTicket` because its `orchestrator` is null. The route handler creates a new one per request with the orchestrator, so ticket creation via API works, but the orchestrator's internal Kera calls won't auto-start tickets.

**Fix in `server/index.ts`:**
```typescript
// Create orchestrator first, then pass it to Kera
const keraCoordinator = new KeraCoordinator(
  ticketStore,
  multiAgentOrchestrator,  // pass the orchestrator
);
```

This requires refactoring the circular dependency (orchestrator needs kera, kera needs orchestrator). Consider lazy injection or a post-construction setter.

---

## 2. Missing Implementations

### 2.1 No PR Service (Phase plan says v1)

**Plan ref:** "PR Service (`gh` CLI)" in architecture, Phase 5 (Opey can `commit`/`push`/`gh pr create`)

No `prService.ts` exists. No code handles the `qa_approved -> pr_preparing -> pr_ready` transitions with actual `gh pr create` commands.

**Impact:** The terminal automation status `pr_ready` can never be reached automatically.

---

### 2.2 No `max_active_tickets` enforcement

**Plan ref:** Phase 2 - "one active ticket at a time (v1 scheduler constraint)"

No code checks whether an active ticket already exists before creating/starting a new one. `runtimeBounds.maxActiveTickets = 1` is defined but never enforced.

**Recommendation:** Add to `startTicket`:
```typescript
const activeTickets = await this.ticketStore.listTickets(10);
const running = activeTickets.filter(t =>
  !["completed","failed","cancelled","escalated_human","pr_ready"].includes(t.status)
);
if (running.length >= this.runtimeBounds.maxActiveTickets) {
  throw new Error("Max active tickets reached.");
}
```

---

### 2.3 No runtime-minutes or command-count tracking

**Plan ref:** Phase 7 - "Bounded Runtime Controls"

`runtimeBounds` defines `maxRuntimeMinutesPerTicket` (45) and `maxCommandsPerTicket` (40), but no code tracks elapsed time or command count. The `escalationPolicy.ts` only checks cycle counts and turn counts.

**Impact:** Runaway tickets can consume unlimited time and API credits.

---

### 2.4 No worktree creation in any status transition

Even if `WorktreeManager` were implemented, no code in the orchestrator calls `this.worktreeManager.createWorktree()` during any transition. The plan says worktrees should be created on ticket start.

---

### 2.5 Opey/Claudy don't build context from ticket data

**File:** `server/agent/dev/opey.ts:31-33`
**File:** `server/agent/qa/claudy.ts:31-33`

Both agents accept `_ticket: EngineeringTicket` (underscore = unused). The prompt passed to the CLI is whatever the caller provides, but the agents themselves don't enrich it with:
- Ticket requirements/summary
- Previous turns and feedback
- Artifact paths
- Current cycle number

**Plan ref:** Phase 5 - "takes ticket + requirements + existing artifacts"

**Impact:** The caller (orchestrator) must build the full prompt. This is acceptable IF the orchestrator does it, but currently `processNextStep` is a no-op, so nobody builds context-rich prompts.

---

## 3. Logic Bugs

### 3.1 `turnIndex` is always 0

**File:** `server/agent/multiAgent/orchestrator.ts` (all `appendTurn` calls)

Every turn appended sets `turnIndex: 0`:
```typescript
await this.ticketStore.appendTurn({
  ticketId: ticket.id,
  cycleNumber: ticket.currentCycle,
  turnIndex: 0,  // <-- always 0
  // ...
});
```

The DB index `idx_engineering_agent_turns_ticket_id_turn_index` exists specifically for ordering by `turn_index`.

**Impact:** All turns have the same index. The escalation policy's turn-count checks will work (they count array length), but ordering and debugging will be ambiguous.

**Fix:** Query current max turn_index for the ticket/cycle and increment.

---

### 3.2 `escalationPolicy.ts` doesn't track actual dev attempts

**File:** `server/agent/multiAgent/escalationPolicy.ts:43-48`

```typescript
if (ticket.maxDevAttempts <= 0) {
  return {
    shouldEscalate: true,
    reason: "Max dev attempts is invalid (<= 0).",
  };
}
```

This only checks if the configured limit is invalid. It never compares actual attempts against the limit. `ticket.maxDevAttempts` is the **limit** (default 2), not the count of attempts made.

**Impact:** Dev attempt limits are never enforced. Opey could run unlimited implementation passes.

**Fix:** Count Opey turns with purpose "implementation" or "rework" and compare against `ticket.maxDevAttempts`.

---

### 3.3 `currentCycle` is never incremented

No code anywhere calls:
```typescript
await this.ticketStore.updateTicket(ticketId, (t) => ({
  ...t,
  currentCycle: t.currentCycle + 1,
}));
```

**Impact:** `currentCycle` stays at 0. The cycle-based escalation check `ticket.currentCycle >= ticket.maxCycles` will never trigger.

---

### 3.4 `WorkspaceRunLinker.seenKeys` is in-memory only

**File:** `server/agent/multiAgent/workspaceRunLinker.ts:29`

```typescript
private readonly seenKeys = new Set<string>();
```

Idempotency keys are lost on server restart.

**Impact:** After restart, duplicate workspace runs could be created for the same agent actions.

---

### 3.5 `normalizeRequestType` keyword detection is too broad

**File:** `server/agent/assistant/kera.ts:211-216`

```typescript
if (haystack.includes("bug") || haystack.includes("error") || haystack.includes("fix")) {
  return "bug";
}
```

A title like "Add a **fix**ed-width layout feature" would incorrectly classify as "bug". Similarly, "debugging tool" would trigger "bug".

**Impact:** Misclassification of ticket types.

**Recommendation:** Use word-boundary matching or only apply heuristics when `requestType` is explicitly missing.

---

## 4. Design Issues

### 4.1 Duplicate type definitions (client vs. server)

**Files:**
- `server/agent/multiAgent/types.ts` (source of truth)
- `src/services/multiAgentService.ts` (re-defines same types)

The client-side service re-declares `EngineeringTicket`, `EngineeringTicketEvent`, `EngineeringAgentTurn`, `EngineeringChatSession`, `EngineeringChatMessage`, and `EngineeringTicketStatus` as independent types.

**Risk:** Types drift when one file is updated but not the other.

**Recommendation:** Create a shared types package or import from a common path. At minimum, add a comment linking the two files.

---

### 4.2 Duplicated utility functions

These are copy-pasted across multiple files:

| Function | Files |
|---|---|
| `buildRepairPrompt` | `kera.ts`, `opey.ts`, `claudy.ts` |
| `buildJsonOnlyPrompt` | `codexCliRunner.ts`, `claudeCliRunner.ts` |
| `isPlainObject` | `types.ts` (ticketStore), `chatSessionStore.ts`, `agentTurnSchemas.ts` |
| `toIsoString` | `ticketStore.ts`, `chatSessionStore.ts` |
| `normalizeLimit` | `ticketStore.ts`, `chatSessionStore.ts` |

**Recommendation:** Extract shared utilities to a common module (e.g., `server/agent/multiAgent/utils.ts`).

---

### 4.3 Chat session infrastructure built too early

**File:** `server/agent/multiAgent/teamChatRouter.ts`
**Plan ref:** Phase 11 (stretch goal)

The `TeamChatRouter.postMessage()` always returns a stub:
```typescript
messageText: "Discussion-only mode. Direct agent responses are not yet enabled."
```

The chat session DB tables, store, router, routes, and client service are all wired up for a feature the plan explicitly calls a "stretch goal." This is ~500 lines of code across multiple files that adds nothing to the v1 workflow.

**Impact:** Not a bug, but increases the surface area for issues and maintenance before core functionality works.

---

### 4.4 Route handler creates new KeraCoordinator per request

**File:** `server/routes/multiAgentRoutes.ts:171-174`

```typescript
const coordinator = new KeraCoordinator(
  context.ticketStore,
  context.orchestrator,
);
```

A new instance is created on every `POST /multi-agent/tickets` request. This is wasteful and means the CodexCliRunner default settings are used each time with no way to configure them.

**Recommendation:** Use the pre-configured `keraCoordinator` from the DI context.

---

## 5. Security Concerns

### 5.1 Hardcoded Supabase credentials

**File:** `server/index.ts:29-30`

```typescript
const supabaseUrl = 'https://bqyfplifeyvkilkoneph.supabase.co';
const supabaseServiceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
```

This was already flagged in the implementation plan's "Security Note" section. The service role key is committed to the repo.

**Impact:** Anyone with repo access has full Supabase admin access.

**Fix:** Move to environment variables, fail fast if missing:
```typescript
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
```

---

### 5.2 `--dangerously-skip-permissions` used without worktree isolation

**File:** `server/agent/multiAgent/claudeCliRunner.ts:26`

The plan says "dangerous + bounded" execution happens **inside a contained per-ticket worktree**. But since worktree creation is not implemented, any CLI invocation runs in the main repo working tree with all permissions skipped.

**Impact:** Agents could modify production code directly.

---

### 5.3 No request body size enforcement on some routes

**File:** `server/routes/multiAgentRoutes.ts:400`

The `parseJsonBody` function has a 256KB limit, which is good. But there's no rate limiting or authentication on any multi-agent route. Any client can create tickets, transition statuses, and post chat messages.

**Recommendation:** Add authentication middleware for production use.

---

## 6. Positive Observations

1. **Clean type system.** `types.ts` uses `as const` arrays with derived types -- idiomatic, safe, DRY.
2. **Status machine is explicit and correct.** `statusMachine.ts` transition table covers all states with sensible allowed transitions. The `escalated_human -> [implementing, planning, cancelled]` recovery paths are well-thought-out.
3. **DB schema matches the plan precisely.** All four core tables (`engineering_tickets`, `engineering_ticket_events`, `engineering_agent_turns`, `engineering_artifacts`) match the plan's data model. Indexes are appropriate. FK cascades are correct.
4. **TicketStore is thorough.** Defensive mapping functions (`asRequestType`, `asTicketStatus`, etc.) handle malformed DB rows gracefully with safe fallbacks.
5. **Escalation policy has repeated-feedback detection.** Comparing consecutive Claudy verdicts is a smart safeguard against infinite QA loops.
6. **Event logging is append-only and consistent.** Every state transition logs to the event table with actor/context. Good for debugging.
7. **Admin UI integration is complete.** Ticket list, detail, events, turns, transitions, and chat sessions are all wired into the existing AdminDashboardView with proper loading/error states.
8. **Kayley tool integration is well-done.** `delegate_to_engineering` and `get_engineering_ticket_status` are properly added to aiSchema.ts, toolCatalog.ts, toolsAndCapabilities.ts, and memoryService.ts with correct handler logic.
9. **Runtime bounds are configurable with safe normalization.** `normalizeRuntimeBounds` and `normalizePositive` prevent invalid configurations.

---

## 7. File-by-File Summary

| File | Status | Key Issues |
|---|---|---|
| `server/agent/multiAgent/types.ts` | Good | Clean interface + const array pattern |
| `server/agent/multiAgent/statusMachine.ts` | Good | Correct transition table |
| `server/agent/multiAgent/ticketStore.ts` | Good | Defensive mapping, solid CRUD |
| `server/agent/multiAgent/eventLogger.ts` | Good | Thin wrapper, correct |
| `server/agent/multiAgent/orchestrator.ts` | **Incomplete** | `processNextStep` no-op, turnIndex=0, no worktree creation, no cycle increment |
| `server/agent/multiAgent/runtimeBounds.ts` | Good | Well-normalized defaults |
| `server/agent/multiAgent/escalationPolicy.ts` | **Bug** | Doesn't check actual dev attempts or elapsed time |
| `server/agent/multiAgent/agentTurnSchemas.ts` | Good | Clean validation, good error messages |
| `server/agent/multiAgent/agentCliRunner.ts` | Good | Repair loop pattern is sound |
| `server/agent/multiAgent/codexCliRunner.ts` | **Bug** | Wrong CLI flags, duplicated `buildJsonOnlyPrompt` |
| `server/agent/multiAgent/claudeCliRunner.ts` | **Bug** | Missing `-p`, `--output-format json`, `--max-turns 1` |
| `server/agent/multiAgent/cliExec.ts` | **Bug** | Spawn error can hang promise |
| `server/agent/multiAgent/worktreeManager.ts` | **Stub** | Both methods throw "not implemented" |
| `server/agent/multiAgent/artifactService.ts` | **Bug** | Races with background execution |
| `server/agent/multiAgent/workspaceRunLinker.ts` | **Issue** | In-memory idempotency keys |
| `server/agent/multiAgent/chatSessionStore.ts` | Good (premature) | Phase 11 stretch feature |
| `server/agent/multiAgent/teamChatRouter.ts` | Good (premature) | Returns stub response |
| `server/routes/multiAgentRoutes.ts` | **Issue** | Creates new KeraCoordinator per request |
| `src/services/multiAgentService.ts` | **Issue** | Duplicated types from server |
| `server/agent/assistant/kera.ts` | Good | Intake logic correct, minor keyword detection issue |
| `server/agent/dev/opey.ts` | **Incomplete** | Doesn't use ticket context |
| `server/agent/qa/claudy.ts` | **Incomplete** | Doesn't use ticket context |
| `server/index.ts` | **Bug + Security** | Kera missing orchestrator, hardcoded credentials |
| `src/services/aiSchema.ts` | Good | Clean tool declarations |
| `src/services/memoryService.ts` | Good | Correct tool handlers |
| `src/services/toolCatalog.ts` | Good | Proper catalog entries |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Good | Clear Kayley-facing guidance |
| `src/components/AdminDashboardView.tsx` | Good | Full CRUD + transition UI |
| `supabase/migrations/20260222_multi_agent_workflow.sql` | Good | Correct schema, indexes, triggers |
| `supabase/migrations/20260222_multi_agent_chat_sessions.sql` | Good (premature) | Phase 11 feature |
| `server/docs/bug_template.md` | Good | Clean template |
| `server/docs/feature_template.md` | Good | Clean template |

---

## Recommended Fix Priority

### Must fix before smoke testing:
1. Fix `cliExec.ts` spawn error handling (1.4)
2. Fix CLI runner invocation flags (1.3)
3. Wire KeraCoordinator with orchestrator in `server/index.ts` (1.6)
4. Fix turnIndex always-zero (3.1)
5. Move Supabase credentials to env vars (5.1)

### Must fix before autonomous workflow:
6. Implement `processNextStep` state dispatch (1.1)
7. Implement `WorktreeManager` (1.2)
8. Add worktree creation to ticket start flow (2.4)
9. Fix artifact service race condition (1.5)
10. Add cycle increment logic (3.3)
11. Add dev-attempt counting in escalation (3.2)
12. Add max-active-tickets enforcement (2.2)

### Should fix for v1 completeness:
13. Implement PR service (2.1)
14. Add runtime-minutes and command-count tracking (2.3)
15. Extract duplicated utility functions (4.2)
16. Consolidate type definitions (4.1)

### Can defer:
17. In-memory idempotency keys (3.4)
18. Request type keyword detection improvements (3.5)
19. Route authentication (5.3)
20. Chat session infrastructure cleanup (4.3)
