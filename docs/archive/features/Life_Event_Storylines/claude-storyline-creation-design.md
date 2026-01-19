# Life Storyline Creation Design
**Research & Architecture Recommendation**

**Date:** 2026-01-16
**Status:** Research Complete - Awaiting User Decision
**Purpose:** Design reliable trigger mechanism for Life Event Storyline creation

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [The Design Gap](#the-design-gap)
4. [Three Implementation Paths](#three-implementation-paths)
5. [Detailed Path Comparison](#detailed-path-comparison)
6. [Safety Controls Design](#safety-controls-design)
7. [Rollout Strategy](#rollout-strategy)
8. [Decision Framework](#decision-framework)
9. [Next Steps](#next-steps)

---

## Executive Summary

### The Problem
Life storylines feature is **100% implemented** (1966 lines, 5 phases complete) but has **no way to create new storylines**. The feature operates in a vacuum: processes phases, generates updates, affects mood, surfaces in conversation—but **never gets created in the first place**.

### Root Cause
No creation trigger exists. Original design assumed idle thoughts would trigger creation, but:
- Idle thoughts v1 is fully implemented but **deactivated** (scheduler never starts)
- User requirement: Do NOT use idle thoughts v1 (wants clean v2 if idle approach chosen)
- No LLM tool for storyline creation exists
- No conversation-driven creation path

### Three Viable Paths Forward

| Path | Approach | Complexity | Autonomy | Risk |
|------|----------|------------|----------|------|
| **A** | Conversation-Driven Only | ~200 lines | Low (reactive) | Lowest |
| **B** | Clean Idle Thoughts v2 | ~150 lines | High (autonomous) | Medium |
| **C** | Start A, Add B Later | Phased | Low → High | Lowest |

**Recommendation:** **Path C** (start conversation-driven, add autonomy after validation)

---

## Current State Analysis

### What Exists ✅

#### 1. Life Storylines Service (COMPLETE)
**File:** `src/services/storylineService.ts` (1966 lines)

**Implemented Features:**
- ✅ **Phase 1:** Database schema (3 tables), CRUD operations, one-active constraint
- ✅ **Phase 2:** Daily phase transitions (8 phases), LLM update generation, on-startup processing
- ✅ **Phase 3:** Mood integration (affects energy/warmth in `moodKnobs.ts`)
- ✅ **Phase 4:** System prompt injection (salience-based, message #2+)
- ✅ **Phase 5:** Closure sequences (4-day resolution), character fact storage, 30-day callbacks

**Current Constraint:**
```typescript
// Only 1 active storyline allowed (outcome IS NULL = active)
const existingActive = await supabase
  .from('life_storylines')
  .select('id')
  .is('outcome', null)
  .limit(1);

if (existingActive.length > 0) {
  return null; // ❌ BLOCKS NEW CREATION
}
```

**Daily Processing:**
```typescript
// App.tsx:51 - Runs on startup
await processStorylineOnStartup();

// Checks missed days, processes phase transitions, generates updates
```

**Types:**
```typescript
export type StorylineCategory = 'work' | 'personal' | 'family' | 'social' | 'creative';
export type StorylineType = 'project' | 'opportunity' | 'challenge' | 'relationship' | 'goal';
export type StorylinePhase = 'announced' | 'honeymoon' | 'reality' | 'active'
                            | 'climax' | 'resolving' | 'resolved' | 'reflecting';
```

#### 2. Idle Thoughts v1 (COMPLETE BUT DEACTIVATED)
**Status:** ⚠️ **DO NOT USE** (user wants clean v2 if idle approach chosen)

**What Exists:**
| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Idle Thoughts Scheduler | `idleThoughtsScheduler.ts` | ~280 | Implemented, never started |
| Idle Thought Generation | `spontaneity/idleThoughts.ts` | ~450 | 6 thought types, templates |
| Autonomous Thought Service | `autonomousThoughtService.ts` | ~220 | LLM-based generation |
| Kayley Experiences | `idleLife/kayleyExperienceService.ts` | ~300 | Activities, mishaps, moods |
| Calendar Awareness | `idleLife/calendarAwarenessService.ts` | ~250 | Event follow-ups |
| Gift Messages | `idleLife/giftMessageService.ts` | ~200 | 5% chance, max once/day |
| Pending Messages | `idleLife/pendingMessageService.ts` | ~180 | Delivery queue |
| Database Tables | 7 tables | N/A | All migrated |
| Tests | `__tests__/idleThoughtsScheduler.test.ts` | ~400 | All passing |

**Why It's Not Running:**
```typescript
// App.tsx:50 - Only promise checker is started
import { startPromiseChecker } from './services/backgroundJobs';
startPromiseChecker(); // ✅ ACTIVE

// ❌ NEVER IMPORTED OR CALLED:
// import { startIdleThoughtsScheduler } from './services/idleThoughtsScheduler';
// startIdleThoughtsScheduler();
```

**Key Insight:** v1 is a complete system (280+ lines, 6 thought types, gift messages, calendar, experiences). User wants **clean v2** if idle approach chosen—**purpose-built for storylines only** (~150 lines, no legacy features).

#### 3. Existing Safety Controls ✅

**Open Loop System:**
- 4-hour surface cooldown (`presenceDirector.ts:87`)
- Max 20 active loops (`loopCleanupService.ts:27`)
- 7-day age expiration (`loopCleanupService.ts:24`)
- Salience ≥0.85 protection (never expires)

**Promise Tracking:**
- 5-minute background checker (`backgroundJobs.ts:44`) ✅ ACTIVE
- Fixed 10-minute delay (Phase 1)
- Status: pending → fulfilled/missed/cancelled

**Milestone Callbacks:**
- 50+ interaction gate (`relationshipMilestones.ts:67`)
- 72-hour reference cooldown (`relationshipMilestones.ts:73`)
- Max 3 references per milestone (`relationshipMilestones.ts:70`)

**Confidence Thresholds:**
- User facts: ≥0.8 (`intentService.ts:865`)
- Contradictions: >0.6 (`messageAnalyzer.ts:347`)
- Milestones: >0.6 (`intentService.ts:842`)

**Loop Cleanup (`loopCleanupService.ts`):**
- Age-based: 7 days
- Duplicate detection: ≥50% word overlap
- Cap-based: Max 20 active
- Runs hourly

### What's Missing ❌

1. **No LLM tool** for `create_storyline` or `manage_storyline` (checked `aiSchema.ts`)
2. **No trigger mechanism** in main chat flow
3. **No event-driven detection** of "storyline-worthy" moments
4. **No safety controls** for creation (cooldown, dedupe, observability)
5. **No creation path** (conversation or autonomous)

---

## The Design Gap

### Why Storyline Creation Cannot Happen

**The Problem:** Storylines are a complete feature with no entry point.

```
✅ Phase transitions work (daily processing)
✅ Update generation works (LLM creates phase-specific updates)
✅ Mood integration works (affects energy/warmth)
✅ Prompt injection works (surfaces in conversation)
✅ Closure sequences work (4-day resolution, character facts)

❌ NEW STORYLINES NEVER GET CREATED
```

### Risks When Creation Is Added (Without Safeguards)

**Risk 1: Runaway Creation**
- User mentions new project → storyline created
- User mentions same project 2 hours later → duplicate created
- Result: Database flooded, Kayley repeats same announcements

**Risk 2: Poor User Experience**
- Every casual mention becomes a "life event"
- User: "I might take a class" → Kayley creates storyline → overcommitment
- Too many storylines → overwhelming

**Risk 3: Cost Spikes**
- LLM calls for generation without rate limiting
- Multiple daily updates across multiple storylines
- Background processing without caps

**Risk 4: Broken Constraint**
- "One active storyline" constraint enforced at CRUD layer
- Multiple creation sources (conversation + idle + calendar) → race conditions
- Example: User mentions project at 10:00, idle scheduler generates at 10:01 → both try to create

**Risk 5: Repetitive Content**
- "I'm learning guitar!" (announces storyline)
- "I'm learning guitar!" (announces again 3 days later, no memory of first)
- Same announcement repeated

### Future Constraint: Category Concurrency

**Current:** Only 1 active storyline total (any category)
**Future:** Only 1 active storyline **per category**

```typescript
// Current check:
.is('outcome', null)  // Any active blocks creation

// Future check:
.is('outcome', null)
.eq('category', input.category)  // Only block if same category active
```

**Example (Multi-Category):**
```
Active:
- Work: "Learning new framework" (active phase)
- Creative: "Writing short story" (honeymoon phase)
- Social: "Planning reunion trip" (announced phase)

User: "I'm thinking about grad school"
Kayley: Creates "Considering grad school" (work) → ❌ BLOCKED
Reason: Work category already has active storyline

User: "My family is dealing with health issues"
Kayley: Creates "Family health challenges" (family) → ✅ ALLOWED
Reason: No active family storyline
```

---


### Path B: Clean Idle Thoughts v2

**Summary:** NEW minimal idle service purpose-built for storyline creation. Generates suggestions during absence, surfaces in conversation, Kayley validates before creating.

**⚠️ IMPORTANT:** This is a **NEW, CLEAN implementation**, NOT activation of idle thoughts v1. No gift messages, no calendar awareness, no experiences—just storyline suggestions.

**Architecture:**
- New service: `storylineIdleService.ts` (~150 lines)
- Single purpose: Generate storyline-worthy life events during absence
- Two-stage: Suggestion → Conversation → Validation → Creation

**Trigger Mechanism:**
```
User absent ≥30 minutes
  ↓
Scheduler checks (every 10 min)
  ↓
If no cooldown active:
  Generate ONE potential storyline idea via LLM
  Store as "pending storyline suggestion" (new table)
  Does NOT auto-create storyline
  ↓
User returns
  ↓
If pending suggestion exists:
  Add to ongoing threads (intensity 0.7)
  Surfaces in conversation naturally
  ↓
LLM sees thread: "You've been thinking about learning guitar"
LLM decides: "Should I announce this?" → Calls create_life_storyline
  ↓
Safety checks: cooldown → dedupe → category constraint
  ↓
If pass: Create storyline
If fail: Accept gracefully
```

**Example Flow:**
```
9:00 AM - User chats, lastInteractionAt = 9:00
9:30 AM - User closes app
9:40 AM - Scheduler: User away 40 min ≥ 30 min threshold
          → generateStorylineSuggestion() via LLM (based on Kayley Life Story, Conversation History. It has to make sense to Kayley personality.. For example she would never get a tattoo)
          → Suggestion: "Learning guitar" (creative category)
          → Saved to storyline_pending_suggestions table
          → NOT created yet

6:00 PM - User returns, sends message
6:00 PM - getPendingSuggestion() finds "Learning guitar"
          → createUserThreadAsync("I've been thinking about learning guitar", intensity 0.7)
          → selectProactiveThread() picks this thread (high intensity)
6:00 PM - System prompt includes: "You've been thinking about learning guitar"
6:00 PM - Kayley: "Hey! I've been thinking... I want to learn guitar. Like, really learn it."
          → LLM calls create_life_storyline({ title: "Learning guitar", ... })
          → Safety checks pass → Storyline created
6:00 PM - clearPendingSuggestion() removes suggestion
```

**Data Needed:**
- `conversation_history.created_At` however this is in UTC and needs to be converted to CST back locally (detect absence)
- Character profile (Kayley's interests, current life context)
- Active storylines (avoid duplicates, category balance)
- Recent conversation topics (avoid repetition)

**Safety Controls:**
- **Absence threshold:** 30 minutes (conservative, higher than v1's 10 min)
- **Generation cooldown:** 48-hour cooldown between suggestions
- **Max pending:** 1 pending suggestion at a time (replace if user doesn't return)
- **Category awareness:** Suggests storylines in underrepresented categories
- **Conversation validation:** LLM must approve before creating (human-in-loop feel)
- **Expiration:** Suggestions expire after 24 hours

**Implementation Scope:**
```typescript
// NEW FILE: src/services/storylineIdleService.ts (~150 lines)

interface PendingStorylineSuggestion {
  id: string;
  category: StorylineCategory;
  theme: string;  // "learning guitar", "trip planning", "creative project"
  reasoning: string;  // Why this matters to Kayley now
  createdAt: Date;
  expiresAt: Date;  // 24 hours
}

export async function startStorylineIdleService(): Promise<void>;
export async function stopStorylineIdleService(): Promise<void>;
export async function checkForStorylineSuggestion(): Promise<void>;
export async function generateStorylineSuggestion(): Promise<PendingStorylineSuggestion | null>;
export async function getPendingSuggestion(): Promise<PendingStorylineSuggestion | null>;
export async function clearPendingSuggestion(id: string): Promise<void>;
```

**New Database Table:**
```sql
CREATE TABLE storyline_pending_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  theme TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  surfaced BOOLEAN NOT NULL DEFAULT FALSE,
  surfaced_at TIMESTAMPTZ
);
```

**Integration:**
- `src/App.tsx`: Start service alongside promise checker
- `src/services/ongoingThreads.ts`: Convert suggestion → thread
- `src/services/aiSchema.ts`: Add `create_life_storyline` tool (same as Path A)

**Pros:**
- ✅ Kayley feels autonomous (has life between conversations)
- ✅ Clean architecture (no v1 baggage, purpose-built)
- ✅ Purpose-built for storylines (first feature in v2)
- ✅ Conservative (30-min threshold, 24h cooldown, LLM validation)
- ✅ Separates suggestion from creation (safer than auto-create)
- ✅ Easy to expand later (add more idle features if desired)

**Cons:**
- ❌ More complex than conversation-only (~150 lines new service)
- ❌ Requires app to be open (like promise checker)
- ❌ Background debugging is harder (async, setInterval)
- ❌ Two-stage process adds latency (suggestion → validation)

**Expansion Path:**
- Phase 1 (Weeks 1-2): Idle suggestions + conversation tool ✅
- Phase 2 (Weeks 3-4): Multiple categories, relax cooldown
- Phase 3 (Weeks 5-8): Add calendar integration, promise integration to idle service
- Phase 4 (Week 9+): Add other idle features (experiences, gift messages) to v2 if desired

---


## Safety Controls Design

### Common to All Paths

#### 1. Cooldown System

**Database Schema:**
```sql
-- Add to storyline_config table
ALTER TABLE storyline_config
ADD COLUMN last_storyline_created_at TIMESTAMPTZ;

-- Set initial value (allow immediate creation on first try)
UPDATE storyline_config
SET last_storyline_created_at = NOW() - INTERVAL '25 hours'
WHERE id = 1;
```

**Implementation:**
```typescript
interface CooldownCheck {
  allowed: boolean;
  lastCreatedAt: Date | null;
  hoursRemaining: number;
}

async function checkStorylineCreationCooldown(): Promise<CooldownCheck> {
  const COOLDOWN_HOURS = 48; // Phase 1: 48h

  const { data } = await supabase
    .from('storyline_config')
    .select('last_storyline_created_at')
    .eq('id', 1)
    .single();

  if (!data?.last_storyline_created_at) {
    return { allowed: true, lastCreatedAt: null, hoursRemaining: 0 };
  }

  const lastCreated = new Date(data.last_storyline_created_at);
  const hoursSince = (Date.now() - lastCreated.getTime()) / (1000 * 60 * 60);

  if (hoursSince < COOLDOWN_HOURS) {
    return {
      allowed: false,
      lastCreatedAt: lastCreated,
      hoursRemaining: Math.ceil(COOLDOWN_HOURS - hoursSince)
    };
  }

  return { allowed: true, lastCreatedAt: lastCreated, hoursRemaining: 0 };
}

async function updateStorylineCreationCooldown(): Promise<void> {
  await supabase
    .from('storyline_config')
    .update({ last_storyline_created_at: new Date().toISOString() })
    .eq('id', 1);
}
```


#### 2. Semantic Deduplication

**Algorithm:**
```typescript
async function checkDuplicateStoryline(
  title: string,
  category: StorylineCategory
): Promise<boolean> {
  const DEDUPE_WINDOW_DAYS = 7;
  const SIMILARITY_THRESHOLD = 0.6;

  // Get recent storylines in same category
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - DEDUPE_WINDOW_DAYS);

  const { data } = await supabase
    .from('life_storylines')
    .select('title, created_at')
    .eq('category', category)
    .gte('created_at', windowStart.toISOString())
    .order('created_at', { ascending: false });

  if (!data || data.length === 0) return false;

  // Fuzzy title matching (word overlap)
  const normalizedTitle = title.toLowerCase().trim();

  for (const existing of data) {
    const existingTitle = existing.title.toLowerCase().trim();
    const similarity = calculateStringSimilarity(normalizedTitle, existingTitle);

    if (similarity >= SIMILARITY_THRESHOLD) {
      console.warn(`📖 [Storylines] Duplicate: "${title}" ~= "${existing.title}" (${similarity})`);
      return true;
    }
  }

  return false;
}

function calculateStringSimilarity(str1: string, str2: string): number {
  // Simple word overlap ratio (same as loop cleanup)
  const words1 = new Set(str1.split(/\s+/));
  const words2 = new Set(str2.split(/\s+/));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}
```

**Examples:**
- "Learning guitar" vs "Guitar lessons" = 50% overlap → ✅ Allowed
- "Learning guitar" vs "Learning to play guitar" = 75% overlap → ❌ Blocked (duplicate)
- "Job search" vs "Looking for new job" = 60% overlap → ❌ Blocked (duplicate)

#### 3. Category Constraint

**Phase 1: Global Constraint**
```typescript
async function checkCategoryConstraint(
  category: StorylineCategory
): Promise<{ allowed: boolean; activeStoryline?: LifeStoryline }> {
  // Phase 1: Check if ANY active storyline exists
  const { data } = await supabase
    .from('life_storylines')
    .select('*')
    .is('outcome', null)
    .limit(1);

  if (data && data.length > 0) {
    return { allowed: false, activeStoryline: data[0] };
  }

  return { allowed: true };
}
```

**Phase 2: Per-Category Constraint**
```typescript
async function checkCategoryConstraint(
  category: StorylineCategory
): Promise<{ allowed: boolean; activeStoryline?: LifeStoryline }> {
  // Phase 2: Check if active storyline IN THIS CATEGORY exists
  const { data } = await supabase
    .from('life_storylines')
    .select('*')
    .is('outcome', null)
    .eq('category', category)  // ← NEW: Per-category filter
    .limit(1);

  if (data && data.length > 0) {
    return { allowed: false, activeStoryline: data[0] };
  }

  return { allowed: true };
}
```

#### 4. Audit Logging & Observability

**New Table:**
```sql
CREATE TABLE storyline_creation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  failure_reason TEXT,  -- 'cooldown_active' | 'duplicate_detected' | 'category_constraint' | 'db_error'
  cooldown_hours_remaining INTEGER,
  duplicate_match TEXT,  -- Title of duplicate if found
  active_storyline_blocking UUID REFERENCES life_storylines(id)
);

CREATE INDEX idx_creation_attempts_time ON storyline_creation_attempts(attempted_at DESC);
CREATE INDEX idx_creation_attempts_success ON storyline_creation_attempts(success);
```

**Logging Pattern:**
```typescript
console.log(`📖 [Storylines] Tool called: create_life_storyline`);
console.log(`📖 [Storylines] Input: ${JSON.stringify(input)}`);
console.log(`📖 [Storylines] Cooldown: ${cooldown.allowed ? 'PASS' : 'FAIL'}`);
console.log(`📖 [Storylines] Duplicate: ${isDuplicate ? 'DUPLICATE' : 'UNIQUE'}`);
console.log(`📖 [Storylines] Category: ${categoryCheck.allowed ? 'PASS' : 'BLOCKED'}`);
console.log(`📖 [Storylines] Result: ${success ? 'CREATED' : 'FAILED'}`);

// Store attempt
await supabase.from('storyline_creation_attempts').insert({
  title: input.title,
  category: input.category,
  success,
  failure_reason: success ? null : reason,
  cooldown_hours_remaining: cooldown.hoursRemaining,
  duplicate_match: isDuplicate ? duplicateTitle : null,
  active_storyline_blocking: categoryCheck.activeStoryline?.id || null
});
```

**Observability Queries:**
```sql
-- Creation success rate
SELECT
  DATE_TRUNC('day', attempted_at) AS day,
  COUNT(*) AS total_attempts,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successful,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate
FROM storyline_creation_attempts
GROUP BY day
ORDER BY day DESC;

-- Failure reason breakdown
SELECT
  failure_reason,
  COUNT(*) AS count
FROM storyline_creation_attempts
WHERE success = FALSE
GROUP BY failure_reason
ORDER BY count DESC;

-- Category distribution
SELECT
  category,
  COUNT(*) AS attempts,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS created
FROM storyline_creation_attempts
GROUP BY category
ORDER BY attempts DESC;
```

---

## Rollout Strategy

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Get storylines creating reliably with strong safety controls

**Implementation:**
1. Add `create_life_storyline` tool to `aiSchema.ts`
2. Implement `createStorylineFromTool()` in `storylineService.ts`
3. Add safety functions (cooldown, dedupe, category check)
4. Add database migration for `last_storyline_created_at`
5. Document in `toolsAndCapabilities.ts`
6. Add tool to `memoryService.ts` executor
7. Update snapshot tests

**Additional for Path B :**
- Implement `storylineIdleService.ts`
- Add `storyline_pending_suggestions` table
- Start service in `App.tsx`
- Integrate with `ongoingThreads.ts`

**Safety Configuration:**
- Global cooldown: 48 hours
- Dedupe window: 7 days, 60% similarity
- Category constraint: 1 total active storyline
- Confidence: 0.8+ (high bar)

**Testing:**
- Manual: Trigger creation in conversation
- Verify: Cooldown blocks second attempt
- Verify: Duplicate detection works
- Verify: Category constraint blocks when active exists
- Monitor: `storyline_creation_attempts` table

**Success Criteria:**
- ✅ Storyline created successfully
- ✅ Cooldown prevents spam
- ✅ Duplicate detection prevents repetition
- ✅ Daily processing continues (phases, updates)
- ✅ Storylines surface in conversation

---

### Phase 2: Expansion (Weeks 3-4)

**Goal:** Relax constraints, enable multiple categories

**Implementation:**
1. Keep Cooldown at 48 hours
2. Add per-category constraint (replace global)
3. Update tool description (remove "only 1 allowed")
4. Add daily cap: 2 total creations

**Safety Configuration:**
- Global cooldown: 48 hours
- Per-category cooldown: 48 hours (new)
- Category constraint: 1 per category (new)
- Daily cap: 2 total (new)

**Testing:**
- Create "work" storyline
- Create "creative" storyline (should succeed)
- Try second "work" storyline (should fail)
- Wait 12 hours, create "personal" (should succeed)

**Success Criteria:**
- ✅ Multiple active storylines (different categories)
- ✅ Per-category constraint enforced
- ✅ User life feels balanced (not single-threaded)

---

### Phase 3: Autonomy (Weeks 5-8) - For Path C Only

**Goal:** Add autonomous storyline creation (idle thoughts v2)

**Implementation:**
1. Implement `storylineIdleService.ts` (~150 lines)
2. Start service in `App.tsx`
3. Connect to `ongoingThreads.ts` for surfacing
4. Coordinate cooldowns (shared `storyline_config` state)

**Safety Configuration:**
- Daily cap: 3 total creations
- Idle confidence: 0.7+ (medium)
- Conversation confidence: 0.8+ (high)

**Testing:**
- Trigger idle suggestion (wait 30+ min)
- Verify suggestion stored, not auto-created
- Return to conversation, verify surfaces
- Verify creation respects cooldown
- Test race conditions (conversation + idle)

**Success Criteria:**
- ✅ Kayley has autonomous life
- ✅ Storylines feel organic (not just user-driven)
- ✅ Cooldowns prevent flooding

---

### Phase 4: Polish (Week 9+) - All Paths

**Goal:** Optimize, refine, add enhancements

**Implementation:**
1. Add calendar event → storyline consideration
2. Add promise fulfillment → storyline hooks
3. Refine confidence scoring (learn from usage)
4. UI for observability (optional)
5. Analytics dashboard

**Safety Configuration:**
- Per-category cooldown: 24 hours (stable)
- Daily cap: 2 total (max)

---

## Decision Framework



### Scenario-Based Selection

**Scenario 1: You want to ship fast**
- Choose: **Path A**
- Reason: Simplest implementation (~200 lines), works immediately, no background complexity

**Scenario 2: Kayley must feel autonomous from the start**
- Choose: **Path B**
- Reason: Clean idle thoughts v2, generates storylines while user away, "has a life"

**Scenario 3: You're unsure if storylines will work as designed**
- Choose: **Path C** (recommended)
- Reason: Validate with Path A first (low risk), add autonomy later if feature works well

**Scenario 4: You want to minimize code changes**
- Choose: **Path A**
- Reason: No new services, no new tables (except one column), uses existing infrastructure

**Scenario 5: You want best long-term architecture**
- Choose: **Path B** or **Path C**
- Reason: Clean idle v2 is purpose-built, no legacy baggage, expandable foundation

---

## Next Steps

### Files to Modify (Phase 1)

**Common (All Paths):**
1. `src/services/storylineService.ts` - Add tool handler, safety functions (~150 lines)
2. `src/services/aiSchema.ts` - Add tool declaration (~30 lines)
3. `src/services/memoryService.ts` - Add tool executor (~5 lines)
4. `src/services/toolsAndCapabilities.ts` - Document tool (~20 lines)
5. `supabase/migrations/` - Add `last_storyline_created_at` column (~10 lines)
6. `src/services/__tests__/storylineService.test.ts` - Add tests (~200 lines)
7. `src/services/storylineIdleService.ts` - New service (~150 lines)
8. `src/App.tsx` - Start idle service (~5 lines)
9. `src/services/ongoingThreads.ts` - Integrate suggestions (~20 lines)
10. `supabase/migrations/` - Add `storyline_pending_suggestions` table (~15 lines)
11. `src/services/__tests__/storylineIdleService.test.ts` - Tests (~200 lines)

### Key Implementation References

**Existing Safety Patterns (to follow):**
- Loop cleanup: `src/services/loopCleanupService.ts` (dedupe, age, cap)
- Promise checker: `src/services/backgroundJobs.ts` (setInterval pattern)
- Intent caching: `src/services/intentService.ts` (TTL, cache invalidation)
- Milestone cooldowns: `src/services/relationshipMilestones.ts` (time-based gates)

**Tool Integration Checklist:**
Follow `docs/Tool_Integration_Checklist.md` (8 steps)
