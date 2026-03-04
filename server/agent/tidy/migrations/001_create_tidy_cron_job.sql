-- =============================================================================
-- Tidy — Midnight Code Cleaner cron job
-- Run once in Supabase SQL editor to activate.
--
-- Schedule: daily at midnight America/Chicago (CST/CDT — DST-aware).
-- next_run_at is set to the next upcoming midnight so it doesn't fire
-- immediately on insert.
--
-- Reporting: cron_job_runs and cron_job_events are written automatically
-- by the cronScheduler infrastructure for every JOB_HANDLERS execution —
-- no extra setup needed.
-- =============================================================================

INSERT INTO cron_jobs (
  title,
  action_type,
  instruction,
  schedule_type,
  timezone,
  schedule_hour,
  schedule_minute,
  next_run_at,
  payload,
  status,
  created_by
) VALUES (
  'Tidy — Midnight Code Clean',

  'code_cleaner',

  'Nightly hygiene pass. Picks the next 5 files in the project, runs Tidy (code cleaner agent), and opens a PR with any changes. Cursor advances automatically after each batch.',

  'daily',

  'America/Chicago',

  0,   -- midnight (hour)
  0,   -- midnight (minute)

  -- Next midnight in America/Chicago, DST-aware.
  -- date_trunc gives us the start of today in Chicago time;
  -- +1 day gives us the start of tomorrow = next midnight.
  -- Casting back via AT TIME ZONE gives the correct UTC timestamp.
  (date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '1 day')
    AT TIME ZONE 'America/Chicago',

  '{"cursor": 0}',

  'active',

  'system'
);
