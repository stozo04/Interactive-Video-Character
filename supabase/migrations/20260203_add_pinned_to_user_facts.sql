-- Add pinned flag to user_facts for durable, user-approved facts.
-- NOTE: Do not execute here. Apply via your normal Supabase migration flow.
ALTER TABLE user_facts
ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
