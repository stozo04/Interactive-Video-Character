-- Create presence_contexts table for tracking open loops
-- Open loops are things Kayley proactively remembers to ask about
-- Examples: "How did your presentation go?", "Did you talk to your mom?"

CREATE TABLE IF NOT EXISTS presence_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  
  -- Open loop tracking
  loop_type TEXT NOT NULL CHECK (loop_type IN (
    'pending_event',      -- "How did X go?"
    'emotional_followup', -- "Are you feeling better about X?"
    'commitment_check',   -- "Did you end up doing X?"
    'curiosity_thread',   -- "I've been thinking about what you said about X"
    'pattern_observation' -- "I noticed you tend to X when Y"
  )),
  
  -- The actual content
  topic TEXT NOT NULL,                    -- The subject matter
  trigger_context TEXT,                   -- What triggered this (user message snippet)
  suggested_followup TEXT,                -- A natural way to bring this up
  
  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  should_surface_after TIMESTAMPTZ,       -- Don't ask too soon (give time for events to happen)
  last_surfaced_at TIMESTAMPTZ,           -- When we last asked about this
  expires_at TIMESTAMPTZ,                 -- When this becomes irrelevant
  
  -- State
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active',     -- Ready to potentially surface
    'surfaced',   -- Currently asking about it
    'resolved',   -- User confirmed it happened/resolved
    'expired',    -- No longer relevant
    'dismissed'   -- User didn't want to talk about it
  )),
  
  -- Metadata
  salience REAL NOT NULL DEFAULT 0.5 CHECK (salience >= 0 AND salience <= 1),  -- How important/personal
  surface_count INTEGER NOT NULL DEFAULT 0,  -- How many times we've asked
  max_surfaces INTEGER NOT NULL DEFAULT 2,   -- Don't ask more than this many times
  
  -- Source tracking
  source_message_id UUID,                 -- The conversation that created this
  source_calendar_event_id TEXT           -- If this came from a calendar event
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_presence_contexts_user_id 
  ON presence_contexts(user_id);

CREATE INDEX IF NOT EXISTS idx_presence_contexts_status 
  ON presence_contexts(status);

CREATE INDEX IF NOT EXISTS idx_presence_contexts_surface_timing 
  ON presence_contexts(user_id, status, should_surface_after);

CREATE INDEX IF NOT EXISTS idx_presence_contexts_expires 
  ON presence_contexts(expires_at) 
  WHERE expires_at IS NOT NULL;

-- Comments
COMMENT ON TABLE presence_contexts IS 'Tracks open loops - things Kayley should proactively ask about. Creates the "she remembers" illusion.';
COMMENT ON COLUMN presence_contexts.loop_type IS 'Category of open loop for appropriate follow-up framing';
COMMENT ON COLUMN presence_contexts.topic IS 'The subject to follow up about';
COMMENT ON COLUMN presence_contexts.trigger_context IS 'What the user said that created this loop';
COMMENT ON COLUMN presence_contexts.suggested_followup IS 'A natural way Kayley might bring this up';
COMMENT ON COLUMN presence_contexts.salience IS '0-1 importance score; higher = more personal/significant';
COMMENT ON COLUMN presence_contexts.surface_count IS 'How many times we have asked about this';
COMMENT ON COLUMN presence_contexts.max_surfaces IS 'Maximum times to ask before auto-expiring';

-- Suggested additional index for faster expiry cleanup
CREATE INDEX IF NOT EXISTS idx_presence_active_expires 
  ON presence_contexts(expires_at) 
  WHERE status = 'active';

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================
-- Enable RLS on the table
ALTER TABLE presence_contexts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own presence contexts
CREATE POLICY "Users can view their own presence contexts"
  ON presence_contexts
  FOR SELECT
  USING (auth.uid()::text = user_id OR user_id = 'anonymous');

-- Policy: Users can only insert their own presence contexts  
CREATE POLICY "Users can insert their own presence contexts"
  ON presence_contexts
  FOR INSERT
  WITH CHECK (auth.uid()::text = user_id OR user_id = 'anonymous');

-- Policy: Users can only update their own presence contexts
CREATE POLICY "Users can update their own presence contexts"
  ON presence_contexts
  FOR UPDATE
  USING (auth.uid()::text = user_id OR user_id = 'anonymous');

-- Policy: Users can only delete their own presence contexts
CREATE POLICY "Users can delete their own presence contexts"
  ON presence_contexts
  FOR DELETE
  USING (auth.uid()::text = user_id OR user_id = 'anonymous');

