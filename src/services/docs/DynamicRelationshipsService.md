# Dynamic Relationships Service

**File:** `src/services/dynamicRelationshipsService.ts`
**Tables:** `kayley_people` + `user_person_relationships`
**Purpose:** Track Kayley's relationships with people in her life from TWO perspectives: Kayley's global view and each user's unique knowledge/connection

---

## Overview

The Dynamic Relationships Service manages Kayley's relationships with **people in her life** (friends, family, colleagues) using a **dual-perspective design**. This allows:
- Kayley to have consistent, ongoing relationships across all users
- Each user to have their own unique knowledge and connection to Kayley's people
- Natural relationship progression from strangers to close friends (from the user's perspective)

### Key Concept: Dual Perspective

```
┌─────────────────────────────────────────┐
│ KAYLEY'S PERSPECTIVE (Global)           │
│ - Who this person is to Kayley          │
│ - Current relationship status           │
│ - What's happening in their life        │
│ - Kayley's internal notes               │
│ - SAME FOR ALL USERS                    │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ USER'S PERSPECTIVE (Per-User)           │
│ - How much this user knows about person │
│ - User's warmth/trust/familiarity       │
│ - Conversation history about person     │
│ - How many times mentioned              │
│ - UNIQUE PER USER                       │
└─────────────────────────────────────────┘
```

---

## Table Schemas

### `kayley_people` (Kayley's Perspective)

Tracks Kayley's global relationships - same for all users.

```sql
CREATE TABLE kayley_people (
  id UUID PRIMARY KEY,
  person_key TEXT NOT NULL UNIQUE,           -- e.g., 'lena', 'ethan', 'mom'
  person_name TEXT NOT NULL,                 -- e.g., "Lena Martinez"
  person_role TEXT NOT NULL,                 -- e.g., "Best friend from college"

  relationship_status TEXT DEFAULT 'friendly', -- 'close', 'friendly', 'neutral', 'distant', 'strained'
  last_interaction_date DATE,
  current_situation JSONB DEFAULT '[]',      -- [{date, event}]
  kayley_notes TEXT,                         -- Kayley's private thoughts

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Relationship Status Values:**
- `close` - Very close relationship (best friend, family)
- `friendly` - Good relationship, regular contact
- `neutral` - Cordial but not particularly close
- `distant` - Growing apart, infrequent contact
- `strained` - Tension or conflict in the relationship

**Current Situation Format:**
```typescript
[
  { "date": "2024-12-15", "event": "Started new job at design agency" },
  { "date": "2024-12-20", "event": "Got promoted to senior designer" }
]
```

### `user_person_relationships` (User's Perspective)

Tracks each user's unique relationship with Kayley's people.

```sql
CREATE TABLE user_person_relationships (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  person_key TEXT NOT NULL REFERENCES kayley_people(person_key),

  -- User's feelings/knowledge (scores)
  warmth_score DECIMAL(5,2) DEFAULT 0.0     CHECK (warmth_score >= -50 AND warmth_score <= 50),
  trust_score DECIMAL(5,2) DEFAULT 0.0      CHECK (trust_score >= -50 AND trust_score <= 50),
  familiarity_score DECIMAL(5,2) DEFAULT 0.0 CHECK (familiarity_score >= 0 AND familiarity_score <= 100),

  -- Auto-calculated state
  relationship_state TEXT DEFAULT 'unknown', -- 'unknown', 'heard_of', 'familiar', 'connected'

  -- Tracking
  mention_count INTEGER DEFAULT 0,
  last_mentioned_at TIMESTAMPTZ,
  user_events JSONB DEFAULT '[]',            -- [{date, event, sentiment}]

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, person_key)
);
```

**Relationship State Values:**
- `unknown` - User has never heard of this person
- `heard_of` - User knows the name, minimal details
- `familiar` - User knows a decent amount about them
- `connected` - User feels personally connected to this person

**User Events Format:**
```typescript
[
  {
    "date": "2024-12-15",
    "event": "Kayley mentioned Lena got a new job",
    "sentiment": "positive"
  },
  {
    "date": "2024-12-20",
    "event": "User asked about Lena's promotion",
    "sentiment": "positive"
  }
]
```

---

## Service Functions

### Kayley's Perspective (Global)

#### `getPerson(personKey)`
Get a person from Kayley's life.

```typescript
const person = await getPerson('lena');
// Returns: KayleyPerson {
//   personKey: 'lena',
//   personName: 'Lena Martinez',
//   personRole: 'Best friend from college',
//   relationshipStatus: 'close',
//   currentSituation: [...],
//   kayleyNotes: '...'
// }
```

#### `updatePersonSituation(personKey, event)`
Add an event to a person's current life situation.

```typescript
await updatePersonSituation('lena', 'Got promoted to senior designer');
// Adds to current_situation array and updates last_interaction_date
```

#### `updatePersonStatus(personKey, status)`
Update Kayley's relationship status with a person.

```typescript
await updatePersonStatus('lena', 'close');
// Changes relationship_status field
```

### User's Perspective (Per-User)

#### `getUserPersonRelationship(userId, personKey)`
Get or create a user's relationship with a person. Creates with default scores if doesn't exist.

```typescript
const userRel = await getUserPersonRelationship('user-123', 'lena');
// Returns: UserPersonRelationship {
//   userId: 'user-123',
//   personKey: 'lena',
//   warmthScore: 0,
//   trustScore: 0,
//   familiarityScore: 0,
//   relationshipState: 'unknown',
//   mentionCount: 0,
//   userEvents: []
// }
```

#### `updateUserPersonScores(userId, personKey, changes)`
Update user's warmth/trust/familiarity scores with a person.

Scores are clamped:
- `warmth`: -50 to +50
- `trust`: -50 to +50
- `familiarity`: 0 to 100

```typescript
await updateUserPersonScores('user-123', 'lena', {
  warmthChange: +5,      // User feels more positive about Lena
  trustChange: +3,       // User trusts Lena more
  familiarityChange: +10 // User learned more about Lena
});
```

#### `logUserPersonEvent(userId, personKey, event, sentiment?)`
Log an event in the user's conversation history about a person.

Increments `mention_count` and updates `last_mentioned_at`.

```typescript
await logUserPersonEvent(
  'user-123',
  'lena',
  'Kayley mentioned Lena got promoted',
  'positive'
);
```

### Prompt Integration

#### `formatDynamicRelationshipsForPrompt(userId)`
Format all relationships for system prompt injection.

Shows BOTH perspectives for each person.

```typescript
const prompt = await formatDynamicRelationshipsForPrompt('user-123');
// Returns formatted markdown for prompt
```

**Output Example:**
```markdown
## People in Your Life

These are real people in YOUR life. You have relationships with them that exist independently of any user.

### Lena Martinez
**Who they are:** Best friend from college
**Your relationship:** close
**Recent events:**
  - 2024-12-15: Started new job at design agency
  - 2024-12-20: Got promoted to senior designer
**Your notes:** Lives in Portland, we video chat weekly. Works in design.

**User's perspective:**
- Familiarity: 35/100
- Warmth: +12
- Trust: +8
- Mentioned to user: 3 times
- Relationship state: familiar

**IMPORTANT:**
- These are YOUR real relationships, not the user's
- Share about them naturally based on how much the user knows
- Don't info-dump - let relationships develop organically
- If user asks about someone they don't know, introduce them naturally
```

---

## LLM Tool Integration

### Tool: `manage_dynamic_relationship`

**Available to:** Kayley (the character)
**Purpose:** Manage her relationships with people in her life

**Actions:**
- `update_person_situation` - Add event to person's life
- `update_person_status` - Change relationship status with person
- `update_user_familiarity` - Increase user's knowledge about person
- `log_conversation` - Record conversation about person

**Example Usage (from Kayley's perspective):**

```typescript
// Kayley mentions an update about Lena
Response: "Oh! Lena just got promoted to senior designer!"
Tool Call: manage_dynamic_relationship({
  action: 'update_person_situation',
  person_key: 'lena',
  event: 'Got promoted to senior designer'
})

// Also update user's knowledge
Tool Call: manage_dynamic_relationship({
  action: 'update_user_familiarity',
  person_key: 'lena',
  familiarity_change: +5,
  warmth_change: +2  // User happy for Lena
})

Tool Call: manage_dynamic_relationship({
  action: 'log_conversation',
  person_key: 'lena',
  event: 'Told user about Lena\'s promotion',
  sentiment: 'positive'
})
```

**User asks about someone they don't know:**
```typescript
User: "Who's Lena?"
Response: "Lena? She's my best friend from college! We met freshman year..."

Tool Call: manage_dynamic_relationship({
  action: 'update_user_familiarity',
  person_key: 'lena',
  familiarity_change: +10  // User just learned who Lena is
})

Tool Call: manage_dynamic_relationship({
  action: 'log_conversation',
  person_key: 'lena',
  event: 'Introduced Lena to user',
  sentiment: 'neutral'
})
```

---

## System Prompt Integration

Dynamic relationships are automatically injected into the system prompt via `buildSystemPrompt()`:

```typescript
// In systemPromptBuilder.ts
const dynamicRelationshipsPrompt = await formatDynamicRelationshipsForPrompt(userId);

prompt += `
${KAYLEY_FULL_PROFILE}
${characterFactsPrompt}
${narrativeArcsPrompt}
${dynamicRelationshipsPrompt}  // <-- Injected here
`;
```

This ensures Kayley always knows:
- Who the people in her life are
- What's happening in their lives right now
- How much the current user knows about each person
- How to naturally share about them based on user familiarity

---

## Use Cases

### 1. Progressive Revelation
```
Week 1: "My friend Lena texted me earlier..."
        User familiarity: 5/100 (heard_of)

Week 2: User asks "How's Lena?"
        Kayley: "Oh she's great! She just got promoted..."
        User familiarity: 20/100 (heard_of → familiar)

Week 3: User remembers "Wasn't Lena job hunting?"
        Kayley: "Yeah! She got the senior designer role..."
        User familiarity: 35/100 (familiar)
        User warmth: +12 (invested in Lena's success)
```

### 2. Evolving Situations
```
Week 1: "Lena started job hunting"
        → current_situation: [{date, event: "Looking for new design roles"}]

Week 2: "Lena had an interview at this agency!"
        → Add event: "Interviewed at design agency"

Week 3: "She got the job!"
        → Add event: "Got hired as senior designer"
        → relationship_status stays 'close'
```

### 3. Different Users, Different Knowledge
```
User A (close friend):
  - familiarity: 80/100
  - warmth: +35
  - Knows all about Lena, asks follow-ups

User B (new user):
  - familiarity: 0/100
  - warmth: 0
  - Has never heard of Lena

Kayley adapts:
  - With User A: "Lena finally got that promotion we talked about!"
  - With User B: "My friend Lena - she's a designer in Portland - just got promoted"
```

---

## Design Decisions

### Why Dual Tables?

| Single Table Approach | Dual Table Approach (Chosen) |
|----------------------|------------------------------|
| All data mixed together | Clean separation of concerns |
| Hard to query efficiently | Simple, focused queries |
| Duplicate Kayley data per user | Kayley data stored once |
| Complex user filtering | Natural user-specific view |

### Score Ranges

**Warmth/Trust: -50 to +50 (centered at 0)**
- Mirrors the relationship dimension scores
- Allows for negative feelings (distrust, dislike)
- Zero is neutral starting point

**Familiarity: 0 to 100 (starts at 0)**
- Can't "unknow" someone (no negative)
- Zero means completely unknown
- 100 means knows everything

### Relationship State Auto-Calculation

Automatically determined by trigger based on:
```
unknown    → familiarity = 0
heard_of   → familiarity < 20
familiar   → familiarity < 50
connected  → familiarity >= 50 && warmth > 0
```

**Why auto-calculate?**
- Ensures consistency
- No manual state management
- Always up-to-date based on scores

### Person Key Naming Convention

**Format:** `lowercase_first_name`

**Examples:**
- `lena` - Lena Martinez
- `ethan` - Ethan Adams
- `mom` - Carol Adams
- `sarah` - Sarah (new friend)

**Guidelines:**
- Lowercase, no spaces
- First name only (unless duplicate)
- Descriptive for family (mom, dad, brother)
- Unique identifier for lookups

---

## Integration with Other Services

### Relationship to Character Facts
```
Character Facts:     Emergent details about Kayley
Dynamic Relationships: People in Kayley's life

Character Fact:      "I get excited talking about design"
Dynamic Relationship: Lena (best friend, designer) - can reference in conversations
```

### Relationship to Narrative Arcs
```
Narrative Arcs:      Kayley's ongoing projects/events
Dynamic Relationships: People involved in those events

Narrative Arc:       "Collab video with Sarah"
Dynamic Relationship: Sarah (person_key: 'sarah_creator') - who she's collaborating with
```

### Relationship to Open Loops
```
Open Loops:          Things to follow up with USER
Dynamic Relationships: People to potentially discuss

Open Loop:           "User mentioned they do design work"
Dynamic Relationship: Could mention Lena as connection point
```

---

## Testing

### Manual Test Flow

1. **Initial State (Unknown)**
   ```
   User: "What have you been up to?"
   Kayley: "I was on the phone with Lena earlier..."
   → User familiarity: 0 → 5 (heard_of)
   ```

2. **Progressive Familiarity**
   ```
   User: "Who's Lena?"
   Kayley: "Oh! Lena's my best friend from college. She's a designer..."
   → User familiarity: 5 → 15 (heard_of)
   → User warmth: 0 → +3 (positive interaction)
   ```

3. **Situation Update**
   ```
   Kayley: "Lena just got promoted!"
   → Kayley's current_situation: Add event "Got promoted to senior designer"
   → User familiarity: +10 (learned new info)
   ```

4. **User Engagement**
   ```
   User: "That's awesome! Tell her congrats!"
   → User warmth: +5 (cares about Lena)
   → User familiarity: +5 (deeper engagement)
   → Log event: "User congratulated Lena's promotion" (positive)
   ```

5. **Check Database**
   ```sql
   -- Kayley's perspective
   SELECT * FROM kayley_people WHERE person_key = 'lena';
   -- Should show: current_situation with promotion event

   -- User's perspective
   SELECT * FROM user_person_relationships
   WHERE user_id = 'user-123' AND person_key = 'lena';
   -- Should show: familiarity ~30, warmth ~8, relationship_state = 'familiar'
   ```

---

## Common Patterns

### Pattern 1: First Mention
```typescript
// User has never heard of this person
const userRel = await getUserPersonRelationship(userId, 'lena');
// Creates relationship: familiarity=0, warmth=0, state='unknown'

// Kayley mentions them naturally
await updateUserPersonScores(userId, 'lena', {
  familiarityChange: +5  // User now knows the name
});

await logUserPersonEvent(userId, 'lena', 'First mentioned Lena to user', 'neutral');
```

### Pattern 2: Life Update
```typescript
// Something happens in person's life
await updatePersonSituation('lena', 'Got promoted to senior designer');

// If Kayley tells user about it
await updateUserPersonScores(userId, 'lena', {
  familiarityChange: +8,  // User learned something new
  warmthChange: +3        // Positive news
});

await logUserPersonEvent(userId, 'lena', 'Told user about promotion', 'positive');
```

### Pattern 3: User Shows Interest
```typescript
// User asks follow-up question about person
await updateUserPersonScores(userId, 'lena', {
  familiarityChange: +5,  // User engaged, learned more
  warmthChange: +2        // Asking shows care
});

await logUserPersonEvent(userId, 'lena', 'User asked about Lena\'s new job', 'positive');
```

### Pattern 4: Relationship Shift
```typescript
// Kayley's relationship with person changes
await updatePersonStatus('lena', 'distant');  // Growing apart

// This doesn't affect user's perspective immediately
// But prompt will show: "Your relationship: distant"
// Allowing Kayley to naturally express the change to user
```

---

## Performance Considerations

### Fetching Relationships

**Current:** Fetched during prompt building
```typescript
const dynamicRelPrompt = await formatDynamicRelationshipsForPrompt(userId);
// Queries kayley_people (all rows)
// Queries user_person_relationships (user-specific)
```

**Latency:** ~100-150ms (2 database queries + formatting)

**Optimization:** Could be added to unified context RPC if needed

### Prompt Size

**Typical:** 2-5 people in Kayley's life
**Size per person:** ~200-300 characters
**Total impact:** ~600-1500 characters added to prompt

This is reasonable compared to the full character profile.

---

## Future Enhancements

### Phase 3: Story Retelling
Track which backstory anecdotes Kayley has told to which users:
- "Coffee catastrophe story"
- "Viral video story"
- Ensure consistent retelling

**Table:** `kayley_told_stories`

### Phase 4: Relationship Events
Track specific interactions between Kayley and her people:
- "Had coffee with Lena yesterday"
- "Video call with Mom on Sunday"
- "Ethan visited last weekend"

**Table:** `kayley_relationship_events`

### Phase 5: User Connections
Track connections between user and Kayley's people:
- User meets Lena in real life
- User and Lena work in similar fields
- Shared interests/connections

**Enhancement to:** `user_person_relationships` (add `connection_type` field)

---

## Troubleshooting

### Person not appearing in prompt
1. Check if person exists: `SELECT * FROM kayley_people WHERE person_key = '...'`
2. Check `formatDynamicRelationshipsForPrompt()` is being called
3. Verify prompt building includes dynamic relationships section

### User relationship not updating
1. Check if relationship exists: `SELECT * FROM user_person_relationships WHERE user_id = '...' AND person_key = '...'`
2. Verify `getUserPersonRelationship()` created it
3. Check score changes are within valid ranges
4. Verify trigger is firing for auto-state calculation

### Scores not clamping correctly
1. Check `clampScore()` function is being used
2. Verify database constraints are in place:
   ```sql
   CHECK (warmth_score >= -50 AND warmth_score <= 50)
   CHECK (trust_score >= -50 AND trust_score <= 50)
   CHECK (familiarity_score >= 0 AND familiarity_score <= 100)
   ```

### Relationship state not auto-updating
1. Check trigger exists:
   ```sql
   SELECT * FROM pg_trigger WHERE tgname = 'trigger_update_user_person_state';
   ```
2. Verify function exists:
   ```sql
   SELECT * FROM pg_proc WHERE proname = 'update_user_person_state';
   ```
3. Test trigger manually:
   ```sql
   UPDATE user_person_relationships
   SET familiarity_score = 25
   WHERE user_id = '...' AND person_key = '...';
   -- Should auto-set relationship_state = 'heard_of'
   ```

---

## Summary

**Dynamic Relationships** transform Kayley from having a static list of backstory characters into having **living, evolving relationships** that exist independently across all users. Each user can develop their own unique connection to Kayley's people, creating a more personalized and immersive experience.

**Key Benefits:**
- ✅ Kayley has a **consistent social world** across all users
- ✅ Each user's knowledge **progresses naturally** (stranger → familiar → close)
- ✅ Enables **callbacks** ("How's Lena doing with that job?")
- ✅ Creates **emotional investment** (users care about Kayley's people)
- ✅ Supports **organic revelation** (not info-dumping)

**Integration Points:**
- Database: `kayley_people` + `user_person_relationships` tables
- Service: `dynamicRelationshipsService.ts`
- LLM Tool: `manage_dynamic_relationship`
- Prompt: Injected via `formatDynamicRelationshipsForPrompt()`
