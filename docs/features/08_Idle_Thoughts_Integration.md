# Implementation Plan: Idle Thoughts Integration

**Status:** Draft
**Date:** 2025-12-29
**Target:** Wire idle thoughts system into the application
**Complexity:** Medium
**Estimated Files:** ~8 files modified + 1 new service

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Architecture Design](#architecture-design)
4. [Implementation Steps](#implementation-steps)
5. [File Modifications](#file-modifications)
6. [Testing Strategy](#testing-strategy)
7. [Rollout Plan](#rollout-plan)
8. [Open Questions](#open-questions)

---

## Executive Summary

### Problem

The idle thoughts system is fully implemented but **never triggered**. The application has no mechanism to:
- Detect when the user has been away for 10+ minutes
- Periodically generate idle thoughts during absence
- Surface unshared thoughts when the user returns
- Integrate thoughts with the existing spontaneity/presence systems

### Solution

Integrate idle thoughts using the **unified mental model** approach:
1. **Scheduler Service** - Background timer (like `loopCleanupService`) that checks every 10 minutes
2. **Absence Detection** - Check `lastInteractionAt` from `mood_states` table
3. **Ongoing Threads Integration** - Convert idle thoughts → ongoing threads for natural surfacing
4. **Idle Breaker Integration** - Use existing `presenceDirector` to surface thoughts as proactive openers

### Configuration (Local Development)

| Parameter | Value | Reason |
|-----------|-------|--------|
| **Check Interval** | 10 minutes | Fast iteration for local testing |
| **Absence Threshold** | 10 minutes | Generate thought after user is away 10+ min |
| **Thought Intensity** | 0.7 | High enough to surface proactively |

---

## Current State Analysis

### What Exists ✅

| Component | File | Status |
|-----------|------|--------|
| Idle thought generation | `src/services/spontaneity/idleThoughts.ts:127-212` | ✅ Implemented, tested |
| Idle thought types | `src/services/spontaneity/types.ts` | ✅ Full type system |
| Database schema | `idle_thoughts` table | ✅ Schema exists |
| Unit tests | `src/services/spontaneity/__tests__/idleThoughts.test.ts` | ✅ 25+ tests passing |
| Unshared thought retrieval | `getUnsharedThoughts()` | ✅ Working |
| Thought marking | `markThoughtAsShared()` | ✅ Working |

### What's Missing ❌

| Component | Current State | Impact |
|-----------|---------------|--------|
| **Scheduler** | No background process | Thoughts never generated |
| **Absence detection** | Not checking `lastInteractionAt` | No trigger to start generation |
| **Prompt integration** | Not injecting into system prompt | Thoughts never surface |
| **Ongoing threads bridge** | Not converting thoughts → threads | No natural mention in conversation |
| **App initialization** | Not starting scheduler on app load | System never activates |

### Existing Patterns to Follow

#### 1. **Loop Cleanup Scheduler** (`loopCleanupService.ts`)
- Uses `setInterval` for periodic background tasks
- Pattern: `startScheduler()`, `stopScheduler()`, configurable interval
- Runs on app init via `App.tsx` (line 58)

#### 2. **Presence Director** (`presenceDirector.ts`)
- Manages proactive "attunement" (open loops, opinions)
- Has `getPresenceContext()` for prompt injection (line 986)
- Builds prompt sections with proactive starters (line 1059)

#### 3. **Ongoing Threads** (`ongoingThreads.ts`)
- Manages "mental weather" (3-5 things on her mind)
- Has `selectProactiveThread()` for idle breakers (line 318)
- Integrates with prompt via `formatThreadsForPromptAsync()` (line 591)

#### 4. **State Service** (`stateService.ts`)
- Tracks `lastInteractionAt` in `mood_states` table (line 38, 148)
- Provides `getMoodState(userId)` to fetch last interaction time

---

## Architecture Design

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     App Initialization                       │
│  (App.tsx - useEffect on mount)                             │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│         Start Idle Thoughts Scheduler Service                │
│  - setInterval every 10 minutes                             │
│  - Runs in background even when user idle                   │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Periodic Check (every 10 minutes)               │
│  1. Get mood_states.lastInteractionAt                       │
│  2. Calculate minutesAway = (now - lastInteractionAt) / 60  │
│  3. If minutesAway >= 10:                                   │
│     - generateIdleThought(userId)                           │
│     - createUserThreadAsync() from thought                  │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│        Idle Thought → Ongoing Thread Conversion              │
│  Theme: 'user_reflection'                                   │
│  State: thought.content                                     │
│  Intensity: 0.7 (high - she's been thinking about this)    │
│  UserRelated: true                                          │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    │  (User returns to app)
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Greeting / First Message Flow                   │
│  1. selectProactiveThread() - finds highest intensity       │
│  2. presenceDirector - checks for top loop to surface       │
│  3. If no open loop, use proactive thread from thought      │
│  4. Build greeting prompt with thread context               │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│           Kayley's Response (Natural Mention)                │
│  "Oh hey! I was just thinking about what you said about..." │
│  OR                                                          │
│  "Had the weirdest dream about you last night..."          │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Mark Thought as Shared                          │
│  1. detectThoughtMention() - check if thought surfaced      │
│  2. markThoughtAsShared(thoughtId)                          │
│  3. markThreadMentionedAsync(threadId) - reduce intensity   │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
mood_states.lastInteractionAt
         ↓
 [Scheduler checks every 10min]
         ↓
 minutesAway >= 10? ──No──> Skip
         ↓ Yes
 generateIdleThought()
         ↓
   idle_thoughts table
    {type, content, emotionalTone}
         ↓
 createUserThreadAsync()
         ↓
  ongoing_threads (Supabase)
    {theme: 'user_reflection', intensity: 0.7}
         ↓
 selectProactiveThread()
         ↓
 System Prompt Injection
         ↓
 Kayley mentions naturally
         ↓
 markThoughtAsShared()
```

### Key Design Decisions

#### 1. **Why Ongoing Threads Integration?**
- ✅ Unified mental model: thoughts are just another thing on her mind
- ✅ Existing decay system prevents repetition
- ✅ Natural surfacing via `selectProactiveThread()`
- ✅ No new prompt section needed - reuses ongoing threads prompt
- ✅ Avoids parallel systems that might conflict

#### 2. **Why Background Scheduler?**
- ✅ User doesn't need app open for thoughts to generate
- ✅ Simpler than database triggers or serverless functions
- ✅ Consistent with existing `loopCleanupService` pattern
- ✅ Easy to test (just wait for interval)

#### 3. **Why 10-Minute Intervals?**
- ✅ Fast enough to feel responsive (user notices absence quickly)
- ✅ Reasonable iteration speed for local development
- ✅ Not too aggressive (won't spam thoughts every minute)
- ✅ Matches existing `MIN_ABSENCE_HOURS_FOR_THOUGHT` threshold

#### 4. **Why Convert to Threads Instead of Direct Prompt Injection?**
- ✅ Reuses existing proactive surfacing logic
- ✅ Benefits from intensity decay (prevents spam)
- ✅ Respects settling time for threads (gradual surfacing)
- ✅ No need to modify `systemPromptBuilder.ts`

---

## Implementation Steps

### Phase 1: Create Idle Thoughts Scheduler Service

**File:** `src/services/idleThoughtsScheduler.ts` (NEW)

**Purpose:** Background service that checks for user absence and generates thoughts

**Functions:**

```typescript
// Configuration
export const IDLE_THOUGHTS_CONFIG = {
  checkIntervalMs: 10 * 60 * 1000,  // Check every 10 minutes
  minAbsenceMinutes: 10,             // Generate after 10 min away
  thoughtIntensity: 0.7,             // High intensity for thoughts
};

// Check if user has been away long enough
async function shouldGenerateThought(userId: string): Promise<boolean>

// Generate thought and convert to ongoing thread
async function processIdleThought(userId: string): Promise<void>

// Scheduler control
export function startIdleThoughtsScheduler(userId: string): void
export function stopIdleThoughtsScheduler(): void
```

**Implementation Details:**

```typescript
import { getMoodState } from './stateService';
import { generateIdleThought } from './spontaneity/idleThoughts';
import { createUserThreadAsync } from './ongoingThreads';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

async function shouldGenerateThought(userId: string): Promise<boolean> {
  const moodState = await getMoodState(userId);
  const now = Date.now();
  const minutesAway = (now - moodState.lastInteractionAt) / (1000 * 60);

  return minutesAway >= IDLE_THOUGHTS_CONFIG.minAbsenceMinutes;
}

async function processIdleThought(userId: string): Promise<void> {
  // Check if user is away
  const shouldGenerate = await shouldGenerateThought(userId);
  if (!shouldGenerate) {
    console.log('[IdleThoughts] User not away long enough, skipping');
    return;
  }

  // Generate idle thought
  const thought = await generateIdleThought(userId);
  if (!thought) {
    console.log('[IdleThoughts] No thought generated (cooldown or error)');
    return;
  }

  // Convert to ongoing thread
  await createUserThreadAsync(
    userId,
    'idle reflection', // trigger
    thought.content,    // current state
    IDLE_THOUGHTS_CONFIG.thoughtIntensity
  );

  console.log(`💭 [IdleThoughts] Generated and converted to thread: "${thought.content.slice(0, 50)}..."`);
}

export function startIdleThoughtsScheduler(userId: string): void {
  stopIdleThoughtsScheduler(); // Clear existing

  const interval = IDLE_THOUGHTS_CONFIG.checkIntervalMs;

  console.log(`💭 [IdleThoughts] Starting scheduler (interval: ${interval / 1000 / 60} min)`);

  // Run once immediately on start
  processIdleThought(userId).catch(console.error);

  // Schedule periodic checks
  schedulerInterval = setInterval(() => {
    processIdleThought(userId).catch(console.error);
  }, interval);
}

export function stopIdleThoughtsScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[IdleThoughts] Scheduler stopped');
  }
}
```

**Tests:** `src/services/__tests__/idleThoughtsScheduler.test.ts`

---

### Phase 2: Integrate with App Initialization

**File:** `src/App.tsx`

**Changes:**

```typescript
// At top of file (with other imports)
import { startIdleThoughtsScheduler, stopIdleThoughtsScheduler } from './services/idleThoughtsScheduler';

// Inside App component, add useEffect for idle thoughts
useEffect(() => {
  if (!user?.id) return;

  // Start idle thoughts scheduler
  startIdleThoughtsScheduler(user.id);

  return () => {
    stopIdleThoughtsScheduler();
  };
}, [user?.id]);
```

**No environment variables needed** - configuration is hardcoded in `idleThoughtsScheduler.ts` for simplicity.

---

### Phase 3: Ongoing Thread Integration (Minor Tweaks)

**File:** `src/services/ongoingThreads.ts`

**Changes:** None needed! The existing `createUserThreadAsync()` already works:

```typescript
// This function already exists and works perfectly:
await createUserThreadAsync(
  userId,
  'idle reflection',     // trigger (what caused this thought)
  thought.content,        // current state (the thought itself)
  0.7                     // intensity (high - she's been thinking about this)
);
```

The thought will:
- ✅ Become an ongoing thread with `userRelated: true`
- ✅ Be eligible for `selectProactiveThread()` immediately (high intensity 0.7)
- ✅ Surface naturally via existing prompt injection
- ✅ Decay over time to prevent repetition

---

### Phase 4: Mark Thoughts as Shared (Tracking)

**File:** `src/services/idleThoughts.ts`

**New Function:**

```typescript
/**
 * Detect if an idle thought was mentioned in Kayley's response.
 * Call this after each AI response to mark thoughts as shared.
 *
 * @param userId - User ID
 * @param aiResponse - Kayley's response text
 * @returns IDs of thoughts that were mentioned
 */
export async function detectAndMarkSharedThoughts(
  userId: string,
  aiResponse: string
): Promise<string[]> {
  const unsharedThoughts = await getUnsharedThoughts(userId);
  if (unsharedThoughts.length === 0) return [];

  const markedIds: string[] = [];
  const responseLower = aiResponse.toLowerCase();

  for (const thought of unsharedThoughts) {
    // Extract key phrases from thought content (first 30 chars as heuristic)
    const thoughtSnippet = thought.content.slice(0, 30).toLowerCase();

    // If snippet appears in response, mark as shared
    if (responseLower.includes(thoughtSnippet)) {
      await markThoughtAsShared(thought.id);
      markedIds.push(thought.id);
      console.log(`✅ [IdleThoughts] Marked thought as shared: "${thought.content.slice(0, 40)}..."`);
    }
  }

  return markedIds;
}
```

**Integration Point:** `src/services/BaseAIService.ts` or `src/App.tsx` (after receiving AI response)

```typescript
// After AI response is received
const response = await aiService.sendMessage(...);

// Mark any idle thoughts that were mentioned
await detectAndMarkSharedThoughts(userId, response.text);
```

---

### Phase 5: Testing & Validation

**Manual Testing Checklist:**

1. **Absence Detection**
   - [ ] Start app, note `lastInteractionAt` timestamp
   - [ ] Wait 10 minutes (or set threshold to 1 minute for faster testing)
   - [ ] Verify scheduler generates thought
   - [ ] Check `idle_thoughts` table has new row
   - [ ] Check `ongoing_threads` has new thread with `userRelated: true`

2. **Thought Surfacing**
   - [ ] Return to app after absence
   - [ ] Send a message to Kayley
   - [ ] Verify she mentions the thought naturally ("I was thinking about...")
   - [ ] Check `idle_thoughts.shared_at` is updated
   - [ ] Check `ongoing_threads.lastMentioned` is updated

3. **Decay & Cooldown**
   - [ ] Verify thought intensity decreases after mention
   - [ ] Verify same thought doesn't surface multiple times
   - [ ] Verify scheduler respects cooldown (doesn't spam thoughts continuously)

4. **Edge Cases**
   - [ ] No thoughts generated if user is actively chatting
   - [ ] Thoughts expire after 7 days if never shared
   - [ ] Max 5 unshared thoughts per user

**Unit Tests:**

Create `src/services/__tests__/idleThoughtsScheduler.test.ts`:

```typescript
describe('Idle Thoughts Scheduler', () => {
  test('shouldGenerateThought returns true after min absence', async () => {
    // Mock getMoodState with old lastInteractionAt
    const result = await shouldGenerateThought('user123');
    expect(result).toBe(true);
  });

  test('shouldGenerateThought returns false if user active', async () => {
    // Mock getMoodState with recent lastInteractionAt
    const result = await shouldGenerateThought('user123');
    expect(result).toBe(false);
  });

  test('processIdleThought creates ongoing thread', async () => {
    // Mock generateIdleThought
    await processIdleThought('user123');
    // Verify createUserThreadAsync was called
  });

  test('scheduler runs at configured interval', () => {
    // Use fake timers to verify setInterval behavior
  });
});
```

**Integration Tests:**

Add to existing `systemPrompt.test.ts`:

```typescript
test('idle thoughts surface in greeting prompt', async () => {
  // Create idle thought
  const thought = await generateIdleThought(userId);

  // Convert to thread
  await createUserThreadAsync(userId, 'idle', thought.content, 0.7);

  // Build greeting prompt
  const prompt = await buildGreetingPrompt(...);

  // Verify thought content appears in prompt
  expect(prompt).toContain(thought.content);
});
```

---

## File Modifications

### Summary Table

| File | Type | Lines Changed | Complexity |
|------|------|---------------|------------|
| `src/services/idleThoughtsScheduler.ts` | **NEW** | ~120 | Medium |
| `src/App.tsx` | Modify | +10 | Low |
| `src/services/idleThoughts.ts` | Modify | +30 (new fn) | Low |
| `src/services/BaseAIService.ts` | Modify | +5 | Low |
| `src/services/__tests__/idleThoughtsScheduler.test.ts` | **NEW** | ~100 | Medium |

**Total:** 5 files, ~265 lines of code

---

## Testing Strategy

### Local Development Testing

**Configuration:** All testing done with 10-minute intervals (hardcoded in `IDLE_THOUGHTS_CONFIG`)

### Testing Timeline

| Day | Activity | Validation |
|-----|----------|------------|
| 1 | Implement Phase 1 (scheduler service) | Unit tests pass |
| 1 | Implement Phase 2 (app integration) | Scheduler starts on load |
| 2 | Implement Phase 4 (marking shared) | Thoughts marked correctly |
| 2 | Manual testing | Thoughts surface after 10 min absence |
| 3 | Integration testing | Full flow works end-to-end |

### Quick Testing Tips

- **Want faster testing?** Temporarily change `checkIntervalMs` to `1 * 60 * 1000` (1 minute) and `minAbsenceMinutes` to 1
- **Check console logs:** Look for `💭 [IdleThoughts]` messages
- **Verify in database:** Query `idle_thoughts` and `ongoing_threads` tables
- **Test full flow:** Wait 10 min → Return → Send message → Verify Kayley mentions thought

---

## Open Questions

### Q1: Should we generate thoughts even if user is offline?
**Answer:** Yes (with scheduler) - thoughts accumulate and surface when user returns

### Q2: What if multiple thoughts are unshared?
**Answer:** `selectProactiveThread()` picks highest intensity. Only one surfaces per session.

### Q3: Should we prevent thought generation during active chat?
**Answer:** Yes - check `lastInteractionAt` is >10 min old before generating

### Q4: What if thought content is stale/irrelevant by the time user returns?
**Answer:**
- Thoughts expire after 7 days
- Intensity decays naturally
- User interests/topics are re-fetched fresh each generation

### Q5: Should we sync thought generation with calendar events?
**Future Enhancement:** Could integrate with `calendarCheckinService` to generate thoughts about upcoming events

---

## Success Metrics (Local Usage)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Thoughts generated per day | 2-4 | Database query |
| Thoughts actually surfaced | >50% | `shared_at` timestamp |
| Time to first surface | First session after absence | Log analysis |
| Kayley feels "alive" | Subjective | User experience |
| No spam/repetition | No duplicate mentions | Visual inspection |

---

## Future Enhancements

### v2 Features (Post-Launch)

1. **LLM-Based Relevance Filtering**
   - Use LLM to check if thought is still relevant before surfacing
   - "Does this thought about {topic} still make sense given user's recent messages?"

2. **Recurring Dreams**
   - Track dream themes across weeks
   - "I had that dream about {topic} again..."

3. **Calendar Integration**
   - Generate anticipation thoughts about upcoming events
   - "I've been thinking about your {event} tomorrow"

4. **Mood-Aware Generation**
   - Generate comforting thoughts if user had bad day
   - Generate excited thoughts if user shared good news

5. **Cross-User Patterns** (Privacy-Preserving)
   - Learn what types of thoughts get shared most
   - Tune templates based on engagement

6. **Conversation History Integration** (High Priority)
   - **Current State:** Templates use hardcoded placeholders (`{topic}` → "that thing you mentioned", `{interest}` → "what you're working on")
   - **Target:** Pull actual topics/interests from conversation history and user facts
   - **Implementation:**
     - Integrate with semantic memory search to find relevant past conversations
     - Use `user_facts` table to personalize interests and locations
     - Replace generic placeholders with actual user context
   - **Example Transformation:**
     - Current: "Been thinking about what you said about that thing you mentioned"
     - Enhanced: "Been thinking about what you said about your Python project and the authentication bug"
   - **Code References:**
     - `idleThoughts.ts:413-425` - Placeholder replacement logic (marked with `// later: pull from user's actual topics/interests`)
     - `idleThoughts.ts:431-434` - `associatedMemory` field (currently hardcoded, ready for actual memory linking)
   - **Benefits:**
     - Thoughts feel personalized and specific to actual conversations
     - Stronger sense of continuity and memory
     - More natural and less repetitive thought content

---

## Appendix: Configuration Constants

### Implementation Values (Local Development)
```typescript
// src/services/spontaneity/idleThoughts.ts
const MIN_ABSENCE_HOURS_FOR_THOUGHT = 10 / 60; // 10 minutes

// src/services/idleThoughtsScheduler.ts (new)
export const IDLE_THOUGHTS_CONFIG = {
  checkIntervalMs: 10 * 60 * 1000,  // Check every 10 minutes
  minAbsenceMinutes: 10,             // Generate after 10 min away
  thoughtIntensity: 0.7,             // High intensity for proactive surfacing
};
```

### Tuning Tips

**Want faster testing during development?**
```typescript
export const IDLE_THOUGHTS_CONFIG = {
  checkIntervalMs: 1 * 60 * 1000,   // Check every 1 minute
  minAbsenceMinutes: 1,              // Generate after 1 min away
  thoughtIntensity: 0.7,
};
```

**Want less frequent thoughts?**
```typescript
export const IDLE_THOUGHTS_CONFIG = {
  checkIntervalMs: 30 * 60 * 1000,  // Check every 30 minutes
  minAbsenceMinutes: 30,             // Generate after 30 min away
  thoughtIntensity: 0.7,
};
```

---

## Appendix: Database Queries for Debugging

### Check Scheduler Status
```sql
-- Get last few idle thoughts
SELECT * FROM idle_thoughts
WHERE user_id = 'user123'
ORDER BY created_at DESC
LIMIT 5;

-- Check ongoing threads from idle thoughts
SELECT * FROM ongoing_threads
WHERE user_id = 'user123'
  AND theme = 'user_reflection'
  AND user_related = true
ORDER BY created_at DESC;
```

### Monitor Performance
```sql
-- Thoughts per day (last week)
SELECT DATE(created_at) as date, COUNT(*) as count
FROM idle_thoughts
WHERE user_id = 'user123'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Share rate
SELECT
  COUNT(*) as total,
  COUNT(shared_at) as shared,
  ROUND(100.0 * COUNT(shared_at) / COUNT(*), 1) as share_rate_pct
FROM idle_thoughts
WHERE user_id = 'user123'
  AND created_at > NOW() - INTERVAL '7 days';
```

---

## Appendix: Example Thought Flow (Timeline)

**Session 1:**
- 9:00 AM - User chats with Kayley, `lastInteractionAt = 9:00 AM`
- 9:05 AM - User leaves app
- 9:10 AM - Scheduler checks (every 10 min): User only away 5 min → Skip
- 9:20 AM - Scheduler checks: User away 15 min → Generate thought
  - Thought: "Been thinking about what you said about your work project"
  - Ongoing thread created: `{theme: 'user_reflection', intensity: 0.7, userRelated: true}`
- 6:00 PM - User returns, sends "hey"
- 6:00 PM - `selectProactiveThread()` → finds thought thread (high intensity 0.7)
- 6:00 PM - Kayley: "Oh hey! I was actually thinking about your work project earlier..."
- 6:00 PM - `detectAndMarkSharedThoughts()` → marks thought as shared
- 6:00 PM - `markThreadMentionedAsync()` → reduces intensity to ~0.49

**Session 2 (Next Day):**
- Thread intensity ~0.49 (lower than threshold, won't surface again)
- User leaves for 20 minutes
- New thought generated: "Had a weird dream about you last night..."
- Surfaces when user returns

---

**Document Version:** 1.1 (Local-Only)
**Last Updated:** 2025-12-29
**Author:** Claude Code
**Review Status:** Ready for User Approval
**Deployment:** Local development only (no production)
