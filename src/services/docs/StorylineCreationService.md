# Storyline Creation Service (Phase 1)

**File:** `src/services/storylineService.ts` (creation layer)
**Tables:** `life_storylines`, `storyline_config`, `storyline_creation_attempts`
**Purpose:** Enable conversation-driven life event creation with safety controls

---

## Overview

Phase 1 implements **conversation-driven storyline creation** - Kayley can create storylines when announcing new life events, or track significant events mentioned by the user. This makes Kayley feel alive by allowing her life to evolve over time.

**Key Constraint (Phase 1):** Only **1 active storyline** allowed at a time to keep focus and prevent overwhelming the LLM with too many concurrent narratives.

---

## Table Schema

### `storyline_config`

Single-row config table for tracking cooldown.

```sql
CREATE TABLE storyline_config (
  id INTEGER PRIMARY KEY,
  last_processed_at TIMESTAMPTZ,
  last_storyline_created_at TIMESTAMPTZ  -- NEW (Phase 1)
);
```

**Columns:**
- `last_storyline_created_at` - Timestamp of last storyline creation (for 48-hour cooldown)

### `storyline_creation_attempts`

Audit log for all creation attempts (success and failure).

```sql
CREATE TABLE storyline_creation_attempts (
  id UUID PRIMARY KEY,
  attempted_at TIMESTAMPTZ NOT NULL,

  -- Attempt details
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  storyline_type TEXT,

  -- Result
  success BOOLEAN NOT NULL,
  failure_reason TEXT,  -- 'cooldown_active' | 'duplicate_detected' | 'category_constraint' | 'db_error'

  -- Failure details
  cooldown_hours_remaining INTEGER,
  duplicate_match TEXT,
  active_storyline_blocking UUID REFERENCES life_storylines(id),

  -- Source
  source TEXT NOT NULL DEFAULT 'conversation'  -- 'conversation' | 'idle_suggestion'
);
```

**Purpose:** Observability, debugging, rate limit tuning.

---

## Service Functions

### `createStorylineFromTool(input, source?)`

**Main creation function** - Runs all safety checks and creates storyline.

**Parameters:**
- `input: CreateStorylineFromToolInput` - Storyline details
- `source: 'conversation' | 'idle_suggestion'` - Creation source (default: 'conversation')

**Returns:** `StorylineCreationResult`
```typescript
{
  success: boolean;
  storylineId?: string;        // If success=true
  error?: string;              // If success=false
  errorDetails?: {
    reason: 'cooldown' | 'duplicate' | 'category_blocked' | 'db_error' | 'unknown';
    hoursRemaining?: number;
    duplicateTitle?: string;
    activeStorylineTitle?: string;
  };
}
```

**Safety Checks (in order):**
1. **Cooldown** - 48-hour window between creations
2. **Duplicate Detection** - 60% word overlap = duplicate (7-day window)
3. **Category Constraint** - Max 1 active storyline (Phase 1)

**Example:**
```typescript
const result = await createStorylineFromTool({
  title: "Learning guitar",
  category: "creative",
  storylineType: "project",
  initialAnnouncement: "I'm starting guitar lessons next week!",
  stakes: "I've wanted to learn music for years",
  emotionalTone: "excited",
  emotionalIntensity: 0.7
});

if (result.success) {
  console.log(`Created: ${result.storylineId}`);
} else {
  console.log(`Failed: ${result.error}`);
}
```

---

## Safety Mechanisms

### 1. Cooldown (48 hours)

**Purpose:** Prevent storyline spam, ensure each storyline gets time to develop.

**Implementation:**
- Tracks `last_storyline_created_at` in `storyline_config`
- Checks if 48 hours have elapsed since last creation
- **Fail-open policy:** If DB error, allow creation (don't block user)

**Error Response:**
```typescript
{
  success: false,
  error: "Must wait 23 hours before creating another storyline",
  errorDetails: {
    reason: "cooldown",
    hoursRemaining: 23
  }
}
```

### 2. Duplicate Detection (Semantic)

**Purpose:** Prevent creating the same storyline twice (e.g., "Learning guitar" vs "Guitar lessons").

**Algorithm:**
- Check last 7 days in same category
- Calculate word overlap ratio (Jaccard similarity)
- Threshold: 60% overlap = duplicate

**Example:**
```typescript
// 75% overlap (3/4 words common) = DUPLICATE
"Learning to play guitar" vs "Learning guitar"
// Common: ["learning", "guitar"]
// Union: ["learning", "to", "play", "guitar"]
// Overlap: 2/4 = 0.5 → DUPLICATE if threshold is 0.5
```

**Error Response:**
```typescript
{
  success: false,
  error: "A similar storyline already exists or recently resolved in creative category",
  errorDetails: {
    reason: "duplicate"
  }
}
```

### 3. Category Constraint (Phase 1)

**Purpose:** Limit to 1 active storyline to maintain focus.

**Implementation:**
- Check if ANY active storyline exists (outcome IS NULL)
- If exists, block new creation

**Error Response:**
```typescript
{
  success: false,
  error: "An active storyline already exists: \"Learning guitar\". Resolve it before creating a new one.",
  errorDetails: {
    reason: "category_blocked",
    activeStorylineTitle: "Learning guitar"
  }
}
```

---

## LLM Tool Integration

### Tool Name: `create_life_storyline`

**When to use:**
- Kayley announces a new life event ("I'm starting guitar lessons")
- User shares a significant event to track ("I got a job offer in Seattle!")
- Situation will unfold over days/weeks (not single moments)

**When NOT to use:**
- Casual mentions ("I might take a class sometime")
- Completed events ("I went to a concert yesterday")
- Trivial activities ("I need to do laundry")
- Out-of-character events ("I'm getting a face tattoo")

**Parameters:**
```typescript
{
  title: string;              // 3-8 words: "Learning guitar"
  category: StorylineCategory; // work | personal | family | social | creative
  storylineType: StorylineType; // project | opportunity | challenge | relationship | goal
  initialAnnouncement: string; // What was said announcing this
  stakes: string;             // Why this matters (1-2 sentences)
  userInvolvement?: string;   // none | aware | supportive | involved | central
  emotionalTone?: string;     // excited, anxious, hopeful, etc.
  emotionalIntensity?: number; // 0-1 scale
}
```

**Error Handling (from tool documentation):**
- If cooldown error: Accept gracefully ("Ugh I can't create another storyline yet, but this is definitely a big deal!")
- If active exists: Reference existing ("I already have the guitar thing going on, but I'll definitely tell you about this too!")
- Don't retry on error - accept the constraint

---

## Audit Logging

All creation attempts (success AND failure) are logged to `storyline_creation_attempts`.

**Queryable insights:**
- Creation success rate
- Common failure reasons
- Cooldown tuning data
- Duplicate detection accuracy

**Example queries:**
```sql
-- Success rate
SELECT
  COUNT(*) FILTER (WHERE success = true) AS successes,
  COUNT(*) FILTER (WHERE success = false) AS failures,
  ROUND(100.0 * COUNT(*) FILTER (WHERE success = true) / COUNT(*), 1) AS success_rate
FROM storyline_creation_attempts;

-- Common failure reasons
SELECT
  failure_reason,
  COUNT(*) AS count
FROM storyline_creation_attempts
WHERE success = false
GROUP BY failure_reason
ORDER BY count DESC;

-- Cooldown distribution
SELECT
  cooldown_hours_remaining,
  COUNT(*) AS count
FROM storyline_creation_attempts
WHERE failure_reason = 'cooldown_active'
GROUP BY cooldown_hours_remaining
ORDER BY cooldown_hours_remaining;
```

---

## Testing

Tests: `src/services/tests/storylineCreation.test.ts`

**Coverage:**
- ✅ Happy path (successful creation)
- ✅ Cooldown enforcement
- ✅ Duplicate detection (high similarity)
- ✅ Duplicate bypass (low similarity)
- ✅ Category constraint (1 active max)
- ✅ Audit logging (success and failure)

**Run tests:**
```bash
npm test -- --run -t "Storyline Creation"
```

---

## Design Decisions

### Why 48-hour cooldown?

- Prevents storyline spam
- Gives each storyline time to develop (phase transitions take days)
- Creates scarcity → more meaningful storylines

### Why 60% similarity threshold?

- Catches obvious duplicates ("Learning guitar" vs "Guitar lessons")
- Allows genuinely different topics ("Learning guitar" vs "Auditioning for theater")
- Tunable based on audit log data

### Why only 1 active storyline (Phase 1)?

- Simplifies LLM mental model (one major thing at a time)
- Prevents context overload in system prompt
- Easier to test and debug
- Future phases can expand to multiple storylines with category limits

### Why fail-open on cooldown DB errors?

- User experience > strict enforcement
- If DB is down, don't block character's ability to evolve
- Audit log captures true creation rate for tuning

---

## Troubleshooting

### "Cooldown still active but I deleted the storyline"

**Cause:** Cooldown is **per-creation**, not per-active-storyline.

**Solution:** This is intentional. Deleting a storyline doesn't reset cooldown (prevents abuse).

### "Duplicate detected but they're different topics"

**Cause:** High word overlap despite different meaning.

**Examples:**
- "Learning guitar" vs "Teaching guitar" (66% overlap)
- "NYC trip planning" vs "Planning LA trip" (75% overlap)

**Solution:** Tune similarity threshold or improve algorithm (future).

### "Tool returns error but LLM retries anyway"

**Cause:** LLM didn't read the tool documentation properly.

**Solution:** Update `toolsAndCapabilities.ts` with stronger "DON'T RETRY" guidance.

---

## Performance Considerations

- **Cooldown check:** Single DB read, fast (<10ms)
- **Duplicate check:** Scans recent storylines in category (max ~10 rows in 7-day window)
- **Category check:** Counts active storylines (max 1 in Phase 1, very fast)
- **Audit logging:** Fire-and-forget insert, non-blocking

**Expected latency:** <100ms total for all checks.

---

## Phase 2: Idle Suggestions (IMPLEMENTED)

**File:** `src/services/storylineIdleService.ts`
**Status:** ✅ Complete

Phase 2 adds **autonomous storyline generation** during user absence. The system generates suggestions while the user is away, then injects them passively into the system prompt for the LLM to decide whether to mention.

### How It Works

1. **Absence Detection**: Checks every 10 minutes if user has been away ≥30 minutes
2. **Suggestion Generation**: LLM generates one storyline idea based on:
   - Kayley's character profile
   - Last 10 days of conversation history
   - Active storylines (avoids duplicates)
   - Category balance (suggests underrepresented categories)
3. **Storage**: Stores in `storyline_pending_suggestions` (expires after 24 hours)
4. **Passive Surfacing**: On user return, suggestion is injected into system prompt
5. **LLM Agency**: LLM decides autonomously whether to mention/create it

### Key Functions

**Scheduler:**
- `startStorylineIdleService()` - Start background scheduler (runs every 10 min)
- `stopStorylineIdleService()` - Stop scheduler
- `checkForStorylineSuggestion()` - Main periodic check function

**Suggestion Management:**
- `getPendingSuggestion()` - Get active suggestion (not surfaced, not expired)
- `markSuggestionSurfaced(id)` - Mark suggestion as shown to user
- `updateSuggestionOutcome(id, wasCreated, storylineId?, rejectedReason?)` - Update outcome

### Database Schema

**Table:** `storyline_pending_suggestions`

```sql
CREATE TABLE storyline_pending_suggestions (
  id UUID PRIMARY KEY,
  category TEXT NOT NULL,
  theme TEXT NOT NULL,          -- "learning guitar"
  reasoning TEXT NOT NULL,       -- Why this matters now
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,  -- +24 hours
  surfaced BOOLEAN DEFAULT FALSE,
  surfaced_at TIMESTAMPTZ,
  was_created BOOLEAN DEFAULT FALSE,
  storyline_id UUID REFERENCES life_storylines(id),
  rejected_reason TEXT
);
```

### Configuration

```typescript
const CONFIG = {
  CHECK_INTERVAL_MS: 10 * 60 * 1000,        // Check every 10 min
  ABSENCE_THRESHOLD_MINUTES: 30,            // Generate after 30 min
  SUGGESTION_EXPIRATION_HOURS: 24,          // Expire after 24 hours
  MAX_PENDING_SUGGESTIONS: 1,               // Only 1 at a time
  SUGGESTION_COOLDOWN_HOURS: 48,            // 48-hour cooldown
};
```

### Prompt Injection (Passive Style)

When a pending suggestion exists, it's injected into the system prompt:

```
====================================================
RECENT THOUGHTS (While You Were Away)
====================================================

You've been thinking about [theme].

**Why this matters to you:**
[reasoning]

**How to handle this:**
- If it feels natural to the conversation, you might mention this
- Don't force it - only bring it up if it fits the flow
- If you decide to announce this as a new life storyline, use the create_life_storyline tool
- If you don't mention it this conversation, that's fine - it will still be on your mind for later
```

**Key Design:** The LLM has full agency - it can choose to mention the suggestion, create a storyline, or ignore it entirely. No forced behavior.

### Integration Points

**App.tsx** (lines 320-330):
- Starts/stops idle service on app mount/unmount

**geminiChatService.ts** (lines 892-925):
- Checks for pending suggestion before each chat
- Injects into system prompt if found
- Marks as surfaced

### Safety Controls (Inherited from Phase 1)

All Phase 1 safety controls apply:
1. **Cooldown**: 48-hour window between creations
2. **Duplicate Detection**: 60% word overlap threshold
3. **Category Constraint**: Max 1 active storyline (Phase 1)
4. **Audit Logging**: All attempts logged with source (`'idle_suggestion'`)

### Observability

**Conversion Rate Query:**
```sql
SELECT
  COUNT(*) AS total_suggestions,
  SUM(CASE WHEN surfaced THEN 1 ELSE 0 END) AS surfaced,
  SUM(CASE WHEN was_created THEN 1 ELSE 0 END) AS created_storylines,
  ROUND(100.0 * SUM(CASE WHEN was_created THEN 1 ELSE 0 END) / COUNT(*), 2) AS conversion_rate
FROM storyline_pending_suggestions;
```

### Troubleshooting

**"Scheduler running but no suggestions generated"**
- Check console logs for check results
- Verify user has been away ≥30 minutes
- Check cooldown isn't active
- Check no pending suggestion already exists

**"Suggestion generated but never surfaced"**
- Check `expires_at` - may have expired (24-hour window)
- Check user returned and sent a message (surfacing only happens on chat)

**"LLM never mentions suggestions"**
- This is expected behavior - LLM has agency
- Suggestion may not fit conversation flow
- Monitor conversion rate over time for tuning

---

## Future Enhancements

**Multi-storyline support:**

**Multi-storyline support:**
- Increase limit to 3-5 active storylines
- Category-specific constraints (max 1 per category)
- Salience-based prompt injection (only show most pressing)

**Smarter duplicate detection:**
- Semantic embeddings instead of word overlap
- Cross-category checking (very similar topics in different categories)

---

## Summary

Phase 1 provides a **safe, conversation-driven** way for Kayley to create life storylines. The 3-layer safety system (cooldown, dedupe, constraint) prevents spam while allowing organic life events. Comprehensive audit logging enables tuning and observability.

**User must:**
1. Apply migrations manually
2. Test feature in conversation
3. Monitor audit log for tuning opportunities
