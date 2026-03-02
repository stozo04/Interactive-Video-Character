-- Tracks every email Kayley has seen, what she said about it,
-- and what action was taken (archive / reply / dismissed / pending).
--
-- The UNIQUE constraint on gmail_message_id is the key safety net:
-- it prevents Kayley from announcing the same email twice across
-- page refreshes or reconnects.

CREATE TABLE IF NOT EXISTS public.kayley_email_actions (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Gmail identifiers
  gmail_message_id  TEXT        NOT NULL UNIQUE,  -- prevents duplicate announcements
  gmail_thread_id   TEXT,                         -- needed for threaded replies

  -- Email metadata (snapshot at time of processing)
  from_address      TEXT,
  subject           TEXT,

  -- What Kayley decided to do
  -- Values: 'pending' | 'archive' | 'reply' | 'dismissed'
  action_taken      TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (action_taken IN ('pending', 'archive', 'reply', 'dismissed')),

  -- If action_taken = 'reply', the body Kayley sent
  reply_body        TEXT,

  -- What Kayley said when she announced this email (for conversation history context)
  kayley_summary    TEXT,

  -- Timestamps
  announced_at      TIMESTAMPTZ,   -- when Kayley first spoke about it
  actioned_at       TIMESTAMPTZ,   -- when the action was executed

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup when checking "have I already announced this message?"
CREATE INDEX IF NOT EXISTS idx_kayley_email_actions_message_id
  ON public.kayley_email_actions (gmail_message_id);

-- Fast lookup for recent pending emails
CREATE INDEX IF NOT EXISTS idx_kayley_email_actions_action_created
  ON public.kayley_email_actions (action_taken, created_at DESC);

-- Auto-update updated_at on every row change
-- (Assumes update_updated_at_column trigger function already exists in this DB)
CREATE TRIGGER set_kayley_email_actions_updated_at
  BEFORE UPDATE ON public.kayley_email_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
