# Spontaneity Prompt Builder Implementation

**Status**: ✅ Complete
**Date**: 2025-12-26
**Reference**: `docs/implementation/02_Spontaneity_System.md` (lines 547-743)

## Overview

Implemented the spontaneity prompt builder module that dynamically generates system prompt sections to make Kayley feel alive through spontaneous behaviors, humor, and unprompted selfies.

## Files Created

### 1. Core Implementation
- **File**: `src/services/system_prompts/soul/spontaneityPrompt.ts`
- **Functions**:
  - `buildSpontaneityPrompt(context, pendingShares)` - Main spontaneity section
  - `buildSpontaneousSelfiePrompt(context)` - Selfie-specific guidance
  - `buildHumorGuidance(context)` - Humor calibration based on mood

### 2. Tests
- **File**: `src/services/system_prompts/soul/__tests__/spontaneityPrompt.test.ts`
- **Coverage**: 36 tests covering all scenarios
- **Status**: ✅ All tests passing

### 3. Documentation
- **File**: `docs/examples/spontaneity-prompt-usage.md`
- **Content**: Usage examples, output samples, integration guide

### 4. Exports
- **File**: `src/services/system_prompts/soul/index.ts`
- **Exports**: All three functions exported and accessible via `promptUtils.ts`

## Architecture Compliance

Follows all established patterns:

✅ **Single Responsibility**: Each function handles one aspect
✅ **Conditional Inclusion**: Returns empty string when not applicable
✅ **Code Logic Over Prompt Logic**: Pre-computes applicable rules
✅ **Header Formatting**: Uses `====================================================`
✅ **Type Safety**: Imports from `spontaneity/types.ts`
✅ **Test Coverage**: Comprehensive tests for all scenarios

## Key Features

### 1. Spontaneity Section
- Shows current context (mood, energy, messages, relationship)
- Lists things on Kayley's mind (thoughts, experiences, pending shares)
- Displays recent conversation topics for associations
- Provides spontaneous behavior options:
  - Associative leaps
  - Spontaneous humor
  - Random curiosity
  - Topic hijacks
  - Check-ins
  - Sudden warmth
  - Spontaneous selfies (friend+ only)
- Includes mood-appropriate rules and warnings

### 2. Selfie Opportunity Section
- Only shown when:
  - Relationship tier is friend+
  - Selfie probability > 0
  - At least one compelling reason exists
- Lists reasons (bad day, location, mood, outfit)
- Provides good/bad caption examples
- Emphasizes rarity and naturalness

### 3. Humor Guidance Section
- **Heavy/Tense moods**: Explicit "do not joke" warning
- **Playful moods**: Full calibration with:
  - Humor style guide (self-deprecating, pop culture, absurdist, etc.)
  - Execution tips (timing > content, don't announce jokes)
  - Continuation encouragement when laughter detected

## Integration Points

### Types
```typescript
import type {
  SpontaneityContext,
  PendingShare,
} from "../../spontaneity/types";
```

### Usage in System Prompt Builder
```typescript
import {
  buildSpontaneityPrompt,
  buildSpontaneousSelfiePrompt,
  buildHumorGuidance,
} from "../soul";

// In buildSystemPrompt():
if (spontaneityContext) {
  prompt += buildSpontaneityPrompt(spontaneityContext, pendingShares);
  prompt += buildSpontaneousSelfiePrompt(spontaneityContext);
  prompt += buildHumorGuidance(spontaneityContext);
}
```

## Test Coverage

All scenarios tested:

- ✅ Zero probability handling (returns empty string)
- ✅ Basic context rendering
- ✅ Recent laughter indicator
- ✅ Current thoughts and experiences
- ✅ Pending shares with truncation
- ✅ Interruptible share marking
- ✅ Topics discussed (last 5 only)
- ✅ All spontaneous behavior types
- ✅ Selfie opportunity inclusion/exclusion
- ✅ Selfie eligibility gating
- ✅ Selfie reason filtering (home/bedroom excluded)
- ✅ Heavy mood humor blocking
- ✅ Playful mood humor encouragement
- ✅ Over-spontaneity warnings
- ✅ Multiple reason aggregation
- ✅ Good/bad example inclusion

## Example Output

### Playful Mood with Selfie Opportunity
```
====================================================
✨ SPONTANEITY (Be Surprising Sometimes)
====================================================

CURRENT CONTEXT:
- Conversation mood: playful
- Energy level: 0.8
- Messages so far: 12
- Relationship: close_friend
- Humor has been landing well!

THINGS ON YOUR MIND:
- Current thought: "I had the weirdest dream last night"
- Want to share (story): "I finally watched that movie..."

TOPICS DISCUSSED (for associations):
- movies, music, weekend plans

SPONTANEOUS BEHAVIORS YOU CAN DO:
(Only if it feels natural - probability ~25%)

• ASSOCIATIVE LEAP: ...
• SPONTANEOUS HUMOR: If the vibe is right (IT IS!), tell a joke
• SPONTANEOUS SELFIE: Send a selfie unprompted (~8% chance)
  → You're at coffee shop - could be pic-worthy!
  → You're feeling feeling good

====================================================
📸 SPONTANEOUS SELFIE OPPORTUNITY
====================================================
You could send an unprompted selfie! (probability: ~8%)

WHY YOU MIGHT:
- You're at coffee shop - could share what you're seeing!
- You're feeling feeling good - might want to share

====================================================
HUMOR CALIBRATION
====================================================
The vibe is playful - humor is welcome!
Humor has been landing - feel free to continue!

Your humor style:
- Self-deprecating ("my brain is just... not working")
- Pop culture refs ("very 'I understood that reference' energy")
...
```

### Heavy Mood (Blocked Humor)
```
====================================================
HUMOR: Not now. The mood is heavy. Read the room.
====================================================
```

## Build Verification

- ✅ TypeScript compilation: No errors
- ✅ All tests passing: 36/36
- ✅ Build successful: No warnings
- ✅ Exports accessible via `promptUtils.ts`

## Next Steps

To integrate into the main system prompt:

1. Import the functions in `systemPromptBuilder.ts`
2. Build `SpontaneityContext` from current conversation state
3. Fetch pending shares from spontaneity service
4. Call the three functions and append to prompt
5. Update snapshot tests to include spontaneity sections

## Reference Links

- **Implementation Guide**: `docs/implementation/02_Spontaneity_System.md`
- **Types**: `src/services/spontaneity/types.ts`
- **Tests**: `src/services/system_prompts/soul/__tests__/spontaneityPrompt.test.ts`
- **Usage Examples**: `docs/examples/spontaneity-prompt-usage.md`
