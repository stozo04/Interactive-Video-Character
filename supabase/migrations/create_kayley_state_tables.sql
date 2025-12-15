-- ============================================================================
-- Kayley State Tables Migration
-- Moves all localStorage state to Supabase for persistence across devices
-- ============================================================================

-- ============================================================================
-- 1. MOOD STATES TABLE
-- ============================================================================
-- Stores Kayley's emotional state per user (was kayley_mood_state localStorage)

CREATE TABLE IF NOT EXISTS mood_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  
  -- Base energy and battery
  daily_energy DECIMAL(3,2) NOT NULL DEFAULT 0.7
    CHECK (daily_energy >= 0 AND daily_energy <= 1),
  social_battery DECIMAL(3,2) NOT NULL DEFAULT 1.0
    CHECK (social_battery >= 0 AND social_battery <= 1),
  
  -- Internal processing flag
  internal_processing BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Daily seed for consistent behavior
  daily_seed INTEGER NOT NULL DEFAULT 0,
  
  -- Last interaction tracking
  last_interaction_at TIMESTAMPTZ,
  last_interaction_tone DECIMAL(3,2) DEFAULT 0.0
    CHECK (last_interaction_tone >= -1 AND last_interaction_tone <= 1),
  
  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- One mood state per user
  CONSTRAINT uniq_mood_state_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_mood_states_user ON mood_states(user_id);
CREATE INDEX IF NOT EXISTS idx_mood_states_updated ON mood_states(updated_at);

-- ============================================================================
-- 2. EMOTIONAL MOMENTUM TABLE
-- ============================================================================
-- Tracks emotional momentum for gradual mood shifts (was kayley_emotional_momentum localStorage)

CREATE TABLE IF NOT EXISTS emotional_momentum (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  
  -- Current mood level (-1 = bad, 0 = neutral, 1 = great)
  current_mood_level DECIMAL(3,2) NOT NULL DEFAULT 0.0
    CHECK (current_mood_level >= -1 AND current_mood_level <= 1),
  
  -- Momentum direction (-1 = declining, 0 = stable, 1 = improving)
  momentum_direction DECIMAL(3,2) NOT NULL DEFAULT 0.0
    CHECK (momentum_direction >= -1 AND momentum_direction <= 1),
  
  -- Streak and history
  positive_interaction_streak INTEGER NOT NULL DEFAULT 0
    CHECK (positive_interaction_streak >= 0),
  
  -- Store recent tones as JSON array (last 10)
  recent_interaction_tones JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Genuine moment tracking
  genuine_moment_detected BOOLEAN NOT NULL DEFAULT FALSE,
  last_genuine_moment_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- One momentum state per user
  CONSTRAINT uniq_emotional_momentum_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_emotional_momentum_user ON emotional_momentum(user_id);

-- ============================================================================
-- 3. ONGOING THREADS TABLE  
-- ============================================================================
-- Kayley's "mental weather" - things she's thinking about (was kayley_ongoing_threads localStorage)

CREATE TABLE IF NOT EXISTS ongoing_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  
  -- Thread content
  theme TEXT NOT NULL
    CHECK (theme IN ('creative_project', 'family', 'self_improvement', 'social', 'work', 'existential', 'user_reflection')),
  current_state TEXT NOT NULL,
  
  -- Intensity and mention tracking
  intensity DECIMAL(3,2) NOT NULL DEFAULT 0.5
    CHECK (intensity >= 0 AND intensity <= 1),
  last_mentioned TIMESTAMPTZ,
  
  -- User-related flag
  user_related BOOLEAN NOT NULL DEFAULT FALSE,
  user_trigger TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ongoing_threads_user ON ongoing_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_ongoing_threads_intensity ON ongoing_threads(user_id, intensity DESC);

-- ============================================================================
-- 4. INTIMACY STATE TABLE
-- ============================================================================
-- Probabilistic intimacy tracking (was kayley_intimacy_state localStorage)

CREATE TABLE IF NOT EXISTS intimacy_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  
  -- Recent tone modifier (-0.5 to +0.5)
  recent_tone_modifier DECIMAL(3,2) NOT NULL DEFAULT 0.0
    CHECK (recent_tone_modifier >= -0.5 AND recent_tone_modifier <= 0.5),
  
  -- Vulnerability exchange tracking
  vulnerability_exchange_active BOOLEAN NOT NULL DEFAULT FALSE,
  last_vulnerability_at TIMESTAMPTZ,
  
  -- Low effort tracking
  low_effort_streak INTEGER NOT NULL DEFAULT 0
    CHECK (low_effort_streak >= 0),
  
  -- Recent interaction quality (0-1)
  recent_quality DECIMAL(3,2) NOT NULL DEFAULT 0.5
    CHECK (recent_quality >= 0 AND recent_quality <= 1),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- One intimacy state per user
  CONSTRAINT uniq_intimacy_state_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_intimacy_states_user ON intimacy_states(user_id);

-- ============================================================================
-- 5. USER FACTS TABLE (if not exists)
-- ============================================================================
-- Memory service already uses this, but ensure it exists

CREATE TABLE IF NOT EXISTS user_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  
  -- Fact categorization
  category TEXT NOT NULL
    CHECK (category IN ('identity', 'preference', 'relationship', 'context')),
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  
  -- Source tracking  
  source_message_id TEXT,
  confidence DECIMAL(3,2) NOT NULL DEFAULT 1.0
    CHECK (confidence >= 0 AND confidence <= 1),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique key per user/category/key combination
  CONSTRAINT uniq_user_fact UNIQUE (user_id, category, fact_key)
);

CREATE INDEX IF NOT EXISTS idx_user_facts_user ON user_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_facts_category ON user_facts(user_id, category);

-- ============================================================================
-- 6. AUTO-UPDATE TIMESTAMP TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all new tables
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_mood_states_updated_at') THEN
    CREATE TRIGGER trigger_mood_states_updated_at
      BEFORE UPDATE ON mood_states
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_emotional_momentum_updated_at') THEN
    CREATE TRIGGER trigger_emotional_momentum_updated_at
      BEFORE UPDATE ON emotional_momentum
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_ongoing_threads_updated_at') THEN
    CREATE TRIGGER trigger_ongoing_threads_updated_at
      BEFORE UPDATE ON ongoing_threads
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_intimacy_states_updated_at') THEN
    CREATE TRIGGER trigger_intimacy_states_updated_at
      BEFORE UPDATE ON intimacy_states
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_user_facts_updated_at') THEN
    CREATE TRIGGER trigger_user_facts_updated_at
      BEFORE UPDATE ON user_facts
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;

-- ============================================================================
-- 7. ROW LEVEL SECURITY POLICIES
-- ============================================================================
-- Enable RLS on all tables for security

ALTER TABLE mood_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE emotional_momentum ENABLE ROW LEVEL SECURITY;
ALTER TABLE ongoing_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE intimacy_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_facts ENABLE ROW LEVEL SECURITY;

-- Create policies for anon access (since we use anonymous users with custom IDs)
-- In production, you'd want to use auth.uid() instead

CREATE POLICY "Allow all operations for mood_states"
  ON mood_states FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for emotional_momentum"
  ON emotional_momentum FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for ongoing_threads"
  ON ongoing_threads FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for intimacy_states"
  ON intimacy_states FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for user_facts"
  ON user_facts FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 8. COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE mood_states IS 
'Stores Kayley''s emotional state per user. Replaces kayley_mood_state localStorage.';

COMMENT ON TABLE emotional_momentum IS 
'Tracks emotional momentum for gradual mood shifts. Replaces kayley_emotional_momentum localStorage.';

COMMENT ON TABLE ongoing_threads IS 
'Kayley''s "mental weather" - ongoing things she''s thinking about. Replaces kayley_ongoing_threads localStorage.';

COMMENT ON TABLE intimacy_states IS 
'Probabilistic intimacy tracking for natural flirtation. Replaces kayley_intimacy_state localStorage.';

COMMENT ON TABLE user_facts IS 
'Stores facts about users (name, preferences, etc.) learned through conversation.';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Run this migration in Supabase SQL Editor, then update the services to use
-- Supabase instead of localStorage.
-- ============================================================================
