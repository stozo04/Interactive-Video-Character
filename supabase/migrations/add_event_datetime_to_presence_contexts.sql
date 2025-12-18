-- Add event_datetime column to presence_contexts table
-- For pending_event loops: when the actual event occurs
-- Used to prevent asking "how was it?" before the event happens

ALTER TABLE presence_contexts 
ADD COLUMN IF NOT EXISTS event_datetime TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN presence_contexts.event_datetime IS 
  'For pending_event loops: when the actual event occurs. Used to prevent asking "how was it?" before the event happens.';

-- Add index for efficient querying of future events
CREATE INDEX IF NOT EXISTS idx_presence_contexts_event_datetime 
  ON presence_contexts(event_datetime) 
  WHERE event_datetime IS NOT NULL;

