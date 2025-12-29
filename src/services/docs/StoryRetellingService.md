# Story Retelling Service

**File:** `src/services/storyRetellingService.ts`
**Tables:** `kayley_stories`, `user_story_tracking`
**Purpose:** Ensure Kayley tells her signature stories consistently across conversations with different users, preventing contradictions and maintaining factual integrity

---

## Overview

The Story Retelling Service manages Kayley's **signature stories** from her past - ensuring she tells them consistently and doesn't repeat herself to the same user too soon. This system:
- Stores key details (quotes, dates, outcomes) that must remain consistent
- Tracks which users have heard which stories
- Enforces a cooldown period (30 days default) before retelling
- Supports both predefined stories and dynamic story creation

### Key Concept: Stories vs. Narrative Arcs

```
┌─────────────────────────────────────────┐
│ NARRATIVE ARCS (narrativeArcsService)   │
│ - Current projects and ongoing events   │
│ - "I'm working on a collab with Sarah"  │
│ - Evolves in real-time                  │
│ - Has beginning → progress → end        │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ STORIES (storyRetellingService)         │
│ - Past anecdotes from her backstory     │
│ - "That viral video I made last year"   │
│ - Already happened (static timeline)    │
│ - Told multiple times with consistency  │
└─────────────────────────────────────────┘
```

---

## Table Schema (Dual-Table Pattern)

### Table 1: `kayley_stories` (Global Story Catalog)

Single source of truth for all stories (predefined + dynamic).

```sql
CREATE TABLE IF NOT EXISTS kayley_stories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_key TEXT NOT NULL UNIQUE,           -- e.g., 'viral_oops_video'
  story_title TEXT NOT NULL,                -- "The Viral 'Oops' Video"
  summary TEXT NOT NULL,                    -- 1-2 sentence summary
  key_details JSONB DEFAULT '[]'::jsonb,    -- [{detail, value}]
  story_type TEXT NOT NULL DEFAULT 'predefined',  -- 'predefined' or 'dynamic'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Story Types:**
- `predefined` - From character profile (7 signature stories)
- `dynamic` - Created during conversation (new anecdotes)

**Key Details Format:**
```json
[
  {"detail": "quote", "value": "Wait, that sounded smarter in my head"},
  {"detail": "reaction", "value": "People loved the authenticity"},
  {"detail": "outcome", "value": "Semi-viral success"}
]
```

### Table 2: `user_story_tracking` (Per-User Tracking)

Tracks which users have heard which stories.

```sql
CREATE TABLE IF NOT EXISTS user_story_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  story_key TEXT NOT NULL REFERENCES kayley_stories(story_key) ON DELETE CASCADE,
  first_told_at TIMESTAMPTZ DEFAULT NOW(),
  last_told_at TIMESTAMPTZ DEFAULT NOW(),
  times_told INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, story_key)
);
```

---

## Predefined Stories (Seed Data)

7 signature stories from Kayley's character profile:

| Story Key | Title | Key Details |
|-----------|-------|-------------|
| `viral_oops_video` | The Viral "Oops" Video | Quote: "Wait, that sounded smarter in my head" |
| `ai_apartment_hunt` | AI vs. Apartment Hunt | Situation: Used ChatGPT to write emails |
| `panel_invitation` | The Panel Invitation | Feeling: Imposter syndrome → surprise success |
| `pageant_era` | The Pageant Era | Lesson: Learned performance wasn't fulfilling |
| `coffee_meetcute` | The Coffee Shop Meet-Cute That Wasn't | Mishap: Thought stranger was waving at her |
| `laptop_catastrophe` | The Laptop Catastrophe | Item: Spilled matcha on laptop before big deadline |
| `first_brand_deal` | The First Brand Deal | Quote: "Wait, people will PAY me?" |

---

## Service Functions

### Global Story Catalog

#### `getStory(storyKey: string): Promise<KayleyStory | null>`
Retrieve a specific story by key.

```typescript
const story = await getStory('viral_oops_video');
console.log(story.storyTitle); // "The Viral 'Oops' Video"
console.log(story.keyDetails); // [{detail: "quote", value: "..."}]
```

#### `getAllStories(options?): Promise<KayleyStory[]>`
Get all stories with optional filtering.

```typescript
// Get all predefined stories
const predefinedStories = await getAllStories({ storyType: 'predefined' });

// Get all dynamic stories
const dynamicStories = await getAllStories({ storyType: 'dynamic' });

// Get all stories (no filter)
const allStories = await getAllStories();
```

#### `createDynamicStory(params): Promise<KayleyStory | null>`
Create a new story during conversation.

```typescript
await createDynamicStory({
  storyKey: 'met_celebrity_whole_foods',
  storyTitle: 'That Time I Met a Celebrity at Whole Foods',
  summary: 'Bumped into a B-list actor while reaching for kombucha',
  keyDetails: [
    { detail: 'location', value: 'Whole Foods on Lamar' },
    { detail: 'celebrity', value: 'B-list actor from Netflix show' },
    { detail: 'item', value: 'Kombucha' }
  ]
});
```

### Per-User Tracking

#### `checkIfTold(userId, storyKey, cooldownDays = 30): Promise<StoryTellingCheck>`
Check if story has been told to this user before and whether it can be retold.

```typescript
const check = await checkIfTold('user123', 'viral_oops_video');

console.log(check.hasTold);          // false (first time)
console.log(check.canRetell);        // true (not told yet)
console.log(check.story);            // Full story object
console.log(check.daysSinceLastTold); // null (never told)
```

**Cooldown Logic:**
- `hasTold = false` → Never told to this user
- `hasTold = true, canRetell = false` → Told within cooldown period (too soon)
- `hasTold = true, canRetell = true` → Cooldown passed (can retell if relevant)

#### `markAsTold(userId, storyKey): Promise<boolean>`
Mark a story as told to a user.

```typescript
await markAsTold('user123', 'viral_oops_video');
// Creates tracking record with first_told_at = NOW

// If called again later (retelling)
await markAsTold('user123', 'viral_oops_video');
// Updates last_told_at = NOW, increments times_told
```

#### `getStoriesToldToUser(userId): Promise<Array<KayleyStory & { tracking }>>`
Get all stories told to a specific user with tracking metadata.

```typescript
const toldStories = await getStoriesToldToUser('user123');

toldStories.forEach(story => {
  console.log(story.storyTitle);
  console.log(story.tracking.times_told);
  console.log(story.tracking.last_told_at);
});
```

### Prompt Integration

#### `formatStoriesForPrompt(userId): Promise<string>`
Format stories for system prompt injection with already-told markers.

```typescript
const storiesPrompt = await formatStoriesForPrompt('user123');
// Returns formatted markdown for prompt
```

**Output Example:**
```markdown
## Your Signature Stories

### The Viral "Oops" Video
**Summary:** One of Kayley's first semi-viral videos...
**Key Details (stay consistent!):**
  - quote: Wait, that sounded smarter in my head
  - reaction: People loved the authenticity
  - outcome: Semi-viral success
⚠️ Already told to this user (5 days ago) - Don't retell yet!

### The Laptop Catastrophe
**Summary:** Spilled matcha on laptop before a big deadline...
**Key Details (stay consistent!):**
  - item: Matcha latte
  - timing: 2 hours before client presentation
  - outcome: Backup saved the day

[... 5 more stories ...]

**IMPORTANT:**
- When sharing a story, keep the KEY DETAILS consistent
- Use the `recall_story` tool if unsure whether you've told a story
- Don't retell the same story too soon (check cooldown)
```

---

## LLM Tool Integration

### Tool 1: `recall_story`

**Available to:** Kayley (the character)
**Purpose:** Check if story has been told to this user before

**Parameters:**
- `story_key` (required) - Story identifier (e.g., `'viral_oops_video'`)

**Example Usage:**

```typescript
// Before telling a story
Tool Call: recall_story("viral_oops_video")

// Returns (if not told):
"✓ You have NOT told 'The Viral Oops Video' to this user yet.
Key details to include: quote='Wait, that sounded smarter in my head', reaction='People loved the authenticity', outcome='Semi-viral success'"

// Returns (if told 5 days ago):
"⚠️ You told 'The Viral Oops Video' to this user only 5 days ago. Too soon to retell."

// Returns (if told 45 days ago):
"⚠️ You told 'The Viral Oops Video' to this user 45 days ago. You CAN retell if relevant."
```

### Tool 2: `manage_story_retelling`

**Available to:** Kayley (the character)
**Purpose:** Mark stories as told or create new stories

**Actions:**
- `mark_told` - Record that a story was just told
- `create_story` - Create a new dynamic story

**Example Usage:**

```typescript
// After telling a story
Tool Call: manage_story_retelling({
  action: "mark_told",
  story_key: "viral_oops_video"
})

// Creating a new story
Tool Call: manage_story_retelling({
  action: "create_story",
  story_key: "met_celebrity_whole_foods",
  story_title: "That Time I Met a Celebrity at Whole Foods",
  summary: "Bumped into a B-list actor while both reaching for kombucha",
  key_details: [
    {detail: "location", value: "Whole Foods on Lamar"},
    {detail: "celebrity", value: "B-list actor from Netflix show"},
    {detail: "item", value: "Kombucha"}
  ]
})
```

---

## System Prompt Integration

Stories are automatically injected into the system prompt via `buildSystemPrompt()`:

```typescript
// In systemPromptBuilder.ts
const storiesPrompt = await formatStoriesForPrompt(userId);

prompt += `
${KAYLEY_FULL_PROFILE}
${characterFactsPrompt}
${narrativeArcsPrompt}
${dynamicRelationshipsPrompt}
${storiesPrompt}  // <-- Injected here
`;
```

This ensures Kayley:
- Knows all her signature stories
- Sees which ones this user has already heard
- Knows key details to keep consistent
- Knows when cooldown prevents retelling

---

## User Flow Examples

### Scenario 1: First Time Telling a Story

```
User: "How did you get started with content creation?"

Kayley's Process:
1. Recognizes opportunity to tell "viral_oops_video" story
2. Calls recall_story("viral_oops_video")
3. Tool returns: "NOT told yet. Key details: quote='Wait...'"
4. Kayley tells the story, including key details
5. Calls manage_story_retelling("mark_told", "viral_oops_video")
6. Tracking record created: first_told_at = NOW, times_told = 1

Kayley's Response:
"Oh man, so my first semi-viral video was this total accident. I was explaining
some AI concept and midway through I was like 'Wait, that sounded smarter in my
head' and just left it in. People LOVED it - said it felt so authentic. That's
kind of when I realized being real beats being perfect."
```

**Database State After:**
```sql
user_story_tracking:
  user_id: "user123"
  story_key: "viral_oops_video"
  first_told_at: 2025-12-29T10:30:00Z
  last_told_at: 2025-12-29T10:30:00Z
  times_told: 1
```

### Scenario 2: User Asks Again 5 Days Later

```
User (5 days later): "Tell me about your content creation journey"

Kayley's Process:
1. Calls recall_story("viral_oops_video")
2. Tool returns: "Told 5 days ago. Too soon to retell."
3. Kayley chooses a DIFFERENT story or changes topic

Kayley's Response:
"Oh, I've got other stories from that time! Like when I almost didn't go to
that panel discussion because of imposter syndrome..."
```

### Scenario 3: User Asks Again 35 Days Later

```
User (35 days later): "How did you start making videos?"

Kayley's Process:
1. Calls recall_story("viral_oops_video")
2. Tool returns: "Told 35 days ago. CAN retell if relevant."
3. Kayley decides context warrants retelling
4. Tells story again with SAME key details
5. Calls manage_story_retelling("mark_told", "viral_oops_video")
6. Database updates: last_told_at → NOW, times_told → 2

Kayley's Response:
"You know, I've told you this before, but it's still one of my favorite stories -
that first semi-viral video where I said 'Wait, that sounded smarter in my head'
and people loved it. That moment taught me so much about authenticity..."
```

**Database State After:**
```sql
user_story_tracking:
  user_id: "user123"
  story_key: "viral_oops_video"
  first_told_at: 2025-12-29T10:30:00Z
  last_told_at: 2026-02-02T14:15:00Z  ← Updated
  times_told: 2  ← Incremented
```

---

## Design Decisions

### Why Dual-Table Pattern?

Following the same pattern as Phase 2 (Dynamic Relationships):

| Global Table | Per-User Tracking |
|--------------|-------------------|
| `kayley_stories` | `user_story_tracking` |
| Single source of truth | Personalized tracking |
| All stories (predefined + dynamic) | Which user heard which story |
| Story content never changes | Tracking data changes |

**Benefits:**
- Consistency: All users get same story details
- Personalization: Each user has unique tracking
- Scalability: Adding users doesn't duplicate stories
- Maintainability: Update story once, affects all users

### Story Key Naming Convention

**Format:** `lowercase_with_underscores`

**Examples:**
- `viral_oops_video`
- `ai_apartment_hunt`
- `met_celebrity_whole_foods`

**Guidelines:**
- Descriptive and unique
- Max 50 characters
- No spaces or special characters
- Memorable for code references

### Cooldown Logic

**Default:** 30 days (configurable per-call)

**Philosophy:**
- Too short (7 days) → Feels repetitive
- Too long (90 days) → Loses ability to naturally retell
- 30 days → Sweet spot for casual conversations

**Configurable:**
```typescript
// Use 60-day cooldown instead of 30
const check = await checkIfTold(userId, storyKey, 60);
```

### Key Details Storage

**Why JSONB?**
- Flexible structure (different stories have different details)
- Easy to query individual detail values
- Can be extended without schema changes

**Best Practices:**
```typescript
// ✅ GOOD - Specific detail types
[
  {detail: "quote", value: "Wait, that sounded smarter in my head"},
  {detail: "location", value: "Coffee shop on 6th Street"},
  {detail: "outcome", value: "Got 50k views"}
]

// ❌ BAD - Generic detail types
[
  {detail: "detail1", value: "Something happened"},
  {detail: "detail2", value: "Something else"}
]
```

---

## Integration with Other Services

### Relationship to Narrative Arcs

```
Narrative Arcs:      Current projects (ongoing)
Story Retelling:     Past anecdotes (completed)

Narrative Arc:       "I'm working on a collab with Sarah" (happening now)
Story:               "That viral video I made last year" (already happened)
```

### Relationship to Character Facts

```
Character Facts:     Permanent details
Story Retelling:     Retellings of past events

Character Fact:      "favorite_coffee_shop = Blue Bottle"
Story:               "That time I spilled coffee at Blue Bottle before my presentation"
```

### Relationship to Dynamic Relationships

```
Dynamic Relationships: People in Kayley's life (Lena, Mom, Ethan)
Story Retelling:       Stories might MENTION these people

Dynamic Relationship:  "Lena" (best friend)
Story might include:   "Lena was there when I made that viral video"
```

---

## Testing

### Unit Tests

**Test File:** `src/services/tests/storyRetellingService.test.ts`

**Coverage:**
- ✅ Story retrieval (getStory, getAllStories)
- ✅ Dynamic story creation
- ✅ User tracking (checkIfTold, markAsTold)
- ✅ Cooldown calculations
- ✅ Prompt formatting
- ✅ Already-told markers

**Run Tests:**
```bash
npm test -- --run -t "storyRetellingService"
```

### Manual Test Flow

1. **First Telling**
   ```
   Ask Kayley about her content creation journey
   → She tells viral video story
   → Check DB: SELECT * FROM user_story_tracking WHERE user_id = 'YOUR_USER_ID'
   → Verify tracking record created
   ```

2. **Too Soon Retelling**
   ```
   Ask same question 2 days later
   → She chooses different story (cooldown working)
   → Check tool logs: recall_story should return "too soon"
   ```

3. **Allowed Retelling**
   ```
   Ask same question 35 days later
   → She can retell if relevant
   → Check DB: times_told incremented, last_told_at updated
   ```

---

## Common Patterns

### Pattern 1: Predefined Story Lifecycle

```typescript
// User asks about Kayley's past
→ recall_story("viral_oops_video")
→ Tool returns: "Not told yet. Key details: ..."
→ Kayley tells story with key details
→ manage_story_retelling("mark_told", "viral_oops_video")
→ Tracking record created

// Days later, user asks again
→ recall_story("viral_oops_video")
→ Tool returns: "Told 5 days ago. Too soon."
→ Kayley tells different story

// Month later, user asks again
→ recall_story("viral_oops_video")
→ Tool returns: "Told 35 days ago. Can retell."
→ Kayley can choose to retell with same details
```

### Pattern 2: Dynamic Story Creation

```typescript
// Kayley shares new anecdote
Kayley: "Oh! This reminds me of when I met a celebrity at Whole Foods..."

→ manage_story_retelling({
    action: "create_story",
    story_key: "met_celebrity_whole_foods",
    story_title: "That Time I Met a Celebrity",
    summary: "Awkward encounter reaching for kombucha",
    key_details: [...]
  })

→ Story added to global catalog
→ Automatically marked as told to current user

// Later, with different user
→ Can tell same story with same details
→ Tracking separate per user
```

---

## Performance Considerations

### Fetching Stories

**Current:** Fetched in parallel with other context
```typescript
const [soulContext, characterFacts, narrativeArcs, dynamicRelationships, stories] =
  await Promise.all([
    getSoulLayerContextAsync(userId),
    formatCharacterFactsForPrompt(),
    formatArcsForPrompt(userId),
    formatDynamicRelationshipsForPrompt(userId),
    formatStoriesForPrompt(userId)
  ]);
```

**Latency:** ~100-150ms (2 database queries + formatting)

**Optimization Opportunity:**
Could add to `prefetchService.ts` for idle-time prefetching (optional).

### Prompt Size

**Typical story count:** 7 predefined + 0-3 dynamic = 7-10 stories
**Size per story:** ~150-250 characters
**Total impact:** ~1000-2500 characters added to prompt

**Token cost:** ~250-600 tokens (negligible for long context models)

---

## Configuration

### Constants

```typescript
// In storyRetellingService.ts
const DEFAULT_COOLDOWN_DAYS = 30;  // Retelling cooldown
```

### Adjustable Per-Call

```typescript
// Use custom cooldown (60 days instead of 30)
const check = await checkIfTold(userId, storyKey, 60);
```

---

## Future Enhancements (Out of Scope)

1. **Story Versioning** - Track how story evolves over time
2. **Story Triggers** - Auto-suggest stories based on topic keywords
3. **Story Feedback** - Track user reactions (liked/disliked)
4. **Story Search** - Full-text search across summaries
5. **Per-Story Cooldowns** - Different cooldowns for different story types
6. **Story Expiration** - Auto-archive untold stories after 1 year

---

## Troubleshooting

### Story not appearing in prompt
1. Check story exists: `SELECT * FROM kayley_stories WHERE story_key = '...'`
2. Check `formatStoriesForPrompt()` is called in `buildSystemPrompt()`
3. Verify no errors in service logs

### Tool not being called
1. Check `aiSchema.ts` has `recall_story` and `manage_story_retelling` declarations
2. Check `memoryService.ts` has case handlers for both tools
3. Verify `MemoryToolArgs` and `PendingToolCall.name` types updated

### Cooldown not working
1. Check `checkIfTold()` called before `markAsTold()`
2. Verify cooldown days parameter: `checkIfTold(userId, storyKey, 30)`
3. Check `last_told_at` timestamp in database

### Tests failing
1. Run snapshot update: `npm test -- --run -t "snapshot" -u`
2. Check mock setup in test file
3. Verify service exports match test imports

---

## Summary

**Story Retelling Service** ensures Kayley's backstory stays consistent across conversations with different users while preventing repetitive storytelling to the same user. This creates a more believable character who remembers what she's told you and keeps her facts straight.

**Key Benefits:**
- ✅ **Consistency** - Key facts stay the same across all tellings
- ✅ **No Repetition** - 30-day cooldown prevents retelling too soon
- ✅ **Personalization** - Each user has unique tracking
- ✅ **Extensibility** - Can create new stories dynamically

**Integration Points:**
- Database: `kayley_stories` + `user_story_tracking` tables
- Service: `storyRetellingService.ts`
- LLM Tools: `recall_story`, `manage_story_retelling`
- Prompt: Injected via `buildSystemPrompt()`

**Related Documentation:**
- [Character Memory Systems Implementation](../../../docs/completed_features/Character_Memory_Systems_Implementation.md) - All 3 phases
- [Narrative Arcs Service](./NarrativeArcsService.md)
- [Dynamic Relationships Service](./DynamicRelationshipsService.md)
- [Tool Integration Checklist](../../../docs/Tool_Integration_Checklist.md)
