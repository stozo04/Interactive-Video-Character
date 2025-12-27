-- ============================================================================
-- Update Relationship Tier Thresholds (v3)
-- ============================================================================
-- This migration updates the relationship tier calculation to slow down
-- progression to "deeply_loving" tier, making it require 6-12 months of
-- sustained interaction instead of weeks.
--
-- CHANGES:
-- - close_friend: now 51-100 (was 50-75)
-- - deeply_loving: now 100+ (was 75+)
--
-- This matches the revised score calculation in relationshipService.ts v3
-- ============================================================================

CREATE OR REPLACE FUNCTION update_relationship_tier()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate tier based on score
  -- v3 thresholds for realistic 6-12 month progression
  IF NEW.relationship_score <= -50 THEN
    NEW.relationship_tier := 'adversarial';
  ELSIF NEW.relationship_score <= -10 THEN
    NEW.relationship_tier := 'neutral_negative';
  ELSIF NEW.relationship_score < 10 THEN
    NEW.relationship_tier := 'acquaintance';
  ELSIF NEW.relationship_score < 50 THEN
    NEW.relationship_tier := 'friend';
  ELSIF NEW.relationship_score < 100 THEN
    NEW.relationship_tier := 'close_friend';
  ELSE
    NEW.relationship_tier := 'deeply_loving';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger already exists, so we just need to update the function
-- No need to recreate the trigger

-- ============================================================================
-- Update existing relationships to new tier calculation
-- ============================================================================
-- This recalculates tiers for all existing relationships based on new thresholds
-- Users who were at "deeply_loving" (75-99) will now be "close_friend"

UPDATE character_relationships
SET relationship_tier = CASE
  WHEN relationship_score <= -50 THEN 'adversarial'
  WHEN relationship_score <= -10 THEN 'neutral_negative'
  WHEN relationship_score < 10 THEN 'acquaintance'
  WHEN relationship_score < 50 THEN 'friend'
  WHEN relationship_score < 100 THEN 'close_friend'
  ELSE 'deeply_loving'
END
WHERE relationship_tier IS NOT NULL;

-- ============================================================================
-- Migration complete
-- ============================================================================
