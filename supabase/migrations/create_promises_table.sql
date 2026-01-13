-- ============================================================================
-- Promise Tracking System Migration
-- ============================================================================
--
-- Purpose: Create table to track Kayley's future commitments
-- Feature: Promise Tracking (making time feel real)
--
-- When Kayley says "I'll send you a selfie later" or "I'll let you know how it goes",
-- these promises are stored and fulfilled proactively when the time comes.
--
-- Key Design:
-- - Fixed 10-minute timing for Phase 1 (extensible for future mood/context-based timing)
-- - Integrates with pending_messages for delivery
-- - Handles offline users (delivers when they return)
--
-- ============================================================================

-- Create promises table
CREATE TABLE IF NOT EXISTS promises (
  promise_type TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  estimated_timing TIMESTAMPTZ NOT NULL,
  commitment_context TEXT,
  fulfillment_data JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pending' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  fulfilled_at TIMESTAMPTZ,

  -- Ensure status is one of the valid values
  CHECK (status IN ('pending', 'fulfilled', 'missed', 'cancelled'))
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Index for fetching promises by status
CREATE INDEX idx_promises_status
  ON promises(status);

-- Index for finding ready promises (time-based queries)
-- Only index pending promises since we only query ready pending ones
CREATE INDEX idx_promises_timing
  ON promises(estimated_timing)
  WHERE status = 'pending';

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- RLS disabled since this is a single-user application
-- ALTER TABLE promises ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Column Comments (Documentation)
-- ============================================================================

COMMENT ON TABLE promises IS
  'Tracks future commitments Kayley makes to the user. When she says "I''ll send you X later", it''s stored here and fulfilled proactively.';

COMMENT ON COLUMN promises.promise_type IS
  'Type of promise: send_selfie, share_update, follow_up, send_content, reminder, send_voice_note';

COMMENT ON COLUMN promises.description IS
  'Human-readable description of what was promised (e.g., "Send selfie from hot girl walk")';

COMMENT ON COLUMN promises.trigger_event IS
  'When this should happen in natural language (e.g., "when I go on my walk", "after my audition", "in a bit")';

COMMENT ON COLUMN promises.estimated_timing IS
  'Timestamp when promise should be fulfilled. Phase 1: Fixed 10 minutes. Future: Dynamic based on mood/context/events.';

COMMENT ON COLUMN promises.commitment_context IS
  'Original user message or context that triggered the promise. Used for reference.';

COMMENT ON COLUMN promises.fulfillment_data IS
  'JSON data needed to fulfill the promise: { messageText, selfieParams, contentToShare }';

COMMENT ON COLUMN promises.status IS
  'Current status: pending (waiting), fulfilled (delivered), missed (time passed, not delivered), cancelled (no longer relevant)';

COMMENT ON COLUMN promises.created_at IS
  'When the promise was created';

COMMENT ON COLUMN promises.fulfilled_at IS
  'When the promise was fulfilled (null if still pending)';

-- ============================================================================
-- Example Usage
-- ============================================================================
--
-- Creating a promise:
-- INSERT INTO promises (promise_type, description, trigger_event, estimated_timing, commitment_context, fulfillment_data)
-- VALUES (
--   'send_selfie',
--   'Send selfie from hot girl walk',
--   'when I go on my walk',
--   NOW() + INTERVAL '10 minutes',
--   'User: "Send me a selfie when you do!"',
--   '{"messageText": "Okay heading out! Here''s your selfie 📸", "selfieParams": {"scene": "outdoor trail", "mood": "energetic"}}'::jsonb
-- );
--
-- Finding ready promises:
-- SELECT * FROM promises
-- WHERE status = 'pending'
--   AND estimated_timing <= NOW()
-- ORDER BY estimated_timing ASC;
--
-- ============================================================================
