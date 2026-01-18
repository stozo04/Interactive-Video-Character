-- Audit log for all storyline creation attempts (success and failure)
CREATE TABLE storyline_creation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Attempt details
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  storyline_type TEXT,

  -- Result
  success BOOLEAN NOT NULL,
  failure_reason TEXT,  -- 'cooldown_active' | 'duplicate_detected' | 'category_constraint' | 'db_error'

  -- Failure details
  cooldown_hours_remaining INTEGER,
  duplicate_match TEXT,              -- Title of duplicate if found
  active_storyline_blocking UUID REFERENCES life_storylines(id),

  -- Source tracking
  source TEXT NOT NULL DEFAULT 'conversation'  -- 'conversation' | 'idle_suggestion'
);

-- Indexes for performance and observability
CREATE INDEX idx_storyline_attempts_time ON storyline_creation_attempts(attempted_at DESC);
CREATE INDEX idx_storyline_attempts_success ON storyline_creation_attempts(success);
CREATE INDEX idx_storyline_attempts_failure ON storyline_creation_attempts(failure_reason)
  WHERE success = FALSE;

-- Documentation
COMMENT ON TABLE storyline_creation_attempts IS
  'Audit log for all storyline creation attempts. Used for observability, debugging, and rate limit tuning.';
