-- Table for storing idle-generated storyline suggestions
CREATE TABLE storyline_pending_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Suggestion content
  category TEXT NOT NULL CHECK (category IN ('work', 'personal', 'family', 'social', 'creative')),
  theme TEXT NOT NULL,          -- "learning guitar", "trip planning"
  reasoning TEXT NOT NULL,       -- Why this matters to Kayley now

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Surfacing tracking
  surfaced BOOLEAN NOT NULL DEFAULT FALSE,
  surfaced_at TIMESTAMPTZ,

  -- Outcome tracking
  was_created BOOLEAN NOT NULL DEFAULT FALSE,    -- Did it become a storyline?
  storyline_id UUID REFERENCES life_storylines(id),  -- If created
  rejected_reason TEXT  -- If rejected: 'cooldown', 'duplicate', 'category_blocked', 'user_ignored', 'expired'
);

-- Indexes
-- Note: Can't use expires_at > NOW() in WHERE clause (NOW() is not IMMUTABLE)
-- We filter expired suggestions in application code instead
CREATE INDEX idx_pending_suggestions_active ON storyline_pending_suggestions(created_at DESC)
  WHERE surfaced = FALSE;

CREATE INDEX idx_pending_suggestions_category ON storyline_pending_suggestions(category);
CREATE INDEX idx_pending_suggestions_expires ON storyline_pending_suggestions(expires_at);

-- Comments
COMMENT ON TABLE storyline_pending_suggestions IS
  'Stores storyline suggestions generated during user absence. Max 1 active at a time. Expire after 24 hours.';

COMMENT ON COLUMN storyline_pending_suggestions.theme IS
  'Short description of the storyline idea, e.g., "learning guitar"';

COMMENT ON COLUMN storyline_pending_suggestions.reasoning IS
  'LLM-generated explanation of why this storyline makes sense for Kayley now';
