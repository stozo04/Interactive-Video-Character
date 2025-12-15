---
description: Implement Phase 2 of System Prompt Optimization - Structural Refactor
---

# Phase 2: System Prompt Structural Refactor

## Context

You are implementing Phase 2 of the System Prompt Optimization plan documented in `docs/System_Prompt_Plan.md`. Phase 1 (Quick Wins) is complete and includes:
- Action key simplification with fuzzy matching (`src/utils/actionKeyMapper.ts`)
- Negative JSON constraints in the prompt footer
- Helper functions ready for use: `getSemanticBucket()`, `buildMinifiedSemanticIntent()`, `buildCompactRelationshipContext()`

**Goal**: Reduce system prompt tokens by ~30% while improving LLM adherence to output format.

---

## Pre-Implementation Checklist

// turbo
1. Run existing tests to confirm baseline:
```bash
npm test -- --run src/services/tests/systemPrompt.test.ts src/services/tests/phase1Helpers.test.ts
```

2. View the current prompt structure:
```bash
grep -n "====" src/services/promptUtils.ts | head -40
```

3. Study the plan document:
   - Open `docs/System_Prompt_Plan.md` and review Phase 2 section
   - Note the recommended task order in "🔄 Recommended Phase 2 Task Order"

---

## Implementation Tasks (In Order)

### Task 1: Enable Minified Semantic Intent

**Objective**: Replace verbose semantic intent block with compact single-line format.

**Files to modify**:
- `src/services/promptUtils.ts`

**Steps**:
1. Locate where semantic intent is currently injected in `buildSystemPrompt()`
2. Find the `buildMinifiedSemanticIntent()` function (already exists, ~line 270-340)
3. Wire it into the prompt where appropriate
4. The compact format should look like: `[CONTEXT: Tone=happy(+0.7,HIGH), Topics={work}]`

**Verification**:
```bash
npm test -- --run src/services/tests/systemPrompt.test.ts
```

---

### Task 2: Enable Compact Relationship Context

**Objective**: Replace verbose relationship metrics with semantic bucket format.

**Files to modify**:
- `src/services/promptUtils.ts`

**Steps**:
1. Locate where relationship state is injected (search for "RELATIONSHIP STATE")
2. Find the `buildCompactRelationshipContext()` function (already exists)
3. Find the `getSemanticBucket()` function (converts scores to labels like "warm/open")
4. Replace numeric scores with semantic buckets
5. Target format: `[RELATIONSHIP: friend, warmth=warm/open, trust=neutral, stage=developing]`

**Verification**:
```bash
npm test -- --run src/services/tests/systemPrompt.test.ts
```

---

### Task 3: Reorder Prompt Sections (Highest Risk)

**Objective**: Put output format instructions at the END of the prompt (recency bias).

**Current Order** (approximate):
1. Identity/Persona
2. Relationship State
3. Context
4. Actions & JSON Format
5. Soul Layer (Selective Attention, Comfortable Imperfection, etc.)
6. Critical Output Rules

**Target Order**:
1. Identity/Persona
2. Current Context (minified)
3. Task & Response Guidelines
4. Tools & Memory
5. **OUTPUT FORMAT (last!)** ← Critical for LLM adherence

**Recommended Approach**:
1. Create a new function `buildSystemPromptV2()` with the new ordering
2. Add a feature flag to switch between versions:
   ```typescript
   const USE_NEW_PROMPT = import.meta.env.VITE_USE_OPTIMIZED_PROMPT === 'true';
   export function buildSystemPrompt(...) {
     if (USE_NEW_PROMPT) return buildSystemPromptV2(...);
     return buildSystemPromptV1(...);
   }
   ```
3. Test extensively with the new format before making it default

**Critical**: Update `systemPrompt.test.ts` test `should maintain section ordering` AFTER confirming new order works.

---

### Task 4: Remove Redundant Identity Sections

**Objective**: Consolidate duplicate identity instructions.

**Steps**:
1. Search for duplicate patterns:
   ```bash
   grep -n "Kayley" src/services/promptUtils.ts | head -20
   grep -n "NOT AN AI" src/services/promptUtils.ts
   grep -n "FORBIDDEN" src/services/promptUtils.ts
   ```
2. Identify sections that repeat the same instructions
3. Keep ONE authoritative section, remove duplicates
4. Character-specific content should come from `kayleyCharacterProfile.ts`

---

## Post-Implementation Verification

// turbo
1. Run all prompt-related tests:
```bash
npm test -- --run src/services/tests/systemPrompt.test.ts src/services/tests/phase1Helpers.test.ts src/services/tests/promptUtils.test.ts
```

// turbo
2. Run full test suite to catch regressions:
```bash
npm test -- --run
```

3. Token count comparison (manual):
   - Copy the generated system prompt to [OpenAI Tokenizer](https://platform.openai.com/tokenizer)
   - Compare before/after token counts
   - Target: ~40% reduction from original

4. Manual QA:
   - Start the app: `npm run dev`
   - Test responses across relationship tiers (stranger, friend, adversarial)
   - Verify JSON format adherence (no preamble, no markdown)
   - Verify action trigger still works

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/services/promptUtils.ts` | Main file - all prompt construction |
| `src/services/tests/systemPrompt.test.ts` | 49 tests protecting prompt structure |
| `src/services/tests/phase1Helpers.test.ts` | Tests for helper functions |
| `docs/System_Prompt_Plan.md` | Full optimization plan with notes |

---

## Gotchas to Watch For

1. **Mocks in tests**: If you import new services, add mocks to test files
2. **Determinism**: Don't add timestamps or random values to prompt
3. **Section ordering test**: Update AFTER confirming new order works
4. **Character vs Generic**: Don't duplicate Kayley-specific content

---

## Rollback Plan

If issues arise:
1. Set `VITE_USE_OPTIMIZED_PROMPT=false` in `.env`
2. Revert to `buildSystemPromptV1()` flow
3. Run tests to confirm baseline is restored
