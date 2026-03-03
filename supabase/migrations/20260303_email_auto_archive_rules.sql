-- Stores sender-level auto-archive rules.
--
-- When a sender's email address appears here, gmailPoller.ts skips the
-- full announcement + "what do you want to do?" flow and silently archives
-- their emails, sending Steven a brief one-liner instead.
--
-- Rules are added interactively via WhatsApp: after a manual archive,
-- Kayley asks "always archive from X?" — a "yes" inserts a row here.

CREATE TABLE IF NOT EXISTS public.email_auto_archive_rules (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Normalized (lowercase) sender email address — the match key
  sender_email  TEXT        NOT NULL UNIQUE,

  -- Human-readable name extracted from the "From" header (e.g. "Joe Test")
  -- Nullable: populated on creation, used in WA notifications
  display_name  TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup used on every incoming email
CREATE INDEX IF NOT EXISTS idx_email_auto_archive_rules_sender
  ON public.email_auto_archive_rules (sender_email);
