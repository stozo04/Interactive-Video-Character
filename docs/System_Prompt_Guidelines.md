# System Prompt Guidelines

> **Last Updated**: 2025-12-15  
> **Status**: Living Document - Update with each system prompt modification  
> **Purpose**: Reference guide for developers making changes to the system prompt

---

## Overview

This document establishes guidelines for modifying the AI companion's system prompt (`promptUtils.ts`). Following these principles ensures:
- **Token efficiency** - Every token should provide semantic value
- **LLM adherence** - Critical instructions must be positioned for recency bias
- **Maintainability** - Changes should be testable and reversible
- **Safety** - Fallbacks prevent silent failures

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

### Primary Files

| File | Purpose | When to Modify |
|------|---------|----------------|
| `src/services/promptUtils.ts` | System prompt generation | Adding/removing prompt sections |
| `src/services/tests/systemPrompt.test.ts` | Prompt unit tests | Every prompt change |

### Helper Functions

Located in `promptUtils.ts`, these functions encapsulate conditional logic:

```typescript
// Phase 3 helpers - conditional inclusion based on relationship
getTierBehaviorPrompt(tier: string): string
getSelfieRulesConfig(relationship): { shouldIncludeFull, shouldIncludeDeflection }
buildSelfieRulesPrompt(relationship): string
buildDynamicDimensionEffects(relationship): string

// Phase 2 helpers - semantic context
getSemanticBucket(score: number): string
buildCompactRelationshipContext(relationship): string
buildMinifiedSemanticIntent(fullIntent): string
```

---

## Adding a New Feature to the Prompt

### Step 1: Identify the Section Type

| Type | Example | Token Budget | Position |
|------|---------|--------------|----------|
| **Context injection** | Relationship state, semantic intent | 50-100 tokens | First 30% |
| **Behavioral guidance** | Selfie rules, tier behavior | 100-200 tokens | Middle 50% |
| **Output schema** | New JSON field | 20-50 tokens | Last 20% |

### Step 2: Consider Conditional Inclusion

Ask: "Does this apply to ALL relationships, or only some?"

- **Universal** (always included): Add directly to prompt template
- **Conditional** (varies by state): Create a helper function

```typescript
// Example: New feature that only applies to close relationships
export function buildNewFeaturePrompt(relationship: RelationshipMetrics | null): string {
  if (!relationship || !['close_friend', 'deeply_loving'].includes(relationship.relationshipTier)) {
    return ''; // Don't include for strangers/friends
  }
  
  return `
====================================================
NEW FEATURE GUIDANCE
====================================================
[Your feature instructions here]
`;
}
```

### Step 3: Write Tests First (TDD)

Add tests BEFORE implementing:

```typescript
describe("New Feature", () => {
  it("should include new feature for close relationships", () => {
    const prompt = buildSystemPrompt(mockCharacter, closeRelationship);
    expect(prompt).toContain("NEW FEATURE");
  });

  it("should NOT include new feature for strangers", () => {
    const prompt = buildSystemPrompt(mockCharacter, strangerRelationship);
    expect(prompt).not.toContain("NEW FEATURE");
  });
});
```

### Step 4: Add the Feature

1. Create helper function if conditional
2. Wire into `buildSystemPrompt()` at the correct position
3. Run tests: `npm test -- --run`
4. Verify prompt size hasn't increased excessively

### Step 5: Document the Change

Update this guidelines document if the change establishes a new pattern.

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

- [`System_Prompt_Plan.md`](./System_Prompt_Plan.md) - Original optimization plan and implementation details
- [`Semantic_Intent_Detection.md`](./Semantic_Intent_Detection.md) - Intent service integration details
- [`promptUtils.ts`](../src/services/promptUtils.ts) - Source file for system prompt generation

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2025-12-15 | Initial guidelines document created | Claude |
| 2025-12-14 | Phase 3 optimizations implemented | Claude |
| 2025-12-14 | Phase 2 semantic intent integration | Claude |
