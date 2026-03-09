-- =============================================================================
-- Tidy — Weekly stale branch cleanup cron job
-- Run once in Supabase SQL editor to activate.
--
-- Schedule: weekly, every Sunday at midnight America/Chicago.
-- Deletes remote tidy-* branches older than 7 days.
--
-- Uses one_time_run_at (required by schema for weekly schedule_type).
-- The cronScheduler advances next_run_at by 7 days after each run.
-- =============================================================================

INSERT INTO cron_jobs (
  title,
  action_type,
  instruction,
  schedule_type,
  timezone,
  one_time_run_at,
  next_run_at,
  payload,
  status,
  created_by
) VALUES (
  'Tidy — Weekly Branch Cleanup',

  'tidy_branch_cleanup',

  'Delete stale tidy-* remote branches older than 7 days. Prevents GitHub from accumulating orphaned branches from crashed Tidy runs.',

  'weekly',

  'America/Chicago',

  -- Next Sunday at midnight America/Chicago, DST-aware.
  -- Find the start of next week (Monday), subtract 1 day = Sunday, cast to UTC.
  (
    date_trunc('week', now() AT TIME ZONE 'America/Chicago')
    + interval '7 days'  -- next Sunday (start of following week)
  ) AT TIME ZONE 'America/Chicago',

  -- next_run_at = same as one_time_run_at for initial scheduling
  (
    date_trunc('week', now() AT TIME ZONE 'America/Chicago')
    + interval '7 days'
  ) AT TIME ZONE 'America/Chicago',

  '{}',

  'active',

  'system'
);
