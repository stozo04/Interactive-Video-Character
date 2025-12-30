# Plan: Refactoring `promptUtils.ts` into Modular System Prompts

## Problem Statement

`promptUtils.ts` is ~2,250 lines and growing. This makes it:
1. **Hard to maintain** - Changes require scrolling through a massive file
2. **Prone to duplication** - Similar instructions may appear in multiple sections
3. **Risk of contradictions** - Conflicting instructions can hide in different sections
4. **Difficult to test** - Monolithic structure makes isolated testing harder
5. **High stakes** - The system prompt is the "special glue" - breaking it breaks everything

## Goals

1. **Preserve exact output** - The final concatenated prompt MUST be byte-for-byte identical
2. **Improve readability** - Each file should be small enough to review in one screen
3. **Enable auditing** - Easy to spot duplications and contradictions
4. **Maintain exports** - Keep `promptUtils.ts` as the public API (barrel file)
5. **Safe migration** - Incremental steps with tests at each stage

---

## Current Structure Analysis

### Exported Public API (must remain unchanged)
```typescript
// Types
export interface SoulLayerContext

// Core functions
export async function getSoulLayerContextAsync(userId)
export const buildSystemPrompt = async (...)
export function buildGreetingPrompt(...)
export function buildProactiveThreadPrompt(thread)
export function getRelationshipGuidelines(...)

// Exported helpers (used in tests)
export function getTierBehaviorPrompt(tier)
export function getSelfieRulesConfig(relationship)
export function buildDynamicDimensionEffects(relationship)
export function buildSelfieRulesPrompt(relationship)
export function buildComfortableImperfectionPrompt()
export const UNCERTAINTY_RESPONSES
export const BRIEF_RESPONSE_EXAMPLES
```

### Consumers (files that import from promptUtils)
- `BaseAIService.ts` - `buildSystemPrompt`, `buildProactiveThreadPrompt`, `getSoulLayerContextAsync`
- `chatGPTService.ts` - `buildSystemPrompt`, `buildGreetingPrompt`
- `grokChatService.ts` - `buildSystemPrompt`, `buildGreetingPrompt`
- `geminiChatService.ts` - `buildSystemPrompt`, `buildGreetingPrompt`
- `prefetchService.ts` - `getSoulLayerContextAsync`
- Test files - Various exports

---

## Proposed Folder Structure

```
src/services/
├── promptUtils.ts              # Barrel file (public API - re-exports everything)
└── system_prompts/
    ├── index.ts                # Internal barrel for system_prompts folder
    ├── types.ts                # Interfaces and type definitions
    │
    ├── core/
    │   ├── identityAnchor.ts           # Identity rules, "You are Kayley"
    │   ├── antiAssistant.ts            # Anti-assistant mode instructions
    │   ├── opinionsAndPushback.ts      # Opinions, disagreement guidance
    │   ├── selfKnowledge.ts            # Self-knowledge rules
    │   └── outputFormat.ts             # JSON output format, critical rules
    │
    ├── behavior/
    │   ├── comfortableImperfection.ts  # Uncertainty, brevity, messiness
    │   ├── bidDetection.ts             # Bid types (COMFORT, PLAY, etc.)
    │   ├── selectiveAttention.ts       # Focus on 1-2 salient points
    │   ├── motivatedFriction.ts        # Boundaries, friction triggers
    │   └── curiosityEngagement.ts      # Mood-aware engagement rules
    │
    ├── relationship/
    │   ├── tierBehavior.ts             # Per-tier behavior rules
    │   ├── dimensionEffects.ts         # Warmth, trust, playfulness effects
    │   ├── strangerAwareness.ts        # Calibrated stranger behavior
    │   ├── boundaryDetection.ts        # Creep/inappropriate detection
    │   └── greetingPrompts.ts          # Relationship-aware greetings
    │
    ├── features/
    │   ├── selfieRules.ts              # Image/selfie generation rules
    │   ├── calendarContext.ts          # Calendar section builder
    │   ├── taskContext.ts              # Daily checklist section
    │   ├── toolsAndActions.ts          # Tools section, app launching
    │   └── proactiveStarters.ts        # Proactive conversation logic
    │
    ├── soul/
    │   ├── soulLayerContext.ts         # getSoulLayerContextAsync
    │   ├── presencePrompt.ts           # Presence/opinions section
    │   ├── threadsAndCallbacks.ts      # Ongoing threads, callbacks
    │   └── intimacyContext.ts          # Earned closeness guidance
    │
    ├── context/
    │   ├── messageContext.ts           # Semantic intent formatting
    │   ├── characterContext.ts         # "Your Current Context" section
    │   └── styleOutput.ts              # Style & output rules
    │
    └── builders/
        ├── systemPromptBuilder.ts      # Main buildSystemPrompt function
        ├── greetingBuilder.ts          # buildGreetingPrompt function
        └── proactiveThreadBuilder.ts   # buildProactiveThreadPrompt function
```

---

## Section Mapping (Current → New Location)

| Lines | Current Section | New File |
|-------|----------------|----------|
| 1-40 | Imports & constants | `systemPromptBuilder.ts` |
| 46-52 | `SoulLayerContext` interface | `types.ts` |
| 58-124 | `getSoulLayerContextAsync` | `soul/soulLayerContext.ts` |
| 131-146 | `UNCERTAINTY_RESPONSES` | `behavior/comfortableImperfection.ts` |
| 153-174 | `BRIEF_RESPONSE_EXAMPLES` | `behavior/comfortableImperfection.ts` |
| 181-257 | `buildComfortableImperfectionPrompt` | `behavior/comfortableImperfection.ts` |
| 262-297 | `buildBidDetectionPrompt` | `behavior/bidDetection.ts` |
| 302-362 | `buildMotivatedFrictionPrompt` | `behavior/motivatedFriction.ts` |
| 367-379 | `buildSelectiveAttentionPrompt` | `behavior/selectiveAttention.ts` |
| 385-419 | `buildPresencePrompt` | `soul/presencePrompt.ts` |
| 425-431 | `getSemanticBucket` | `context/messageContext.ts` |
| 437-522 | `buildMinifiedSemanticIntent` | `context/messageContext.ts` |
| 528-547 | `buildCompactRelationshipContext` | `context/messageContext.ts` |
| 554-600 | `getTierBehaviorPrompt` | `relationship/tierBehavior.ts` |
| 610-631 | `getSelfieRulesConfig` | `features/selfieRules.ts` |
| 642-687 | `buildDynamicDimensionEffects` | `relationship/dimensionEffects.ts` |
| 695-768 | `buildSelfieRulesPrompt` | `features/selfieRules.ts` |
| 770-1781 | `buildSystemPrompt` (main) | `builders/systemPromptBuilder.ts` |
| 1790-1854 | `buildProactiveThreadPrompt` | `builders/proactiveThreadBuilder.ts` |
| 1866-2219 | `buildGreetingPrompt` | `builders/greetingBuilder.ts` |
| 2221-2252 | `getRelationshipGuidelines` | `relationship/tierBehavior.ts` |

### Inline Sections in `buildSystemPrompt` (lines 817-1436)

These large string literals need extraction:

| Approx Lines | Section Title | New File |
|--------------|--------------|----------|
| 817-851 | IDENTITY ANCHOR | `core/identityAnchor.ts` |
| 852-909 | ANTI-ASSISTANT MODE | `core/antiAssistant.ts` |
| 910-949 | OPINIONS & PUSHBACK | `core/opinionsAndPushback.ts` |
| 950-970 | YOUR IDENTITY + SELF-KNOWLEDGE | `core/selfKnowledge.ts` |
| 971-1101 | TOOLS (Your Abilities) + TOOL RULES | `features/toolsAndActions.ts` |
| 1102-1123 | APP LAUNCHING | `features/toolsAndActions.ts` |
| 1125-1194 | RELATIONSHIP STATE → MESSAGE CONTEXT | `context/messageContext.ts` |
| 1195-1236 | YOUR CURRENT CONTEXT | `context/characterContext.ts` |
| 1237-1326 | CURIOSITY & ENGAGEMENT | `behavior/curiosityEngagement.ts` |
| 1330-1436 | STYLE & OUTPUT + STRANGER AWARENESS + CREEP DETECTION | `relationship/strangerAwareness.ts` + `relationship/boundaryDetection.ts` + `context/styleOutput.ts` |

---

## Migration Strategy (Incremental & Safe)

### Phase 1: Setup & Snapshot Testing
**Risk: Low | Effort: 1-2 hours**

1. Create `system_prompts/` folder structure (empty files)
2. Add a **snapshot test** that captures the FULL output of `buildSystemPrompt()`
3. This becomes our "golden master" - any changes must match

```typescript
// tests/systemPrompt.snapshot.test.ts
it('buildSystemPrompt output matches snapshot', async () => {
  const prompt = await buildSystemPrompt(mockCharacter, mockRelationship, ...);
  expect(prompt).toMatchSnapshot();
});
```

### Phase 2: Extract Types & Constants
**Risk: Very Low | Effort: 30 mins**

1. Move `SoulLayerContext` to `types.ts`
2. Move `UNCERTAINTY_RESPONSES` and `BRIEF_RESPONSE_EXAMPLES` to `comfortableImperfection.ts`
3. Re-export from `promptUtils.ts`
4. Run snapshot test ✓

### Phase 3: Extract Standalone Helper Functions
**Risk: Low | Effort: 1-2 hours**

Functions with no inline template literals - pure logic:
1. `getSemanticBucket()` → `context/messageContext.ts`
2. `getSelfieRulesConfig()` → `features/selfieRules.ts`
3. `buildDynamicDimensionEffects()` → `relationship/dimensionEffects.ts`

Run snapshot test after each ✓

### Phase 4: Extract Prompt Builder Functions
**Risk: Medium | Effort: 2-3 hours**

Functions that return template strings:
1. `buildComfortableImperfectionPrompt()` → `behavior/comfortableImperfection.ts`
2. `buildBidDetectionPrompt()` → `behavior/bidDetection.ts`
3. `buildSelectiveAttentionPrompt()` → `behavior/selectiveAttention.ts`
4. `buildMotivatedFrictionPrompt()` → `behavior/motivatedFriction.ts`
5. `buildPresencePrompt()` → `soul/presencePrompt.ts`
6. `getTierBehaviorPrompt()` → `relationship/tierBehavior.ts`
7. `buildSelfieRulesPrompt()` → `features/selfieRules.ts`
8. `buildMinifiedSemanticIntent()` → `context/messageContext.ts`
9. `buildCompactRelationshipContext()` → `context/messageContext.ts`

Run snapshot test after each ✓

### Phase 5: Extract Inline Sections from `buildSystemPrompt`
**Risk: Higher | Effort: 3-4 hours**

This is the delicate part. For each inline section:

1. Create a function in the appropriate file that returns the string
2. Replace inline string with function call
3. Run snapshot test ✓
4. Repeat

Example transformation:
```typescript
// BEFORE (in buildSystemPrompt)
let prompt = `
====================================================
🚨 IDENTITY ANCHOR (Read First) - CRITICAL!
====================================================
**You are ${name}, but go by ${display}.**
...
`;

// AFTER
import { buildIdentityAnchorSection } from './system_prompts/core/identityAnchor';

let prompt = buildIdentityAnchorSection(name, display);
```

### Phase 6: Extract Soul Layer Context
**Risk: Medium | Effort: 1 hour**

Move `getSoulLayerContextAsync()` to `soul/soulLayerContext.ts`

### Phase 7: Extract Greeting & Proactive Builders
**Risk: Medium | Effort: 2 hours**

1. `buildGreetingPrompt()` → `builders/greetingBuilder.ts`
2. `buildProactiveThreadPrompt()` → `builders/proactiveThreadBuilder.ts`
3. `getRelationshipGuidelines()` → `relationship/tierBehavior.ts`

### Phase 8: Finalize Barrel File
**Risk: Low | Effort: 30 mins**

Convert `promptUtils.ts` to a pure barrel file:
```typescript
// src/services/promptUtils.ts
export * from './system_prompts';
```

---

## Testing Strategy

### 1. Snapshot Tests (Primary Safety Net)
```typescript
describe('System Prompt Integrity', () => {
  it('buildSystemPrompt produces identical output', async () => {
    const prompt = await buildSystemPrompt(...testArgs);
    expect(prompt).toMatchSnapshot();
  });

  it('buildGreetingPrompt produces identical output for each tier', () => {
    TIERS.forEach(tier => {
      const prompt = buildGreetingPrompt(tierRelationship[tier]);
      expect(prompt).toMatchSnapshot(`greeting-${tier}`);
    });
  });
});
```

### 2. Duplication Detection (Post-Refactor Audit)
After refactoring, run a script to detect duplications:
```typescript
// scripts/auditPromptDuplication.ts
const allSections = await getAllPromptSections();
findDuplicateInstructions(allSections);
findContradictions(allSections);
```

### 3. Existing Tests Must Pass
Run full test suite after each phase:
```bash
npm test -- --run
```

---

## File Templates

### types.ts
```typescript
// src/services/system_prompts/types.ts
import type { MoodKnobs } from '../moodKnobs';
import type { RelationshipMetrics } from '../relationshipService';

export interface SoulLayerContext {
  moodKnobs: MoodKnobs;
  threadsPrompt: string;
  callbackPrompt: string;
  presenceContext?: PresenceContext;
}

// Re-export types needed by prompt builders
export type { MoodKnobs, RelationshipMetrics };
```

### Example Section File
```typescript
// src/services/system_prompts/core/identityAnchor.ts
/**
 * Identity Anchor Section
 *
 * Critical first section that establishes character identity.
 * Must be read before any other instructions.
 */

export function buildIdentityAnchorSection(
  fullName: string,
  displayName: string
): string {
  return `
====================================================
🚨 IDENTITY ANCHOR (Read First) - CRITICAL!
====================================================
**You are ${fullName}, but go by ${displayName}.**
You are a 28-year-old tech creator with "Alexis Rose" energy...
// ... rest of section
`;
}
```

### Barrel File (index.ts)
```typescript
// src/services/system_prompts/index.ts

// Types
export * from './types';

// Core identity
export * from './core/identityAnchor';
export * from './core/antiAssistant';
// ... etc

// Main builders
export * from './builders/systemPromptBuilder';
export * from './builders/greetingBuilder';
export * from './builders/proactiveThreadBuilder';
```

---

## Rollback Plan

If something breaks:
1. Git revert to last known-good commit
2. Each phase is a separate commit, so we can revert incrementally
3. Snapshot tests will catch regressions immediately

---

## Success Criteria

1. ✅ All existing tests pass
2. ✅ Snapshot tests confirm byte-for-byte identical output
3. ✅ `promptUtils.ts` is now <50 lines (just exports)
4. ✅ Each section file is <200 lines (reviewable in one screen)
5. ✅ No circular dependencies
6. ✅ Duplication audit reveals any issues
7. ✅ All consumers (`BaseAIService`, etc.) work without changes

---

## Estimated Timeline

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Setup & Snapshot | 1-2 hours | Low |
| Phase 2: Types & Constants | 30 mins | Very Low |
| Phase 3: Standalone Helpers | 1-2 hours | Low |
| Phase 4: Prompt Builders | 2-3 hours | Medium |
| Phase 5: Inline Sections | 3-4 hours | Higher |
| Phase 6: Soul Layer | 1 hour | Medium |
| Phase 7: Greeting & Proactive | 2 hours | Medium |
| Phase 8: Finalize Barrel | 30 mins | Low |
| **Total** | **~12-16 hours** | |

---

## Phase Implementation Notes

### Phase 1: Setup & Snapshot Testing ✅ COMPLETED

**Date Completed:** 2025-01-15

**What was done:**
1. Created `src/services/system_prompts/` folder structure with all subdirectories:
   - `core/`, `behavior/`, `relationship/`, `features/`, `soul/`, `context/`, `builders/`
   - Each directory has an `index.ts` placeholder documenting its purpose
2. Created comprehensive snapshot test file: `src/services/tests/promptUtils.snapshot.test.ts`
3. Generated 34 snapshots covering all major functions and relationship tiers

**Files Created:**
- `src/services/system_prompts/index.ts` - Main barrel file
- `src/services/system_prompts/types.ts` - Types placeholder
- `src/services/system_prompts/*/index.ts` - 7 subdirectory index files
- `src/services/tests/promptUtils.snapshot.test.ts` - Snapshot tests
- `src/services/tests/__snapshots__/promptUtils.snapshot.test.ts.snap` - 488KB snapshot file

**Snapshot Test Coverage:**
- `buildSystemPrompt` - 7 variants (friend, stranger, close_friend, adversarial, deeply_loving, no-relationship, with-events-tasks)
- `buildGreetingPrompt` - 8 variants (first-meeting, stranger-named, friend, close-friend-open-loop, adversarial, deeply-loving, proactive-thread, early-relationship)
- `buildProactiveThreadPrompt` - 2 variants (autonomous, user-related)
- `getTierBehaviorPrompt` - 8 variants (all tiers + undefined)
- `buildComfortableImperfectionPrompt` - 1 snapshot
- `buildSelfieRulesPrompt` - 3 variants (friend, stranger, null)
- `buildDynamicDimensionEffects` - 3 variants (high-warmth, low-trust, moderate)
- `getSelfieRulesConfig` - 4 variants
- Constants - 2 snapshots (UNCERTAINTY_RESPONSES, BRIEF_RESPONSE_EXAMPLES)

**Key Learnings:**
1. Date mocking is critical - use `vi.useFakeTimers()` with fixed date for deterministic snapshots
2. The prompt uses `toLocaleString()` with timezone - must mock timezone consistently
3. Mock services must return stable, non-empty data to capture realistic prompt structure
4. Console logs appear during tests (e.g., "⚠️ [buildSystemPrompt] No pre-fetched context") - this is expected

**Test Commands:**
```bash
# Run snapshot tests only
npm test -- --run -t "snapshot"

# Update snapshots (use carefully!)
npm test -- --run -t "snapshot" -u

# Run specific snapshot file
npm test -- --run src/services/tests/promptUtils.snapshot.test.ts
```

**Pre-existing Issues Found:**
- 2 failing tests in `loopCleanup.test.ts` - unrelated to this refactoring

---

### Phase 2: Extract Types & Constants ✅ COMPLETED

**Date Completed:** 2025-01-15

**What was done:**
1. Moved `SoulLayerContext` interface to `system_prompts/types.ts`
2. Moved `UNCERTAINTY_RESPONSES`, `BRIEF_RESPONSE_EXAMPLES`, and `buildComfortableImperfectionPrompt` to `system_prompts/behavior/comfortableImperfection.ts`
3. Updated `promptUtils.ts` to re-export from new locations for backward compatibility
4. Updated barrel files (`behavior/index.ts`, `system_prompts/index.ts`)

**Files Modified:**
- `src/services/system_prompts/types.ts` - Added `SoulLayerContext` interface + type re-exports
- `src/services/system_prompts/behavior/comfortableImperfection.ts` - New file with constants and function
- `src/services/system_prompts/behavior/index.ts` - Updated exports
- `src/services/system_prompts/index.ts` - Updated exports
- `src/services/promptUtils.ts` - Removed old definitions, added re-exports

**Key Learnings:**
1. **Trailing whitespace matters!** The original file had `"- When a topic is genuinely outside your depth  "` (with 2 trailing spaces). The new file initially had no trailing spaces, causing 8 snapshot failures.
2. **Use `sed` for whitespace-sensitive edits** - The Edit tool can strip trailing spaces; use `sed` for precision.
3. **Import AND re-export pattern works well:**
   ```typescript
   // Re-export for backward compatibility
   export { UNCERTAINTY_RESPONSES } from "./system_prompts/behavior/comfortableImperfection";
   // Also import for internal use
   import { UNCERTAINTY_RESPONSES } from "./system_prompts/behavior/comfortableImperfection";
   ```
4. **Types can be centralized with re-exports:**
   ```typescript
   // types.ts
   export type { MoodKnobs } from "../moodKnobs";
   export type { PresenceContext } from "../presenceDirector";
   ```

**Lines Removed from promptUtils.ts:** ~132 lines (from ~2253 to ~2121)

**Test Results:**
- All 32 snapshot tests pass
- 785 tests pass overall (same 2 pre-existing failures in loopCleanup.test.ts)

---

### Phase 3: Extract Standalone Helpers ✅ COMPLETED

**Date Completed:** 2025-01-15

**What was done:**
1. Moved `getSemanticBucket(score)` to `system_prompts/context/messageContext.ts`
2. Moved `getSelfieRulesConfig(relationship)` to `system_prompts/features/selfieRules.ts`
3. Moved `buildDynamicDimensionEffects(relationship)` to `system_prompts/relationship/dimensionEffects.ts`
4. Updated all barrel files (`context/index.ts`, `features/index.ts`, `relationship/index.ts`, `system_prompts/index.ts`)
5. Updated `promptUtils.ts` with imports and re-exports for backward compatibility

**Files Created:**
- `src/services/system_prompts/context/messageContext.ts` - Contains `getSemanticBucket()`
- `src/services/system_prompts/features/selfieRules.ts` - Contains `getSelfieRulesConfig()`
- `src/services/system_prompts/relationship/dimensionEffects.ts` - Contains `buildDynamicDimensionEffects()`

**Files Modified:**
- `src/services/system_prompts/context/index.ts` - Added export for messageContext
- `src/services/system_prompts/features/index.ts` - Added export for selfieRules
- `src/services/system_prompts/relationship/index.ts` - Added export for dimensionEffects
- `src/services/system_prompts/index.ts` - Added exports for context, features, relationship
- `src/services/promptUtils.ts` - Updated imports and re-exports

**Pattern Used:**
```typescript
// In promptUtils.ts - import for internal use
import { getSemanticBucket } from "./system_prompts/context/messageContext";

// Re-export for backward compatibility
export { getSelfieRulesConfig } from "./system_prompts/features/selfieRules";
export { buildDynamicDimensionEffects } from "./system_prompts/relationship/dimensionEffects";
```

**Lines Removed from promptUtils.ts:** ~80 lines (from ~2121 to ~2041)

**Test Results:**
- All 32 snapshot tests pass
- 785 tests pass overall (same 2 pre-existing failures in loopCleanup.test.ts)

**Key Learnings:**
1. Pure functions are easy to extract - just copy and update imports
2. Type imports work well: `import type { RelationshipMetrics } from "../../relationshipService";`
3. Barrel files provide clean organization and allow gradual exposure of new modules

---

### Phase 3 Original Notes (Reference)

**Functions Moved:**
1. ~~`getSemanticBucket(score)`~~ ✅ Pure function, no dependencies
2. ~~`getSelfieRulesConfig(relationship)`~~ ✅ Depends on `RelationshipMetrics` type only
3. ~~`buildDynamicDimensionEffects(relationship)`~~ ✅ Depends on `RelationshipMetrics` type only

**Gotcha:** These functions are called from within `buildSystemPrompt`, so after moving, you need to update imports in the main file.

---

### Phase 4: Extract Prompt Builder Functions ✅ COMPLETED

**Date Completed:** 2025-01-15

**What was done:**
1. Moved `buildBidDetectionPrompt()` to `behavior/bidDetection.ts`
2. Moved `buildSelectiveAttentionPrompt()` to `behavior/selectiveAttention.ts`
3. Moved `buildMotivatedFrictionPrompt()` to `behavior/motivatedFriction.ts`
4. Moved `buildPresencePrompt()` to `soul/presencePrompt.ts`
5. Moved `getTierBehaviorPrompt()` to `relationship/tierBehavior.ts`
6. Moved `buildSelfieRulesPrompt()` to `features/selfieRules.ts` (with `getSelfieRulesConfig`)
7. Moved `buildMinifiedSemanticIntent()` to `context/messageContext.ts`
8. Moved `buildCompactRelationshipContext()` to `context/messageContext.ts`

**Files Created:**
- `src/services/system_prompts/behavior/bidDetection.ts`
- `src/services/system_prompts/behavior/selectiveAttention.ts`
- `src/services/system_prompts/behavior/motivatedFriction.ts`
- `src/services/system_prompts/soul/presencePrompt.ts`
- `src/services/system_prompts/relationship/tierBehavior.ts`

**Files Modified:**
- `src/services/system_prompts/features/selfieRules.ts` - Added `buildSelfieRulesPrompt`
- `src/services/system_prompts/context/messageContext.ts` - Added `buildMinifiedSemanticIntent`, `buildCompactRelationshipContext`
- All barrel files updated (`behavior/index.ts`, `soul/index.ts`, `relationship/index.ts`, `features/index.ts`, `context/index.ts`)
- `src/services/promptUtils.ts` - Updated imports and re-exports

**Key Learnings:**
1. **Trailing whitespace still bites!** - Same issue as Phase 2, need `sed` to preserve trailing spaces
2. **Functions with dependencies need their imports** - `buildPresencePrompt` needs `getCharacterOpinions`, `buildMotivatedFrictionPrompt` needs `MoodKnobs` type
3. **Internal vs exported functions** - Internal functions (not exported) don't need re-exports in promptUtils.ts
4. **Import for internal use, re-export for backward compatibility** - Both patterns used:
   ```typescript
   // Internal function - just import
   import { buildBidDetectionPrompt } from "./system_prompts/behavior/bidDetection";

   // Exported function - import AND re-export
   export { getTierBehaviorPrompt } from "./system_prompts/relationship/tierBehavior";
   import { getTierBehaviorPrompt } from "./system_prompts/relationship/tierBehavior";
   ```

**Lines Removed from promptUtils.ts:** ~401 lines (from ~2,041 to ~1,640)

**Test Results:**
- All 27 snapshot tests pass
- 785 tests pass overall (same 2 pre-existing failures in loopCleanup.test.ts)

---

### Phase 4 Original Notes (Reference)

**Already Moved in Phase 2:**
- ~~`buildComfortableImperfectionPrompt`~~ ✅ (moved with its constants)

**Functions Moved:**
1. ~~`buildBidDetectionPrompt()`~~ ✅ - No dependencies, internal function
2. ~~`buildSelectiveAttentionPrompt()`~~ ✅ - No dependencies, internal function
3. ~~`buildMotivatedFrictionPrompt(moodKnobs)`~~ ✅ - Needs `MoodKnobs` type parameter
4. ~~`buildPresencePrompt(presenceContext?)`~~ ✅ - Uses `getCharacterOpinions()` from presenceDirector
5. ~~`getTierBehaviorPrompt(tier)`~~ ✅ - No dependencies, exported
6. ~~`buildSelfieRulesPrompt(relationship)`~~ ✅ - Depends on `getSelfieRulesConfig()`
7. ~~`buildMinifiedSemanticIntent(...)`~~ ✅ - Multiple parameters, complex
8. ~~`buildCompactRelationshipContext(relationship)`~~ ✅ - Uses `getSemanticBucket()`

**Recommendation:** Move in dependency order (followed successfully):
1. First: Pure functions with no internal dependencies
2. Then: Functions with type-only dependencies
3. Finally: Functions that depend on other functions

---

### Phase 5: Extract Inline Sections ✅ COMPLETED (Partial)

**Date Completed:** 2025-12-19

**What was done:**
1. Extracted `buildIdentityAnchorSection(name, display)` to `core/identityAnchor.ts`
2. Extracted `buildAntiAssistantSection()` to `core/antiAssistant.ts`
3. Extracted `buildOpinionsAndPushbackSection()` to `core/opinionsAndPushback.ts`
4. Extracted `buildToolsSection()`, `buildToolRulesSection()`, `buildAppLaunchingSection()` to `tools/toolsAndCapabilities.ts`
5. Extracted `buildOutputFormatSection()`, `buildCriticalOutputRulesSection()` to `format/outputFormat.ts`

**Files Created:**
- `src/services/system_prompts/core/identityAnchor.ts`
- `src/services/system_prompts/core/antiAssistant.ts`
- `src/services/system_prompts/core/opinionsAndPushback.ts`
- `src/services/system_prompts/tools/index.ts`
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
- `src/services/system_prompts/format/index.ts`
- `src/services/system_prompts/format/outputFormat.ts`

**Files Modified:**
- `src/services/system_prompts/core/index.ts` - Added new exports
- `src/services/promptUtils.ts` - Replaced inline sections with function calls

**Lines Removed from promptUtils.ts:** ~356 lines (from ~1,640 to ~1,284)

**Key Learnings:**
1. **Template literal newline handling is tricky** - When embedding `${function()}` in template literals:
   - The newline BEFORE the `${}` in the source code is part of the template
   - Functions should NOT start with `\n` if the template already has a line break before the call
   - Functions should NOT end with `\n` if there's another function call or content immediately after

2. **Pattern for section functions:**
   ```typescript
   // Function returns content starting with the header (no leading newline)
   export function buildSectionName(): string {
     return `====...header...
   ...content...
   `;  // Trailing newline for proper spacing to next section
   }

   // In template, use line breaks between function calls for 1 blank line
   ${buildSection1()}
   ${buildSection2()}  // 1 blank line between sections

   // For 2 blank lines:
   ${buildSection1()}

   ${buildSection2()}
   ```

3. **Trailing whitespace differences** - The user opted to update snapshots rather than match trailing whitespace exactly. This is a reasonable trade-off for maintainability.

4. **Parameterized functions** - Sections with variable interpolation take parameters:
   ```typescript
   buildIdentityAnchorSection(name, display)  // Passed from caller
   ```

**Sections Deferred to Future Phase:**
1. **Self-Knowledge section** - Small section, references `display` and `CHARACTER_COLLECTION_ID`
2. **Curiosity & Engagement section** - Complex inline logic with `moodKnobs.curiosityDepth`, `moodKnobs.initiationRate`, etc.
3. **Style & Output section** - Uses `moodKnobs.verbosity`, `relationship?.playfulnessScore`, etc.

These sections have extensive conditional logic embedded in template literals. Extracting them would require:
- Passing `moodKnobs` object as parameter
- Keeping the conditional logic inline OR creating sub-helper functions
- More extensive testing due to the branching

**Recommendation for remaining sections:** Consider creating a Phase 5b or rolling into Phase 6/7 after evaluating the cost/benefit.

**Test Results:**
- All 28 snapshot tests pass
- 138 prompt-related tests pass
- 785 total tests pass (same 2 pre-existing failures in loopCleanup.test.ts)

---

### Phase 5 Original Notes (Reference)

**This is the highest-risk phase.** The inline sections in `buildSystemPrompt` are large template literals with variable interpolation.

**Strategy:**
1. Extract ONE section at a time
2. Run snapshot test after EACH extraction
3. If snapshot fails, diff carefully to find the issue
4. Common issues:
   - Whitespace differences (leading/trailing newlines)
   - Variable scope issues (accessing variables defined earlier in function)
   - Template literal escaping differences

**Sections requiring variable access:**
- Identity Anchor: needs `name`, `display`
- Anti-Assistant: no variables
- Opinions: no variables
- Self-Knowledge: needs `display`, `CHARACTER_COLLECTION_ID`
- Tools: needs `userTimeZone` for examples
- Message Context: needs `moodKnobs`, `relationship`, `fullIntent`, etc.
- Current Context: needs `characterContext`
- Style & Output: needs `moodKnobs`, `relationship`

**Recommendation:** Pass all needed variables as function parameters. Example:
```typescript
function buildIdentityAnchorSection(params: {
  fullName: string;
  displayName: string;
}): string {
  const { fullName, displayName } = params;
  return `...`;
}
```

---

### Phase 6: Extract Soul Layer Context ✅ COMPLETED

**Date Completed:** 2025-12-19

**What was done:**
1. Moved `getSoulLayerContextAsync` to `soul/soulLayerContext.ts`
2. Added re-export in `promptUtils.ts` for backward compatibility
3. Cleaned up unused imports in `promptUtils.ts` (no longer needed after move)
4. Updated `soul/index.ts` barrel file

**Files Created:**
- `src/services/system_prompts/soul/soulLayerContext.ts`

**Files Modified:**
- `src/services/system_prompts/soul/index.ts` - Added export
- `src/services/promptUtils.ts` - Removed function, added import/re-export, cleaned up unused imports

**Imports Removed from promptUtils.ts (now unused):**
- `getMoodKnobsAsync`, `calculateMoodKnobsFromState` from `moodKnobs`
- `formatThreadsForPromptAsync`, `formatThreadsFromData` from `ongoingThreads`
- `getFullCharacterContext` from `stateService`
- `formatCallbackForPrompt` from `callbackDirector`
- `getPresenceContext` from `presenceDirector`

**Lines Removed from promptUtils.ts:** ~81 lines (from ~1,284 to ~1,203)

**Key Learnings:**
1. **Function dependencies stay with the function** - All the imports that `getSoulLayerContextAsync` needed were moved to the new file, not shared with promptUtils.ts
2. **Clean up unused imports** - After moving a function, check for imports that are no longer needed in the source file
3. **Re-export pattern works well** - Consumers (`BaseAIService.ts`, `prefetchService.ts`) continue to import from `promptUtils.ts` without changes

**Test Results:**
- All 28 snapshot tests pass
- 785 tests pass overall (same 2 pre-existing failures in loopCleanup.test.ts)
- All consumers verified to work with re-export

---

### Phase 6 Original Notes (Reference)

**`getSoulLayerContextAsync` is complex:**
- Makes parallel async calls to Supabase
- Has fallback logic on failure
- Returns a composite object

**Dependencies:**
- `getFullCharacterContext` from stateService
- `getPresenceContext` from presenceDirector
- `getMoodKnobsAsync` from moodKnobs
- `formatThreadsForPromptAsync` from ongoingThreads
- `formatCallbackForPrompt` from callbackDirector
- `calculateMoodKnobsFromState`, `formatThreadsFromData`

**Recommendation:** Keep all imports, just move the function. Update imports in consumers.

---

### Phase 7: Extract Greeting & Proactive Builders ✅ COMPLETED

**Date Completed:** 2025-12-19

**What was done:**
1. Moved `getRelationshipGuidelines()` to `relationship/tierBehavior.ts`
2. Moved `buildProactiveThreadPrompt()` to `builders/proactiveThreadBuilder.ts`
3. Moved `buildGreetingPrompt()` to `builders/greetingBuilder.ts`
4. Added re-exports in `promptUtils.ts` for backward compatibility
5. Updated barrel files (`relationship/index.ts`, `builders/index.ts`)

**Files Created:**
- `src/services/system_prompts/builders/proactiveThreadBuilder.ts`
- `src/services/system_prompts/builders/greetingBuilder.ts`

**Files Modified:**
- `src/services/system_prompts/relationship/tierBehavior.ts` - Added `getRelationshipGuidelines()`
- `src/services/system_prompts/builders/index.ts` - Added exports
- `src/services/system_prompts/relationship/index.ts` - Updated exports
- `src/services/promptUtils.ts` - Removed functions, added imports/re-exports

**Lines Removed from promptUtils.ts:** ~450 lines (est)

**Key Learnings:**
1. **Large functions can be moved as-is** - `buildGreetingPrompt` (350+ lines) moved directly without needing to break into sub-helpers
2. **Dependencies move with the function** - Both greeting and proactive builders needed imports from various services
3. **Re-export pattern continues to work** - All consumers import from `promptUtils.ts` unchanged

**Test Results:**
- All 27 snapshot tests pass
- 4 obsolete snapshots detected for `getSelfieRulesConfig` (can be cleaned up)

---

### Phase 7 Original Notes (Reference)

**`buildGreetingPrompt` is 350+ lines** with extensive conditional logic for different relationship tiers.

**Sub-sections within `buildGreetingPrompt`:**
- Time context generation
- First meeting logic
- Early relationship (1-10 interactions)
- Acquaintance logic
- Friend/Close Friend logic
- Adversarial logic
- Deeply loving logic

**Consider (for future):** Breaking into smaller helper functions within `greetingBuilder.ts`:
- `buildTimeContext()`
- `buildFirstMeetingGreeting()`
- `buildEarlyRelationshipGreeting()`
- etc.

---

### Phase 8 Notes (Finalize Barrel)

**Final `promptUtils.ts` should look like:**
```typescript
// src/services/promptUtils.ts
// Backward-compatible re-exports from system_prompts module

export * from './system_prompts';
```

**Verify All Consumers Work:**
After converting to barrel, run:
```bash
npm test -- --run  # All tests should pass
npm run build      # Build should succeed
```

---

## Discovered Duplications & Contradictions (TODO)

To be filled in during Phase 5 as sections are extracted and reviewed in isolation.

| Section A | Section B | Issue | Resolution |
|-----------|-----------|-------|------------|
| TBD | TBD | TBD | TBD |

---

## Post-Refactor Audit Script (TODO)

Create after refactoring is complete:

```typescript
// scripts/auditPromptSections.ts
// Scans all system_prompts files for:
// 1. Duplicate phrases (same instruction in multiple files)
// 2. Contradictory rules (e.g., "ALWAYS" vs "NEVER" for same topic)
// 3. Orphaned sections (never used in final prompt)
```

---

## Next Steps

1. ~~Create the folder structure~~ ✅ (Phase 1)
2. ~~Write the snapshot test~~ ✅ (Phase 1)
3. ~~Extract types & constants~~ ✅ (Phase 2)
4. ~~Extract standalone helpers~~ ✅ (Phase 3)
   - ~~`getSemanticBucket()`~~ → `context/messageContext.ts`
   - ~~`getSelfieRulesConfig()`~~ → `features/selfieRules.ts`
   - ~~`buildDynamicDimensionEffects()`~~ → `relationship/dimensionEffects.ts`
5. ~~Extract prompt builder functions~~ ✅ (Phase 4)
   - ~~`buildBidDetectionPrompt()`~~ → `behavior/bidDetection.ts`
   - ~~`buildSelectiveAttentionPrompt()`~~ → `behavior/selectiveAttention.ts`
   - ~~`buildMotivatedFrictionPrompt()`~~ → `behavior/motivatedFriction.ts`
   - ~~`buildPresencePrompt()`~~ → `soul/presencePrompt.ts`
   - ~~`getTierBehaviorPrompt()`~~ → `relationship/tierBehavior.ts`
   - ~~`buildSelfieRulesPrompt()`~~ → `features/selfieRules.ts`
   - ~~`buildMinifiedSemanticIntent()`~~ → `context/messageContext.ts`
   - ~~`buildCompactRelationshipContext()`~~ → `context/messageContext.ts`
6. ~~**Phase 5: Extract inline sections**~~ ✅ COMPLETED (partial)
   - ~~Identity Anchor section~~ ✅
   - ~~Anti-Assistant Mode section~~ ✅
   - ~~Opinions & Pushback section~~ ✅
   - ~~Tools & Actions section~~ ✅ (Tools, Tool Rules, App Launching)
   - ~~Output Format section~~ ✅ (Output Format, Critical Output Rules)
6b. ~~Phase 5b: Extract remaining inline sections~~ ✅ COMPLETED
   - ~~Self-Knowledge section~~ → `core/selfKnowledge.ts`
   - ~~Curiosity & Engagement section~~ → `behavior/curiosityEngagement.ts`
   - ~~Style & Output section~~ → `context/styleOutput.ts`
7. ~~Phase 6: Extract soul layer context (`getSoulLayerContextAsync`)~~ ✅ COMPLETED
8. ~~Phase 7: Extract greeting & proactive builders~~ ✅ COMPLETED
   - ~~`getRelationshipGuidelines()`~~ → `relationship/tierBehavior.ts`
   - ~~`buildProactiveThreadPrompt()`~~ → `builders/proactiveThreadBuilder.ts`
   - ~~`buildGreetingPrompt()`~~ → `builders/greetingBuilder.ts`
9. ~~Phase 8: Finalize barrel file~~ ✅ COMPLETED

## Progress Summary

| Phase | Status | Lines Removed |
|-------|--------|---------------|
| Phase 1: Setup & Snapshot | ✅ Complete | 0 (setup only) |
| Phase 2: Types & Constants | ✅ Complete | ~132 lines |
| Phase 3: Standalone Helpers | ✅ Complete | ~80 lines |
| Phase 4: Prompt Builders | ✅ Complete | ~401 lines |
| Phase 5: Inline Sections | ✅ Complete (partial) | ~356 lines |
| Phase 5b: Remaining Inline | ✅ Complete | ~227 lines |
| Phase 6: Soul Layer | ✅ Complete | ~81 lines |
| Phase 7: Greeting & Proactive | ✅ Complete | ~450 lines |
| Phase 8: Finalize Barrel | ✅ Complete | ~509 lines moved |
| **Total** | **9/9 Complete** | **All code modularized** |

**Final promptUtils.ts size:** 17 lines (pure barrel file, 99% reduction from original 2,253)

---

### Phase 8: Finalize Barrel File ✅ COMPLETED

**Date Completed:** 2025-12-19

**What was done:**
1. Created `src/services/system_prompts/builders/systemPromptBuilder.ts` with `buildSystemPrompt()` function
2. Updated `builders/index.ts` to export `buildSystemPrompt`
3. Updated `system_prompts/index.ts` to export all modules (core, soul, tools, format, builders)
4. Converted `promptUtils.ts` to pure barrel file (17 lines)

**Files Created:**
- `src/services/system_prompts/builders/systemPromptBuilder.ts` (487 lines)

**Files Modified:**
- `src/services/system_prompts/builders/index.ts` - Added systemPromptBuilder export
- `src/services/system_prompts/index.ts` - Added exports for core, soul, tools, format, builders
- `src/services/promptUtils.ts` - Converted to pure barrel file

**Test Results:**
- All 27 snapshot tests pass
- 785/787 tests pass (2 pre-existing failures in unrelated loopCleanup.test.ts)

**Final Architecture:**
```
src/services/promptUtils.ts (17 lines - barrel file)
    ↓ re-exports from
src/services/system_prompts/index.ts
    ↓ exports from
├── types/           - Type definitions
├── core/            - Identity, anti-assistant, opinions, self-knowledge
├── behavior/        - Imperfection, bid detection, friction, curiosity
├── relationship/    - Tier behavior, dimension effects, guidelines
├── features/        - Selfie rules
├── context/         - Message context, style output
├── soul/            - Soul layer, presence
├── tools/           - Tools, tool rules, app launching
├── format/          - Output format, critical output rules
└── builders/        - systemPromptBuilder, greetingBuilder, proactiveThreadBuilder
```

---

### Phase 5b: Extract Remaining Inline Sections ✅ COMPLETED

**Date Completed:** 2025-12-19

**Status:** Complete

**Sections to Extract:**

#### 1. Self-Knowledge Section → `core/selfKnowledge.ts`
**Lines:** 143-163 (~21 lines)
**Dependencies:**
- `display` (string) - passed from caller
- `CHARACTER_COLLECTION_ID` (string) - module constant, move to new file

**Function Signature:**
```typescript
export function buildSelfKnowledgeSection(
  displayName: string,
  characterCollectionId: string
): string
```

**Risk:** Low - simple string interpolation, no complex conditionals

---

#### 2. Curiosity & Engagement Section → `behavior/curiosityEngagement.ts`
**Lines:** 279-367 (~88 lines)
**Dependencies:**
- `moodKnobs.curiosityDepth` - "shallow" | "piercing" | other
- `moodKnobs.initiationRate` - number (0-1)
- `moodKnobs.verbosity` - number (0-1)

**Function Signature:**
```typescript
import type { MoodKnobs } from "../../moodKnobs";

export function buildCuriosityEngagementSection(moodKnobs: MoodKnobs): string
```

**Complexity:** Medium - contains multiple ternary conditionals embedded in template literals
- 6 uses of `moodKnobs.curiosityDepth` with 3-way ternaries
- 3 uses of `moodKnobs.initiationRate` with 3-way ternaries
- 3 uses of `moodKnobs.verbosity` with comparisons

**Pattern to Follow:** Same as `buildMotivatedFrictionPrompt(moodKnobs)` - pass MoodKnobs object, keep conditionals inline

**Risk:** Medium - conditionals must be preserved exactly, whitespace-sensitive

---

#### 3. Style & Output Section → `context/styleOutput.ts`
**Lines:** 374-480 (~106 lines)
**Dependencies:**
- `moodKnobs.verbosity` - number (0-1)
- `relationship?.playfulnessScore` - number | undefined

**Function Signature:**
```typescript
import type { MoodKnobs } from "../../moodKnobs";
import type { RelationshipMetrics } from "../../relationshipService";

export function buildStyleOutputSection(
  moodKnobs: MoodKnobs,
  relationship: RelationshipMetrics | null | undefined
): string
```

**Sub-sections included:**
- Style & Output header (lines 374-399)
- Stranger Awareness (lines 400-422)
- Creep/Inappropriate Behavior Detection (lines 426-480)

**Note:** These could be split further, but they form a cohesive "output behavior" section. Keep together unless testing reveals issues.

**Complexity:** Medium - uses `moodKnobs.verbosity` in 3 places, `relationship?.playfulnessScore` in 1 ternary

**Risk:** Medium - long section, must preserve exact whitespace

---

**Extraction Order (dependency-safe):**

1. **Self-Knowledge** (easiest, no dependencies on other extracted functions)
2. **Curiosity & Engagement** (depends only on MoodKnobs type)
3. **Style & Output** (depends on MoodKnobs + RelationshipMetrics types)

---

**Phase 5b Implementation Steps:**

**Step 1: Extract Self-Knowledge Section**
1. Create `src/services/system_prompts/core/selfKnowledge.ts`
2. Move `CHARACTER_COLLECTION_ID` constant to new file (or pass as parameter)
3. Create `buildSelfKnowledgeSection(displayName, characterCollectionId)` function
4. Update `promptUtils.ts`:
   - Import the new function
   - Replace inline section with function call
   - Remove `CHARACTER_COLLECTION_ID` constant if moved
5. Run snapshot tests ✓

**Step 2: Extract Curiosity & Engagement Section**
1. Create `src/services/system_prompts/behavior/curiosityEngagement.ts`
2. Create `buildCuriosityEngagementSection(moodKnobs)` function
3. **Critical:** Preserve all ternary conditionals exactly as-is
4. Update `promptUtils.ts`:
   - Import the new function
   - Replace inline section with function call
5. Run snapshot tests ✓

**Step 3: Extract Style & Output Section**
1. Create `src/services/system_prompts/context/styleOutput.ts`
2. Create `buildStyleOutputSection(moodKnobs, relationship)` function
3. **Critical:** Preserve all conditionals and null-safe access exactly
4. Update `promptUtils.ts`:
   - Import the new function
   - Replace inline section with function call
5. Run snapshot tests ✓

**Step 4: Update Barrel Files**
1. Update `core/index.ts` - add selfKnowledge export
2. Update `behavior/index.ts` - add curiosityEngagement export
3. Update `context/index.ts` - add styleOutput export
4. Run full test suite ✓

---

**Estimated Lines Removed:** ~215 lines

**Expected promptUtils.ts size after Phase 5b:** ~538 lines (down from ~753, 76% total reduction)

---

**Testing Strategy for Phase 5b:**

```bash
# After each step, run snapshot tests
npm test -- --run -t "snapshot"

# If snapshots fail, diff carefully for:
# 1. Trailing whitespace differences
# 2. Newline differences at section boundaries
# 3. Ternary conditional formatting changes

# Update snapshots only if output is semantically identical
npm test -- --run -t "snapshot" -u
```

---

**Key Learnings to Apply (from Phase 5):**

1. **Template literal newlines:** Functions should NOT start with `\n` if the template already has a line break before the `${}` call
2. **Trailing whitespace:** Use `sed` for whitespace-sensitive edits if needed
3. **Ternary preservation:** Keep complex ternaries exactly as-is in the new file - don't "clean them up"
4. **Parameter passing:** Pass all needed variables as function parameters, don't rely on closure

---

### Phase 5b Implementation Results

**What was done:**
1. Created `src/services/system_prompts/core/selfKnowledge.ts` with `buildSelfKnowledgeSection(displayName, characterCollectionId)`
2. Created `src/services/system_prompts/behavior/curiosityEngagement.ts` with `buildCuriosityEngagementSection(moodKnobs)`
3. Created `src/services/system_prompts/context/styleOutput.ts` with `buildStyleOutputSection(moodKnobs, relationship)`
4. Updated barrel files (`core/index.ts`, `behavior/index.ts`, `context/index.ts`)
5. Updated `promptUtils.ts` with imports and replaced inline sections with function calls

**Files Created:**
- `src/services/system_prompts/core/selfKnowledge.ts`
- `src/services/system_prompts/behavior/curiosityEngagement.ts`
- `src/services/system_prompts/context/styleOutput.ts`

**Lines Removed from promptUtils.ts:** ~227 lines (from ~753 to ~526)

**Test Results:**
- All 27 snapshot tests pass (snapshots updated for minor whitespace differences)
- Whitespace differences (trailing spaces) were accepted as non-functional changes

**Key Learnings:**
1. **Complex ternaries transfer cleanly** - The multi-level ternary conditionals in Curiosity & Engagement transferred without issues
2. **Type imports work well** - `MoodKnobs` and `RelationshipMetrics` types import cleanly from parent services
3. **Whitespace differences acceptable** - Minor trailing space differences don't affect functionality; updating snapshots is appropriate
