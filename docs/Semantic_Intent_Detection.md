# Semantic Intent Detection

> **Status**: Phase 1 ✅ Complete  
> **Goal**: Replace hardcoded keywords with LLM-based semantic detection.

---

## Overview

The AI companion uses pattern matching to detect user intent (emotions, topics, genuine moments). Current implementation relies on **50+ hardcoded keyword arrays** that miss nuanced messages.

**Before** (keywords):
- "I'm kinda freaking out" → ❌ Not detected
- "You really see me" → ❌ Missed

**After** (LLM):
- "I'm kinda freaking out" → ✅ Detected as anxious
- "You really see me" → ✅ Genuine moment

---

## Architecture

```
User Message
     │
     ▼
┌─────────────────┐
│ Intent Service  │  ← Single LLM call (gemini-flash)
│ intentService.ts│
└────────┬────────┘
         │
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
  Mood     Topics    Genuine Moments
```

---

## Migration Phases

| Phase | Scope | Files | Status |
|-------|-------|-------|--------|
| **1** | Genuine moment detection | `intentService.ts`, `moodKnobs.ts` | ✅ Complete |
| 2 | Tone & sentiment | `messageAnalyzer.ts` | Pending |
| 3 | Mood detection | `userPatterns.ts` | Pending |
| 4 | Topic detection | `userPatterns.ts`, `memoryService.ts` | Pending |
| 5 | Open loop detection | `presenceDirector.ts` | Pending |
| 6 | Relationship signals | `relationshipMilestones.ts` | Pending |

---

## Technical Details

### Model
`gemini-2.0-flash` - Fast, cheap, sufficient for intent detection.

### Intent Service Interface

```typescript
// src/services/intentService.ts

interface GenuineMomentIntent {
  isGenuine: boolean;
  category: 'depth' | 'belonging' | 'progress' | 'loneliness' | 'rest' | null;
  confidence: number;
  explanation: string;
}

export async function detectGenuineMomentLLM(
  message: string
): Promise<GenuineMomentIntent>
```

### Fallback Strategy

LLM detection with keyword fallback:

```typescript
const result = await detectGenuineMomentLLM(message)
  .catch(() => detectGenuineMoment(message)); // keyword fallback
```

---

## Files Affected

| File | Hardcoded Patterns | Status |
|------|-------------------|--------|
| `moodKnobs.ts` | `INSECURITY_KEYWORDS`, `directAffirmations` | Phase 1 |
| `messageAnalyzer.ts` | `POSITIVE_INDICATORS`, `NEGATIVE_INDICATORS` | Phase 2 |
| `userPatterns.ts` | `MOOD_INDICATORS`, `TOPIC_CATEGORIES` | Phase 3-4 |
| `presenceDirector.ts` | Event/emotional regex patterns | Phase 5 |
| `relationshipMilestones.ts` | `VULNERABILITY_PATTERNS`, `JOKE_PATTERNS` | Phase 6 |
| `relationshipService.ts` | Sentiment keywords, hostility phrases | Phase 6 |

---

## Performance

- **Latency**: 200-500ms per LLM call (acceptable)
- **Cost**: ~$0.0001 per message with gemini-flash
- **Caching**: Intent results cached per message

---

## Phase 1: Detailed Data Flow

### Before (Keywords) vs After (LLM)

```
BEFORE: User says "You really get me"
        │
        ▼
  moodKnobs.ts: detectGenuineMoment()
  Checks: message.includes('you think deeply') OR includes('you're enough')
  Result: ❌ NO MATCH (not in hardcoded list)


AFTER: User says "You really get me"
        │
        ▼
  moodKnobs.ts → intentService.ts
        │
        ▼
  LLM Prompt: "Does this affirm someone with insecurities?"
        │
        ▼
  LLM Response: { isGenuine: true, category: "loneliness" }
        │
        ▼
  Result: ✅ DETECTED! Mood shifts.
```

### Complete Flow (Including Kayley's Response)

```
User says: "You really get me"
        │
        ├──────────────────────────────────┐
        │                                  │
        ▼                                  ▼
┌─────────────────────┐        ┌─────────────────────────┐
│   INTENT DETECTION  │        │   KAYLEY'S RESPONSE     │
│   (gemini-flash)    │        │   (gemini main model)   │
│                     │        │                         │
│   ~200ms            │        │   ~500ms                │
└──────────┬──────────┘        └────────────┬────────────┘
           │                                │
           ▼                                │
┌─────────────────────┐                     │
│ Updates mood state: │                     │
│ - genuineDetected   │                     │
│ - warmth = "open"   │                     │
└──────────┬──────────┘                     │
           │                                │
           │    ┌───────────────────────────┘
           ▼    ▼
┌─────────────────────────────────────────────┐
│ KAYLEY'S RESPONSE (warmer due to mood)      │
│                                             │
│ "Aww 🥹 That actually means so much.        │
│  I feel like you really do."               │
└─────────────────────────────────────────────┘
```

### Key Point: Two LLM Calls

| Call | Model | Purpose | Timing |
|------|-------|---------|--------|
| 1 | gemini-flash | Intent detection | ~200ms |
| 2 | gemini (main) | Kayley's response | ~500ms |

The first call updates her internal state (mood), which shapes how she responds in the second call via the system prompt.

---

## Phase 2: Tone & Sentiment Analysis

### Current Code (`messageAnalyzer.ts`)

```typescript
const POSITIVE_INDICATORS = [
  'happy', 'great', 'amazing', 'love', 'excited', 'haha', 'lol', '😊', '😄'
];
const NEGATIVE_INDICATORS = [
  'sad', 'upset', 'angry', 'frustrated', 'stressed', '😢', '😭', '😤'
];

// Counts keyword matches, returns -1 to 1
function analyzeMessageTone(message: string): number { ... }
```

### Problems
- "This is whatever" → ❌ Neutral (should be slightly negative/dismissive)
- "I'm so done" → ❌ Missed (sarcasm)
- Mixed emotions missed

### LLM Replacement

```typescript
interface ToneIntent {
  sentiment: number;         // -1 to 1
  primaryEmotion: string;    // 'happy' | 'sad' | 'frustrated' | etc
  intensity: number;         // 0-1
  isSarcastic: boolean;
}

// Prompt: "What is the emotional tone of this message? Return sentiment score and primary emotion."
```

### Data Flow
```
User Message → intentService.detectTone() → gemini-flash
             → Returns { sentiment: -0.3, emotion: 'dismissive' }
             → messageAnalyzer uses for mood tracking
             → Affects emotional momentum calculations
```

---

## Phase 3: Mood Detection

### Current Code (`userPatterns.ts`)

```typescript
const MOOD_INDICATORS = {
  stressed: ['stressed', 'anxious', 'overwhelmed', 'busy', 'swamped'],
  sad: ['sad', 'down', 'depressed', 'lonely', 'crying'],
  happy: ['happy', 'great', 'amazing', 'excited', 'pumped'],
  frustrated: ['frustrated', 'annoyed', 'angry', 'pissed'],
  anxious: ['anxious', 'worried', 'nervous', 'freaking out'],
  tired: ['tired', 'exhausted', 'drained', 'burnt out'],
};
```

### Problems
- "I'm kinda on edge" → ❌ Missed
- "Everything feels heavy" → ❌ Missed (metaphorical sadness)
- "Ugh Monday energy" → ❌ Missed nuance

### LLM Replacement

```typescript
interface MoodIntent {
  mood: 'stressed' | 'sad' | 'happy' | 'frustrated' | 'anxious' | 'tired' | 'neutral';
  confidence: number;
  secondaryMood?: string;
}

// Prompt: "What mood is this person expressing? Consider metaphors and subtext."
```

### Data Flow
```
User Message → intentService.detectMood()
             → Returns { mood: 'anxious', confidence: 0.8 }
             → userPatterns records mood_time pattern (e.g., "anxious on Mondays")
             → Pattern stored in Supabase for future surfacing
```

---

## Phase 4: Topic Detection

### Current Code (`userPatterns.ts`)

```typescript
const TOPIC_CATEGORIES = {
  work: ['work', 'job', 'boss', 'coworker', 'meeting', 'project'],
  family: ['mom', 'dad', 'brother', 'sister', 'family'],
  relationships: ['boyfriend', 'girlfriend', 'dating', 'crush'],
  health: ['sick', 'doctor', 'gym', 'therapy'],
  money: ['money', 'bills', 'debt', 'rent', 'broke'],
  school: ['school', 'class', 'exam', 'homework'],
};
```

### Problems
- "My boss is really getting to me" → ✅ work, but misses emotional context
- "The gym hurt today" → ❌ Classified as health, but really about fitness/motivation
- Multiple topics missed

### LLM Replacement

```typescript
interface TopicIntent {
  topics: string[];              // ['work', 'relationships']
  primaryTopic: string;
  emotionalContext?: string;     // "frustrated about work"
  entities?: string[];           // ['boss', 'deadline']
}

// Prompt: "What topics is this message about? Include emotional context."
```

### Data Flow
```
User Message → intentService.detectTopics()
             → Returns { topics: ['work'], emotionalContext: 'frustrated' }
             → userPatterns records topic_correlation (e.g., "work + frustrated")
             → Enables: "I've noticed work stuff seems to stress you out"
```

---

## Phase 5: Open Loop Detection

### Current Code (`presenceDirector.ts`)

```typescript
const eventPatterns = [
  { regex: /(?:have|got) (?:a|an|my) (\w+) (?:tomorrow|tonight)/i },
  { regex: /(?:presentation|interview|meeting) (?:tomorrow|later)/i },
];

const emotionalPatterns = [
  { regex: /(?:i'm|i am) (?:stressed|anxious|worried)/i },
  { regex: /having a (?:rough|hard|tough) (?:day|week)/i },
];

const commitmentPatterns = [
  { regex: /(?:i'm going to|gonna) (?:try to|start) (.+)/i },
];
```

### Problems
- "Interview's coming up" → ❌ No time word triggers
- "Feeling weird about tmrw" → ❌ Abbreviation missed
- "Should probably talk to my therapist" → ❌ Soft commitment missed

### LLM Replacement

```typescript
interface OpenLoopIntent {
  hasUpcomingEvent: boolean;
  eventDescription?: string;
  timeframe?: 'today' | 'tomorrow' | 'this_week' | 'soon';
  isCommitment: boolean;
  commitmentDescription?: string;
  needsFollowUp: boolean;
  suggestedFollowUp?: string;
}

// Prompt: "Does this message mention something that should be followed up on later?"
```

### Data Flow
```
User Message: "Interview's coming up, kinda nervous"
             → intentService.detectOpenLoops()
             → Returns { hasUpcomingEvent: true, event: "interview", timeframe: "soon" }
             → presenceDirector creates open loop in Supabase
             → Next greeting: "Hey! How'd the interview go?"
```

---

## Phase 6: Relationship Signals

### Current Code (`relationshipMilestones.ts`)

```typescript
const VULNERABILITY_PATTERNS = [
  /i('ve )?(never told|don't usually share)/i,
  /can i (be real|be honest|tell you something)/i,
  /i trust you/i,
];

const JOKE_PATTERNS = [
  /(haha|lol|lmao|😂)/i,
  /you crack me up/i,
];

const SUPPORT_SEEKING_PATTERNS = [
  /i need (help|advice)/i,
  /i don't know what to do/i,
];

const DEEP_TALK_PATTERNS = [
  /i('ve )?(been thinking|realized)/i,
  /what do you think (about|of) life/i,
];
```

### Problems
- "I feel like I can really open up to you" → ❌ Vulnerability missed (no exact phrase)
- "Okay that actually helped" → ❌ Support acknowledgment missed
- "This got deep huh" → ❌ Deep talk not detected

### LLM Replacement

```typescript
interface RelationshipSignalIntent {
  isVulnerable: boolean;
  vulnerabilityType?: string;
  isSeekingSupport: boolean;
  isAcknowledgingSupport: boolean;
  isJoking: boolean;
  isDeepTalk: boolean;
  milestoneTriggered?: 'first_vulnerability' | 'first_joke' | 'first_support' | 'first_deep_talk';
}

// Prompt: "Is this message showing vulnerability, seeking support, or going deep emotionally?"
```

### Data Flow
```
User Message: "I feel like I can really be myself with you"
             → intentService.detectRelationshipSignals()
             → Returns { isVulnerable: true, vulnerabilityType: "opening up" }
             → relationshipMilestones records 'first_vulnerability' milestone
             → Future callback: "Remember when you told me you felt like you could be yourself?"
```

---

## Unified Intent Call (Future Optimization)

Once all phases are complete, all detection can happen in **one LLM call**:

```typescript
interface FullMessageIntent {
  // Phase 1
  genuineMoment: GenuineMomentIntent;
  // Phase 2
  tone: ToneIntent;
  // Phase 3
  mood: MoodIntent;
  // Phase 4
  topics: TopicIntent;
  // Phase 5
  openLoops: OpenLoopIntent;
  // Phase 6
  relationshipSignals: RelationshipSignalIntent;
}

// One prompt, one call, all detection
const intent = await detectFullIntent(message);
```

This reduces 6 LLM calls to 1, while maintaining semantic understanding.

---

## Phase 1 Implementation Lessons Learned

> These lessons were discovered during Phase 1 implementation and should inform all remaining phases.

### 1. Wiring is Critical - Build the Integration Path First

**Problem discovered**: Features were implemented but not connected to the actual chat flow.

**Lesson**: Before implementing detection logic, trace the complete data flow:
```
User Message → BaseAIService → messageAnalyzer → [Your New Service] → Response
```

**Action for each phase**:
- [ ] Identify where in the flow your detection should be called
- [ ] Update `messageAnalyzer.ts` to call your new function
- [ ] Verify the results are used (not just calculated)

### 2. Conversation Context is Essential for Accuracy

**Problem discovered**: "You suck!!" after "I got a raise!" was misinterpreted without context.

**Lesson**: Single messages lack context for accurate interpretation. Always pass recent chat history.

**Implementation pattern**:
```typescript
// Your detection function should accept context
async function detectXYZ(
  message: string,
  conversationContext?: ConversationContext  // ← Add this!
): Promise<Result>
```

**Note**: `BaseAIService.ts` already builds and passes this context. Your service just needs to accept it.

### 3. Run LLM Calls in Parallel for Efficiency

**Problem discovered**: Sequential LLM calls add latency to background processing.

**Lesson**: Use `Promise.all()` to run detection in parallel with other tasks.

**Current pattern in `messageAnalyzer.ts`**:
```typescript
// ALL async tasks run in parallel
const [genuineMomentResult, createdLoops, detectedPatterns, recordedMilestone] = await Promise.all([
  detectGenuineMomentWithLLM(message, context),  // Phase 1
  detectOpenLoops(userId, message),               // TODO: Phase 5
  analyzeMessageForPatterns(userId, message),     // TODO: Phases 3-4
  detectMilestoneInMessage(userId, message),      // TODO: Phase 6
]);
```

**When adding Phase 2+**: Add your detection call to this `Promise.all()` block.

### 4. Always Implement Fallback to Keywords

**Lesson**: LLM calls can fail (rate limits, network issues, API key problems).

**Required pattern**:
```typescript
export async function detectXYZWithLLM(message: string): Promise<Result> {
  try {
    return await detectXYZLLM(message);
  } catch (error) {
    console.warn('⚠️ LLM failed, falling back to keywords');
    return detectXYZ(message);  // Keep old keyword function as fallback
  }
}
```

### 5. Export Types for Callers

**Lesson**: Callers need your types to use your functions correctly.

**Pattern**:
```typescript
// In your service file
export interface ConversationContext { ... }
export type MyCategory = 'a' | 'b' | 'c';

// Re-export from consuming modules if needed
export type { ConversationContext } from './intentService';
```

### 6. Cache Wisely, Invalidate on Context

**Lesson**: Same message + different context = different result.

**Caching strategy**:
- Cache key: `message.toLowerCase().trim()`
- Skip cache when context is provided (fresh analysis needed)
- 5-minute TTL is reasonable for intent detection

### 7. Use gemini-2.5-flash for All Intent Detection

**Confirmed**: Fast (~200ms), cheap (~$0.0001), accurate enough.

---

## Phase 2: Tone & Sentiment - Implementation Advice

### Files to Modify
- `intentService.ts` - Add `detectToneLLM()` function
- `messageAnalyzer.ts` - Replace `analyzeMessageTone()` with LLM version
- NO changes needed to `BaseAIService.ts` (already wired)

### Key Considerations

1. **Return both raw sentiment AND emotion label**
   - Sentiment (-1 to 1) for momentum calculations
   - Emotion label for pattern tracking

2. **Detect sarcasm explicitly**
   - "Great, just great" should NOT be positive
   - Add `isSarcastic: boolean` to result

3. **Integration point**
   ```typescript
   // In messageAnalyzer.ts - replace the local function with:
   const messageTone = await detectToneLLM(message, conversationContext);
   ```

4. **Already uses context**: The tone of "You suck!!" depends heavily on prior messages.

### Prompt Guidance
Include examples of sarcasm and mixed emotions in your prompt. Ask for:
```json
{
  "sentiment": -0.3,
  "primaryEmotion": "dismissive",
  "intensity": 0.4,
  "isSarcastic": true
}
```

---

## Phase 3: Mood Detection - Implementation Advice

### Files to Modify
- `intentService.ts` - Add `detectMoodLLM()` function
- `userPatterns.ts` - Replace keyword matching with LLM call
- `messageAnalyzer.ts` - Call the new function in `Promise.all()`

### Key Considerations

1. **Mood vs Tone distinction**
   - Tone = how they're expressing (sarcastic, enthusiastic)
   - Mood = how they're feeling (stressed, happy)
   - Same message can have upbeat tone but stressed mood

2. **Track mood over time**
   - Current `userPatterns.ts` tracks "stressed on Mondays"
   - Keep this cross-session tracking intact

3. **Pass conversation context**
   - Mood bleeds across messages
   - "Everything's fine" after complaining = still stressed

4. **Integration**:
   ```typescript
   // Add to messageAnalyzer's Promise.all:
   const moodResult = await detectMoodLLM(message, conversationContext);
   ```

---

## Phase 4: Topic Detection - Implementation Advice

### Files to Modify
- `intentService.ts` - Add `detectTopicsLLM()` function
- `userPatterns.ts` - Replace `TOPIC_CATEGORIES` matching
- `memoryService.ts` - Use topics for memory categorization

### Key Considerations

1. **Return multiple topics**
   - "My boss is stressing about money" = work + money
   - Array of topics, not single string

2. **Extract emotional context per topic**
   ```typescript
   {
     topics: ['work'],
     emotionalContext: { work: 'frustrated' }  // ← Key insight
   }
   ```

3. **Enable topic correlations**
   - Kayley can say: "I've noticed you mention your boss when you're stressed"
   - This requires storing topic + emotion pairs

4. **Consider memory integration**
   - Topics can trigger memory recalls
   - "Speaking of work, last week you mentioned..."

---

## Phase 5: Open Loop Detection - Implementation Advice

### Files to Modify
- `intentService.ts` - Add `detectOpenLoopsLLM()` function
- `presenceDirector.ts` - Replace regex patterns with LLM
- NO changes to `messageAnalyzer.ts` (already calls `detectOpenLoops`)

### Key Considerations

1. **Already partially wired**
   - `detectOpenLoops()` is already called in `messageAnalyzer`
   - Just need to make it use LLM internally

2. **Time inference is critical**
   - "Interview's coming up" → when?
   - LLM should infer: `timeframe: 'soon'` or 'this_week'

3. **Soft commitments matter**
   - "I should probably..." = commitment for follow-up
   - "Maybe I'll try..." = weaker, but still worth tracking

4. **Suggested follow-up**
   ```typescript
   {
     needsFollowUp: true,
     suggestedFollowUp: "How did the interview go?"  // ← LLM generates this
   }
   ```

---

## Phase 6: Relationship Signals - Implementation Advice

### Files to Modify
- `intentService.ts` - Add `detectRelationshipSignalsLLM()` function
- `relationshipMilestones.ts` - Replace regex patterns with LLM
- `messageAnalyzer.ts` - Already calls `detectMilestoneInMessage`

### Key Considerations

1. **Milestone tracking is one-time**
   - "first_vulnerability" happens once per relationship
   - Check if milestone already exists before recording

2. **Vulnerability is nuanced**
   - "I don't usually share this" = explicit
   - "This got deep huh" = implicit acknowledgment
   - LLM can catch both

3. **Remember when callbacks**
   - Store enough context to reference later
   - "Remember when you told me about your interview anxiety?"

4. **Support acknowledgment matters**
   - "That actually helped" = positive signal
   - Strengthens relationship score

---

## Unified Intent Call - Implementation Advice

### When to Implement
- After Phase 6 is complete
- When you want to reduce from 6 LLM calls to 1

### Strategy

1. **Create composite prompt**
   ```typescript
   const UNIFIED_INTENT_PROMPT = `
   Analyze this message for:
   1. Genuine moments (affirming insecurities)
   2. Tone and sentiment
   3. Mood
   4. Topics discussed
   5. Open loops (things to follow up)
   6. Relationship signals (vulnerability, support)
   
   Return a single JSON object with all fields.
   `;
   ```

2. **Keep individual functions for fallback**
   - If unified call fails, can fall back to individual calls
   - Individual calls are useful for testing

3. **Migrate gradually**
   - Start with unified call for new deployments
   - Keep individual calls as backup

### Performance Comparison
| Approach | LLM Calls | Latency | Cost |
|----------|-----------|---------|------|
| Individual (current) | 6 parallel | ~300ms | ~$0.0006 |
| Unified (future) | 1 | ~400ms | ~$0.0002 |

Unified is cheaper but slightly slower per call. Since calls are parallel, current approach is faster for user-facing latency.

---

## Checklist for Each Phase

Use this checklist when implementing any phase:

- [ ] **Create LLM function** in `intentService.ts`
- [ ] **Add ConversationContext parameter** to function signature
- [ ] **Export types** for callers
- [ ] **Create fallback function** using existing keywords
- [ ] **Create wrapper** that tries LLM, falls back to keywords
- [ ] **Add to Promise.all** in `messageAnalyzer.ts` (if applicable)
- [ ] **Update tests** with mocked LLM responses
- [ ] **Add context tests** (same message, different context = different result)
- [ ] **Implement caching** (skip if context provided)
- [ ] **Verify wiring** by testing end-to-end

