# Session Reflection & Idle Thoughts System

**Status:** ✅ Implemented (Dec 2025)

## Overview

The Independent Reflection Loop system gives Kayley the ability to "think about" conversations after they end and generate thoughts during user absence. This creates:

1. **Session Reflections** - Post-conversation synthesis when user goes absent
2. **Idle Thoughts** - Dreams, memories, curiosities generated during long absences (>4 hours)

Both systems feed the idle breaker to create personalized conversation starters on user return.

## Architecture

```
User goes absent (5+ min idle)
    ↓
Session Reflection created
    ├── Emotional arc synthesis
    ├── Memorable moment extraction
    ├── Unresolved threads identification
    ├── Relationship impact calculation
    └── Follow-up suggestions

User stays absent (>4 hours)
    ↓
Idle Thoughts generated
    ├── Dreams (especially overnight)
    ├── Memories (reflective moods)
    ├── Curiosities (playful moods)
    ├── Anticipations (long absences)
    ├── Connections (insight moments)
    └── Random thoughts

User returns
    ↓
Idle Breaker selects topic
    ├── Tier 1: High-salience open loop (0.8+)
    ├── Tier 2: Idle thought to share
    ├── Tier 3: Standard open loop (0.7+)
    └── Tier 4: Generic fallback
```

## Core Files

### Services

| File | Purpose |
|------|---------|
| `spontaneity/sessionReflection.ts` | Post-session synthesis |
| `spontaneity/idleThoughts.ts` | Absence-driven thought generation |

### Database Tables

| Table | Purpose |
|-------|---------|
| `session_reflections` | Stores post-session reflections (max 30 per user) |
| `idle_thoughts` | Stores generated thoughts (max 5 unshared per user) |

## Session Reflections

### Creation Trigger

Session reflections should be created when:
- User goes absent after meaningful conversation (5+ messages)
- Last message timestamp + timeout threshold (e.g., 5 minutes)
- Called from: `App.tsx` idle detection or `BaseAIService` session cleanup

### Data Structure

```typescript
interface SessionReflection {
  id: string;
  userId: string;

  // Session metadata
  sessionStartAt: Date;
  sessionEndAt: Date;
  messageCount: number;

  // Emotional arc
  emotionalArc: string;              // "Started tense, ended playful"
  dominantMood: ConversationalMood;  // Most common mood
  moodProgression: MoodProgression[];

  // Key moments
  memorableMoments: MemorableMoment[];
  unresolvedThreads: string[];       // Topics left hanging

  // Relationship impact
  intimacyDelta: number;             // -1 to 1
  trustDelta: number;
  warmthDelta: number;

  // Learnings
  newUserFacts: string[];
  conversationInsights: string;      // Kayley's reflection
  suggestedFollowups: string[];
}
```

### Usage Example

```typescript
import { createSessionReflection } from './services/spontaneity';

// When user goes idle
const reflection = await createSessionReflection(userId, {
  sessionStartAt: new Date('2025-01-01T10:00:00Z'),
  sessionEndAt: new Date('2025-01-01T11:00:00Z'),
  messageCount: 15,
  memorableMoments: [
    {
      type: 'vulnerable',
      content: 'User opened up about job stress',
      emotionalWeight: 0.8,
    },
    {
      type: 'funny',
      content: 'Shared inside joke about coffee',
      emotionalWeight: 0.6,
    },
  ],
  moodProgression: [
    { timestamp: new Date(), mood: 'casual' },
    { timestamp: new Date(), mood: 'deep', trigger: 'vulnerability' },
    { timestamp: new Date(), mood: 'playful' },
  ],
});

// Reflection now stored for future reference
console.log(reflection.emotionalArc);
// "Started casual, shifted to deep, ended playful"

console.log(reflection.conversationInsights);
// "They opened up - that's huge. Had some good laughs."
```

### Retrieval

```typescript
// Get recent reflections (for context or patterns)
const reflections = await getRecentReflections(userId, 5);

// Get unresolved threads (for proactive starters)
const threads = await getUnresolvedThreadsFromReflections(userId);
// ["Career change discussion", "Moving plans", "Family visit"]
```

## Idle Thoughts

### Generation Trigger

Idle thoughts should be generated when:
- User has been absent for >4 hours
- Periodic check (every 4-8 hours of absence)
- Called from: Background job or periodic timer in `App.tsx`

### Thought Types

| Type | When Generated | Example |
|------|---------------|---------|
| `dream` | Long absences (8+ hours, overnight) | "I had this dream where we were trying to find that place you mentioned..." |
| `memory` | Thoughtful moods | "Been thinking about what you said about your career..." |
| `curiosity` | Playful moods | "Random question - what made you first get into photography?" |
| `anticipation` | Very long absences (24+ hours) | "Can't wait to hear how that interview went." |
| `connection` | Insight moments | "Wait, does your work stress relate to the sleep issues you mentioned?" |
| `random` | Any time | "Don't ask why but I've been thinking about how weird it is that..." |

### Data Structure

```typescript
interface IdleThought {
  id: string;
  userId: string;

  // Content
  thoughtType: IdleThoughtType;
  content: string;                   // The actual thought
  associatedMemory?: string;         // What triggered it
  emotionalTone: string;             // wistful, excited, anxious, etc.

  // Dream-specific
  isRecurring: boolean;              // 20% of dreams
  dreamImagery?: Record<string, unknown>;

  // Relationship to user
  involvesUser: boolean;             // 70% of thoughts
  userRoleInThought?: string;        // companion, guide, hero, etc.

  // Proactive use
  canShareWithUser: boolean;
  idealConversationMood?: ConversationalMood;
  naturalIntro: string;              // "I had this dream..."

  // Lifecycle
  generatedAt: Date;
  sharedAt?: Date;                   // NULL until shared
  expiredAt?: Date;                  // Auto-expire after 7 days

  // Context
  absenceDurationHours: number;
  kayleyMoodWhenGenerated: string;
}
```

### Usage Example

```typescript
import {
  generateIdleThought,
  getUnsharedThoughts,
  markThoughtAsShared
} from './services/spontaneity';

// Generate thought during absence
const thought = await generateIdleThought(
  userId,
  absenceDurationHours: 10,
  kayleyMood: 'thoughtful'
);

console.log(thought.thoughtType);  // "memory"
console.log(thought.naturalIntro); // "I've been thinking about..."
console.log(thought.content);
// "Been thinking about when you mentioned that job interview. That really stuck with me."

// Later: Get unshared thoughts for idle breaker
const unshared = await getUnsharedThoughts(userId);
// Returns array of thoughts ready to share

// When Kayley mentions it in conversation
await markThoughtAsShared(thought.id);
```

## Integration with Idle Breaker

The idle breaker should be modified to include idle thoughts in tier 2:

```typescript
async function selectIdleBreakerTopic(userId: string): Promise<IdleTopic> {
  const [loops, threads, idleThoughts] = await Promise.all([
    getActiveLoops(userId),
    getOngoingThreads(userId),
    getUnsharedThoughts(userId),
  ]);

  // Tier 1: High-salience user loop (0.8+)
  const urgentLoop = loops.find(l => l.salience >= 0.8);
  if (urgentLoop) {
    return { type: "user_loop", topic: urgentLoop, priority: 1 };
  }

  // Tier 2a: Idle thought to share
  if (idleThoughts.length > 0) {
    // Pick most recent or best mood-matched
    const bestThought = selectBestIdleThought(idleThoughts, currentMood);
    if (bestThought) {
      return { type: "idle_thought", topic: bestThought, priority: 2 };
    }
  }

  // Tier 2b: Proactive thread (existing system)
  const activeThread = selectProactiveThread(threads);
  if (activeThread) {
    return { type: "kayley_thread", topic: activeThread, priority: 2 };
  }

  // Tier 3: Standard user loop (0.7+)
  const standardLoop = loops.find(l => l.salience >= 0.7);
  if (standardLoop) {
    return { type: "user_loop", topic: standardLoop, priority: 3 };
  }

  // Tier 4: Generic fallback
  return { type: "generic", topic: selectGenericTopic(), priority: 4 };
}
```

## Cleanup & Maintenance

Both systems auto-cleanup to prevent bloat:

### Session Reflections
- Keep last 30 reflections per user
- Auto-delete oldest when creating new ones
- Triggered on reflection creation

### Idle Thoughts
- Expire after 7 days (unshared or shared)
- Cap at 5 unshared thoughts per user
- Excess thoughts auto-expired
- Triggered on thought generation

## Testing

```bash
# Run session reflection tests
npm test -- --run -t "Session Reflection"

# Run idle thoughts tests
npm test -- --run -t "Idle Thoughts"

# Run all spontaneity tests
npm test -- --run -t "spontaneity"
```

## Future Enhancements

1. **LLM-Generated Reflections** - Use LLM to synthesize insights instead of rule-based
2. **User Fact Integration** - Pull actual user topics/interests into thought templates
3. **Dream Imagery** - Store visual elements for potential future image generation
4. **Reflection-Based Learning** - Use reflections to update relationship metrics
5. **Shared Thought Tracking** - Analytics on which thought types land best
6. **Recurring Dream Detection** - Track patterns in dream content over time

## Migration Notes

Database tables were created in: `supabase/migrations/create_spontaneity_tables.sql`

Both tables already exist in production Supabase instance - no migration needed.

## Related Systems

- **Open Loops** (`presenceDirector.ts`) - User-related follow-ups
- **Ongoing Threads** (`ongoingThreads.ts`) - Kayley's mental weather
- **Idle Breaker** (in `BaseAIService.ts`) - Proactive conversation starters
- **Intent Service** (`intentService.ts`) - Provides memorable moment detection

## Example Flow

```
1. User: "I have a job interview tomorrow"
   → Intent detects open loop
   → Stored as pending_event loop

2. User goes idle (10 min)
   → Session reflection created
   → Emotional arc: "Started casual, ended supportive"
   → Unresolved threads: []
   → Suggested followups: ["Check in about interview"]

3. User stays absent overnight (10 hours)
   → Idle thought generated (type: dream)
   → Content: "Had this dream where we were prepping for your interview..."
   → Stored as unshared thought

4. User returns next day
   → Idle breaker checks priorities:
     - Tier 1: Interview loop (salience 0.9) ← WINNER
   → Response: "Hey! How did the interview go?"

5. User: "It went great!"
   → Loop marked resolved
   → Idle thought remains unshared (can surface later)
```

---

**Implementation Status:** ✅ Complete
**Test Coverage:** 37 tests (15 session reflection + 22 idle thoughts)
**Database:** Ready (tables exist in production)
**Integration:** Pending (idle breaker modification needed)
