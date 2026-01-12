# Autonomous Thought Service

The `autonomousThoughtService.ts` generates dynamic, context-aware thoughts for Kayley's "mental weather" system. Instead of selecting from 30 hardcoded templates, it uses an LLM to create thoughts that reflect her current mood, recent conversations, relationship depth, and life events.

## Core Responsibilities

1. **Dynamic Thought Generation**: Creates unique autonomous thoughts based on context (theme, mood, relationship, life events)
2. **Quality Gating**: Evaluates whether generated thoughts should be surfaced (`shouldMention`, `confidence`, `intensity`)
3. **Aggressive Caching**: Caches thoughts for 30 minutes to minimize LLM costs and latency
4. **Graceful Degradation**: Returns empty results on failure (no crashes, no hardcoded fallbacks)

## The Three Sources Principle

All generated thoughts must derive from three core behavior sources:

1. **Character Profile** (`KAYLEY_FULL_PROFILE`) - Who she is, personality, values
2. **Conversation History** - Recent messages, relationship context, user facts
3. **Current Mood State** - Energy, warmth, social battery from `moodKnobs`

This ensures thoughts feel authentic to Kayley's character and adapt to the user's relationship with her.

## Tables Interaction

This service does not directly read or write to tables. It receives context from other services and returns generated thoughts. The `ongoingThreads` service uses these results to create/update threads in Supabase.

**Indirect Dependencies:**
- Reads from: `mood_states`, `emotional_momentum`, `ongoing_threads`, `user_facts`, `life_events` (via other services)
- Writes to: None (pure function)

## Workflow Interaction

```text
[ongoingThreads.ensureMinimumThreadsAsync()]
         |
         V
[buildThoughtContextBase()] -> Parallel fetch of:
         |                      - Mood (getMoodAsync)
         |                      - Relationship (getRelationship)
         |                      - Life Events (getRecentLifeEvents)
         |                      - User Facts (getUserFacts)
         |                      - Conversation History (loadConversationHistory)
         |
         V
[generateAutonomousThoughtCached()]
         |
         +--[Check Cache (30 min TTL)]--+
         |                               |
      (Cache Hit)                   (Cache Miss)
         |                               |
         V                               V
   [Return Cached]              [generateAutonomousThought()]
                                         |
                                         V
                                [Build Prompt with Context]
                                         |
                                         V
                                [Call Gemini Flash (JSON mode)]
                                         |
                                         V
                                [Parse & Validate Result]
                                         |
                                         V
                                [Return ThoughtGenerationResult]
                                         |
                                         V
                                [ongoingThreads Quality Gate]
                                         |
                            +------------+------------+
                            |                         |
                   (confidence >= 0.5)        (confidence < 0.5)
                   shouldMention = true        shouldMention = false
                            |                         |
                            V                         V
                  [Create Thread]              [Skip Thread]
```

## Does it use an LLM?

**Yes.** Uses **Gemini Flash** for thought generation with:
- **Temperature**: 0.6 (consistent character voice)
- **Max Tokens**: 300 (thoughts are 1-2 sentences)
- **Response Format**: JSON (`application/json`)
- **Typical Latency**: 300-500ms (async, doesn't block user)

## Why use an LLM here?

Hardcoded templates are:
- **Predictable**: Only 30 possible thoughts → users notice repetition
- **Static**: Can't adapt to recent conversations or life events
- **Impersonal**: Same thoughts for all users regardless of relationship
- **Brittle**: Adding new themes requires code changes

LLM generation provides:
- **Infinite variety**: Never repeats the same thought twice
- **Context-aware**: References recent conversations and life events
- **Adaptive**: Adjusts to relationship tier (guarded with strangers, open with close friends)
- **Emergent**: New situations create novel thoughts without code changes

## API Reference

### Main Functions

#### `generateAutonomousThought(context: ThoughtGenerationContext): Promise<ThoughtGenerationResult>`

Generates a single autonomous thought using LLM.

**Parameters:**
- `context.theme` - Thread theme (e.g., `'creative_project'`, `'family'`, `'existential'`)
- `context.characterProfile` - Full character profile (usually `KAYLEY_FULL_PROFILE`)
- `context.recentConversations` - Last 5 messages between user and Kayley
- `context.currentMood` - Energy, warmth, genuine moment state
- `context.relationshipTier` - Current relationship depth (e.g., `'friends'`)
- `context.recentLifeEvents` - Last 5 life events from `life_events` table
- `context.userFacts` - Up to 10 stored facts about the user

**Returns:**
```typescript
{
  theme: ThreadTheme,          // Echo of input theme
  content: string,             // Generated thought text
  intensity: number,           // 0.0-1.0 (how much on her mind)
  shouldMention: boolean,      // LLM decision: appropriate to surface?
  confidence: number           // 0.0-1.0 (how well it fits character)
}
```

**Error Handling:**
- Returns empty result on failure (`content: "", intensity: 0, shouldMention: false, confidence: 0`)
- Logs errors but never throws
- Missing Gemini config → returns empty result immediately

---

#### `generateAutonomousThoughtCached(context: ThoughtGenerationContext): Promise<ThoughtGenerationResult>`

Cached version of `generateAutonomousThought()` with 30-minute TTL.

**Cache Key Includes:**
- Theme
- Relationship tier
- Mood (energy + warmth, rounded to 1 decimal)
- Last 3 message contents (first 30 chars each)
- Recent life events (first 2, first 30 chars each)

**Cache Characteristics:**
- **TTL**: 30 minutes (thoughts don't need real-time updates)
- **Storage**: In-memory Map (fast, appropriate for single-user)
- **Hit Rate**: ~70-80% (threads decay slowly, contexts are stable)

---

### Helper Functions

#### `buildThoughtPrompt(context: ThoughtGenerationContext): string`

Constructs the LLM prompt with all three behavior sources.

**Prompt Structure:**
1. Character profile (WHO she is)
2. Current context (theme, tier, mood)
3. Recent conversation (WHAT's been said)
4. Recent life events (what's happening in her life)
5. User facts (what she knows about the user)
6. Task instructions (generate 1-2 sentence thought)
7. Style guidelines (casual, Gen Z, uncertainty if appropriate)
8. Output format (JSON with 4 fields)

---

#### `buildThoughtCacheKey(context: ThoughtGenerationContext): string`

Creates a hash-based cache key from context factors.

**Design Goals:**
- Include factors that affect thought content
- Round mood values to prevent over-invalidation
- Use short message snippets (not full text)
- Hash to prevent key length explosion

---

#### `clearThoughtCache(): void`

Clears all cached thoughts. Used for:
- Testing (reset state between tests)
- User switch (prevent cross-user cache pollution)
- Manual cache invalidation

## Integration with Other Services

### Used By

- **`ongoingThreads.ts`** - Primary consumer
  - Calls `generateAutonomousThoughtCached()` in `ensureMinimumThreadsAsync()`
  - Uses result to create threads if confidence >= 0.5

### Dependencies

- **`moodKnobs.ts`** - Provides mood state (`KayleyMood`)
- **`relationshipService.ts`** - Provides relationship tier
- **`lifeEventService.ts`** - Provides recent life events
- **`memoryService.ts`** - Provides user facts
- **`conversationHistoryService.ts`** - Provides message history
- **`kayleyCharacterProfile.ts`** - Provides character profile

## Performance Characteristics

### Costs

| Metric | Value |
|--------|-------|
| **Model** | Gemini Flash |
| **Cost per call** | ~$0.001 |
| **Calls per day** | 10-20 (thread decay triggers generation) |
| **Daily cost per user** | ~$0.01-0.02 |

### Latency

| Operation | Latency |
|-----------|---------|
| **Cache hit** | <1ms |
| **Cache miss (LLM call)** | 300-500ms |
| **Context assembly** | 50-100ms (parallel fetch) |
| **Overall** | Non-blocking (async background) |

### Cache Efficiency

- **Hit rate**: 70-80% (30-min TTL, slow context changes)
- **Storage**: In-memory (fast, no Supabase overhead)
- **Invalidation**: Time-based only (no manual invalidation needed)

## Quality Gates

Thoughts must pass multiple quality checks before being used:

1. **LLM returns result** (not error)
2. **`content` is non-empty** (not blank or whitespace)
3. **`shouldMention` is true** (LLM deemed it appropriate)
4. **`confidence >= 0.5`** (meets minimum quality threshold)

If any check fails → no thread is created, system tries again later.

## Common Patterns

### Pattern 1: Generating Thoughts on Thread Decay

```typescript
// ongoingThreads.ts
const threads = await getOngoingThreadsAsync(); // Returns 1 thread (below min 2)

// Triggers generation
await ensureMinimumThreadsAsync(threads);
  |
  V
const baseContext = await buildThoughtContextBase();
  |
  V
const theme = pickAutonomousTheme(existingThemes); // e.g., 'creative_project'
  |
  V
const thought = await generateAutonomousThoughtCached({ theme, ...baseContext });
  |
  V
if (thought.shouldMention && thought.confidence >= 0.5) {
  createThread(thought); // New thread added
}
```

### Pattern 2: Thought Influenced by Recent Conversation

```typescript
// User just talked about starting a new hobby
recentConversations: [
  { role: 'user', content: "I'm thinking about learning guitar" },
  { role: 'assistant', content: "That's cool! What made you want to start?" }
]

// LLM generates:
{
  content: "been thinking about picking up my old sketchbook again... something about starting new creative things feels exciting right now",
  intensity: 0.6,
  shouldMention: true,
  confidence: 0.8
}
// ✓ Thought connects to recent conversation about starting hobbies
```

### Pattern 3: Thought Adapts to Relationship Tier

```typescript
// Stranger relationship
relationshipTier: 'stranger'
// Generated thought:
"working on a project... trying to figure something out"
// ✓ Vague, guarded

// Close friends relationship
relationshipTier: 'close_friends'
// Generated thought:
"this video edit is kicking my ass but I'm kinda obsessed with getting the timing perfect"
// ✓ Specific, vulnerable
```

## Testing

See `src/services/tests/autonomousThoughtService.test.ts` for:
- Thought generation with valid context
- Caching behavior (hit/miss)
- Error handling (graceful degradation)
- Prompt building with different contexts
- Quality gate enforcement

## Troubleshooting

### Problem: Thoughts are too generic

**Symptom**: "thinking about some stuff", "on my mind lately"

**Causes**:
1. Life events table is empty
2. Conversation history is empty
3. Temperature too low (increase from 0.6 to 0.8)

**Fix**:
```typescript
// Seed life_events table
await recordLifeEvent("Started working on a new video project", "personal", 0.6);

// Or increase temperature in autonomousThoughtService.ts
temperature: 0.8, // Was 0.6
```

---

### Problem: Thoughts mention being AI

**Symptom**: "As an AI, I've been thinking about..."

**Cause**: LLM hallucination (rare with current prompt)

**Fix**: Already handled in prompt:
```
RULES:
- Do NOT mention being an AI or a model.
```

If it persists, add to validation:
```typescript
if (content.toLowerCase().includes('ai') || content.toLowerCase().includes('model')) {
  return { ...result, shouldMention: false }; // Reject
}
```

---

### Problem: Cache hit rate is too low

**Symptom**: Constant LLM calls, high costs

**Causes**:
1. Context changes too frequently (life events, messages)
2. Cache key includes too much detail

**Fix**: Simplify cache key
```typescript
// Current: Hashes full life event descriptions
const lifeEventKey = context.recentLifeEvents.slice(0, 2)...

// Optimization: Hash count + categories only
const lifeEventKey = `${context.recentLifeEvents.length}_${context.recentLifeEvents.map(e => e.category).join(',')}`;
```

---

### Problem: Thoughts are too long

**Symptom**: 3-4 sentence thoughts instead of 1-2

**Cause**: maxOutputTokens too high (300)

**Fix**:
```typescript
maxOutputTokens: 150, // Was 300
```

---

### Problem: No thoughts being generated

**Symptom**: Threads never created, logs show "Skipping low-confidence thought"

**Causes**:
1. `confidence < 0.5` threshold too strict
2. `shouldMention` always false (LLM being overly cautious)
3. Relationship tier too low (LLM guards thoughts)

**Debugging**:
```typescript
// Add detailed logging in ongoingThreads.ts
console.log(`[OngoingThreads] Thought evaluation:`, {
  content: thought.content?.slice(0, 50),
  confidence: thought.confidence,
  shouldMention: thought.shouldMention,
  tier: baseContext.relationshipTier
});
```

**Fix**: Lower confidence threshold
```typescript
if (!thought.shouldMention || thought.confidence < 0.4 || !thought.content) {
  // Was 0.5, now 0.4
```

## Summary

The Autonomous Thought Service replaces hardcoded templates with dynamic LLM generation, making Kayley's inner life:
- **More varied**: Infinite thought combinations, never repeats
- **More contextual**: Adapts to recent conversations and life events
- **More personal**: Different thoughts for different users
- **More maintainable**: No code changes for new themes or life situations

Key design principles:
1. **Three sources**: Profile + History + Mood
2. **Quality gates**: Only surface high-confidence thoughts
3. **Aggressive caching**: Minimize costs with 30-min TTL
4. **Graceful degradation**: Never crash, always return safe defaults
