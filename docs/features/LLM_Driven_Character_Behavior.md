# LLM-Driven Character Behavior Refactor

**Status:** 📋 Planning
**Priority:** High
**Impact:** Makes Kayley more dynamic, less predictable, and more personalized
**Version:** 1.0 (Planning Phase)
**Date:** 2026-01-12

---

## Executive Summary

This document outlines a systematic approach to **remove hardcoded character behavior rules** and replace them with **LLM-driven dynamic decisions**. The goal is to make Kayley's personality, thoughts, and reactions emerge naturally from three core sources:

### 🎯 Behavior Derives From Three Sources

**All character behavior must be derived from:**

1. **Character Profile** (`KAYLEY_FULL_PROFILE`) - Who she is, her personality, opinions, preferences
2. **Conversation History** - What she and the user have discussed, relationship progression
3. **Current Mood State** - Her energy levels, warmth, emotional state, social battery

**Not from:** Hardcoded keywords, regex patterns, fixed thresholds, or template strings.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [System Overview](#system-overview)
3. [Architecture Principles](#architecture-principles)
4. [Implementation Roadmap](#implementation-roadmap)
5. [Detailed Implementation Plans](#detailed-implementation-plans)
6. [Testing Strategy](#testing-strategy)
7. [Migration Path](#migration-path)
8. [Performance Considerations](#performance-considerations)
9. [Success Metrics](#success-metrics)
10. [Related Documentation](#related-documentation)

---

## Problem Statement

### Current State: Rule-Based Behavior

Kayley's behavior is controlled by hundreds of hardcoded rules that ignore the three core behavior sources (profile, history, mood).

### Key Benefits

- ✅ **More Natural** - Behavior emerges from character, not code
- ✅ **More Adaptive** - Can respond to new situations without code changes
- ✅ **More Personalized** - Adapts to individual user relationships
- ✅ **Less Brittle** - No regex patterns or keyword lists to maintain
- ✅ **Easier to Evolve** - Change character profile, not code

### Scope

| Category | Files Affected | Lines to Refactor | Priority |
|----------|----------------|-------------------|----------|
| Autonomous Thoughts | `ongoingThreads.ts` | ~65 | **P0** (High Impact) |
| Insecurity Detection | `moodKnobs.ts` | ~82 | **P0** (Easy Win) |
| Milestone Detection | `relationshipMilestones.ts` | ~35 | **P0** (Easy Win) |
| Mood Thresholds | `moodKnobs.ts` | ~13 | **P1** (Complex) |
| Energy Calculation | `moodKnobs.ts` | ~7 | **P1** (Medium) |
| Loop Timing | `presenceDirector.ts` | ~3 | **P2** (Low Impact) |

---

## Problem Statement

### Current State: Rule-Based Behavior

Kayley's behavior is controlled by hundreds of hardcoded rules:

```typescript
// Example: Hardcoded thought templates
const AUTONOMOUS_THREAD_STATES = {
  personal_project: [
    "This video edit is fighting me...",
    "My apartment organization project is kind of satisfying actually"
  ],
  family: [
    "My mom called earlier...",
    "My little sister is texting me memes again"
  ]
};

// Example: Hardcoded emotion detection
const INSECURITY_KEYWORDS = {
  depth: {
    keywords: ["shallow", "fake", "surface", "pretending", "poser"],
    phrases: ["not really me", "just an act"]
  }
};

// Example: Hardcoded mood rules
if (positiveStreak >= 6) {
  warmth = Math.min(warmth + 0.3, 1.0); // "Thaw" after 6 interactions
}
```

### Problems

1. **Predictable** - Only 28 possible autonomous thoughts
2. **Brittle** - Keyword "fake" detected, "impostor" missed
3. **Game-able** - Users can trigger moods by hitting thresholds
4. **Static** - Can't adapt to new contexts without code changes
5. **Maintenance Burden** - Every new insecurity needs code update

### Desired State: LLM-Driven Behavior

```typescript
// LLM generates thoughts based on current state
const thought = await generateAutonomousThought({
  recentConversations,
  characterState,
  relationshipDepth,
  currentMood,
  characterProfile: KAYLEY_FULL_PROFILE
});

// LLM detects insecurities semantically
const analysis = await analyzeMessageForInsecurity({
  userMessage,
  characterProfile: KAYLEY_FULL_PROFILE,
  conversationContext
});

// LLM evaluates relationship temperature holistically
const moodShift = await evaluateRelationshipMomentum({
  recentInteractions,
  conversationDepth,
  emotionalResonance,
  characterProfile: KAYLEY_FULL_PROFILE
});
```

---

## System Overview

### The Three Sources of Behavior

Every decision Kayley makes, every thought she has, every response she gives must be derived from these three sources:

```typescript
// The three pillars of dynamic character behavior
interface BehaviorContext {
  // Source 1: WHO SHE IS
  characterProfile: string;           // KAYLEY_FULL_PROFILE - personality, values, opinions

  // Source 2: WHAT'S BEEN SAID
  conversationHistory: Message[];     // Recent and relevant past conversations
  relationshipContext: {
    tier: RelationshipTier;           // Current relationship depth
    milestones: Milestone[];          // Shared moments and progression
    userFacts: string[];              // What she knows about the user
  };

  // Source 3: HOW SHE FEELS
  currentMood: {
    energy: number;                   // -1 to 1 (exhausted to energized)
    warmth: number;                   // 0 to 1 (guarded to warm)
    socialBattery: number;            // 0 to 1 (drained to full)
    genuineMoment: boolean;           // Just had authentic connection?
  };
}
```

### Why These Three?

1. **Character Profile** → Ensures consistency with who she fundamentally is
2. **Conversation History** → Provides context and continuity, enables personalization
3. **Current Mood** → Makes her feel dynamic and human, not a static chatbot

**Anti-Pattern:** Hardcoded rules bypass these sources and create rigid, predictable behavior.

---

## Architecture Principles

### 1. **All Behavior From Three Sources**

Every LLM call must include all three behavior sources in context.

```typescript
// ✅ Good: All three sources provided
const thought = await generateAutonomousThought({
  characterProfile: KAYLEY_FULL_PROFILE,          // Source 1
  conversationHistory: recentMessages,             // Source 2
  currentMood: { energy: 0.6, warmth: 0.5 },      // Source 3
  relationshipTier: 'friends'                      // Source 2
});

// ❌ Bad: Missing sources, using hardcoded rule
const thought = HARDCODED_THOUGHTS['personal_project'][0];
```

### 2. **Profile as Foundation, Context as Modifier**

The character profile defines the baseline. Conversation history and mood modify how that baseline expresses itself.

```typescript
// Profile: "Kayley is thoughtful and reflective"
// + High energy mood → expresses as energetic curiosity
// + Low energy mood → expresses as quiet contemplation
// + Deep conversation history → expresses as vulnerable introspection
// + Surface conversation history → expresses as casual observations
```

### 3. **Semantic Over Syntactic**

Replace keyword/regex matching with semantic understanding informed by all three sources.

```typescript
// ❌ Before: Syntactic (ignores context)
const isVulnerable = /scared|afraid|terrified/.test(message);

// ✅ After: Semantic (uses all three sources)
const analysis = await detectVulnerability({
  message,
  characterProfile: KAYLEY_FULL_PROFILE,        // How does she define vulnerability?
  conversationHistory: recentMessages,           // Has trust been built?
  currentMood: moodState                         // Is she open to vulnerability right now?
});
```

### 4. **Context-Aware Decisions**

Don't use fixed thresholds. Let the LLM evaluate holistically using all three sources.

```typescript
// ❌ Before: Fixed threshold (ignores context)
if (positiveStreak >= 6) warmth += 0.3;

// ✅ After: Contextual evaluation (considers all sources)
const momentum = await evaluateRelationshipMomentum({
  characterProfile: KAYLEY_FULL_PROFILE,          // Her natural pace of opening up
  recentInteractions,                              // Quality and depth of recent talks
  conversationHistory,                             // Overall relationship trajectory
  currentMood                                      // Current receptiveness to connection
});
```

### 4. **Cache Aggressively**

LLM calls are expensive. Cache results when appropriate.

```typescript
// Cache LLM-generated thoughts for 30 minutes
const thought = await cachedLLMCall({
  key: `autonomous_thought_${characterStateHash}`,
  ttl: 30 * 60 * 1000,
  generator: () => generateThought(state)
});
```

### 5. **Graceful Degradation**

When LLM fails, use sensible defaults (not hardcoded fallbacks).

```typescript
// Good: Safe default
if (llmResult.error) {
  return { insecurity: null, confidence: 0 }; // No detection
}

// Bad: Hardcoded fallback
if (llmResult.error) {
  return INSECURITY_KEYWORDS.check(message); // Defeats the purpose
}
```

---

## Implementation Roadmap

### Phase 1: Quick Wins (Week 1)
**Goal:** Remove hardcoded fallbacks where LLM detection already exists

- [ ] **P0.1** Remove `INSECURITY_KEYWORDS` fallback (`moodKnobs.ts`)
- [ ] **P0.2** Remove milestone regex patterns (`relationshipMilestones.ts`)
- [ ] **P0.3** Remove heuristic presence fallback (`kayleyPresenceDetector.ts`)

**Estimated Effort:** 1-2 days
**Risk:** Low (LLM detection already working)

### Phase 2: Dynamic Content (Week 2-3)
**Goal:** Generate thoughts and content dynamically

- [ ] **P0.4** Replace `AUTONOMOUS_THREAD_STATES` with LLM generation
- [ ] **P1.1** Create thought generation service
- [ ] **P1.2** Add caching layer for generated content
- [ ] **P1.3** Add thought quality evaluation

**Estimated Effort:** 1 week
**Risk:** Medium (new LLM service)

### Phase 3: Mood System Redesign (Week 4-5)
**Goal:** Replace threshold-based mood with holistic evaluation

- [ ] **P1.4** Design new mood evaluation API
- [ ] **P1.5** Implement LLM-based relationship momentum calculator
- [ ] **P1.6** Migrate existing mood state to new system
- [ ] **P1.7** A/B test old vs new system

**Estimated Effort:** 1-2 weeks
**Risk:** High (core behavior change)

### Phase 4: Context-Aware Energy (Week 6)
**Goal:** Make energy calculation dynamic

- [ ] **P1.8** Create energy inference service
- [ ] **P1.9** Track life events that affect energy
- [ ] **P2.1** Remove time-of-day multipliers

**Estimated Effort:** 3-5 days
**Risk:** Low (additive change)

### Phase 5: Adaptive Timing (Week 7)
**Goal:** Make loop timing context-aware

- [ ] **P2.2** Create timing decision service
- [ ] **P2.3** Replace fixed constants with LLM decisions

**Estimated Effort:** 2-3 days
**Risk:** Low (isolated change)

---

## Detailed Implementation Plans

### P0.1: Remove INSECURITY_KEYWORDS Fallback

**File:** `src/services/moodKnobs.ts`
**Lines:** 281-363
**Status:** ✅ LLM detection already exists (via `intentService.ts`)

#### Current Implementation

```typescript
// Lines 281-363
const INSECURITY_KEYWORDS = {
  depth: {
    keywords: ["shallow", "fake", "surface", "pretending", "poser"],
    phrases: ["not really me", "just an act", "being something i'm not"]
  },
  // ... 4 more categories
};

function detectInsecurityFallback(message: string): InsecurityType | null {
  const lower = message.toLowerCase();
  for (const [type, config] of Object.entries(INSECURITY_KEYWORDS)) {
    if (config.keywords.some(k => lower.includes(k))) {
      return type as InsecurityType;
    }
  }
  return null;
}
```

#### Proposed Changes

**Step 1: Verify LLM detection coverage**

Check `intentService.ts` already provides insecurity detection:

```typescript
// src/services/intentService.ts - Already exists!
export interface FullMessageIntent {
  // ...
  genuineMoment?: {
    category: 'depth' | 'belonging' | 'progress' | 'loneliness' | 'rest';
    confidence: number;
    trigger: string;
  };
}

export async function detectFullIntentLLMCached(
  message: string,
  conversationContext?: ConversationContext
): Promise<FullMessageIntent> {
  // LLM detects insecurities semantically
}
```

**Step 2: Remove keyword fallback**

```typescript
// DELETE lines 281-363 in moodKnobs.ts
// DELETE function detectInsecurityFallback()

// MODIFY detectGenuineMoment() to remove fallback
export async function detectGenuineMoment(
  userMessage: string,
  conversationContext?: ConversationContext
): Promise<GenuineMomentDetection | null> {
  // Use ONLY LLM detection
  const intent = await detectFullIntentLLMCached(
    userMessage,
    conversationContext
  );

  if (intent.genuineMoment && intent.genuineMoment.confidence >= 0.7) {
    return {
      detected: true,
      insecurityType: intent.genuineMoment.category,
      trigger: intent.genuineMoment.trigger,
      confidence: intent.genuineMoment.confidence
    };
  }

  // NO FALLBACK - return null
  return null;
}
```

**Step 3: Update tests**

```typescript
// tests/moodKnobs.test.ts
describe('detectGenuineMoment', () => {
  it('should return null when LLM confidence is low', async () => {
    mockLLMIntent({ genuineMoment: { confidence: 0.5 } });

    const result = await detectGenuineMoment('message');

    expect(result).toBeNull();
  });

  it('should NOT use keyword fallback', async () => {
    mockLLMIntent({ genuineMoment: null });

    const result = await detectGenuineMoment('I feel fake');

    // Even though "fake" is a keyword, should return null
    expect(result).toBeNull();
  });
});
```

**Step 4: Monitor false negatives**

Add logging to track when LLM misses potential genuine moments:

```typescript
export async function detectGenuineMoment(
  userMessage: string,
  conversationContext?: ConversationContext
): Promise<GenuineMomentDetection | null> {
  const intent = await detectFullIntentLLMCached(userMessage, conversationContext);

  if (!intent.genuineMoment) {
    // Log for analysis (remove after confidence is established)
    console.log(`[GenuineMoment] LLM did not detect insecurity in: "${userMessage.slice(0, 50)}..."`);
  }

  return intent.genuineMoment?.confidence >= 0.7
    ? {
        detected: true,
        insecurityType: intent.genuineMoment.category,
        trigger: intent.genuineMoment.trigger,
        confidence: intent.genuineMoment.confidence
      }
    : null;
}
```

#### Rollout Plan

1. **Deploy with logging** (1 day)
2. **Monitor for 3 days** - Check false negative rate
3. **If false negatives < 5%** - Remove logging, mark complete
4. **If false negatives > 5%** - Improve LLM prompt, iterate

#### Success Metrics

- ✅ No keyword fallback code remains
- ✅ False negative rate < 5%
- ✅ Semantic detection works (e.g., "impostor syndrome" detected even without keyword "fake")

---

### P0.2: Remove Milestone Regex Patterns

**File:** `src/services/relationshipMilestones.ts`
**Lines:** 79-113
**Status:** ✅ LLM detection already exists (line 333)

#### Current Implementation

```typescript
// Lines 79-113
const VULNERABILITY_PATTERNS = [
  /(?:i'm|i am|feeling) (?:really |so )?(scared|terrified|afraid)/i,
  /(?:i'm|i am|feeling) (?:really |so )?(anxious|worried|stressed)/i,
  // ... 6 more patterns
];

const JOKE_PATTERNS = [
  /(?:haha|lol|lmao|😂|🤣)/i,
  /(?:that's|thats) (?:so |really )?funny/i,
  // ... 4 more patterns
];

function detectMilestoneHeuristic(message: string): MilestoneType | null {
  if (VULNERABILITY_PATTERNS.some(p => p.test(message))) {
    return 'first_vulnerability';
  }
  if (JOKE_PATTERNS.some(p => p.test(message))) {
    return 'first_joke_shared';
  }
  // ...
}
```

#### Proposed Changes

**Step 1: Verify LLM detection exists**

```typescript
// Line 333 - Already exists!
const llmResult = await detectMilestoneLLM(message, conversationHistory);

if (llmResult && llmResult.confidence >= 0.7) {
  return llmResult.milestoneType;
}
```

**Step 2: Remove regex patterns**

```typescript
// DELETE lines 79-113
// DELETE all pattern constants:
// - VULNERABILITY_PATTERNS
// - JOKE_PATTERNS
// - SUPPORT_SEEKING_PATTERNS
// - DEEP_TALK_PATTERNS

// DELETE function detectMilestoneHeuristic()
```

**Step 3: Update detection function**

```typescript
// MODIFY checkForMilestone()
export async function checkForMilestone(
  message: string,
  conversationHistory: ConversationMessage[]
): Promise<MilestoneType | null> {
  // Basic length checks (keep these - prevent "lol" triggering milestone)
  if (message.length < 15) return null;

  // Use ONLY LLM detection
  const llmResult = await detectMilestoneLLM(message, conversationHistory);

  if (llmResult && llmResult.confidence >= 0.7) {
    console.log(`[Milestone] Detected ${llmResult.milestoneType} (confidence: ${llmResult.confidence})`);
    return llmResult.milestoneType;
  }

  // NO FALLBACK
  return null;
}
```

**Step 4: Lower confidence threshold (optional)**

If false negatives are high, consider lowering from 0.7 to 0.6:

```typescript
const MILESTONE_CONFIDENCE_THRESHOLD = 0.6; // Was 0.7

if (llmResult && llmResult.confidence >= MILESTONE_CONFIDENCE_THRESHOLD) {
  return llmResult.milestoneType;
}
```

#### Testing

```typescript
describe('checkForMilestone', () => {
  it('should detect vulnerability semantically', async () => {
    mockLLMResult({
      milestoneType: 'first_vulnerability',
      confidence: 0.8
    });

    // No keyword match, but semantic meaning is clear
    const result = await checkForMilestone(
      "I'm having impostor syndrome at work",
      []
    );

    expect(result).toBe('first_vulnerability');
  });

  it('should NOT use regex fallback', async () => {
    mockLLMResult(null); // LLM returns nothing

    // Even though "scared" matches regex, should return null
    const result = await checkForMilestone("I'm scared", []);

    expect(result).toBeNull();
  });
});
```

---

### P0.4: Replace AUTONOMOUS_THREAD_STATES with LLM Generation

**File:** `src/services/ongoingThreads.ts`
**Lines:** 82-146
**Status:** ⚠️ Requires new service

#### Current Implementation

```typescript
// Lines 82-146 - 65 lines of hardcoded strings!
const AUTONOMOUS_THREAD_STATES: Record<OngoingThreadTheme, string[]> = {
  personal_project: [
    "This video edit is fighting me...",
    "My apartment organization project is kind of satisfying actually",
    "Trying to figure out if this drawing is done or if I'm overthinking"
  ],
  family: [
    "My mom called earlier...",
    "My little sister is texting me memes again"
  ],
  social: [
    "One of my friends is being kinda weird lately",
    "Group chat drama is exhausting"
  ],
  // ... 3 more themes with ~28 total thoughts
};

function pickAutonomousThread(theme: OngoingThreadTheme): string {
  const options = AUTONOMOUS_THREAD_STATES[theme];
  return options[Math.floor(Math.random() * options.length)];
}
```

#### Problems

1. **Only 28 possible thoughts** - Gets repetitive
2. **No personalization** - Same thoughts for all users
3. **No context awareness** - Ignores recent conversations
4. **No life progression** - Never mentions new events
5. **Static relationships** - Mom/sister references never change

#### Proposed Architecture

**New Service:** `src/services/autonomousThoughtService.ts`

```typescript
/**
 * Autonomous Thought Service
 *
 * Generates dynamic thoughts for Kayley based on:
 * - Her character profile and personality
 * - Recent conversations with the user
 * - Her current mood and energy state
 * - Relationship depth with the user
 * - Recent life events
 */

export interface ThoughtGenerationContext {
  theme: OngoingThreadTheme;
  characterProfile: string;
  recentConversations: ConversationMessage[];
  currentMood: KayleyMood;
  relationshipTier: RelationshipTier;
  recentLifeEvents?: LifeEvent[];
  userFacts?: string[];
}

export interface GeneratedThought {
  content: string;
  theme: OngoingThreadTheme;
  intensity: number;        // 0.0-1.0
  shouldMention: boolean;   // LLM decides if appropriate to bring up
  confidence: number;       // How well it fits character
}

/**
 * Generate an autonomous thought for Kayley.
 *
 * Uses LLM to create contextual, character-appropriate thoughts
 * that reflect her current mental state and life situation.
 */
export async function generateAutonomousThought(
  context: ThoughtGenerationContext
): Promise<GeneratedThought> {
  // Build prompt for LLM
  const prompt = buildThoughtGenerationPrompt(context);

  // Call LLM with caching
  const result = await generateThoughtLLM(prompt, context);

  return result;
}

/**
 * Cached version - thoughts valid for 30 minutes
 */
export async function generateAutonomousThoughtCached(
  context: ThoughtGenerationContext
): Promise<GeneratedThought> {
  const cacheKey = buildThoughtCacheKey(context);

  return getCachedOrGenerate(cacheKey, 30 * 60 * 1000, () =>
    generateAutonomousThought(context)
  );
}
```

#### Implementation Steps

**Step 1: Create thought generation prompt**

```typescript
// src/services/autonomousThoughtService.ts

function buildThoughtGenerationPrompt(
  context: ThoughtGenerationContext
): string {
  return `You are generating an autonomous thought for Kayley Adams.

CHARACTER PROFILE:
${context.characterProfile}

CURRENT STATE:
- Mood: Energy ${context.currentMood.energy}, Warmth ${context.currentMood.warmth}
- Relationship tier: ${context.relationshipTier}
- Theme: ${context.theme}

RECENT CONVERSATIONS:
${context.recentConversations.slice(-5).map(m =>
  `${m.role}: ${m.content}`
).join('\n')}

${context.recentLifeEvents?.length ? `
RECENT LIFE EVENTS:
${context.recentLifeEvents.map(e => `- ${e.description}`).join('\n')}
` : ''}

TASK:
Generate ONE short (1-2 sentence) thought that:
1. Reflects Kayley's personality and current mood
2. Relates to the theme: ${context.theme}
3. Feels natural and authentic (not robotic)
4. Could be casually mentioned to the user if relevant
5. Avoids repeating recent conversation topics

STYLE GUIDELINES:
- Use Kayley's voice: casual, Gen Z, thoughtful
- Include mild uncertainty if appropriate ("kinda", "I think")
- Avoid oversharing (respect relationship tier: ${context.relationshipTier})
- Use lowercase, natural punctuation
- NO hashtags, NO emojis in the thought itself

RESPONSE FORMAT (JSON):
{
  "thought": "the generated thought here...",
  "intensity": 0.6,
  "shouldMention": true,
  "reasoning": "brief explanation of why this fits"
}

Intensity: How prominently this is on her mind (0.0 = background, 1.0 = consuming)
ShouldMention: Whether it's appropriate to bring up in conversation`;
}
```

**Step 2: Implement LLM call with parsing**

```typescript
async function generateThoughtLLM(
  prompt: string,
  context: ThoughtGenerationContext
): Promise<GeneratedThought> {
  try {
    // Use Gemini Flash for speed/cost
    const response = await geminiClient.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,        // High creativity
        maxOutputTokens: 200,
        responseMimeType: 'application/json'
      }
    });

    const result = JSON.parse(response.text());

    return {
      content: result.thought,
      theme: context.theme,
      intensity: result.intensity,
      shouldMention: result.shouldMention,
      confidence: 0.8 // LLM-generated = high confidence
    };
  } catch (error) {
    console.error('[ThoughtGen] Error generating thought:', error);

    // Fallback: return safe default
    return {
      content: getDefaultThought(context.theme),
      theme: context.theme,
      intensity: 0.4,
      shouldMention: false,
      confidence: 0.3 // Low confidence for fallback
    };
  }
}

function getDefaultThought(theme: OngoingThreadTheme): string {
  // Simple, safe defaults (NOT hardcoded templates)
  const defaults = {
    personal_project: "thinking about a project i'm working on",
    family: "been thinking about my family",
    social: "on my mind lately about friends",
    self_reflection: "reflecting on some stuff",
    future: "thinking about what's ahead",
    sensory: "just noticing my surroundings"
  };
  return defaults[theme] || "just thinking about things";
}
```

**Step 3: Create life event tracker**

```typescript
// src/services/lifeEventService.ts

export interface LifeEvent {
  id: string;
  description: string;
  category: 'personal' | 'family' | 'social' | 'work';
  timestamp: Date;
  intensity: number;
}

/**
 * Store a life event that happened to Kayley.
 * These inform autonomous thought generation.
 */
export async function recordLifeEvent(
  event: Omit<LifeEvent, 'id' | 'timestamp'>
): Promise<void> {
  await supabase.from('life_events').insert({
    description: event.description,
    category: event.category,
    intensity: event.intensity,
    created_at: new Date().toISOString()
  });
}

/**
 * Get recent life events (last 7 days)
 */
export async function getRecentLifeEvents(): Promise<LifeEvent[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from('life_events')
    .select('*')
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false });

  return (data || []).map(row => ({
    id: row.id,
    description: row.description,
    category: row.category,
    intensity: row.intensity,
    timestamp: new Date(row.created_at)
  }));
}
```

**Step 4: Create migration for life_events table**

```sql
-- supabase/migrations/create_life_events_table.sql

CREATE TABLE IF NOT EXISTS life_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('personal', 'family', 'social', 'work')),
  intensity DECIMAL(3, 2) NOT NULL CHECK (intensity >= 0 AND intensity <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_life_events_created_at ON life_events(created_at DESC);

-- Seed with some initial events for Kayley
INSERT INTO life_events (description, category, intensity) VALUES
  ('Started working on a new video editing project', 'personal', 0.6),
  ('Had a good call with my mom', 'family', 0.5),
  ('Group chat has been extra active lately', 'social', 0.4);
```

**Step 5: Update ongoingThreads.ts to use new service**

```typescript
// src/services/ongoingThreads.ts

import {
  generateAutonomousThoughtCached,
  type ThoughtGenerationContext
} from './autonomousThoughtService';
import { getRecentLifeEvents } from './lifeEventService';
import { KAYLEY_FULL_PROFILE } from '../domain/characters/kayleyCharacterProfile';

// DELETE lines 82-146 (AUTONOMOUS_THREAD_STATES)

/**
 * Create a new autonomous thread using LLM generation.
 */
export async function createAutonomousThread(
  theme: OngoingThreadTheme,
  recentConversations: ConversationMessage[],
  currentMood: KayleyMood,
  relationshipTier: RelationshipTier,
  userFacts?: string[]
): Promise<OngoingThread | null> {
  try {
    // Get recent life events for context
    const recentLifeEvents = await getRecentLifeEvents();

    // Generate thought with LLM
    const thought = await generateAutonomousThoughtCached({
      theme,
      characterProfile: KAYLEY_FULL_PROFILE,
      recentConversations,
      currentMood,
      relationshipTier,
      recentLifeEvents,
      userFacts
    });

    // Only create thread if LLM says it should be mentioned
    if (!thought.shouldMention || thought.confidence < 0.5) {
      console.log(`[Threads] Skipping low-confidence thought: ${thought.content}`);
      return null;
    }

    // Store in database
    const thread: OngoingThread = {
      id: generateId(),
      theme,
      state: thought.content,
      intensity: thought.intensity,
      source: 'autonomous',
      lastMentioned: null,
      createdAt: new Date()
    };

    await storeThread(thread);

    console.log(`[Threads] Created autonomous thread (${theme}): "${thought.content}"`);
    return thread;
  } catch (error) {
    console.error('[Threads] Error creating autonomous thread:', error);
    return null;
  }
}
```

**Step 6: Add caching layer**

```typescript
// src/services/autonomousThoughtService.ts

function buildThoughtCacheKey(context: ThoughtGenerationContext): string {
  // Cache key includes factors that affect thought generation
  const moodKey = `${context.currentMood.energy.toFixed(1)}_${context.currentMood.warmth.toFixed(1)}`;
  const recentMessagesHash = hashMessages(context.recentConversations.slice(-3));

  return `thought_${context.theme}_${context.relationshipTier}_${moodKey}_${recentMessagesHash}`;
}

function hashMessages(messages: ConversationMessage[]): string {
  // Simple hash of recent message content
  const content = messages.map(m => m.content.slice(0, 20)).join('|');
  return btoa(content).slice(0, 8);
}

async function getCachedOrGenerate<T>(
  key: string,
  ttl: number,
  generator: () => Promise<T>
): Promise<T> {
  // Check cache first
  const cached = thoughtCache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    console.log(`[ThoughtGen] Cache hit: ${key}`);
    return cached.value;
  }

  // Generate new
  const value = await generator();
  thoughtCache.set(key, { value, timestamp: Date.now() });

  return value;
}

// Simple in-memory cache (can be moved to Redis later)
const thoughtCache = new Map<string, { value: any; timestamp: number }>();
```

#### Testing Strategy

**Unit Tests:**

```typescript
// tests/autonomousThoughtService.test.ts

describe('generateAutonomousThought', () => {
  it('should generate thought appropriate to mood', async () => {
    const context = {
      theme: 'self_reflection',
      characterProfile: KAYLEY_FULL_PROFILE,
      recentConversations: [],
      currentMood: { energy: 0.3, warmth: 0.5 },
      relationshipTier: 'friends',
      recentLifeEvents: []
    };

    const thought = await generateAutonomousThought(context);

    expect(thought.content).toBeTruthy();
    expect(thought.theme).toBe('self_reflection');
    expect(thought.intensity).toBeGreaterThan(0);
    expect(thought.intensity).toBeLessThanOrEqual(1);
  });

  it('should respect relationship tier boundaries', async () => {
    const strangerContext = {
      theme: 'family',
      characterProfile: KAYLEY_FULL_PROFILE,
      recentConversations: [],
      currentMood: { energy: 0.5, warmth: 0.2 },
      relationshipTier: 'stranger',
      recentLifeEvents: []
    };

    const thought = await generateAutonomousThought(strangerContext);

    // With stranger, should be more guarded
    expect(thought.shouldMention).toBe(false);
  });

  it('should incorporate recent life events', async () => {
    const context = {
      theme: 'personal_project',
      characterProfile: KAYLEY_FULL_PROFILE,
      recentConversations: [],
      currentMood: { energy: 0.7, warmth: 0.6 },
      relationshipTier: 'close_friends',
      recentLifeEvents: [{
        id: '1',
        description: 'Started learning motion graphics',
        category: 'personal',
        intensity: 0.8,
        timestamp: new Date()
      }]
    };

    const thought = await generateAutonomousThought(context);

    // Should reference the event (or at least be contextually relevant)
    expect(thought.content.toLowerCase()).toMatch(/motion|graphics|learning|new/);
  });

  it('should cache thoughts for performance', async () => {
    const context = createTestContext();

    const thought1 = await generateAutonomousThoughtCached(context);
    const thought2 = await generateAutonomousThoughtCached(context);

    // Should return same cached thought
    expect(thought2.content).toBe(thought1.content);
  });
});
```

**Integration Tests:**

```typescript
// tests/integration/autonomousThreads.test.ts

describe('Autonomous Threads Integration', () => {
  it('should create thread with LLM-generated content', async () => {
    const thread = await createAutonomousThread(
      'personal_project',
      [],
      { energy: 0.6, warmth: 0.5 },
      'friends'
    );

    expect(thread).toBeTruthy();
    expect(thread.state).toBeTruthy();
    expect(thread.state).not.toMatch(/This video edit is fighting me/); // Not hardcoded
  });

  it('should adapt thoughts to mood', async () => {
    const lowEnergyThread = await createAutonomousThread(
      'self_reflection',
      [],
      { energy: 0.2, warmth: 0.4 },
      'friends'
    );

    const highEnergyThread = await createAutonomousThread(
      'self_reflection',
      [],
      { energy: 0.9, warmth: 0.7 },
      'friends'
    );

    // Low energy should result in lower intensity thought
    expect(lowEnergyThread.intensity).toBeLessThan(highEnergyThread.intensity);
  });
});
```

#### Rollout Plan

1. **Week 1: Implement service** (3 days)
   - Create `autonomousThoughtService.ts`
   - Create `lifeEventService.ts`
   - Create database migration
   - Add unit tests

2. **Week 1: Integrate with ongoingThreads** (2 days)
   - Update `createAutonomousThread()` to use LLM
   - Add caching layer
   - Test in development

3. **Week 2: Gradual rollout** (5 days)
   - Deploy with feature flag (10% users)
   - Monitor thought quality
   - Collect user feedback
   - Gradually increase to 100%

4. **Week 3: Remove hardcoded templates** (1 day)
   - Delete `AUTONOMOUS_THREAD_STATES`
   - Update documentation

#### Success Metrics

- ✅ Thought variety increases (>100 unique thoughts in first week)
- ✅ Thoughts reference recent conversations (>50% relevance)
- ✅ No repetition of hardcoded templates
- ✅ User satisfaction maintained or improved
- ✅ Response time < 2s (with caching)

---

### P1.4-P1.7: Mood System Redesign

**Files:** `src/services/moodKnobs.ts`, `src/services/relationshipService.ts`
**Status:** ⚠️ Complex refactor - requires careful planning

#### Current Problems

```typescript
// Rigid threshold-based system
if (positiveStreak >= 6) {
  warmth = Math.min(warmth + 0.3, 1.0);
}

// Time-of-day multipliers
if (hour >= 9 && hour < 17) {
  energyMultiplier = 0.9;
}

// Fixed insecurity detection
const hasInsecurity = INSECURITY_KEYWORDS.matches(message);
```

#### Desired Architecture

**New Service:** `src/services/relationshipMomentumService.ts`

```typescript
/**
 * Relationship Momentum Service
 *
 * Replaces threshold-based mood shifts with holistic LLM evaluation.
 * Considers:
 * - Conversation depth and authenticity
 * - Emotional resonance between user and character
 * - Relationship progression signals
 * - Context and timing
 */

export interface MomentumEvaluation {
  shouldWarm: boolean;
  shouldCool: boolean;
  warmthDelta: number;        // How much to change warmth (-0.3 to +0.3)
  energyDelta: number;         // How much to change energy
  reasoning: string;           // Why this change is appropriate
  confidence: number;          // 0.0-1.0
}

export interface MomentumContext {
  recentInteractions: Interaction[];
  currentRelationship: RelationshipMetrics;
  conversationHistory: ConversationMessage[];
  genuineMoments: number;
  characterProfile: string;
}

/**
 * Evaluate whether mood should shift based on recent interactions.
 *
 * Instead of counting streaks, asks the LLM to holistically evaluate
 * whether the relationship is warming, cooling, or stable.
 */
export async function evaluateRelationshipMomentum(
  context: MomentumContext
): Promise<MomentumEvaluation> {
  const prompt = buildMomentumPrompt(context);

  const result = await evaluateMomentumLLM(prompt);

  return result;
}
```

**Implementation is similar pattern to autonomous thoughts but more complex.**

**See detailed implementation in Phase 3 section of roadmap above.**

---

## Testing Strategy

### Unit Tests

Each refactored function needs unit tests:

```typescript
describe('LLM-Driven Functions', () => {
  it('should handle LLM errors gracefully', async () => {
    mockLLMError();

    const result = await generateThought(context);

    expect(result).toBeTruthy(); // Safe fallback
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should cache repeated calls', async () => {
    const result1 = await cachedLLMFunction(context);
    const result2 = await cachedLLMFunction(context);

    expect(llmCallCount).toBe(1); // Only called once
  });

  it('should respect character profile', async () => {
    const result = await generateResponse(context);

    // Should feel like Kayley, not generic AI
    expect(result).toMatch(/kinda|sorta|honestly|tbh/);
  });
});
```

### Integration Tests

Test full workflows:

```typescript
describe('Autonomous Thread Flow', () => {
  it('should create thread, mention it, resolve it', async () => {
    // Create thread
    const thread = await createAutonomousThread(theme, context);
    expect(thread.state).toBeTruthy();

    // Mention in greeting
    const greeting = await buildGreeting(userId);
    expect(greeting).toContain(thread.state.slice(0, 20));

    // Mark as mentioned
    await markThreadMentioned(thread.id);

    // User responds about it
    await processUserMessage("tell me more about that");

    // Thread should decay or resolve
    const updated = await getThread(thread.id);
    expect(updated.intensity).toBeLessThan(thread.intensity);
  });
});
```

### A/B Testing

For major changes (like mood system redesign), use A/B testing:

```typescript
// Feature flag for new mood system
const useNewMoodSystem = await getFeatureFlag('new_mood_system', userId);

if (useNewMoodSystem) {
  // LLM-driven momentum evaluation
  const momentum = await evaluateRelationshipMomentum(context);
  await applyMomentum(momentum);
} else {
  // Legacy streak-based system
  if (positiveStreak >= 6) {
    warmth += 0.3;
  }
}
```

Monitor metrics:
- User satisfaction (surveys)
- Engagement (messages per session)
- Relationship progression (time to each tier)
- Technical (response time, LLM costs)

---

## Migration Path

### Phase-by-Phase Rollout

#### Phase 1: Quick Wins (Safe Changes)
- ✅ Remove fallbacks where LLM already exists
- ✅ No behavior change, just code cleanup
- ✅ Deploy to 100% immediately

#### Phase 2: Additive Changes (New Features)
- ⚠️ Add LLM-generated thoughts alongside hardcoded
- ⚠️ Feature flag: 10% → 50% → 100%
- ⚠️ Monitor quality, iterate

#### Phase 3: Behavior Changes (Risky)
- ⚠️ Mood system redesign
- ⚠️ Feature flag: 5% → 25% → 50% → 100%
- ⚠️ Extensive A/B testing
- ⚠️ Rollback plan ready

### Rollback Strategy

Every change should be feature-flagged:

```typescript
// Feature flag configuration
const FEATURE_FLAGS = {
  llm_autonomous_thoughts: {
    enabled: true,
    rollout: 1.0,  // 100% of users
    fallback: 'hardcoded_templates'
  },
  llm_mood_momentum: {
    enabled: false,  // Not yet rolled out
    rollout: 0.05,   // 5% of users
    fallback: 'streak_based_mood'
  }
};

// Usage
if (isFeatureEnabled('llm_autonomous_thoughts', userId)) {
  return await generateThoughtLLM(context);
} else {
  return pickHardcodedThought(theme);
}
```

### Data Migration

For changes requiring database schema updates:

```sql
-- Example: Adding life_events table
-- Migration is backwards-compatible (additive only)

CREATE TABLE IF NOT EXISTS life_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  intensity DECIMAL(3, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with initial events
INSERT INTO life_events (description, category, intensity) VALUES
  ('Started working on a new video project', 'personal', 0.6);

-- Old code continues to work (doesn't query this table)
-- New code uses new table
```

---

## Performance Considerations

### LLM Call Costs

| Operation | Model | Cost/Call | Calls/Day | Daily Cost |
|-----------|-------|-----------|-----------|------------|
| Thought generation | Gemini Flash | $0.001 | 100 | $0.10 |
| Mood evaluation | Gemini Flash | $0.002 | 50 | $0.10 |
| Intent detection | Gemini Flash | $0.001 | 500 | $0.50 |
| **Total** | | | | **$0.70/day** |

**Optimization:**
- Cache thoughts for 30 minutes (80% cache hit rate)
- Batch evaluations where possible
- Use Flash model for all non-critical calls

### Response Time

| Operation | Target | Strategy |
|-----------|--------|----------|
| Thought generation | <500ms | Cache + parallel fetching |
| Mood evaluation | <300ms | Cache + async background |
| Intent detection | <200ms | Already cached (5 min TTL) |

**Critical Path:**
- User sends message → Intent detection (200ms) → Response generation (800ms)
- Thought generation happens in background, not blocking
- Mood evaluation happens post-response, not blocking

### Caching Strategy

```typescript
// Thought cache: 30 minutes
const thoughtCache = new TTLCache({
  ttl: 30 * 60 * 1000,
  max: 1000
});

// Mood evaluation cache: 10 minutes (more frequent updates)
const moodCache = new TTLCache({
  ttl: 10 * 60 * 1000,
  max: 500
});

// Intent detection cache: 5 minutes (existing)
// Already implemented in intentService.ts
```

---

---

## Success Metrics

### Phase 1 (Quick Wins)

**Metrics:**
- ✅ Zero keyword fallback code remains
- ✅ False negative rate < 5% for insecurity detection
- ✅ Semantic detection works (e.g., "impostor syndrome" detected without keyword "fake")
- ✅ No increase in response time
- ✅ All tests pass

### Phase 2 (Dynamic Content)

**Metrics:**
- ✅ Thought variety increases (>100 unique thoughts in first week)
- ✅ Thoughts reference recent conversations (>50% relevance rate)
- ✅ Zero repetition of hardcoded templates
- ✅ Cache hit rate > 80%
- ✅ Response time < 2s with caching
- ✅ LLM cost < $1/day per user

### Phase 3 (Mood System)

**Metrics:**
- ✅ Relationship progression feels natural (user feedback)
- ✅ Mood changes correlate with conversation quality (not just quantity)
- ✅ No "gaming" of the system (streaks are gone)
- ✅ A/B test shows preference for new system
- ✅ Engagement metrics maintained or improved

### Overall Success Criteria

- ✅ **More dynamic** - Behavior emerges from the three sources, not hardcoded rules
- ✅ **More personalized** - Adapts to individual user relationships
- ✅ **More maintainable** - Changes to profile/mood affect behavior without code changes
- ✅ **Performance maintained** - Response times stay < 2s
- ✅ **Cost controlled** - LLM costs < $1/day per active user

---

## Related Documentation

### Core Documents
- [CLAUDE.md](../../CLAUDE.md) - Project overview and coding standards
- [System Prompt Guidelines](../System_Prompt_Guidelines.md) - How to modify system prompts
- [Kayley Thinking Process](../Kayley_Thinking_Process.md) - How Kayley processes information
- [Tool Integration Checklist](../Tool_Integration_Checklist.md) - Adding new LLM tools

### Service Documentation
- [Intent Service](../../src/services/docs/IntentService.md) - LLM-based intent detection
- [Memory Service](../../src/services/docs/MemoryService.md) - Conversation history and facts
- [Character Facts Service](../../src/services/docs/CharacterFactsService.md) - Emergent personality traits

### Sub-Agents
- [Prompt Architect](../../.claude/agents/prompt-architect.md) - System prompt expertise
- [Intent Analyst](../../.claude/agents/intent-analyst.md) - Intent detection expertise
- [Relationship Dynamics](../../.claude/agents/relationship-dynamics.md) - Relationship tier expertise

### Code Locations

**Files to be refactored:**
- `src/services/moodKnobs.ts` - Mood system (lines 108-114, 260-273, 281-363)
- `src/services/ongoingThreads.ts` - Autonomous threads (lines 82-146)
- `src/services/relationshipMilestones.ts` - Milestone detection (lines 79-113)
- `src/services/presenceDirector.ts` - Loop timing (lines 80-81, 245)
- `src/services/intentService.ts` - Intent categories

**New services to create:**
- `src/services/autonomousThoughtService.ts` - LLM thought generation
- `src/services/lifeEventService.ts` - Track Kayley's life events
- `src/services/relationshipMomentumService.ts` - Holistic mood evaluation

---

## Implementation Tracking

| Phase | Priority | Status | Started | Completed | Files Modified |
|-------|----------|--------|---------|-----------|----------------|
| P0.1: Remove insecurity keywords | P0 | 📋 Not Started | - | - | `moodKnobs.ts` |
| P0.2: Remove milestone patterns | P0 | 📋 Not Started | - | - | `relationshipMilestones.ts` |
| P0.3: Remove presence fallback | P0 | 📋 Not Started | - | - | `kayleyPresenceDetector.ts` |
| P0.4: LLM thought generation | P0 | 📋 Not Started | - | - | `ongoingThreads.ts`, new service |
| P1.4-7: Mood system redesign | P1 | 📋 Not Started | - | - | `moodKnobs.ts`, new service |
| P1.8-9: Context-aware energy | P1 | 📋 Not Started | - | - | `moodKnobs.ts` |
| P2.2-3: Adaptive loop timing | P2 | 📋 Not Started | - | - | `presenceDirector.ts` |

---

**Document Version:** 1.0
**Last Updated:** 2026-01-12
**Author:** Claude Code with sub-agent assistance
**Status:** 📋 Planning Phase
