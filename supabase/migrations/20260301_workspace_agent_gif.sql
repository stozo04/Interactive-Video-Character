-- Workspace Agent: add gif step type.

alter table if exists public.workspace_agent_run_steps
  drop constraint if exists workspace_agent_run_steps_type_check;

alter table if exists public.workspace_agent_run_steps
  add constraint workspace_agent_run_steps_type_check check (
    type in (
      'policy_check',
      'approval',
      'mkdir',
      'read',
      'write',
      'search',
      'status',
      'commit',
      'push',
      'delete',
      'gif',
      'verify'
    )
  );
