-- Cron job lifecycle event log for admin visibility and auditability.

create table if not exists public.cron_job_events (
  id uuid not null default gen_random_uuid(),
  cron_job_id uuid null,
  cron_run_id uuid null,
  event_type text not null,
  actor text not null default 'system',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cron_job_events_pkey primary key (id),
  constraint cron_job_events_cron_job_id_fkey
    foreign key (cron_job_id)
    references public.cron_jobs(id)
    on delete set null,
  constraint cron_job_events_cron_run_id_fkey
    foreign key (cron_run_id)
    references public.cron_job_runs(id)
    on delete set null
);

create index if not exists idx_cron_job_events_created_at
  on public.cron_job_events using btree (created_at desc);

create index if not exists idx_cron_job_events_job_created_at
  on public.cron_job_events using btree (cron_job_id, created_at desc);
