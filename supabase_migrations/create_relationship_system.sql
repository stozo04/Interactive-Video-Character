-- ============================================================================
-- Kayley Relationship & Evolution System
-- Complete SQL Migration for Supabase
-- ============================================================================
-- This creates the full relationship system that enables deep emotional
-- connections between users and characters, with multi-dimensional emotional
-- states, rupture/repair mechanics, and natural relationship evolution.
-- ============================================================================

-- ============================================================================
-- 1. CHARACTER RELATIONSHIPS TABLE
-- ============================================================================
-- The heart of the system: tracks the emotional relationship state between
-- each user and character pair. Stores multi-dimensional emotional scores
-- and relationship progression metrics.

CREATE TABLE IF NOT EXISTS character_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign keys
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  
  -- Overall relationship trajectory
  relationship_score DECIMAL(6,2) NOT NULL DEFAULT 0.0 
    CHECK (relationship_score >= -100 AND relationship_score <= 100),
  relationship_tier TEXT NOT NULL DEFAULT 'acquaintance'
    CHECK (relationship_tier IN ('adversarial', 'neutral_negative', 'acquaintance', 'friend', 'close_friend', 'deeply_loving')),
  
  -- Multi-dimensional emotional state
  -- Each dimension ranges from -50 to +50 for nuanced emotional expression
  warmth_score DECIMAL(5,2) NOT NULL DEFAULT 0.0
    CHECK (warmth_score >= -50 AND warmth_score <= 50),
  trust_score DECIMAL(5,2) NOT NULL DEFAULT 0.0
    CHECK (trust_score >= -50 AND trust_score <= 50),
  playfulness_score DECIMAL(5,2) NOT NULL DEFAULT 0.0
    CHECK (playfulness_score >= -50 AND playfulness_score <= 50),
  stability_score DECIMAL(5,2) NOT NULL DEFAULT 0.0
    CHECK (stability_score >= -50 AND stability_score <= 50),
  
  -- Familiarity stage - controls how bold Kayley can be with observations
  familiarity_stage TEXT NOT NULL DEFAULT 'early'
    CHECK (familiarity_stage IN ('early', 'developing', 'established')),
  
  -- Interaction metrics
  total_interactions INTEGER NOT NULL DEFAULT 0
    CHECK (total_interactions >= 0),
  positive_interactions INTEGER NOT NULL DEFAULT 0
    CHECK (positive_interactions >= 0),
  negative_interactions INTEGER NOT NULL DEFAULT 0
    CHECK (negative_interactions >= 0),
  
  -- Timestamps
  first_interaction_at TIMESTAMPTZ,
  last_interaction_at TIMESTAMPTZ,
  
  -- Rupture state - tracks significant emotional breaks
  is_ruptured BOOLEAN NOT NULL DEFAULT FALSE,
  last_rupture_at TIMESTAMPTZ,
  rupture_count INTEGER NOT NULL DEFAULT 0
    CHECK (rupture_count >= 0),
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT fk_rel_character FOREIGN KEY (character_id)
    REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT uniq_user_character UNIQUE (user_id, character_id),
  
  -- Ensure positive/negative interactions don't exceed total
  CONSTRAINT check_interaction_counts CHECK (
    positive_interactions + negative_interactions <= total_interactions
  )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_character_relationships_user_character 
  ON character_relationships(user_id, character_id);
CREATE INDEX IF NOT EXISTS idx_character_relationships_score 
  ON character_relationships(relationship_score);
CREATE INDEX IF NOT EXISTS idx_character_relationships_tier 
  ON character_relationships(relationship_tier);
CREATE INDEX IF NOT EXISTS idx_character_relationships_last_interaction 
  ON character_relationships(last_interaction_at);

-- ============================================================================
-- 2. RELATIONSHIP EVENTS TABLE
-- ============================================================================
-- Logs every meaningful interaction that affects the relationship.
-- This creates a complete audit trail of how the relationship evolved,
-- enabling pattern analysis and debugging.

CREATE TABLE IF NOT EXISTS relationship_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL,
  
  -- Event classification
  event_type TEXT NOT NULL
    CHECK (event_type IN ('positive', 'negative', 'neutral', 'milestone', 'rupture', 'repair')),
  source TEXT NOT NULL
    CHECK (source IN ('chat', 'video_request', 'system', 'milestone', 'decay')),
  
  -- Sentiment analysis results
  sentiment_toward_character TEXT
    CHECK (sentiment_toward_character IN ('positive', 'neutral', 'negative')),
  sentiment_intensity INTEGER
    CHECK (sentiment_intensity >= 1 AND sentiment_intensity <= 10),
  user_mood TEXT, -- 'stressed', 'bored', 'calm', 'hyped', 'sad', 'happy', etc.
  
  -- Score changes (how this event affected the relationship)
  score_change DECIMAL(5,2) NOT NULL DEFAULT 0.0,
  warmth_change DECIMAL(5,2) NOT NULL DEFAULT 0.0,
  trust_change DECIMAL(5,2) NOT NULL DEFAULT 0.0,
  playfulness_change DECIMAL(5,2) NOT NULL DEFAULT 0.0,
  stability_change DECIMAL(5,2) NOT NULL DEFAULT 0.0,
  
  -- Score snapshots (for tracking progression)
  previous_relationship_score DECIMAL(6,2),
  new_relationship_score DECIMAL(6,2),
  previous_tier TEXT,
  new_tier TEXT,
  
  -- Context
  user_message TEXT, -- The actual message that triggered this (for debugging)
  notes TEXT, -- Additional context or reasoning
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Foreign key
  CONSTRAINT fk_events_relationship FOREIGN KEY (relationship_id)
    REFERENCES character_relationships(id) ON DELETE CASCADE
);

-- Indexes for event queries
CREATE INDEX IF NOT EXISTS idx_relationship_events_relationship 
  ON relationship_events(relationship_id);
CREATE INDEX IF NOT EXISTS idx_relationship_events_created_at 
  ON relationship_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationship_events_type 
  ON relationship_events(event_type);
CREATE INDEX IF NOT EXISTS idx_relationship_events_sentiment 
  ON relationship_events(sentiment_toward_character);

-- ============================================================================
-- 3. AUTOMATIC TIER UPDATE FUNCTION
-- ============================================================================
-- Automatically updates the relationship_tier whenever relationship_score changes.
-- This ensures tiers are always in sync with scores.

CREATE OR REPLACE FUNCTION update_relationship_tier()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate tier based on score
  IF NEW.relationship_score <= -50 THEN
    NEW.relationship_tier := 'adversarial';
  ELSIF NEW.relationship_score <= -10 THEN
    NEW.relationship_tier := 'neutral_negative';
  ELSIF NEW.relationship_score < 10 THEN
    NEW.relationship_tier := 'acquaintance';
  ELSIF NEW.relationship_score < 50 THEN
    NEW.relationship_tier := 'friend';
  ELSIF NEW.relationship_score < 75 THEN
    NEW.relationship_tier := 'close_friend';
  ELSE
    NEW.relationship_tier := 'deeply_loving';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update tier when score changes
CREATE TRIGGER trigger_update_relationship_tier
  BEFORE INSERT OR UPDATE OF relationship_score ON character_relationships
  FOR EACH ROW
  EXECUTE FUNCTION update_relationship_tier();

-- ============================================================================
-- 4. AUTOMATIC FAMILIARITY STAGE UPDATE FUNCTION
-- ============================================================================
-- Updates familiarity_stage based on interaction count and time since first interaction.
-- Controls how bold Kayley can be with observations and emotional intimacy.

CREATE OR REPLACE FUNCTION update_familiarity_stage()
RETURNS TRIGGER AS $$
DECLARE
  days_since_first NUMERIC;
BEGIN
  -- Only calculate if we have a first interaction date
  IF NEW.first_interaction_at IS NOT NULL THEN
    days_since_first := EXTRACT(EPOCH FROM (NOW() - NEW.first_interaction_at)) / 86400;
    
    -- Calculate familiarity stage
    IF NEW.total_interactions < 5 OR days_since_first < 2 THEN
      NEW.familiarity_stage := 'early';
    ELSIF NEW.total_interactions < 25 OR days_since_first < 14 THEN
      NEW.familiarity_stage := 'developing';
    ELSE
      NEW.familiarity_stage := 'established';
    END IF;
  ELSE
    -- Default to early if no first interaction yet
    NEW.familiarity_stage := 'early';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update familiarity stage
CREATE TRIGGER trigger_update_familiarity_stage
  BEFORE INSERT OR UPDATE OF total_interactions, first_interaction_at ON character_relationships
  FOR EACH ROW
  EXECUTE FUNCTION update_familiarity_stage();

-- ============================================================================
-- 5. AUTOMATIC UPDATED_AT TIMESTAMP
-- ============================================================================
-- Keeps updated_at timestamp current whenever a relationship is modified.

CREATE OR REPLACE FUNCTION update_relationship_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_relationship_updated_at
  BEFORE UPDATE ON character_relationships
  FOR EACH ROW
  EXECUTE FUNCTION update_relationship_updated_at();

-- ============================================================================
-- 6. HELPER VIEW: RELATIONSHIP SUMMARY
-- ============================================================================
-- A helpful view for debugging and monitoring relationship states.

CREATE OR REPLACE VIEW relationship_summary AS
SELECT 
  cr.id,
  cr.user_id,
  cr.character_id,
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

-- ============================================================================
-- 7. HELPER VIEW: RECENT RELATIONSHIP EVENTS
-- ============================================================================
-- Shows recent events for a relationship, useful for debugging.

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
  cr.user_id,
  cr.character_id
FROM relationship_events re
JOIN character_relationships cr ON re.relationship_id = cr.id
ORDER BY re.created_at DESC;

-- ============================================================================
-- 8. COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE character_relationships IS 
'Stores the emotional relationship state between users and characters. Tracks multi-dimensional emotional scores (warmth, trust, playfulness, stability) and relationship progression over time.';

COMMENT ON TABLE relationship_events IS 
'Logs every meaningful interaction that affects a relationship. Creates a complete audit trail for pattern analysis and debugging.';

COMMENT ON COLUMN character_relationships.relationship_score IS 
'Primary relationship metric ranging from -100 (adversarial) to +100 (deeply loving).';

COMMENT ON COLUMN character_relationships.warmth_score IS 
'How affectionate Kayley feels toward the user. Ranges from -50 (cold) to +50 (very warm).';

COMMENT ON COLUMN character_relationships.trust_score IS 
'How much Kayley trusts and opens up to the user. Ranges from -50 (guarded) to +50 (fully trusting).';

COMMENT ON COLUMN character_relationships.playfulness_score IS 
'How playful and sassy Kayley is with the user. Ranges from -50 (serious) to +50 (very playful).';

COMMENT ON COLUMN character_relationships.stability_score IS 
'How stable and secure the relationship feels. Ranges from -50 (volatile) to +50 (very stable).';

COMMENT ON COLUMN character_relationships.familiarity_stage IS 
'Controls how bold Kayley can be with observations. Stages: early (cautious), developing (moderate), established (confident).';

COMMENT ON COLUMN character_relationships.is_ruptured IS 
'True if there was a recent significant negative event that created emotional distance.';

COMMENT ON COLUMN relationship_events.sentiment_intensity IS 
'Intensity of sentiment on a scale of 1-10. Higher intensity = more significant impact on relationship.';

-- ============================================================================
-- 9. INITIAL DATA SETUP (Optional)
-- ============================================================================
-- If you want to pre-create relationships for existing users/characters,
-- you can run this after the tables are created. Otherwise, relationships
-- will be created automatically on first interaction.

-- Example (commented out - uncomment and modify as needed):
-- INSERT INTO character_relationships (user_id, character_id, relationship_score, relationship_tier)
-- SELECT DISTINCT 
--   user_id,
--   character_id,
--   0.0,
--   'acquaintance'
-- FROM conversation_history
-- ON CONFLICT (user_id, character_id) DO NOTHING;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- You can now use these tables to track and evolve relationships!
-- 
-- Next steps:
-- 1. Implement the relationship service in your application
-- 2. Analyze sentiment on each message
-- 3. Update relationship scores based on interactions
-- 4. Pass relationship context to Grok for personalized responses
-- ============================================================================

