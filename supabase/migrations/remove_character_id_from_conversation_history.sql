-- ============================================================================
-- Remove character_id from Conversation History
-- ============================================================================
-- This migration removes character_id from the conversation history so that
-- all conversations persist across different character versions/settings.
-- ============================================================================

-- ============================================================================
-- 1. REMOVE CHARACTER_ID COLUMN
-- ============================================================================

-- Remove the character_id column from conversation_history table
ALTER TABLE conversation_history 
  DROP COLUMN IF EXISTS character_id;

-- ============================================================================
-- 2. UPDATE INDEXES
-- ============================================================================

-- Drop old index if it exists
DROP INDEX IF EXISTS idx_conversation_history_character_user;

-- Create new index for user_id only
CREATE INDEX IF NOT EXISTS idx_conversation_history_user 
  ON conversation_history(user_id);

-- Keep the existing index on created_at for chronological queries
CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at 
  ON conversation_history(created_at);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Conversation history now persists across all character versions for each user.
-- ============================================================================

