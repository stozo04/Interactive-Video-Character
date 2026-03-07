-- calendar_heartbeat_alerts
-- Persistent dedup for calendarHeartbeat.ts.
-- One row per event per type per day. Replaces the in-memory Set that was
-- wiped on every server restart, causing duplicate alerts.

CREATE TABLE IF NOT EXISTS calendar_heartbeat_alerts (
  event_id     TEXT    NOT NULL,
  alert_type   TEXT    NOT NULL CHECK (alert_type IN ('upcoming', 'followup')),
  alerted_date DATE    NOT NULL DEFAULT CURRENT_DATE,

  PRIMARY KEY (event_id, alert_type, alerted_date)
);

-- Auto-prune rows older than 7 days to keep the table small.
-- This is a lightweight cron-style approach; Supabase doesn't enforce it
-- automatically but the INSERT ... ON CONFLICT DO NOTHING pattern means
-- old rows are harmless and can be cleaned up manually or via a pg_cron job.

COMMENT ON TABLE calendar_heartbeat_alerts IS
  'Dedup log for calendar event alerts. One row per event/type/day. Server restarts safe.';
