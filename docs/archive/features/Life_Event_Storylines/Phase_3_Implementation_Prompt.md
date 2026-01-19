# Phase 3: Life Event Storylines - Emotional Integration Implementation Prompt

**Context Window:** Use this prompt in a fresh Claude Code session to implement Phase 3.

---

## 📋 What You're Implementing

**Feature:** Life Event Storylines - Phase 3 (Emotional Integration)

**Goal:** Make active storylines affect Kayley's mood and energy levels, so ongoing life events influence her emotional state in conversation.

**Status:** Phases 1 & 2 are COMPLETE. Phase 3 needs implementation.

---

## ✅ What's Already Completed (Phases 1-2)

### Phase 1: Data Foundation ✅
- Database tables exist: `life_storylines`, `storyline_updates`
- Service exists: `src/services/storylineService.ts`
- CRUD operations work: create, read, update, delete storylines
- Migrations applied (user has done this)

### Phase 2: Phase Progression ✅
- Automatic phase transitions work (announced → honeymoon → reality → active → climax → resolving → resolved)
- LLM update generation works (Gemini generates realistic updates)
- Daily scheduler works (`src/services/storylineProcessor.ts` runs every 24 hours)
- Integrated into `App.tsx` (background job running)

**What Phase 2 does:**
- Storylines progress through phases automatically over days/weeks
- Updates generate based on phase-specific intervals
- All configured with `PHASE_BEHAVIORS` array in `storylineService.ts`

---

## 🎯 What Phase 3 Needs to Do

**Goal:** Integrate storylines with Kayley's mood system so that:
1. Active storylines affect her mood (positive/negative delta)
2. Active storylines affect her energy (drain/boost)
3. Active storylines affect her mental "preoccupation" (how much headspace it takes)
4. These effects sum up and influence her overall emotional state

**Example:**
- Storyline in "climax" phase (stressed about decision) → mood -0.3, energy -0.1, preoccupation 0.9
- Storyline in "honeymoon" phase (excited about new thing) → mood +0.4, energy 0, preoccupation 0.5
- Net effect: Kayley is slightly stressed but hopeful

---

## 📁 Key Files to Read

### MUST READ FIRST:

1. **Feature Specification:**
   - `docs/features/Life_Event_Storylines.md`
   - Lines 346-402: Emotional Texture & Mood Integration section
   - Lines 770-843: PHASE_BEHAVIORS configuration (already implemented in Phase 2)

2. **Current Service Implementation:**
   - `src/services/storylineService.ts`
   - Lines 770-843: PHASE_BEHAVIORS array (has moodImpact values)
   - Lines 676-701: `getStorylineMoodEffects()` function (STUBBED - needs implementation)

3. **Mood System Integration Point:**
   - `src/services/moodKnobs.ts`
   - This is where storyline effects need to be added
   - Look for existing mood calculation logic

4. **Phase 2 Summary (for context):**
   - `docs/Phase_2_Storylines_Implementation_Summary.md`

### HELPFUL REFERENCE:

5. **Service Documentation:**
   - `src/services/docs/StorylineService.md`
   - Lines 554-591: Mood Integration section (shows interface and planned behavior)

---

## 🔨 What Needs to Be Implemented

### Task 1: Implement `getStorylineMoodEffects()` in `storylineService.ts`

**Location:** `src/services/storylineService.ts` around line 691

**Current status:** Stubbed with console.log, returns empty array

**What it needs to do:**
1. Get all active storylines (outcome is null)
2. For each storyline, calculate:
   - `moodDelta`: from PHASE_BEHAVIORS[phase].moodImpact × emotionalIntensity
   - `energyDelta`: -0.1 × emotionalIntensity for stressful phases (reality, active, climax), 0 otherwise
   - `preoccupation`: phase-specific value × emotionalIntensity
3. Return array of `StorylineMoodEffect` objects

**Interface to implement:**
```typescript
export interface StorylineMoodEffect {
  storylineId: string;
  phase: StorylinePhase;
  currentEmotion: string | null;
  moodDelta: number;        // -1 to 1
  energyDelta: number;      // -1 to 1
  preoccupation: number;    // 0 to 1, how much mental space this takes
}
```

**Preoccupation values by phase (from spec):**
```typescript
const preoccupationByPhase: Record<StorylinePhase, number> = {
  announced: 0.8,
  honeymoon: 0.5,
  reality: 0.6,
  active: 0.4,
  climax: 0.9,
  resolving: 0.7,
  resolved: 0.2,
  reflecting: 0.1,
};
```

**Reference:** See lines 353-402 in `Life_Event_Storylines.md` for full algorithm

---

### Task 2: Integrate with Mood System (`moodKnobs.ts`)

**Location:** `src/services/moodKnobs.ts`

**What needs to happen:**
1. Import `getStorylineMoodEffects` from storylineService
2. Call it during mood state calculation
3. Sum up all moodDelta values and add to mood calculation
4. Sum up all energyDelta values and add to energy calculation
5. (Optional) Use preoccupation values for future features

**Pattern to follow:**
```typescript
// In moodKnobs.ts mood calculation function
import { getStorylineMoodEffects } from './storylineService';

// During mood calculation
const storylineEffects = await getStorylineMoodEffects();
const storylineMoodDelta = storylineEffects.reduce((sum, e) => sum + e.moodDelta, 0);
const storylineEnergyDelta = storylineEffects.reduce((sum, e) => sum + e.energyDelta, 0);

// Add to existing mood/energy calculations
finalMood = baseMood + storylineMoodDelta + otherModifiers;
finalEnergy = baseEnergy + storylineEnergyDelta + otherModifiers;
```

**Note:** You'll need to understand the existing mood calculation structure in `moodKnobs.ts` to integrate properly.

---

### Task 3: Add Logging

Use the `📖 [Storylines]` emoji prefix for all storyline-related logs.

Example logs:
```typescript
console.log(`📖 [Storylines] Calculating mood effects for ${activeStorylines.length} storyline(s)`);
console.log(`📖 [Storylines] Mood delta: ${storylineMoodDelta.toFixed(2)}, Energy delta: ${storylineEnergyDelta.toFixed(2)}`);
```

---

## 🧪 Testing Phase 3

**Manual testing steps:**

1. **Create a test storyline:**
```typescript
import { createStoryline } from './services/storylineService';

const storyline = await createStoryline({
  title: "Test: Stressful Project",
  category: "work",
  storylineType: "project",
  currentEmotionalTone: "anxious",
  emotionalIntensity: 0.8,  // High intensity
  stakes: "Testing mood effects",
});
```

2. **Update to stressful phase:**
```typescript
import { updateStoryline } from './services/storylineService';

await updateStoryline(storyline.id, {
  phase: "climax",  // High stress phase (moodImpact: -0.3)
});
```

3. **Check mood effects:**
```typescript
import { getStorylineMoodEffects } from './services/storylineService';

const effects = await getStorylineMoodEffects();
console.log('Mood effects:', effects);
// Should show: moodDelta around -0.24 (-0.3 × 0.8)
//              energyDelta around -0.08 (-0.1 × 0.8)
//              preoccupation around 0.72 (0.9 × 0.8)
```

4. **Verify mood system integration:**
- Check `moodKnobs.ts` calculations
- Verify mood/energy values change when storylines are active
- Verify values return to baseline when storylines are resolved

---

## 📊 Expected Results

**Before Phase 3:**
- Storylines exist and progress, but don't affect Kayley's mood
- Mood is calculated without considering ongoing storylines

**After Phase 3:**
- Active storylines in stressful phases (reality, climax) decrease mood and energy
- Active storylines in positive phases (honeymoon) increase mood
- Multiple storylines have cumulative effects
- Resolved storylines have minimal/no effect

**Example scenario:**
```
Active storylines:
1. "Brand Partnership" - honeymoon phase → mood +0.4
2. "Difficult Client" - climax phase → mood -0.3, energy -0.1

Net effect: mood +0.1, energy -0.1
Result: Kayley is slightly hopeful but a bit tired
```

---

## ⚠️ Important Notes

### 1. No user_id Field
This is a single-user system. No `user_id` parameter anywhere.

### 2. Mood System Architecture
The mood system uses:
- `mood_states` table in Supabase
- `moodKnobs.ts` for calculations
- Values typically range from -1 to 1 (or 0 to 1 depending on metric)

### 3. Don't Break Existing Mood Calculations
The mood system already has calculations. Your job is to ADD storyline effects to existing logic, not replace it.

### 4. Logging Standards
- Use `📖 [Storylines]` prefix
- Log calculated deltas for debugging
- Keep logs concise

### 5. Caching
If the mood system uses caching (check `moodKnobs.ts`), you may need to consider cache invalidation when storylines update.

---

## 🎓 Pattern Examples from Codebase

**How other services integrate with mood:**
- Look for existing mood modifiers in `moodKnobs.ts`
- Follow the same pattern for storyline effects

**Error handling pattern:**
```typescript
try {
  const effects = await getStorylineMoodEffects();
  // Use effects
} catch (error) {
  console.error('📖 [Storylines] Error calculating mood effects:', error);
  return []; // Return empty array on error
}
```

---

## ✅ Success Criteria

Phase 3 is complete when:
- [x] `getStorylineMoodEffects()` implemented and returns correct values
- [x] `moodKnobs.ts` integrated with storyline effects
- [x] Active storylines affect mood/energy calculations
- [x] Resolved storylines have minimal effect
- [x] Multiple storylines have cumulative effects
- [x] Code compiles without errors
- [x] Manual testing shows mood changes with storyline phases

---

## 📝 Deliverables

When you're done, create/update:
1. **Implementation Summary:** `docs/Phase_3_Storylines_Implementation_Summary.md`
2. **Update feature doc:** Mark Phase 3 as complete in `docs/features/Life_Event_Storylines.md`
3. **Update service doc:** Mark Phase 3 as complete in `src/services/docs/StorylineService.md`
   - Update Implementation Status section
   - Update `getStorylineMoodEffects()` function documentation
4. **Update Phase 4 prompt:** Create `docs/Phase_4_Implementation_Prompt.md` for next phase

---

## 🚀 Next Phase After This

**Phase 4: Prompt Integration**
- Make Kayley actually TALK about storylines in conversation
- Inject storyline context into system prompt (ONLY on 2nd user message)
- Surface unmentioned updates in greetings

---

## 💡 Getting Started

**Recommended order:**
1. Read `docs/features/Life_Event_Storylines.md` lines 346-402 (mood integration section)
2. Read current `storylineService.ts` to understand PHASE_BEHAVIORS structure
3. Implement `getStorylineMoodEffects()` function
4. Read `moodKnobs.ts` to understand existing mood calculation
5. Integrate storyline effects into mood calculation
6. Test with manual storyline creation
7. Create implementation summary document

**Questions to answer before starting:**
1. Where exactly in `moodKnobs.ts` should storyline effects be added?
2. What's the existing mood calculation structure?
3. Are there other mood modifiers I should follow as a pattern?
4. Is there caching that needs invalidation?

---

## 📚 Reference Documentation

**Full specs:**
- Feature spec: `docs/features/Life_Event_Storylines.md`
- Service API: `src/services/docs/StorylineService.md`
- Phase 1 summary: `docs/Phase_1_Storylines_Implementation_Summary.md`
- Phase 2 summary: `docs/Phase_2_Storylines_Implementation_Summary.md`

**Code files:**
- Storyline service: `src/services/storylineService.ts`
- Mood system: `src/services/moodKnobs.ts`
- State service: `src/services/stateService.ts` (if you need to query mood_states)

---

## 🎯 Summary

**What you're implementing:**
Make active storylines affect Kayley's mood and energy levels by:
1. Implementing `getStorylineMoodEffects()` to calculate mood/energy impacts
2. Integrating those effects into `moodKnobs.ts` mood calculations

**Estimated time:** Small task, ~1-2 hours

**Complexity:** Low - mostly integration work, algorithms are defined in spec

**Start by reading:** `docs/features/Life_Event_Storylines.md` lines 346-402

Good luck! 🚀
