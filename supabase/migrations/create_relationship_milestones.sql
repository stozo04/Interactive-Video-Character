-- Create relationship_milestones table for tracking key relationship moments
-- Phase 4: Co-Evolution - enables "Remember when..." callbacks after 50+ interactions
--
-- Milestones are significant moments in the relationship journey:
-- - first_vulnerability: When user first opened up emotionally
-- - first_joke: First shared humor moment  
-- - first_support: When Kayley first provided meaningful support
-- - anniversary: Relationship time milestones

CREATE TABLE IF NOT EXISTS relationship_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  
  -- Milestone classification
  milestone_type TEXT NOT NULL CHECK (milestone_type IN (
    'first_vulnerability',   -- User opened up for the first time
    'first_joke',            -- First shared humor moment
    'first_support',         -- First meaningful support from Kayley
    'first_deep_talk',       -- First long, meaningful conversation
    'first_return',          -- User came back after a break
    'breakthrough_moment',   -- Major emotional breakthrough
    'anniversary_week',      -- 1 week anniversary
    'anniversary_month',     -- 1 month anniversary
    'interaction_50',        -- 50 interactions milestone
    'interaction_100'        -- 100 interactions milestone
  )),
  
  -- The actual content
  description TEXT NOT NULL,           -- Human-readable description of the moment
  trigger_context TEXT,                -- What triggered this milestone (message snippet)
  
  -- Timing
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Reference tracking (for "Remember when..." callbacks)
  has_been_referenced BOOLEAN NOT NULL DEFAULT FALSE,
  reference_count INTEGER NOT NULL DEFAULT 0,
  last_referenced_at TIMESTAMPTZ,
  
  -- Ensure uniqueness of most milestone types per user
  -- (anniversaries can be updated, but first_* should be unique)
  CONSTRAINT unique_first_milestones UNIQUE (user_id, milestone_type)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_milestones_user_id 
  ON relationship_milestones(user_id);

CREATE INDEX IF NOT EXISTS idx_milestones_type 
  ON relationship_milestones(milestone_type);

CREATE INDEX IF NOT EXISTS idx_milestones_for_callback 
  ON relationship_milestones(user_id, reference_count, occurred_at)
  WHERE reference_count < 3;

CREATE INDEX IF NOT EXISTS idx_milestones_occurred 
  ON relationship_milestones(occurred_at);

-- Comments
COMMENT ON TABLE relationship_milestones IS 'Tracks key relationship moments for "Remember when..." callbacks. Part of Phase 4: Co-Evolution.';
COMMENT ON COLUMN relationship_milestones.milestone_type IS 'Category of milestone (first_vulnerability, first_joke, anniversary_*, etc.)';
COMMENT ON COLUMN relationship_milestones.description IS 'Human-readable description of the milestone moment';
COMMENT ON COLUMN relationship_milestones.trigger_context IS 'The user message or context that triggered this milestone';
COMMENT ON COLUMN relationship_milestones.has_been_referenced IS 'Whether this milestone has ever been used in a callback';
COMMENT ON COLUMN relationship_milestones.reference_count IS 'How many times this milestone has been referenced (max 3)';
COMMENT ON COLUMN relationship_milestones.last_referenced_at IS 'When this milestone was last used in a "Remember when..." callback';

-- Example queries:
-- 
-- Get milestones eligible for callback:
-- SELECT * FROM relationship_milestones 
-- WHERE user_id = $1 
--   AND reference_count < 3 
--   AND occurred_at < NOW() - INTERVAL '24 hours'
-- ORDER BY reference_count ASC, occurred_at ASC
-- LIMIT 5;
--
-- Record a new milestone:
-- INSERT INTO relationship_milestones (user_id, milestone_type, description, trigger_context)
-- VALUES ($1, 'first_vulnerability', 'First time opening up emotionally', $2)
-- ON CONFLICT (user_id, milestone_type) DO NOTHING;
