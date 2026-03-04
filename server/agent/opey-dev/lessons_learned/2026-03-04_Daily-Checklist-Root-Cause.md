# Lessons Learned — Daily Checklist Not Updating — 2026-03-04

## Ticket
Daily tasks created by Kayley via AI did not appear in the Daily Checklist panel without a page refresh.

## Root Cause (the actual bug — not what you thought)

`task_action` is a **Gemini function tool**, not a JSON response field.

When Kayley creates a task, `geminiChatService.ts` calls `executeMemoryTool('task_action', ...)`
inside the AI interaction loop. `memoryService.ts` calls `taskService.createTask` directly —
the task is saved to the DB, but **React state is never touched**.

The final `response` object returned by the AI service has NO `task_action` field.
`determineActionType(response)` returns `ActionType.NONE`.
`result.refreshTasks` is never set. `refreshTasks()` is never called. Panel stays stale.

**The previous fix (PR #36) was wrong:** it added `await refreshTasks()` inside `handleTaskCreate`
for the null-return case. But `handleTaskCreate` is the *manual UI path* — for AI-created tasks,
the code goes through `memoryService.executeMemoryTool` and never reaches `handleTaskCreate` at all.

## How I Found It

1. Read `taskService.ts` — `createTask` returns a task OR null on RLS block.
2. Read `useTasks.ts` — happy path does `setTasks(prev => [...prev, newTask])` correctly.
3. Traced the AI path: `messageOrchestrator` → `geminiChatService.generateResponse` → tool loop.
4. Found `executeMemoryTool('task_action')` in `memoryService.ts` — calls `createTask` directly.
5. Confirmed `response.task_action` is always null when function tool is used.
6. Confirmed `determineActionType` only returns `ActionType.TASK` when `response.task_action` is set.

## Fix Applied

Three files changed:

**`memoryService.ts`** — Added module-level `_taskMutationPending` flag.
Set it to `true` in the `create`, `complete`, and `delete` cases of `task_action`.
Exposed `consumeTaskMutationSignal()` which reads and resets the flag atomically.

**`messageOrchestrator.ts`** — After `determineActionType`, also call `consumeTaskMutationSignal()`.
If it returns true, set `result.refreshTasks = true` and `result.openTaskPanel = true`.
This covers the function-tool path that `determineActionType` misses.

**`App.tsx`** — Changed `refreshTasks()` to `await refreshTasks()` before `setIsTaskPanelOpen(true)`.
Panel now opens AFTER the fresh task list is loaded, not before (prevents a stale-then-update flash).

## Diagnostic Process That Worked

When a UI element doesn't update after a backend mutation:

1. **Ask: where does the mutation actually happen?**
   - Is it in React state (good)? Or directly in the DB (bypasses state)?

2. **Trace every path from user action to DB write.**
   - AI-triggered actions go through: `App.tsx` → `messageOrchestrator` → `geminiChatService`
     → `executeMemoryTool` → `taskService`. Each hop is a potential bypass of React state.

3. **Check the bridge between DB write and React state.**
   - If the DB write happens inside a service, React state only updates if:
     a. The service returns the result and the caller does `setTasks(...)`, OR
     b. `refreshTasks()` is explicitly called after the write
   - If neither happens, state is stale.

4. **Look at the flags that trigger refreshes** (`result.refreshTasks`, `result.openTaskPanel`)
   and trace what conditions set them. Then verify those conditions are actually met
   for the specific code path being tested.

## What Future Opey Should Know

- **Function tools bypass React state entirely.** Any tool in `memoryService.executeMemoryTool`
  that writes to the DB must also signal the orchestrator to trigger a UI refresh.
  Use `_taskMutationPending` pattern or similar.

- **`determineActionType` only detects JSON-response task actions.** It will never return
  `ActionType.TASK` for function-tool task actions. Both paths need to be handled.

- **Don't fix the symptom, find the path.** The previous fix targeted the wrong code path
  (`handleTaskCreate` null-return case) because it didn't trace where AI task creation
  actually executes. Always trace the full call chain before writing a fix.

- **`await refreshTasks()` before opening the panel.** If you open the panel before
  the refresh completes, the user sees a stale list for a moment. Always await first.
