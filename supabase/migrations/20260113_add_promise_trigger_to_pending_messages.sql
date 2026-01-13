-- Update pending_messages trigger check constraint to include 'promise'
ALTER TABLE pending_messages 
DROP CONSTRAINT IF EXISTS pending_messages_trigger_check;

ALTER TABLE pending_messages
ADD CONSTRAINT pending_messages_trigger_check 
CHECK (trigger IN ('calendar', 'gift', 'urgent', 'promise'));
