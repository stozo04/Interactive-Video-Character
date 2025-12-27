-- ============================================================================
-- Kayley Presence State Table Migration
-- Tracks what Kayley is currently wearing/doing/feeling for context-aware selfies
-- ============================================================================

-- ============================================================================
-- KAYLEY PRESENCE STATE TABLE
-- ============================================================================
-- Tracks Kayley's current state mentioned in conversation
-- Used for generating context-appropriate selfies

CREATE TABLE IF NOT EXISTS kayley_presence_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,

  -- Current state (what she last mentioned)
  current_outfit TEXT,              -- "just got back from the gym", "in my pajamas", "getting ready for dinner"
  current_mood TEXT,                -- "feeling cute today", "tired from work", "excited"
  current_activity TEXT,            -- "making coffee", "working on laptop", "relaxing"
  current_location TEXT,            -- "at home", "at the gym", "at a coffee shop"

  -- When she mentioned it
  last_mentioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- How long this state is valid (some states expire quickly)
  expires_at TIMESTAMPTZ,           -- NULL = no expiration, otherwise auto-expire

  -- Confidence in the detection (0.0-1.0)
  confidence REAL DEFAULT 1.0
    CHECK (confidence >= 0 AND confidence <= 1),

  -- Source tracking
  source_message_id TEXT,           -- Which message created this state

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_kayley_presence_user
  ON kayley_presence_state(user_id);

CREATE INDEX IF NOT EXISTS idx_kayley_presence_expires
  ON kayley_presence_state(expires_at)
  WHERE expires_at IS NOT NULL;

-- ============================================================================
-- AUTO-UPDATE TIMESTAMP TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_kayley_presence_updated_at') THEN
    CREATE TRIGGER trigger_kayley_presence_updated_at
      BEFORE UPDATE ON kayley_presence_state
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE kayley_presence_state ENABLE ROW LEVEL SECURITY;

-- Allow all operations (using custom user IDs from Google Auth)
CREATE POLICY "Allow all operations for kayley_presence_state"
  ON kayley_presence_state FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE kayley_presence_state IS
'Tracks what Kayley is currently wearing/doing/feeling based on her conversation responses. Used for generating context-appropriate selfies.';

COMMENT ON COLUMN kayley_presence_state.current_outfit IS
'What Kayley mentioned she is wearing or just did (e.g., "just got back from the gym", "in my cozy hoodie")';

COMMENT ON COLUMN kayley_presence_state.current_mood IS
'Kayley''s current mood mentioned in conversation (e.g., "feeling cute", "tired", "excited")';

COMMENT ON COLUMN kayley_presence_state.current_activity IS
'What Kayley is currently doing (e.g., "making coffee", "working", "relaxing on the couch")';

COMMENT ON COLUMN kayley_presence_state.expires_at IS
'When this state becomes stale. NULL = persists until explicitly updated. Some states like "making coffee" expire quickly (15 min), others like "at the gym" last longer (2 hours).';

COMMENT ON COLUMN kayley_presence_state.confidence IS
'LLM confidence in the detection (0.0-1.0). Higher confidence = more explicit mention.';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Run this migration in Supabase SQL Editor to enable Kayley presence tracking.
-- This allows the AI to remember what she mentioned wearing/doing and use it
-- for generating context-appropriate selfies.
-- ============================================================================
