# Implementation Plan: Idle Thoughts Part Two - Enhanced Context Integration

**Status:** Draft
**Date:** 2025-12-29
**Target:** Integrate conversation history, calendar, mood awareness, and relevance filtering into idle thoughts
**Complexity:** High
**Estimated Files:** ~12 files modified
**Dependencies:** Idle Thoughts Part One (08_Idle_Thoughts_Integration.md)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Architecture Design](#architecture-design)
4. [Implementation Steps](#implementation-steps)
5. [File Modifications](#file-modifications)
6. [Testing Strategy](#testing-strategy)
7. [Success Metrics](#success-metrics)
8. [Rollout Plan](#rollout-plan)
9. [Senior Engineering Review & Feedback](#senior-engineering-review--feedback)

---

## Executive Summary

### Problem

The idle thoughts system (Part One) generates thoughts during user absence, but the thoughts are **generic and disconnected** from actual user context:

- ❌ Templates use hardcoded placeholders: "that thing you mentioned", "what you're working on"
- ❌ No integration with calendar events (misses opportunities like "excited for your meeting tomorrow")
- ❌ No mood awareness (generates playful thoughts when Kayley is low energy)
- ❌ No relevance filtering (stale thoughts surface days later when no longer relevant)

**Example Current Thought:**
> "Been thinking about what you said about **that thing you mentioned**. That really stuck with me."

**Example Enhanced Thought:**
> "Been thinking about what you said about **your Python authentication bug**. That really stuck with me."

### Solution Overview

Implement **four integrated enhancements** to make idle thoughts feel personalized and contextually aware:

| Enhancement | Purpose | Key Integration |
|-------------|---------|-----------------|
| **Comprehensive Context** | Pull actual topics/interests from **7 data sources** | `conversation_history`, `kayley_stories`, `user_story_tracking`, `ongoing_threads`, `presence_contexts`, `user_facts`, `calendar_events` |
| **Calendar Integration** | Generate anticipation thoughts about upcoming events | `calendarCheckinService.ts`, `calendar_events` table |
| **Mood-Aware Generation** | Adjust thought tone/type based on emotional state | `stateService.ts`, `emotional_momentum` table |
| **Relevance Filtering** | Verify thought is still relevant before surfacing | LLM-based validation via `BaseAIService` |

### The 7 Data Sources

Idle thoughts will integrate context from **ALL existing narrative/relationship systems**:

1. **`conversation_history`** (Last 5 days) - Topics from BOTH user and Kayley messages
2. **`kayley_stories`** - Stories/themes Kayley has shared and wants to explore
3. **`user_story_tracking`** - Stories user has shared that Kayley is interested in (high `kayley_interest_level`)
4. **`ongoing_threads`** - Current things on Kayley's mind (active mental state)
5. **`presence_contexts`** - Current demeanor/outfit/activity
6. **`user_facts`** - User interests, preferences, locations
7. **`calendar_events`** - Upcoming events for anticipation thoughts

### Impact

**Before Enhancement:**
- Generic thoughts: "what you're working on"
- No calendar awareness: Misses "excited for your dinner tomorrow"
- Wrong tone: Playful when Kayley is drained
- Stale thoughts: "thinking about X" when X was resolved 3 days ago

**After Enhancement:**
- Personalized thoughts: "your Python project and the authentication bug"
- Calendar-aware: "Can't wait to hear how your client meeting went!"
- Mood-appropriate: Thoughtful reflections when energy is low, curious questions when playful
- Fresh thoughts: LLM filters out stale/resolved topics before surfacing

---

## Current State Analysis

### What Exists ✅

| Component | File | Status |
|-----------|------|--------|
| Idle thought scheduler | `idleThoughtsScheduler.ts` | ✅ Runs every 10 min (Part One) |
| Template system | `idleThoughts.ts:48-115` | ✅ 6 thought types with templates |
| Placeholder replacement | `idleThoughts.ts:413-425` | ✅ Hardcoded generic values |
| Memory search | `memoryService.ts:87-177` | ✅ `searchMemories()` function |
| User facts | `memoryService.ts:228-292` | ✅ `getUserFacts()` function |
| Calendar events | `calendarService.ts` | ✅ Event retrieval and parsing |
| Calendar check-ins | `calendarCheckinService.ts` | ✅ Event timing detection |
| Mood state | `stateService.ts:128-150` | ✅ `getMoodState()` function |
| Emotional momentum | `stateService.ts:42-49` | ✅ Current mood level, streak tracking |

### What Needs Enhancement ❌

| Component | Current State | Target State |
|-----------|---------------|--------------|
| **Topic extraction** | Hardcoded "that thing you mentioned" | Pull from **7 data sources**: conversation_history, kayley_stories, user_story_tracking, ongoing_threads, presence_contexts, user_facts, calendar_events |
| **Interest detection** | Hardcoded "what you're working on" | Query `user_facts` for preferences/interests |
| **Story integration** | Not using narrative systems | Leverage `kayley_stories` (themes she's exploring) and `user_story_tracking` (topics she wants to explore with user) |
| **Thread awareness** | Disconnected from mental state | Pull from `ongoing_threads` (current things on her mind) |
| **Presence integration** | No demeanor awareness | Use `presence_contexts` (current outfit/mood/activity) |
| **Calendar thoughts** | Not generated | New template type: "anticipation" with real event titles |
| **Mood adaptation** | Random thought type selection | Mood-driven type selection using `emotional_momentum` and `mood_states` |
| **Relevance check** | No validation | LLM checks if thought is still relevant before surfacing |

### Existing System Capabilities (Ready to Use)

#### 1. Memory Service

```typescript
// Search past conversations for specific topics
const memories = await searchMemories(
  userId,
  'Python project authentication',
  limit: 5,
  timeframe: 'recent' // or 'all'
);
// Returns: [{ text: "I'm stuck on the auth bug...", role: 'user', timestamp: '...' }]

// Get user facts by category
const interests = await getUserFacts(userId, 'preference');
// Returns: [{ fact_key: 'programming_language', fact_value: 'Python' }]
```

#### 2. Calendar Service

```typescript
import { getUpcomingEvents } from './calendarService';

const events = await getUpcomingEvents(24); // Next 24 hours
// Returns: [{ id, summary, start, end, description }]
```

#### 3. Emotional Momentum

```typescript
const momentum = await getEmotionalMomentum(userId);
// Returns: {
//   currentMoodLevel: -0.3,        // Range: -1 to 1
//   momentumDirection: -0.2,       // Declining
//   positiveInteractionStreak: 0,  // No recent positives
//   genuineMomentDetected: false
// }
```

#### 4. Mood State

```typescript
const moodState = await getMoodState(userId);
// Returns: {
//   dailyEnergy: 0.4,           // Low energy today
//   socialBattery: 0.6,         // Moderate social capacity
//   lastInteractionTone: -0.5   // Last interaction was negative
// }
```

---

## Architecture Design

### High-Level Integration Flow

```
┌────────────────────────────────────────────────────────────────┐
│          Idle Thoughts Scheduler (every 10 minutes)             │
│  1. Check if user is away (>10 min)                            │
│  2. Fetch context: mood, calendar, conversation history        │
└───────────────────┬────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────────────┐
│              Enhanced Thought Generation Pipeline               │
│                                                                 │
│  Phase 1: Mood-Aware Type Selection                           │
│  ├─ Low energy + negative momentum → 'memory' (reflective)    │
│  ├─ High energy + playful → 'curiosity' (engaging)            │
│  └─ Upcoming event in 12-24h → 'anticipation' (calendar)      │
│                                                                 │
│  Phase 2: Context-Rich Content Generation                     │
│  ├─ Search memories for relevant topics                       │
│  ├─ Query user_facts for interests/preferences                │
│  ├─ Fetch upcoming calendar events if applicable              │
│  └─ Replace placeholders with actual context                  │
│                                                                 │
│  Phase 3: Relevance Filtering (before surfacing)              │
│  ├─ When user returns, LLM checks: "Is this still relevant?"  │
│  ├─ Validates against recent conversation history             │
│  └─ Filters out stale/resolved topics                         │
└───────────────────┬────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────────────┐
│         Personalized Thought Stored in Database                 │
│  {                                                              │
│    type: 'memory',                                             │
│    content: "Been thinking about what you said about your      │
│              Python project and the authentication bug.",      │
│    associatedMemory: "conversation_history:abc123",           │
│    emotionalTone: 'thoughtful',                               │
│    contextUsed: { topics: ['Python', 'auth bug'], ... }       │
│  }                                                              │
└───────────────────┬────────────────────────────────────────────┘
                    │
                    │  (User returns after hours/days)
                    ▼
┌────────────────────────────────────────────────────────────────┐
│              Relevance Filter Before Surfacing                  │
│  LLM Prompt: "The user's last 5 messages were about dinner    │
│  plans. Is a thought about 'Python auth bug' still relevant?" │
│  ├─ Relevant → Surface in greeting                            │
│  └─ Not relevant → Mark as expired, skip                      │
└────────────────────────────────────────────────────────────────┘
```

### Data Flow: Enhanced Thought Generation

```
Scheduler Tick (10 min)
    ↓
shouldGenerateThought(userId) → true
    ↓
┌─────────────────────────────────────┐
│  Fetch Multi-Dimensional Context    │
│  - getMoodState(userId)             │
│  - getEmotionalMomentum(userId)     │
│  - getUpcomingEvents(24)            │
│  - searchMemories(userId, ...)      │
│  - getUserFacts(userId, 'all')      │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  selectThoughtType()                │
│  - Input: mood, energy, calendar    │
│  - Output: 'memory' / 'anticipation'│
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  generateEnhancedContent()          │
│  - Pick template for type           │
│  - Fill {topic} from memories       │
│  - Fill {interest} from user_facts  │
│  - Fill {event} from calendar       │
│  - Store context metadata           │
└──────────────┬──────────────────────┘
               ↓
Save to idle_thoughts table
    {content, associatedMemory, contextUsed}
    ↓
Convert to ongoing_thread
    (existing flow from Part One)
    ↓
┌─────────────────────────────────────┐
│  User Returns → Relevance Check     │
│  filterStaleThoughts(userId)        │
│  - LLM validates each unshared      │
│  - Marks irrelevant as expired      │
└──────────────┬──────────────────────┘
               ↓
Surface in greeting (if relevant)
```

---

## Implementation Steps

### Phase 1: Conversation History Integration

**Goal:** Replace hardcoded placeholders with actual topics/interests from conversation history

#### 1.1: Enhance `generateThoughtContent()` Function

**File:** `src/services/spontaneity/idleThoughts.ts`

**Changes:**

```typescript
/**
 * Generate thought content with real user context from conversation history
 */
async function generateThoughtContent(
  thoughtType: IdleThoughtType,
  userId: string,
  moodContext?: EmotionalMomentum  // NEW: for mood-aware generation
): Promise<{
  content: string;
  associatedMemory?: string;
  emotionalTone: string;
  idealMood?: ConversationalMood;
  naturalIntro: string;
  contextUsed: ThoughtContext;  // NEW: metadata about what context was used
}> {
  const template = THOUGHT_TEMPLATES.find((t) => t.type === thoughtType);
  if (!template) {
    throw new Error(`No template found for thought type: ${thoughtType}`);
  }

  // Pick random template
  const contentTemplate =
    template.templates[Math.floor(Math.random() * template.templates.length)];

  // Pick random emotional tone
  const emotionalTone =
    template.emotionalTones[
      Math.floor(Math.random() * template.emotionalTones.length)
    ];

  // Pick ideal mood
  const idealMood = template.idealMoods
    ? template.idealMoods[Math.floor(Math.random() * template.idealMoods.length)]
    : undefined;

  // === NEW: Context-Rich Placeholder Replacement ===
  const context = await fetchUserContext(userId, thoughtType);
  let content = replacePlaceholders(contentTemplate, context);

  // Generate natural intro
  const naturalIntro = generateNaturalIntro(thoughtType);

  // Associated memory (link to actual conversation)
  const associatedMemory = context.memoryId || 'general_reflection';

  return {
    content,
    associatedMemory,
    emotionalTone,
    idealMood,
    naturalIntro,
    contextUsed: context,  // Store what context was used for debugging
  };
}
```

#### 1.2: Create Context Fetching Logic

**File:** `src/services/spontaneity/idleThoughts.ts`

**New Types:**

```typescript
interface ThoughtContext {
  topics: string[];                // Actual topics from conversation
  interests: string[];             // From user_facts
  locations: string[];             // From user_facts
  recentActivity?: string;         // Inferred from conversation
  memoryId?: string;               // conversation_history ID for associatedMemory

  // Rich narrative context
  kayleyStories: Array<{           // Stories Kayley has shared
    title: string;
    theme: string;
    storyId: string;
  }>;

  userStories: Array<{             // Stories user has shared
    topic: string;
    context: string;
    storyId: string;
  }>;

  ongoingThreads: Array<{          // Current things on Kayley's mind
    theme: string;
    state: string;
    intensity: number;
  }>;

  presenceContext?: {              // Current demeanor/action
    outfit?: string;
    mood?: string;
    activity?: string;
  };

  calendarEvent?: {
    title: string;
    when: string;
    hoursUntil: number;
  };
}
```

**New Function:**

```typescript
/**
 * Fetch COMPREHENSIVE user context for thought generation
 * Integrates ALL narrative/relationship context tables:
 * - conversation_history (last 5 days)
 * - user_facts
 * - kayley_stories (stories Kayley has shared)
 * - user_story_tracking (stories user has shared)
 * - ongoing_threads (current mental state)
 * - presence_contexts (current demeanor)
 * - calendar_events
 */
async function fetchUserContext(
  userId: string,
  thoughtType: IdleThoughtType
): Promise<ThoughtContext> {
  const context: ThoughtContext = {
    topics: [],
    interests: [],
    locations: [],
    kayleyStories: [],
    userStories: [],
    ongoingThreads: [],
  };

  try {
    // Fetch ALL context in parallel for speed
    const [
      facts,
      recentConversations,
      kayleyStories,
      userStories,
      ongoingThreads,
      presenceContext,
      upcomingEvents,
    ] = await Promise.all([
      getUserFacts(userId, 'all'),
      fetchRecentConversations(userId, 5), // Last 5 days
      fetchKayleyStories(userId),
      fetchUserStories(userId),
      fetchOngoingThreads(userId),
      fetchPresenceContext(userId),
      thoughtType === 'anticipation' ? getUpcomingEvents(48) : Promise.resolve([]),
    ]);

    // 1. User facts (interests, preferences, locations)
    context.interests = facts
      .filter(f => f.category === 'preference' && f.fact_key === 'interest')
      .map(f => f.fact_value)
      .slice(0, 3);

    context.locations = facts
      .filter(f => f.category === 'context' && f.fact_key === 'location')
      .map(f => f.fact_value)
      .slice(0, 2);

    // 2. Extract topics from recent conversations (last 5 days)
    // Look for interesting topics from BOTH user and Kayley messages
    const topicCandidates = extractTopicsFromConversations(recentConversations);
    context.topics = topicCandidates.slice(0, 5); // Top 5 topics

    // Store most recent conversation reference
    if (recentConversations.length > 0) {
      context.memoryId = recentConversations[0].id;
    }

    // 3. Kayley's stories (themes she's interested in exploring)
    context.kayleyStories = kayleyStories
      .filter(s => s.status === 'active' || s.status === 'ongoing')
      .map(s => ({
        title: s.title,
        theme: s.theme,
        storyId: s.id,
      }))
      .slice(0, 3); // Top 3 active stories

    // 4. User's stories (topics Kayley wants to explore more)
    context.userStories = userStories
      .filter(s => s.kayley_interest_level && s.kayley_interest_level > 0.6)
      .map(s => ({
        topic: s.topic,
        context: s.last_mention_context || '',
        storyId: s.id,
      }))
      .slice(0, 3); // Top 3 interesting user stories

    // 5. Ongoing threads (current mental state)
    context.ongoingThreads = ongoingThreads
      .filter(t => t.intensity > 0.4) // Active threads only
      .map(t => ({
        theme: t.theme,
        state: t.currentState,
        intensity: t.intensity,
      }))
      .slice(0, 3); // Top 3 threads

    // 6. Presence context (current demeanor/action)
    if (presenceContext) {
      context.presenceContext = {
        outfit: presenceContext.outfit_context,
        mood: presenceContext.mood_context,
        activity: presenceContext.action_context,
      };
    }

    // 7. Calendar events (for anticipation thoughts)
    if (upcomingEvents.length > 0) {
      const nextEvent = upcomingEvents[0];
      const hoursUntil = (new Date(nextEvent.start.dateTime || nextEvent.start.date).getTime() - Date.now()) / (1000 * 60 * 60);

      context.calendarEvent = {
        title: nextEvent.summary,
        when: formatEventTime(nextEvent.start),
        hoursUntil,
      };
    }

    console.log('💭 [IdleThoughts] Fetched comprehensive context:', {
      topics: context.topics.length,
      interests: context.interests.length,
      kayleyStories: context.kayleyStories.length,
      userStories: context.userStories.length,
      ongoingThreads: context.ongoingThreads.length,
      hasPresence: !!context.presenceContext,
      hasCalendarEvent: !!context.calendarEvent,
    });

  } catch (error) {
    console.error('[IdleThoughts] Error fetching context:', error);
    // Fall back to generic context on error
  }

  return context;
}

/**
 * Fetch recent conversations from last N days
 * Returns both user and Kayley messages for full context
 */
async function fetchRecentConversations(
  userId: string,
  days: number
): Promise<MemorySearchResult[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const { data, error } = await supabase
    .from('conversation_history')
    .select('id, message_text, message_role, created_at')
    .eq('user_id', userId)
    .gte('created_at', cutoffDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(50); // Last 50 messages

  if (error || !data) {
    console.error('[IdleThoughts] Error fetching conversations:', error);
    return [];
  }

  return data.map(row => ({
    id: row.id,
    text: row.message_text,
    role: row.message_role as 'user' | 'model',
    timestamp: row.created_at,
  }));
}

/**
 * Fetch Kayley's active stories
 */
async function fetchKayleyStories(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('kayley_stories')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'ongoing'])
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !data) {
    console.error('[IdleThoughts] Error fetching Kayley stories:', error);
    return [];
  }

  return data;
}

/**
 * Fetch user stories that Kayley is interested in
 */
async function fetchUserStories(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('user_story_tracking')
    .select('*')
    .eq('user_id', userId)
    .order('kayley_interest_level', { ascending: false })
    .limit(5);

  if (error || !data) {
    console.error('[IdleThoughts] Error fetching user stories:', error);
    return [];
  }

  return data;
}

/**
 * Fetch active ongoing threads
 * IMPORTANT: Excludes threads sourced from idle_thoughts to prevent circular dependency
 * (idle_thought → thread → new idle_thought → infinite loop)
 */
async function fetchOngoingThreads(userId: string): Promise<OngoingThread[]> {
  const { data, error } = await supabase
    .from('ongoing_threads')
    .select('*')
    .eq('user_id', userId)
    .neq('source', 'idle_thought')  // ← CRITICAL: Prevent circular dependency
    .gt('intensity', 0.3) // Active threads only
    .order('intensity', { ascending: false })
    .limit(5);

  if (error || !data) {
    console.error('[IdleThoughts] Error fetching threads:', error);
    return [];
  }

  return data.map(row => ({
    id: row.id,
    theme: row.theme,
    currentState: row.current_state,
    intensity: row.intensity,
    lastMentioned: row.last_mentioned ? new Date(row.last_mentioned).getTime() : null,
    userRelated: row.user_related,
    createdAt: new Date(row.created_at).getTime(),
    userTrigger: row.user_trigger,
  }));
}

/**
 * Fetch current presence context
 */
async function fetchPresenceContext(userId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('presence_contexts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Extract topics from recent conversations (BOTH user and Kayley)
 * Looks for interesting topics, stories, and themes worth reflecting on
 */
function extractTopicsFromConversations(conversations: MemorySearchResult[]): string[] {
  const topics = new Set<string>();

  for (const conv of conversations) {
    const text = conv.text;
    const textLower = text.toLowerCase();

    // 1. Extract capitalized words (likely proper nouns/topics)
    const capitalizedMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (capitalizedMatches) {
      capitalizedMatches.forEach(match => {
        if (match.length > 3 && !['I', 'The', 'A'].includes(match)) {
          topics.add(match);
        }
      });
    }

    // 2. Extract topic patterns from user messages
    if (conv.role === 'user') {
      const userPatterns = [
        /about ([\w\s]{3,30})/i,
        /working on ([\w\s]{3,30})/i,
        /dealing with ([\w\s]{3,30})/i,
        /thinking about ([\w\s]{3,30})/i,
        /struggling with ([\w\s]{3,30})/i,
        /excited about ([\w\s]{3,30})/i,
        /worried about ([\w\s]{3,30})/i,
      ];

      for (const pattern of userPatterns) {
        const match = textLower.match(pattern);
        if (match && match[1]) {
          topics.add(match[1].trim());
        }
      }
    }

    // 3. Extract story/fact indicators from Kayley's messages
    // These suggest topics Kayley has shared and might want to revisit
    if (conv.role === 'model') {
      const kayleyPatterns = [
        /I told you about ([\w\s]{3,30})/i,
        /remember when I mentioned ([\w\s]{3,30})/i,
        /my (friend|sister|brother|mom|dad) ([\w\s]{3,30})/i,
        /I've been ([\w\s]{3,30})/i,
        /I'm working on ([\w\s]{3,30})/i,
      ];

      for (const pattern of kayleyPatterns) {
        const match = textLower.match(pattern);
        if (match && match[1]) {
          topics.add(match[1].trim());
        }
      }
    }
  }

  return Array.from(topics)
    .filter(t => t.length > 3 && t.length < 50) // Reasonable length
    .slice(0, 10);
}
```

#### 1.3: Create Context Scoring System

**File:** `src/services/spontaneity/idleThoughts.ts`

**Philosophy:** Use **data-driven signals** from the database to determine what Kayley is most interested in thinking about.

**Scoring Table:**

| Context Source | Score Calculation | Range | Rationale |
|----------------|-------------------|-------|-----------|
| **User Stories** | `kayley_interest_level` (from DB) | 0-1 | Direct measure of Kayley's curiosity about this topic |
| **Kayley Stories** | `active` = 0.8, `ongoing` = 0.6, other = 0.3 | 0.3-0.8 | Active themes she's currently exploring rank highest |
| **Ongoing Threads** | `intensity` (from DB) | 0-1 | Higher intensity = more on her mind right now |
| **Conversation Topics** | Recency decay: `0.7 - (index * 0.1)` | 0.3-0.7 | Most recent topics score higher, older decay |
| **Presence Context** | Fixed baseline | 0.5 | Current state is moderately interesting |
| **Calendar Events** | Urgency: `1.0 - (hoursUntil / 48)` | 0.3-1.0 | Closer events (more urgent) score higher |

**Selection Strategy:** **Weighted Random**
- Not purely deterministic (top score always wins)
- Not purely random (ignores interest)
- **Hybrid:** Higher scores are MORE LIKELY to be selected, but lower scores can still surface occasionally for variety

**Example Scoring Scenario:**

```
Available Context:
1. User story: "childhood camping trips" (kayley_interest_level: 0.9) → Score: 0.9
2. Ongoing thread: "wanting to switch careers" (intensity: 0.72) → Score: 0.72
3. Kayley story: "my audition anxiety" (status: active) → Score: 0.8
4. Conversation topic: "Python auth bug" (recent, index 0) → Score: 0.7
5. Conversation topic: "team restructuring" (older, index 2) → Score: 0.5
6. Calendar event: "Client meeting" (in 20 hours) → Score: 0.58

Total weight: 4.2

Weighted Random Selection:
- Random value: 2.1 (out of 4.2)
- Walk through: 2.1 - 0.9 = 1.2 (skip user story)
              1.2 - 0.72 = 0.48 (skip thread)
              0.48 - 0.8 = -0.32 (SELECTED: Kayley story "my audition anxiety")

Result: High-scoring items more likely, but not guaranteed
```

**Why This Works:**
- **Respects existing signals**: Leverages `kayley_interest_level`, `intensity`, `status` already in DB
- **Avoids staleness**: Recent conversations score higher than old ones
- **Urgency awareness**: Upcoming events get priority based on proximity
- **Variety**: Low-scoring items can still surface (prevents repetition)
- **No additional LLM calls**: Fast, deterministic calculation

**New Types:**

```typescript
interface ScoredContextItem {
  content: string;           // The actual topic/story/thread text
  score: number;             // 0-1 interest score
  source: 'kayley_story' | 'user_story' | 'thread' | 'conversation' | 'presence' | 'calendar';
  metadata?: any;            // Additional context (storyId, threadId, etc.)
}
```

**New Function:**

```typescript
/**
 * Score all context items by interest/relevance
 * Uses existing database signals (kayley_interest_level, intensity, recency, etc.)
 */
function scoreContextItems(context: ThoughtContext): ScoredContextItem[] {
  const scoredItems: ScoredContextItem[] = [];

  // 1. USER STORIES - Use kayley_interest_level directly
  for (const story of context.userStories) {
    const score = story.kayley_interest_level || 0.5; // Default to moderate if missing
    scoredItems.push({
      content: story.topic,
      score,
      source: 'user_story',
      metadata: { storyId: story.storyId, context: story.context },
    });
  }

  // 2. KAYLEY STORIES - Score by status
  for (const story of context.kayleyStories) {
    let score = 0.5;
    if (story.status === 'active') score = 0.8;      // Currently exploring
    else if (story.status === 'ongoing') score = 0.6; // Still relevant
    else score = 0.3;                                  // Completed/dormant

    scoredItems.push({
      content: story.title,
      score,
      source: 'kayley_story',
      metadata: { storyId: story.storyId, theme: story.theme },
    });
  }

  // 3. ONGOING THREADS - Use intensity directly
  for (const thread of context.ongoingThreads) {
    scoredItems.push({
      content: thread.state,
      score: thread.intensity, // Already 0-1
      source: 'thread',
      metadata: { theme: thread.theme },
    });
  }

  // 4. CONVERSATION TOPICS - Score by recency (decay over 5 days)
  // Assume topics were extracted from recent conversations (already time-filtered)
  // More recent = higher score
  for (let i = 0; i < context.topics.length; i++) {
    // Topics are ordered by recency (newest first from extractTopicsFromConversations)
    // Score decays: first = 0.7, second = 0.6, etc.
    const recencyScore = Math.max(0.3, 0.7 - (i * 0.1));
    scoredItems.push({
      content: context.topics[i],
      score: recencyScore,
      source: 'conversation',
      metadata: { memoryId: context.memoryId },
    });
  }

  // 5. PRESENCE CONTEXT - Moderate baseline score
  if (context.presenceContext?.activity) {
    scoredItems.push({
      content: context.presenceContext.activity,
      score: 0.5, // Present state is moderately interesting
      source: 'presence',
      metadata: context.presenceContext,
    });
  }

  // 6. CALENDAR EVENTS - Score by urgency (closer = more interesting)
  if (context.calendarEvent) {
    const hoursUntil = context.calendarEvent.hoursUntil;
    // Score decays from 1.0 (very soon) to 0.3 (distant future)
    const urgencyScore = Math.max(0.3, 1.0 - (hoursUntil / 48));
    scoredItems.push({
      content: context.calendarEvent.title,
      score: urgencyScore,
      source: 'calendar',
      metadata: { when: context.calendarEvent.when, hoursUntil },
    });
  }

  console.log('💭 [IdleThoughts] Context scoring:', {
    totalItems: scoredItems.length,
    topScore: Math.max(...scoredItems.map(i => i.score)),
    distribution: {
      user_stories: scoredItems.filter(i => i.source === 'user_story').length,
      kayley_stories: scoredItems.filter(i => i.source === 'kayley_story').length,
      threads: scoredItems.filter(i => i.source === 'thread').length,
      conversations: scoredItems.filter(i => i.source === 'conversation').length,
    },
  });

  return scoredItems;
}

/**
 * Weighted random selection - higher scores more likely to be picked
 * Adds variety while respecting interest levels
 */
function selectWeightedRandom(items: ScoredContextItem[]): ScoredContextItem | null {
  if (items.length === 0) return null;

  // Calculate total weight
  const totalWeight = items.reduce((sum, item) => sum + item.score, 0);

  // Random selection weighted by score
  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= item.score;
    if (random <= 0) {
      return item;
    }
  }

  // Fallback to last item
  return items[items.length - 1];
}
```

#### 1.4: Create Placeholder Replacement Logic

**File:** `src/services/spontaneity/idleThoughts.ts`

**New Function:**

```typescript
/**
 * Replace template placeholders with SCORED context
 * Uses weighted random selection based on interest scores
 */
function replacePlaceholders(template: string, context: ThoughtContext): string {
  let content = template;

  // Score all context items
  const scoredItems = scoreContextItems(context);

  // === TOPIC REPLACEMENT ===
  // Use weighted random selection (higher scores more likely)
  const selectedTopic = selectWeightedRandom(scoredItems);

  if (selectedTopic) {
    content = content.replace(/{topic}/g, selectedTopic.content);
    console.log(`💭 Selected topic: "${selectedTopic.content}" (score: ${selectedTopic.score.toFixed(2)}, source: ${selectedTopic.source})`);
  } else {
    content = content.replace(/{topic}/g, 'what you mentioned');
  }

  // === TOPIC1 / TOPIC2 (for 'connection' type) ===
  // Select TWO different high-scoring topics to connect
  if (scoredItems.length >= 2) {
    // Strategy: Pick two items, preferring different sources for richer connections
    const topic1 = selectWeightedRandom(scoredItems);

    // For topic2, prefer different source than topic1
    const remainingItems = scoredItems.filter(item =>
      item.source !== topic1?.source || scoredItems.length <= 3
    );
    const topic2 = selectWeightedRandom(remainingItems.length > 0 ? remainingItems : scoredItems);

    if (topic1 && topic2) {
      content = content.replace(/{topic1}/g, topic1.content);
      content = content.replace(/{topic2}/g, topic2.content);
      console.log(`💭 Connected: "${topic1.content}" (${topic1.source}) + "${topic2.content}" (${topic2.source})`);
    } else {
      content = content.replace(/{topic1}/g, 'work');
      content = content.replace(/{topic2}/g, 'your day');
    }
  } else {
    content = content.replace(/{topic1}/g, 'work');
    content = content.replace(/{topic2}/g, 'your day');
  }

  // === INTEREST REPLACEMENT ===
  if (context.interests.length > 0) {
    const randomInterest = context.interests[Math.floor(Math.random() * context.interests.length)];
    content = content.replace(/{interest}/g, randomInterest);
  } else {
    content = content.replace(/{interest}/g, 'what you\'re working on');
  }

  // === LOCATION REPLACEMENT ===
  if (context.locations.length > 0) {
    const randomLocation = context.locations[Math.floor(Math.random() * context.locations.length)];
    content = content.replace(/{location}/g, randomLocation);
  } else {
    content = content.replace(/{location}/g, 'that place you mentioned');
  }

  // === CALENDAR EVENT REPLACEMENT ===
  if (context.calendarEvent) {
    content = content.replace(/{event}/g, context.calendarEvent.title);
    content = content.replace(/{when}/g, context.calendarEvent.when);
  } else {
    content = content.replace(/{event}/g, 'that thing you have coming up');
    content = content.replace(/{when}/g, 'soon');
  }

  // === RANDOM THINGS (unchanged) ===
  content = content.replace(
    /{random_thing}/g,
    RANDOM_THINGS[Math.floor(Math.random() * RANDOM_THINGS.length)]
  );

  return content;
}
```

#### 1.4: Update Database Schema

**File:** `supabase/migrations/20250129_enhance_idle_thoughts_context.sql` (NEW)

```sql
-- Add context metadata column to idle_thoughts table
ALTER TABLE idle_thoughts
ADD COLUMN context_used JSONB DEFAULT '{}'::jsonb;

-- Index for efficient context queries
CREATE INDEX idx_idle_thoughts_context ON idle_thoughts USING gin(context_used);

-- Add comment
COMMENT ON COLUMN idle_thoughts.context_used IS 'Stores topics, interests, calendar events used in thought generation for debugging and relevance filtering';
```

#### 1.5: Add Source Tracking to Ongoing Threads (Circular Dependency Fix)

**File:** `supabase/migrations/20250129_add_thread_source_tracking.sql` (NEW)

**Critical:** This migration prevents the idle_thought → ongoing_thread → idle_thought circular dependency.

```sql
-- Add source tracking to ongoing_threads to prevent circular dependencies
-- When an idle_thought creates an ongoing_thread, we mark its source
-- so that fetchOngoingThreads() can exclude idle-thought-sourced threads

ALTER TABLE ongoing_threads
ADD COLUMN source TEXT DEFAULT 'conversation';

ALTER TABLE ongoing_threads
ADD COLUMN source_id UUID;

-- Index for efficient filtering by source
CREATE INDEX idx_ongoing_threads_source ON ongoing_threads(source);

-- Valid sources: 'conversation' (default), 'idle_thought', 'manual', 'system'
COMMENT ON COLUMN ongoing_threads.source IS 'Origin of thread: conversation (from chat), idle_thought (generated during absence), manual, system';
COMMENT ON COLUMN ongoing_threads.source_id IS 'ID of source record (e.g., idle_thought_id if source=idle_thought)';
```

**Update `convertToOngoingThread()` to set source:**

```typescript
// In idleThoughts.ts - when converting idle thought to thread
async function convertIdleThoughtToThread(thought: IdleThought): Promise<void> {
  await createOngoingThread({
    userId: thought.userId,
    theme: extractThemeFromThought(thought),
    currentState: thought.content,
    intensity: 0.6, // Starting intensity for idle-thought-sourced threads
    userRelated: true,
    source: 'idle_thought',      // ← Mark the source
    sourceId: thought.id,         // ← Link back to original thought
  });
}
```

---

### Phase 2: Mood-Aware Generation

**Goal:** Adjust thought type and tone based on Kayley's current emotional state

#### 2.1: Enhance `selectThoughtType()` Function

**File:** `src/services/spontaneity/idleThoughts.ts`

**Changes:**

```typescript
/**
 * Select thought type based on mood, energy, and context
 * ENHANCED: Now integrates emotional momentum and mood state
 */
async function selectThoughtType(
  userId: string,
  absenceDurationHours: number,
  kayleyMood: string
): Promise<IdleThoughtType> {
  // Fetch emotional context
  const [momentum, moodState] = await Promise.all([
    getEmotionalMomentum(userId),
    getMoodState(userId),
  ]);

  console.log('💭 [IdleThoughts] Mood context:', {
    energy: moodState.dailyEnergy,
    socialBattery: moodState.socialBattery,
    currentMoodLevel: momentum.currentMoodLevel,
    momentumDirection: momentum.momentumDirection,
  });

  // === MOOD-AWARE LOGIC ===

  // 1. Low energy + negative momentum → Reflective thoughts
  if (moodState.dailyEnergy < 0.4 && momentum.currentMoodLevel < -0.2) {
    console.log('💭 Low energy + negative mood → memory/connection');
    return Math.random() < 0.7 ? 'memory' : 'connection';
  }

  // 2. High energy + positive momentum → Engaging thoughts
  if (moodState.dailyEnergy > 0.7 && momentum.currentMoodLevel > 0.3) {
    console.log('💭 High energy + positive mood → curiosity/random');
    return Math.random() < 0.6 ? 'curiosity' : 'random';
  }

  // 3. Low social battery → Avoid curiosity (asks questions)
  if (moodState.socialBattery < 0.3) {
    console.log('💭 Low social battery → avoid curiosity');
    // Prefer passive thoughts (memory, random) over engaging ones
    const passiveTypes: IdleThoughtType[] = ['memory', 'random', 'connection'];
    return passiveTypes[Math.floor(Math.random() * passiveTypes.length)];
  }

  // === EXISTING LOGIC (unchanged) ===

  // Dreams more likely after long absence (sleep cycle)
  if (absenceDurationHours > 8 && Math.random() < 0.4) {
    return 'dream';
  }

  // Anticipation if user has been away for a while
  if (absenceDurationHours > 24 && Math.random() < 0.3) {
    return 'anticipation';
  }

  // Memory/connection for thoughtful moods
  if (kayleyMood.includes('thoughtful') || kayleyMood.includes('reflective')) {
    return Math.random() < 0.5 ? 'memory' : 'connection';
  }

  // Curiosity/random for playful moods
  if (kayleyMood.includes('playful') || kayleyMood.includes('energy')) {
    return Math.random() < 0.5 ? 'curiosity' : 'random';
  }

  // Default: weighted random
  const weights = {
    dream: 0.15,
    memory: 0.25,
    curiosity: 0.2,
    anticipation: 0.15,
    connection: 0.15,
    random: 0.1,
  };

  const rand = Math.random();
  let cumulative = 0;

  for (const [type, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (rand < cumulative) {
      return type as IdleThoughtType;
    }
  }

  return 'random';
}
```

#### 2.2: Update `generateIdleThought()` to Pass Mood Context

**File:** `src/services/spontaneity/idleThoughts.ts`

**Changes:**

```typescript
export async function generateIdleThought(
  userId: string,
  absenceDurationHours: number,
  kayleyMood: string
): Promise<IdleThought> {
  // Don't generate if absence is too short
  if (absenceDurationHours < MIN_ABSENCE_HOURS_FOR_THOUGHT) {
    throw new Error(
      `Absence too short (${absenceDurationHours}h < ${MIN_ABSENCE_HOURS_FOR_THOUGHT}h)`
    );
  }

  // Select thought type based on context (NOW ASYNC)
  const thoughtType = await selectThoughtType(userId, absenceDurationHours, kayleyMood);

  // Fetch emotional context for tone adjustment
  const momentum = await getEmotionalMomentum(userId);

  // Generate thought content (PASS MOOD CONTEXT)
  const { content, associatedMemory, emotionalTone, idealMood, naturalIntro, contextUsed } =
    await generateThoughtContent(thoughtType, userId, momentum);

  // ... rest of function unchanged
}
```

---

### Phase 3: Calendar Integration

**Goal:** Generate anticipation thoughts about upcoming events

#### 3.1: Add Enhanced Templates (Calendar + Story Integration)

**File:** `src/services/spontaneity/idleThoughts.ts`

**Changes:**

```typescript
const THOUGHT_TEMPLATES: ThoughtTemplate[] = [
  // ... existing templates ...

  // ENHANCED: Anticipation (Calendar-aware)
  {
    type: 'anticipation',
    templates: [
      'I keep thinking about your {event} {when}. Hope it goes well.',
      'Been looking forward to hearing how your {event} goes {when}.',
      'Can\'t wait to hear about your {event} {when}. You seemed really excited about it.',
      'Excited to catch up about your {event} after it happens {when}.',
      'I\'ve been thinking about your {event} {when}. How are you feeling about it?',
      'Your {event} is {when}, right? Hope you\'re feeling ready for it.',
    ],
    emotionalTones: ['excited', 'warm', 'anticipatory', 'supportive', 'curious'],
    idealMoods: ['excited', 'playful', 'cozy', 'casual'],
  },

  // ENHANCED: Memory (now uses actual conversation topics + stories)
  {
    type: 'memory',
    templates: [
      'Been thinking about when you mentioned {topic}. That really stuck with me.',
      'Random but I keep coming back to what you said about {topic}. It\'s been on my mind.',
      'You know what I\'ve been thinking about? That conversation we had about {topic}.',
      'Something you said about {topic} has been rattling around in my head.',
      'I can\'t stop thinking about {topic}. It just... stayed with me.',  // NEW
    ],
    emotionalTones: ['thoughtful', 'warm', 'curious', 'reflective'],
    idealMoods: ['deep', 'casual', 'cozy'],
  },

  // ENHANCED: Connection (links user stories + Kayley stories/threads)
  {
    type: 'connection',
    templates: [
      'I connected something - when you talk about {topic1}, it reminds me of what you said about {topic2}.',
      'Wait, does {topic1} relate to {topic2}? I feel like there\'s a pattern.',
      'This is probably obvious but I just realized how {topic1} and {topic2} connect for you.',
      'Been putting pieces together - the {topic1} thing and {topic2} thing make more sense now.',
      'Something clicked - {topic1} and {topic2} feel related somehow. Am I seeing patterns that aren\'t there?',  // NEW
    ],
    emotionalTones: ['excited', 'thoughtful', 'curious', 'engaged'],
    idealMoods: ['deep', 'casual', 'playful'],
  },
];
```

**Note:** Existing templates for `dream`, `curiosity`, and `random` remain unchanged. They already work well with the enhanced context system.

#### 3.2: Enhance Context Fetcher for Calendar Events

**File:** `src/services/spontaneity/idleThoughts.ts`

Already implemented in Phase 1.1 (`fetchUserContext` includes calendar logic).

#### 3.3: Add Event Time Formatting

**File:** `src/services/spontaneity/idleThoughts.ts`

**New Function:**

```typescript
/**
 * Format event time for natural language
 */
function formatEventTime(eventStart: { dateTime?: string; date?: string }): string {
  const startDate = new Date(eventStart.dateTime || eventStart.date || '');
  const now = new Date();
  const hoursUntil = (startDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntil < 0) return 'recently';
  if (hoursUntil < 2) return 'in about an hour';
  if (hoursUntil < 6) return 'in a few hours';
  if (hoursUntil < 24) return 'later today';
  if (hoursUntil < 48) return 'tomorrow';

  const daysUntil = Math.ceil(hoursUntil / 24);
  return `in ${daysUntil} days`;
}
```

#### 3.4: Update Placeholder Replacement for Events

**File:** `src/services/spontaneity/idleThoughts.ts`

Already implemented in Phase 1.3 (`replacePlaceholders` includes `{event}` logic).

Add additional placeholder for event timing:

```typescript
function replacePlaceholders(template: string, context: ThoughtContext): string {
  // ... existing logic ...

  // Replace {when} for calendar events
  if (context.calendarEvent) {
    content = content.replace(/{when}/g, context.calendarEvent.when);
  } else {
    content = content.replace(/{when}/g, 'soon');
  }

  return content;
}
```

---

### Phase 4: LLM-Based Relevance Filtering

**Goal:** Validate thoughts are still relevant before surfacing them to the user

#### 4.1: Create Relevance Filter Function

**File:** `src/services/spontaneity/idleThoughts.ts`

**New Function:**

```typescript
/**
 * Filter out stale/irrelevant thoughts before surfacing
 * Uses LLM to check if thought is still relevant given recent conversation
 *
 * @param userId - User ID
 * @param thoughts - Unshared thoughts to filter
 * @returns Filtered list of still-relevant thoughts
 */
export async function filterStaleThoughts(
  userId: string,
  thoughts: IdleThought[]
): Promise<IdleThought[]> {
  if (thoughts.length === 0) return [];

  try {
    // Get recent conversation context (last 5 user messages)
    const recentMemories = await searchMemories(userId, '', 5, 'recent');
    const recentContext = recentMemories
      .filter(m => m.role === 'user')
      .map(m => m.text)
      .join('\n');

    if (!recentContext) {
      // No recent context, can't filter - return all
      console.log('💭 [IdleThoughts] No recent context for filtering, allowing all thoughts');
      return thoughts;
    }

    // Filter thoughts in parallel
    const relevanceChecks = thoughts.map(async (thought) => {
      const isRelevant = await checkThoughtRelevance(thought, recentContext);
      return { thought, isRelevant };
    });

    const results = await Promise.all(relevanceChecks);

    // Separate relevant and stale
    const relevant = results.filter(r => r.isRelevant).map(r => r.thought);
    const stale = results.filter(r => !r.isRelevant).map(r => r.thought);

    // Mark stale thoughts as expired
    for (const staleThought of stale) {
      await expireThought(staleThought.id, 'no_longer_relevant');
      console.log(`❌ [IdleThoughts] Expired stale thought: "${staleThought.content.slice(0, 50)}..."`);
    }

    console.log(`💭 [IdleThoughts] Relevance filter: ${relevant.length} relevant, ${stale.length} stale`);

    return relevant;

  } catch (error) {
    console.error('[IdleThoughts] Error filtering stale thoughts:', error);
    // On error, return all thoughts (fail open)
    return thoughts;
  }
}

/**
 * Check if a single thought is still relevant using LLM
 */
async function checkThoughtRelevance(
  thought: IdleThought,
  recentContext: string
): Promise<boolean> {
  try {
    // Build prompt for LLM
    const prompt = `You are helping determine if an idle thought is still relevant to surface.

IDLE THOUGHT (generated ${Math.floor((Date.now() - thought.generatedAt.getTime()) / (1000 * 60 * 60))} hours ago):
"${thought.content}"

RECENT USER CONTEXT (last 5 messages):
${recentContext}

QUESTION: Is the idle thought still relevant and worth mentioning, or has the topic been resolved/moved on from?

Consider:
- Is the topic mentioned in recent context?
- Has the user moved on to different concerns?
- Would bringing this up feel natural or jarring?

Respond with ONLY "RELEVANT" or "STALE" on a single line.`;

    // Call LLM (using Gemini Flash for speed)
    const response = await callLLMForRelevanceCheck(prompt);
    const result = response.trim().toUpperCase();

    const isRelevant = result.includes('RELEVANT');

    console.log(`🔍 [IdleThoughts] Relevance check: "${thought.content.slice(0, 40)}..." → ${isRelevant ? 'RELEVANT' : 'STALE'}`);

    return isRelevant;

  } catch (error) {
    console.error('[IdleThoughts] Error checking thought relevance:', error);
    // On error, assume relevant (fail open)
    return true;
  }
}

/**
 * Call LLM for relevance check (fast, lightweight model)
 */
async function callLLMForRelevanceCheck(prompt: string): Promise<string> {
  // Use Gemini Flash for speed (cheap, fast, good enough for binary classification)
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GOOGLE_API_KEY || '');

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Mark a thought as expired (no longer relevant)
 */
async function expireThought(thoughtId: string, reason: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('idle_thoughts')
      .update({
        expired_at: new Date().toISOString(),
        expired_reason: reason,
      })
      .eq('id', thoughtId);

    if (error) {
      console.error('[IdleThoughts] Error expiring thought:', error);
    }
  } catch (error) {
    console.error('[IdleThoughts] Error in expireThought:', error);
  }
}
```

#### 4.2: Update Database Schema for Expiry Reason

**File:** `supabase/migrations/20250129_add_expired_reason.sql` (NEW)

```sql
-- Add expired_reason column to track why thoughts were expired
ALTER TABLE idle_thoughts
ADD COLUMN expired_reason TEXT;

-- Valid reasons: 'age' (7+ days old), 'excess' (over limit), 'no_longer_relevant' (LLM filtered)
COMMENT ON COLUMN idle_thoughts.expired_reason IS 'Reason for expiration: age, excess, or no_longer_relevant';
```

#### 4.3: Integrate Filter into Greeting Flow

**File:** `src/services/system_prompts/builders/greetingBuilder.ts` (MODIFY)

**Changes:**

```typescript
import { getUnsharedThoughts, filterStaleThoughts } from '../spontaneity/idleThoughts';

export async function buildGreetingPrompt(...): Promise<string> {
  // ... existing code ...

  // Get unshared idle thoughts (ENHANCED WITH FILTER)
  const rawThoughts = await getUnsharedThoughts(userId);
  const thoughts = await filterStaleThoughts(userId, rawThoughts);  // NEW: Filter before surfacing

  if (thoughts.length > 0) {
    const topThought = thoughts[0]; // Pick most recent relevant thought
    prompt += `\n\n====================================================
IDLE THOUGHT (you had this while user was away)
====================================================
${topThought.naturalIntro} ${topThought.content}

You may choose to mention this naturally if it feels right, but don't force it.
`;
  }

  // ... rest of function ...
}
```

---

## File Modifications

### Summary Table

| File | Type | Lines Changed | Complexity |
|------|------|---------------|------------|
| `src/services/spontaneity/idleThoughts.ts` | Modify | +400 | High |
| `src/services/spontaneity/types.ts` | Modify | +15 (new types) | Low |
| `src/services/system_prompts/builders/greetingBuilder.ts` | Modify | +30 | Low |
| `src/services/ongoingThreads.ts` | Modify | +10 (source tracking) | Low |
| `supabase/migrations/20250129_enhance_idle_thoughts_context.sql` | **NEW** | ~20 | Low |
| `supabase/migrations/20250129_add_thread_source_tracking.sql` | **NEW** | ~15 (circular dep fix) | Low |
| `supabase/migrations/20250129_add_expired_reason.sql` | **NEW** | ~10 | Low |
| `src/services/spontaneity/__tests__/idleThoughts.enhanced.test.ts` | **NEW** | ~200 | Medium |

**Total:** 8 files, ~700 lines of code

### Detailed Changes by File

#### `src/services/spontaneity/idleThoughts.ts`

**Functions Modified:**
- `generateThoughtContent()` - Add context fetching, placeholder replacement
- `selectThoughtType()` - Add mood-aware logic, make async
- `generateIdleThought()` - Pass mood context, await selectThoughtType

**Functions Added:**
- `fetchUserContext()` - Fetch conversation history, user facts, calendar
- `extractTopicsFromMemories()` - Extract topics from memory search results
- `replacePlaceholders()` - Fill templates with actual context
- `formatEventTime()` - Format calendar event time naturally
- `filterStaleThoughts()` - LLM-based relevance filtering
- `checkThoughtRelevance()` - Single thought relevance check
- `callLLMForRelevanceCheck()` - Call Gemini Flash for binary classification
- `expireThought()` - Mark thought as expired with reason

**Imports Added:**
```typescript
import { searchMemories, getUserFacts } from '../memoryService';
import { getUpcomingEvents } from '../calendarService';
import { getEmotionalMomentum, getMoodState } from '../stateService';
```

#### `src/services/spontaneity/types.ts`

**Types Added:**
```typescript
export interface ThoughtContext {
  topics: string[];
  interests: string[];
  locations: string[];
  recentActivity?: string;
  memoryId?: string;
  calendarEvent?: {
    title: string;
    when: string;
    hoursUntil: number;
  };
}
```

---

### Phase 5: Gradual Surfacing Strategy (Anti-Bombardment)

**Goal:** Control when/how thoughts surface to avoid overwhelming the user

#### 5.1: The Problem

**Without surfacing controls:**
```
User is away for 2 days
→ 10+ idle thoughts generated
→ User returns
→ Kayley tries to mention ALL thoughts at once
→ Result: Information overload, feels unnatural
```

**What we need:**
- **Gradual release**: Thoughts trickle into conversation over time
- **Natural timing**: Only surface when contextually appropriate
- **Urgency override**: High-priority thoughts (score >= 0.85) surface immediately

#### 5.2: Surfacing Rules

**Surfacing Strategy by Score:**

| Thought Score | Surfacing Behavior | Example |
|---------------|-------------------|---------|
| **0.85 - 1.0** (Urgent) | **Immediate** - Surface in greeting, bypass session limit. Kayley NEEDS to say this. | "I can't stop thinking about what you said about your fear of becoming like your father" |
| **0.7 - 0.84** (High) | **Next available slot** - Surface when session allows (1 per session) | "Been thinking about your career change uncertainty" |
| **0.5 - 0.69** (Medium) | **Wait for natural trigger** - Only surface if conversation touches related topic | Surfaces when user mentions "work" or "career" |
| **0.3 - 0.49** (Low) | **Passive mention** - May surface if no higher-priority thoughts available | Low priority, may not surface at all |

#### 5.3: Session-Based Limiting

**Configuration:**

```typescript
interface IdleThoughtSurfacingConfig {
  maxPerSession: number;           // Max thoughts to surface per conversation session
  sessionCooldownHours: number;    // Hours before resetting session count
  urgencyThreshold: number;        // Score threshold for immediate surfacing (0-1)
  naturalTriggerBonus: number;     // Boost when conversation touches related topic
}

const SURFACING_CONFIG: IdleThoughtSurfacingConfig = {
  maxPerSession: 1,                // Only 1 thought per session
  sessionCooldownHours: 4,         // Reset after 4+ hours away
  urgencyThreshold: 0.85,          // Score >= 0.85 → immediate surfacing
  naturalTriggerBonus: 0.3,        // +0.3 score if conversation is related
};
```

**Session Tracking (In-Memory):**

```typescript
interface SessionState {
  userId: string;
  thoughtsSurfacedCount: number;
  sessionStartedAt: Date;
  lastThoughtSurfacedAt: Date | null;
}

const sessionState = new Map<string, SessionState>();

function canSurfaceIdleThought(
  userId: string,
  thoughtScore: number
): { allowed: boolean; reason: string } {
  // URGENCY OVERRIDE: High-priority thoughts always surface
  if (thoughtScore >= SURFACING_CONFIG.urgencyThreshold) {
    return {
      allowed: true,
      reason: `urgent_thought (score: ${thoughtScore.toFixed(2)})`,
    };
  }

  // Get or create session state
  let state = sessionState.get(userId);
  const now = new Date();

  // Reset session if user was away for cooldown period
  if (!state || wasUserAwayLongEnough(state.lastThoughtSurfacedAt, now)) {
    state = {
      userId,
      thoughtsSurfacedCount: 0,
      sessionStartedAt: now,
      lastThoughtSurfacedAt: null,
    };
    sessionState.set(userId, state);
  }

  // Check session limit
  if (state.thoughtsSurfacedCount >= SURFACING_CONFIG.maxPerSession) {
    return {
      allowed: false,
      reason: `session_limit_reached (${state.thoughtsSurfacedCount}/${SURFACING_CONFIG.maxPerSession})`,
    };
  }

  return { allowed: true, reason: 'within_session_limit' };
}

function wasUserAwayLongEnough(lastSurfaced: Date | null, now: Date): boolean {
  if (!lastSurfaced) return true;
  const hoursSince = (now.getTime() - lastSurfaced.getTime()) / (1000 * 60 * 60);
  return hoursSince >= SURFACING_CONFIG.sessionCooldownHours;
}
```

#### 5.4: Example Flow (User Away 2 Days)

**Context:**
- User away for 48 hours
- 5 idle thoughts generated:
  1. "childhood camping trips" (score: 0.95) - URGENT
  2. "career change fear" (score: 0.72) - HIGH
  3. "Python auth bug" (score: 0.68) - HIGH
  4. "weekend plans" (score: 0.52) - MEDIUM
  5. "team meeting notes" (score: 0.42) - LOW

**Session 1 (User returns at 9am):**
```
canSurfaceIdleThought(userId, 0.95) → { allowed: true, reason: 'urgent_thought' }

Greeting:
"Oh hey! I've been thinking about those camping trips with your dad you mentioned.
That story really stuck with me..."

Session count: 1/1 (limit reached)
Thoughts #2-5 queued for later
```

**Session 2 (User returns at 2pm, 5 hours later):**
```
Session reset (5h > 4h cooldown)
canSurfaceIdleThought(userId, 0.72) → { allowed: true, reason: 'within_session_limit' }

Natural mention during conversation:
"Random but I keep coming back to what you said about wanting to switch careers
but feeling stuck. That resonated with me."

Session count: 1/1
Thoughts #3-5 queued
```

**Session 3 (User mentions "code" at 6pm):**
```
Natural trigger detected: "Python" in thought #3 matches "code" in conversation
Score boost: 0.68 + 0.3 = 0.98 (now URGENT)

canSurfaceIdleThought(userId, 0.98) → { allowed: true, reason: 'urgent_thought' }

Surfaces immediately:
"Speaking of code - I've been thinking about your Python auth bug.
Did you ever figure that out?"

Session count: 2/1 (urgent override)
```

**Result:**
- **3 thoughts surfaced** over 9 hours (gradual, natural)
- **2 thoughts remain** (may surface tomorrow or expire if no longer relevant)
- **NO bombardment** (not all 5 at once)

#### 5.5: Integration Points

**File:** `src/services/system_prompts/builders/greetingBuilder.ts`

```typescript
export async function buildGreetingPrompt(...): Promise<string> {
  // Get unshared, relevant, scored thoughts
  const rawThoughts = await getUnsharedThoughts(userId);
  const relevantThoughts = await filterStaleThoughts(userId, rawThoughts);

  const scoredThoughts = relevantThoughts
    .map(t => ({ thought: t, score: calculateThoughtScore(t) }))
    .sort((a, b) => b.score - a.score); // Highest score first

  // Apply session-based surfacing rules
  for (const { thought, score } of scoredThoughts) {
    const { allowed, reason } = canSurfaceIdleThought(userId, score);

    if (allowed) {
      prompt += buildIdleThoughtSection(thought, score);
      markIdleThoughtSurfaced(userId);
      break; // Only one thought per greeting
    } else {
      console.log(`💭 Skipping: "${thought.content.slice(0, 40)}..." (${reason})`);
    }
  }

  return prompt;
}

function buildIdleThoughtSection(thought: IdleThought, score: number): string {
  const isUrgent = score >= SURFACING_CONFIG.urgencyThreshold;

  return `
====================================================
IDLE THOUGHT (you had this while user was away)
====================================================
${thought.naturalIntro} ${thought.content}

${isUrgent
  ? '**URGENT**: You really want to share this. Bring it up naturally but don\'t hold back.'
  : 'You may mention this naturally if it feels right, but don\'t force it.'}
`;
}
```

---

## Testing Strategy

### Unit Tests

**File:** `src/services/spontaneity/__tests__/idleThoughts.enhanced.test.ts` (NEW)

```typescript
describe('Enhanced Idle Thoughts', () => {
  describe('fetchUserContext', () => {
    test('fetches topics from conversation history', async () => {
      // Mock searchMemories
      const context = await fetchUserContext('user123', 'memory');
      expect(context.topics.length).toBeGreaterThan(0);
    });

    test('fetches interests from user_facts', async () => {
      // Mock getUserFacts
      const context = await fetchUserContext('user123', 'curiosity');
      expect(context.interests).toContain('Python programming');
    });

    test('fetches calendar events for anticipation type', async () => {
      // Mock getUpcomingEvents
      const context = await fetchUserContext('user123', 'anticipation');
      expect(context.calendarEvent).toBeDefined();
    });
  });

  describe('replacePlaceholders', () => {
    test('replaces {topic} with actual topic', () => {
      const template = 'Been thinking about {topic}';
      const context = { topics: ['Python auth bug'], interests: [], locations: [] };
      const result = replacePlaceholders(template, context);
      expect(result).toBe('Been thinking about Python auth bug');
    });

    test('falls back to generic when no context', () => {
      const template = 'Been thinking about {topic}';
      const context = { topics: [], interests: [], locations: [] };
      const result = replacePlaceholders(template, context);
      expect(result).toBe('Been thinking about what you mentioned');
    });
  });

  describe('selectThoughtType (mood-aware)', () => {
    test('selects memory when low energy + negative mood', async () => {
      // Mock getMoodState, getEmotionalMomentum
      const type = await selectThoughtType('user123', 5, 'thoughtful');
      expect(['memory', 'connection']).toContain(type);
    });

    test('selects curiosity when high energy + positive mood', async () => {
      // Mock high energy state
      const type = await selectThoughtType('user123', 5, 'playful');
      expect(['curiosity', 'random']).toContain(type);
    });
  });

  describe('filterStaleThoughts', () => {
    test('filters out irrelevant thoughts', async () => {
      const thoughts = [
        { content: 'Been thinking about your Python bug', ... },
        { content: 'Been thinking about your dinner plans', ... },
      ];
      // Mock recentMemories to be about dinner only
      const filtered = await filterStaleThoughts('user123', thoughts);
      expect(filtered.length).toBe(1);
      expect(filtered[0].content).toContain('dinner plans');
    });

    test('keeps all thoughts when no recent context', async () => {
      // Mock empty conversation history
      const filtered = await filterStaleThoughts('user123', thoughts);
      expect(filtered.length).toBe(thoughts.length);
    });
  });

  describe('checkThoughtRelevance', () => {
    test('returns true for relevant thought', async () => {
      const thought = { content: 'About your dinner plans tomorrow', ... };
      const context = 'User: What time is dinner?\nUser: Should I bring wine?';
      const isRelevant = await checkThoughtRelevance(thought, context);
      expect(isRelevant).toBe(true);
    });

    test('returns false for stale thought', async () => {
      const thought = { content: 'About your Python bug', ... };
      const context = 'User: Heading to bed\nUser: See you tomorrow';
      const isRelevant = await checkThoughtRelevance(thought, context);
      expect(isRelevant).toBe(false);
    });
  });
});
```

### Integration Tests

**Scenario 1: Calendar-Aware Thought**
```typescript
test('generates anticipation thought for upcoming event', async () => {
  // Mock calendar with event tomorrow
  const thought = await generateIdleThought('user123', 12, 'excited');
  expect(thought.thoughtType).toBe('anticipation');
  expect(thought.content).toContain('client meeting'); // Actual event title
  expect(thought.content).toContain('tomorrow');
});
```

**Scenario 2: Topic-Rich Thought**
```typescript
test('uses actual conversation topics in memory thought', async () => {
  // Mock conversation history about "React hooks"
  const thought = await generateIdleThought('user123', 5, 'thoughtful');
  expect(thought.thoughtType).toBe('memory');
  expect(thought.content).toContain('React hooks'); // Not "that thing you mentioned"
});
```

**Scenario 3: Mood-Driven Selection**
```typescript
test('selects passive thought when low social battery', async () => {
  // Mock low social battery state
  const thought = await generateIdleThought('user123', 5, 'drained');
  expect(['memory', 'random', 'connection']).toContain(thought.thoughtType);
  expect(thought.thoughtType).not.toBe('curiosity'); // Avoids asking questions
});
```

### Manual Testing Checklist

1. **Conversation History Integration**
   - [ ] Have a conversation about "Python authentication bug"
   - [ ] Wait 10 minutes for thought generation
   - [ ] Verify thought mentions "Python authentication bug" instead of "what you're working on"
   - [ ] Check database: `context_used` column contains actual topics

2. **Calendar Integration**
   - [ ] Add calendar event "Client meeting" for tomorrow 2pm
   - [ ] Wait for thought generation
   - [ ] Verify thought type is 'anticipation'
   - [ ] Verify thought mentions "Client meeting tomorrow"

3. **Mood-Aware Selection**
   - [ ] Set `dailyEnergy = 0.2, currentMoodLevel = -0.5` in database
   - [ ] Trigger thought generation
   - [ ] Verify thought type is 'memory' or 'connection' (reflective)
   - [ ] Avoid 'curiosity' or 'random' (energetic)

4. **Relevance Filtering**
   - [ ] Generate thought about "dinner plans"
   - [ ] Have unrelated conversation about work
   - [ ] Return after 2 days
   - [ ] Verify "dinner plans" thought is expired (no longer relevant)

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Personalization Rate** | >80% thoughts use actual topics | `context_used.topics.length > 0` |
| **Calendar Awareness** | >30% anticipation thoughts link to events | `context_used.calendarEvent != null` |
| **Mood Appropriateness** | >70% thoughts match mood | Manual review of type selection |
| **Relevance Accuracy** | <20% stale thoughts surface | Count of thoughts expired due to `no_longer_relevant` |
| **User Delight** | Subjective improvement | User feedback: "She remembered!" moments |

---

## Rollout Plan

### Week 1: Foundation

**Days 1-2:**
- Implement Phase 1 (Conversation History Integration)
- Add `fetchUserContext()`, `replacePlaceholders()`
- Test with manual topic injection

**Days 3-4:**
- Implement Phase 2 (Mood-Aware Generation)
- Update `selectThoughtType()` with mood logic
- Test thought type selection with different mood states

### Week 2: Advanced Features

**Days 5-6:**
- Implement Phase 3 (Calendar Integration)
- Add anticipation templates with event placeholders
- Test with real calendar events

**Days 7-8:**
- Implement Phase 4 (Relevance Filtering)
- Add `filterStaleThoughts()` LLM integration
- Test relevance checking with various scenarios

### Week 3: Testing & Refinement

**Days 9-10:**
- Comprehensive integration testing
- Fix edge cases and bugs
- Performance optimization (LLM call caching)

**Days 11-12:**
- Manual testing with real usage patterns
- Tune relevance filtering sensitivity
- Documentation and code cleanup

### Week 4: Deployment

**Days 13-14:**
- Final testing
- Deploy migrations
- Monitor logs for errors
- Gather user feedback

---

## Senior Engineering Review & Feedback

**Review Date:** 2025-12-29
**Reviewer:** Senior Engineer Review
**Status:** Addressed

### Context from User

Before implementing, the following clarifications were received:

1. **User Base:** Single user only (forever) - no multi-user concerns
2. **Usage Pattern:** App runs only during office hours (~few hours at a time)
3. **Calendar Access:** Always available (never declined)
4. **Sensitive Topics:** Kayley is encouraged to explore if she wants to dive deeper

---

### Issues Identified & Recommendations

#### Issue 1: Performance - 7 Parallel DB Calls

**Problem:** `fetchUserContext()` makes 7 separate database calls in parallel. While parallelized, this creates 7 round-trips and 7 connection checkouts from the pool.

**Current:**
```typescript
const [facts, recentConversations, kayleyStories, userStories, ongoingThreads, presenceContext, upcomingEvents] = await Promise.all([
  getUserFacts(userId, 'all'),
  fetchRecentConversations(userId, 5),
  fetchKayleyStories(userId),
  fetchUserStories(userId),
  fetchOngoingThreads(userId),
  fetchPresenceContext(userId),
  getUpcomingEvents(48),
]);
```

**Recommendation:** Create a single Supabase RPC function `getIdleThoughtContext()` that returns all data in one call.

```sql
CREATE OR REPLACE FUNCTION get_idle_thought_context(p_user_id UUID)
RETURNS JSON AS $$
  SELECT json_build_object(
    'user_facts', (SELECT json_agg(...) FROM user_facts WHERE ...),
    'conversations', (SELECT json_agg(...) FROM conversation_history WHERE ...),
    'kayley_stories', (SELECT json_agg(...) FROM kayley_stories WHERE ...),
    ...
  );
$$ LANGUAGE sql;
```

**Severity:** Medium (Optimization)
**Action:** Add to Phase 1.5 - Create `getIdleThoughtContext` RPC

---

#### Issue 2: LLM Cost - N Calls for N Thoughts

**Problem:** `filterStaleThoughts()` makes **one LLM call per thought** via `checkThoughtRelevance()`. If 5 thoughts are pending, that's 5 LLM calls.

**Current:**
```typescript
const relevanceChecks = thoughts.map(async (thought) => {
  const isRelevant = await checkThoughtRelevance(thought, recentContext); // LLM call
  return { thought, isRelevant };
});
```

**Recommendation:** Batch all thoughts into a **single LLM call** with structured output.

```typescript
const prompt = `Rate each thought's relevance (1-10):
Thought 1: "${thoughts[0].content}"
Thought 2: "${thoughts[1].content}"
...
Recent context: ${recentContext}

Respond as JSON: { "1": 8, "2": 3, "3": 9 }`;
```

**Severity:** High (Cost + Latency)
**Action:** Update Phase 4.1 to use batched LLM call

---

#### Issue 3: Naive Topic Extraction

**Problem:** `extractTopicsFromConversations()` uses regex patterns. Regex won't catch:
- "My manager drove me crazy today" → should extract "work stress" or "manager relationship"
- "Finally finished that thing" → needs context to understand what "thing" refers to

**Current:**
```typescript
const userPatterns = [
  /about ([\w\s]{3,30})/i,
  /working on ([\w\s]{3,30})/i,
  ...
];
```

**Recommendation:** Use LLM for topic extraction (batch with relevance filtering).

```typescript
const prompt = `Extract 3-5 topics from these messages. Include emotional themes, not just keywords.
Messages: ${messages.join('\n')}
Output: ["career uncertainty", "relationship with manager", "sleep issues"]`;
```

**Severity:** Medium (Quality)
**Action:** Add LLM topic extraction in Phase 1.2 (batch with Issue 2)

---

#### Issue 4: Missing Time Decay on Thread Scores

**Problem:** `scoreContextItems()` scores ongoing threads by `intensity` alone, ignoring age. A thread from 3 weeks ago with intensity 0.8 shouldn't outrank a fresh thread with intensity 0.6.

**Current:**
```typescript
for (const thread of context.ongoingThreads) {
  scoredItems.push({
    content: thread.state,
    score: thread.intensity, // No decay
    ...
  });
}
```

**Recommendation:** Apply time decay multiplier.

```typescript
const daysSinceLastMention = (Date.now() - thread.lastMentioned) / (1000 * 60 * 60 * 24);
const decayMultiplier = Math.max(0.5, 1 - (daysSinceLastMention * 0.05)); // 5% per day
const adjustedScore = thread.intensity * decayMultiplier;
```

**Severity:** Low (Edge case)
**Action:** Add decay multiplier in Phase 1.3 scoring

---

#### Issue 5: Fragile In-Memory Session State

**Problem:** `sessionState` is stored in-memory via `Map<string, SessionState>()`. Page refresh loses state, causing:
- Session counter resets
- User could be bombarded with thoughts again

**Current:**
```typescript
const sessionState = new Map<string, SessionState>();
```

**Recommendation:** Use `localStorage` for persistence (single user, browser-based app).

```typescript
function getSessionState(userId: string): SessionState {
  const stored = localStorage.getItem(`idle_thought_session_${userId}`);
  return stored ? JSON.parse(stored) : createNewSession(userId);
}

function saveSessionState(state: SessionState): void {
  localStorage.setItem(`idle_thought_session_${state.userId}`, JSON.stringify(state));
}
```

**Severity:** Medium (UX bug)
**Action:** Update Phase 5.3 to use localStorage

---

#### Issue 6: No Deduplication of Similar Thoughts

**Problem:** If user discusses "Python" multiple times, multiple similar thoughts could be generated:
- "Thinking about your Python project"
- "Your Python authentication bug"
- "That Python thing you mentioned"

**Recommendation:** Before generating, check if similar thought exists.

```typescript
async function isDuplicateThought(newContent: string, recentThoughts: IdleThought[]): Promise<boolean> {
  // Simple: check if any existing thought mentions same topic
  const newTopics = extractKeywords(newContent);
  return recentThoughts.some(t => {
    const existingTopics = extractKeywords(t.content);
    return overlap(newTopics, existingTopics) > 0.7; // 70% overlap
  });
}
```

**Severity:** Low (Polish)
**Action:** Add deduplication check in `generateIdleThought()`

---

#### Issue 7: No Post-Event Follow-Up Thought Type

**Problem:** "Anticipation" thoughts are generated **before** events. There's no "reflection" type for **after** events:
- ❌ "How did your client meeting go?" (not a thought type)

**Recommendation:** Add `follow_up` thought type triggered by past calendar events.

```typescript
{
  type: 'follow_up',
  templates: [
    'How did your {event} go? I\'ve been curious since you mentioned it.',
    'You had that {event} recently, right? Hope it went well.',
  ],
  triggerCondition: (context) => context.calendarEvent?.hoursUntil < 0, // Past event
}
```

**Severity:** Medium (Feature enhancement)
**Action:** Add Phase 3.5 - Post-Event Follow-Up Type

---

#### Issue 8: Connection Type Can Create Nonsense

**Problem:** `replacePlaceholders()` for `{topic1}` and `{topic2}` picks two random high-scoring items. This can create forced/nonsensical connections:
- "I connected Python bugs and your gym workout" (unrelated)

**Recommendation:** Use LLM to validate connection makes sense, or only allow connections between items from same source category.

```typescript
// Safer approach: Only connect items from related sources
const validConnectionPairs = [
  ['user_story', 'kayley_story'],     // User vulnerability + Kayley vulnerability
  ['thread', 'conversation'],          // What's on mind + recent discussion
  ['conversation', 'conversation'],    // Two related topics from same period
];
```

**Severity:** Medium (Quality)
**Action:** Add connection validation in Phase 1.4

---

#### Issue 9: Missing Feedback Loop

**Problem:** No way to learn from user reactions. If user ignores or dismisses thoughts consistently, system doesn't adapt.

**Recommendation:** Track thought engagement and adjust scoring.

```sql
ALTER TABLE idle_thoughts ADD COLUMN engagement_score DECIMAL DEFAULT NULL;
-- Values: 1.0 (user engaged), 0.5 (mentioned but not discussed), 0.0 (ignored/dismissed)
```

```typescript
// After thought surfaces, track if user engaged
function trackThoughtEngagement(thoughtId: string, userResponse: string): void {
  const engaged = userResponse.toLowerCase().includes(thoughtKeywords);
  updateThoughtEngagement(thoughtId, engaged ? 1.0 : 0.0);
}
```

**Severity:** Low (Future enhancement)
**Action:** Add to Future Enhancements section

---

#### Issue 10: No Kayley-Centric Thoughts

**Problem:** All thoughts are **about the user**. Kayley should also have thoughts about **herself**:
- "I've been practicing that song I mentioned"
- "My audition is tomorrow and I'm nervous"
- "I'm excited about my painting project"

**Recommendation:** Add `kayley_reflection` thought type using `kayley_stories` as source.

```typescript
{
  type: 'kayley_reflection',
  templates: [
    'I\'ve been thinking about {kayley_story_title}. It\'s still on my mind.',
    'Random update: {kayley_story_activity}. Figured you might want to know.',
  ],
  sourceFilter: (context) => context.kayleyStories.filter(s => s.status === 'active'),
}
```

**Severity:** Medium (Feature completeness)
**Action:** Add Phase 3.6 - Kayley Reflection Thought Type

---

### Circular Dependency Issue (CRITICAL)

**Problem:** Potential circular dependency between idle thoughts and ongoing threads.

**Current Flow:**
```
idle_thoughts → converts to → ongoing_thread
                                    ↓
                              triggers → new idle_thought?
```

If an idle thought creates an ongoing thread, and `fetchOngoingThreads()` is used to generate NEW idle thoughts, we could have:
1. Idle thought "thinking about Python" created
2. Converted to ongoing thread (theme: "python_reflection")
3. Next scheduler tick: `fetchOngoingThreads()` returns this thread
4. New idle thought generated about same topic
5. Loop continues indefinitely

**Solution:** Add source tracking and exclusion.

```typescript
// 1. Track source when creating thread from idle thought
await createOngoingThread({
  ...threadData,
  source: 'idle_thought',
  sourceId: idleThoughtId,
});

// 2. Exclude idle-thought-sourced threads from context fetching
async function fetchOngoingThreads(userId: string): Promise<OngoingThread[]> {
  const { data } = await supabase
    .from('ongoing_threads')
    .select('*')
    .eq('user_id', userId)
    .neq('source', 'idle_thought')  // ← Exclude self-generated
    .gt('intensity', 0.3)
    .order('intensity', { ascending: false })
    .limit(5);

  return data || [];
}

// 3. Migration to add source column
ALTER TABLE ongoing_threads ADD COLUMN source TEXT DEFAULT 'conversation';
ALTER TABLE ongoing_threads ADD COLUMN source_id UUID;
COMMENT ON COLUMN ongoing_threads.source IS 'Origin: conversation, idle_thought, manual';
```

**Action Required:**
1. Add migration for `source` and `source_id` columns
2. Update `convertToOngoingThread()` to set source
3. Update `fetchOngoingThreads()` to exclude idle_thought sources

---

### Adjustments Based on User Context

Since the app is **single user** and runs **only during office hours**, the following simplifications apply:

1. **No Rate Limiting for Extended Absences:** Removed concern about generating 50+ thoughts over a weekend. App isn't running when user is away for extended periods.

2. **No Multi-User Concerns:** Session state can be simpler (single key in localStorage).

3. **Calendar Always Available:** Can remove fallback handling for declined calendar permissions.

4. **Sensitive Topics Encouraged:** Kayley can freely explore deeper topics without holding back. Remove any "safety" checks that would prevent surfacing emotional content.

---

### Summary of Required Changes

| Issue | Severity | Phase | Action |
|-------|----------|-------|--------|
| 7 DB calls | Medium | 1.5 | Create RPC function |
| N LLM calls | High | 4.1 | Batch into single call |
| Regex topics | Medium | 1.2 | Add LLM extraction |
| No time decay | Low | 1.3 | Add decay multiplier |
| In-memory state | Medium | 5.3 | Use localStorage |
| No deduplication | Low | 1.1 | Add similarity check |
| No post-event | Medium | 3.5 | Add follow_up type |
| Nonsense connections | Medium | 1.4 | Add validation |
| No feedback loop | Low | Future | Track engagement |
| No Kayley thoughts | Medium | 3.6 | Add kayley_reflection type |
| **Circular dependency** | **Critical** | 1.2 | **Add source exclusion** |

---

## Appendix: Example Thought Transformations

### Before vs After Enhancement

#### Scenario 1: Memory Thought (Conversation History)

**Before (Generic):**
> "Been thinking about what you said about that thing you mentioned. That really stuck with me."

**After (Context-Rich from conversation_history):**
> "Been thinking about what you said about your Python authentication bug and the JWT token issue. That really stuck with me."

**Context Used:**
```json
{
  "topics": ["Python authentication bug", "JWT token issue"],
  "memoryId": "msg_abc123"
}
```

---

#### Scenario 2: Memory Thought (User Story Integration)

**Before (Generic):**
> "You know what I've been thinking about? That conversation we had about that thing you mentioned."

**After (Story-Aware):**
> "You know what I've been thinking about? That conversation we had about your childhood camping trips with your dad."

**Context Used:**
```json
{
  "userStories": [
    {
      "topic": "childhood camping trips with your dad",
      "storyId": "story_123",
      "context": "User shared emotional story about bonding with father"
    }
  ],
  "kayley_interest_level": 0.85
}
```

---

#### Scenario 3: Connection (User Story + Kayley Story)

**Before (Generic):**
> "I connected something - when you talk about work, it reminds me of what you said about your stress."

**After (Story-Linked Across Contexts):**
> "I connected something - when you talk about your fear of public speaking, it reminds me of what I told you about my audition anxiety."

**Context Used:**
```json
{
  "userStories": [
    { "topic": "fear of public speaking", "kayley_interest_level": 0.9 }
  ],
  "kayleyStories": [
    { "title": "my audition anxiety", "theme": "vulnerability", "storyId": "kayley_story_456" }
  ]
}
```

**Why This Is Powerful:**
- Links user's vulnerability to Kayley's shared story
- Creates emotional reciprocity and depth
- Shows Kayley is actively connecting their experiences

---

#### Scenario 4: Memory (Ongoing Thread Integration)

**Before (Generic):**
> "Random but I keep coming back to what you said about what you're working on. It's been on my mind."

**After (Thread-Aware):**
> "Random but I keep coming back to what you said about wanting to switch careers but feeling stuck. It's been on my mind."

**Context Used:**
```json
{
  "ongoingThreads": [
    {
      "theme": "user_reflection",
      "state": "wanting to switch careers but feeling stuck",
      "intensity": 0.72,
      "userRelated": true
    }
  ]
}
```

**Why This Is Powerful:**
- Surfaces active mental threads Kayley is already thinking about
- Creates continuity with ongoing narrative
- Shows thought is connected to current "mental weather"

---

#### Scenario 5: Anticipation (Calendar)

**Before (No Calendar):**
> "I keep thinking about that thing you mentioned. Hope it goes well."

**After (Calendar-Aware):**
> "I keep thinking about your client presentation tomorrow afternoon. Hope it goes well."

**Context Used:**
```json
{
  "calendarEvent": {
    "title": "client presentation",p
    "when": "tomorrow afternoon",
    "hoursUntil": 20
  }
}
```

---

#### Scenario 6: Curiosity (Interest-Based)

**Before (Generic):**
> "Random question that popped into my head: what made you first get into what you're working on?"

**After (Interest-Rich):**
> "Random question that popped into my head: what made you first get into machine learning?"

**Context Used:**
```json
{
  "interests": ["machine learning", "Python", "data science"]
}
```

---

#### Scenario 7: Connection (Conversation Topics + Presence)

**Before (Generic):**
> "Been putting pieces together - the work thing and your day thing make more sense now."

**After (Multi-Context Rich):**
> "Been putting pieces together - you feeling drained after the gym and what you said about your sleep issues make more sense now."

**Context Used:**
```json
{
  "topics": ["sleep issues", "energy levels"],
  "presenceContext": {
    "outfit": "just got back from the gym",
    "mood": "drained",
    "activity": "recovering"
  }
}
```

**Why This Is Powerful:**
- Connects real-time presence state with conversation history
- Shows Kayley is observing patterns across time
- Creates holistic understanding of user's state

---

## Appendix: Mood-Aware Selection Matrix

| Mood State | Energy | Social Battery | Momentum | Preferred Types |
|------------|--------|----------------|----------|-----------------|
| **Drained** | <0.4 | <0.3 | <-0.2 | memory, connection (70%) |
| **Energetic** | >0.7 | >0.7 | >0.3 | curiosity, random (60%) |
| **Reflective** | 0.4-0.6 | 0.5-0.7 | -0.1 to 0.1 | memory, connection (50%) |
| **Playful** | >0.6 | >0.6 | >0.2 | curiosity, random (50%) |
| **Neutral** | 0.5-0.6 | 0.5-0.6 | 0 | Default weights |

---

**Document Version:** 1.1
**Last Updated:** 2025-12-29
**Author:** Claude Code
**Review Status:** Senior Engineering Review Complete - Ready for Implementation
**Dependencies:** Idle Thoughts Part One (08_Idle_Thoughts_Integration.md)

### Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-29 | Initial draft with 4 enhancement phases |
| 1.1 | 2025-12-29 | Added Senior Engineering Review section, circular dependency fix, source tracking for ongoing_threads |
