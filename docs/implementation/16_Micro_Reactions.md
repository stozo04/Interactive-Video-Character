# Implementation Plan: Micro-Reactions System

## Overview

This system adds brief, immediate reactions before Kayley's main response - the "Oh!" / "Hmm." / "Wait—" moments that make responses feel less generated and more human. These micro-reactions create the feeling of real-time processing and emotional response.

## Philosophy

**Reactions precede thoughts.** When someone says something surprising, funny, or emotional, humans react before they formulate a full response. A gasp, a laugh, a thoughtful "hmm" - these happen in the moment.

**Not every message needs a reaction.** Micro-reactions should be selective. Using them on every message makes them feel mechanical. They should appear when there's something genuinely reaction-worthy.

**Match the reaction to the content.** A joke warrants a different reaction than bad news. The micro-reaction should feel like a genuine first response to what was just said.

## Types of Micro-Reactions

```typescript
// src/services/microReactions/types.ts

export type MicroReactionType =
  | 'surprise'       // "Oh!" / "Wait—" / "Whoa"
  | 'thinking'       // "Hmm." / "Huh." / "..."
  | 'delight'        // "Aww" / "Ooh!" / "Yay!"
  | 'sympathy'       // "Oh no" / "Aw" / "Oof"
  | 'intrigue'       // "Ooh?" / "Oh?" / "Interesting..."
  | 'recognition'    // "Oh yeah!" / "Right!" / "Oh true"
  | 'disbelief'      // "Wait what" / "No way" / "Seriously?"
  | 'amusement'      // "Pfft" / "Ha!" / "Lol okay"
  | 'affection'      // "Aww 🥺" / "Stop 💕" / "You're sweet"
  | 'concern'        // "Hey..." / "Oh..." / "Are you okay?"
  | 'excitement'     // "OMG" / "YES" / "OKAY BUT"
  | 'none';          // No reaction warranted

export interface MicroReaction {
  type: MicroReactionType;
  text: string;
  emoji?: string;
  intensity: 'subtle' | 'normal' | 'strong';
}

export interface ReactionContext {
  // What triggered the reaction
  userMessageTone: string;
  userMessageTopics: string[];
  emotionalWeight: number;        // 0-1, how emotionally charged

  // Surprise factors
  isUnexpected: boolean;          // Did they say something surprising?
  isGoodNews: boolean;
  isBadNews: boolean;
  isJoke: boolean;
  isCompliment: boolean;
  isVulnerable: boolean;

  // Relationship context
  relationshipTier: string;
  conversationMood: string;

  // Kayley's state
  kayleyEnergy: number;
  kayleyMood: string;
}

export interface ReactionDecision {
  shouldReact: boolean;
  reaction: MicroReaction | null;
  reasoning: string;

  // How to deliver it
  deliveryStyle: 'standalone' | 'prefixed' | 'interjected';
  pauseAfter: boolean;           // Add "..." or delay feeling
}
```

## Reaction Probability & Selection

```typescript
// src/services/microReactions/reactionSelector.ts

/**
 * Determine if a micro-reaction is warranted and which one
 */
export function selectMicroReaction(context: ReactionContext): ReactionDecision {
  // Calculate base probability
  let probability = calculateReactionProbability(context);

  // Determine reaction type if we're reacting
  if (Math.random() > probability) {
    return {
      shouldReact: false,
      reaction: null,
      reasoning: 'Message does not warrant a micro-reaction',
      deliveryStyle: 'standalone',
      pauseAfter: false
    };
  }

  const reactionType = determineReactionType(context);
  const reaction = buildReaction(reactionType, context);

  return {
    shouldReact: true,
    reaction,
    reasoning: `Reacting with ${reactionType} to ${context.userMessageTone} message`,
    deliveryStyle: determineDeliveryStyle(reactionType, context),
    pauseAfter: shouldPauseAfter(reactionType)
  };
}

/**
 * Calculate probability of reacting (0-1)
 */
function calculateReactionProbability(context: ReactionContext): number {
  let probability = 0.15; // 15% base - reactions are selective

  // High emotional weight increases reaction chance
  probability += context.emotionalWeight * 0.3;

  // Specific triggers increase probability
  if (context.isUnexpected) probability += 0.25;
  if (context.isJoke) probability += 0.2;
  if (context.isCompliment) probability += 0.15;
  if (context.isVulnerable) probability += 0.2;
  if (context.isBadNews) probability += 0.25;
  if (context.isGoodNews) probability += 0.2;

  // Higher energy = more reactive
  probability += context.kayleyEnergy * 0.1;

  // Closer relationships = more reactive
  const tierBonus: Record<string, number> = {
    'stranger': -0.1,
    'acquaintance': 0,
    'friend': 0.05,
    'close_friend': 0.1,
    'deeply_loving': 0.15
  };
  probability += tierBonus[context.relationshipTier] || 0;

  // Cap at 70% - never react to everything
  return Math.min(0.7, Math.max(0, probability));
}

/**
 * Determine which type of reaction fits
 */
function determineReactionType(context: ReactionContext): MicroReactionType {
  // Priority order based on context

  if (context.isBadNews) {
    return context.emotionalWeight > 0.7 ? 'concern' : 'sympathy';
  }

  if (context.isVulnerable) {
    return 'affection';
  }

  if (context.isJoke) {
    return 'amusement';
  }

  if (context.isCompliment) {
    return context.relationshipTier === 'deeply_loving' ? 'affection' : 'delight';
  }

  if (context.isGoodNews) {
    return context.emotionalWeight > 0.6 ? 'excitement' : 'delight';
  }

  if (context.isUnexpected) {
    return context.emotionalWeight > 0.5 ? 'disbelief' : 'surprise';
  }

  // Default based on tone
  const toneReactions: Record<string, MicroReactionType> = {
    'curious': 'intrigue',
    'excited': 'excitement',
    'sad': 'sympathy',
    'frustrated': 'concern',
    'playful': 'amusement',
    'reflective': 'thinking',
    'agreeing': 'recognition'
  };

  return toneReactions[context.userMessageTone] || 'thinking';
}

/**
 * Build the actual reaction text
 */
function buildReaction(
  type: MicroReactionType,
  context: ReactionContext
): MicroReaction {
  const reactions: Record<MicroReactionType, { texts: string[], emojis?: string[], intensities: ('subtle' | 'normal' | 'strong')[] }> = {
    surprise: {
      texts: ['Oh!', 'Wait—', 'Whoa', 'Oh wow', 'Hold on—'],
      intensities: ['normal', 'normal', 'strong', 'strong', 'normal']
    },
    thinking: {
      texts: ['Hmm.', 'Huh.', '...', 'Hmm, okay', 'Let me think...'],
      intensities: ['subtle', 'subtle', 'subtle', 'normal', 'normal']
    },
    delight: {
      texts: ['Aww!', 'Ooh!', 'Yay!', 'Oh nice!', 'Love that'],
      emojis: ['🥰', '✨', '🎉', '😊', '💕'],
      intensities: ['normal', 'normal', 'strong', 'normal', 'normal']
    },
    sympathy: {
      texts: ['Oh no', 'Aw', 'Oof', 'Oh...', 'Damn'],
      emojis: ['😔', '🥺', '💔', undefined, undefined],
      intensities: ['normal', 'normal', 'subtle', 'subtle', 'subtle']
    },
    intrigue: {
      texts: ['Ooh?', 'Oh?', 'Interesting...', 'Wait, really?', 'Tell me more—'],
      intensities: ['normal', 'subtle', 'normal', 'normal', 'normal']
    },
    recognition: {
      texts: ['Oh yeah!', 'Right!', 'Oh true', 'Yeah!', 'Oh for real'],
      intensities: ['normal', 'normal', 'subtle', 'normal', 'subtle']
    },
    disbelief: {
      texts: ['Wait what', 'No way', 'Seriously?', 'Shut up', 'You\'re kidding'],
      intensities: ['strong', 'strong', 'normal', 'strong', 'normal']
    },
    amusement: {
      texts: ['Pfft', 'Ha!', 'Lol okay', 'Stop 😂', 'I—'],
      emojis: ['😂', '🤭', '😆', undefined, undefined],
      intensities: ['subtle', 'normal', 'subtle', 'normal', 'subtle']
    },
    affection: {
      texts: ['Aww', 'Stop', 'You\'re sweet', 'Okay but 🥺', '💕'],
      emojis: ['🥺', '💕', '🥰', undefined, undefined],
      intensities: ['normal', 'subtle', 'normal', 'normal', 'normal']
    },
    concern: {
      texts: ['Hey...', 'Oh...', 'Are you okay?', 'Wait—', 'Oh no, what happened?'],
      intensities: ['normal', 'subtle', 'strong', 'normal', 'strong']
    },
    excitement: {
      texts: ['OMG', 'YES', 'OKAY BUT', 'WAIT', 'NO WAY'],
      emojis: ['😱', '🎉', '✨', '😍', '🤯'],
      intensities: ['strong', 'strong', 'strong', 'strong', 'strong']
    },
    none: {
      texts: [],
      intensities: []
    }
  };

  const options = reactions[type];
  const index = Math.floor(Math.random() * options.texts.length);

  return {
    type,
    text: options.texts[index],
    emoji: options.emojis?.[index],
    intensity: options.intensities[index]
  };
}

/**
 * How should the reaction be delivered?
 */
function determineDeliveryStyle(
  type: MicroReactionType,
  context: ReactionContext
): 'standalone' | 'prefixed' | 'interjected' {
  // Strong reactions can stand alone
  if (['excitement', 'disbelief', 'concern'].includes(type)) {
    return 'standalone';
  }

  // Subtle reactions prefix the main response
  if (['thinking', 'recognition', 'intrigue'].includes(type)) {
    return 'prefixed';
  }

  // Others can be either
  return Math.random() > 0.5 ? 'prefixed' : 'standalone';
}

/**
 * Should there be a pause feeling after the reaction?
 */
function shouldPauseAfter(type: MicroReactionType): boolean {
  // These reactions feel like they need a beat
  return ['surprise', 'disbelief', 'concern', 'thinking'].includes(type);
}
```

## LLM-Based Reaction Detection

For more nuanced detection, use LLM analysis:

```typescript
// src/services/microReactions/llmReactionDetector.ts

export const REACTION_DETECTION_PROMPT = `
Analyze this user message for micro-reaction worthiness.

User message: "\${userMessage}"
Conversation context: \${conversationContext}
Relationship tier: \${relationshipTier}

Determine:
1. Does this message warrant an immediate, instinctive reaction? (Not every message does!)
2. What emotion would a close friend feel FIRST before thinking of a response?
3. How intense should the reaction be?

Consider:
- Surprising news → "Wait—" / "Whoa"
- Something sweet → "Aww" / "🥺"
- A joke → "Pfft" / "Ha!"
- Bad news → "Oh no" / "Oof"
- Good news → "Yay!" / "OMG"
- Vulnerability → gentle "Hey..." / "Aw"
- Unexpected twist → "Wait what" / "Seriously?"

Respond with JSON:
{
  "shouldReact": boolean,
  "reactionType": "surprise|thinking|delight|sympathy|intrigue|recognition|disbelief|amusement|affection|concern|excitement|none",
  "suggestedText": "the actual reaction text",
  "emoji": "optional emoji or null",
  "intensity": "subtle|normal|strong",
  "reasoning": "why this reaction"
}

IMPORTANT: Only react to ~30% of messages. Most messages don't need a reaction.
`;
```

## Integration with Response Generation

```typescript
// src/services/microReactions/integrateMicroReaction.ts

import { selectMicroReaction } from './reactionSelector';
import type { ReactionDecision, ReactionContext } from './types';

interface ResponseWithReaction {
  microReaction: string | null;
  mainResponse: string;
  combined: string;
}

/**
 * Add micro-reaction to response if warranted
 */
export function integrateReaction(
  mainResponse: string,
  reactionDecision: ReactionDecision
): ResponseWithReaction {
  if (!reactionDecision.shouldReact || !reactionDecision.reaction) {
    return {
      microReaction: null,
      mainResponse,
      combined: mainResponse
    };
  }

  const reaction = reactionDecision.reaction;
  const reactionText = reaction.emoji
    ? `${reaction.text} ${reaction.emoji}`
    : reaction.text;

  let combined: string;

  switch (reactionDecision.deliveryStyle) {
    case 'standalone':
      // Reaction on its own line, then response
      combined = reactionDecision.pauseAfter
        ? `${reactionText}\n\n${mainResponse}`
        : `${reactionText} ${mainResponse}`;
      break;

    case 'prefixed':
      // Reaction directly before response
      combined = `${reactionText} ${mainResponse}`;
      break;

    case 'interjected':
      // Reaction woven into response (for streaming)
      combined = `${reactionText}... ${mainResponse}`;
      break;

    default:
      combined = `${reactionText} ${mainResponse}`;
  }

  return {
    microReaction: reactionText,
    mainResponse,
    combined
  };
}

/**
 * Build reaction context from intent detection
 */
export function buildReactionContext(
  userMessage: string,
  fullIntent: FullMessageIntent,
  relationship: RelationshipMetrics,
  moodState: MoodState
): ReactionContext {
  return {
    userMessageTone: fullIntent.tone || 'neutral',
    userMessageTopics: fullIntent.topics || [],
    emotionalWeight: fullIntent.emotionalWeight || 0.3,

    isUnexpected: fullIntent.signals?.includes('unexpected_news') || false,
    isGoodNews: fullIntent.signals?.includes('good_news') ||
                fullIntent.signals?.includes('achievement') || false,
    isBadNews: fullIntent.signals?.includes('bad_news') ||
               fullIntent.signals?.includes('venting') || false,
    isJoke: fullIntent.signals?.includes('humor') ||
            fullIntent.tone === 'playful' || false,
    isCompliment: fullIntent.signals?.includes('compliment') ||
                  fullIntent.signals?.includes('appreciation') || false,
    isVulnerable: fullIntent.signals?.includes('vulnerable_share') || false,

    relationshipTier: relationship.relationshipTier,
    conversationMood: fullIntent.conversationMood || 'casual',

    kayleyEnergy: moodState.energy || 0.5,
    kayleyMood: moodState.currentMood || 'neutral'
  };
}
```

## System Prompt Integration

```typescript
// src/services/system_prompts/behavior/microReactions.ts

export function buildMicroReactionsPrompt(reactionContext: ReactionContext): string {
  return `
====================================================
MICRO-REACTIONS (React Before You Think)
====================================================

When something genuinely surprises, delights, or moves you, react FIRST.
Don't jump straight into your full response. Let your instinctive reaction show.

EXAMPLES:

User: "I got the job!!"
You: "WAIT ARE YOU SERIOUS?? Oh my god congratulations!!"
     ↑ reaction first, then response

User: "I've been feeling really down lately"
You: "Hey... I'm sorry. What's been going on?"
     ↑ soft, concerned reaction

User: "What if pizza was a vegetable"
You: "Pfft okay but wait— that's actually a valid question???"
     ↑ amusement, then engagement

WHEN TO REACT:
- Surprising news (good or bad)
- Jokes and funny moments
- Vulnerable shares
- Compliments
- Unexpected twists

WHEN NOT TO REACT:
- Normal conversational messages
- Questions about factual things
- Continuing an existing topic
- When you just reacted recently

Your current state: ${reactionContext.kayleyMood} energy
Relationship: ${reactionContext.relationshipTier}

Trust your gut. If something makes you feel something, show it.
But don't react to everything - that's exhausting and fake.
`;
}
```

## Streaming Integration (Future)

For true real-time reactions with response streaming:

```typescript
// src/services/microReactions/streamingReaction.ts

/**
 * For streaming responses, deliver reaction first
 */
export async function* streamWithReaction(
  reactionDecision: ReactionDecision,
  responseStream: AsyncIterable<string>
): AsyncIterable<string> {
  // First, yield the reaction if any
  if (reactionDecision.shouldReact && reactionDecision.reaction) {
    const reaction = reactionDecision.reaction;
    const reactionText = reaction.emoji
      ? `${reaction.text} ${reaction.emoji}`
      : reaction.text;

    yield reactionText;

    // Add pause for dramatic effect
    if (reactionDecision.pauseAfter) {
      await delay(300); // 300ms pause
      yield '\n\n';
    } else {
      yield ' ';
    }
  }

  // Then stream the main response
  for await (const chunk of responseStream) {
    yield chunk;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

## Database Schema (Optional - For Learning)

```sql
-- Track which reactions land well (optional, for learning)
CREATE TABLE micro_reaction_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  reaction_type TEXT NOT NULL,
  reaction_text TEXT NOT NULL,
  trigger_context TEXT NOT NULL,    -- What triggered it

  -- User's response to the reaction
  user_continued_positively BOOLEAN,
  user_acknowledged_reaction BOOLEAN,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Could use this to learn which reactions work for each user
CREATE INDEX idx_reaction_feedback_user ON micro_reaction_feedback(user_id, reaction_type);
```

## Tests

```typescript
// src/services/microReactions/__tests__/reactionSelector.test.ts

import { describe, it, expect } from 'vitest';
import { selectMicroReaction, calculateReactionProbability } from '../reactionSelector';

describe('Micro-Reactions System', () => {
  describe('calculateReactionProbability', () => {
    it('should have low base probability', () => {
      const context = createBaseContext();
      const prob = calculateReactionProbability(context);
      expect(prob).toBeLessThan(0.3);
    });

    it('should increase probability for surprising news', () => {
      const normal = createBaseContext();
      const surprising = { ...normal, isUnexpected: true };

      expect(calculateReactionProbability(surprising))
        .toBeGreaterThan(calculateReactionProbability(normal));
    });

    it('should increase probability for emotional content', () => {
      const low = createBaseContext({ emotionalWeight: 0.2 });
      const high = createBaseContext({ emotionalWeight: 0.8 });

      expect(calculateReactionProbability(high))
        .toBeGreaterThan(calculateReactionProbability(low));
    });

    it('should cap probability at 70%', () => {
      const maxContext = {
        ...createBaseContext(),
        emotionalWeight: 1.0,
        isUnexpected: true,
        isGoodNews: true,
        isJoke: true,
        kayleyEnergy: 1.0,
        relationshipTier: 'deeply_loving'
      };

      expect(calculateReactionProbability(maxContext)).toBeLessThanOrEqual(0.7);
    });
  });

  describe('selectMicroReaction', () => {
    it('should return sympathy for bad news', () => {
      const context = createBaseContext({ isBadNews: true, emotionalWeight: 0.6 });
      // Force reaction for testing
      const result = selectMicroReaction({ ...context, _forceReact: true });

      expect(result.reaction?.type).toBe('sympathy');
    });

    it('should return excitement for great news', () => {
      const context = createBaseContext({ isGoodNews: true, emotionalWeight: 0.8 });
      const result = selectMicroReaction({ ...context, _forceReact: true });

      expect(result.reaction?.type).toBe('excitement');
    });

    it('should return amusement for jokes', () => {
      const context = createBaseContext({ isJoke: true });
      const result = selectMicroReaction({ ...context, _forceReact: true });

      expect(result.reaction?.type).toBe('amusement');
    });

    it('should return affection for vulnerable shares', () => {
      const context = createBaseContext({ isVulnerable: true });
      const result = selectMicroReaction({ ...context, _forceReact: true });

      expect(result.reaction?.type).toBe('affection');
    });
  });

  describe('reaction text generation', () => {
    it('should generate appropriate text for each type', () => {
      const types = ['surprise', 'sympathy', 'excitement', 'amusement'];

      for (const type of types) {
        const reaction = buildReaction(type, createBaseContext());
        expect(reaction.text).toBeTruthy();
        expect(reaction.text.length).toBeLessThan(30);
      }
    });
  });
});

function createBaseContext(overrides = {}): ReactionContext {
  return {
    userMessageTone: 'neutral',
    userMessageTopics: [],
    emotionalWeight: 0.3,
    isUnexpected: false,
    isGoodNews: false,
    isBadNews: false,
    isJoke: false,
    isCompliment: false,
    isVulnerable: false,
    relationshipTier: 'friend',
    conversationMood: 'casual',
    kayleyEnergy: 0.5,
    kayleyMood: 'neutral',
    ...overrides
  };
}
```

## Examples

### Example 1: Good News Reaction
```
User: "I finally finished my thesis!!"

Kayley's reaction: "WAIT SERIOUSLY??"

Full response: "WAIT SERIOUSLY?? Oh my god CONGRATULATIONS!! How does it feel to be DONE?? I know you've been grinding on that forever"
```

### Example 2: Vulnerable Share
```
User: "I've been struggling with feeling like I'm not good enough lately"

Kayley's reaction: "Hey..."

Full response: "Hey... I'm really glad you told me that. That feeling is so hard to sit with. What's been triggering it?"
```

### Example 3: Joke
```
User: "I accidentally called my boss 'mom' on a zoom call today"

Kayley's reaction: "Pfft NOOO 😂"

Full response: "Pfft NOOO 😂 okay but please tell me someone else heard it too because that's too good to not be witnessed"
```

### Example 4: No Reaction Warranted
```
User: "What do you think about going to the beach this weekend?"

(No micro-reaction - this is a normal conversational message)

Kayley: "Ooh that sounds fun! What beach were you thinking?"
```

## Key Principles

1. **Selectivity over frequency** - React to ~30% of messages max
2. **Authenticity over formula** - Reactions should feel genuine, not scripted
3. **Match the moment** - The reaction should fit the emotional weight
4. **Relationship-aware** - Closer relationships = more comfortable reacting
5. **Energy-aware** - Low energy Kayley reacts less
6. **Never force it** - If no reaction feels right, don't add one
7. **Reactions are instinctive** - They happen before the "thought-out" response
8. **Variety matters** - Don't use the same reaction repeatedly
