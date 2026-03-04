-- Extend cron jobs to support monthly schedules (anchored by one_time_run_at).

alter table public.cron_jobs
  drop constraint if exists cron_jobs_schedule_consistency;

alter table public.cron_jobs
  drop constraint if exists cron_jobs_schedule_type_check;

alter table public.cron_jobs
  add constraint cron_jobs_schedule_type_check
    check (schedule_type in ('daily', 'one_time', 'monthly'));

alter table public.cron_jobs
  add constraint cron_jobs_schedule_consistency
    check (
      (
        schedule_type = 'daily'
        and schedule_hour is not null
        and schedule_minute is not null
      )
      or (
        schedule_type = 'one_time'
        and one_time_run_at is not null
      )
      or (
        schedule_type = 'monthly'
        and one_time_run_at is not null
      )
    );
