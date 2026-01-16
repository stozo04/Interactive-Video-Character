# Phase 2: Life Event Storylines - Implementation Summary

**Date:** 2026-01-16
**Status:** ✅ COMPLETED
**Phase:** 2 of 6 (Phase Progression)

---

## What Was Implemented

### ✅ Phase Transition Logic

**File:** `src/services/storylineService.ts` (lines 546-736)

**What's Fully Implemented:**
- ✅ `PHASE_TRANSITIONS` configuration array (6 transition rules)
- ✅ Helper functions: `daysBetween()`, `findTransitionRule()`, `shouldTransition()`
- ✅ Fully implemented `checkPhaseTransitions()` with time-based probability logic
- ✅ Automatic phase progression (announced → honeymoon → reality → active → climax → resolving → resolved)

**How it works:**
- For each active storyline, calculates days in current phase
- If days >= maxDays, forces transition
- If days >= minDays, applies daily probability
- Logs all transitions with `📖` emoji

**Example transition:**
```typescript
// After 3 days in "announced" phase (maxDays = 3)
// → Forces transition to "honeymoon"
```

### ✅ LLM Update Generation

**File:** `src/services/storylineService.ts` (lines 752-1045)

**What's Fully Implemented:**
- ✅ `PHASE_BEHAVIORS` configuration (8 phases with guidance, emotions, update types, intervals)
- ✅ `shouldGenerateUpdate()` - determines when to generate updates based on time
- ✅ `buildUpdateGenerationPrompt()` - builds LLM prompt with full context
- ✅ `generateStorylineUpdate()` - calls Gemini to generate realistic updates
- ✅ JSON parsing with markdown cleanup
- ✅ Proper error handling and logging

**How it works:**
1. Gets phase behavior configuration
2. Checks if enough time has passed (phase-specific intervals)
3. Builds prompt with storyline context, previous updates, stakes
4. Calls Gemini LLM (temperature 0.7 for variety)
5. Parses JSON response: `{ updateType, content, emotionalTone }`
6. Creates update record in database

**Example prompt snippet:**
```
STORYLINE:
Title: Brand Partnership with Glossier
Phase: reality
Days in Phase: 5
Current Emotion: anxious
Previous Updates:
[processing] I keep thinking about that brand deal...
Stakes: First major partnership - could change everything

PHASE CONTEXT:
The rose-colored glasses are off. You're seeing the challenges...
```

### ✅ Daily Processing Job

**File:** `src/services/storylineService.ts` (lines 738-797)

**Function:** `processStorylineDay()`

**What it does:**
1. Calls `checkPhaseTransitions()` for all active storylines
2. For each active storyline, attempts to generate an update
3. Sets `should_mention_by` deadline (24 hours from now)
4. Logs all activity with detailed output

### ✅ Standalone Scheduler

**File:** `src/services/storylineProcessor.ts` (NEW FILE)

**What's Fully Implemented:**
- ✅ Scheduler that runs every 24 hours (configurable)
- ✅ Calls `processStorylineDay()` on schedule
- ✅ Prevents overlapping runs
- ✅ Start/stop/status functions
- ✅ Manual trigger for testing
- ✅ Comprehensive logging

**Configuration options:**
```typescript
export const STORYLINE_PROCESSOR_CONFIG = {
  checkIntervalMs: 24 * 60 * 60 * 1000,  // 24 hours
  runImmediatelyOnStart: false,  // Set true for testing
  enabled: true,
};
```

---

## Files Created/Modified

```
src/services/
├── storylineService.ts (MODIFIED)
│   ├── PHASE_TRANSITIONS configuration (lines 562-616)
│   ├── PHASE_BEHAVIORS configuration (lines 770-843)
│   ├── checkPhaseTransitions() - IMPLEMENTED (lines 682-736)
│   ├── generateStorylineUpdate() - IMPLEMENTED (lines 971-1045)
│   └── processStorylineDay() - IMPLEMENTED (lines 750-797)
└── storylineProcessor.ts (NEW)
    ├── Scheduler with 24-hour interval
    ├── Start/stop/status functions
    └── Manual trigger for testing

docs/
└── Phase_2_Storylines_Implementation_Summary.md (this file)
```

---

## What You Need to Do Next

### Step 1: Apply Database Migrations (if not done in Phase 1)

If you haven't applied the Phase 1 migrations yet:

```bash
cd C:/Users/gates/Personal/Interactive-Video-Character
npx supabase db push
```

Or manually:
```bash
supabase migration up 20260116_create_life_storylines.sql
supabase migration up 20260116_create_storyline_updates.sql
supabase migration up 20260116_migrate_life_events_to_storylines.sql
```

### Step 2: Integrate Scheduler into App.tsx

Add the scheduler to your app initialization:

**1. Add import at top of App.tsx:**
```typescript
import { startStorylineProcessor, stopStorylineProcessor } from './services/storylineProcessor';
```

**2. Add useEffect hook (around line 307, after promise checker):**
```typescript
// Storyline Processor: Daily background job for storyline progression
useEffect(() => {
  try {
    startStorylineProcessor();
    return () => {
      stopStorylineProcessor();
    };
  } catch (e) {
    console.log(`❌ [Storylines] Error starting processor:`, e);
  }
}, []);
```

### Step 3: Test Phase Progression

**Option A: Manual Testing (Recommended First)**

Open browser console and run:

```javascript
// Import the service
import { checkPhaseTransitions, generateStorylineUpdate, getActiveStorylines } from './services/storylineService';

// Check transitions manually
await checkPhaseTransitions();

// Get active storylines
const storylines = await getActiveStorylines();
console.log('Active storylines:', storylines);

// Generate update for first storyline
if (storylines.length > 0) {
  const update = await generateStorylineUpdate(storylines[0]);
  console.log('Generated update:', update);
}
```

**Option B: Trigger Scheduler Immediately**

Set in `storylineProcessor.ts`:
```typescript
runImmediatelyOnStart: true,
```

**Option C: Test with Short Interval**

For rapid testing, temporarily change interval:
```typescript
// In storylineProcessor.ts
checkIntervalMs: 1 * 60 * 1000,  // 1 minute (TESTING ONLY)
```

### Step 4: Verify End-to-End Flow

Create a test storyline and verify full lifecycle:

```typescript
import { createStoryline, addStorylineUpdate } from './services/storylineService';

// 1. Create test storyline
const storyline = await createStoryline({
  title: "Test Project: Learning React",
  category: "personal",
  storylineType: "goal",
  currentEmotionalTone: "excited",
  emotionalIntensity: 0.7,
  initialAnnouncement: "I'm finally going to learn React properly!",
  stakes: "Want to level up my development skills",
});

console.log('Created storyline:', storyline);

// 2. Wait 1+ days (or manually update phase_started_at to trigger transition)
// Check logs for automatic phase transition

// 3. Verify update generation
// Check logs for LLM-generated updates

// 4. Verify database
// Check life_storylines and storyline_updates tables in Supabase
```

---

## What Phase 2 Does NOT Include

**No Integrations Yet:**
- ❌ System prompt integration (Phase 4)
- ❌ Mood system integration (Phase 3)
- ❌ Greeting integration (Phase 4)

**Current State:**
- Phase transitions work automatically ✅
- Updates generate automatically ✅
- But Kayley doesn't mention storylines yet (Phase 4)
- Storylines don't affect mood yet (Phase 3)

---

## Design Decisions Made

### 1. Hybrid Progression Model (Confirmed)
- **System** handles timing (phase transitions, update intervals)
- **LLM** handles content (update generation, emotional tone)

### 2. Time-Based Probability
- minDays: Earliest transition can happen
- maxDays: Forced transition (prevents stagnation)
- probability: Daily chance between min and max

### 3. Update Interval by Phase
```
announced: 1 day    (high activity)
honeymoon: 2 days
reality: 2 days
active: 3 days      (low activity, working)
climax: 1 day       (high stakes)
resolving: 1 day    (processing emotions)
resolved: 7 days    (weekly reflections)
reflecting: 30 days (monthly callbacks)
```

### 4. Mention Deadlines
- Set to 24 hours after update generation
- Used in Phase 4 to surface updates in greeting

### 5. Logging Emoji: 📖
- All storyline logs use `📖 [Storylines]` prefix
- Easy visual scanning in console

---

## Next Phase: Phase 3 (Emotional Integration)

**What needs to be implemented:**

1. **Mood System Integration**
   - Implement `getStorylineMoodEffects()`
   - Calculate moodDelta, energyDelta, preoccupation
   - Integrate with `moodKnobs.ts`

2. **Emotional Variation**
   - Generate daily emotional states
   - Vary intensity day-to-day
   - Affect Kayley's overall mood

**Estimated Effort:** Small (mostly integration work)

---

## Testing Checklist (Manual - Phase 2)

- [ ] Scheduler starts successfully (check console logs)
- [ ] Create a test storyline
- [ ] Wait for phase transition (or trigger manually)
- [ ] Verify phase updates in database
- [ ] Wait for update generation (or trigger manually)
- [ ] Verify updates created in `storyline_updates` table
- [ ] Check `should_mention_by` deadlines are set
- [ ] Verify no errors in console

---

## Known Limitations (Phase 2)

1. **No system prompt integration** - Kayley doesn't talk about storylines yet
2. **No mood effects** - Storylines don't affect Kayley's mood
3. **No greeting integration** - Updates don't surface in greetings
4. **Manual storyline creation** - No automatic life event → storyline conversion
5. **No closure sequences** - Resolutions are simple (Phase 5)

All of these will be addressed in future phases.

---

## Troubleshooting

### Problem: Phase transitions not happening

**Symptom:** Storylines stuck in same phase forever

**Causes:**
1. Scheduler not started
2. Not enough time passed
3. Probability didn't trigger

**Debug:**
```typescript
// Check if scheduler is running
import { isSchedulerRunning } from './services/storylineProcessor';
console.log('Scheduler running?', isSchedulerRunning());

// Manually trigger
import { checkPhaseTransitions } from './services/storylineService';
await checkPhaseTransitions();

// Check storyline age
import { getStorylineById } from './services/storylineService';
const storyline = await getStorylineById('uuid-here');
const days = (Date.now() - storyline.phaseStartedAt.getTime()) / (1000 * 60 * 60 * 24);
console.log(`Days in phase: ${days}`);
```

### Problem: Updates not generating

**Symptom:** No new updates in database

**Causes:**
1. Not enough time passed since last update
2. LLM API key not set
3. Probability didn't trigger

**Debug:**
```typescript
// Check last update
import { getStorylineUpdates } from './services/storylineService';
const updates = await getStorylineUpdates('storyline-id');
console.log('Last update:', updates[updates.length - 1]);

// Check API key
console.log('API key set?', !!import.meta.env.VITE_GEMINI_API_KEY);

// Force update generation
import { generateStorylineUpdate } from './services/storylineService';
const update = await generateStorylineUpdate(storyline);
console.log('Generated update:', update);
```

### Problem: Scheduler running too often/rarely

**Fix:** Adjust `checkIntervalMs` in `storylineProcessor.ts`

```typescript
// For testing (runs every minute)
checkIntervalMs: 1 * 60 * 1000,

// For production (runs daily)
checkIntervalMs: 24 * 60 * 60 * 1000,
```

---

## Success Criteria for Phase 2

- [x] Phase transition logic implemented
- [x] LLM update generation implemented
- [x] Daily processing job implemented
- [x] Standalone scheduler created
- [ ] Scheduler integrated into App.tsx (user to do)
- [ ] Manual testing passed (user to verify)

**Status:** ✅ READY FOR INTEGRATION AND TESTING

Integrate the scheduler and test the phase progression. Once verified, Phase 3 (Mood Integration) can begin.

---

## Important Note for Phase 4

**System Prompt Integration:**
- Inject storyline context ONLY on the **second user message**
- NOT in greeting prompt
- NOT in every subsequent message
- This prevents token bloat while allowing Kayley to reference storylines early in conversation

---

## Questions or Issues?

**Read first:**
- `src/services/docs/StorylineService.md` - Complete documentation
- `docs/features/Life_Event_Storylines.md` - Full feature spec

**Check implementation plan:**
- Phase 3: Emotional Integration (lines 958-969)
- Phase 4: Prompt Integration (lines 970-975)

**Troubleshooting:**
- All errors logged with `📖 [Storylines]` prefix
- Functions return `null` or `[]` on error (never throw)
- Check console for detailed logs
