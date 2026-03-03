-- Migration: Restore needs_clarification to engineering_tickets.status
-- Run this in the Supabase SQL editor.
--
-- engineering_tickets.status is most likely a TEXT column with a CHECK constraint.
-- If it uses a PostgreSQL enum type instead, use the enum block at the bottom.
-- ============================================================

-- ---- OPTION A: CHECK constraint (most likely) ----
-- Drop the existing constraint and re-add it with needs_clarification included.

ALTER TABLE engineering_tickets
  DROP CONSTRAINT IF EXISTS engineering_tickets_status_check;

ALTER TABLE engineering_tickets
  ADD CONSTRAINT engineering_tickets_status_check CHECK (status IN (
    'created',
    'intake_acknowledged',
    'needs_clarification',
    'requirements_ready',
    'planning',
    'implementing',
    'pr_preparing',
    'pr_ready',
    'completed',
    'failed',
    'escalated_human',
    'cancelled'
  ));

-- ---- OPTION B: PostgreSQL ENUM type (only if Option A fails) ----
-- If the column is backed by a custom enum type, use this instead.
-- Note: Postgres does not allow removing enum values, only adding.

-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_enum
--     WHERE enumlabel = 'needs_clarification'
--       AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'engineering_ticket_status')
--   ) THEN
--     ALTER TYPE engineering_ticket_status ADD VALUE 'needs_clarification' AFTER 'intake_acknowledged';
--   END IF;
-- END $$;
