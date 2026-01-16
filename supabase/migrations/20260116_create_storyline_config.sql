-- Create storyline_config table to track last processing timestamp
-- This table stores a single row (id=1) with the last time storylines were processed

CREATE TABLE IF NOT EXISTS storyline_config (
  id INTEGER PRIMARY KEY CHECK (id = 1), -- Only allow one row
  last_processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert initial row
INSERT INTO storyline_config (id, last_processed_at)
VALUES (1, NOW())
ON CONFLICT (id) DO NOTHING;

-- Add comment
COMMENT ON TABLE storyline_config IS 'Single-row config table to track last storyline processing timestamp';
