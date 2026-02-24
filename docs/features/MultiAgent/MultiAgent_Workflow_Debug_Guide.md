# Multi-Agent Workflow Debug Guide (Happy + Unhappy Paths)

This document is a **debug map** for the multi-agent workflow. It is designed for a new engineer who needs to understand and troubleshoot the full flow across many files.

---

## 0) Quick Entry Points (Start Here)

**Main server entry:**
- `server/index.ts`

**Multi-agent HTTP routes:**
- `server/routes/multiAgentRoutes.ts`

**Workflow brain:**
- `server/agent/multiAgent/orchestrator.ts`

**Agents:**
- `server/agent/assistant/kera.ts`
- `server/agent/dev/opey.ts`
- `server/agent/qa/claudy.ts`

**Persistence (Supabase):**
- `server/agent/multiAgent/ticketStore.ts`

**CLI runners:**
- `server/agent/multiAgent/codexCliRunner.ts`
- `server/agent/multiAgent/claudeCliRunner.ts`

**Auto-start loop:**
- `server/agent/multiAgent/intakeWatcher.ts`

---

## 1) Happy Path (Skill Request → Ticket → Opey → Claudy → Done)

ASCII flow (end-to-end):

```
User message
   |
   v
Kayley decides to call tool (delegate_to_engineering)
   |
   v
Frontend tool runtime (memoryService.ts)
   |
   v
API client (multiAgentService.ts)
   |
   v
POST /multi-agent/tickets (multiAgentRoutes.ts)
   |
   v
KeraCoordinator.createTicketFromIntake (kera.ts)
   |
   v
Ticket saved to Supabase (ticketStore.ts)
   |
   v
IntakeWatcher sees status=created (intakeWatcher.ts)
   |
   v
Orchestrator.startTicket + processNextStep (orchestrator.ts)
   |
   v
Status moves to intake_acknowledged -> requirements_ready
   |
   v
Opey turn requested (orchestrator.ts -> opey.ts)
   |
   v
WorkspaceRunLinker creates run(s) (workspaceRunLinker.ts)
   |
   v
Claudy review requested (orchestrator.ts -> claudy.ts)
   |
   v
Ticket advances to ready/completed
```

**Where to watch logs:**
- `[MultiAgentIntakeWatcher]` for auto-start
- `[MultiAgentOrchestrator]` for status transitions and turn triggers
- `[KeraCoordinator]`, `[OpeyDeveloperAgent]`, `[ClaudyQaAgent]` for agent actions
- `[MultiAgentEventLogger]` for event trail

---

## 2) Unhappy Path: Missing Details → Needs Clarification

```
POST /multi-agent/tickets
   |
   v
KeraCoordinator.createTicketFromIntake
   |
   v
Insufficient details -> needsClarification = true
   |
   v
Ticket status = needs_clarification
   |
   v
Orchestrator does NOT trigger Opey
```

**API response detail (from `server/routes/multiAgentRoutes.ts`):**
- The response includes `needsClarification: true` and a human-readable `message`.
- This is how the caller knows Kera needs more info.
- Handler: `handleCreateTicket(...)` in `server/routes/multiAgentRoutes.ts`.

**What happens next:**
- The ticket remains in `needs_clarification`.
- No Opey or Claudy turn is triggered.
- You must provide additional details (usually via a new intake or manual update).

**Example log clues:**
- `[KeraCoordinator] ticket created { ... needsClarification: true ... }`
- `[MultiAgentEventLogger] ticket=<id> event=ticket_created actor=kera`

**Debug locations:**
- `server/agent/assistant/kera.ts` (needsClarification decision)
- `server/agent/multiAgent/statusMachine.ts` (allowed status)

---

## 3) Unhappy Path: Invalid Status Transition

```
POST /multi-agent/tickets/:id/transition
   |
   v
assertValidStatus + isAllowedTransition
   |
   v
Error: Invalid transition
```

**Debug locations:**
- `server/agent/multiAgent/statusMachine.ts`
- `server/agent/multiAgent/orchestrator.ts` (transitionTicket)

---

## 4) Unhappy Path: Opey CLI Returns Invalid JSON

```
Opey turn requested
   |
   v
codexCliRunner.ts executes CLI
   |
   v
agentCliRunner.ts validates JSON
   |
   v
Invalid JSON -> repair retry -> still invalid
   |
   v
Turn rejected -> possible escalation later
```

**Debug locations:**
- `server/agent/multiAgent/agentCliRunner.ts`
- `server/agent/multiAgent/codexCliRunner.ts`

---

## 5) Unhappy Path: Claudy Rejects (QA Changes Requested)

```
Claudy review turn
   |
   v
verdict = changes_requested
   |
   v
Ticket status -> qa_changes_requested
   |
   v
Orchestrator re-triggers Opey
```

**Debug locations:**
- `server/agent/qa/claudy.ts`
- `server/agent/multiAgent/orchestrator.ts`

---

## 6) Unhappy Path: Circuit Breakers / Escalation

```
Too many cycles OR dev attempts
   |
   v
Escalation policy triggers
   |
   v
Ticket -> escalated_human
```

**Debug locations:**
- `server/agent/multiAgent/escalationPolicy.ts`
- `server/agent/multiAgent/orchestrator.ts`

---

## 7) Unhappy Path: Workspace Run Failures

```
Opey requests workspace actions
   |
   v
WorkspaceRunLinker creates runs
   |
   v
Run fails or verification fails
   |
   v
Orchestrator may re-trigger Opey or escalate
```

**Debug locations:**
- `server/agent/multiAgent/workspaceRunLinker.ts`
- `server/agent/runStore.ts` and `server/agent/supabaseRunStore.ts`
- `server/agent/executor.ts`

---

## 8) Unhappy Path: Supabase Errors

```
Ticket store insert/update
   |
   v
Supabase error
   |
   v
Request fails with 500
```

**Debug locations:**
- `server/agent/multiAgent/ticketStore.ts`
- Server log output from `[MultiAgentTicketStore]`

---

## 9) “Where to Look First” Debug Checklist

1) **Is the server running and listening?**
   - Look for `[WorkspaceAgent] Server listening` in logs.

2) **Did a ticket get created?**
   - Check `engineering_tickets` table in Supabase.
   - Logs: `[MultiAgentEventLogger] ticket_created`

3) **Did the intake watcher run?**
   - Logs: `[MultiAgentIntakeWatcher] Processing tickets`

4) **Did orchestrator move status?**
   - Logs: `[MultiAgentOrchestrator] startTicket`

5) **Did Opey/Claudy run?**
   - Logs: `[OpeyDeveloperAgent]` / `[ClaudyQaAgent]`

6) **Did the CLI runner fail?**
   - Logs: `[CodexCliRunner]` or `[ClaudeCliRunner]`

---

## 10) Glossary (Quick Definitions)

- **Ticket**: an engineering request tracked in Supabase.
- **Turn**: a single agent response (Kera/Opey/Claudy).
- **Event**: audit log entry for status transitions or actions.
- **Artifact**: generated file placeholder (feature/bug/skill docs).
- **Worktree**: isolated git folder per ticket.
