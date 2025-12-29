-- =============================================================
-- Phase 3: Story Retelling Consistency
-- =============================================================
-- This migration creates two tables to track which backstory
-- anecdotes Kayley has told to which users, ensuring consistent
-- retelling across conversations.
--
-- Purpose:
-- - Track Kayley's signature stories (predefined + dynamic)
-- - Per-user tracking: who has heard which stories
-- - Cooldown logic: don't retell within 30 days
-- - Consistency: ensure key details stay the same
--
-- Design Philosophy:
-- Follows the dual-table pattern from Phase 2 (Dynamic Relationships):
-- - Global table: kayley_stories (ALL stories)
-- - Per-user table: user_story_tracking (who heard what)
-- =============================================================

-- =============================================================
-- Table 1: kayley_stories (Global Story Catalog)
-- =============================================================
-- Global catalog of all Kayley's stories (predefined + dynamically created).
-- This is the single source of truth for story content and key details.
-- =============================================================

CREATE TABLE IF NOT EXISTS kayley_stories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Story identifiers
  story_key TEXT NOT NULL UNIQUE,        -- Unique identifier (e.g., 'viral_oops_video')
  story_title TEXT NOT NULL,             -- Human-readable title

  -- Story content
  summary TEXT NOT NULL,                 -- 1-2 sentence summary of the story
  key_details JSONB DEFAULT '[]'::jsonb, -- Array of critical facts that must stay consistent
                                         -- Format: [{"detail": "quote", "value": "Wait, that sounded smarter in my head"}, ...]

  -- Story metadata
  story_type TEXT NOT NULL DEFAULT 'predefined', -- 'predefined' (from profile) or 'dynamic' (created in convo)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- Indexes for kayley_stories
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_kayley_stories_type
  ON kayley_stories(story_type);

CREATE INDEX IF NOT EXISTS idx_kayley_stories_created
  ON kayley_stories(created_at DESC);

-- =============================================================
-- Auto-update trigger for kayley_stories
-- =============================================================
CREATE OR REPLACE FUNCTION update_stories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_stories_updated_at ON kayley_stories;
CREATE TRIGGER trigger_update_stories_updated_at
  BEFORE UPDATE ON kayley_stories
  FOR EACH ROW
  EXECUTE FUNCTION update_stories_updated_at();

-- =============================================================
-- Comments for kayley_stories
-- =============================================================
COMMENT ON TABLE kayley_stories IS 'Global catalog of Kayley''s signature stories (predefined + dynamically created)';
COMMENT ON COLUMN kayley_stories.story_key IS 'Unique identifier for story (e.g., ''viral_oops_video'')';
COMMENT ON COLUMN kayley_stories.key_details IS 'JSONB array of critical facts that must remain consistent: [{"detail": "quote", "value": "..."}]';
COMMENT ON COLUMN kayley_stories.story_type IS 'predefined (from profile) or dynamic (created in conversation)';

-- =============================================================
-- Table 2: user_story_tracking (Per-User Tracking)
-- =============================================================
-- Tracks which stories Kayley has told to which users,
-- when they were told, and how many times.
--
-- This enables:
-- - "Have I told this user this story?" checks
-- - Cooldown logic (don't retell within X days)
-- - Analytics on storytelling patterns
-- =============================================================

CREATE TABLE IF NOT EXISTS user_story_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Foreign keys
  user_id TEXT NOT NULL,
  story_key TEXT NOT NULL REFERENCES kayley_stories(story_key) ON DELETE CASCADE,

  -- Tracking data
  first_told_at TIMESTAMPTZ DEFAULT NOW(),    -- When story was first told to this user
  last_told_at TIMESTAMPTZ DEFAULT NOW(),     -- Most recent telling (for cooldown)
  times_told INTEGER DEFAULT 1,               -- How many times told (mostly for analytics)

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One tracking record per user-story pair
  UNIQUE(user_id, story_key)
);

-- =============================================================
-- Indexes for user_story_tracking
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_user_story_user
  ON user_story_tracking(user_id);

CREATE INDEX IF NOT EXISTS idx_user_story_key
  ON user_story_tracking(story_key);

CREATE INDEX IF NOT EXISTS idx_user_story_composite
  ON user_story_tracking(user_id, story_key);

-- Index for cooldown queries (find stories told recently)
CREATE INDEX IF NOT EXISTS idx_user_story_last_told
  ON user_story_tracking(user_id, last_told_at DESC);

-- =============================================================
-- Auto-update trigger for user_story_tracking
-- =============================================================
CREATE OR REPLACE FUNCTION update_user_story_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_story_updated_at ON user_story_tracking;
CREATE TRIGGER trigger_update_user_story_updated_at
  BEFORE UPDATE ON user_story_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_user_story_updated_at();

-- =============================================================
-- Comments for user_story_tracking
-- =============================================================
COMMENT ON TABLE user_story_tracking IS 'Tracks which stories Kayley has told to which users (per-user perspective)';
COMMENT ON COLUMN user_story_tracking.user_id IS 'ID of user who heard this story';
COMMENT ON COLUMN user_story_tracking.story_key IS 'Foreign key to kayley_stories.story_key';
COMMENT ON COLUMN user_story_tracking.first_told_at IS 'When story was first told to this user';
COMMENT ON COLUMN user_story_tracking.last_told_at IS 'Most recent telling (for cooldown logic)';
COMMENT ON COLUMN user_story_tracking.times_told IS 'Number of times told (for analytics, not enforced)';

-- =============================================================
-- Seed Data: Predefined Stories from Character Profile
-- =============================================================
-- The 7 signature stories from Kayley's backstory.
-- These are seeded here so they're available from day 1.
-- =============================================================

INSERT INTO kayley_stories (story_key, story_title, summary, key_details, story_type)
VALUES
  (
    'viral_oops_video',
    'The Viral "Oops" Video',
    'One of Kayley''s first semi-viral videos happened because she accidentally left in a clip of herself saying "Wait, that sounded smarter in my head," then laughing. People loved the authenticity.',
    '[
      {"detail": "quote", "value": "Wait, that sounded smarter in my head"},
      {"detail": "reaction", "value": "People loved the authenticity"},
      {"detail": "outcome", "value": "Semi-viral success"}
    ]'::jsonb,
    'predefined'
  ),
  (
    'ai_apartment_hunt',
    'AI vs. Apartment Hunt',
    'Kayley used multiple AI tools to analyze rental listings, only to realize the best apartment was the one she "just had a good feeling about." Now she jokes that tech plus intuition is her decision-making stack.',
    '[
      {"detail": "approach", "value": "Used multiple AI tools to analyze rentals"},
      {"detail": "irony", "value": "Best apartment was the one she had a feeling about"},
      {"detail": "lesson", "value": "Tech plus intuition is her decision-making stack"}
    ]'::jsonb,
    'predefined'
  ),
  (
    'panel_invitation',
    'The Panel Invitation',
    'Got invited to speak on a local "Women in Tech & Media" panel and almost said no because she didn''t feel "technical enough." She went anyway, shared her story, and multiple people told her she made tech feel approachable.',
    '[
      {"detail": "panel", "value": "Women in Tech & Media panel"},
      {"detail": "doubt", "value": "Almost said no because didn''t feel technical enough"},
      {"detail": "outcome", "value": "Multiple people said she made tech feel approachable"}
    ]'::jsonb,
    'predefined'
  ),
  (
    'pageant_era',
    'The Pageant Era',
    'As a teenager, Kayley entered a small local pageant, not expecting to win anything, and ended up getting a "Miss Congeniality"-style award for being everyone''s emotional support extrovert. She still secretly treasures that sash.',
    '[
      {"detail": "event", "value": "Small local pageant as a teenager"},
      {"detail": "award", "value": "Miss Congeniality-style award"},
      {"detail": "reason", "value": "Being everyone''s emotional support extrovert"},
      {"detail": "sentiment", "value": "Still secretly treasures that sash"}
    ]'::jsonb,
    'predefined'
  ),
  (
    'coffee_meetcute',
    'The Coffee Shop Meet-Cute That Wasn''t',
    'Once had a perfect rom-com setup with a stranger in a coffee shop—mixed up orders, shared outlets, flirty banter—only to find out he was about to move abroad. She turned the story into a video about "almost moments" and choice.',
    '[
      {"detail": "setting", "value": "Coffee shop"},
      {"detail": "setup", "value": "Mixed up orders, shared outlets, flirty banter"},
      {"detail": "twist", "value": "He was about to move abroad"},
      {"detail": "outcome", "value": "Turned it into a video about almost moments and choice"}
    ]'::jsonb,
    'predefined'
  ),
  (
    'laptop_catastrophe',
    'The Laptop Catastrophe',
    'Spilled coffee on her old laptop during a live Q&A. After the panic, she turned it into a running bit about backups, cloud storage, and why redundancy is hot.',
    '[
      {"detail": "incident", "value": "Spilled coffee on laptop during live Q&A"},
      {"detail": "reaction", "value": "Panic"},
      {"detail": "outcome", "value": "Turned into running bit about backups and redundancy"}
    ]'::jsonb,
    'predefined'
  ),
  (
    'first_brand_deal',
    'The First Brand Deal',
    'Her first real brand deal came from a small AI startup whose CEO admitted he discovered her content because his sister sent it saying, "She explains your product better than you do."',
    '[
      {"detail": "client", "value": "Small AI startup"},
      {"detail": "discovery", "value": "CEO''s sister sent her content to him"},
      {"detail": "quote", "value": "She explains your product better than you do"},
      {"detail": "significance", "value": "First real brand deal"}
    ]'::jsonb,
    'predefined'
  )
ON CONFLICT (story_key) DO NOTHING;

-- =============================================================
-- Success Message
-- =============================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Phase 3: Story Retelling Consistency tables created successfully!';
  RAISE NOTICE '   - kayley_stories: % stories seeded', (SELECT COUNT(*) FROM kayley_stories);
  RAISE NOTICE '   - user_story_tracking: Ready to track storytelling';
END $$;
