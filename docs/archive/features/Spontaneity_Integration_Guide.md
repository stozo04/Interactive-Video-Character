# Spontaneity System Integration Guide

This document explains how the spontaneity system is integrated into the main chat flow.

## Ownership

The Spontaneity System is a cross-cutting feature with the following sub-agent ownership:

| Component | File | Owner | Responsibility |
|-----------|------|-------|----------------|
| Tracker | `spontaneityTracker.ts` | `chat-engine-specialist` | Probability calculations, message tracking |
| Association Engine | `associationEngine.ts` | `chat-engine-specialist` | Topic matching, share associations |
| Integration | `integrateSpontaneity.ts` | `chat-engine-specialist` | Main entry point, chat flow wiring |
| Prompt Builder | `spontaneityPrompt.ts` | `prompt-architect` | System prompt generation |
| Session Reflection | `sessionReflection.ts` | `presence-proactivity` | Post-session synthesis |
| Idle Thoughts | `idleThoughts.ts` | `presence-proactivity` | User absence behavior |
| Visual Mapper | `visualStateMapper.ts` | `state-manager` | Emotional state → video mapping |
| SQL Migrations | `create_spontaneity_tables.sql` | `state-manager` | Database schema |

**Primary Owner: `presence-proactivity`**

The core concept of spontaneity - making Kayley feel "alive" through unprompted behaviors - aligns with the `presence-proactivity` agent's domain. For high-level changes or new spontaneity features, start with this agent.

**When to use which agent:**
- Changing when/how spontaneity triggers → `presence-proactivity`
- Changing probability calculations or chat flow → `chat-engine-specialist`
- Changing prompt output format → `prompt-architect`
- Database schema changes → `state-manager`

## Overview

The spontaneity system makes Kayley feel alive by enabling her to:
- Share things unprompted ("that reminds me...")
- Make jokes and be playful
- Ask random questions
- Send spontaneous selfies (friend+ only)
- Check in on the user

## Architecture

```
User Message
    │
    ▼
getSoulLayerContextAsync(userId, spontaneityOptions?)
    │
    ├── Fetch mood knobs, threads, presence (parallel)
    │
    └── If spontaneityOptions provided:
        └── integrateSpontaneity()
            │
            ├── Track message/topics
            ├── Fetch pending shares
            ├── Build spontaneity context
            ├── Calculate probabilities
            ├── Generate prompt sections
            └── Find associations
    │
    ▼
buildSystemPrompt()
    │
    └── Conditionally include spontaneity sections:
        ├── Main spontaneity prompt (if applicable)
        ├── Humor guidance (mood-dependent)
        └── Selfie opportunity (rare, friend+)
    │
    ▼
LLM Response
```

## Usage

### Basic Integration (Spontaneity Disabled)

```typescript
// Default - no spontaneity
const soulContext = await getSoulLayerContextAsync(userId);
const prompt = await buildSystemPrompt(
  character,
  relationship,
  // ... other params
  userId,
  userTimeZone,
  { soulContext, characterFacts }
);
```

### With Spontaneity Enabled

```typescript
import type { ConversationalMood, SpontaneityOptions } from './services/system_prompts';

// Build spontaneity options
const spontaneityOptions: SpontaneityOptions = {
  conversationalMood: 'playful', // or 'deep', 'casual', 'heavy', etc.
  relationshipTier: relationship?.relationshipTier || 'stranger',
  currentTopics: ['work', 'stress'], // Extracted from message
  userInterests: ['gaming', 'coffee'], // From user profile
  currentThought: 'I need to finish editing that video...', // Optional
  recentExperience: 'Just got back from the gym', // Optional
  currentLocation: 'home', // Optional - from calendar or context
  currentOutfit: 'gym clothes', // Optional - if mentioned
  currentMoodForSelfie: 'feeling good', // Optional - for selfie generation
  userHadBadDay: false, // Optional - detected from intent
};

// Get soul context with spontaneity
const soulContext = await getSoulLayerContextAsync(userId, spontaneityOptions);

// Build system prompt (spontaneity sections auto-included)
const prompt = await buildSystemPrompt(
  character,
  relationship,
  // ... other params
  userId,
  userTimeZone,
  { soulContext, characterFacts }
);
```

## Spontaneity Sections

### 1. Main Spontaneity Prompt

Gives Kayley permission to be spontaneous. Includes:
- Current context (mood, energy, relationship)
- Things on her mind (thoughts, experiences, pending shares)
- Topics discussed (for associations)
- Spontaneous behaviors she can do (with probability)
- Rules (don't overdo it, match the vibe)

**Included when**: `spontaneityProbability > 0`

### 2. Humor Guidance

Provides mood-specific humor calibration:
- Heavy/tense mood → NO HUMOR warning
- Playful/casual mood → Humor style guide
- Shows if recent humor has landed

**Included when**: Mood allows humor OR needs warning

### 3. Selfie Opportunity

Rare section for spontaneous selfie suggestions:
- Reasons (bad day, cool location, good mood, etc.)
- Good/bad caption examples
- Reminder: selfies are rare and special

**Included when**:
- Relationship tier is friend+
- `selfieProbability > 0`

## Probabilities

### Spontaneity Probability

Base: 10%, Max: 40%

Modifiers:
- Tier bonus: 0% (stranger) → 15% (deeply_loving)
- Energy: +/-5% based on verbosity
- Message count: +2-5% for longer conversations
- Cooldown: 80% reduction if within 3 minutes

### Selfie Probability

Base: 2%, Max: 15%

Modifiers:
- Tier bonus: 0% (stranger) → 5% (deeply_loving)
- High energy: +2%
- Positive mood: +3%
- User had bad day: +4%
- Cool location: +2%
- Cooldown: 90% reduction if within 24 hours

## Performance Considerations

### Latency Impact

- Spontaneity integration adds ~50-100ms
- Runs in parallel with other soul context fetches
- Does NOT block the main response
- Fetches pending shares from DB (cached)

### <2s Response Time Budget

```
Total: ~1.9s
├── Intent detection: ~200ms (parallel)
├── Context prefetch: ~300ms (parallel)
│   └── Spontaneity integration: ~50-100ms (within prefetch)
└── Provider call: ~1.4s
```

Spontaneity fits within the existing prefetch time budget.

## Database Tables

All tables are defined in `supabase/migrations/create_spontaneity_tables.sql`:

| Table | Purpose |
|-------|---------|
| `kayley_pending_shares` | Things Kayley wants to share (stories, thoughts, selfies) |
| `spontaneous_selfie_history` | Selfie cooldown tracking and reaction patterns |
| `session_reflections` | Post-session emotional synthesis |
| `idle_thoughts` | Dreams/thoughts generated during user absence |
| `visual_state_mapping` | Maps emotional states to video manifests |
| `conversation_spontaneity_state` | In-conversation spontaneity budget tracking |

Run the migration to create these tables:
```bash
# Via Supabase CLI
supabase db push

# Or execute directly in Supabase SQL Editor
# File: supabase/migrations/create_spontaneity_tables.sql
```

## Testing

```bash
# Run spontaneity tests
npm test -- --run -t "spontaneity"

# Run integration tests
npm test -- --run -t "prompt"

# Run all tests
npm test -- --run
```

## Example: Full Integration in BaseAIService

```typescript
// In BaseAIService.generateResponse()

async generateResponse(message: string, context: ChatContext): Promise<AIResponse> {
  // 1. Parallel prefetch (includes spontaneity)
  const [intentResult, prefetchedContext] = await Promise.all([
    detectFullIntentLLMCached(message),
    this.prefetchContextWithSpontaneity(userId, message),
  ]);

  // 2. Build prompt (spontaneity auto-included in soul context)
  const systemPrompt = await buildSystemPrompt(
    character,
    relationship,
    // ... other params
    userId,
    userTimeZone,
    prefetchedContext
  );

  // 3. Call provider
  return this.callProvider(message, systemPrompt);
}

private async prefetchContextWithSpontaneity(
  userId: string,
  message: string
): Promise<{ soulContext: SoulLayerContext; characterFacts: string }> {

  // Extract topics from message (simplified)
  const currentTopics = extractTopics(message);

  // Determine conversational mood (from intent or heuristic)
  const conversationalMood = determineConversationalMood(message);

  // Build spontaneity options
  const spontaneityOptions: SpontaneityOptions = {
    conversationalMood,
    relationshipTier: relationship?.relationshipTier || 'stranger',
    currentTopics,
    userInterests: [], // From user profile
  };

  // Fetch soul context WITH spontaneity
  const [soulContext, characterFacts] = await Promise.all([
    getSoulLayerContextAsync(userId, spontaneityOptions),
    formatCharacterFactsForPrompt(),
  ]);

  return { soulContext, characterFacts };
}
```

## Configuration

### Enable/Disable Spontaneity

```typescript
// Disable spontaneity globally
const soulContext = await getSoulLayerContextAsync(userId); // No options = no spontaneity

// Enable conditionally
const enableSpontaneity = relationship?.relationshipTier !== 'stranger';
const soulContext = enableSpontaneity
  ? await getSoulLayerContextAsync(userId, spontaneityOptions)
  : await getSoulLayerContextAsync(userId);
```

### Adjust Probabilities

Edit constants in `src/services/spontaneity/types.ts`:

```typescript
export const SPONTANEITY_DEFAULTS = {
  baseProbability: 0.1,          // 10% base
  maxProbability: 0.4,           // Cap at 40%
  selfieBaseProbability: 0.02,   // 2% base for selfies
  selfieMaxProbability: 0.15,    // Cap at 15%
  cooldownMinutes: 3,            // Min time between spontaneous actions
  selfieCooldownHours: 24,       // Min time between spontaneous selfies
};
```

## Troubleshooting

### Spontaneity Not Showing Up

1. Check if `spontaneityOptions` was passed to `getSoulLayerContextAsync()`
2. Verify `spontaneityProbability > 0` in context
3. Check console logs for integration errors
4. Confirm relationship tier allows spontaneity

### Too Much Spontaneity

1. Check cooldown settings in `types.ts`
2. Verify conversation state is being tracked
3. Consider adjusting base probabilities

### Selfies Not Generating

1. Confirm relationship tier is friend+
2. Check `selfieProbability` in context
3. Verify cooldown (24 hours between selfies)
4. Check if pending shares database is populated

## Implementation Status

All core components have been implemented:

- [x] Database tables (see `supabase/migrations/create_spontaneity_tables.sql`)
- [x] Spontaneity tracker and probability calculations
- [x] Association engine for topic matching
- [x] Session reflection system (`sessionReflection.ts`)
- [x] Idle thought generation (`idleThoughts.ts`)
- [x] Visual state mapper (`visualStateMapper.ts`)
- [x] Integration with soul layer context

**Future Enhancements:**
1. UI for pending shares management
2. Admin dashboard for spontaneity tuning
3. Analytics on spontaneity engagement rates
