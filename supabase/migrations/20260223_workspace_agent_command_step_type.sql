-- Workspace Agent: allow `command` step type for safe allowlisted npm script execution.
-- Note: create only; do not execute automatically from this agent.

alter table if exists public.workspace_agent_run_steps
  drop constraint if exists workspace_agent_run_steps_type_check;

alter table if exists public.workspace_agent_run_steps
  add constraint workspace_agent_run_steps_type_check check (
    type in (
      'policy_check',
      'approval',
      'command',
      'mkdir',
      'read',
      'write',
      'search',
      'status',
      'commit',
      'push',
      'delete',
      'verify'
    )
  );
