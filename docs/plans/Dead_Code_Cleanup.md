# Dead Code Cleanup Plan

**Philosophy**: Don't build infrastructure for data that doesn't exist.

---

## Part 1: Services with 0 Data Rows

### 1.1 Delete: narrativeArcsService.ts (573 lines)

**Location**: `src/services/narrativeArcsService.ts`

**Why it's dead**:
- Database table `narrative_arcs` has 0 rows
- Complex 3-act structure with tension tracking
- Never populated = never used

**Also delete**:
- `src/services/docs/NarrativeArcsService.md`
- Test files if any
- Imports in `systemPromptBuilder.ts`

**Migration**: Create SQL to drop `narrative_arcs` table

---

### 1.2 Delete: dynamicRelationshipsService.ts (545 lines)

**Location**: `src/services/dynamicRelationshipsService.ts`

**Why it's dead**:
- Database table `dynamic_relationships` has 0 rows
- Complex dual-perspective relationship tracking
- Never populated = never used

**Also delete**:
- `src/services/docs/DynamicRelationshipsService.md`
- Test files if any
- Imports in `systemPromptBuilder.ts`

**Migration**: Create SQL to drop `dynamic_relationships` table

---

### 1.3 Simplify: almostMoments/ (1,126 lines → ~150 lines)

**Location**: `src/services/almostMoments/`

**Current structure** (9 files):
```
almostMoments/
├── index.ts
├── types.ts
├── detectors/
│   ├── index.ts
│   ├── emotionalBidDetector.ts
│   ├── intimacySignalDetector.ts
│   └── microExpressionDetector.ts
├── managers/
│   ├── index.ts
│   └── almostMomentsManager.ts
└── utils/
    └── almostMomentsPromptUtils.ts
```

**Why simplify**:
- Database table `almost_moments_feelings` has 0 rows
- Intentionally gated by relationship level (KEEP the concept)
- Over-abstracted for what it does

**Simplified to 1 file** (~150 lines):
```typescript
// src/services/almostMomentsService.ts
export interface AlmostMoment {
  type: 'emotional_bid' | 'intimacy_signal' | 'microexpression';
  description: string;
  intensity: number; // 0-1
}

export async function detectAlmostMoment(
  message: string,
  relationshipTier: number
): Promise<AlmostMoment | null> {
  // Only active at tier 3+
  if (relationshipTier < 3) return null;

  // Simple keyword detection for now
  // Can enhance with LLM later when we have data
}

export function formatAlmostMomentsForPrompt(moments: AlmostMoment[]): string {
  // Simple formatting
}
```

---

## Part 2: Database Tables with No Code References

### 2.1 Delete: kayley_pending_shares

**Status**: TRUE DEAD
- No code references anywhere
- Table exists but nothing reads or writes to it

**Action**: Drop table

---

### 2.2 Delete: conversation_spontaneity_state

**Status**: TRUE DEAD
- Only referenced in documentation files
- No actual code reads or writes to it

**Action**: Drop table

---

### 2.3 Delete: spontaneous_selfie_history

**Status**: TRUE DEAD
- Only referenced in documentation files
- No actual code reads or writes to it

**Action**: Drop table

---

## Part 3: Database Tables with Orphaned Code

### 3.1 Delete: session_reflections + sessionReflection.ts

**Status**: DEAD - Code exists but never called

**Files to delete**:
- `src/services/spontaneity/sessionReflection.ts`
- Associated types

**Investigation showed**:
- `saveSessionReflection()` and `getSessionReflection()` exist
- Neither function is called from anywhere in the codebase
- Dead code with orphaned database table

**Action**:
- Delete the service file
- Drop table

---

### 3.2 Delete: visual_state_mapping + visualStateMapper.ts

**Status**: DEAD - Code exists but only self-references

**Files to delete**:
- `src/services/spontaneity/visualStateMapper.ts`
- Associated types

**Investigation showed**:
- `getVisualState()` and `mapMoodToVisual()` exist
- Only referenced within their own folder
- Not called from App.tsx, systemPromptBuilder, or any entry point

**Action**:
- Delete the service file
- Drop table

---

## Part 4: Delete Story Retelling

### 4.1 Delete: user_story_tracking + storyRetellingService.ts

**Status**: LIVE CODE PATH but 0 data - DELETE

**Files to delete**:
- `src/services/storyRetellingService.ts` (~300 lines)
- `src/services/docs/StoryRetellingService.md`
- Remove imports from `systemPromptBuilder.ts`

**Action**:
- Delete the service file
- Remove from systemPromptBuilder.ts
- Drop table

---

## Summary

| Item | Lines | Action |
|------|-------|--------|
| narrativeArcsService.ts | 573 | DELETE |
| dynamicRelationshipsService.ts | 545 | DELETE |
| almostMoments/ | 1,126 → 150 | SIMPLIFY |
| sessionReflection.ts | ~100 | DELETE |
| visualStateMapper.ts | ~150 | DELETE |
| kayley_pending_shares (table) | - | DROP |
| conversation_spontaneity_state (table) | - | DROP |
| spontaneous_selfie_history (table) | - | DROP |
| session_reflections (table) | - | DROP |
| visual_state_mapping (table) | - | DROP |
| storyRetellingService.ts | ~300 | DELETE |
| user_story_tracking (table) | - | DROP |

**Total estimated savings**: ~2,800 lines of code + 7 unused tables

---

## Execution Order

1. **Phase 1**: Delete pure dead tables (no code)
   - kayley_pending_shares
   - conversation_spontaneity_state
   - spontaneous_selfie_history

2. **Phase 2**: Delete orphaned code + tables
   - sessionReflection.ts + session_reflections table
   - visualStateMapper.ts + visual_state_mapping table

3. **Phase 3**: Delete services with 0 data
   - narrativeArcsService.ts + narrative_arcs table
   - dynamicRelationshipsService.ts + dynamic_relationships table

4. **Phase 4**: Delete story retelling
   - storyRetellingService.ts + user_story_tracking table
   - Remove imports from systemPromptBuilder.ts

5. **Phase 5**: Simplify almostMoments/
   - Create new simplified file
   - Update imports
   - Delete 9-file folder structure
