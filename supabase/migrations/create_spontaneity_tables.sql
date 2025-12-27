-- ============================================================================
-- Spontaneity System Tables
-- ============================================================================
-- Creates tables for Kayley's spontaneous behaviors:
-- 1. kayley_pending_shares - Things Kayley wants to share with the user
-- 2. spontaneous_selfie_history - Track selfie patterns for cooldown logic
-- 3. session_reflections - Post-session emotional synthesis (when user leaves)
-- 4. idle_thoughts - Dream/thought generation during user absence
-- 5. visual_state_mapping - Map emotional states to video manifest IDs
-- 6. conversation_spontaneity_state - Track in-conversation spontaneity budget
-- ============================================================================

-- ============================================================================
-- 1. PENDING SHARES TABLE
-- Things Kayley wants to share (stories, thoughts, questions, discoveries, selfies)
-- ============================================================================
CREATE TABLE IF NOT EXISTS kayley_pending_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Share content
  content TEXT NOT NULL,
  share_type TEXT NOT NULL CHECK (share_type IN ('story', 'thought', 'question', 'discovery', 'vent', 'selfie')),
  urgency DECIMAL(3,2) DEFAULT 0.5 CHECK (urgency >= 0 AND urgency <= 1),

  -- Triggering conditions
  relevance_topics TEXT[] DEFAULT '{}',
  natural_opener TEXT,
  can_interrupt BOOLEAN DEFAULT false,

  -- Selfie-specific fields (only used when share_type = 'selfie')
  selfie_reason TEXT CHECK (
    selfie_reason IS NULL OR
    selfie_reason IN ('thinking_of_you', 'new_outfit', 'good_mood', 'cool_location',
                      'brighten_your_day', 'milestone_share', 'random_impulse', 'matching_topic')
  ),
  selfie_scene TEXT,
  selfie_mood TEXT,
  selfie_outfit_hint TEXT,

  -- Lifecycle
  expires_at TIMESTAMPTZ NOT NULL,
  shared_at TIMESTAMPTZ,           -- NULL until shared
  dismissed_at TIMESTAMPTZ,        -- If decided not to share

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for pending shares
CREATE INDEX IF NOT EXISTS idx_pending_shares_user ON kayley_pending_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_shares_active ON kayley_pending_shares(user_id)
  WHERE shared_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pending_shares_expires ON kayley_pending_shares(expires_at)
  WHERE shared_at IS NULL AND dismissed_at IS NULL;

COMMENT ON TABLE kayley_pending_shares IS
'Things Kayley wants to share with the user. Pending shares are topic-triggered or expire.';

-- ============================================================================
-- 2. SPONTANEOUS SELFIE HISTORY TABLE
-- Track selfie sending patterns for cooldown logic and learning
-- ============================================================================
CREATE TABLE IF NOT EXISTS spontaneous_selfie_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- What triggered it
  reason TEXT NOT NULL CHECK (
    reason IN ('thinking_of_you', 'new_outfit', 'good_mood', 'cool_location',
               'brighten_your_day', 'milestone_share', 'random_impulse', 'matching_topic')
  ),
  scene TEXT NOT NULL,
  mood TEXT NOT NULL,
  outfit_hint TEXT,
  caption TEXT NOT NULL,

  -- Context at time of sending
  conversation_mood TEXT,
  relationship_tier TEXT NOT NULL,
  user_had_mentioned_bad_day BOOLEAN DEFAULT false,

  -- Result tracking (detected from user's response)
  user_reaction TEXT CHECK (
    user_reaction IS NULL OR user_reaction IN ('positive', 'neutral', 'negative')
  ),

  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for selfie history
CREATE INDEX IF NOT EXISTS idx_selfie_history_user ON spontaneous_selfie_history(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_selfie_history_recent ON spontaneous_selfie_history(user_id, sent_at DESC);

COMMENT ON TABLE spontaneous_selfie_history IS
'Tracks when Kayley sent spontaneous selfies, for cooldown logic and reaction pattern analysis.';

-- ============================================================================
-- 3. SESSION REFLECTIONS TABLE (NEW - from user feedback)
-- Post-session emotional synthesis - what Kayley thinks about after user leaves
-- ============================================================================
CREATE TABLE IF NOT EXISTS session_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Session metadata
  session_start_at TIMESTAMPTZ NOT NULL,
  session_end_at TIMESTAMPTZ NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,

  -- Emotional arc summary
  emotional_arc TEXT NOT NULL,          -- "Started tense, warmed up, ended playful"
  dominant_mood TEXT NOT NULL,          -- The overall mood of the session
  mood_progression JSONB DEFAULT '[]',  -- [{time, mood, trigger}]

  -- Key moments
  memorable_moments JSONB DEFAULT '[]', -- [{type, content, emotional_weight}]
  unresolved_threads JSONB DEFAULT '[]',-- Topics that were left hanging

  -- Relationship impact
  intimacy_delta DECIMAL(3,2) DEFAULT 0, -- How much closer/further (-1 to 1)
  trust_delta DECIMAL(3,2) DEFAULT 0,
  warmth_delta DECIMAL(3,2) DEFAULT 0,

  -- What Kayley learned
  new_user_facts JSONB DEFAULT '[]',    -- Facts discovered about user
  conversation_insights TEXT,            -- Kayley's reflection on the conversation

  -- Proactive prep
  suggested_followups JSONB DEFAULT '[]', -- Ideas for next conversation

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for session reflections
CREATE INDEX IF NOT EXISTS idx_session_reflections_user ON session_reflections(user_id, session_end_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_reflections_recent ON session_reflections(user_id, created_at DESC);

COMMENT ON TABLE session_reflections IS
'Post-session synthesis - Kayley reflects on conversations after user leaves. Used to prepare proactive starters.';

-- ============================================================================
-- 4. IDLE THOUGHTS TABLE (NEW - from user feedback)
-- Dream/thought generation during user absence
-- ============================================================================
CREATE TABLE IF NOT EXISTS idle_thoughts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Thought content
  thought_type TEXT NOT NULL CHECK (
    thought_type IN ('dream', 'memory', 'curiosity', 'anticipation', 'connection', 'random')
  ),
  content TEXT NOT NULL,                 -- The actual thought/dream content
  associated_memory TEXT,                -- What triggered this thought
  emotional_tone TEXT NOT NULL,          -- wistful, excited, anxious, warm, etc.

  -- Dream-specific fields
  is_recurring BOOLEAN DEFAULT false,
  dream_imagery JSONB,                   -- Visual elements if it's a dream

  -- Relationship to user
  involves_user BOOLEAN DEFAULT false,
  user_role_in_thought TEXT,             -- "companion", "hero", "absent", etc.

  -- Proactive use
  can_share_with_user BOOLEAN DEFAULT true,
  ideal_conversation_mood TEXT,          -- Best mood to share this in
  natural_intro TEXT,                    -- "I had the weirdest dream about..."

  -- Lifecycle
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  shared_at TIMESTAMPTZ,                 -- NULL until shared
  expired_at TIMESTAMPTZ,                -- Thoughts get stale

  -- Context when generated
  absence_duration_hours INTEGER,        -- How long user was away
  kayley_mood_when_generated TEXT
);

-- Indexes for idle thoughts
CREATE INDEX IF NOT EXISTS idx_idle_thoughts_user ON idle_thoughts(user_id);
CREATE INDEX IF NOT EXISTS idx_idle_thoughts_unshaped ON idle_thoughts(user_id)
  WHERE shared_at IS NULL AND expired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_idle_thoughts_recent ON idle_thoughts(generated_at DESC)
  WHERE shared_at IS NULL;

COMMENT ON TABLE idle_thoughts IS
'Thoughts and dreams Kayley generates during user absence. Become proactive conversation starters.';

-- ============================================================================
-- 5. VISUAL STATE MAPPING TABLE (NEW - from user feedback)
-- Maps emotional states to video manifest IDs for coherent visual representation
-- ============================================================================
CREATE TABLE IF NOT EXISTS visual_state_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- State identifiers
  emotional_state TEXT NOT NULL,         -- guarded, open, playful, vulnerable, etc.
  energy_level TEXT NOT NULL CHECK (energy_level IN ('low', 'medium', 'high')),
  mood_category TEXT NOT NULL,           -- happy, sad, anxious, excited, calm, etc.

  -- Video mapping
  idle_video_manifest_id TEXT NOT NULL,  -- Which idle video to use
  background_id TEXT,                    -- UI background (optional)
  expression_hints JSONB,                -- Subtle expression variations

  -- Location overrides
  location_context TEXT,                 -- "cafe", "bedroom", "outside", etc.
  location_background_id TEXT,           -- Override background for location

  -- Transition hints
  transition_style TEXT DEFAULT 'smooth' CHECK (
    transition_style IN ('smooth', 'quick', 'dramatic', 'subtle')
  ),

  -- Metadata
  priority INTEGER DEFAULT 0,            -- Higher = more specific match wins

  CONSTRAINT uniq_visual_state UNIQUE (emotional_state, energy_level, mood_category, location_context)
);

-- Seed with initial mappings
INSERT INTO visual_state_mapping (emotional_state, energy_level, mood_category, idle_video_manifest_id, background_id, transition_style)
VALUES
  ('guarded', 'low', 'neutral', 'idle_reserved_low', 'bg_dim', 'subtle'),
  ('guarded', 'medium', 'neutral', 'idle_reserved', 'bg_neutral', 'subtle'),
  ('open', 'medium', 'happy', 'idle_warm', 'bg_warm', 'smooth'),
  ('open', 'high', 'excited', 'idle_bouncy', 'bg_bright', 'quick'),
  ('playful', 'high', 'happy', 'idle_playful', 'bg_fun', 'quick'),
  ('playful', 'medium', 'happy', 'idle_smirk', 'bg_warm', 'smooth'),
  ('vulnerable', 'low', 'sad', 'idle_soft', 'bg_dim', 'smooth'),
  ('vulnerable', 'medium', 'anxious', 'idle_tender', 'bg_soft', 'subtle'),
  ('flirty', 'medium', 'happy', 'idle_coy', 'bg_warm', 'smooth'),
  ('flirty', 'high', 'excited', 'idle_teasing', 'bg_pink', 'quick')
ON CONFLICT (emotional_state, energy_level, mood_category, location_context) DO NOTHING;

COMMENT ON TABLE visual_state_mapping IS
'Maps Kayleys internal emotional states to video manifests for visual consistency.';

-- ============================================================================
-- 6. CONVERSATION SPONTANEITY STATE TABLE
-- Track in-conversation spontaneity budget and recent actions
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversation_spontaneity_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Current conversation tracking
  conversation_id TEXT,                  -- Optional: identify specific conversation
  messages_count INTEGER DEFAULT 0,
  topics_discussed TEXT[] DEFAULT '{}',

  -- Spontaneity budget
  last_spontaneous_moment TIMESTAMPTZ,
  recent_spontaneous_types TEXT[] DEFAULT '{}',  -- Last 5 action types
  spontaneity_probability DECIMAL(3,2) DEFAULT 0.1 CHECK (spontaneity_probability >= 0 AND spontaneity_probability <= 1),

  -- Humor tracking
  recent_laughter BOOLEAN DEFAULT false,
  humor_attempts_count INTEGER DEFAULT 0,
  humor_successes_count INTEGER DEFAULT 0,

  -- Selfie specific
  last_spontaneous_selfie TIMESTAMPTZ,
  selfie_probability DECIMAL(3,2) DEFAULT 0.02 CHECK (selfie_probability >= 0 AND selfie_probability <= 1),

  -- Session markers
  session_started_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uniq_conversation_spontaneity_user UNIQUE (user_id)
);

-- Index for spontaneity state
CREATE INDEX IF NOT EXISTS idx_conversation_spontaneity_user ON conversation_spontaneity_state(user_id);

COMMENT ON TABLE conversation_spontaneity_state IS
'Tracks spontaneity budget within a conversation to prevent over-spontaneity.';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE kayley_pending_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE spontaneous_selfie_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE idle_thoughts ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_state_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_spontaneity_state ENABLE ROW LEVEL SECURITY;

-- Permissive policies (app uses custom user IDs, not auth.uid())
CREATE POLICY "Allow all operations for kayley_pending_shares"
  ON kayley_pending_shares FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for spontaneous_selfie_history"
  ON spontaneous_selfie_history FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for session_reflections"
  ON session_reflections FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for idle_thoughts"
  ON idle_thoughts FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for visual_state_mapping"
  ON visual_state_mapping FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for conversation_spontaneity_state"
  ON conversation_spontaneity_state FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================
-- Use existing update_updated_at_column() function if available
DO $$
BEGIN
  -- Only create trigger if function exists
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE TRIGGER update_kayley_pending_shares_updated_at
      BEFORE UPDATE ON kayley_pending_shares
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE TRIGGER update_conversation_spontaneity_state_updated_at
      BEFORE UPDATE ON conversation_spontaneity_state
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- Triggers already exist
END $$;
