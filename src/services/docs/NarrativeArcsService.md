# Narrative Arcs Service

**File:** `src/services/narrativeArcsService.ts`
**Table:** `kayley_narrative_arcs`
**Purpose:** Track Kayley's ongoing life events, projects, and experiences to give her a "living present" that evolves over time

---

## Overview

The Narrative Arcs Service manages Kayley's **dynamic, evolving life** - separate from her static backstory. This allows her to:
- Start new projects ("Working on a collab video with Sarah")
- Track progress over time ("Still editing that video...")
- Complete or abandon things ("The video went live!")
- Have an ongoing life that users can check in on weeks later

### Key Concept: Static vs. Dynamic

```
┌─────────────────────────────────────────┐
│ STATIC (Character Profile)              │
│ - Childhood, family, education          │
│ - Core personality, values              │
│ - Past relationships (Lena, Mom, Ethan) │
│ - NEVER CHANGES                         │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ DYNAMIC (Narrative Arcs)                │
│ - Current projects                      │
│ - Ongoing challenges                    │
│ - New people she meets                  │
│ - Life events in progress               │
│ - EVOLVES OVER TIME                     │
└─────────────────────────────────────────┘
```

---

## Table Schema

```sql
CREATE TABLE kayley_narrative_arcs (
  id UUID PRIMARY KEY,
  arc_key TEXT NOT NULL UNIQUE,           -- e.g., 'collab_sarah_dec2024'
  arc_title TEXT NOT NULL,                -- e.g., "Collab Video with Sarah"
  arc_type TEXT NOT NULL,                 -- 'ongoing', 'resolved', 'paused', 'abandoned'

  started_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_summary TEXT,

  events JSONB DEFAULT '[]',              -- [{date, event}]
  mentioned_to_users TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Arc Types:**
- `ongoing` - Currently happening
- `resolved` - Finished successfully
- `paused` - On hold
- `abandoned` - Gave up / didn't work out

---

## Service Functions

### Core Operations

#### `createNarrativeArc(params)`
Create a new arc when Kayley starts something.

```typescript
await createNarrativeArc({
  arcKey: 'collab_sarah_dec2024',
  arcTitle: 'Collab Video with Sarah',
  initialEvent: 'Met Sarah at creator meetup, planning AI ethics video',
  userId: 'user-123'  // User who first heard about this
});
```

#### `addArcEvent(arcKey, params)`
Add a progress update to an existing arc.

```typescript
await addArcEvent('collab_sarah_dec2024', {
  event: 'Filming complete, editing in progress'
});
```

#### `resolveArc(arcKey, params)`
Mark an arc as completed.

```typescript
await resolveArc('collab_sarah_dec2024', {
  resolutionSummary: 'Video published, got great response'
});
```

#### `abandonArc(arcKey, reason)`
Mark an arc as abandoned.

```typescript
await abandonArc('client_project_oct', 'Client ghosted, moved on');
```

### Query Functions

#### `getOngoingArcs(userId?)`
Get all currently active arcs.

```typescript
const ongoingArcs = await getOngoingArcs('user-123');
// Returns only arcs this user knows about
```

#### `getAllArcs(options)`
Get arcs with filtering.

```typescript
const resolvedArcs = await getAllArcs({
  arcType: 'resolved',
  userId: 'user-123',
  limit: 10
});
```

### Prompt Integration

#### `formatArcsForPrompt(userId?)`
Format arcs for system prompt injection.

```typescript
const arcsPrompt = await formatArcsForPrompt('user-123');
// Returns formatted markdown for prompt
```

**Output Example:**
```markdown
## Your Current Life (Ongoing Projects & Events)

### Collab Video with Sarah
- **Started:** 2 weeks ago
- **Progress:**
  - 2 weeks ago: Met at meetup, planning AI ethics video
  - 1 week ago: Filming complete, editing in progress
  - 3 days ago: Final edits done, scheduling release
```

---

## LLM Tool Integration

### Tool: `manage_narrative_arc`

**Available to:** Kayley (the character)
**Purpose:** Manage her own life events

**Actions:**
- `create` - Start a new arc
- `update` - Add progress
- `resolve` - Mark as complete
- `abandon` - Give up on it

**Example Usage (from Kayley's perspective):**

```typescript
// Kayley mentions starting a project
Response: "Oh my god, I just started this collab with Sarah!"
Tool Call: manage_narrative_arc({
  action: 'create',
  arc_key: 'collab_sarah_dec2024',
  arc_title: 'Collab Video with Sarah',
  initial_event: 'Met at meetup, planning AI ethics video'
})

// Week later, user asks: "How's the video?"
Response: "Still editing! It's taking forever."
Tool Call: manage_narrative_arc({
  action: 'update',
  arc_key: 'collab_sarah_dec2024',
  event: 'Editing in progress, slower than expected'
})

// Week after, Kayley shares completion
Response: "The video went live yesterday! Doing better than expected."
Tool Call: manage_narrative_arc({
  action: 'resolve',
  arc_key: 'collab_sarah_dec2024',
  resolution: 'Video published, positive reception'
})
```

---

## System Prompt Integration

Narrative arcs are automatically injected into the system prompt via `buildSystemPrompt()`:

```typescript
// In systemPromptBuilder.ts
const narrativeArcsPrompt = await formatArcsForPrompt(userId);

prompt += `
${KAYLEY_FULL_PROFILE}
${characterFactsPrompt}
${narrativeArcsPrompt}  // <-- Injected here
`;
```

This ensures Kayley always knows about her ongoing life events when responding.

---

## Use Cases

### 1. Ongoing Projects
```
Week 1: "I'm working on redesigning my YouTube thumbnail template"
Week 2: "Still tweaking those thumbnails... color palette is hard"
Week 3: "Finally happy with the new thumbnail style!"
```

### 2. Personal Challenges
```
Week 1: "I'm trying to be better about taking breaks from screens"
Week 2: "The screen time thing is... not going great. Too much work to do"
Week 3: "Actually abandoned the strict screen limits - too stressful"
```

### 3. Life Events
```
Week 1: "My friend Lena is visiting from Portland next weekend!"
Week 2: "Lena's here! We've been exploring all my favorite Austin spots"
Week 3: "Lena left yesterday. Apartment feels so quiet now"
```

---

## Design Decisions

### Why Arcs vs. Facts?

| Character Facts | Narrative Arcs |
|----------------|----------------|
| **Static details** (plant name, favorite coffee) | **Evolving stories** (projects, goals) |
| No timeline | Has beginning, middle, end |
| Single piece of info | Series of events |
| Example: "Plant named Fernando" | Example: "Training for 5K" → progress → completion |

### Arc Key Naming Convention

**Format:** `topic_person_timeframe`

**Examples:**
- `collab_sarah_dec2024`
- `client_project_nova_oct`
- `5k_training_fall2024`
- `apartment_hunting_austin`

**Guidelines:**
- Unique and descriptive
- Include topic for clarity
- Include person if relevant (collab, client, etc.)
- Include timeframe (month/season/year)
- Use underscores, lowercase

### User Tracking

**Field:** `mentioned_to_users` (array)

**Purpose:** Track which users know about which arcs

**Why?**
- User A knows about "collab with Sarah"
- User B has never heard of it
- Don't confuse users by mentioning arcs they haven't heard about

**How it works:**
```typescript
// When creating arc, mark user who first heard about it
await createNarrativeArc({
  arcKey: 'collab_sarah',
  arcTitle: 'Collab with Sarah',
  userId: 'user-a'  // User A now knows about this
});

// When another user asks about Kayley's life
const arcs = await getOngoingArcs('user-b');
// Won't include 'collab_sarah' since user-b hasn't heard about it yet
```

---

## Integration with Other Services

### Relationship to Character Facts
```
Character Facts:     Static emergent details
Narrative Arcs:      Dynamic ongoing stories

Character Fact:      "favorite_coffee_shop = Blue Bottle"
Narrative Arc:       "Started going to new coffee shop, comparing it to old favorite"
```

### Relationship to Open Loops (Presence Director)
```
Open Loops:          Things to ASK user about (their life)
Narrative Arcs:      Things in KAYLEY's life (her life)

Open Loop:           "User mentioned presentation" → "How did it go?"
Narrative Arc:       "I'm working on collab video" → progress → resolution
```

### Relationship to Ongoing Threads
```
Ongoing Threads:     Kayley's mental/emotional state (mood, thoughts)
Narrative Arcs:      Kayley's life events and projects

Ongoing Thread:      "Feeling anxious about deadlines"
Narrative Arc:       "Big client project with tight deadline" (what's causing the thread)
```

---

## Testing

### Manual Test Flow

1. **Start Conversation**
   ```
   User: "What have you been up to?"
   Kayley: "Oh! I just started working on this collab video with Sarah"
   → Arc created: collab_sarah_dec2024
   ```

2. **Week Later**
   ```
   User: "How's that Sarah project?"
   Kayley: "Ugh, still editing. Taking forever!"
   → Arc updated with event
   ```

3. **Week After**
   ```
   Kayley: "The video went live yesterday! It's doing better than I thought"
   → Arc resolved
   ```

4. **Check Database**
   ```sql
   SELECT * FROM kayley_narrative_arcs WHERE arc_key = 'collab_sarah_dec2024';
   -- Should show: arc_type = 'resolved', events array with 3+ entries
   ```

---

## Common Patterns

### Pattern 1: Project Arc
```typescript
// Start
create('project_x', 'New Project X', 'Kicked off planning meeting')

// Middle
update('project_x', 'Design phase complete')
update('project_x', 'Development started')
update('project_x', 'Hit a blocker with API integration')

// End
resolve('project_x', 'Launched successfully, users love it')
```

### Pattern 2: Abandoned Arc
```typescript
// Start
create('side_hustle', 'Side Hustle Idea', 'Researching print-on-demand')

// Struggle
update('side_hustle', 'Market is more saturated than expected')
update('side_hustle', 'Costs higher than budgeted')

// Give Up
abandon('side_hustle', 'Not viable, moving on to other ideas')
```

### Pattern 3: Paused Arc
```typescript
// Start
create('book_writing', 'Writing a Book', 'Started outline for creator guide')

// Pause
pauseArc('book_writing')  // Too busy right now

// Later resume
resumeArc('book_writing')
update('book_writing', 'Back to writing! Finished chapter 1')
```

---

## Performance Considerations

### Fetching Arcs

**Current:** Fetched in parallel with character facts
```typescript
const [characterFacts, narrativeArcs] = await Promise.all([
  formatCharacterFactsForPrompt(),
  formatArcsForPrompt(userId)
]);
```

**Latency:** ~50-100ms (database query + formatting)

**Caching:** Not cached (arcs can change frequently)

### Prompt Size

**Typical arc count:** 1-3 ongoing arcs per user
**Size per arc:** ~100-200 characters
**Total impact:** ~200-600 characters added to prompt

This is negligible compared to the full character profile (~8000 characters).

---

## Future Enhancements

### Phase 2: Dynamic Relationships
Track NEW people in Kayley's life (not Lena/Mom/Ethan):
- Sarah (creator friend)
- Clients
- People met at events

**Table:** `kayley_dynamic_relationships`

### Phase 3: Story Retelling
Track which backstory anecdotes she's told to which users:
- "Viral video story"
- "Coffee catastrophe"
- Ensure consistent retelling

**Table:** `kayley_told_stories`

---

## Troubleshooting

### Arc not appearing in prompt
1. Check if arc exists: `SELECT * FROM kayley_narrative_arcs WHERE arc_key = '...'`
2. Check arc_type is 'ongoing'
3. Check user is in `mentioned_to_users` array
4. Check `formatArcsForPrompt()` is being called

### Tool call fails
1. Check arc_key is correct
2. For update/resolve/abandon: Arc must exist
3. For create: arc_key must be unique
4. Check required parameters are provided

### Duplicate arcs
1. Use unique arc_keys (include timeframe)
2. Check if arc exists before creating:
   ```typescript
   const existing = await getNarrativeArc(arcKey);
   if (existing) { /* update instead */ }
   ```

---

## Summary

**Narrative Arcs** transform Kayley from a chatbot with a static backstory into a character with an ongoing, evolving life. Users can check in on her projects, celebrate her wins, and empathize with her struggles - creating deeper, more meaningful relationships.

**Key Benefits:**
- ✅ Kayley feels **alive** and **autonomous**
- ✅ Creates **continuity** across conversations
- ✅ Enables **callbacks** ("How's that thing you mentioned?")
- ✅ Builds **investment** (users care about her life)

**Integration Points:**
- Database: `kayley_narrative_arcs` table
- Service: `narrativeArcsService.ts`
- LLM Tool: `manage_narrative_arc`
- Prompt: Injected via `buildSystemPrompt()`
