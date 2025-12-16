-- =============================================================
-- Character Facts Table
-- =============================================================
-- Stores facts about the character (Kayley) that emerge in conversation
-- but aren't in the static character profile. This allows the character
-- to have consistent memories and backstory that grows over time.
--
-- These facts are GLOBAL (not per-user) - they represent who Kayley is
-- as a character, regardless of which user she's talking to.
-- =============================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================
-- Create character_facts table
-- =============================================================
CREATE TABLE IF NOT EXISTS character_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Character identifier (currently just 'kayley' but extensible)
  character_id TEXT NOT NULL DEFAULT 'kayley',
  
  -- Categorization (similar to user_facts but for character)
  category TEXT NOT NULL CHECK (category IN (
    'quirk',           -- Habits, preferences, personality quirks
    'relationship',    -- Friends, family, people in her life
    'experience',      -- Past events, stories, memories
    'preference',      -- Likes, dislikes, opinions
    'detail',          -- Specific facts about devices, places, etc.
    'other'            -- Miscellaneous
  )),
  
  -- The actual fact (key-value pair)
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  
  -- Optional: Reference to the conversation message where this was learned
  source_message_id UUID REFERENCES conversation_history(id) ON DELETE SET NULL,
  
  -- Confidence score (0.0 to 1.0) - allows for uncertain facts
  confidence DECIMAL(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure unique facts per character/category/key combination
  -- This allows UPSERT behavior (update if exists)
  UNIQUE(character_id, category, fact_key)
);

-- =============================================================
-- Create indexes for fast lookups
-- =============================================================

-- Index for finding all facts for a character
CREATE INDEX IF NOT EXISTS idx_character_facts_character_id ON character_facts(character_id);

-- Index for filtering by category
CREATE INDEX IF NOT EXISTS idx_character_facts_category ON character_facts(character_id, category);

-- Index for timestamp queries (e.g., recent facts)
CREATE INDEX IF NOT EXISTS idx_character_facts_created_at ON character_facts(created_at DESC);

-- =============================================================
-- Comments for documentation
-- =============================================================
COMMENT ON TABLE character_facts IS 'Stores facts about the character (Kayley) that emerge in conversation but are not in the static profile. These facts are global and represent the character''s consistent backstory and memories.';
COMMENT ON COLUMN character_facts.character_id IS 'Identifier for the character (currently ''kayley'')';
COMMENT ON COLUMN character_facts.category IS 'Type of fact: quirk, relationship, experience, preference, detail, other';
COMMENT ON COLUMN character_facts.fact_key IS 'The fact identifier (e.g., ''laptop_name'', ''best_friend'', ''favorite_coffee_shop'')';
COMMENT ON COLUMN character_facts.fact_value IS 'The actual fact value (e.g., ''Nova'', ''Lena'', ''Blue Bottle on 6th Street'')';
COMMENT ON COLUMN character_facts.source_message_id IS 'Optional reference to the conversation message where this fact was learned';
COMMENT ON COLUMN character_facts.confidence IS 'Confidence score from 0.0 to 1.0 indicating how certain we are this fact is accurate';

