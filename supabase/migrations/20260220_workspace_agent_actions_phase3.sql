-- Workspace Agent Phase 3
-- Expands action/status support and adds approval state persistence.

alter table if exists public.workspace_agent_runs
  add column if not exists approval jsonb not null default '{"required":false,"status":"not_required"}'::jsonb;

alter table if exists public.workspace_agent_runs
  drop constraint if exists workspace_agent_runs_status_check;

alter table if exists public.workspace_agent_runs
  add constraint workspace_agent_runs_status_check check (
    status in (
      'accepted',
      'pending',
      'running',
      'requires_approval',
      'rejected',
      'success',
      'failed',
      'verification_failed'
    )
  );

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
      'verify'
    )
  );

alter table if exists public.workspace_agent_run_steps
  drop constraint if exists workspace_agent_run_steps_status_check;

alter table if exists public.workspace_agent_run_steps
  add constraint workspace_agent_run_steps_status_check check (
    status in (
      'pending',
      'running',
      'success',
      'failed',
      'verification_failed'
    )
  );
