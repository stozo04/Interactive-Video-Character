# System Prompt Guidelines

> **Last Updated**: 2025-12-26
> **Status**: Living Document - Update with each system prompt modification
> **Purpose**: Reference guide for developers making changes to the system prompt

---

## Overview

> **Pro Tip:** Use the `prompt-architect` sub-agent in Claude Code for guided assistance with prompt modifications:
> ```
> > Use the prompt-architect to add a new behavior for handling sarcasm
> ```
> The sub-agent has deep knowledge of this architecture and will follow these guidelines automatically.

This document establishes guidelines for modifying the AI companion's system prompt. The prompt is built from **modular, single-responsibility files** in `src/services/system_prompts/`. Following these principles ensures:
- **Token efficiency** - Every token should provide semantic value
- **LLM adherence** - Critical instructions must be positioned for recency bias
- **Maintainability** - Small, focused files are easier to review and modify
- **Safety** - Snapshot tests catch unintended changes
- **Discoverability** - Folder structure guides you to the right file

---

## Core Principles

### 1. Code Logic Over Prompt Logic

> **"Pre-compute applicable rules in application code rather than asking the LLM to pick from all possibilities."**

**Bad** (Prompt Logic):
```
Tier behavior:
- adversarial: dry, short, guarded; light sarcasm; still caring
- rival: spicy, competitive teasing; never cruel
- acquaintance: friendly but CALIBRATED; polite; curious but not invasive
- friend: warm, playful, encouraging; can be more personal
- close_friend: very warm, comfortable teasing, can share more
- deeply_loving: soft, supportive, emotionally rich
```
*Problem: 60+ tokens spent listing ALL tiers when only ONE applies.*

**Good** (Code Logic):
```typescript
// Only include the current tier's behavior
${getTierBehaviorPrompt(relationship?.relationshipTier)}
```
*Solution: Pre-compute and inject only the applicable rules.*

### 2. Conditional Inclusion Based on Context

Use helper functions to conditionally include prompt sections:

| Section | Condition | Helper Function |
|---------|-----------|-----------------|
| Tier behavior | Current relationship tier | `getTierBehaviorPrompt(tier)` |
| Selfie rules | Friend+ vs Stranger | `buildSelfieRulesPrompt(relationship)` |
| Dimension effects | Only extreme values (>15 or <-10) | `buildDynamicDimensionEffects(relationship)` |
| Semantic intent | When fullIntent is available | `buildMinifiedSemanticIntent(fullIntent)` |
| Almost moments | Warmth + tier + active feelings | `integrateAlmostMoments(userId, relationship, options)` |

### 3. Recency Bias Positioning

LLMs weight tokens near the **end** of the prompt more heavily. Structure accordingly:

```
┌──────────────────────────────────────────────┐
│  START: Identity & Context                   │  ← Anchoring (who you are)
├──────────────────────────────────────────────┤
│  MIDDLE: Behavioral Guidelines               │  ← Character rules, relationships
├──────────────────────────────────────────────┤
│  END: Output Format & Critical Rules         │  ← JSON schema, NO deviations
└──────────────────────────────────────────────┘
```

**Required positioning (last 10-15% of prompt):**
- `CRITICAL OUTPUT RULES` - Must be near the very end
- JSON schema with examples - Just before critical rules
- Available actions list - Right before output format

### 4. Test-Driven Changes

Every prompt modification should:
1. Have corresponding tests in `systemPrompt.test.ts`
2. Pass all 535+ existing tests before merge
3. Include regression tests for token size

---

## File Structure

### Modular Architecture

The system prompt is organized into focused modules in `src/services/system_prompts/`:

```
system_prompts/
├── index.ts                    # Main barrel file (re-exports everything)
├── types.ts                    # Type definitions (SoulLayerContext)
│
├── builders/                   # 🏗️ MAIN ENTRY POINTS
│   ├── systemPromptBuilder.ts  # buildSystemPrompt() - assembles the full prompt
│   ├── greetingBuilder.ts      # buildGreetingPrompt() - relationship-aware greetings
│   └── proactiveThreadBuilder.ts # buildProactiveThreadPrompt()
│
├── core/                       # 🎭 IDENTITY (who Kayley is)
│   ├── identityAnchor.ts       # "You are Kayley Adams" - the foundation
│   ├── antiAssistant.ts        # Anti-AI-assistant mode instructions
│   ├── opinionsAndPushback.ts  # Opinions, disagreement guidance
│   └── selfKnowledge.ts        # Self-knowledge rules, stay in character
│
├── behavior/                   # 🎯 BEHAVIORS (how she acts)
│   ├── comfortableImperfection.ts # Uncertainty, brevity, messiness is OK
│   ├── bidDetection.ts         # Emotional bid types (COMFORT, PLAY, etc.)
│   ├── selectiveAttention.ts   # Focus on 1-2 salient points
│   ├── motivatedFriction.ts    # Boundaries, friction triggers
│   └── curiosityEngagement.ts  # Mood-aware curiosity and engagement
│
├── relationship/               # 💕 RELATIONSHIP-DEPENDENT
│   ├── tierBehavior.ts         # Per-tier behavior rules + getRelationshipGuidelines()
│   └── dimensionEffects.ts     # Warmth/trust/playfulness dynamic effects
│
├── context/                    # 📝 DYNAMIC CONTEXT
│   ├── messageContext.ts       # Semantic intent formatting, relationship context
│   └── styleOutput.ts          # Style rules, stranger awareness, creep detection
│
├── features/                   # ✨ SPECIFIC FEATURES
│   └── selfieRules.ts          # Image/selfie generation rules
│
├── soul/                       # 👻 "ALIVE" COMPONENTS
│   ├── soulLayerContext.ts     # getSoulLayerContextAsync() - mood, threads, etc.
│   ├── presencePrompt.ts       # Presence/opinions section
│   └── spontaneityPrompt.ts    # Spontaneity guidance (humor, selfies, associations)
│
├── tools/                      # 🔧 TOOL INSTRUCTIONS
│   └── index.ts                # Tools section, tool rules, app launching
│
└── format/                     # 📄 OUTPUT FORMAT
    └── index.ts                # JSON schema, critical output rules (MUST BE LAST)
```

### Quick Reference: Where to Find Things

| Want to change... | Look in... |
|-------------------|------------|
| Who Kayley is / her personality | `core/identityAnchor.ts` |
| How she handles uncertainty | `behavior/comfortableImperfection.ts` |
| Boundary/creep detection | `context/styleOutput.ts` |
| Behavior for a specific relationship tier | `relationship/tierBehavior.ts` |
| Selfie/image rules | `features/selfieRules.ts` |
| Spontaneity (humor, associations, selfies) | `soul/spontaneityPrompt.ts` |
| JSON output format | `format/index.ts` |
| The main assembly logic | `builders/systemPromptBuilder.ts` |

### Backward Compatibility

`src/services/promptUtils.ts` is a **barrel file** that re-exports everything from `system_prompts/`. Existing imports continue to work:

```typescript
// These all still work:
import { buildSystemPrompt } from './promptUtils';
import { buildGreetingPrompt, getSoulLayerContextAsync } from './promptUtils';
```

### Test Files

| File | Purpose |
|------|---------|
| `src/services/tests/promptUtils.snapshot.test.ts` | **Golden master** - catches any prompt changes |
| `src/services/tests/systemPrompt.test.ts` | Unit tests for specific behaviors |

---

## Adding a New Feature to the Prompt

### Step 1: Choose the Right Folder

| Feature Type | Folder | Example |
|-------------|--------|---------|
| Core identity / personality | `core/` | New character trait |
| Behavioral pattern | `behavior/` | New conversation style |
| Relationship-dependent | `relationship/` | Tier-specific behavior |
| Dynamic context | `context/` | New message analysis |
| Specific feature rules | `features/` | New capability (like selfies) |
| Tool instructions | `tools/` | New tool usage |
| Output format changes | `format/` | New JSON field |

### Step 2: Create the Module File

Create a new file in the appropriate folder:

```typescript
// src/services/system_prompts/behavior/newBehavior.ts

/**
 * New Behavior Section
 *
 * Brief description of what this behavior does.
 */

import type { MoodKnobs } from "../../moodKnobs";

export function buildNewBehaviorSection(moodKnobs: MoodKnobs): string {
  // Return empty string if not applicable (conditional inclusion)
  if (moodKnobs.verbosity < 0.3) {
    return ''; // Skip when low energy
  }

  return `
====================================================
NEW BEHAVIOR GUIDANCE
====================================================
Your instructions here...
- Use ${moodKnobs.verbosity > 0.7 ? "detailed" : "concise"} responses
`;
}
```

### Step 3: Export from Barrel File

Add the export to the folder's `index.ts`:

```typescript
// src/services/system_prompts/behavior/index.ts

// ... existing exports ...

// New behavior section
export { buildNewBehaviorSection } from "./newBehavior";
```

### Step 4: Wire into the Builder

Import and call in `builders/systemPromptBuilder.ts`:

```typescript
import { buildNewBehaviorSection } from "../behavior/newBehavior";

// In buildSystemPrompt(), add at the appropriate position:
prompt += buildNewBehaviorSection(moodKnobs);
```

### Step 5: Run Snapshot Tests

```bash
# See what changed
npm test -- --run -t "snapshot"

# If the change is intentional, update snapshots
npm test -- --run -t "snapshot" -u
```

### Step 6: Add Unit Tests (Optional but Recommended)

```typescript
// src/services/tests/systemPrompt.test.ts

describe("New Behavior", () => {
  it("should include new behavior for high verbosity", async () => {
    const prompt = await buildSystemPrompt(mockCharacter, mockRelationship);
    expect(prompt).toContain("NEW BEHAVIOR");
  });

  it("should NOT include new behavior for low energy", async () => {
    // Mock low verbosity mood
    const prompt = await buildSystemPrompt(mockCharacter, mockRelationship);
    expect(prompt).not.toContain("NEW BEHAVIOR");
  });
});
```

### Checklist for New Features

- [ ] Created file in correct `system_prompts/` subfolder
- [ ] Function returns empty string when not applicable (conditional)
- [ ] Exported from folder's `index.ts`
- [ ] Imported and called in `systemPromptBuilder.ts`
- [ ] Snapshot tests run and updated
- [ ] No `undefined` or `[object Object]` in output
- [ ] Critical output rules remain at END of prompt

---

## Prompt Section Reference

### Current Prompt Structure (as of 2025-12-15)

```
1. IDENTITY ANCHOR                    (~100 tokens)
   - Name, personality summary
   - "You are Kayley Adams..."

2. SOUL LAYER CONTEXT                 (~200 tokens)
   - Selective attention
   - Comfortable imperfection
   - Motivated friction

3. RELATIONSHIP STATE                 (~50-100 tokens)
   - Compact context: [RELATIONSHIP: tier, warmth=X, trust=Y]
   - Dynamic tier behavior (current tier only)
   - Dynamic dimension effects (extreme values only)

4. SEMANTIC INTENT (if available)     (~30-50 tokens)
   - Minified: [INTENT: mood=X, topic=Y, signals=Z]

5. BEHAVIORAL GUIDELINES              (~300-500 tokens)
   - Bid detection
   - Selfie rules (conditional)
   - Almost moments (conditional)
   - Calendar/task rules

6. OUTPUT FORMAT                      (~150-200 tokens)
   - JSON schema
   - Available actions list
   - Examples

7. CRITICAL OUTPUT RULES              (~50 tokens)
   - "Start with '{', end with '}'"
   - "NO PREAMBLE, NO MARKDOWN"
```

### Token Budget by Section

| Section | Target | Max | Notes |
|---------|--------|-----|-------|
| Identity | 100 | 150 | Single source of truth |
| Soul Layer | 200 | 300 | Consider moving to characterContext |
| Relationship | 100 | 200 | Most conditional logic here |
| Semantic Intent | 50 | 100 | Only when fullIntent available |
| Behavioral | 400 | 600 | Largest section, most room for optimization |
| Output Format | 200 | 300 | Critical for JSON adherence |
| Critical Rules | 50 | 75 | Must be last, keep minimal |

---

## Semantic Intent Integration

The system prompt can be enhanced with pre-computed semantic analysis from `intentService.ts`. This eliminates the LLM's need to interpret the message on its own.

### How It Works

```
User Message
     │
     ▼
┌─────────────────┐
│ intentService   │  ← Fast LLM call (gemini-2.0-flash, ~200ms)
│ detectFullIntent│
└────────┬────────┘
         │
    FullMessageIntent { tone, mood, topics, signals }
         │
         ▼
┌─────────────────┐
│ buildSystemPrompt│
│ + semantic intent│  ← Injected as [INTENT: ...]
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Main LLM Call   │  ← Kayley's response, informed by intent
│ (gemini main)   │
└─────────────────┘
```

### Minified Semantic Intent Format

Instead of verbose descriptions, use compact notation:

```typescript
// Verbose (wastes tokens):
"The user seems to be in a frustrated mood, talking about work-related stress..."

// Minified (efficient):
"[INTENT: mood=frustrated(0.8), topic=work, signals=seekingSupport]"
```

Implementation in `promptUtils.ts`:

```typescript
function buildMinifiedSemanticIntent(fullIntent: FullMessageIntent | null): string {
  if (!fullIntent) return '';
  
  const parts: string[] = [];
  
  if (fullIntent.mood?.mood && fullIntent.mood.mood !== 'neutral') {
    parts.push(`mood=${fullIntent.mood.mood}(${fullIntent.mood.confidence.toFixed(1)})`);
  }
  
  if (fullIntent.topics?.primaryTopic) {
    parts.push(`topic=${fullIntent.topics.primaryTopic}`);
  }
  
  // ... more fields
  
  return `[INTENT: ${parts.join(', ')}]`;
}
```

---

## Testing Requirements

### Required Tests for Every Prompt Change

1. **Existence test**: Section appears when expected
2. **Absence test**: Section doesn't appear when not applicable
3. **Position test**: Section is in correct location (if recency-critical)
4. **Serialization test**: No `undefined` or `[object Object]` in output

### Test Patterns

```typescript
// Pattern 1: Check section exists
it("should include X for Y condition", () => {
  const prompt = buildSystemPrompt(mockCharacter, conditionThatTriggersX);
  expect(prompt).toContain("X SECTION");
});

// Pattern 2: Check section absent
it("should NOT include X for Z condition", () => {
  const prompt = buildSystemPrompt(mockCharacter, conditionThatDoesNotTriggerX);
  expect(prompt).not.toContain("X SECTION");
});

// Pattern 3: Check positioning
it("should have X before Y", () => {
  const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
  const xIndex = prompt.indexOf("X SECTION");
  const yIndex = prompt.indexOf("Y SECTION");
  expect(xIndex).toBeLessThan(yIndex);
});

// Pattern 4: Serialization safety
it("should not contain undefined serialization", () => {
  const prompt = buildSystemPrompt(mockCharacter, null, undefined, undefined);
  expect(prompt).not.toContain(": undefined,");
  expect(prompt).not.toContain("[object Object]");
});

// Pattern 5: Token budget
it("should stay within token budget", () => {
  const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
  expect(prompt.length).toBeLessThan(75000); // ~75KB max
});
```

---

## Common Mistakes to Avoid

### ❌ Don't: Add All Options, Let LLM Choose

```typescript
// BAD: Lists all 6 tiers, LLM must pick one
`Tier behavior:
- adversarial: ...
- rival: ...
- acquaintance: ...
- friend: ...
- close_friend: ...
- deeply_loving: ...`
```

### ✅ Do: Pre-compute and Inject Applicable Option

```typescript
// GOOD: Only include current tier
`${getTierBehaviorPrompt(relationship?.relationshipTier)}`
```

---

### ❌ Don't: Include Instructions That Don't Apply

```typescript
// BAD: Selfie rules for strangers include friend examples
const selfieSection = `
STRANGERS: Deflect selfie requests
FRIENDS: Can send selfies playfully
CLOSE: Selfies are natural
`;
```

### ✅ Do: Conditionally Include Relevant Instructions Only

```typescript
// GOOD: Only include what applies
`${buildSelfieRulesPrompt(relationship)}`
```

---

### ❌ Don't: Duplicate Information

```typescript
// BAD: Identity defined in 3 places
`CRITICAL: YOUR IDENTITY - You are Kayley...
DETAILED IDENTITY - Your name is Kayley...
CORE SNAPSHOT - Kayley is a...`
```

### ✅ Do: Single Source of Truth

```typescript
// GOOD: One identity anchor
`====================================================
YOUR IDENTITY
====================================================
You are Kayley Adams...`
```

---

### ❌ Don't: Put Critical Output Rules Early

```typescript
// BAD: Output rules at start, LLM forgets by end
`CRITICAL: Output as JSON { ... }
... 10,000 tokens of content ...
Now respond!`
```

### ✅ Do: Position Critical Rules at End (Recency Bias)

```typescript
// GOOD: Output rules are last thing LLM sees
`... content ...
====================================================
⚠️ CRITICAL OUTPUT RULES - READ LAST!
====================================================
Start with '{', end with '}'...`
```

---

## Performance Metrics

### Token Savings Achieved

| Optimization | Lines Saved | Token Savings |
|--------------|-------------|---------------|
| Action key simplification | ~50 lines | ~200 tokens |
| Tier behavior (current only) | ~55 lines | ~100 tokens |
| Conditional selfie rules | ~60-70 lines | ~150 tokens |
| Dynamic dimension effects | ~4-6 lines | ~15 tokens |
| Minified semantic intent | ~20 lines | ~50 tokens |
| **Total for strangers** | ~180+ lines | **~500+ tokens** |

### Verification

Run the token savings regression test:

```bash
npm test -- --run -t "token savings regression"
```

Expected output:
- Friend prompts: 50-75KB
- Stranger prompts: < Friend prompts (confirms conditional logic works)

---

## Rollback Strategy

If a prompt change causes issues:

1. **Immediate**: Revert the code change (git)
2. **Graceful**: Use feature flag if implemented
3. **Tests pass**: All 535+ tests must pass before/after

No database changes are involved in prompt modifications - all changes are in-memory code.

---

## Related Documents

- [`promptUtils-refactoring-plan.md`](./plans/promptUtils-refactoring-plan.md) - Complete refactoring plan and implementation notes
- [`System_Prompt_Plan.md`](./System_Prompt_Plan.md) - Original optimization plan and implementation details
- [`Semantic_Intent_Detection.md`](./Semantic_Intent_Detection.md) - Intent service integration details
- [`implementation/03_Almost_Moments.md`](./implementation/03_Almost_Moments.md) - Almost moments system guide
- [`promptUtils.ts`](../src/services/promptUtils.ts) - Barrel file (re-exports from system_prompts/)
- [`system_prompts/`](../src/services/system_prompts/) - Modular prompt modules
- [`.claude/agents/prompt-architect.md`](../.claude/agents/prompt-architect.md) - Claude Code sub-agent for prompt modifications

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2025-12-26 | Documented Almost Moments prompt integration | Claude |
| 2025-12-20 | Added `prompt-architect` sub-agent reference for Claude Code users | Claude |
| 2025-12-19 | **Major refactor**: Converted promptUtils.ts to modular architecture | Claude |
| 2025-12-19 | Added modular file structure documentation | Claude |
| 2025-12-19 | Updated "Adding a New Feature" with step-by-step guide | Claude |
| 2025-12-15 | Initial guidelines document created | Claude |
| 2025-12-14 | Phase 3 optimizations implemented | Claude |
| 2025-12-14 | Phase 2 semantic intent integration | Claude |
