# Character ID Removal - Implementation Summary

## Overview
All `character_id` references have been removed from the relationship and conversation history systems. All characters now share the same relationship and conversation history for each user, as all characters represent the same person in different settings/environments.

## Changes Made

### 1. Database Migrations

#### `supabase/migrations/remove_character_id_from_relationships.sql`
- Removed `character_id` column from `character_relationships` table
- Dropped foreign key constraint to `characters` table
- Changed unique constraint from `(user_id, character_id)` to just `(user_id)`
- Updated indexes to use only `user_id`
- Updated views to remove `character_id` references

#### `supabase/migrations/remove_character_id_from_conversation_history.sql`
- Removed `character_id` column from `conversation_history` table  
- Updated indexes to use only `user_id`

### 2. Service Layer Updates

#### `src/services/relationshipService.ts`
- **Interface Changes:**
  - Removed `character_id` from `RelationshipRow` interface
- **Function Signature Changes:**
  - `getRelationship(userId: string)` - removed `characterId` parameter
  - `updateRelationship(userId: string, event: RelationshipEvent)` - removed `characterId` parameter
- **Database Query Changes:**
  - Removed `.eq('character_id', characterId)` from all queries
  - Now queries only use `.eq('user_id', userId)`

#### `src/services/conversationHistoryService.ts`
- **Interface Changes:**
  - Removed `character_id` from `ConversationHistoryRow` interface
- **Function Signature Changes:**
  - `saveConversationHistory(userId: string, messages: ChatMessage[])` - removed `characterId` parameter
  - `loadConversationHistory(userId: string)` - removed `characterId` parameter
  - `appendConversationHistory(userId: string, newMessages: ChatMessage[])` - removed `characterId` parameter
  - `clearConversationHistory(userId: string)` - removed `characterId` parameter
- **Database Query Changes:**
  - Removed `.eq('character_id', characterId)` from all queries
  - Removed `character_id` from insert operations

#### `src/services/grokChatService.ts`
- **Interface Changes:**
  - Removed `characterId` from `GrokChatSession` interface
- **Function Signature Changes:**
  - `getOrCreateSession(userId: string)` - removed `characterId` parameter
- **Session Creation Changes:**
  - Removed `characterId` from session objects

### 3. Application Layer Updates

#### `src/App.tsx`
- **Removed Functions:**
  - Removed `getCharacterRelationshipAnchor()` function entirely
  - Removed `slugifyIdentifier()` helper function
- **Updated Function Calls:**
  - All calls to `relationshipService.getRelationship()` now pass only `userId`
  - All calls to `relationshipService.updateRelationship()` now pass only `userId`
  - All calls to `conversationHistoryService.loadConversationHistory()` now pass only `userId`
  - All calls to `conversationHistoryService.appendConversationHistory()` now pass only `userId`
  - All calls to `conversationHistoryService.saveConversationHistory()` now pass only `userId`
  - All calls to `grokChatService.getOrCreateSession()` now pass only `userId`
- **Removed Variables:**
  - Removed all `personaId` variable declarations and usage

### 4. Environment Variables

#### `src/types/vite-env.d.ts`
- Added `VITE_USER_ID` as a required environment variable

#### `docs/ENVIRONMENT_VARIABLES.md`
- Added documentation for `VITE_USER_ID` environment variable
- Updated example configurations

### 5. User ID Management

#### `src/App.tsx`
- Changed `getUserId()` function to read from `VITE_USER_ID` environment variable
- Removed browser fingerprinting logic
- Now throws clear error if `VITE_USER_ID` is not set

## Testing Updates Needed

### `src/services/tests/relationshipService.test.ts`
The following updates are needed in the test file:

1. **Interface Updates:**
   ```typescript
   interface RelationshipRow {
     id: string;
     user_id: string;
     // character_id: string; <- REMOVE THIS LINE
     relationship_score: number;
     // ... rest of fields
   }
   ```

2. **Mock Data Updates:**
   ```typescript
   const createMockRelationshipRow = (
     overrides?: Partial<RelationshipRow>
   ): RelationshipRow => ({
     id: MOCK_RELATIONSHIP_ID,
     user_id: "user-123",
     // character_id: "char-123", <- REMOVE THIS LINE
     // ... rest of fields
   });
   ```

3. **Test Call Updates:**
   All test calls need to be updated from:
   ```typescript
   await relationshipService.getRelationship("char-123", "user-123")
   await relationshipService.updateRelationship("char-123", "user-123", event)
   ```
   
   To:
   ```typescript
   await relationshipService.getRelationship("user-123")
   await relationshipService.updateRelationship("user-123", event)
   ```

4. **Assertion Updates:**
   Remove assertions checking for `character_id`:
   ```typescript
   // expect(mocks.eq).toHaveBeenCalledWith("character_id", "char-123"); <- REMOVE THIS
   expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-123"); // KEEP THIS
   ```

### `src/services/tests/conversationHistoryService.test.ts`
Similar updates needed if this test file exists:
- Remove `character_id` from mock data
- Update function calls to remove `characterId` parameter
- Update assertions

## Migration Steps

To apply these changes to your database:

1. **Run the relationship migration:**
   ```sql
   -- Run: supabase/migrations/remove_character_id_from_relationships.sql
   ```

2. **Run the conversation history migration:**
   ```sql
   -- Run: supabase/migrations/remove_character_id_from_conversation_history.sql
   ```

3. **Set environment variable:**
   Add to your `.env` file:
   ```env
   VITE_USER_ID=your-unique-user-id
   ```

4. **Restart development server:**
   ```bash
   npm run dev
   ```

## Benefits

1. **Unified Relationship:** The character remembers your relationship regardless of which character version/setting you're using
2. **Persistent Conversations:** Conversation history persists across all character versions
3. **Simplified Code:** Removed unnecessary complexity of tracking character-specific relationships
4. **Better UX:** Feels more natural - you're always talking to the same person, just in different contexts

## Breaking Changes

- **Database:** Existing relationships tied to specific `character_id` values will need to be merged
- **API:** All service functions now require one less parameter (`characterId` removed)
- **Environment:** New required environment variable `VITE_USER_ID` must be set

## Rollback

If you need to rollback these changes:
1. Restore the database schema by recreating the `character_id` columns
2. Revert the service layer changes
3. Revert the App.tsx changes
4. Remove `VITE_USER_ID` environment variable requirement

