-- ============================================================================
-- Image Generation Tables Migration
-- Supports multi-reference image system with current look locking and history
-- ============================================================================

-- ============================================================================
-- 1. CURRENT LOOK STATE TABLE
-- ============================================================================
-- Stores locked "current look" (hairstyle) for 24h consistency
-- Prevents unrealistic hairstyle changes within same conversation/day

CREATE TABLE IF NOT EXISTS current_look_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Current locked appearance
  hairstyle TEXT NOT NULL
    CHECK (hairstyle IN ('curly', 'straight', 'messy_bun')),
  reference_image_id TEXT NOT NULL,

  -- Lock timing
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Lock reason for debugging
  lock_reason TEXT NOT NULL
    CHECK (lock_reason IN ('session_start', 'first_selfie_of_day', 'explicit_now_selfie')),

  -- Active flag
  is_current_look BOOLEAN NOT NULL DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One current look per user (upsert on conflict)
  CONSTRAINT uniq_current_look_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_current_look_user ON current_look_state(user_id);
CREATE INDEX IF NOT EXISTS idx_current_look_expires ON current_look_state(expires_at);
CREATE INDEX IF NOT EXISTS idx_current_look_active ON current_look_state(user_id, is_current_look) WHERE is_current_look = TRUE;

-- ============================================================================
-- 2. SELFIE GENERATION HISTORY TABLE
-- ============================================================================
-- Tracks all selfie generations for anti-repetition and analytics
-- Used to penalize recently-used references (with same-scene exception)

CREATE TABLE IF NOT EXISTS selfie_generation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- What was selected
  reference_image_id TEXT NOT NULL,
  hairstyle TEXT NOT NULL
    CHECK (hairstyle IN ('curly', 'straight', 'messy_bun')),
  outfit_style TEXT NOT NULL
    CHECK (outfit_style IN ('casual', 'dressed_up', 'athletic', 'cozy')),

  -- Context at generation time
  scene TEXT NOT NULL,
  mood TEXT,  -- Nullable (user might not have mood set)

  -- Temporal context
  is_old_photo BOOLEAN NOT NULL DEFAULT FALSE,
  reference_date TIMESTAMPTZ,  -- Nullable (only set for old photos)

  -- Selection reasoning (for debugging)
  selection_factors JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Generation timestamp
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_selfie_history_user ON selfie_generation_history(user_id);
CREATE INDEX IF NOT EXISTS idx_selfie_history_user_generated ON selfie_generation_history(user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_selfie_history_reference ON selfie_generation_history(reference_image_id, generated_at DESC);

-- ============================================================================
-- 3. AUTO-UPDATE TIMESTAMP TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to new tables
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_current_look_updated_at') THEN
    CREATE TRIGGER trigger_current_look_updated_at
      BEFORE UPDATE ON current_look_state
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_selfie_history_updated_at') THEN
    CREATE TRIGGER trigger_selfie_history_updated_at
      BEFORE UPDATE ON selfie_generation_history
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;

-- ============================================================================
-- 4. ROW LEVEL SECURITY POLICIES
-- ============================================================================
-- Enable RLS for security

ALTER TABLE current_look_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE selfie_generation_history ENABLE ROW LEVEL SECURITY;

-- Create policies for anon access (custom user IDs from Google Auth)
CREATE POLICY "Allow all operations for current_look_state"
  ON current_look_state FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for selfie_generation_history"
  ON selfie_generation_history FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 5. COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE current_look_state IS
'Stores locked "current look" (hairstyle) for 24h consistency. Prevents unrealistic hairstyle changes within same conversation/day. Old photos can bypass lock.';

COMMENT ON TABLE selfie_generation_history IS
'Tracks all selfie generations for anti-repetition penalties. Used to penalize recently-used references (with same-scene exception).';

COMMENT ON COLUMN current_look_state.lock_reason IS
'Why was this look locked: session_start (first message), first_selfie_of_day, or explicit_now_selfie (user requested current photo)';

COMMENT ON COLUMN selfie_generation_history.selection_factors IS
'JSONB object storing all scoring factors used in reference selection for debugging (scene_match, mood_affinity, time_of_day, etc.)';

COMMENT ON COLUMN selfie_generation_history.is_old_photo IS
'TRUE if this was an old photo from the past (bypasses current look lock). Detected via LLM temporal analysis.';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- This migration creates tables for the multi-reference image generation system.
-- Run in Supabase SQL Editor to enable dynamic reference image selection with
-- hairstyle consistency and anti-repetition tracking.
-- ============================================================================
