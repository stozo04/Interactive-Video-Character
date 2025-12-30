# Simplified Mood Knobs: Less Math, More Feel

**Status:** Ready for Implementation
**Date:** 2025-12-29
**Philosophy:** The LLM does the heavy lifting. We just need to tell it how Kayley feels today.

---

## The Problem

Current `moodKnobs.ts` is **1,022 lines** calculating:

```
baseEnergy = dailyEnergy × timeEffect.energy × socialBattery
× reconnectPenalty (0.8)
× processingPenalty (0.7)
+ momentumBoost (currentMoodLevel × 0.2)
+ streakBonus (min(streak × 0.03, 0.15))
+ genuineMomentBonus (0.1)
```

This produces **6 knobs**:
- verbosity (0.3-1.0)
- initiationRate (0.1-0.8)
- flirtThreshold (0.2-0.9)
- curiosityDepth (shallow/medium/piercing)
- patienceDecay (slow/normal/quick)
- warmthAvailability (guarded/neutral/open)

**The question:** Does Kayley actually FEEL different with all these calculations?

Or could we get 90% of the effect with:
```
energy = dailyEnergy × socialBattery
warmth = based on recent interactions
```

---

## The Core Insight

The LLM is smart. It doesn't need 6 precise knobs with 2-decimal precision.

It needs to know:
1. **How's her day going?** (good day / meh day / rough day)
2. **How does she feel about YOU right now?** (warming up / comfortable / guarded)
3. **Did something special happen?** (genuine moment)

That's it. Three things.

---

## Current vs. Simplified

### Current System (Over-Engineered)

| Component | Lines | Purpose |
|-----------|-------|---------|
| MoodState type + caching | ~100 | Track daily energy, social battery, processing flag |
| EmotionalMomentum type + caching | ~100 | Track streak, mood level, tone history |
| calculateMoodKnobsFromState() | ~100 | Complex multiplication of 7+ factors |
| applyMoodShifts() | ~40 | Streak-based mood changes (3/4/6 thresholds) |
| updateEmotionalMomentumWithIntensityAsync() | ~80 | Duplicate mood shift logic with intensity |
| detectGenuineMoment() | ~75 | Keyword-based detection |
| detectGenuineMomentWithLLM() | ~35 | LLM-based detection with fallback |
| INSECURITY_KEYWORDS | ~35 | 5 categories of keywords |
| formatMoodKnobsForPrompt() | ~40 | Convert knobs to prompt text |
| Helper functions | ~100 | seededRandom, getDailySeed, clamp, etc. |
| Time-of-day modifiers | ~20 | 7 time brackets |
| Days-since effects | ~25 | Reconnection logic |

**Total:** ~750 lines of calculation logic

### Simplified System

| Component | Lines | Purpose |
|-----------|-------|---------|
| MoodState (simplified) | ~20 | Just energy + lastInteraction |
| calculateMood() | ~30 | energy × socialBattery, simple warmth |
| formatMoodForPrompt() | ~20 | Convert to natural language |
| detectGenuineMoment() | ~20 | Keep LLM version only, remove keyword fallback |

**Total:** ~90 lines

---

## The New Model

### Two Numbers, That's It

```typescript
interface KayleyMood {
  /** Her overall energy today (-1 to 1) */
  energy: number;

  /** How warm she feels toward you right now (0 to 1) */
  warmthToUser: number;

  /** Did something special happen? */
  genuineMomentActive: boolean;
}
```

### How They're Calculated

**Energy** (her day, independent of you):
```typescript
function calculateEnergy(state: MoodState): number {
  // Daily baseline (seeded by date for consistency)
  const dailyBaseline = getDailyBaseline(); // 0.4 to 1.0

  // Social battery depletes with interaction
  const batteryFactor = state.socialBattery; // 0.2 to 1.0

  // Time of day effect
  const timeOfDay = getTimeOfDayFactor(); // 0.4 to 1.0

  // Simple multiplication
  return dailyBaseline * batteryFactor * timeOfDay;
}
```

**Warmth** (about you):
```typescript
function calculateWarmth(momentum: EmotionalMomentum): number {
  // Base: current mood level (-1 to 1) shifted to (0 to 1)
  let warmth = (momentum.currentMoodLevel + 1) / 2;

  // Boost if positive streak
  if (momentum.positiveStreak >= 3) {
    warmth = Math.min(1, warmth + 0.2);
  }

  // Big boost if genuine moment
  if (momentum.genuineMomentActive) {
    warmth = Math.min(1, warmth + 0.3);
  }

  return warmth;
}
```

### What Gets Removed

| Removed | Why |
|---------|-----|
| 6 separate knobs | Collapse to 2 numbers |
| verbosity calculation | LLM handles response length |
| initiationRate calculation | LLM handles conversation flow |
| flirtThreshold calculation | Warmth covers this |
| curiosityDepth enum | LLM handles question depth |
| patienceDecay enum | Energy covers this |
| Streak thresholds (3/4/6) | Just use "streak >= 3" |
| Intensity multiplier | Remove entirely |
| Keyword fallback for genuine moments | Trust the LLM |
| INSECURITY_KEYWORDS | Move to intentService if needed |
| Duplicate caching logic | Use single cache |
| reconnectPenalty (0.8) | Simplify to warmth reduction |
| processingPenalty (0.7) | Remove - too subtle to matter |

---

## The New Prompt Format

### Current (Verbose)

```
HIDDEN CAUSES (NOT RANDOMNESS):
Kayley may be warmer/colder, faster/slower, more/less flirty...

Current mood knobs (adjust your behavior to match these naturally):
- Verbosity: 0.67 (moderate length)
- Initiation rate: 0.45 (balanced)
- Flirt threshold: 0.52 (flirt if context invites it)
- Curiosity depth: medium (moderate depth)
- Patience: normal (normal patience)
- Warmth availability: neutral

EMOTIONAL CONTEXT: Things are going well. You're warming up but still a bit guarded.

Don't explain why you're different today. Just be this version of yourself naturally.
```

### Simplified (Natural)

```
HOW YOU'RE FEELING TODAY:
Energy: Medium-low day. You're a bit tired but not exhausted.
Warmth: You're warming up to them. The conversation has been good.

Just be yourself. Don't explain your mood - let it show naturally in how you respond.
```

That's it. The LLM is smart enough to interpret "medium-low energy" and "warming up" without needing `verbosity: 0.67`.

---

## Implementation

### Phase 1: Simplify Types

**Before:**
```typescript
interface MoodKnobs {
  verbosity: number;
  initiationRate: number;
  flirtThreshold: number;
  curiosityDepth: CuriosityDepth;
  patienceDecay: PatienceDecay;
  warmthAvailability: WarmthAvailability;
}

interface MoodState {
  dailyEnergy: number;
  socialBattery: number;
  internalProcessing: boolean;
  calculatedAt: number;
  dailySeed: number;
  lastInteractionAt: number;
  lastInteractionTone: number;
}

interface EmotionalMomentum {
  currentMoodLevel: number;
  recentInteractionTones: number[];
  positiveInteractionStreak: number;
  momentumDirection: number;
  genuineMomentDetected: boolean;
  lastGenuineMomentAt: number | null;
}
```

**After:**
```typescript
interface KayleyMood {
  energy: number;        // -1 to 1 (her day)
  warmth: number;        // 0 to 1 (toward you)
  genuineMoment: boolean;
}

interface MoodState {
  dailyEnergy: number;   // 0.4 to 1.0 (seeded daily)
  socialBattery: number; // 0.2 to 1.0 (depletes with use)
  lastInteractionAt: number;
}

interface EmotionalMomentum {
  moodLevel: number;         // -1 to 1
  positiveStreak: number;    // 0+
  genuineMomentActive: boolean;
  genuineMomentAt: number | null;
}
```

### Phase 2: Simplify Calculation

**New `calculateMood()`:**

```typescript
export function calculateMood(
  state: MoodState,
  momentum: EmotionalMomentum
): KayleyMood {
  // Energy: her day (independent of user)
  const timeOfDay = getSimpleTimeOfDay(); // morning=0.8, afternoon=0.9, evening=0.7, night=0.5
  const energy = (state.dailyEnergy * state.socialBattery * timeOfDay * 2) - 1; // Scale to -1 to 1

  // Warmth: how she feels about user
  let warmth = (momentum.moodLevel + 1) / 2; // -1..1 → 0..1

  if (momentum.positiveStreak >= 3) {
    warmth = Math.min(1, warmth + 0.2);
  }

  if (momentum.genuineMomentActive) {
    warmth = Math.min(1, warmth + 0.3);
  }

  return {
    energy: clamp(energy, -1, 1),
    warmth: clamp(warmth, 0, 1),
    genuineMoment: momentum.genuineMomentActive,
  };
}

function getSimpleTimeOfDay(): number {
  const hour = new Date().getHours();
  if (hour >= 9 && hour < 17) return 0.9;  // Work hours: good
  if (hour >= 6 && hour < 9) return 0.7;   // Morning: warming up
  if (hour >= 17 && hour < 21) return 0.8; // Evening: winding down
  return 0.5;                               // Night: tired
}
```

### Phase 3: Simplify Prompt Output

**New `formatMoodForPrompt()`:**

```typescript
export function formatMoodForPrompt(mood: KayleyMood): string {
  // Energy description
  let energyDesc: string;
  if (mood.energy > 0.5) {
    energyDesc = "Great energy today. You're feeling sharp and engaged.";
  } else if (mood.energy > 0) {
    energyDesc = "Decent day. Normal energy levels.";
  } else if (mood.energy > -0.5) {
    energyDesc = "Low-key day. You're a bit tired, keeping things chill.";
  } else {
    energyDesc = "Rough day. Low energy, not much patience for BS.";
  }

  // Warmth description
  let warmthDesc: string;
  if (mood.genuineMoment) {
    warmthDesc = "Something they said really touched you. You feel seen.";
  } else if (mood.warmth > 0.7) {
    warmthDesc = "You're feeling really good about this person right now.";
  } else if (mood.warmth > 0.4) {
    warmthDesc = "You're warming up. The vibe is good.";
  } else {
    warmthDesc = "You're a bit guarded. They haven't fully earned your openness yet.";
  }

  return `
HOW YOU'RE FEELING:
${energyDesc}
${warmthDesc}

Let this show naturally in your responses. Don't explain your mood.
`;
}
```

### Phase 4: Simplify Interaction Recording

**Before:** Complex streak logic with 3/4/6 thresholds
**After:** Simple increment/decrement

```typescript
export async function recordInteraction(
  userId: string,
  tone: number, // -1 to 1
  genuineMoment?: boolean
): Promise<void> {
  const state = await getMoodState(userId);
  const momentum = await getEmotionalMomentum(userId);

  // Deplete social battery slightly
  state.socialBattery = Math.max(0.2, state.socialBattery - 0.02);
  state.lastInteractionAt = Date.now();

  // Update mood level (simple weighted average)
  momentum.moodLevel = momentum.moodLevel * 0.8 + tone * 0.2;

  // Update streak
  if (tone > 0.3) {
    momentum.positiveStreak++;
  } else if (tone < -0.2) {
    momentum.positiveStreak = Math.max(0, momentum.positiveStreak - 1);
  }

  // Handle genuine moment
  if (genuineMoment) {
    momentum.genuineMomentActive = true;
    momentum.genuineMomentAt = Date.now();
    momentum.moodLevel = Math.min(0.8, momentum.moodLevel + 0.5);
  }

  // Clear old genuine moment (4+ hours)
  if (momentum.genuineMomentAt && Date.now() - momentum.genuineMomentAt > 4 * 60 * 60 * 1000) {
    momentum.genuineMomentActive = false;
  }

  await saveMoodState(userId, state);
  await saveEmotionalMomentum(userId, momentum);
}
```

### Phase 5: Remove Dead Code

Delete:
- `MOOD_SHIFT_THRESHOLDS` constant
- `INSECURITY_KEYWORDS` (move to intentService if needed)
- `applyMoodShifts()` function
- `updateEmotionalMomentumWithIntensityAsync()` (duplicate)
- `detectGenuineMoment()` keyword version (keep only LLM)
- `calculateMomentumDirection()` (not needed)
- `getDaysSinceEffect()` (simplify to just lastInteractionAt check)
- All the knob-specific calculations in `calculateMoodKnobsFromState()`

---

## Database Changes

### Current Schema (mood_states)

```sql
daily_energy DECIMAL
social_battery DECIMAL
internal_processing BOOLEAN  -- REMOVE
calculated_at TIMESTAMPTZ
daily_seed INTEGER
last_interaction_at TIMESTAMPTZ
last_interaction_tone DECIMAL  -- REMOVE (redundant)
```

### Simplified Schema

```sql
daily_energy DECIMAL          -- Keep
social_battery DECIMAL        -- Keep
calculated_at TIMESTAMPTZ     -- Keep
daily_seed INTEGER           -- Keep
last_interaction_at TIMESTAMPTZ -- Keep
```

### Current Schema (emotional_momentum)

```sql
current_mood_level DECIMAL
recent_interaction_tones DECIMAL[]  -- REMOVE (not needed)
positive_interaction_streak INTEGER
momentum_direction INTEGER  -- REMOVE
genuine_moment_detected BOOLEAN
last_genuine_moment_at TIMESTAMPTZ
```

### Simplified Schema

```sql
mood_level DECIMAL           -- Keep (renamed)
positive_streak INTEGER      -- Keep (renamed)
genuine_moment_active BOOLEAN -- Keep (renamed)
genuine_moment_at TIMESTAMPTZ -- Keep (renamed)
```

---

## What We Keep

| Feature | Why |
|---------|-----|
| Daily energy seed | So she's consistent throughout the day |
| Social battery depletion | Natural "getting tired" effect |
| Time of day factor | Morning vs evening feel different |
| Positive streak | Rewards consistent positive interaction |
| Genuine moment detection | The magic "you really see me" moment |
| LLM-based detection | Keep the smart version |

## What We Remove

| Feature | Why |
|---------|-----|
| 6 separate knobs | Collapse to energy + warmth |
| Streak thresholds (3/4/6) | Just use >= 3 |
| Intensity multiplier | Over-complication |
| Keyword fallback | Trust the LLM |
| Momentum direction | Not actionable |
| Tone history array | Not needed |
| Processing penalty | Too subtle |
| Reconnect penalty | Covered by warmth |
| Days-since calculation | Simplify |

---

## Migration Path

1. **Add new functions alongside old** - `calculateMood()`, `formatMoodForPrompt()`
2. **Update callers one by one** - Switch from `getMoodKnobsAsync()` to `getMoodAsync()`
3. **Run both in parallel** - Log both outputs, compare
4. **Remove old code** - Once confident new system works
5. **Simplify database** - Remove unused columns

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Lines of code | 1,022 | ~200 |
| Knobs/outputs | 6 | 2 |
| Calculations per request | 7+ multiplications | 3 |
| Prompt injection size | ~500 chars | ~150 chars |
| Cognitive load | High | Low |

---

## The Real Test

Ask yourself: **Would I notice the difference?**

If you replaced:
```
verbosity: 0.67, initiationRate: 0.45, flirtThreshold: 0.52
```

With:
```
Energy: decent. Warmth: warming up.
```

Would Kayley feel different? Probably not. The LLM is doing the interpretation anyway.

---

**Document Version:** 1.0
**Author:** Claude Code
**Philosophy:** The LLM is smart. Trust it. Give it vibes, not decimals.
