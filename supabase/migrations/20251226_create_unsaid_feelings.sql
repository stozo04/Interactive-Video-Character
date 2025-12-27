-- ============================================================================
-- Almost Moments Tables
-- ============================================================================
-- Tracks unspoken feelings and logs "almost said it" moments.
-- ============================================================================

CREATE TABLE IF NOT EXISTS kayley_unsaid_feelings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- What she is holding back
  feeling_type TEXT NOT NULL,
  unsaid_content TEXT NOT NULL,
  partial_expressions TEXT[],

  -- Intensity and progression
  intensity DECIMAL(3,2) DEFAULT 0.3,
  suppression_count INT DEFAULT 0,
  current_stage TEXT DEFAULT 'micro_hint',

  -- Timing
  last_almost_moment_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,

  CONSTRAINT valid_intensity CHECK (intensity >= 0 AND intensity <= 1)
);

CREATE INDEX IF NOT EXISTS idx_unsaid_feelings_user
  ON kayley_unsaid_feelings(user_id);

CREATE INDEX IF NOT EXISTS idx_unsaid_feelings_active
  ON kayley_unsaid_feelings(user_id)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS kayley_almost_moment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  unsaid_feeling_id UUID REFERENCES kayley_unsaid_feelings(id),

  stage TEXT NOT NULL,
  expression_used TEXT,
  conversation_context TEXT,

  occurred_at TIMESTAMP DEFAULT NOW()
);
