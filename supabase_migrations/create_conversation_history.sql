-- Create conversation_history table to store chat logs for each character-user pair
-- This table will grow over time as conversations accumulate

CREATE TABLE IF NOT EXISTS conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_role TEXT NOT NULL CHECK (message_role IN ('user', 'model')),
  message_text TEXT NOT NULL,
  action_id TEXT, -- Optional: can track which action was triggered with this message
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Index for efficient queries by character and user
  CONSTRAINT fk_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_conversation_history_character_user 
  ON conversation_history(character_id, user_id);

CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at 
  ON conversation_history(created_at);

-- Add comment for documentation
COMMENT ON TABLE conversation_history IS 'Stores conversation history between users and characters. Messages are appended incrementally and can grow large over time.';
COMMENT ON COLUMN conversation_history.character_id IS 'References the character being talked to';
COMMENT ON COLUMN conversation_history.user_id IS 'Identifies the user (browser fingerprint)';
COMMENT ON COLUMN conversation_history.message_role IS 'Either "user" or "model" to indicate who said what';
COMMENT ON COLUMN conversation_history.message_text IS 'The actual message content';
COMMENT ON COLUMN conversation_history.action_id IS 'Optional reference to which character action was triggered';

