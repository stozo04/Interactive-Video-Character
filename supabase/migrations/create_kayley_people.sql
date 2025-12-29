-- Create table for Kayley's relationships with people in her life
-- This tracks Kayley's perspective (global, same for all users)

CREATE TABLE IF NOT EXISTS kayley_people (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Person identification
  person_key TEXT NOT NULL UNIQUE,
  person_name TEXT NOT NULL,
  person_role TEXT NOT NULL,

  -- Kayley's perspective
  relationship_status TEXT DEFAULT 'friendly'
    CHECK (relationship_status IN ('close', 'friendly', 'distant', 'complicated', 'estranged')),
  last_interaction_date DATE,
  current_situation JSONB DEFAULT '[]'::jsonb,
  kayley_notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_kayley_people_key ON kayley_people(person_key);
CREATE INDEX idx_kayley_people_status ON kayley_people(relationship_status);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_kayley_people_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_kayley_people_timestamp
  BEFORE UPDATE ON kayley_people
  FOR EACH ROW
  EXECUTE FUNCTION update_kayley_people_timestamp();

-- Seed initial people from Kayley's character profile
INSERT INTO kayley_people (person_key, person_name, person_role, relationship_status, kayley_notes)
VALUES
  (
    'lena',
    'Lena Martinez',
    'Best friend from college',
    'close',
    'Lives in Portland, we video chat weekly. Works in design.'
  ),
  (
    'ethan',
    'Ethan Adams',
    'Younger brother',
    'close',
    'Lives in Arizona, works in IT. Good relationship but he can be annoying sometimes.'
  ),
  (
    'mom',
    'Carol Adams',
    'Mother',
    'close',
    'Elementary school teacher. We talk every Sunday. She worries about me but means well.'
  )
ON CONFLICT (person_key) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE kayley_people IS 'Tracks Kayley''s relationships with people in her life (global perspective, not per-user)';
COMMENT ON COLUMN kayley_people.person_key IS 'Unique identifier for person (e.g., "lena", "ethan", "mom")';
COMMENT ON COLUMN kayley_people.person_name IS 'Full name of person';
COMMENT ON COLUMN kayley_people.person_role IS 'How Kayley knows them (e.g., "Best friend from college")';
COMMENT ON COLUMN kayley_people.relationship_status IS 'Current status of Kayley''s relationship with this person';
COMMENT ON COLUMN kayley_people.current_situation IS 'JSONB array of recent life events: [{date, event}]';
COMMENT ON COLUMN kayley_people.kayley_notes IS 'Kayley''s personal notes about this person';
