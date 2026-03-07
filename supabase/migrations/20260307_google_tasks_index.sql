-- Local cache index for Google Tasks metadata.
-- Google Tasks API is still source-of-truth; this table accelerates title -> ID lookups.

CREATE TABLE IF NOT EXISTS public.google_tasks_index (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tasklist_id      TEXT NOT NULL,
  task_id          TEXT NOT NULL,
  title            TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'needsAction',
  completed_at     TIMESTAMPTZ,
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT google_tasks_index_task_identity_unique UNIQUE (tasklist_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_google_tasks_index_title_open
  ON public.google_tasks_index (title_normalized, updated_at DESC)
  WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS idx_google_tasks_index_task_identity
  ON public.google_tasks_index (tasklist_id, task_id);

