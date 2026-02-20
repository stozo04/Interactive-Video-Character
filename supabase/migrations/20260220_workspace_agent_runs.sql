-- Workspace Agent run persistence
-- Stores run metadata and per-step execution evidence for Admin -> Agent dashboard.

create table if not exists public.workspace_agent_runs (
  id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null check (
    status in (
      'accepted',
      'pending',
      'running',
      'success',
      'failed',
      'verification_failed'
    )
  ),
  summary text not null default '',
  workspace_root text not null,
  request jsonb not null default '{}'::jsonb,
  constraint workspace_agent_runs_pkey primary key (id)
);

create table if not exists public.workspace_agent_run_steps (
  run_id text not null,
  step_id text not null,
  step_index integer not null default 0,
  type text not null check (type in ('policy_check', 'mkdir', 'verify')),
  status text not null check (
    status in ('pending', 'running', 'success', 'failed', 'verification_failed')
  ),
  exit_code integer null,
  evidence jsonb not null default '[]'::jsonb,
  error text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_agent_run_steps_pkey primary key (run_id, step_id),
  constraint workspace_agent_run_steps_run_id_fkey
    foreign key (run_id)
    references public.workspace_agent_runs(id)
    on delete cascade
);

create index if not exists idx_workspace_agent_runs_created_at
  on public.workspace_agent_runs using btree (created_at desc);

create index if not exists idx_workspace_agent_runs_status_updated_at
  on public.workspace_agent_runs using btree (status, updated_at desc);

create index if not exists idx_workspace_agent_run_steps_run_id_step_index
  on public.workspace_agent_run_steps using btree (run_id, step_index);

drop trigger if exists update_workspace_agent_runs_updated_at on public.workspace_agent_runs;
create trigger update_workspace_agent_runs_updated_at
  before update on public.workspace_agent_runs
  for each row
  execute function update_updated_at_column();

drop trigger if exists update_workspace_agent_run_steps_updated_at on public.workspace_agent_run_steps;
create trigger update_workspace_agent_run_steps_updated_at
  before update on public.workspace_agent_run_steps
  for each row
  execute function update_updated_at_column();
