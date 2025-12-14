# Semantic Intent Detection

> **Status**: Phase 1 ✅ Complete | Phase 2 ✅ Complete | Phase 3 ✅ Complete  
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
| **2** | Tone & sentiment | `intentService.ts`, `messageAnalyzer.ts` | ✅ Complete |
| **3** | Mood detection | `moodKnobs.ts`, `userPatterns.ts`, `messageAnalyzer.ts` | ✅ Complete |
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

### Phase 2 Implementation Lessons Learned (Added 2025-12-13)

> These lessons were discovered during Phase 2 implementation and should inform Phase 3+.

#### 1. Mock Supabase in Integration Tests

**Problem discovered**: Integration tests importing `messageAnalyzer.ts` failed because the import chain reaches `presenceDirector.ts` → `supabaseClient.ts`, which throws without environment variables.

**Solution**: Add supabase mock at the TOP of your test file:
```typescript
// Mock supabaseClient before importing modules that depend on it
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ data: [], error: null })),
      insert: vi.fn(() => ({ data: [], error: null })),
      update: vi.fn(() => ({ data: [], error: null })),
      delete: vi.fn(() => ({ data: [], error: null })),
    })),
  },
}));
```

**Action for each phase**: If your tests import modules with Supabase dependencies, add this mock.

#### 2. Clean Up Unused Imports After Implementation

**Problem discovered**: After replacing keyword functions with LLM versions, old imports like `detectGenuineMoment` and `recordInteractionAsync` were left behind unused.

**Solution**: After implementing a phase, run through imports and remove:
- Old keyword functions that are now only called internally as fallback
- Types that were imported but never used
- Async variants if you're only using the sync version (or vice versa)

**Cleanup checklist**:
- [ ] Search for imported function names in the file
- [ ] Remove if not used (or only used as fallback inside the wrapper)
- [ ] Run `npm test` after cleanup to ensure nothing broke

#### 3. Verify BaseAIService Wiring is Complete

**Good news discovered**: `BaseAIService.ts` already passes `conversationContext` to `analyzeUserMessageBackground()`. No changes needed for Phase 2+.

**What's already wired**:
```typescript
// In BaseAIService.generateResponse():
const conversationContext = {
  recentMessages: (options.chatHistory || []).slice(-5).map(...)
};

analyzeUserMessageBackground(
  updatedSession.userId, 
  userMessageText, 
  interactionCount,
  conversationContext  // ← Already passed!
);
```

**Action for each phase**: Just add your LLM function to the `Promise.all()` in `messageAnalyzer.ts` - no BaseAIService changes needed.

#### 4. The Fallback Pattern is Essential

**Pattern that works well**:
```typescript
// In messageAnalyzer.ts - wrapper function
export async function detectXWithLLM(
  message: string,
  context?: ConversationContext
): Promise<XIntent> {
  try {
    return await detectXLLMCached(message, context);
  } catch (error) {
    console.warn('⚠️ LLM failed, falling back to keywords:', error);
    const keywordResult = analyzeXKeywords(message);
    return convertKeywordToIntent(keywordResult);
  }
}
```

This ensures the app never breaks even if the LLM API fails.

#### 5. Re-export Types for Consumers

**Problem discovered**: Other modules need your types (e.g., `ToneIntent`) but TypeScript strips type-only exports.

**Solution**: Explicitly re-export types in `messageAnalyzer.ts`:
```typescript
// Re-export types for consumers
export type { ToneIntent, PrimaryEmotion, ConversationContext };
```

#### 6. Run Full Test Suite Before Marking Complete

**Action**: Always run `npm run test -- --run` to ensure:
- All 270+ existing tests still pass
- New tests cover the key scenarios
- No regressions in other modules

#### 7. Utilize Rich Detection Results in Future Phases

**Observation**: Phase 2 returns a `ToneIntent` object with rich information:
```typescript
interface ToneIntent {
  sentiment: number;         // ← Currently used
  primaryEmotion: string;    // ← NOT yet used (e.g., 'frustrated', 'playful')
  intensity: number;         // ← NOT yet used (0-1, how strong)
  isSarcastic: boolean;      // ← NOT yet used (true if sarcasm detected)
  secondaryEmotion?: string; // ← NOT yet used (for mixed emotions)
  explanation: string;       // ← Only used for logging
}
```

**Current state**: Only `sentiment` is passed to `recordInteraction()` for emotional momentum.

**Future opportunities** (implement in Phase 3-6):

| Field | Where to Use | Benefit |
|-------|--------------|---------|
| `primaryEmotion` | Phase 3 Mood Detection | Can inform or replace mood detection entirely |
| `isSarcastic` | User Pattern tracking | "User often uses sarcasm when discussing work" |
| `intensity` | Emotional momentum | High intensity = faster mood shift |
| `secondaryEmotion` | Relationship milestones | Detect nuanced vulnerability (anxious + hopeful) |

**Recommended implementation for Phase 3**:
```typescript
// In moodKnobs.ts recordInteraction:
export function recordInteraction(
  toneResult: ToneIntent,  // ← Pass full object, not just sentiment
  userMessage: string
): void {
  updateEmotionalMomentum(toneResult.sentiment, userMessage);
  
  // NEW: Use intensity for faster/slower mood shifts
  if (toneResult.intensity > 0.7) {
    // High intensity emotions shift mood faster
  }
  
  // NEW: Track emotion types for pattern detection
  trackEmotionPattern(toneResult.primaryEmotion);
}
```

**Action for Phase 3+**: Refactor to pass full `ToneIntent` object instead of just `messageTone` number.

---

## Phase 3: Mood Detection - ✅ COMPLETE (2025-12-13)

### Implementation Approach: Option A (Leverage ToneIntent)

After reviewing the codebase, we chose **Option A** - leveraging existing `ToneIntent` data from Phase 2 rather than creating a separate `detectMoodLLM()` function.

**Why Option A:**
1. `ToneIntent.primaryEmotion` already maps to moods (happy, sad, frustrated, anxious, etc.)
2. Avoids duplicate LLM calls for nearly identical analysis
3. `ToneIntent.intensity` enables richer mood shift behaviors
4. Cleaner architecture - one LLM call serves multiple purposes

### Files Modified
- `moodKnobs.ts` - `recordInteraction()` now accepts `ToneIntent` or number
- `messageAnalyzer.ts` - Passes full `toneResult` to `recordInteraction()`
- `userPatterns.ts` - `analyzeMessageForPatterns()` accepts optional `ToneIntent`

### New Features

1. **Emotion-to-Mood Mapping**
   ```typescript
   // moodKnobs.ts
   export function mapEmotionToMood(emotion: PrimaryEmotion): string | null {
     const emotionToMoodMap: Record<PrimaryEmotion, string | null> = {
       'happy': 'happy',
       'sad': 'sad',
       'frustrated': 'frustrated',
       'anxious': 'anxious',
       'excited': 'happy',  // Maps for pattern purposes
       'angry': 'frustrated',  // Maps for pattern purposes
       'playful': null,  // Tone, not mood
       'dismissive': null,  // Tone, not mood
       'neutral': null,
       'mixed': null,
     };
     return emotionToMoodMap[emotion] ?? null;
   }
   ```

2. **Intensity-Modulated Mood Shifts**
   ```typescript
   // High intensity emotions shift mood faster (0.5x to 1.5x multiplier)
   const intensityMultiplier = 0.5 + intensity;
   const microShift = tone * 0.05 * intensityMultiplier;
   ```

3. **LLM-Based Pattern Detection**
   ```typescript
   // userPatterns.ts - now uses LLM emotion before falling back to keywords
   if (toneResult?.primaryEmotion) {
     mood = mapEmotionToMoodPattern(toneResult.primaryEmotion);
   }
   if (!mood) {
     mood = detectMood(message);  // Keyword fallback
   }
   ```

### Data Flow
```
User Message
      │
      ▼
┌─────────────────────┐
│ detectToneWithLLM() │  ← Phase 2 LLM call
│ (messageAnalyzer)   │
└──────────┬──────────┘
           │
     ToneIntent { sentiment, primaryEmotion, intensity, ... }
           │
     ┌─────┴─────┬──────────────────────┐
     ▼           ▼                      ▼
recordInteraction()  analyzeMessageForPatterns()  Other uses
(intensity-aware    (LLM emotion → mood pattern)
 mood shifts)
```

### Phase 3 Implementation Lessons Learned

#### 1. Reuse Existing LLM Data When Possible

**Insight**: Phase 2's `ToneIntent` already contained the data we needed. Creating a separate `detectMoodLLM()` would have been redundant.

**Pattern for future phases**: Before adding a new LLM detection function, check if an existing one already captures the needed data.

#### 2. Design for Backward Compatibility

**Implementation**: `recordInteraction()` accepts both number and ToneIntent:
```typescript
export function recordInteraction(
  toneOrToneIntent: number | ToneIntent = 0, 
  userMessage: string = ''
): void {
  if (typeof toneOrToneIntent === 'number') {
    // Old API - use default intensity 0.5
  } else {
    // New API - use full ToneIntent data
  }
}
```

**Benefit**: Existing code using `recordInteraction(0.5)` continues to work.

#### 3. Sequencing Matters for Data Dependencies

**Problem**: Pattern analysis needs `toneResult`, but both ran in parallel.

**Solution**: Run tone detection first, then use result:
```typescript
// Phase 1-2: Can run in parallel
const [genuineMomentResult, toneResult, createdLoops, ...] = await Promise.all([...]);

// Phase 3: Depends on toneResult, runs after
const detectedPatterns = await analyzeMessageForPatterns(userId, message, new Date(), toneResult);
```

#### 4. Map Types Thoughtfully, Not 1:1

**Insight**: Not all emotions are moods. `playful` and `dismissive` are tones (how you say it), not moods (how you feel).

**Implementation**: Explicitly return `null` for non-mood emotions:
```typescript
'playful': null,  // Playful is a tone, not a mood pattern
'dismissive': null,  // Dismissive is a tone, not a mood pattern
```

#### 5. Export Types at Every Level

**Pattern**: Re-export types from each module in the chain:
```typescript
// moodKnobs.ts
export type { ConversationContext, ToneIntent, PrimaryEmotion } from './intentService';

// messageAnalyzer.ts  
export type { ToneIntent, PrimaryEmotion, ConversationContext };
```

**Benefit**: Consumers can import from the module they're already using.

#### 6. Test Intensity Effects Comparatively

**Strategy**: To test that intensity affects mood, compare two identical scenarios:
```typescript
// High intensity → higher mood shift
for (let i = 0; i < 5; i++) {
  recordInteraction({ sentiment: 0.8, intensity: 0.95, ... });
}
const highIntensityLevel = getEmotionalMomentum().currentMoodLevel;

resetEmotionalMomentum();

// Low intensity → lower mood shift  
for (let i = 0; i < 5; i++) {
  recordInteraction({ sentiment: 0.8, intensity: 0.2, ... });
}
const lowIntensityLevel = getEmotionalMomentum().currentMoodLevel;

expect(highIntensityLevel).toBeGreaterThan(lowIntensityLevel);
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

### From Phase 2 Lessons - Remember To:
- Add Supabase mock to test file (memoryService.ts uses Supabase)
- Create `detectTopicsWithLLM()` wrapper in messageAnalyzer with keyword fallback
- Export `TopicIntent` type from intentService and re-export from messageAnalyzer
- Consider combining with Phase 3 Mood for efficient `{topic, emotion}` correlation
- Clean up old `TOPIC_CATEGORIES` imports after replacing with LLM
- Run full test suite before marking complete

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

### From Phase 2 Lessons - Remember To:
- Add Supabase mock to test file (presenceDirector.ts uses Supabase)
- The function is already called from messageAnalyzer - just replace internal implementation
- Create fallback to existing regex patterns if LLM fails
- Export `OpenLoopIntent` type from intentService
- Clean up old regex pattern imports after replacing with LLM
- Run full test suite before marking complete

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

### From Phase 2 Lessons - Remember To:
- Add Supabase mock to test file (relationshipMilestones.ts uses Supabase)
- The function is already called from messageAnalyzer - just replace internal implementation
- Create fallback to existing regex patterns if LLM fails
- Export `RelationshipSignalIntent` type from intentService
- Clean up old `VULNERABILITY_PATTERNS` etc. imports after replacing with LLM
- Consider this phase as good opportunity for "Unified Intent Call" since it's the last phase
- Run full test suite before marking complete

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

### Core Implementation
- [ ] **Create LLM function** in `intentService.ts`
- [ ] **Add ConversationContext parameter** to function signature
- [ ] **Export types** for callers
- [ ] **Create fallback function** using existing keywords
- [ ] **Create wrapper** that tries LLM, falls back to keywords
- [ ] **Add to Promise.all** in `messageAnalyzer.ts` (if applicable)

### Testing (Updated from Phase 2)
- [ ] **Mock Supabase** in test file if importing messageAnalyzer or related modules
- [ ] **Update tests** with mocked LLM responses
- [ ] **Add context tests** (same message, different context = different result)
- [ ] **Implement caching** (skip if context provided)
- [ ] **Run full test suite** (`npm run test -- --run`) - all tests must pass

### Cleanup & Verification (Added from Phase 2 lessons)
- [ ] **Remove unused imports** - search for imported names, remove if unused
- [ ] **Re-export types** in messageAnalyzer.ts for consumers
- [ ] **Verify BaseAIService wiring** - confirm conversationContext is passed through
- [ ] **Verify end-to-end** by testing in the actual app (not just unit tests)

### Documentation
- [ ] **Update this doc** with lessons learned for the phase
- [ ] **Mark phase complete** in the status table at the top

---

## Recommended Implementation Prompts

Use these prompts when starting a new conversation to implement each phase.

### Phase 3 Prompt

```
Implement Phase 3 (Mood Detection) of the Semantic Intent Detection project.

## Context
- Phase 1 (Genuine Moment Detection) ✅ Complete
- Phase 2 (Tone & Sentiment Detection) ✅ Complete  
- Both are documented in @docs/Semantic_Intent_Detection.md

## Key Decision Before Starting
Phase 2 already returns a `ToneIntent` object with `primaryEmotion`, `intensity`, and `secondaryEmotion`. 

Before implementing, review @docs/Semantic_Intent_Detection.md Phase 3 section and answer:
1. Can we use `ToneIntent.primaryEmotion` directly for mood patterns? (Option A - recommended)
2. Or do we need a separate `detectMoodLLM()` because mood differs from emotion? (Option B)

Recommend which approach makes sense after reviewing the code.

## If Option A (Leverage ToneIntent):
1. Refactor `recordInteraction()` in @src/services/moodKnobs.ts to accept full `ToneIntent` instead of just `number`
2. Update `messageAnalyzer.ts` to pass `toneResult` instead of `toneResult.sentiment`
3. Use `toneResult.primaryEmotion` for mood pattern tracking in `userPatterns.ts`
4. Use `toneResult.intensity` to affect rate of emotional momentum shift
5. Add tests for the new behavior

## If Option B (Separate Mood Detection):
Follow the existing Phase 1-2 pattern:
1. Add `MoodIntent` type and `detectMoodLLM()` function to @src/services/intentService.ts
2. Add `detectMoodWithLLM()` wrapper in @src/services/messageAnalyzer.ts with keyword fallback
3. Add to `Promise.all()` in `analyzeUserMessage()`
4. Add comprehensive tests to @src/services/tests/intentService.test.ts

## Files to Review First
- @docs/Semantic_Intent_Detection.md (Phase 3 section + Phase 2 lessons learned)
- @src/services/intentService.ts (existing detectToneLLM pattern)
- @src/services/messageAnalyzer.ts (existing integration pattern)
- @src/services/moodKnobs.ts (recordInteraction function)
- @src/services/userPatterns.ts (mood pattern tracking)

## Checklist (from docs)
- [ ] Mock Supabase in test file (userPatterns.ts uses Supabase)
- [ ] Export types from intentService and re-export from messageAnalyzer
- [ ] Clean up unused imports after implementation
- [ ] Run full test suite (`npm run test -- --run`) - all tests must pass

## Deliverables
1. Updated code files
2. Updated tests with mocked LLM responses
3. Update status in @docs/Semantic_Intent_Detection.md to mark Phase 3 complete
4. Add any lessons learned to the Phase 3 section
```

### Phase 4 Prompt

```
Implement Phase 4 (Topic Detection) of the Semantic Intent Detection project.

## Context
- Phases 1-3 are complete per @docs/Semantic_Intent_Detection.md
- Follow the patterns established in Phase 2 (detectToneLLM)

## Implementation
1. Add `TopicIntent` type and `detectTopicsLLM()` to @src/services/intentService.ts
2. Add `detectTopicsWithLLM()` wrapper in @src/services/messageAnalyzer.ts
3. Return array of topics with emotional context: `{ topics: ['work'], emotionalContext: { work: 'frustrated' } }`
4. Replace `TOPIC_CATEGORIES` matching in @src/services/userPatterns.ts
5. Add comprehensive tests with mocked LLM responses

## Files to Modify
- @src/services/intentService.ts
- @src/services/messageAnalyzer.ts  
- @src/services/userPatterns.ts
- @src/services/tests/intentService.test.ts

Follow checklist in @docs/Semantic_Intent_Detection.md and add lessons learned.
```

### Phase 5 Prompt

```
Implement Phase 5 (Open Loop Detection) of the Semantic Intent Detection project.

## Context
- Phases 1-4 are complete per @docs/Semantic_Intent_Detection.md
- `detectOpenLoops()` is already called from messageAnalyzer - just replace internal implementation

## Implementation
1. Add `OpenLoopIntent` type and `detectOpenLoopsLLM()` to @src/services/intentService.ts
2. Replace regex patterns in @src/services/presenceDirector.ts with LLM call
3. Include time inference: "Interview's coming up" → `timeframe: 'soon'`
4. Generate suggested follow-up: `suggestedFollowUp: "How did the interview go?"`
5. Add fallback to existing regex patterns if LLM fails

## Files to Modify
- @src/services/intentService.ts
- @src/services/presenceDirector.ts
- @src/services/tests/intentService.test.ts

Follow checklist in @docs/Semantic_Intent_Detection.md and add lessons learned.
```

### Phase 6 Prompt

```
Implement Phase 6 (Relationship Signals) of the Semantic Intent Detection project.

## Context
- Phases 1-5 are complete per @docs/Semantic_Intent_Detection.md
- `detectMilestoneInMessage()` is already called from messageAnalyzer

## Implementation
1. Add `RelationshipSignalIntent` type and `detectRelationshipSignalsLLM()` to @src/services/intentService.ts
2. Replace regex patterns in @src/services/relationshipMilestones.ts with LLM call
3. Detect nuanced vulnerability: "I don't usually share this" AND "This got deep huh"
4. Detect support acknowledgment: "That actually helped"
5. Add fallback to existing patterns if LLM fails

## After Phase 6
Consider implementing "Unified Intent Call" to reduce from 6 parallel LLM calls to 1.

## Files to Modify
- @src/services/intentService.ts
- @src/services/relationshipMilestones.ts
- @src/services/tests/intentService.test.ts

Follow checklist in @docs/Semantic_Intent_Detection.md and add lessons learned.
```
