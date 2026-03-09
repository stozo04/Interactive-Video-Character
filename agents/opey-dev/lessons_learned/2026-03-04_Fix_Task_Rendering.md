# Lessons Learned — Fix_Task_Rendering — 2026-03-04

## Ticket
Fix Daily Checklist tasks not rendering immediately after creation and update autonomy instructions.

## Codebase Discoveries
- `src/hooks/useTasks.ts` owns task creation and state updates; `TaskPanel` only filters/render tasks.
- `taskService.createTask` returns `null` when Supabase insert fails or returns no row data.

## Gotchas & Bugs
- If the insert succeeds but returns no row data (e.g., select blocked), UI stays stale unless a refresh occurs.

## Approach That Worked
- On a `null` create response, refresh tasks via `fetchTasks` and update local state; add a regression test.

## What Future Opey Should Know
- Always provide a refresh fallback for task creation so UI state stays consistent with the database.
