-- Kayley's self-evolution proposal log.
-- Every nightly run writes a versioned snapshot of her behavioral preferences.
-- Transparently tracks what she proposed, why, and what changed.

CREATE TABLE IF NOT EXISTS public.kayley_evolution_proposals (
  id              uuid         NOT NULL DEFAULT uuid_generate_v4(),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  proposed_changes            text NOT NULL, -- what specifically she changed
  reasoning                   text NOT NULL, -- what pattern in conversations triggered it
  behavioral_notes_snapshot   text NOT NULL, -- full applied behavioral notes after this change
  change_summary              text NOT NULL, -- one-liner for natural check-in
  version_number              integer NOT NULL,
  CONSTRAINT kayley_evolution_proposals_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_kayley_evolution_proposals_created_at
  ON public.kayley_evolution_proposals(created_at DESC);

-- Seed cron jobs

-- Persona evolution: daily at 3am CDT (America/Chicago, UTC-5 during DST)
INSERT INTO public.cron_jobs (
  title, action_type, instruction, search_query, summary_instruction,
  schedule_type, timezone, schedule_hour, schedule_minute, next_run_at, status
) VALUES (
  'Persona Evolution',
  'persona_evolution',
  'Review the last 24 hours of conversations and evolve your behavioral preferences.',
  '',
  '',
  'daily',
  'America/Chicago',
  3,
  0,
  '2026-03-11 08:00:00+00',
  'active'
);

-- Log cleanup: weekly on Mondays at midnight CDT (America/Chicago)
-- one_time_run_at anchors the weekday (March 16, 2026 = Monday)
INSERT INTO public.cron_jobs (
  title, action_type, instruction, search_query, summary_instruction,
  schedule_type, timezone, schedule_hour, schedule_minute,
  one_time_run_at, next_run_at, status
) VALUES (
  'Log Cleanup',
  'log_cleanup',
  'Delete server_runtime_logs and engineering_ticket_events older than 7 days.',
  '',
  '',
  'weekly',
  'America/Chicago',
  0,
  0,
  '2026-03-16 05:00:00+00',
  '2026-03-16 05:00:00+00',
  'active'
);
