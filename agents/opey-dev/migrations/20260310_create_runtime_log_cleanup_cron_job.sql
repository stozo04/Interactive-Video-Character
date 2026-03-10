-- =============================================================================
-- Nightly cleanup for server_runtime_logs + engineering_ticket_events
-- Run once in Supabase SQL editor to activate.
--
-- Schedule: daily at 00:30 America/Chicago (CST/CDT - DST-aware).
-- next_run_at is set to the next upcoming 00:30 so it doesn't fire immediately.
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
  'Nightly log cleanup',

  'runtime_log_cleanup',

  'Delete server_runtime_logs and engineering_ticket_events rows older than 7 days.',

  'daily',

  'America/Chicago',

  0,   -- hour (00:30)
  30,  -- minute

  -- Next 00:30 in America/Chicago, DST-aware.
  -- date_trunc gives us the start of today in Chicago time;
  -- +1 day gives us the start of tomorrow, +30 minutes sets 00:30.
  (date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '1 day' + interval '30 minutes')
    AT TIME ZONE 'America/Chicago',

  '{"retentionDays": 7}',

  'active',

  'system'
);
