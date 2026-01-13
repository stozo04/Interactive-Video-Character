-- ============================================================================
-- Idle Life System Tables (Idle Thoughts Part Two)
-- ============================================================================
-- Creates tables for Kayley's autonomous life during user absence:
-- 1. kayley_experiences - Things that happen to Kayley during idle time
-- 2. pending_messages - Messages waiting for user when they return
-- ============================================================================

-- ============================================================================
-- 1. KAYLEY EXPERIENCES TABLE
-- Things that happen to Kayley while the user is away (comes up naturally later)
-- ============================================================================
CREATE TABLE IF NOT EXISTS kayley_experiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Experience content
  experience_type TEXT NOT NULL CHECK (
    experience_type IN ('activity', 'thought', 'mood', 'discovery', 'mishap')
  ),
  content TEXT NOT NULL,           -- "Finally nailed that chord progression"
  mood TEXT,                       -- "satisfied", "frustrated", "amused"

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  surfaced_at TIMESTAMPTZ,         -- When mentioned in conversation (NULL until shared)
  conversation_context TEXT,       -- What prompted her to share it

  -- Metadata for context
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for finding unsurfaced experiences quickly
CREATE INDEX IF NOT EXISTS idx_kayley_experiences_user
  ON kayley_experiences(user_id);

CREATE INDEX IF NOT EXISTS idx_kayley_experiences_unsurfaced
  ON kayley_experiences(user_id, surfaced_at)
  WHERE surfaced_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_kayley_experiences_recent
  ON kayley_experiences(user_id, created_at DESC);

COMMENT ON TABLE kayley_experiences IS
'Things that happen to Kayley during user absence. Surface naturally in conversation later.';


-- ============================================================================
-- 2. PENDING MESSAGES TABLE
-- Messages waiting for user when they return (calendar-aware and gift messages)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pending_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Message content
  message_text TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (
    message_type IN ('text', 'photo')
  ),
  selfie_url TEXT,                 -- For photo messages

  -- Trigger and context
  trigger TEXT NOT NULL CHECK (
    trigger IN ('calendar', 'gift', 'urgent', 'promise')
  ),
  trigger_event_id TEXT,           -- Calendar event ID if applicable
  trigger_event_title TEXT,        -- Calendar event title for context
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (
    priority IN ('low', 'normal', 'high')
  ),

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,        -- When shown to user (NULL until delivered)
  reaction TEXT,                   -- User's reaction if detected

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for finding undelivered messages
CREATE INDEX IF NOT EXISTS idx_pending_messages_user
  ON pending_messages(user_id);

CREATE INDEX IF NOT EXISTS idx_pending_messages_undelivered
  ON pending_messages(user_id)
  WHERE delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_messages_recent
  ON pending_messages(user_id, created_at DESC);

COMMENT ON TABLE pending_messages IS
'Messages waiting for user when they return. Either calendar-aware or rare gift messages.';


-- ============================================================================
-- 3. GIFT MESSAGE TRACKING TABLE
-- Track when gift messages were sent to enforce daily limit
-- ============================================================================
CREATE TABLE IF NOT EXISTS gift_message_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Gift type and content
  gift_type TEXT NOT NULL CHECK (
    gift_type IN ('selfie', 'thought')
  ),
  message_text TEXT NOT NULL,
  selfie_url TEXT,

  -- Timing
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for checking recent gift messages (daily limit)
CREATE INDEX IF NOT EXISTS idx_gift_message_history_user
  ON gift_message_history(user_id, sent_at DESC);

COMMENT ON TABLE gift_message_history IS
'Tracks when gift messages were sent to enforce max-once-per-day limit.';


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE kayley_experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_message_history ENABLE ROW LEVEL SECURITY;

-- Permissive policies (app uses custom user IDs, not auth.uid())
CREATE POLICY "Allow all operations for kayley_experiences"
  ON kayley_experiences FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for pending_messages"
  ON pending_messages FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for gift_message_history"
  ON gift_message_history FOR ALL
  USING (true)
  WITH CHECK (true);


-- ============================================================================
-- CLEANUP FUNCTION
-- Clean up old experiences and delivered messages
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_idle_life_data()
RETURNS void AS $$
BEGIN
  -- Delete experiences older than 14 days
  DELETE FROM kayley_experiences
  WHERE created_at < NOW() - INTERVAL '14 days';

  -- Delete delivered pending messages older than 7 days
  DELETE FROM pending_messages
  WHERE delivered_at IS NOT NULL
    AND delivered_at < NOW() - INTERVAL '7 days';

  -- Delete gift message history older than 30 days
  DELETE FROM gift_message_history
  WHERE sent_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_idle_life_data IS
'Periodic cleanup of old idle life data. Call via cron or manual trigger.';
