-- Create table for user's feelings about Kayley's people
-- This tracks the user's perspective (per-user, different for each user)

CREATE TABLE IF NOT EXISTS user_person_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Who and what
  user_id TEXT NOT NULL,
  person_key TEXT NOT NULL REFERENCES kayley_people(person_key) ON DELETE CASCADE,

  -- User's perspective scores
  warmth_score DECIMAL(5,2) DEFAULT 0.0
    CHECK (warmth_score >= -50 AND warmth_score <= 50),
  trust_score DECIMAL(5,2) DEFAULT 0.0
    CHECK (trust_score >= -50 AND trust_score <= 50),
  familiarity_score DECIMAL(5,2) DEFAULT 0.0
    CHECK (familiarity_score >= 0 AND familiarity_score <= 100),

  -- State auto-calculated from scores
  relationship_state TEXT DEFAULT 'unknown'
    CHECK (relationship_state IN ('unknown', 'heard_of', 'familiar', 'fond', 'close')),

  -- Tracking
  mention_count INTEGER DEFAULT 0,
  last_mentioned_at TIMESTAMPTZ,
  user_events JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure one relationship per user-person pair
  UNIQUE(user_id, person_key)
);

-- Indexes for performance
CREATE INDEX idx_user_person_user ON user_person_relationships(user_id);
CREATE INDEX idx_user_person_key ON user_person_relationships(person_key);
CREATE INDEX idx_user_person_composite ON user_person_relationships(user_id, person_key);
CREATE INDEX idx_user_person_state ON user_person_relationships(relationship_state);

-- Auto-calculate relationship_state based on scores and mentions
CREATE OR REPLACE FUNCTION update_user_person_state()
RETURNS TRIGGER AS $$
BEGIN
  -- Determine relationship state based on familiarity and warmth
  IF NEW.mention_count = 0 OR NEW.familiarity_score < 5 THEN
    NEW.relationship_state := 'unknown';
  ELSIF NEW.familiarity_score < 30 THEN
    NEW.relationship_state := 'heard_of';
  ELSIF NEW.familiarity_score < 60 THEN
    NEW.relationship_state := 'familiar';
  ELSIF NEW.warmth_score > 20 AND NEW.familiarity_score >= 60 THEN
    NEW.relationship_state := 'fond';
  ELSIF NEW.warmth_score > 35 AND NEW.familiarity_score >= 80 THEN
    NEW.relationship_state := 'close';
  ELSE
    NEW.relationship_state := 'familiar';
  END IF;

  -- Auto-update timestamp
  NEW.updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_person_state
  BEFORE INSERT OR UPDATE OF mention_count, warmth_score, trust_score, familiarity_score
  ON user_person_relationships
  FOR EACH ROW
  EXECUTE FUNCTION update_user_person_state();

-- Add comments for documentation
COMMENT ON TABLE user_person_relationships IS 'Tracks how each user feels about people in Kayley''s life (per-user perspective)';
COMMENT ON COLUMN user_person_relationships.user_id IS 'ID of user who has feelings about this person';
COMMENT ON COLUMN user_person_relationships.person_key IS 'Foreign key to kayley_people.person_key';
COMMENT ON COLUMN user_person_relationships.warmth_score IS 'How user feels about person (-50 to +50)';
COMMENT ON COLUMN user_person_relationships.trust_score IS 'User''s trust in person (-50 to +50)';
COMMENT ON COLUMN user_person_relationships.familiarity_score IS 'How well user knows person (0 to 100)';
COMMENT ON COLUMN user_person_relationships.relationship_state IS 'Auto-calculated state based on scores';
COMMENT ON COLUMN user_person_relationships.mention_count IS 'How many times Kayley has mentioned this person to user';
COMMENT ON COLUMN user_person_relationships.user_events IS 'JSONB array of user reactions/feelings: [{date, event, sentiment}]';
