# Storyline Service

**File:** `src/services/storylineService.ts`
**Tables:** `life_storylines`, `storyline_updates`
**Purpose:** Transform life events into living storylines with emotional arcs, phase progression, and meaningful closure

## Implementation Status

### Phase 1: Data Foundation ✅ COMPLETED
- ✅ TypeScript types and interfaces
- ✅ Database tables (`life_storylines`, `storyline_updates`)
- ✅ Core CRUD functions
- ✅ Data migration from `life_events`
- ⏳ Tests deferred to Phase 6

### Phase 2: Phase Progression ✅ COMPLETED
- ✅ Automatic phase transitions (time-based with probability)
- ✅ On-startup processing (checks for missed days)
- ✅ LLM update generation (Gemini integration)
- ✅ Time-based progression rules (CST timezone)
- ✅ Phase behaviors configuration (8 phases)
- ✅ Database tracking (`storyline_config` table)

**Processing Model:**
- Storylines progress based on **calendar days** (not app runtime)
- On app startup, checks days since last process (in CST)
- Processes any missed days automatically
- Phase transitions and updates happen on startup

### Phase 3: Emotional Integration ✅ COMPLETED
- ✅ Mood system integration (`moodKnobs.ts`)
- ✅ Storyline mood effects calculation (`getStorylineMoodEffects()`)
- ✅ Energy and mood delta application
- ✅ Preoccupation calculation

**Integration Points:**
- `getStorylineMoodEffects()` calculates mood/energy impact from active storylines
- `getMoodAsync()` in moodKnobs.ts applies storyline effects to base mood
- Effects are cumulative across all active storylines
- Stressful phases (reality, active, climax) drain energy

### Phase 4: Prompt Integration ✅ COMPLETED
- ✅ System prompt injection (2nd user message only)
- ✅ Storyline context builder
- ✅ Mention detection and tracking

### Phase 5: Closure & Callbacks ✅ COMPLETED
- ✅ Resolution flow
- ✅ Closure sequences
- ✅ Historical callbacks
- ✅ Character facts integration

### Phase 6: Polish & Testing ⏳ NOT IMPLEMENTED
- ⏳ End-to-end testing
- ⏳ Manual conversation testing
- ⏳ Probability tuning

**Current State:** Phase 1-3 complete. Storylines automatically progress through phases, generate updates, and affect Kayley's mood/energy. Phase 4 will make Kayley talk about storylines in conversation.

---

## Overview

The Storyline Service transforms point-in-time life events into **living storylines** that:

1. **Progress naturally** through phases over days/weeks
2. **Affect Kayley's mood** based on storyline status
3. **Surface organically** in conversation
4. **Resolve meaningfully** with emotional closure
5. **Become part of history** for later reference

### The Problem This Solves

**Before:** Life events are announcements that disappear.
```
Kayley: "A brand reached out about a partnership!"
[User never hears about it again]
```

**After:** Life events become storylines with arcs.
```
Day 1: "A brand reached out! I'm shaking!"
Day 6: "The contract is... a lot. Not sure about this."
Day 14: "We found a compromise. Feeling better."
Day 20: "I SIGNED IT. It's official!"
Day 50: "Remember when I was freaking out about that brand deal?"
```

---

## Two-Table Architecture

> **IMPORTANT:** This section explains the fundamental design of the storyline system. Do not remove when implementing future phases.

### The Two Tables

The storyline system uses **two related tables** to model life events as ongoing stories:

1. **`life_storylines`** - The main storyline record (parent)
2. **`storyline_updates`** - Individual progress updates (children)

Think of it like a book and its chapters:
- `life_storylines` = The book itself (title, current state, metadata)
- `storyline_updates` = The chapters/events within the book

### Relationship: One-to-Many

```
life_storylines (1)
    ↓
    ├─ storyline_updates (many)
    ├─ storyline_updates
    ├─ storyline_updates
    └─ storyline_updates
```

**Database relationship:**
- `storyline_updates.storyline_id` → foreign key to `life_storylines.id`
- Cascading delete: Deleting a storyline automatically deletes all its updates

### Example: Brand Partnership Storyline

**One row in `life_storylines`:**
```typescript
{
  id: "uuid-123",
  title: "Brand Partnership Opportunity",
  category: "work",
  phase: "climax",  // ← Current phase
  currentEmotionalTone: "anxious",
  emotionalIntensity: 0.8,
  outcome: null,  // ← Still active
  createdAt: "2026-01-10",
}
```

**Multiple rows in `storyline_updates`:**
```typescript
// Update 1 (Day 3)
{
  id: "update-1",
  storyline_id: "uuid-123",  // ← Links to parent
  content: "They sent over the contract - it's more than I expected!",
  emotionalTone: "thrilled",
  mentioned: false,  // ← Kayley hasn't told user yet
  createdAt: "2026-01-12",
}

// Update 2 (Day 7)
{
  id: "update-2",
  storyline_id: "uuid-123",  // ← Same parent
  content: "Had the kickoff call today. They want to start next week!",
  emotionalTone: "excited",
  mentioned: false,
  createdAt: "2026-01-15",
}
```

### When Each Table Gets Modified

#### Creating a New Storyline
**Tables affected:** `life_storylines` only
```typescript
await createStoryline({
  title: "Brand Partnership Opportunity",
  category: "work",
  // ...
});
// Result: 1 new row in life_storylines
```

#### Storyline Progresses (Phase 2)
**Tables affected:** Both tables
```typescript
// On app startup, processStorylineDay() runs:
await checkPhaseTransitions();  // Updates life_storylines.phase
const update = await generateStorylineUpdate(storyline);  // Inserts into storyline_updates

// Result:
// - life_storylines: phase field updated
// - storyline_updates: new row inserted
```

#### Kayley Mentions Update (Phase 4)
**Tables affected:** `storyline_updates` only
```typescript
await markUpdateAsMentioned(updateId);
// Result: storyline_updates.mentioned set to true
```

#### Storyline Resolves
**Tables affected:** `life_storylines` only
```typescript
await resolveStoryline(storylineId, {
  outcome: "success",
  outcomeDescription: "Signed the deal!",
});
// Result: life_storylines.outcome, resolvedAt fields set
// storyline_updates kept for history
```

### How the LLM Interacts

**Critical concept:** The LLM **never directly touches the database**. All database operations are handled by application code in `storylineService.ts`.

#### LLM's Limited Interaction Points:

**1. Generating Update Content (Phase 2)**
```typescript
// Application calls LLM to generate update text
const updateContent = await geminiChat([...]);

// Then application stores it:
await addStorylineUpdate(storyline.id, {
  content: updateContent,  // ← LLM generated this text
  emotionalTone: "excited",
  updateType: "progress",
});
```
**What the LLM does:** Generates realistic update text based on phase and context
**What the application does:** Stores that text in `storyline_updates` table

**2. Reading Storyline Context (Phase 4 - Not Yet Implemented)**
```typescript
// Application builds prompt context
const context = await getStorylinePromptContext();

// System prompt includes:
/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT'S HAPPENING IN YOUR LIFE (Active Storylines)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Brand Partnership Opportunity** (work)
Phase: climax | Feeling: anxious

📍 Recent development: "They sent over the contract!"
   You haven't mentioned this yet. Share it if it feels natural.
*/
```
**What the LLM does:** Reads storyline context from prompt, decides whether to mention storylines
**What the LLM does NOT do:** Query database, create/update storylines, know about table structure

### Complete Lifecycle Example

```
DAY 1: Storyline Created
┌────────────────────────────────────────┐
│ life_storylines                        │
├────────────────────────────────────────┤
│ title: "Brand Partnership"             │
│ phase: "announced"                     │
│ outcome: null (active)                 │
└────────────────────────────────────────┘
storyline_updates: (empty)


DAY 3: Phase Transition + Update Generated
┌────────────────────────────────────────┐
│ life_storylines                        │
├────────────────────────────────────────┤
│ phase: "honeymoon" ← UPDATED           │
└────────────────────────────────────────┘
┌────────────────────────────────────────┐
│ storyline_updates                      │
├────────────────────────────────────────┤
│ content: "Contract arrived!"  ← NEW    │
│ mentioned: false                       │
└────────────────────────────────────────┘


DAY 4: Kayley Mentions Update (Phase 4)
┌────────────────────────────────────────┐
│ storyline_updates                      │
├────────────────────────────────────────┤
│ mentioned: true ← UPDATED              │
└────────────────────────────────────────┘


DAY 10: Storyline Resolved
┌────────────────────────────────────────┐
│ life_storylines                        │
├────────────────────────────────────────┤
│ phase: "resolved"                      │
│ outcome: "success" ← UPDATED           │
│ resolvedAt: "2026-01-20" ← UPDATED     │
└────────────────────────────────────────┘
storyline_updates: (kept for history)
```

### Key Takeaways

1. **`life_storylines`** = Main record (one per storyline, stores current state)
2. **`storyline_updates`** = Progress events (many per storyline, stores developments)
3. **The LLM never touches the database** - it only:
   - Generates update text (Phase 2)
   - Reads storyline context from prompts (Phase 4)
4. **The application code** (`storylineService.ts`) handles all CRUD operations
5. **Foreign key relationship:** Updates link to storylines via `storyline_id`
6. **Updates are preserved for history** even after storyline resolves

---

## Table Schemas

### `life_storylines`

Stores the main storyline records.

```sql
CREATE TABLE life_storylines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core identity
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('work', 'personal', 'family', 'social', 'creative')),
  storyline_type TEXT NOT NULL CHECK (storyline_type IN ('project', 'opportunity', 'challenge', 'relationship', 'goal')),

  -- Current state
  phase TEXT NOT NULL DEFAULT 'announced' CHECK (phase IN ('announced', 'honeymoon', 'reality', 'active', 'climax', 'resolving', 'resolved', 'reflecting')),
  phase_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Emotional texture
  current_emotional_tone TEXT,
  emotional_intensity FLOAT NOT NULL DEFAULT 0.7 CHECK (emotional_intensity >= 0 AND emotional_intensity <= 1),

  -- Outcome tracking
  outcome TEXT CHECK (outcome IN ('success', 'failure', 'abandoned', 'transformed', 'ongoing') OR outcome IS NULL),
  outcome_description TEXT,
  resolution_emotion TEXT,

  -- Mention tracking
  times_mentioned INTEGER NOT NULL DEFAULT 0,
  last_mentioned_at TIMESTAMPTZ,
  should_mention_by TIMESTAMPTZ,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,

  -- Metadata
  initial_announcement TEXT,
  stakes TEXT,
  user_involvement TEXT
);

CREATE INDEX idx_storylines_active ON life_storylines(phase) WHERE outcome IS NULL;
CREATE INDEX idx_storylines_mention ON life_storylines(should_mention_by) WHERE outcome IS NULL;
CREATE INDEX idx_storylines_created_at ON life_storylines(created_at DESC);
```

**Key Fields:**
- `phase` - Current storyline phase (announced → honeymoon → reality → active → climax → resolving → resolved → reflecting)
- `emotional_intensity` - How much this affects Kayley (0.0 to 1.0)
- `outcome` - How it resolved (success/failure/abandoned/transformed) or NULL if ongoing
- `times_mentioned` - How many times Kayley has talked about this
- `should_mention_by` - Soft deadline for next organic mention (Phase 4)

### `storyline_updates`

Stores progress updates for each storyline.

```sql
CREATE TABLE storyline_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storyline_id UUID NOT NULL REFERENCES life_storylines(id) ON DELETE CASCADE,

  -- Update content
  update_type TEXT NOT NULL CHECK (update_type IN (
    'initial_reaction', 'processing', 'daydreaming', 'planning', 'anticipation',
    'challenge', 'complication', 'doubt', 'realization', 'progress', 'setback',
    'milestone', 'mood_shift', 'decision_point', 'final_push', 'moment_of_truth',
    'outcome_reaction', 'emotional_processing', 'meaning_making', 'reflection',
    'lesson_learned', 'gratitude', 'anniversary', 'callback', 'comparison'
  )),
  content TEXT NOT NULL,
  emotional_tone TEXT,
  should_reveal_at TIMESTAMPTZ,

  -- Tracking
  mentioned BOOLEAN NOT NULL DEFAULT FALSE,
  mentioned_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_updates_storyline ON storyline_updates(storyline_id);
CREATE INDEX idx_updates_unmentioned ON storyline_updates(storyline_id, mentioned) WHERE mentioned = FALSE;
CREATE INDEX idx_updates_created_at ON storyline_updates(created_at DESC);
CREATE INDEX idx_updates_should_reveal_at ON storyline_updates(should_reveal_at);
```

**Key Fields:**
- `update_type` - Type of update (mapped to phase)
- `content` - The actual update text
- `mentioned` - Has Kayley shared this update yet?
- `mentioned_at` - When it was mentioned (NULL if not yet)
- `should_reveal_at` - Earliest time this update should surface (used for closure pacing)

---

## Service Functions

### Core CRUD (Phase 1 ✅ IMPLEMENTED)

#### `createStoryline(input: CreateStorylineInput): Promise<LifeStoryline | null>`

Create a new storyline.

**Parameters:**
```typescript
{
  title: string;                      // "Brand Partnership with [Brand]"
  category: StorylineCategory;        // 'work' | 'personal' | 'family' | 'social' | 'creative'
  storylineType: StorylineType;       // 'project' | 'opportunity' | 'challenge' | 'relationship' | 'goal'
  currentEmotionalTone?: string;      // 'excited', 'anxious', etc.
  emotionalIntensity?: number;        // 0.0 to 1.0 (default: 0.7)
  initialAnnouncement?: string;       // What Kayley first said
  stakes?: string;                    // Why this matters
}
```

**Returns:** `LifeStoryline` object or `null` on error

**Example:**
```typescript
const storyline = await createStoryline({
  title: "Brand Partnership with Glossier",
  category: "work",
  storylineType: "opportunity",
  currentEmotionalTone: "excited",
  emotionalIntensity: 0.9,
  initialAnnouncement: "A brand I absolutely adore just reached out!",
  stakes: "First major partnership - could change everything",
});
```

---

#### `getActiveStorylines(): Promise<LifeStoryline[]>`

Get all active storylines (outcome is NULL).

**Returns:** Array of `LifeStoryline` objects

**Example:**
```typescript
const active = await getActiveStorylines();
// → [Brand Partnership (active), Video Project (honeymoon), ...]
```

---

#### `getStorylineById(id: string): Promise<LifeStoryline | null>`

Get a specific storyline by ID.

**Returns:** `LifeStoryline` or `null` if not found

**Example:**
```typescript
const storyline = await getStorylineById("uuid-here");
if (storyline) {
  console.log(`Phase: ${storyline.phase}, Mentioned: ${storyline.timesMentioned} times`);
}
```

---

#### `updateStoryline(id: string, input: UpdateStorylineInput): Promise<LifeStoryline | null>`

Update a storyline (partial update).

**Parameters:**
```typescript
{
  title?: string;
  phase?: StorylinePhase;              // Auto-updates phase_started_at
  currentEmotionalTone?: string;
  emotionalIntensity?: number;
  outcome?: StorylineOutcome;          // Auto-sets resolved_at if not null
  outcomeDescription?: string;
  resolutionEmotion?: string;
  shouldMentionBy?: Date;
  stakes?: string;
  userInvolvement?: string;
}
```

**Example:**
```typescript
// Manually progress phase
await updateStoryline(storyline.id, {
  phase: "reality",
  currentEmotionalTone: "anxious",
  emotionalIntensity: 0.6,
});

// Mark as resolved
await updateStoryline(storyline.id, {
  outcome: "success",
  outcomeDescription: "Signed the deal!",
  resolutionEmotion: "thrilled",
});
```

---

#### `deleteStoryline(id: string): Promise<boolean>`

Delete a storyline (cascade deletes all updates).

**Returns:** `true` if deleted, `false` on error

**Example:**
```typescript
const deleted = await deleteStoryline(storyline.id);
if (deleted) {
  console.log("Storyline and all updates removed");
}
```

---

#### `markStorylineMentioned(id: string): Promise<void>`

Increment mention counter and update last mentioned timestamp.

**Example:**
```typescript
// Kayley mentioned the storyline in conversation
await markStorylineMentioned(storyline.id);
// → times_mentioned incremented, last_mentioned_at updated
```

---

#### `addStorylineUpdate(storylineId: string, update: CreateUpdateInput): Promise<StorylineUpdate | null>`

Add a progress update to a storyline.

**Parameters:**
```typescript
{
  updateType: UpdateType;              // See UpdateType union
  content: string;                     // "Contract negotiations getting complicated"
  emotionalTone?: string;              // "stressed", "hopeful", etc.
}
```

**Example:**
```typescript
await addStorylineUpdate(storyline.id, {
  updateType: "progress",
  content: "Found a compromise on the contract terms!",
  emotionalTone: "relieved",
});
```

---

#### `getStorylineUpdates(storylineId: string): Promise<StorylineUpdate[]>`

Get all updates for a storyline (chronological order).

**Returns:** Array of `StorylineUpdate` objects

**Example:**
```typescript
const updates = await getStorylineUpdates(storyline.id);
updates.forEach(u => console.log(`[${u.updateType}] ${u.content}`));
```

---

#### `getUnmentionedUpdates(storylineId: string): Promise<StorylineUpdate[]>`

Get updates that Kayley hasn't mentioned yet.

**Returns:** Array of `StorylineUpdate` objects where `mentioned = false`

**Example:**
```typescript
const pending = await getUnmentionedUpdates(storyline.id);
// → Updates waiting to be surfaced in conversation
```

---

#### `markUpdateMentioned(updateId: string): Promise<void>`

Mark an update as mentioned.

**Example:**
```typescript
// Kayley mentioned this update in conversation
await markUpdateMentioned(update.id);
// → mentioned = true, mentioned_at = now
```

---

#### `getResolvedStorylines(limit: number = 10): Promise<LifeStoryline[]>`

Get resolved storylines for callback mentions.

**Returns:** Most recently resolved storylines

**Example:**
```typescript
const resolved = await getResolvedStorylines(5);
// → Last 5 completed storylines for "remember when..." callbacks
```

---

### Phase Transition (Phase 2 ✅ IMPLEMENTED)

#### `updateStorylinePhase(id: string, newPhase: StorylinePhase): Promise<void>`

**Status:** ✅ Fully implemented

Update storyline phase manually.

**Usage:**
```typescript
await updateStorylinePhase(storyline.id, "active");
// → Logs phase update
// → Updates phase and phase_started_at timestamp
```

---

#### `checkPhaseTransitions(): Promise<void>`

**Status:** ✅ Fully implemented

Check all active storylines and apply phase transition rules.

**How it works:**
1. Gets all active storylines (outcome is null)
2. For each storyline, calculates days in current phase
3. Finds applicable transition rule (from PHASE_TRANSITIONS config)
4. Applies probability logic:
   - Force transition if days >= maxDays
   - Apply probability if days >= minDays
5. Updates phase if criteria met

**Usage:**
```typescript
await checkPhaseTransitions();
// → Logs: "Checking phase transitions for active storylines..."
// → Logs: "Found X active storyline(s)"
// → For each transition: "Transitioning 'Title': announced → honeymoon (2 days in phase)"
// → Logs: "Phase transition check complete: X transition(s) applied"
```

---

#### `processStorylineDay(): Promise<void>`

**Status:** ✅ Fully implemented

Daily processing: check transitions, generate updates, set deadlines.

**Called by:** `processStorylineOnStartup()` on app startup

**Algorithm:**
1. Call `checkPhaseTransitions()` for all active storylines
2. For each active storyline, attempt to generate update
3. If update generated, set `should_mention_by` deadline (24 hours)

**Usage:**
```typescript
await processStorylineDay();
// → Logs: "========== Daily Processing Started =========="
// → Runs phase transitions
// → Logs: "Processing X active storyline(s)"
// → For each: attempts update generation
// → Logs: "========== Daily Processing Complete: X update(s) generated =========="
```

---

#### `processStorylineOnStartup(): Promise<void>`

**Status:** ✅ Fully implemented (NEW in Phase 2)

**Purpose:** Process storylines on app startup, checking for missed days.

**How it works:**
1. Gets last processed timestamp from `storyline_config` table
2. Calculates days since last process (in CST timezone)
3. If 1+ days passed, processes each missed day
4. Updates last processed timestamp

**CST Timezone Handling:**
- Database stores UTC timestamps
- Day calculations use CST (UTC-6) to avoid timezone bugs
- Ensures storylines progress based on calendar days, not app runtime

**Usage:**
```typescript
// In App.tsx (called on mount)
useEffect(() => {
  processStorylineOnStartup();
}, []);

// Logs:
// "========== On-Startup Processing =========="
// "Last processed: 2026-01-15T12:00:00.000Z (2 day(s) ago in CST)"
// "Processing 2 missed day(s)..."
// "Processing day 1/2..."
// [runs processStorylineDay()]
// "Processing day 2/2..."
// [runs processStorylineDay()]
// "========== On-Startup Processing Complete =========="
```

---

### LLM Update Generation (Phase 2 ✅ IMPLEMENTED)

#### `generateStorylineUpdate(storyline: LifeStoryline): Promise<StorylineUpdate | null>`

**Status:** ✅ Fully implemented

Generate a new update for a storyline using Gemini LLM.

**How it works:**
1. Gets phase behavior configuration (from PHASE_BEHAVIORS)
2. Fetches previous updates for context (last 3)
3. Checks if enough time passed since last update (phase-specific intervals)
4. Builds LLM prompt with:
   - Storyline context (title, category, phase, days in phase, emotion)
   - Previous updates for continuity
   - Phase guidance (how Kayley should talk about it)
   - Stakes (why this matters)
5. Calls Gemini (temperature 0.7 for variety)
6. Parses JSON response: `{ updateType, content, emotionalTone }`
7. Creates update record in database

**Update Intervals by Phase:**
- `announced`: 1 day (high activity)
- `honeymoon`: 2 days
- `reality`: 2 days
- `active`: 3 days (lower activity, working)
- `climax`: 1 day (high stakes)
- `resolving`: 1 day (processing emotions)
- `resolved`: 7 days (weekly reflections)
- `reflecting`: 30 days (monthly callbacks)

**Usage:**
```typescript
const storyline = await getStorylineById('uuid');
const update = await generateStorylineUpdate(storyline);

if (update) {
  console.log(`Generated: [${update.updateType}] ${update.content}`);
}

// Logs:
// "Generating update for: 'Brand Partnership' (reality)"
// "LLM response: {\"updateType\":\"challenge\",\"content\":...}"
// "Generated update: [challenge] 'The contract has a LOT of requirements...'"
```

**Returns:**
- `StorylineUpdate` object if generated successfully
- `null` if:
  - Not enough time passed since last update
  - No phase behavior config found
  - LLM call failed
  - JSON parsing failed

---

### Closure & Resolution (Phase 5 ⏳ NOT IMPLEMENTED)

#### `resolveStoryline(id: string, outcome: StorylineOutcome, outcomeDescription: string, resolutionEmotion?: string): Promise<void>`

**Status:** Partially implemented (basic resolution works, closure sequences pending)

Resolve a storyline with an outcome.

**Current Behavior:**
```typescript
await resolveStoryline(storyline.id, "success", "Signed the deal!", "thrilled");
// → Logs "Feature Not Implemented (Phase 5)" warning
// → Updates storyline with outcome (basic)
// → Does NOT generate closure sequence
```

**Phase 5 Implementation:**
- Generate multi-day closure sequence (announcement → processing → reflection)
- Schedule updates for future reveal
- Transition through resolving → resolved phases

---

#### `initiateStorylineClosure(id: string, outcome: StorylineOutcome): Promise<void>`

**Status:** ⏳ NOT IMPLEMENTED (Phase 5)

Initiate multi-day closure flow.

**Planned Behavior:**
```typescript
await initiateStorylineClosure(storyline.id, "success");
// → 1. Generate closure updates (4-5 updates)
// → 2. Schedule over 3-5 days
// → 3. Set phase to 'resolving'
// → 4. Eventually transition to 'resolved'
```

**Current Behavior:**
```typescript
await initiateStorylineClosure(storyline.id, "success");
// → Logs "Feature Not Implemented (Phase 5)"
// → No action taken
```

---

#### `getResolvedStorylineForCallback(): Promise<LifeStoryline | null>`

**Status:** ⏳ NOT IMPLEMENTED (Phase 5)

Get a resolved storyline for "remember when..." callback.

**Planned Behavior:**
```typescript
const callback = await getResolvedStorylineForCallback();
// → 1. Get storylines resolved 30+ days ago
// → 2. Filter recently referenced ones
// → 3. Weight by emotional significance
// → 4. Return selected storyline for mention
```

**Current Behavior:**
```typescript
const callback = await getResolvedStorylineForCallback();
// → Logs "Feature Not Implemented (Phase 5)"
// → Returns null
```

---

### Mood Integration (Phase 3 ✅ IMPLEMENTED)

#### `getStorylineMoodEffects(): Promise<StorylineMoodEffect[]>`

**Status:** ✅ IMPLEMENTED (Phase 3)

Get mood effects from all active storylines. Calculates how each active storyline affects Kayley's mood and energy based on its phase and emotional intensity.

**Return Value:**
```typescript
[
  {
    storylineId: "uuid",
    phase: "climax",
    currentEmotion: "anxious",
    moodDelta: -0.24,       // -0.3 (phase moodImpact) × 0.8 (intensity)
    energyDelta: -0.08,     // -0.1 × 0.8 (stressful phase)
    preoccupation: 0.72,    // 0.9 (climax preoccupation) × 0.8
  },
  {
    storylineId: "uuid2",
    phase: "honeymoon",
    currentEmotion: "hopeful",
    moodDelta: 0.32,        // 0.4 × 0.8 (positive phase)
    energyDelta: 0,         // No energy drain in honeymoon phase
    preoccupation: 0.4,     // 0.5 × 0.8
  },
]
```

**Implementation:**
```typescript
const effects = await getStorylineMoodEffects();
// → Calculates mood/energy impact for each active storyline
// → Returns array of StorylineMoodEffect objects
// → Logs total deltas for debugging

// Example log output:
// 📖 [Storylines] Calculating mood effects for 2 active storyline(s)
// 📖 [Storylines] "Stressful Project" (climax): mood -0.24, energy -0.08, preoccupation 0.72
// 📖 [Storylines] "New Partnership" (honeymoon): mood 0.32, energy 0.00, preoccupation 0.40
// 📖 [Storylines] Total effects - Mood: 0.08, Energy: -0.08, Preoccupation: 1.12
```

**Integration in moodKnobs.ts:**
```typescript
// In getMoodAsync()
const storylineEffects = await getStorylineMoodEffects();
const moodDelta = storylineEffects.reduce((sum, e) => sum + e.moodDelta, 0);
const energyDelta = storylineEffects.reduce((sum, e) => sum + e.energyDelta, 0);

// Applied to base mood:
mood.energy += energyDelta;  // Clamped to [-1, 1]
mood.warmth += moodDelta;    // Clamped to [0, 1]
```

**Algorithm:**
1. Get all active storylines (outcome is null)
2. For each storyline:
   - `moodDelta = phaseBehavior.moodImpact × emotionalIntensity`
   - `energyDelta = -0.1 × emotionalIntensity` (for stressful phases: reality, active, climax)
   - `preoccupation = preoccupationByPhase[phase] × emotionalIntensity`
3. Return array of effects (empty if no active storylines)

---

### Prompt Integration (Phase 4 ⏳ NOT IMPLEMENTED)

#### `getStorylinePromptContext(): Promise<StorylinePromptContext>`

**Status:** ⏳ NOT IMPLEMENTED (Phase 4)

Get storyline context for system prompt injection.

**Planned Return:**
```typescript
{
  hasActiveStorylines: true,
  activeStorylines: [/* LifeStoryline[] */],
  recentUpdates: [/* Updates from last 7 days */],
  unreveatedUpdates: [/* Updates not yet mentioned */],
}
```

**Current Behavior:**
```typescript
const context = await getStorylinePromptContext();
// → Logs "Feature Not Implemented (Phase 4)"
// → Returns { hasActiveStorylines: false, activeStorylines: [], recentUpdates: [], unreveatedUpdates: [] }
```

**Phase 4 Integration:**
```typescript
// In systemPromptBuilder.ts
const storylineContext = await getStorylinePromptContext();
if (storylineContext.hasActiveStorylines) {
  prompt += buildStorylinePromptSection(storylineContext);
}
```

---

## Type Definitions

### Core Types

```typescript
type StorylineCategory = 'work' | 'personal' | 'family' | 'social' | 'creative';

type StorylineType = 'project' | 'opportunity' | 'challenge' | 'relationship' | 'goal';

type StorylinePhase =
  | 'announced'      // Just happened, initial excitement/shock
  | 'honeymoon'      // Early enthusiasm, everything feels possible
  | 'reality'        // Challenges become apparent
  | 'active'         // In the thick of it, working through
  | 'climax'         // Critical moment, decision point
  | 'resolving'      // Outcome is clear, processing emotions
  | 'resolved'       // Complete, moved to history
  | 'reflecting';    // Looking back (periodic, after resolved)

type StorylineOutcome =
  | 'success'        // Achieved the goal
  | 'failure'        // Didn't work out
  | 'abandoned'      // Chose to stop pursuing
  | 'transformed'    // Became something different
  | 'ongoing';       // Still active (for long-term storylines)

type UpdateType =
  | 'initial_reaction' | 'processing'                          // announced phase
  | 'daydreaming' | 'planning' | 'anticipation'                // honeymoon phase
  | 'challenge' | 'complication' | 'doubt' | 'realization'    // reality phase
  | 'progress' | 'setback' | 'milestone' | 'mood_shift'       // active phase
  | 'decision_point' | 'final_push' | 'moment_of_truth'       // climax phase
  | 'outcome_reaction' | 'emotional_processing' | 'meaning_making'  // resolving phase
  | 'reflection' | 'lesson_learned' | 'gratitude'             // resolved phase
  | 'anniversary' | 'callback' | 'comparison';                // reflecting phase
```

### Phase Progression

**Typical Timeline:**
```
announced (1-3 days)
    ↓
honeymoon (3-7 days)
    ↓
reality (2-5 days)
    ↓
active (7-21 days)
    ↓
climax (1-3 days)
    ↓
resolving (2-5 days)
    ↓
resolved (permanent)
    ↓
reflecting (periodic callbacks)
```

---

## Use Cases

### Creating a New Storyline

```typescript
// Kayley's autonomous thought system generates a life event
const storyline = await createStoryline({
  title: "Video editing project for client",
  category: "work",
  storylineType: "project",
  currentEmotionalTone: "excited",
  emotionalIntensity: 0.6,
  initialAnnouncement: "Just got briefed on a new client project - it's ambitious!",
  stakes: "First project with this client, want to impress",
});

// Add initial update
await addStorylineUpdate(storyline.id, {
  updateType: "initial_reaction",
  content: "The scope is bigger than I thought, but I'm ready for it",
  emotionalTone: "determined",
});
```

### Manual Phase Progression (Phase 1)

```typescript
// In Phase 1, phases must be updated manually
const storyline = await getStorylineById(id);

if (storyline && storyline.phase === "announced") {
  // Move to honeymoon after 2 days
  await updateStoryline(storyline.id, {
    phase: "honeymoon",
    currentEmotionalTone: "optimistic",
  });

  // Add update
  await addStorylineUpdate(storyline.id, {
    updateType: "daydreaming",
    content: "Keep imagining how cool this is going to look when it's done",
    emotionalTone: "hopeful",
  });
}
```

### Resolving a Storyline

```typescript
// Mark as successful
await resolveStoryline(
  storyline.id,
  "success",
  "Client loved the final video! Asked for two more projects",
  "proud"
);

// Add final reflection
await addStorylineUpdate(storyline.id, {
  updateType: "reflection",
  content: "That was intense but so worth it. Feel like I leveled up.",
  emotionalTone: "grateful",
});
```

### Checking Unmentioned Updates

```typescript
// Get updates Kayley hasn't shared yet
const pending = await getUnmentionedUpdates(storyline.id);

if (pending.length > 0) {
  console.log(`Kayley has ${pending.length} updates to share about: ${storyline.title}`);

  // In greeting or conversation, surface these updates
  // (Phase 4 will do this automatically)
}
```

---

## Design Decisions

### Decision 1: Hybrid Progression Model

**Approach:** System handles timing, LLM handles content

- ✅ **System responsibilities:** Phase transition timers, probability calculations, enforcement of min/max durations
- ✅ **LLM responsibilities:** Generate update text, determine tone, context-aware timing

**Rationale:**
- Guarantees progression (no forgotten storylines)
- Natural content (LLM-generated updates)
- Predictable timing (system clocks)
- Contextual surfacing (LLM decides when to mention)

### Decision 2: No User ID

**All tables omit `user_id` field**

This is a single-user system (one Kayley instance). Multi-user support is not planned.

### Decision 3: Cascade Deletes

**`storyline_updates` uses `ON DELETE CASCADE`**

Deleting a storyline automatically removes all its updates. This prevents orphaned updates and simplifies cleanup.

### Decision 4: Backward Compatibility

**`life_events` table remains during transition**

The migration script copies data but doesn't delete the old table. This allows:
- Gradual rollout
- Fallback if issues arise
- 30-day verification period
- Manual cleanup after confirmation

---

## Migration Guide

### Step 1: Apply Migrations

Run these migrations in order:

```bash
# 1. Create life_storylines table
supabase migration up 20260116_create_life_storylines.sql

# 2. Create storyline_updates table
supabase migration up 20260116_create_storyline_updates.sql

# 3. Migrate existing data
supabase migration up 20260116_migrate_life_events_to_storylines.sql
```

### Step 2: Verify Migration

```typescript
import { getActiveStorylines } from './services/storylineService';

const storylines = await getActiveStorylines();
console.log(`Migrated ${storylines.length} storylines`);
```

### Step 3: Gradual Integration

Phase 1 is standalone. No integration with existing systems yet.

**Do NOT:**
- Add to system prompt (Phase 4)
- Add to mood calculation (Phase 3)
- Call from idle breaker (Phase 2)

**Do:**
- Test CRUD functions
- Manually create storylines
- Manually add updates
- Verify data structure

---

## Testing

**Phase 1 Status:** Tests deferred to Phase 6

**Planned Tests (Phase 6):**
- CRUD operations (create, read, update, delete)
- Update management (add, mark mentioned)
- Query filters (active only, resolved only)
- Phase transitions (Phase 2)
- LLM generation (Phase 2)
- Mood effects (Phase 3)

**Manual Testing:**
```typescript
// Test creating storyline
const storyline = await createStoryline({
  title: "Test Project",
  category: "personal",
  storylineType: "project",
});

// Test adding update
const update = await addStorylineUpdate(storyline.id, {
  updateType: "progress",
  content: "Making progress on the test",
});

// Test marking mentioned
await markStorylineMentioned(storyline.id);
await markUpdateMentioned(update.id);

// Verify
const fetched = await getStorylineById(storyline.id);
console.log(fetched.timesMentioned); // → 1
```

---

## Performance Considerations

### Database Queries

All queries use indexes:
- `idx_storylines_active` - Fast filtering for active storylines
- `idx_storylines_mention` - Fast lookup of pending mentions
- `idx_updates_unmentioned` - Fast fetch of unrevealed updates

### Caching (Future)

Phase 4 will add caching:
- Active storylines (30s TTL)
- Recent updates (30s TTL)
- Invalidate on write

### Background Processing (Phase 2)

Daily processing job will run off-peak:
```typescript
// Run at midnight
cron.schedule('0 0 * * *', async () => {
  await processStorylineDay();
});
```

---

## Common Patterns

### Pattern 1: Create and Track a Storyline

```typescript
// Create storyline
const storyline = await createStoryline({
  title: "Learning motion graphics",
  category: "creative",
  storylineType: "goal",
  currentEmotionalTone: "curious",
  emotionalIntensity: 0.7,
  stakes: "Want to expand my skill set",
});

// Track progress over time
await addStorylineUpdate(storyline.id, {
  updateType: "progress",
  content: "Finally getting the hang of keyframes",
  emotionalTone: "hopeful",
});

// Eventually resolve
await resolveStoryline(
  storyline.id,
  "success",
  "Made my first motion graphics piece!",
  "proud"
);
```

### Pattern 2: Manual Phase Management (Phase 1)

```typescript
// Manually advance phases based on time
const storyline = await getStorylineById(id);
const daysActive = Math.floor(
  (Date.now() - storyline.createdAt.getTime()) / (1000 * 60 * 60 * 24)
);

if (daysActive > 3 && storyline.phase === "announced") {
  await updateStoryline(storyline.id, { phase: "honeymoon" });
}
if (daysActive > 7 && storyline.phase === "honeymoon") {
  await updateStoryline(storyline.id, { phase: "reality" });
}
// etc.
```

### Pattern 3: Surface Unmentioned Updates

```typescript
// Get pending updates
const pending = await getUnmentionedUpdates(storyline.id);

if (pending.length > 0) {
  // Surface in greeting or conversation
  const update = pending[0];

  // After Kayley mentions it:
  await markUpdateMentioned(update.id);
  await markStorylineMentioned(storyline.id);
}
```

---

## Troubleshooting

### Problem: Storylines not progressing

**Symptom:** Storylines stuck in "announced" phase forever

**Cause:** Phase 2 not implemented yet

**Fix (Phase 1):**
```typescript
// Manually update phases
await updateStoryline(storyline.id, { phase: "active" });
```

**Fix (Phase 2):**
```typescript
// Will be automatic via daily job
await processStorylineDay();
```

---

### Problem: Updates not being generated

**Symptom:** No new updates appearing for storylines

**Cause:** Phase 2 LLM generation not implemented

**Fix (Phase 1):**
```typescript
// Manually create updates
await addStorylineUpdate(storyline.id, {
  updateType: "progress",
  content: "Manual update content",
});
```

**Fix (Phase 2):**
```typescript
// Will be automatic
const update = await generateStorylineUpdate(storyline);
```

---

### Problem: Storylines not affecting mood

**Symptom:** Kayley's mood doesn't reflect ongoing storylines

**Cause:** Phase 3 mood integration not implemented

**Fix:** Wait for Phase 3 implementation

---

### Problem: Kayley never mentions storylines

**Symptom:** Storylines exist but Kayley doesn't talk about them

**Cause:** Phase 4 prompt integration not implemented

**Fix:** Wait for Phase 4 system prompt integration

---

## Summary

**Phase 1 delivers:**
- ✅ Complete data model (tables, types, interfaces)
- ✅ CRUD operations for storylines and updates
- ✅ Migration from old life_events system
- ✅ Foundation for future phases

**Phase 1 does NOT deliver:**
- ⏳ Automatic phase progression
- ⏳ LLM update generation
- ⏳ Mood integration
- ⏳ System prompt integration
- ⏳ Closure sequences
- ⏳ Tests

**Next steps (Phase 2):**
- Implement automatic phase transitions
- Build LLM update generation
- Create daily processing job
- Add time-based progression logic

**For more information:**
- Full feature spec: `docs/features/Life_Event_Storylines.md`
- Implementation plan: `docs/features/Life_Event_Storylines.md` (Phases section)
