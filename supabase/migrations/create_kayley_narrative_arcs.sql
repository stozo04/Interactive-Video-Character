-- =============================================================
-- Kayley Narrative Arcs Table
-- =============================================================
-- Tracks Kayley's ongoing life events, projects, and experiences.
-- This gives Kayley a "living present" that evolves over time,
-- separate from her static backstory in the character profile.
--
-- Examples:
-- - "Working on a collab video with Sarah"
-- - "Training for a 5K run"
-- - "Dealing with a difficult client project"
--
-- Arcs have a beginning, middle, and end - just like real life.
-- =============================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================
-- Create kayley_narrative_arcs table
-- =============================================================
CREATE TABLE IF NOT EXISTS kayley_narrative_arcs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Arc identification
  arc_key TEXT NOT NULL,                   -- Unique identifier: 'collab_video_sarah_dec2024'
  arc_title TEXT NOT NULL,                 -- Human-readable: "Collab Video with Sarah"
  arc_type TEXT NOT NULL CHECK (arc_type IN (
    'ongoing',                             -- Currently happening
    'resolved',                            -- Completed/finished
    'paused',                              -- On hold
    'abandoned'                            -- Gave up / didn't work out
  )),

  -- Timeline
  started_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_summary TEXT,                 -- How it ended (if resolved)

  -- Event log (JSONB array of events)
  -- Each event: { date: ISO8601, event: "description" }
  events JSONB DEFAULT '[]'::jsonb,

  -- User tracking (which users know about this arc)
  mentioned_to_users TEXT[] DEFAULT '{}',

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique arc keys
  UNIQUE(arc_key)
);

-- =============================================================
-- Create indexes for fast lookups
-- =============================================================

-- Index for finding ongoing arcs (most common query)
CREATE INDEX IF NOT EXISTS idx_narrative_arcs_ongoing
  ON kayley_narrative_arcs(arc_type, started_at DESC)
  WHERE arc_type = 'ongoing';

-- Index for finding arcs by user (which arcs has this user heard about)
CREATE INDEX IF NOT EXISTS idx_narrative_arcs_users
  ON kayley_narrative_arcs USING gin(mentioned_to_users);

-- Index for timeline queries
CREATE INDEX IF NOT EXISTS idx_narrative_arcs_timeline
  ON kayley_narrative_arcs(started_at DESC);

-- =============================================================
-- Create trigger to auto-update updated_at timestamp
-- =============================================================

-- Function to update the updated_at column
CREATE OR REPLACE FUNCTION update_narrative_arcs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function on update
DROP TRIGGER IF EXISTS trigger_update_narrative_arcs_updated_at ON kayley_narrative_arcs;
CREATE TRIGGER trigger_update_narrative_arcs_updated_at
  BEFORE UPDATE ON kayley_narrative_arcs
  FOR EACH ROW
  EXECUTE FUNCTION update_narrative_arcs_updated_at();

-- =============================================================
-- Comments for documentation
-- =============================================================
COMMENT ON TABLE kayley_narrative_arcs IS 'Tracks Kayley''s ongoing life events, projects, and experiences. Gives her a living, evolving present separate from her static backstory.';
COMMENT ON COLUMN kayley_narrative_arcs.arc_key IS 'Unique identifier for the arc (e.g., ''collab_video_sarah_dec2024'')';
COMMENT ON COLUMN kayley_narrative_arcs.arc_title IS 'Human-readable title (e.g., "Collab Video with Sarah")';
COMMENT ON COLUMN kayley_narrative_arcs.arc_type IS 'Current status: ongoing, resolved, paused, or abandoned';
COMMENT ON COLUMN kayley_narrative_arcs.events IS 'JSONB array of events: [{date: ISO8601, event: "description"}]';
COMMENT ON COLUMN kayley_narrative_arcs.mentioned_to_users IS 'Array of user IDs who have heard about this arc';
COMMENT ON COLUMN kayley_narrative_arcs.resolution_summary IS 'How the arc ended (only for resolved/abandoned arcs)';

-- =============================================================
-- Verification Query
-- =============================================================
-- Run this to verify the migration worked:
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'kayley_narrative_arcs'
ORDER BY ordinal_position;
