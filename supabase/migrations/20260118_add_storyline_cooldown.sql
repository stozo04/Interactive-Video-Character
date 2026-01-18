-- Add cooldown timestamp to track last creation
ALTER TABLE storyline_config
ADD COLUMN last_storyline_created_at TIMESTAMPTZ;

-- Set initial value (49 hours ago = outside 48-hour window, allows immediate creation)
UPDATE storyline_config
SET last_storyline_created_at = NOW() - INTERVAL '49 hours'
WHERE id = 1;

-- Documentation
COMMENT ON COLUMN storyline_config.last_storyline_created_at IS
  'Tracks last storyline creation for 48-hour cooldown enforcement';
