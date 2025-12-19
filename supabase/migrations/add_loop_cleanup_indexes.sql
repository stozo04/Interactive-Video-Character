-- Add indexes for loop cleanup service
-- Optimizes scheduled cleanup queries filtering by user, status, and age

-- Index for cleanup queries (status + user + dates)
CREATE INDEX IF NOT EXISTS idx_presence_contexts_cleanup 
ON presence_contexts (user_id, status, created_at);

-- Index for duplicate detection (user + topic + status)
CREATE INDEX IF NOT EXISTS idx_presence_contexts_dedup 
ON presence_contexts (user_id, topic, status);

-- Add comments
COMMENT ON INDEX idx_presence_contexts_cleanup IS 
  'Optimizes scheduled cleanup queries filtering by user, status, and age';
  
COMMENT ON INDEX idx_presence_contexts_dedup IS 
  'Optimizes duplicate detection queries filtering by user, topic, and status';

