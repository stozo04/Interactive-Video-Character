-- Multi-agent engineering workflow tables (Phase 1 foundation).

create table if not exists public.engineering_tickets (
  id text not null,
  request_type text not null check (request_type in ('skill', 'feature', 'bug')),
  title text not null default '',
  request_summary text not null default '',
  additional_details text not null default '',
  source text not null default 'manual',
  status text not null check (
    status in (
      'created',
      'intake_acknowledged',
      'needs_clarification',
      'requirements_ready',
      'planning',
      'implementing',
      'ready_for_qa',
      'qa_testing',
      'qa_changes_requested',
      'qa_approved',
      'pr_preparing',
      'pr_ready',
      'completed',
      'failed',
      'escalated_human',
      'cancelled'
    )
  ),
  priority text not null default 'normal',
  is_ui_related boolean not null default false,
  created_by text not null default '',
  assigned_dev_agent text null,
  assigned_qa_agent text null,
  current_cycle integer not null default 0,
  max_cycles integer not null default 2,
  max_dev_attempts integer not null default 2,
  artifact_root_path text null,
  worktree_path text null,
  worktree_branch text null,
  execution_profile text not null default 'dangerous_bounded',
  runtime_limits jsonb not null default '{}'::jsonb,
  final_pr_url text null,
  pr_created_at timestamptz null,
  failure_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engineering_tickets_pkey primary key (id)
);

create table if not exists public.engineering_ticket_events (
  id text not null,
  ticket_id text not null,
  event_type text not null,
  actor_type text not null check (
    actor_type in ('system', 'kera', 'opey', 'claudy', 'human')
  ),
  actor_name text not null default '',
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint engineering_ticket_events_pkey primary key (id),
  constraint engineering_ticket_events_ticket_id_fkey
    foreign key (ticket_id)
    references public.engineering_tickets(id)
    on delete cascade
);

create table if not exists public.engineering_agent_turns (
  id text not null,
  ticket_id text not null,
  cycle_number integer not null default 0,
  turn_index integer not null default 0,
  agent_role text not null check (agent_role in ('kera', 'opey', 'claudy')),
  runtime text not null default '',
  purpose text not null default '',
  prompt_excerpt text not null default '',
  response_excerpt text not null default '',
  verdict text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint engineering_agent_turns_pkey primary key (id),
  constraint engineering_agent_turns_ticket_id_fkey
    foreign key (ticket_id)
    references public.engineering_tickets(id)
    on delete cascade
);

create table if not exists public.engineering_artifacts (
  id text not null,
  ticket_id text not null,
  artifact_type text not null,
  path text not null,
  status text not null check (
    status in ('draft', 'generated', 'validated', 'rejected', 'final')
  ),
  created_by_agent text not null default '',
  workspace_run_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engineering_artifacts_pkey primary key (id),
  constraint engineering_artifacts_ticket_id_fkey
    foreign key (ticket_id)
    references public.engineering_tickets(id)
    on delete cascade
);

create index if not exists idx_engineering_tickets_created_at
  on public.engineering_tickets using btree (created_at desc);

create index if not exists idx_engineering_tickets_status_updated_at
  on public.engineering_tickets using btree (status, updated_at desc);

create index if not exists idx_engineering_ticket_events_ticket_id_created_at
  on public.engineering_ticket_events using btree (ticket_id, created_at desc);

create index if not exists idx_engineering_agent_turns_ticket_id_turn_index
  on public.engineering_agent_turns using btree (ticket_id, turn_index);

create index if not exists idx_engineering_artifacts_ticket_id_created_at
  on public.engineering_artifacts using btree (ticket_id, created_at desc);

drop trigger if exists update_engineering_tickets_updated_at on public.engineering_tickets;
create trigger update_engineering_tickets_updated_at
  before update on public.engineering_tickets
  for each row
  execute function update_updated_at_column();

drop trigger if exists update_engineering_artifacts_updated_at on public.engineering_artifacts;
create trigger update_engineering_artifacts_updated_at
  before update on public.engineering_artifacts
  for each row
  execute function update_updated_at_column();
