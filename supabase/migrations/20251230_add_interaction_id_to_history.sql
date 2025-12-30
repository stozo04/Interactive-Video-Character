-- Add interaction_id to conversation_history for Gemini Interactions API tracking
ALTER TABLE conversation_history ADD COLUMN IF NOT EXISTS interaction_id TEXT;

-- Seed existing rows with a random GUID if they don't have one
-- This fulfills the requirement: "Make this required and give some random GUID for existing data"
UPDATE conversation_history 
SET interaction_id = gen_random_uuid()::text 
WHERE interaction_id IS NULL;

-- Make it required for future rows
ALTER TABLE conversation_history ALTER COLUMN interaction_id SET NOT NULL;

-- Add index for efficient lookups by interaction ID
CREATE INDEX IF NOT EXISTS idx_conversation_history_interaction_id ON conversation_history(interaction_id);

COMMENT ON COLUMN conversation_history.interaction_id IS 'Unique identifier for the Gemini interaction session. Used for conversational continuity.';
