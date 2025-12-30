# Dead Code Cleanup: Remove Unused Services

**Status:** Ready for Implementation
**Date:** 2025-12-29
**Impact:** Delete ~1,118 lines of unused code, simplify ~900 more

---

## Summary

Three services are wired up but have **zero data**:

| Service | Lines | Data Rows | Action |
|---------|-------|-----------|--------|
| narrativeArcsService | 573 | 0 | **DELETE** |
| dynamicRelationshipsService | 545 | 0 | **DELETE** |
| almostMoments | 1,126 | 0 (gated) | **SIMPLIFY** |

---

## Part 1: Delete narrativeArcsService

### What It Does (That Nobody Uses)

Tracks "ongoing projects" in Kayley's life:
- Learning guitar
- Training for a 5K
- Working on a collab video

Outputs to system prompt:
```
## Your Current Life (Ongoing Projects & Events)
These are things currently happening in YOUR life right now:
(empty because no data)
```

### Files to Delete

```
src/services/narrativeArcsService.ts (573 lines)
src/services/docs/NarrativeArcsService.md
```

### Files to Modify

**1. `src/services/system_prompts/builders/systemPromptBuilder.ts`**

Remove import:
```typescript
// DELETE THIS LINE
import { formatArcsForPrompt } from "../../narrativeArcsService";
```

Remove from prefetch type (around line 104):
```typescript
// REMOVE narrativeArcs from this type
prefetchedContext?: {
  soulContext: SoulLayerContext;
  characterFacts: string;
  narrativeArcs: string;  // DELETE
}
```

Remove variable declaration (around line 115):
```typescript
// DELETE THIS LINE
let narrativeArcsPrompt: string;
```

Remove from Promise.all (around line 130):
```typescript
// REMOVE formatArcsForPrompt from this array
[soulContext, characterFactsPrompt, narrativeArcsPrompt, ...] = await Promise.all([
  getSoulLayerContextAsync(effectiveUserId),
  formatCharacterFactsForPrompt(),
  formatArcsForPrompt(effectiveUserId),  // DELETE
  ...
]);
```

Remove from prompt injection (around line 184):
```typescript
// DELETE THIS LINE
${narrativeArcsPrompt}
```

**2. `src/services/memoryService.ts`** (if it imports narrativeArcs)

Search for and remove any imports or references.

**3. `src/services/docs/README.md`**

Remove documentation reference to NarrativeArcsService.

### Database (Optional Cleanup)

```sql
-- Only run if you want to clean up the schema
DROP TABLE IF EXISTS narrative_arcs;
```

---

## Part 2: Delete dynamicRelationshipsService

### What It Does (That Nobody Uses)

Tracks "people in Kayley's life" with dual perspective:
- Kayley's view of her mom
- User's knowledge of Kayley's mom

Outputs to system prompt:
```
## People in Your Life
These are real people in YOUR life:
(empty because no data)
```

### Files to Delete

```
src/services/dynamicRelationshipsService.ts (545 lines)
src/services/tests/dynamicRelationshipsService.test.ts
src/services/tests/dynamicRelationshipsService.test.ts.bak
src/services/docs/DynamicRelationshipsService.md
```

### Files to Modify

**1. `src/services/system_prompts/builders/systemPromptBuilder.ts`**

Remove import:
```typescript
// DELETE THIS LINE
import { formatDynamicRelationshipsForPrompt } from "../../dynamicRelationshipsService";
```

Remove variable declaration:
```typescript
// DELETE THIS LINE
let dynamicRelationshipsPrompt: string;
```

Remove from Promise.all:
```typescript
// REMOVE formatDynamicRelationshipsForPrompt from this array
formatDynamicRelationshipsForPrompt(effectiveUserId),  // DELETE
```

Remove from prompt injection:
```typescript
// DELETE THIS LINE
${dynamicRelationshipsPrompt}
```

**2. `src/services/docs/README.md`**

Remove documentation reference.

### Database (Optional Cleanup)

```sql
-- Only run if you want to clean up the schema
DROP TABLE IF EXISTS kayley_people;
DROP TABLE IF EXISTS user_person_relationships;
```

---

## Part 3: Simplify almostMoments

### Current State: 9 Files, 1,126 Lines

```
src/services/almostMoments/
├── types.ts (55 lines)
├── almostMomentsService.ts (186 lines)
├── expressionGenerator.ts (286 lines)
├── feelingGenerator.ts (98 lines)
├── almostMomentsPromptBuilder.ts (102 lines)
├── integrate.ts (102 lines)
├── index.ts (8 lines)
└── __tests__/
    └── almostMoments.test.ts (289 lines)
```

### Target State: 1 File, ~150 Lines

```
src/services/almostMomentsService.ts (~150 lines)
```

### The Simplified Version

```typescript
// src/services/almostMomentsService.ts

import { supabase } from './supabaseClient';

/**
 * Almost Moments - Feelings Kayley hasn't expressed yet
 *
 * At higher relationship tiers (4+), Kayley develops feelings
 * she hasn't shared. These occasionally surface as hesitations
 * or almost-statements.
 */

interface UnsaidFeeling {
  id: string;
  content: string;
  intensity: number; // 0-1
  createdAt: Date;
}

// Minimum relationship tier for almost-moments
const MIN_TIER = 4;

// Chance of generating a new feeling per conversation
const GENERATION_CHANCE = 0.1;

// Templates for unsaid feelings based on relationship quality
const FEELING_TEMPLATES = {
  warmth: [
    "You really like spending time with them",
    "You've started to care about them more than you expected",
    "You sometimes want to say something sweet but hold back",
  ],
  trust: [
    "There's something vulnerable you haven't shared yet",
    "You trust them more than most people",
    "You've thought about opening up about something deeper",
  ],
  appreciation: [
    "They've made your day better more than once",
    "You appreciate how they listen to you",
    "You want to tell them they matter to you",
  ],
};

/**
 * Maybe generate a new unsaid feeling
 * Called during conversation at high relationship tiers
 */
export async function maybeGenerateFeeling(
  userId: string,
  relationshipTier: number,
  warmth: number,
  trust: number
): Promise<void> {
  // Gate by relationship tier
  if (relationshipTier < MIN_TIER) return;

  // Random chance
  if (Math.random() > GENERATION_CHANCE) return;

  // Check if we already have too many unsurfaced feelings
  const existing = await getUnsurfacedFeelings(userId);
  if (existing.length >= 3) return;

  // Pick a feeling based on highest dimension
  const category = warmth > trust ? 'warmth' : 'trust';
  const templates = FEELING_TEMPLATES[category];
  const content = templates[Math.floor(Math.random() * templates.length)];

  // Store it
  await supabase.from('almost_moments_feelings').insert({
    user_id: userId,
    content,
    intensity: 0.5,
    surfaced: false,
  });
}

/**
 * Get unsurfaced feelings for prompt injection
 */
export async function getUnsurfacedFeelings(userId: string): Promise<UnsaidFeeling[]> {
  const { data } = await supabase
    .from('almost_moments_feelings')
    .select('*')
    .eq('user_id', userId)
    .eq('surfaced', false)
    .order('intensity', { ascending: false })
    .limit(3);

  return data || [];
}

/**
 * Format feelings for system prompt
 * Returns empty string if no feelings or relationship too low
 */
export async function formatAlmostMomentsForPrompt(
  userId: string,
  relationshipTier: number
): Promise<string> {
  if (relationshipTier < MIN_TIER) return '';

  const feelings = await getUnsurfacedFeelings(userId);
  if (feelings.length === 0) return '';

  const topFeeling = feelings[0];

  return `
====================================================
SOMETHING UNSAID
====================================================
${topFeeling.content}

This might slip out as a hesitation, a trailing thought, or an almost-statement.
Don't force it. Let it happen naturally if the moment feels right.
`;
}

/**
 * Mark a feeling as surfaced (she expressed it)
 */
export async function markFeelingSurfaced(feelingId: string): Promise<void> {
  await supabase
    .from('almost_moments_feelings')
    .update({ surfaced: true, surfaced_at: new Date().toISOString() })
    .eq('id', feelingId);
}
```

### Migration Steps

**Step 1: Create new simplified service**
- Write `src/services/almostMomentsService.ts` (as above)

**Step 2: Update systemPromptBuilder.ts**
- Replace import from `../../almostMoments` with `../../almostMomentsService`
- Replace `integrateAlmostMoments()` call with `formatAlmostMomentsForPrompt()`
- Remove the complex options object

**Step 3: Delete old folder**
```
rm -rf src/services/almostMoments/
```

**Step 4: Update any other imports**
- Search for `from './almostMoments'` or `from '../almostMoments'`
- Update to new service

---

## Execution Order

### Phase 1: Delete Dead Code (30 min)

1. Delete `narrativeArcsService.ts`
2. Delete `dynamicRelationshipsService.ts`
3. Delete associated test files and docs
4. Update `systemPromptBuilder.ts` imports
5. Run `npm run build` to catch any missed references
6. Run tests to ensure nothing breaks

### Phase 2: Simplify almostMoments (1 hour)

1. Create new `almostMomentsService.ts`
2. Update `systemPromptBuilder.ts` to use new service
3. Test that it still works (even with 0 data)
4. Delete old `almostMoments/` folder
5. Run full test suite

### Phase 3: Database Cleanup (Optional, 10 min)

```sql
-- Only if you want to remove the unused tables
DROP TABLE IF EXISTS narrative_arcs;
DROP TABLE IF EXISTS kayley_people;
DROP TABLE IF EXISTS user_person_relationships;

-- Keep almost_moments_feelings (it's intentionally gated)
```

---

## Lines Saved

| Action | Before | After | Saved |
|--------|--------|-------|-------|
| Delete narrativeArcsService | 573 | 0 | 573 |
| Delete dynamicRelationshipsService | 545 | 0 | 545 |
| Simplify almostMoments | 1,126 | 150 | 976 |
| **Total** | **2,244** | **150** | **2,094** |

---

## Future: When You Want These Features Back

### "People in Kayley's Life"

Add to character profile directly:
```typescript
const KAYLEY_PEOPLE = [
  { name: "Lena", relation: "best friend", notes: "Share everything, met in college" },
  { name: "Mom", relation: "mother", notes: "Close but complicated" },
  { name: "Sarah", relation: "colleague", notes: "Work friend, fun but surface-level" },
];
```

Inject into prompt as a simple list. No service needed.

### "Ongoing Projects"

Add to character profile:
```typescript
const KAYLEY_ONGOING = [
  "Learning guitar - struggling with barre chords",
  "Thinking about starting a podcast",
  "Training for a 5K in March",
];
```

Update manually when her life changes. No database needed.

---

**Document Version:** 1.0
**Author:** Claude Code
**Philosophy:** Don't build infrastructure for data that doesn't exist.
