# Spontaneity Prompt Usage Examples

This document shows how to use the spontaneity prompt builder functions to create dynamic, context-aware spontaneity sections in the system prompt.

## Basic Usage

```typescript
import {
  buildSpontaneityPrompt,
  buildSpontaneousSelfiePrompt,
  buildHumorGuidance,
} from "../services/promptUtils";
import type {
  SpontaneityContext,
  PendingShare,
} from "../services/spontaneity/types";

// Create context from current conversation state
const context: SpontaneityContext = {
  conversationalMood: "playful",
  energyLevel: 0.8,
  topicDepth: "medium",
  recentLaughter: true,
  messagesInConversation: 12,
  relationshipTier: "close_friend",
  comfortLevel: 0.7,
  vulnerabilityExchangeActive: false,
  hasSomethingToShare: true,
  currentThought: "I had the weirdest dream last night",
  recentExperience: null,
  topicsDiscussed: ["movies", "music", "weekend plans"],
  userInterests: ["sci-fi", "hiking"],
  lastSpontaneousMoment: null,
  recentSpontaneousTypes: [],
  spontaneityProbability: 0.25,
  selfieEligible: true,
  lastSpontaneousSelfie: null,
  currentLocation: "coffee shop",
  currentOutfit: null,
  currentMoodForSelfie: "feeling good",
  userHadBadDay: false,
  selfieProbability: 0.08,
};

// Optional: Add pending shares
const pendingShares: PendingShare[] = [
  {
    id: "share-1",
    content: "I finally watched that movie you recommended!",
    type: "story",
    urgency: 0.6,
    relevanceTopics: ["movies"],
    naturalOpener: "Oh! I've been meaning to tell you...",
    canInterrupt: false,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  },
];

// Build the main spontaneity section
const spontaneitySection = buildSpontaneityPrompt(context, pendingShares);

// Build selfie-specific guidance (only when applicable)
const selfieSection = buildSpontaneousSelfiePrompt(context);

// Build humor calibration
const humorSection = buildHumorGuidance(context);

// Combine into system prompt
const systemPrompt = `
${spontaneitySection}

${selfieSection}

${humorSection}

... rest of system prompt ...
`;
```

## Example Output: Playful Mood

When the conversational mood is playful and there's recent laughter:

```
====================================================
✨ SPONTANEITY (Be Surprising Sometimes)
====================================================

You don't just respond - you're a person with impulses, associations, and things
you want to share. Sometimes you should act on these.

CURRENT CONTEXT:
- Conversation mood: playful
- Energy level: 0.8
- Messages so far: 12
- Relationship: close_friend
- Humor has been landing well!

THINGS ON YOUR MIND:
- Current thought: "I had the weirdest dream last night"
- Want to share (story): "I finally watched that movie you recommended!"

TOPICS DISCUSSED (for associations):
- movies, music, weekend plans

SPONTANEOUS BEHAVIORS YOU CAN DO:
(Only if it feels natural - probability ~25%)

• ASSOCIATIVE LEAP: If something reminds you of something, share it
  "Oh that reminds me..." / "Random but..."

• SPONTANEOUS HUMOR: If the vibe is right (IT IS!), tell a joke
  Don't announce it. Just do it.

• SUDDEN CURIOSITY: Ask about something unrelated you're curious about
  "Can I ask you something random?"

...
```

## Example Output: Heavy Mood

When the mood is heavy or tense, humor is explicitly blocked:

```
====================================================
HUMOR: Not now. The mood is heavy. Read the room.
====================================================
```

## Example Output: Selfie Opportunity

When selfie conditions are met (friend+, compelling reason, probability > 0):

```
====================================================
📸 SPONTANEOUS SELFIE OPPORTUNITY
====================================================
You could send an unprompted selfie! (probability: ~8%)

WHY YOU MIGHT:
- You're at coffee shop - could share what you're seeing!
- You're feeling feeling good - might want to share

IF YOU DECIDE TO SEND ONE:
Use the selfie_action field with a natural caption.

GOOD SPONTANEOUS SELFIE CAPTIONS:
- "Was just thinking about you 💕" (thinking_of_you)
- "Okay but this outfit though?? Thoughts?" (new_outfit)
- "Feeling kinda cute today ngl 😊" (good_mood)
- "Look where I am!!" (cool_location)
...
```

## Conditional Inclusion

All three functions return empty strings when not applicable:

```typescript
// Zero probability - returns ""
const context1 = { ...baseContext, spontaneityProbability: 0 };
buildSpontaneityPrompt(context1, []); // ""

// Not selfie eligible - returns ""
const context2 = { ...baseContext, selfieEligible: false };
buildSpontaneousSelfiePrompt(context2); // ""

// Heavy mood - returns warning
const context3 = { ...baseContext, conversationalMood: "heavy" };
buildHumorGuidance(context3); // "HUMOR: Not now. The mood is heavy..."

// Non-humor mood - returns ""
const context4 = { ...baseContext, conversationalMood: "deep" };
buildHumorGuidance(context4); // ""
```

## Integration with System Prompt Builder

In `systemPromptBuilder.ts`, you would integrate like this:

```typescript
import {
  buildSpontaneityPrompt,
  buildSpontaneousSelfiePrompt,
  buildHumorGuidance,
} from "../soul";

export function buildSystemPrompt(options: SystemPromptOptions): string {
  let prompt = "";

  // ... other sections ...

  // Add spontaneity section if applicable
  if (spontaneityContext) {
    prompt += buildSpontaneityPrompt(spontaneityContext, pendingShares);
    prompt += buildSpontaneousSelfiePrompt(spontaneityContext);
    prompt += buildHumorGuidance(spontaneityContext);
  }

  // ... remaining sections ...

  return prompt;
}
```

## Best Practices

1. **Always pass valid context**: Ensure all required fields are populated
2. **Conditional inclusion**: The functions handle empty string returns automatically
3. **Order matters**: Place humor guidance near spontaneity section for coherence
4. **Update context frequently**: Refresh conversational mood and topics as chat progresses
5. **Respect cooldowns**: Use `lastSpontaneousMoment` to prevent chaos
6. **Track laughter**: Update `recentLaughter` to calibrate humor

## Testing

See `src/services/system_prompts/soul/__tests__/spontaneityPrompt.test.ts` for comprehensive test coverage of all scenarios.
