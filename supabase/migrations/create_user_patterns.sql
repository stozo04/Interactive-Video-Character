-- Create user_patterns table for tracking cross-session behavioral patterns
-- Phase 5: Pattern Recognition - enables "You seem stressed on Mondays" insights
--
-- Pattern types:
-- - mood_time: Mood correlations with time (day of week, time of day)
-- - topic_correlation: Topics that appear together
-- - behavior: Behavioral patterns like check-in frequency

CREATE TABLE IF NOT EXISTS user_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  
  -- Pattern classification
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'mood_time',          -- "stressed on Mondays", "happier in evenings"
    'topic_correlation',  -- "mentions mom when frustrated about work"
    'behavior'            -- "checks in more when anxious"
  )),
  
  -- The actual observation
  observation TEXT NOT NULL,           -- Human-readable description of the pattern
  
  -- Supporting data (JSON for flexibility)
  pattern_data JSONB,                  -- Additional data about the pattern
  
  -- Frequency and confidence tracking
  frequency INTEGER NOT NULL DEFAULT 1,       -- How many times this pattern has been observed
  confidence NUMERIC(3,2) DEFAULT 0.50,       -- Confidence score (0.00 - 1.00)
  
  -- Timing
  first_observed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_observed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Surfacing tracking (has this pattern been mentioned to user?)
  has_been_surfaced BOOLEAN NOT NULL DEFAULT FALSE,
  surface_count INTEGER NOT NULL DEFAULT 0,
  last_surfaced_at TIMESTAMPTZ,
  
  -- We want to track patterns uniquely per user + pattern_type + core observation
  CONSTRAINT unique_pattern UNIQUE (user_id, pattern_type, observation)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_patterns_user_id 
  ON user_patterns(user_id);

CREATE INDEX IF NOT EXISTS idx_patterns_type 
  ON user_patterns(pattern_type);

CREATE INDEX IF NOT EXISTS idx_patterns_for_surfacing 
  ON user_patterns(user_id, confidence, surface_count)
  WHERE confidence >= 0.60 AND surface_count < 2;

CREATE INDEX IF NOT EXISTS idx_patterns_frequency 
  ON user_patterns(frequency DESC);

CREATE INDEX IF NOT EXISTS idx_patterns_last_observed
  ON user_patterns(last_observed DESC);

-- Comments
COMMENT ON TABLE user_patterns IS 'Tracks cross-session behavioral patterns for "I\'ve noticed..." insights. Part of Phase 5: Pattern Recognition.';
COMMENT ON COLUMN user_patterns.pattern_type IS 'Category of pattern (mood_time, topic_correlation, behavior)';
COMMENT ON COLUMN user_patterns.observation IS 'Human-readable description of the pattern';
COMMENT ON COLUMN user_patterns.pattern_data IS 'JSON data supporting the pattern (e.g., day of week, topics, etc.)';
COMMENT ON COLUMN user_patterns.frequency IS 'Number of times this pattern has been observed';
COMMENT ON COLUMN user_patterns.confidence IS 'Confidence score (0.00 - 1.00) based on frequency and consistency';
COMMENT ON COLUMN user_patterns.has_been_surfaced IS 'Whether this pattern has been mentioned to the user';
COMMENT ON COLUMN user_patterns.surface_count IS 'How many times this pattern has been surfaced (max 2)';

-- Example queries:
-- 
-- Get patterns ready to surface:
-- SELECT * FROM user_patterns 
-- WHERE user_id = $1 
--   AND confidence >= 0.60 
--   AND surface_count < 2 
--   AND (last_surfaced_at IS NULL OR last_surfaced_at < NOW() - INTERVAL '7 days')
-- ORDER BY confidence DESC, frequency DESC
-- LIMIT 1;
--
-- Record or update a pattern observation:
-- INSERT INTO user_patterns (user_id, pattern_type, observation, pattern_data, frequency, confidence)
-- VALUES ($1, 'mood_time', 'stressed on Mondays', '{"day_of_week": 1}', 1, 0.30)
-- ON CONFLICT (user_id, pattern_type, observation) DO UPDATE SET
--   frequency = user_patterns.frequency + 1,
--   confidence = LEAST(1.0, user_patterns.confidence + 0.10),
--   last_observed = NOW(),
--   pattern_data = COALESCE($4, user_patterns.pattern_data);

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================
-- Enable RLS on the table
ALTER TABLE user_patterns ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own patterns
CREATE POLICY "Users can view their own patterns"
  ON user_patterns
  FOR SELECT
  USING (auth.uid()::text = user_id OR user_id = 'anonymous');

-- Policy: Users can only insert their own patterns  
CREATE POLICY "Users can insert their own patterns"
  ON user_patterns
  FOR INSERT
  WITH CHECK (auth.uid()::text = user_id OR user_id = 'anonymous');

-- Policy: Users can only update their own patterns
CREATE POLICY "Users can update their own patterns"
  ON user_patterns
  FOR UPDATE
  USING (auth.uid()::text = user_id OR user_id = 'anonymous');

-- Policy: Users can only delete their own patterns
CREATE POLICY "Users can delete their own patterns"
  ON user_patterns
  FOR DELETE
  USING (auth.uid()::text = user_id OR user_id = 'anonymous');

