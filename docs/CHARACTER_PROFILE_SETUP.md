# Character Profile Setup Instructions

## Quick Start

1. **Upload character profile to Grok Collection**: Upload Kayley's character profile to your Grok Collection (ID: `collection_6d974389-0d29-4bb6-9ebb-ff09a08eaca0`)

2. **That's it!** The collection is automatically referenced in every chat session, and Grok will read from it to understand Kayley's personality, background, and characteristics.

## How It Works

### Step 1: Upload Profile to Grok Collection

Upload Kayley's character profile to your Grok Collection (`collection_6d974389-0d29-4bb6-9ebb-ff09a08eaca0`). 

You can use the `KAYLEY_CHARACTER_PROFILE_GUIDE.md` as a reference for what information to include. The profile should contain:
- Personality traits
- Background and history
- Interests and hobbies
- Values and beliefs
- Quirks and habits
- Relationships
- Goals and aspirations
- Memorable stories
- And any other relevant character information

### Step 2: Automatic Integration

The collection is automatically referenced in every chat session:

1. **Collection ID** is included in every API request to Grok
2. **System prompt** tells Grok to read from the collection
3. **Grok automatically retrieves** relevant information from the collection
4. **Combined with conversation history** for context-aware responses

### Step 3: How It's Used

The character profile collection is referenced in every chat session, which means:

- **Every greeting** - Grok reads from the collection to understand Kayley's character
- **Every response** - Grok references the collection for consistent personality
- **Conversation history** - Combined with collection data for context
- **Kayley will respond** consistently based on her personality, background, interests, etc. from the collection

## File Structure

```
KAYLEY_CHARACTER_PROFILE_GUIDE.md  ← Reference guide for what to include in the collection
services/grokChatService.ts        ← Automatically references the Grok Collection
Grok Collection (ID: collection_6d974389-0d29-4bb6-9ebb-ff09a08eaca0) ← Where profile is stored
```

## What Gets Sent to Grok

When you chat with Kayley, Grok receives:

1. **System Prompt** containing:
   - Reference to the character profile collection
   - Instructions to read from the collection
   - Available video actions
   - Response guidelines

2. **Collection Reference** (`collection_ids: [CHARACTER_COLLECTION_ID]`):
   - Tells Grok to read from the collection
   - Grok automatically retrieves relevant character information

3. **Conversation History** (all previous messages)

4. **Current User Message**

5. **Context** (if an action was matched)

## Testing

After filling out the profile:

1. Start a new conversation with a character
2. The greeting should reflect Kayley's personality
3. Ask questions about her interests, background, etc.
4. She should respond consistently with her profile
5. She should reference her past, hobbies, and experiences naturally

## Updating the Profile

You can update the character profile in the Grok Collection at any time:
- Update the documents in the collection
- Changes take effect immediately in new conversations
- No need to restart the app
- Existing conversations will use the updated profile for new messages

## Tips

- **Be specific**: Instead of "likes art", say "loves watercolor painting, especially landscapes"
- **Add details**: The more specific, the more authentic conversations will feel
- **Stay consistent**: Once set, maintain consistency across the profile
- **Test regularly**: Try different conversation topics to see how the profile works

## Example Profile Sections

### Personality Traits
```typescript
personalityTraits: [
  'Creative and artistic, sees beauty in everyday things',
  'Empathetic and a good listener, people often open up to her',
  'Slightly introverted but warms up quickly in one-on-one conversations',
  'Has a dry sense of humor and appreciates wit',
  'Tends to overthink things but is working on being more present',
]
```

### Interests
```typescript
interests: {
  activeHobbies: [
    'Watercolor painting (especially landscapes and urban scenes)',
    'Photography (loves capturing street art and city details)',
    'Learning calligraphy (recently started)',
    'Hiking on weekends (explores trails around Seattle)',
  ],
  specificExamples: [
    'Follows several digital artists on Instagram',
    'Takes photos of street art in her neighborhood',
    'Recently started learning calligraphy and practices daily',
  ],
}
```

### Memorable Stories
```typescript
memorableStories: [
  'That time I got lost in Seattle and discovered my favorite coffee shop',
  'The art project that took me six months but I\'m so proud of',
  'When I accidentally signed up for a pottery class thinking it was something else',
]
```

## Next Steps

1. Use `KAYLEY_CHARACTER_PROFILE_GUIDE.md` as your reference
2. Create or update documents in your Grok Collection (`collection_6d974389-0d29-4bb6-9ebb-ff09a08eaca0`)
3. Include all relevant character information (personality, background, interests, etc.)
4. Test by starting a conversation with Kayley!

---

**Note**: The collection is referenced with every message to Grok. Grok will automatically retrieve relevant information from the collection, so you can include comprehensive details without worrying about token limits in the system prompt. Focus on creating detailed, well-organized documents in the collection that cover all aspects of Kayley's character.

