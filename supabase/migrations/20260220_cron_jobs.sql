-- Cron Jobs: scheduled web-search digests and execution history.
-- Supports Kayley chat-driven scheduling + manual admin management.

create table if not exists public.cron_jobs (
  id uuid not null default gen_random_uuid(),
  title text not null,
  search_query text not null,
  summary_instruction text not null default '',
  schedule_type text not null check (schedule_type in ('daily', 'one_time')),
  timezone text not null default 'America/Chicago',
  schedule_hour smallint null check (schedule_hour between 0 and 23),
  schedule_minute smallint null check (schedule_minute between 0 and 59),
  one_time_run_at timestamptz null,
  next_run_at timestamptz null,
  status text not null default 'active' check (
    status in ('active', 'paused', 'running', 'completed', 'failed')
  ),
  created_by text not null default 'user',
  last_run_at timestamptz null,
  last_run_status text null check (last_run_status in ('success', 'failed')),
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cron_jobs_pkey primary key (id),
  constraint cron_jobs_schedule_consistency check (
    (
      schedule_type = 'daily'
      and schedule_hour is not null
      and schedule_minute is not null
    )
    or (
      schedule_type = 'one_time'
      and one_time_run_at is not null
    )
  )
);

create table if not exists public.cron_job_runs (
  id uuid not null default gen_random_uuid(),
  cron_job_id uuid not null,
  scheduled_for timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  status text not null check (status in ('running', 'success', 'failed')),
  search_query text not null,
  search_results jsonb not null default '[]'::jsonb,
  summary text null,
  error text null,
  delivered boolean not null default false,
  delivered_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cron_job_runs_pkey primary key (id),
  constraint cron_job_runs_cron_job_id_fkey
    foreign key (cron_job_id)
    references public.cron_jobs(id)
    on delete cascade,
  constraint cron_job_runs_job_time_unique unique (cron_job_id, scheduled_for)
);

create index if not exists idx_cron_jobs_status_next_run_at
  on public.cron_jobs using btree (status, next_run_at);

create index if not exists idx_cron_jobs_created_at
  on public.cron_jobs using btree (created_at desc);

create index if not exists idx_cron_job_runs_job_created_at
  on public.cron_job_runs using btree (cron_job_id, created_at desc);

create index if not exists idx_cron_job_runs_pending_delivery
  on public.cron_job_runs using btree (status, delivered, created_at desc);

drop trigger if exists update_cron_jobs_updated_at on public.cron_jobs;
create trigger update_cron_jobs_updated_at
  before update on public.cron_jobs
  for each row
  execute function update_updated_at_column();

drop trigger if exists update_cron_job_runs_updated_at on public.cron_job_runs;
create trigger update_cron_job_runs_updated_at
  before update on public.cron_job_runs
  for each row
  execute function update_updated_at_column();
