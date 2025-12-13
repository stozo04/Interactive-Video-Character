# Semantic Intent Detection

> **Status**: Phase 1 In Progress  
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

| Phase | Scope | Files |
|-------|-------|-------|
| **1** | Genuine moment detection | `intentService.ts`, `moodKnobs.ts` |
| 2 | Tone & sentiment | `messageAnalyzer.ts` |
| 3 | Mood detection | `userPatterns.ts` |
| 4 | Topic detection | `userPatterns.ts`, `memoryService.ts` |
| 5 | Open loop detection | `presenceDirector.ts` |
| 6 | Relationship signals | `relationshipMilestones.ts` |

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


