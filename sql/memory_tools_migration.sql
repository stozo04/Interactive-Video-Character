-- =============================================================
-- AI Memory Tools - Database Migration
-- =============================================================
-- This migration creates the user_facts table for storing
-- structured information about users that the AI can recall.
--
-- RUN THIS IN SUPABASE SQL EDITOR
-- =============================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================
-- 1. Create user_facts table
-- =============================================================
CREATE TABLE IF NOT EXISTS user_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- User identification
  user_id TEXT NOT NULL,
  
  -- Categorization
  category TEXT NOT NULL CHECK (category IN ('identity', 'preference', 'relationship', 'context')),
  
  -- The actual fact (key-value pair)
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  
  -- Optional: Reference to the message where this was learned
  source_message_id UUID REFERENCES conversation_history(id) ON DELETE SET NULL,
  
  -- Confidence score (0.0 to 1.0) - allows for uncertain facts
  confidence DECIMAL(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure unique facts per user/category/key combination
  -- This allows UPSERT behavior (update if exists)
  UNIQUE(user_id, category, fact_key)
);

-- =============================================================
-- 2. Create indexes for fast lookups
-- =============================================================

-- Index for finding all facts for a user
CREATE INDEX IF NOT EXISTS idx_user_facts_user_id ON user_facts(user_id);

-- Index for filtering by category
CREATE INDEX IF NOT EXISTS idx_user_facts_category ON user_facts(user_id, category);

-- Index for full-text search on fact values (optional, for advanced search)
CREATE INDEX IF NOT EXISTS idx_user_facts_value_search ON user_facts USING gin(to_tsvector('english', fact_value));

-- =============================================================
-- 3. Create trigger to auto-update updated_at timestamp
-- =============================================================

-- Function to update the updated_at column
CREATE OR REPLACE FUNCTION update_user_facts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function on update
DROP TRIGGER IF EXISTS trigger_update_user_facts_updated_at ON user_facts;
CREATE TRIGGER trigger_update_user_facts_updated_at
  BEFORE UPDATE ON user_facts
  FOR EACH ROW
  EXECUTE FUNCTION update_user_facts_updated_at();

-- =============================================================
-- 4. Enable Row Level Security (RLS)
-- =============================================================
-- Uncomment these if you want to enable RLS

-- ALTER TABLE user_facts ENABLE ROW LEVEL SECURITY;

-- -- Policy: Users can only see their own facts
-- CREATE POLICY "Users can view own facts" ON user_facts
--   FOR SELECT
--   USING (auth.uid()::text = user_id);

-- -- Policy: Users can insert their own facts
-- CREATE POLICY "Users can insert own facts" ON user_facts
--   FOR INSERT
--   WITH CHECK (auth.uid()::text = user_id);

-- -- Policy: Users can update their own facts
-- CREATE POLICY "Users can update own facts" ON user_facts
--   FOR UPDATE
--   USING (auth.uid()::text = user_id);

-- -- Policy: Users can delete their own facts
-- CREATE POLICY "Users can delete own facts" ON user_facts
--   FOR DELETE
--   USING (auth.uid()::text = user_id);

-- =============================================================
-- 5. Add full-text search to conversation_history (OPTIONAL)
-- =============================================================
-- This enables better memory search using PostgreSQL full-text search
-- Only run this if you want to enable semantic-like search

-- Add tsvector column for full-text search
-- ALTER TABLE conversation_history 
-- ADD COLUMN IF NOT EXISTS message_search_vector tsvector
-- GENERATED ALWAYS AS (to_tsvector('english', message_text)) STORED;

-- Create index for fast full-text search
-- CREATE INDEX IF NOT EXISTS idx_conversation_history_search 
-- ON conversation_history USING gin(message_search_vector);

-- =============================================================
-- 6. Verification - Check tables exist
-- =============================================================
-- Run this to verify the migration worked:

SELECT 
  'user_facts' as table_name,
  EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_name = 'user_facts'
  ) as exists;

-- Show table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_facts'
ORDER BY ordinal_position;

-- =============================================================
-- CATEGORY REFERENCE
-- =============================================================
-- 
-- identity:     Personal identity facts
--               Examples: name, age, gender, location, occupation, birthday
--
-- preference:   Likes, dislikes, favorites
--               Examples: favorite_food, music_taste, hobby, favorite_movie
--
-- relationship: Family and social connections
--               Examples: spouse_name, has_kids, pet_name, best_friend
--
-- context:      Current/temporary situational info
--               Examples: current_project, recent_trip, upcoming_event
--
-- =============================================================
