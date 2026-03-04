-- Extend cron_jobs to support server-side action routing and payloads.
-- This keeps backward compatibility with existing search_query/summary_instruction fields.

alter table public.cron_jobs
  add column if not exists action_type text not null default 'web_search';

alter table public.cron_jobs
  add column if not exists instruction text not null default '';

alter table public.cron_jobs
  add column if not exists payload jsonb not null default '{}'::jsonb;

-- Extend cron_job_runs to capture action metadata.
alter table public.cron_job_runs
  add column if not exists action_type text null;

alter table public.cron_job_runs
  add column if not exists execution_metadata jsonb not null default '{}'::jsonb;
