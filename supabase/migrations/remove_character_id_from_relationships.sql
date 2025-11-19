-- ============================================================================
-- Remove character_id from Relationship System
-- ============================================================================
-- This migration removes character_id from the relationship system so that
-- all character versions share the same relationship state. This is useful
-- when all characters are the same person in different settings/environments.
-- ============================================================================

-- ============================================================================
-- 1. DROP EXISTING CONSTRAINTS AND INDEXES
-- ============================================================================

-- Drop the unique constraint on (user_id, character_id)
ALTER TABLE character_relationships 
  DROP CONSTRAINT IF EXISTS uniq_user_character;

-- Drop the foreign key constraint to characters table
ALTER TABLE character_relationships 
  DROP CONSTRAINT IF EXISTS fk_rel_character;

-- Drop indexes that reference character_id
DROP INDEX IF EXISTS idx_character_relationships_user_character;

-- ============================================================================
-- 2. REMOVE CHARACTER_ID COLUMN
-- ============================================================================

-- Remove the character_id column from character_relationships table
ALTER TABLE character_relationships 
  DROP COLUMN IF EXISTS character_id;

-- ============================================================================
-- 3. ADD NEW UNIQUE CONSTRAINT
-- ============================================================================

-- Make user_id unique since there's now only one relationship per user
ALTER TABLE character_relationships 
  ADD CONSTRAINT uniq_user_relationship UNIQUE (user_id);

-- Add index for user lookups
CREATE INDEX IF NOT EXISTS idx_character_relationships_user 
  ON character_relationships(user_id);

-- ============================================================================
-- 4. UPDATE VIEWS
-- ============================================================================

-- Update the relationship_summary view to remove character_id
CREATE OR REPLACE VIEW relationship_summary AS
SELECT 
  cr.id,
  cr.user_id,
  cr.relationship_score,
  cr.relationship_tier,
  cr.warmth_score,
  cr.trust_score,
  cr.playfulness_score,
  cr.stability_score,
  cr.familiarity_stage,
  cr.total_interactions,
  cr.positive_interactions,
  cr.negative_interactions,
  cr.is_ruptured,
  cr.rupture_count,
  cr.first_interaction_at,
  cr.last_interaction_at,
  cr.created_at,
  cr.updated_at,
  -- Calculate interaction ratio
  CASE 
    WHEN cr.total_interactions > 0 
    THEN ROUND((cr.positive_interactions::NUMERIC / cr.total_interactions) * 100, 2)
    ELSE 0
  END AS positive_interaction_ratio,
  -- Calculate days since first interaction
  CASE 
    WHEN cr.first_interaction_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (NOW() - cr.first_interaction_at)) / 86400
    ELSE NULL
  END AS days_since_first_interaction,
  -- Calculate days since last interaction
  CASE 
    WHEN cr.last_interaction_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (NOW() - cr.last_interaction_at)) / 86400
    ELSE NULL
  END AS days_since_last_interaction
FROM character_relationships cr;

-- Update the recent_relationship_events view to remove character_id
CREATE OR REPLACE VIEW recent_relationship_events AS
SELECT 
  re.id,
  re.relationship_id,
  re.event_type,
  re.source,
  re.sentiment_toward_character,
  re.sentiment_intensity,
  re.user_mood,
  re.score_change,
  re.warmth_change,
  re.trust_change,
  re.playfulness_change,
  re.stability_change,
  re.previous_relationship_score,
  re.new_relationship_score,
  re.previous_tier,
  re.new_tier,
  re.notes,
  re.created_at,
  cr.user_id
FROM relationship_events re
JOIN character_relationships cr ON re.relationship_id = cr.id
ORDER BY re.created_at DESC;

-- ============================================================================
-- 5. UPDATE TABLE COMMENT
-- ============================================================================

COMMENT ON TABLE character_relationships IS 
'Stores the emotional relationship state for each user across all character versions. Tracks multi-dimensional emotional scores (warmth, trust, playfulness, stability) and relationship progression over time.';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- The relationship system now tracks a single relationship per user that
-- persists across all character versions/settings.
-- ============================================================================

