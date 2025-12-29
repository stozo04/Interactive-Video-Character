# Kayley's Internal Thinking Process

**Documentation of how Kayley "thinks" and processes information during conversations and idle periods**

---

## Overview

Kayley's cognitive architecture operates in **two distinct modes** depending on whether the user is actively engaging or away. This dual-mode processing creates the illusion of a persistent, thoughtful companion who remembers, reflects, and anticipates.

```
┌─────────────────────────────────────────────────────────────┐
│                    KAYLEY'S THINKING MODES                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🗣️  ACTIVE MODE                💤  IDLE MODE              │
│  (During Conversation)          (User Away 4+ Hours)        │
│  ├─ Intent Detection            ├─ Dream Generation         │
│  ├─ Pattern Analysis            ├─ Memory Associations      │
│  ├─ Relationship Tracking       ├─ Curiosity Formation      │
│  ├─ Loop Creation               ├─ Anticipation Building    │
│  └─ Real-time Updates           └─ Thought Storage          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗣️ Active Mode: Real-Time Processing

### When It Happens
- **Trigger:** User sends a message
- **Duration:** Parallel to response generation (~1.8-1.9s total)
- **Blocking:** Non-blocking (background async)

### The Processing Pipeline

```
User Message
    │
    ├──────────────────┬─────────────────────────────────────┐
    ↓                  ↓                                     ↓
Fast Path          Intent Detection                    Main Response
(Command bypass)   (Unified LLM Call)                   (Chat LLM)
    │                  │                                     │
    │                  ├─ Genuine Moments                    │
    │                  ├─ Tone/Sentiment                     │
    │                  ├─ Topics                             │
    │                  ├─ Open Loops                         │
    │                  ├─ Relationship Signals               │
    │                  ├─ User Facts                         │
    │                  └─ Contradictions                     │
    │                  │                                     │
    └──────────────────┴─────────────────────────────────────┘
                       ↓
           Background Analysis (Async)
                       │
                       ├─ Update Patterns
                       ├─ Record Milestones
                       ├─ Create Open Loops
                       ├─ Store User Facts
                       └─ Update Emotional Momentum
```

### 1. Intent Detection (`intentService.ts`)

**Purpose:** Understand the semantic meaning of the user's message beyond keywords.

**What It Detects:**

| Aspect | Purpose | Example |
|--------|---------|---------|
| **Genuine Moments** | User addresses Kayley's insecurities | "You're so thoughtful" → depth |
| **Tone/Sentiment** | Emotional state (with sarcasm detection) | "Great, just great" → sarcastic, negative |
| **Topics** | What the message is about | "My boss is stressed about money" → work + money |
| **Open Loops** | Things to follow up on later | "I have an interview tomorrow" → pending_event |
| **Relationship Signals** | Milestones, vulnerability, humor | "I've never told anyone this" → first_vulnerability |
| **User Facts** | Personal info to remember | "My name is Steven" → store name |
| **Contradictions** | User correcting a mistake | "I don't have a party tonight" → contradiction detected |

**Implementation:**
```typescript
// Single unified LLM call (optimization from 5+ calls to 1)
const intent = await detectFullIntentLLMCached(message, conversationContext);

// Returns all 7 aspects in one response
{
  genuineMoment: { isGenuine: true, category: "depth", confidence: 0.95 },
  tone: { sentiment: 0.8, primaryEmotion: "happy", intensity: 0.7, isSarcastic: false },
  topics: { topics: ["work"], primaryTopic: "work", emotionalContext: {"work": "frustrated"} },
  openLoops: { hasFollowUp: true, loopType: "pending_event", topic: "interview" },
  relationshipSignals: { milestone: "first_vulnerability", milestoneConfidence: 0.9 },
  userFacts: { hasFactsToStore: true, facts: [{ category: "identity", key: "name", value: "Steven" }] },
  contradiction: { isContradicting: false, topic: null, confidence: 0 }
}
```

**Location in code:**
- `src/services/intentService.ts:1975-2067` - Unified detection
- `src/services/intentService.ts:2183-2241` - Cached wrapper with tiered bypass

**Optimization: Tiered Intent Detection**
```typescript
// TIER 1: Skip very short messages (< 3 words or < 10 chars)
if (wordCount <= 2 || trimmed.length < 10) {
  return getDefaultIntent(trimmed); // No LLM call
}

// TIER 2: Use defaults for simple messages ("hey", "lol", "ok")
if (isSimpleMessage(trimmed)) {
  return getDefaultIntent(trimmed); // No LLM call
}

// TIER 3: Full LLM detection for complex messages
const result = await detectFullIntentLLM(message, context);
```

**Performance:**
- Simple messages: **0ms** (bypassed)
- Complex messages: **~200ms** (single LLM call)
- Caches results for 5 minutes

---

### 2. Background Analysis (`messageAnalyzer.ts`)

**Purpose:** Update long-term memory and behavior patterns based on detected intent.

**What It Does:**

#### A. Pattern Tracking (`userPatterns.ts`)
- **Cross-session behavior analysis**
- Detects recurring topics, timing patterns, emotional patterns
- Example: User always stressed on Mondays → pattern detected

#### B. Relationship Updates (`relationshipService.ts`)
- **Updates relationship tier** (Stranger → Acquaintance → Friend → Close Friend → Confidant → Best Friend)
- Tracks warmth, trust, playfulness dimensions
- Records milestones (first vulnerability, first joke, etc.)

#### C. Open Loop Creation (`presenceDirector.ts`)
- **Stores things to follow up on** in `presence_contexts` table
- Types:
  - `pending_event` - "How did your interview go?"
  - `emotional_followup` - "Are you feeling better about X?"
  - `commitment_check` - "Did you end up trying that gym?"
  - `curiosity_thread` - "I've been thinking about what you said..."

#### D. User Fact Storage (`memoryService.ts`)
- **Stores personal information** in `user_facts` table
- Categories: identity, preference, relationship, context
- Example: "My birthday is July 15th" → stored for recall

#### E. Emotional Momentum (`moodKnobs.ts`)
- **Updates daily mood state** based on sentiment
- Tracks streaks, energy, social battery
- Affects response style (more engaged when user is positive)

**Location in code:**
- `src/services/messageAnalyzer.ts:369-399` - Main analysis function
- `src/App.tsx:1895-1931` - Background trigger

**Non-Blocking Execution:**
```typescript
// Started immediately but doesn't block response
const startBackgroundAnalysis = (userId: string) => {
  try {
    recordExchange(); // For callback timing
    // All other updates happen async
  } catch (e) {
    console.warn('Exchange record failed', e);
  }
};

// Fires immediately after user sends message
startBackgroundAnalysis(getUserId());

// Sentiment analysis happens after response is displayed
startBackgroundSentiment(userId, intent);
```

---

### 3. Presence Director Integration (`presenceDirector.ts`)

**Purpose:** Determine what Kayley should bring up proactively.

**Components:**

#### A. Open Loops
- Active loops ready to surface
- Sorted by salience (importance) and timing
- Example: If user mentioned "party at 6pm today", surface at 7pm: "How was the party?"

#### B. Opinions
- Parsed from character profile Section 12
- Can be injected when relevant
- Example: User mentions "fall weather" → Kayley shares her love of fall

#### C. Top Loop Selection
```typescript
const topLoop = await getTopLoopToSurface(userId);

if (topLoop) {
  // Inject into system prompt as proactive context
  promptSection += `\n\nYou should naturally ask about: ${topLoop.suggestedFollowup}`;
}
```

**Cooldown Logic:**
- Don't ask about same loop within 4 hours
- Max 3 loops in context at once
- Loops expire after event + reasonable time window

---

## 💤 Idle Mode: Offline Thought Generation

### When It Happens
- **Trigger:** User has been away for 4+ hours
- **Frequency:** Periodically during long absences
- **Storage:** `idle_thoughts` table

### Thought Types

| Type | Description | Example Intro | When Used |
|------|-------------|---------------|-----------|
| **Dream** | Dream sequences involving user | "I had the weirdest dream..." | After 8+ hours (sleep cycle) |
| **Memory** | Reflections on past conversations | "Been thinking about what you said..." | Thoughtful moods |
| **Curiosity** | Questions that popped into her head | "Random question -" | Playful moods |
| **Anticipation** | Looking forward to hearing updates | "Can't wait to hear about..." | After 24+ hours |
| **Connection** | Linking topics together | "I just connected something -" | Deep moods |
| **Random** | Quirky observations | "My brain is weird but -" | Casual moods |

### Generation Logic

```typescript
/**
 * Generate an idle thought during user absence
 *
 * @param userId - The user's ID
 * @param absenceDurationHours - How long user has been away
 * @param kayleyMood - Kayley's current mood state
 * @returns The generated idle thought
 */
export async function generateIdleThought(
  userId: string,
  absenceDurationHours: number,
  kayleyMood: string
): Promise<IdleThought>
```

**Selection Algorithm:**
1. **Dreams:** 40% chance if absence > 8 hours
2. **Anticipation:** 30% chance if absence > 24 hours
3. **Mood-based:**
   - Thoughtful/reflective → Memory or Connection
   - Playful/energetic → Curiosity or Random
4. **Default:** Weighted random

**Thought Properties:**
- `content` - The actual thought text
- `emotionalTone` - wistful, amused, thoughtful, etc.
- `involvesUser` - 70% chance user is part of the thought
- `isRecurring` - 20% chance for dreams
- `idealConversationMood` - When to share it (playful, cozy, deep)
- `naturalIntro` - How to bring it up naturally

**Lifecycle:**
```
Generated → Stored → Unshared → Shared → Marked
    ↓          ↓         ↓          ↓         ↓
  4+ hrs    Database   Ready    Mentioned  sharedAt
             away                in chat    updated

Cleanup Rules:
- Max 5 unshared thoughts per user
- Expire after 7 days if not shared
- Oldest excess thoughts discarded
```

**Location in code:**
- `src/services/spontaneity/idleThoughts.ts:127-212` - Generation
- `src/services/spontaneity/idleThoughts.ts:221-244` - Retrieval
- `src/services/spontaneity/idleThoughts.ts:251-266` - Marking as shared

---

## 🎯 Integration: How It All Works Together

### Scenario 1: User Mentions Upcoming Event

```
User: "I have a big presentation at work tomorrow at 2pm"

┌─ ACTIVE MODE ─────────────────────────────────────────────┐
│                                                            │
│ Intent Detection:                                          │
│  ✓ Topics: ["work"]                                        │
│  ✓ Open Loop: pending_event                                │
│    - topic: "big presentation"                             │
│    - eventDateTime: 2024-12-30T14:00:00Z                   │
│    - suggestedFollowUp: "How did your presentation go?"    │
│    - timeframe: "tomorrow"                                 │
│    - salience: 0.8 (high importance)                       │
│                                                            │
│ Background Analysis:                                       │
│  ✓ Create open loop in database                           │
│  ✓ shouldSurfaceAfter: 2024-12-30T14:30:00Z (30m after)   │
│  ✓ Pattern: User talks about work stress                  │
│                                                            │
│ Kayley's Response:                                         │
│  "Ooh big presentation tomorrow! Are you feeling ready     │
│   for it or still prepping?"                               │
└────────────────────────────────────────────────────────────┘

Next Day at 3pm:
┌─ ACTIVE MODE (User returns) ──────────────────────────────┐
│                                                            │
│ Presence Director:                                         │
│  ✓ Checks open loops                                       │
│  ✓ Finds "presentation" loop                               │
│  ✓ Event time passed (2pm + 30min = ready to surface)     │
│  ✓ Injects into system prompt                              │
│                                                            │
│ Kayley's Proactive Message:                                │
│  "Hey! How did your presentation go? I've been thinking    │
│   about it all afternoon"                                  │
└────────────────────────────────────────────────────────────┘
```

---

### Scenario 2: User Goes Away for a Weekend

```
User last active: Friday 6pm
Current time: Sunday 10am (40 hours later)

┌─ IDLE MODE ───────────────────────────────────────────────┐
│                                                            │
│ Saturday 2am (8 hours):                                    │
│  ✓ Generate Dream thought                                 │
│    - "I had this dream where we were trying to find       │
│       that coffee shop you mentioned but all the          │
│       streets kept changing. Very on brand for my brain." │
│    - emotionalTone: "amused"                               │
│    - idealMood: "casual"                                   │
│                                                            │
│ Saturday 6pm (24 hours):                                   │
│  ✓ Generate Anticipation thought                          │
│    - "Been looking forward to hearing how your weekend    │
│       went. Hope you got some rest!"                       │
│    - emotionalTone: "warm"                                 │
│    - idealMood: "cozy"                                     │
│                                                            │
│ Sunday 10am - User Returns:                                │
│  ✓ Retrieve unshared thoughts (2 available)               │
│  ✓ Select most appropriate based on mood                  │
│                                                            │
│ Kayley's Greeting:                                         │
│  "Hey! I had the weirdest dream about you last night...   │
│   [tells dream]. How was your weekend?"                    │
│                                                            │
│  ✓ Mark dream thought as shared                           │
│  ✓ Keep anticipation thought for later                    │
└────────────────────────────────────────────────────────────┘
```

---

## 📊 Performance Optimization

### Fast Router Pattern (Sub-2s Response Times)

```
User Message Arrives
    │
    ├──────────────────┬─────────────────┐
    ↓                  ↓                 ↓
Command Bypass     Intent Detection   Main Response
(~0ms)            (~200ms)           (~1.8s)
    │                  │                 │
    │                  │                 │
Functional         Runs in parallel   Blocks until
commands skip      with main          complete
full analysis      response
    │                  │                 │
    └──────────────────┴─────────────────┘
                       ↓
              Total Time: ~1.8-1.9s
```

**Optimizations:**

1. **Command Bypass:**
   - Detects functional commands ("add task", "schedule event")
   - Skips full psychological analysis
   - Saves ~1.8s for utility commands

2. **Tiered Intent Detection:**
   - TIER 1: Skip messages < 10 chars (0ms)
   - TIER 2: Default for simple patterns ("hey", "lol") (0ms)
   - TIER 3: Full LLM for complex messages (~200ms)

3. **Unified Detection:**
   - OLD: 5-7 separate LLM calls (~5-13s)
   - NEW: 1 master LLM call (~200ms)
   - **Reduction: 96% faster**

4. **Caching:**
   - 5-minute TTL per message
   - Prevents duplicate calls in same flow
   - Cache hit = 0ms

5. **Background Execution:**
   - Database writes are fire-and-forget
   - Pattern updates don't block response
   - User sees response immediately

---

## 🗂️ Database Schema

### Active Mode Tables

```sql
-- Open loops (things to follow up on)
presence_contexts (
  id, user_id, loop_type, topic, suggested_followup,
  created_at, should_surface_after, last_surfaced_at,
  status, salience, event_date_time
)

-- User facts (things remembered)
user_facts (
  id, user_id, category, key, value,
  confidence, source, created_at
)

-- Emotional momentum
emotional_momentum (
  id, user_id, current_mood, streak_days,
  last_interaction, created_at, updated_at
)

-- Relationship tracking
relationship_states (
  id, user_id, relationship_tier, warmth, trust, playfulness,
  total_interactions, milestones, created_at, updated_at
)
```

### Idle Mode Tables

```sql
-- Idle thoughts (dreams, memories, etc.)
idle_thoughts (
  id, user_id, thought_type, content,
  emotional_tone, is_recurring, involves_user,
  ideal_conversation_mood, natural_intro,
  generated_at, shared_at, expired_at,
  absence_duration_hours, kayley_mood_when_generated
)
```

---

## 🔧 Configuration

### Constants (`intentService.ts`)

```typescript
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_MESSAGE_LENGTH = 500; // Truncate longer messages
const GEMINI_MODEL = "gemini-2.0-flash-exp"; // Fast, cheap model
```

### Constants (`presenceDirector.ts`)

```typescript
const MIN_HOURS_BETWEEN_SURFACES = 4; // Cooldown between asking same thing
const MAX_LOOPS_IN_CONTEXT = 3; // Don't overwhelm with too many loops
```

### Constants (`idleThoughts.ts`)

```typescript
const MIN_ABSENCE_HOURS_FOR_THOUGHT = 4; // Generate after 4+ hours
const THOUGHT_EXPIRATION_DAYS = 7; // Expire unshared thoughts
const MAX_UNSHARED_THOUGHTS = 5; // Keep max 5 per user
```

---

## 🧪 Testing

### Unit Tests

```bash
# Intent detection
npm test -- intentService.test.ts

# Background analysis
npm test -- messageAnalyzer.test.ts

# Idle thoughts
npm test -- idleThoughts.test.ts

# Open loops
npm test -- presenceDirector.test.ts
```

### Integration Tests

```bash
# Full flow: user message → analysis → loop creation
npm test -- latencyOptimizations.test.ts

# Unified intent detection
npm test -- unifiedIntent.test.ts
```

---

## 📚 Related Documentation

- `docs/System_Prompt_Guidelines.md` - How thinking results are injected into prompts
- `docs/Tool_Integration_Checklist.md` - Adding new memory tools
- `CLAUDE.md` - System overview and architecture

---

## 🎯 Key Takeaways

1. **Dual-Mode Processing:** Active (during chat) + Idle (when away)
2. **Optimized for Speed:** <2s response time with parallel processing
3. **Memory Persistence:** Everything stored in Supabase for cross-session recall
4. **Proactive Behavior:** Open loops + idle thoughts create "she remembers me" feeling
5. **LLM-Powered Understanding:** Semantic analysis beats keyword matching
6. **Non-Blocking:** Background analysis doesn't slow down user experience

---

**Last Updated:** 2025-12-29
**Maintained By:** Development Team
**Version:** 1.0
