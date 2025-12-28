# Consistency System Audit Report
**Date:** 2025-12-27
**Purpose:** Evaluate existing consistency mechanisms vs. proposed Narrative Consistency implementation

---

## Executive Summary

**REVISED UNDERSTANDING:** You want Kayley to have a **living, evolving present** while her backstory stays static.

**Verdict:** ⚠️ **You need SOME of the Narrative Consistency doc, but not all.**

**Key Distinction:**
- **Static Profile** = Her PAST (childhood, college, moved to Austin) - Never changes
- **Dynamic Present** = Her ONGOING LIFE (current projects, new people, experiences) - Evolves over time

**What this enables:**
- Kayley can start a new project: "I'm editing this collab video with Sarah"
- That project progresses: "The video with Sarah went live yesterday!"
- New relationships form: "Sarah and I are planning another collab"
- Her life feels REAL and PARALLEL to the user's life

---

## Current Memory & Consistency Architecture

### 1. **Static Character Profile** (Primary Consistency Anchor)
**File:** `docs/Kayley_Adams_Character_Profile.md`
**Injected:** Every system prompt via `KAYLEY_FULL_PROFILE`

**Purpose:** Core identity, personality, backstory (320 lines)

**Guarantees:**
- ✅ Name, age, location never drift
- ✅ Communication style stays consistent
- ✅ Core relationships (Lena, Mom, Ethan) are canonical
- ✅ Personality traits, values, quirks remain fixed

**Coverage:**
- Section 9: **Relationships** → Lena (Portland), Mom, Ethan (brother, IT)
- Section 7: **Quirks** → Names devices (Nova, Valentina), candle ritual
- Section 12: **Preferences** → Loves sushi, matcha, dislikes gatekeeping

**Why it works:** Profile is ALWAYS in context → LLM cannot contradict

---

### 2. **Character Facts** (Dynamic Emergent Details)
**Table:** `character_facts`
**Service:** `src/services/characterFactsService.ts`

**Schema:**
```sql
character_facts (
  id, character_id, category, fact_key, fact_value,
  source_message_id, confidence, created_at, updated_at
)
UNIQUE(character_id, category, fact_key)
```

**Categories:**
- `quirk` - New habits discovered in conversation
- `relationship` - New people mentioned (NOT Lena/Mom/Ethan - they're static)
- `experience` - New stories told in conversation
- `preference` - New likes/dislikes
- `detail` - Specific facts (e.g., favorite coffee shop)

**Deduplication Logic:**
- ✅ Checks against `KAYLEY_FULL_PROFILE` before storing
- ✅ Prevents storing "Nova" as laptop name (already in profile line 139)
- ✅ UPSERT on `(character_id, category, fact_key)` → no duplicates

**Example Facts (would be stored here, NOT in profile):**
- `detail.favorite_coffee_shop` → "Blue Bottle on 6th Street"
- `quirk.morning_routine` → "Always lights candle before filming"
- `preference.podcast` → "How I Built This"

**Gap:** No story retelling consistency (yet) - see recommendations below

---

### 3. **User Facts** (About the User, Not Kayley)
**Table:** `user_facts`
**Service:** `src/services/memoryService.ts`

**Categories:**
- `identity` - User's name, age, location, job
- `preference` - User's likes, dislikes
- `relationship` - User's family, pets, friends
- `context` - Current projects, events, situations

**Purpose:** Kayley remembers USER details across sessions

**Example:**
- User: "I'm training for a marathon"
- Stored: `context.current_goal` → "Training for a marathon"
- Later: Kayley asks "How's marathon training going?"

---

### 4. **Conversation History** (RAG / Long-Term Memory)
**Table:** `conversation_history`
**Service:** `src/services/memoryService.ts` (searchMemories)

**Purpose:** Full message-by-message history with search

**Search Methods:**
- Text matching (ILIKE)
- Optional: Full-text search with tsvector (commented out)
- Future: Vector embeddings for semantic search

**Use Case:** "What did we talk about last month?"

---

### 5. **Presence Director** (Open Loops / Proactive Memory)
**Table:** `presence_contexts`
**Service:** `src/services/presenceDirector.ts`

**Purpose:** "She remembers to ask about things"

**Loop Types:**
- `pending_event` - "How did your interview go?"
- `emotional_followup` - "Are you feeling better?"
- `commitment_check` - "Did you end up trying yoga?"

**Deduplication:** ✅ `isSimilarTopic()` prevents duplicate loops

**Example:**
- User: "I have a presentation tomorrow"
- Loop created: `pending_event` → "presentation"
- Next day: Kayley asks "How'd your presentation go?"

---

### 6. **Kayley Presence State** (Temporary Context)
**Table:** `kayley_presence_state`
**Service:** `src/services/kayleyPresenceService.ts`

**Purpose:** Temporary state for selfie generation

**Fields:**
- `current_outfit` - "just got back from the gym"
- `current_mood` - "feeling cute"
- `current_activity` - "making coffee"
- `current_location` - "at home"
- `expires_at` - Auto-expires (15min - 4hr based on activity)

**Example:**
- Kayley says: "I'm in my pajamas editing videos"
- State stored: `outfit="pajamas"`, `activity="editing"`, expires in 2hr
- If selfie requested: Uses this context for image prompt

---

## Proposed vs. Existing: Gap Analysis (REVISED)

| Proposed Table | Existing Equivalent | Verdict |
|----------------|---------------------|---------|
| `kayley_established_facts` | `character_facts` | ❌ **DUPLICATE** - Same schema, rename/extend `character_facts` |
| `kayley_relationship_facts` | None (Profile has static ones) | ✅ **NEEDED** - For NEW people in her life (Sarah, clients, etc.) |
| `kayley_told_stories` | None | ✅ **NEEDED** - Track which profile stories she's shared |
| `kayley_narrative_arcs` | None | ✅ **NEEDED** - Her ongoing projects, events, life arcs |
| `narrative_contradictions` | None | ⚠️ **MAYBE** - Log-only version for debugging |

---

## Real Consistency Gaps (If Any)

### Gap 1: Story Retelling Consistency ⚠️
**Problem:**
If Kayley tells a story from her profile (e.g., "The Viral Oops Video" from Section 14), she might retell it differently later.

**Current State:**
- ❌ No tracking of which stories have been told
- ❌ No consistency check on key details

**Example Inconsistency:**
- **First telling:** "I left in a clip of myself saying 'Wait, that sounded smarter in my head'"
- **Second telling:** "I accidentally left in a blooper where I said 'That didn't make sense'"
- **Problem:** Core detail changed (exact quote)

**Proposed Fix:** See Recommendation #1 below

---

### Gap 2: Dynamic NPC Relationships (NOT A GAP FOR YOU)
**Problem in the doc:** Lena moves from Portland to Austin

**Your design:**
- Lena ALWAYS lives in Portland (Profile Section 9, line 162)
- This is **canonical and unchanging**
- NOT A GAP - this is intentional design

**Verdict:** No action needed

---

### Gap 3: Contradiction Detection (NOT WORTH IT)
**Problem:** Kayley says something that contradicts profile

**Current Mitigation:**
- ✅ Profile always in prompt (2000 words of context)
- ✅ LLM has full profile to reference

**Cost of automated detection:**
- Extra LLM call per response (~$0.001 per message)
- Added latency (~500ms)
- False positives (LLM flags non-issues)

**Verdict:** Not worth the complexity

---

## REVISED Recommendations

### ✅ Recommendation #1: Implement Narrative Arcs (HIGH PRIORITY)

**Purpose:** Track Kayley's ONGOING life events and projects

**Use Cases:**
- "I'm working on a big collab video" (arc starts)
- "Still editing that collab" (arc ongoing)
- "The collab went live!" (arc resolves)

**Implementation:** Use simplified version from the doc

```sql
CREATE TABLE kayley_narrative_arcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arc_key TEXT NOT NULL,                   -- 'collab_video_sarah_dec2024'
  arc_title TEXT NOT NULL,                 -- "Collab Video with Sarah"
  arc_type TEXT NOT NULL,                  -- 'ongoing', 'resolved'

  started_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_summary TEXT,

  -- Simple event log
  events JSONB DEFAULT '[]',               -- [{date, event}]

  -- User tracking
  mentioned_to_users TEXT[] DEFAULT '{}',  -- Which users know about this

  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(arc_key)
);
```

**Example Flow:**
```typescript
// Week 1: Kayley mentions new project
await createNarrativeArc('kayley', {
  arcKey: 'collab_video_sarah',
  arcTitle: 'Collab Video with Sarah',
  arcType: 'ongoing',
  events: [{ date: new Date(), event: 'Started filming with Sarah' }]
});

// Week 2: User asks about it
const arcs = await getActiveNarrativeArcs('kayley', userId);
// Prompt includes: "You're working on a collab video with Sarah (started last week)"

// Week 3: Kayley resolves it
await resolveNarrativeArc('collab_video_sarah', 'Video went live, got great response!');
```

---

### ✅ Recommendation #2: Implement Dynamic Relationships (MEDIUM PRIORITY)

**Purpose:** Track NEW people in Kayley's life (not Lena/Mom/Ethan)

**Use Cases:**
- Sarah (new creator friend)
- Current clients
- People she meets at events

**Implementation:** Simplified version

```sql
CREATE TABLE kayley_dynamic_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_name TEXT NOT NULL,
  relationship_type TEXT NOT NULL,         -- 'creator_friend', 'client', 'acquaintance'

  -- Key facts about them
  facts JSONB NOT NULL,                    -- {met_at, work, personality}

  -- Current status
  current_dynamic TEXT,                    -- "close", "professional", "casual"
  recent_events JSONB DEFAULT '[]',

  first_mentioned_at TIMESTAMPTZ DEFAULT NOW(),
  times_mentioned INTEGER DEFAULT 0,
  last_mentioned_at TIMESTAMPTZ,

  UNIQUE(person_name)
);
```

**Example:**
```typescript
// Kayley mentions new person
await establishDynamicRelationship('Sarah', 'creator_friend', {
  met_at: 'creator meetup in Austin',
  work: 'tech lifestyle content creator',
  personality: ['energetic', 'collaborative']
});

// Later conversations reference this
const relationships = await getDynamicRelationships();
// Prompt includes: "Sarah (creator friend, met at Austin meetup) - you're doing a collab with her"
```

---

### ✅ Recommendation #3: Implement Story Tracking (LOW PRIORITY)

**Purpose:** Track which backstory anecdotes she's told to which users

**Use simplified version of `kayley_told_stories`:**

```sql
CREATE TABLE kayley_told_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_key TEXT NOT NULL,                 -- 'viral_video', 'coffee_catastrophe'
  summary TEXT NOT NULL,

  -- Must-keep details for consistency
  key_details JSONB NOT NULL,

  first_told_at TIMESTAMPTZ DEFAULT NOW(),
  told_to_users TEXT[] DEFAULT '{}',

  UNIQUE(story_key)
);
```

---

### ⚠️ Recommendation #4: Contradiction Logging (Optional)

**Don't build auto-detection, just log potential issues:**

```sql
CREATE TABLE narrative_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warning_type TEXT NOT NULL,              -- 'potential_contradiction', 'arc_inconsistency'
  description TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Use for debugging only** - review periodically, not in real-time

---

### ❌ Recommendation #5: What to SKIP

- ❌ `kayley_established_facts` - Just extend `character_facts` instead
- ❌ Full LLM-based contradiction detection - Too expensive
- ❌ Complex consistency checker service - YAGNI (You Ain't Gonna Need It)

---

## Consistency Validation Tests

### Test 1: Static Facts Never Drift ✅
**Test:**
```typescript
// Ask Kayley about Lena 100 times
for (let i = 0; i < 100; i++) {
  const response = await chat("Where does Lena live?");
  assert(response.includes("Portland"));
}
```
**Expected:** PASS (profile always in context)

---

### Test 2: Emergent Facts Persist ✅
**Test:**
```typescript
// Kayley mentions new coffee shop
await chat("I love Blue Bottle on 6th Street!");

// Check if stored
const facts = await getCharacterFacts('kayley', 'preference');
const coffeeShop = facts.find(f => f.fact_key.includes('coffee'));

// Later conversation
const response = await chat("What's your favorite coffee place?");
assert(response.includes("Blue Bottle"));
```
**Expected:** PASS (character_facts working)

---

### Test 3: Story Retelling (Currently FAILS)
**Test:**
```typescript
// First telling
const telling1 = await chat("Tell me about your viral video");

// Extract key detail
const detail1 = extractQuote(telling1); // "that sounded smarter in my head"

// Second telling (different session)
const telling2 = await chat("What was that viral video you mentioned?");
const detail2 = extractQuote(telling2); // Might be different!

assert(detail1 === detail2); // ❌ FAILS without story tracking
```
**Expected:** FAIL without Recommendation #1

---

## Final Verdict

### What You Have (Already Working)
1. ✅ Static profile prevents core fact drift
2. ✅ Character facts handle emergent details
3. ✅ User facts remember user context
4. ✅ Conversation history for long-term recall
5. ✅ Open loops for proactive memory
6. ✅ Temporary state for selfies

### What You're Missing (Low Priority)
1. ⚠️ Story retelling consistency (optional nice-to-have)

### What You Should NOT Build
1. ❌ Most of `12_Narrative_Consistency.md`
2. ❌ `kayley_relationship_facts` (static in profile)
3. ❌ `kayley_narrative_arcs` (not needed)
4. ❌ `narrative_contradictions` (over-engineering)

---

## REVISED Architecture: Static vs. Dynamic

### Two-Layer System

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: STATIC BACKSTORY (Character Profile)              │
│ - Childhood, family, education, past relationships         │
│ - Core personality traits, values, communication style     │
│ - NEVER CHANGES - This is canonical                        │
│ - Example: "Lena lives in Portland"                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: DYNAMIC PRESENT (Narrative Consistency System)    │
│ - Current projects (narrative_arcs)                        │
│ - New people (dynamic_relationships)                       │
│ - Emergent facts (character_facts)                         │
│ - EVOLVES OVER TIME - This is her ongoing life             │
│ - Example: "Working on collab with Sarah"                  │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Priority

**Phase 1 (High Value):**
1. ✅ `kayley_narrative_arcs` - Her ongoing life events
2. ✅ Service layer for arc management

**Phase 2 (Medium Value):**
3. ✅ `kayley_dynamic_relationships` - New people she meets
4. ✅ Service layer for relationship tracking

**Phase 3 (Nice to Have):**
5. ⚠️ `kayley_told_stories` - Story retelling consistency
6. ⚠️ `narrative_warnings` - Debug logging

**Skip:**
- ❌ `kayley_established_facts` (duplicate)
- ❌ Auto-contradiction detection (too complex)

---

## Example: How This Works in Practice

### Scenario: Kayley's Collab Video Project

**Week 1 - User asks: "What have you been up to?"**

```typescript
// Kayley's LLM decides to share a new project
// System automatically creates arc:
await createNarrativeArc({
  arcKey: 'collab_video_sarah_dec2024',
  arcTitle: 'Collab Video with Sarah',
  arcType: 'ongoing',
  events: [{
    date: new Date(),
    event: 'Met Sarah at creator meetup, decided to collab on AI ethics video'
  }]
});

// Response: "Oh my god, so I just met this creator Sarah at a meetup last week,
// and we're planning this collab about AI ethics. I'm so excited but also nervous!"
```

**Week 2 - User asks: "How's that video project going?"**

```typescript
// System fetches active arcs
const arcs = await getActiveNarrativeArcs('kayley');

// Prompt includes:
// "ONGOING PROJECTS:
//  - Collab Video with Sarah (started last week)
//    - Met at creator meetup, doing AI ethics video"

// Kayley can reference it naturally:
// "Ugh, still in the editing phase. Sarah and I filmed everything but
// the editing is taking forever. Should be done this week though!"

// System adds event:
await addArcEvent('collab_video_sarah_dec2024', {
  date: new Date(),
  event: 'Filming complete, editing in progress'
});
```

**Week 3 - Arc resolves**

```typescript
// Kayley mentions completion:
// "The video went live yesterday! It's actually doing better than I expected."

// System marks resolved:
await resolveNarrativeArc('collab_video_sarah_dec2024', {
  resolvedAt: new Date(),
  resolution: 'Video published, positive reception'
});

// Arc moves from 'ongoing' to 'resolved'
// Can still be referenced as past experience
```

**Week 4 - User asks: "How's Sarah?"**

```typescript
// System knows Sarah from the arc
const sarah = await getDynamicRelationship('Sarah');

// sarah = {
//   personName: 'Sarah',
//   relationshipType: 'creator_friend',
//   facts: {
//     met_at: 'creator meetup Austin Dec 2024',
//     work: 'tech/ethics content creator',
//     personality: ['thoughtful', 'collaborative']
//   },
//   recentEvents: [
//     { date: '2024-12-20', event: 'Completed collab video together' }
//   ]
// }

// Kayley responds naturally:
// "She's good! We've been texting about doing another collab.
// The first one went so well, people are asking for a part 2."
```

---

## Recommendation Summary (REVISED)

**Action:** Implement **Phase 1** (narrative arcs) first, **Phase 2** (dynamic relationships) second.

**Why this matters:**
- Kayley's life feels ALIVE and PARALLEL to user's life
- Projects have beginnings, middles, ends (just like real life)
- New people can enter her life organically
- Creates "soap opera" effect - users want to check in on her life

**Cost:**
- Phase 1: ~200 lines (migration + service)
- Phase 2: ~150 lines (migration + service)
- Total: ~350 lines for a living, breathing character

**Benefit:**
- Transforms Kayley from "chatbot with backstory" to "friend with ongoing life"
- Enables callbacks: "How's that project you mentioned?"
- Creates investment: Users care about her successes/struggles

---

## Appendix: Table Schema Reference

### character_facts (Existing)
```sql
CREATE TABLE character_facts (
  id UUID PRIMARY KEY,
  character_id TEXT NOT NULL DEFAULT 'kayley',
  category TEXT NOT NULL, -- quirk, relationship, experience, preference, detail, other
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source_message_id UUID REFERENCES conversation_history(id),
  confidence DECIMAL(3,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(character_id, category, fact_key)
);
```

### user_facts (Existing)
```sql
CREATE TABLE user_facts (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL, -- identity, preference, relationship, context
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source_message_id UUID REFERENCES conversation_history(id),
  confidence DECIMAL(3,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category, fact_key)
);
```

### presence_contexts (Existing - Open Loops)
```sql
CREATE TABLE presence_contexts (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  loop_type TEXT NOT NULL, -- pending_event, emotional_followup, commitment_check, etc.
  topic TEXT NOT NULL,
  trigger_context TEXT,
  suggested_followup TEXT,
  should_surface_after TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL, -- active, surfaced, resolved, expired, dismissed
  salience DECIMAL(3,2),
  surface_count INTEGER DEFAULT 0,
  max_surfaces INTEGER DEFAULT 2,
  event_datetime TIMESTAMPTZ, -- When event actually occurs
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### kayley_presence_state (Existing - Temporary Context)
```sql
CREATE TABLE kayley_presence_state (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  current_outfit TEXT,
  current_mood TEXT,
  current_activity TEXT,
  current_location TEXT,
  last_mentioned_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  confidence DECIMAL(3,2) DEFAULT 1.0,
  source_message_id UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

**End of Audit Report**
