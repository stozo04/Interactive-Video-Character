-- Sync cron_jobs / cron_job_runs columns to match app expectations.
-- This is safe to apply when columns already exist.

alter table public.cron_jobs
  add column if not exists search_query text;

alter table public.cron_jobs
  add column if not exists summary_instruction text;

alter table public.cron_jobs
  add column if not exists schedule_type text;

alter table public.cron_jobs
  add column if not exists timezone text;

alter table public.cron_jobs
  add column if not exists schedule_hour smallint;

alter table public.cron_jobs
  add column if not exists schedule_minute smallint;

alter table public.cron_jobs
  add column if not exists one_time_run_at timestamptz;

alter table public.cron_jobs
  add column if not exists next_run_at timestamptz;

alter table public.cron_jobs
  add column if not exists status text;

alter table public.cron_jobs
  add column if not exists created_by text;

update public.cron_jobs
  set search_query = coalesce(search_query, '')
  where search_query is null;

update public.cron_jobs
  set summary_instruction = coalesce(summary_instruction, '')
  where summary_instruction is null;

update public.cron_jobs
  set schedule_type = coalesce(schedule_type, 'daily')
  where schedule_type is null;

update public.cron_jobs
  set timezone = coalesce(timezone, 'America/Chicago')
  where timezone is null;

update public.cron_jobs
  set status = coalesce(status, 'active')
  where status is null;

update public.cron_jobs
  set created_by = coalesce(created_by, 'user')
  where created_by is null;

alter table public.cron_jobs
  alter column search_query set default '';

alter table public.cron_jobs
  alter column summary_instruction set default '';

alter table public.cron_jobs
  alter column schedule_type set default 'daily';

alter table public.cron_jobs
  alter column timezone set default 'America/Chicago';

alter table public.cron_jobs
  alter column status set default 'active';

alter table public.cron_jobs
  alter column created_by set default 'user';

alter table public.cron_jobs
  alter column search_query set not null;

alter table public.cron_jobs
  alter column summary_instruction set not null;

alter table public.cron_jobs
  alter column schedule_type set not null;

alter table public.cron_jobs
  alter column timezone set not null;

alter table public.cron_jobs
  alter column status set not null;

alter table public.cron_jobs
  alter column created_by set not null;

alter table public.cron_job_runs
  add column if not exists search_query text;

alter table public.cron_job_runs
  add column if not exists search_results jsonb;

update public.cron_job_runs
  set search_query = coalesce(search_query, '')
  where search_query is null;

update public.cron_job_runs
  set search_results = coalesce(search_results, '[]'::jsonb)
  where search_results is null;

alter table public.cron_job_runs
  alter column search_query set default '';

alter table public.cron_job_runs
  alter column search_results set default '[]'::jsonb;

alter table public.cron_job_runs
  alter column search_query set not null;

alter table public.cron_job_runs
  alter column search_results set not null;
