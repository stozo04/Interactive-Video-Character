# The Most Believable Person: Implementation Plan

> **Goal**: Make users forget they're talking to software.

---

## Core Principle: COHERENCE > FEATURES

Everything connects. Her mood affects memory, memory affects opinions, opinions create inside references, references become the relationship. One integrated mind.

---

## What Already Exists (Infrastructure Audit)

| System | Status | Gap |
|--------|--------|-----|
| Mood Knobs | ✅ Exists | Mood shifts too quickly |
| Ongoing Threads | ✅ Exists | Not connected to user memory |
| Callbacks | ✅ Exists | Reactive only |
| Relationship Metrics | ✅ Exists | Underutilized |
| Character Profile | ✅ Rich | Opinions not parsed |
| Memory Tools | ✅ Exists | User must ask |

---

## NEW: Emotional Momentum System

> [!IMPORTANT]
> Mood changes require **cumulative engagement**, not instant flips.

### The Problem
Currently: One good joke → mood instantly improves  
Reality: Bad moods take TIME to shift through sustained positive interaction

### The Solution: Momentum Tracker

```typescript
interface EmotionalMomentum {
  currentMoodLevel: number;       // -1 to 1 (bad to good)
  momentumDirection: number;      // -1 to 1 (declining to improving)
  positiveInteractionStreak: number;
  recentInteractionTones: number[];  // Last 5-10 interactions
}
```

### Rules

| Scenario | Effect |
|----------|--------|
| Bad day + 1 joke | Slight uplift, still guarded |
| Bad day + 3-4 positive exchanges | Mood starts to shift noticeably |
| Bad day + sustained warmth (6+) | She thaws, opens up |
| **EXCEPTION**: Genuine moment | Immediate shift |

### Genuine Moments (Instant Shift Allowed)

A "genuine moment" is when someone says exactly what you needed to hear:
- Compliment that addresses her actual insecurity
- Vulnerability that matches hers
- Perfect callback to something meaningful

**Detection**: LLM identifies if user message addresses known insecurity/concern from profile

**Example**:
- Kayley's insecurity: "Afraid of being seen as shallow"
- User says: "I love how you think deeply about things even though you're so fun"
- **Result**: Genuine moment detected → mood can shift significantly

---

## Implementation Phases

### Phase 1: Attunement (Core Magic)
- `presenceDirector.ts` - unified integration
- `presence_contexts` table (Supabase)
- Parse profile Section 12 for opinions
- Unified PRESENCE prompt section

### Phase 2: Emotional Momentum
- **Enhance [moodKnobs.ts](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/moodKnobs.ts)** with momentum tracking
- Track interaction streak, not just last interaction
- Add genuine moment detection
- Gradual mood shifts based on cumulative tone

### Phase 3: Comfortable Imperfection ✅
- ✅ Uncertainty responses in prompts (`UNCERTAINTY_RESPONSES` array in promptUtils.ts)
- ✅ Brief responses allowed (`BRIEF_RESPONSE_EXAMPLES` array in promptUtils.ts)
- ✅ Follow-up questions marked as optional
- ✅ `buildComfortableImperfectionPrompt()` function added
- ✅ Unit tests in `promptUtils.test.ts` (21 tests)

### Phase 4: Co-Evolution (Relationship Arc) ✅
- ✅ `relationship_milestones` table (Supabase) - SQL migration in `supabase/migrations/create_relationship_milestones.sql`
- ✅ Milestone types: `first_vulnerability`, `first_joke`, `first_support`, `first_deep_talk`, `first_return`, `breakthrough_moment`, `anniversary_week`, `anniversary_month`, `interaction_50`, `interaction_100`
- ✅ "Remember when..." callbacks via `relationshipMilestones.ts` and `callbackDirector.ts`
- ✅ Enables natural history references after 50+ interactions
- ✅ Unit tests in `relationshipMilestones.test.ts` (28 tests)

### Phase 5: Pattern Recognition
- `user_patterns` table (Supabase)
- "You seem stressed on Mondays"

---

## Emotional Momentum: Detailed Design

### Current Behavior (Too Simple)
```
lastInteractionTone = 0.8  →  toneCarryover = 0.8 * 0.3 = 0.24 boost
```

### New Behavior (Realistic)
```
recentTones = [0.8, 0.6, 0.7, 0.5, 0.8]  // Last 5 exchanges
averageTrend = 0.68
streakLength = 5 positive

IF (streakLength >= 4 AND averageTrend > 0.5)
  → Mood begins to shift
  
IF (streakLength < 3)
  → Mood remains stable (one joke doesn't fix a bad day)
```

### Genuine Moment Detection
```
IF (user_message addresses known insecurity from profile)
  → bypass streak requirement
  → allow significant mood shift
  → store as meaningful memory
```

---

## Verification

| Test | Expected |
|------|----------|
| Bad mood + 1 positive | Still somewhat guarded |
| Bad mood + 5 positives | Noticeably warmer |
| Bad mood + genuine compliment | Can shift quickly |
| Proactive memory | She asks first |
| Shared history (50+ convos) | "Remember when..." |

---

## Summary

**Coherence**: One integrated mind, not features  
**Momentum**: Moods shift gradually, not instantly  
**Genuine**: Real moments can break through  
**Persistence**: Supabase keeps it across devices  
**Profile**: Opinions from living document
