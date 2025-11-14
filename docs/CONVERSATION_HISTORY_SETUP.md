# Conversation History Setup Guide

## Overview

The application now persists conversation history for each character-user pair in Supabase. This allows Grok to have full context of previous conversations when generating responses.

## Database Setup

### 1. Create the Conversation History Table

Run the SQL migration script in your Supabase SQL editor:

```sql
-- File: supabase/migrations/create_conversation_history.sql
```

Or manually create the table:

```sql
CREATE TABLE IF NOT EXISTS conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_role TEXT NOT NULL CHECK (message_role IN ('user', 'model')),
  message_text TEXT NOT NULL,
  action_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT fk_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_history_character_user 
  ON conversation_history(character_id, user_id);

CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at 
  ON conversation_history(created_at);
```

### 2. Set Up Row Level Security (RLS)

For production, you'll want to set up RLS policies. Example:

```sql
-- Enable RLS
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own conversation history
CREATE POLICY "Users can view their own conversation history"
  ON conversation_history
  FOR SELECT
  USING (auth.uid()::text = user_id OR true); -- Adjust based on your auth setup

-- Policy: Users can insert their own messages
CREATE POLICY "Users can insert their own messages"
  ON conversation_history
  FOR INSERT
  WITH CHECK (true); -- Adjust based on your auth setup
```

## How It Works

### Loading Conversation History

1. When a character is selected (`handleSelectCharacter`):
   - Loads all saved conversation history for that character-user pair
   - Passes the full history to Grok when generating the greeting
   - Displays the history in the chat panel

### Saving Conversation History

1. **Incremental Saves** (during conversation):
   - Each time a user sends a message and receives a response, both messages are saved immediately
   - This happens asynchronously and doesn't block the UI

2. **Final Save** (when leaving character):
   - When the user clicks "Back to Selection", any unsaved messages are saved
   - This ensures no messages are lost if the user closes the app quickly

### What Gets Saved

- ✅ All user messages
- ✅ All model responses to user messages
- ❌ Greeting messages (generated fresh each time, not saved)

## Service Functions

The `conversationHistoryService.ts` provides:

- `loadConversationHistory(characterId, userId)` - Loads all messages for a character-user pair
- `appendConversationHistory(characterId, userId, messages)` - Adds new messages to the history
- `saveConversationHistory(characterId, userId, messages)` - Saves a full conversation (used for migration/backup)
- `clearConversationHistory(characterId, userId)` - Clears all history for a character-user pair

## User Identification

Users are identified using browser fingerprinting (stored in localStorage):
- Generated from: user agent, language, screen size, timestamp
- Stable across sessions on the same browser
- Stored in `localStorage` with key `interactive_video_character_user_id`

## Notes

- **Large Conversations**: As conversations grow, the history table will get large. Consider:
  - Archiving old conversations
  - Implementing pagination for loading history
  - Setting up retention policies

- **Performance**: 
  - History is loaded once when selecting a character
  - New messages are appended incrementally (efficient)
  - Full history is sent to Grok API (may hit token limits for very long conversations)

- **Privacy**: 
  - Currently uses browser fingerprinting (not true authentication)
  - For production, consider implementing proper user authentication
  - RLS policies should be configured based on your security requirements

