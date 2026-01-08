# Kayley Experiences: `surfaced_at` and `conversation_context` Column Analysis

**Date:** 2026-01-08
**Table:** `kayley_experiences`
**Issue:** After 100+ chat interactions, `surfaced_at` and `conversation_context` columns are always NULL

**Status:** RESOLVED - Option A implemented on 2026-01-08

---

## Resolution Summary

**Option A (Complete the Integration) was implemented** by adding `detectAndMarkSurfacedExperiences()` calls to `geminiChatService.ts`:

- Line 24: Import added
- Line 966: Detection added in `generateResponse()`
- Line 1444: Detection added in `generateGreeting()`
- Line 1547: Detection added in `generateNonGreeting()`

The function is now called after every AI response, following the same fire-and-forget pattern used by `detectAndMarkSharedThoughts()`, `markLoopSurfaced()`, and `markThreadMentionedAsync()`.

---

## Executive Summary

The `surfaced_at` and `conversation_context` columns in the `kayley_experiences` table are never populated because **the detection function exists but is never called** in the application flow.

This is a **partially implemented feature** where the infrastructure was built but the "last mile" integration into the response processing pipeline was never completed.

**Key Finding:** Two similar systems (Open Loops and Ongoing Threads) HAVE working surfacing detection integrated into `geminiChatService.ts`. The Kayley Experiences system was designed to follow the same pattern but the integration step was missed.

---

## 1. Current State Analysis

### 1.1 Actual Data (5 Records from Database)

```json
[
  {
    "id": "53959f6c-...",
    "experience_type": "mishap",
    "content": "Spilled coffee on my notes right before practice",
    "mood": "laughing it off",
    "created_at": "2026-01-08T01:36:45.04Z",
    "surfaced_at": null,           // <-- ALWAYS NULL
    "conversation_context": null,   // <-- ALWAYS NULL
    "metadata": {
      "context": {
        "currentMood": "energetic but introspective",
        "ongoingStories": ["Had a short, blunt bob...", "Celebrated with Steven...", "oversized beige blazer..."]
      }
    }
  },
  // ... all 5 records show the same pattern
]
```

**Observation:** The experiences ARE being generated correctly with rich metadata. The generation side works. The surfacing detection never happens.

### 1.2 Table Schema (from migration)

```sql
CREATE TABLE kayley_experiences (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  experience_type TEXT NOT NULL,  -- 'activity', 'thought', 'mood', 'discovery', 'mishap'
  content TEXT NOT NULL,
  mood TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  surfaced_at TIMESTAMPTZ,         -- When mentioned in conversation (NEVER SET)
  conversation_context TEXT,       -- What prompted sharing (NEVER SET)
  metadata JSONB DEFAULT '{}'
);

-- Index designed for filtering unsurfaced experiences (always returns all)
CREATE INDEX idx_kayley_experiences_unsurfaced
  ON kayley_experiences(user_id, surfaced_at)
  WHERE surfaced_at IS NULL;
```

---

## 2. Deep Root Cause Analysis

### 2.1 The Detection Function Exists But Is Never Called

**File:** `src/services/idleLife/kayleyExperienceService.ts:309-344`

```typescript
export async function detectAndMarkSurfacedExperiences(
  aiResponse: string
): Promise<string[]> {
  const unsurfaced = await getUnsurfacedExperiences();
  const responseLower = aiResponse.toLowerCase();
  const markedIds: string[] = [];

  for (const exp of unsurfaced) {
    const contentSnippet = exp.content.slice(0, 30).toLowerCase();
    if (responseLower.includes(contentSnippet)) {
      await markExperienceSurfaced(exp.id, "detected in response");
      markedIds.push(exp.id);
    }
  }
  return markedIds;
}
```

### 2.2 Where It's Defined vs. Where It's Called

| Location | Type | Status |
|----------|------|--------|
| `kayleyExperienceService.ts:309` | Definition | EXISTS |
| `idleLife/index.ts:22` | Export | EXISTS |
| `KayleyExperienceService.md:147-162` | Documentation | Says "After getting AI response..." |
| `geminiChatService.ts` | Integration point | **NEVER CALLED** |
| `messageOrchestrator.ts` | Integration point | **NEVER CALLED** |
| `App.tsx` | Integration point | **NEVER CALLED** |

### 2.3 Comparison with WORKING Surfacing Mechanisms

**The app has TWO other surfacing systems that DO work:**

#### Open Loops (presenceDirector.ts) - WORKING

```typescript
// geminiChatService.ts:1174-1177
if (loopIdToMark) {
  markLoopSurfaced(loopIdToMark).catch((err) =>
    console.warn("[GeminiService] Failed to mark loop as surfaced:", err)
  );
}

// geminiChatService.ts:1400-1404
if (topOpenLoop) {
  await markLoopSurfaced(topOpenLoop.id);
  console.log(`✅ [GeminiService] Marked loop as surfaced: "${topOpenLoop.topic}"`);
}
```

#### Ongoing Threads (ongoingThreads.ts) - WORKING

```typescript
// geminiChatService.ts:1169-1172
if (threadIdToMark) {
  markThreadMentionedAsync(threadIdToMark).catch((err) =>
    console.warn("[GeminiService] Failed to mark thread as mentioned:", err)
  );
}
```

#### Kayley Experiences (kayleyExperienceService.ts) - NOT WORKING

```typescript
// This should exist somewhere in geminiChatService.ts but DOESN'T:
// detectAndMarkSurfacedExperiences(response.text_response).catch(...)
```

### 2.4 The Pattern That Should Have Been Followed

Looking at `geminiChatService.ts`, the pattern for post-response processing is:

```typescript
// After generating response, mark things as surfaced:
// 1. Open loops → markLoopSurfaced() ✅ IMPLEMENTED
// 2. Ongoing threads → markThreadMentionedAsync() ✅ IMPLEMENTED
// 3. Kayley experiences → detectAndMarkSurfacedExperiences() ❌ MISSING
```

---

## 3. Complete Data Flow Analysis

### 3.1 Experience Generation Flow (WORKING)

```
┌─────────────────────────────────────────────────────────────────┐
│ idleThoughtsScheduler.ts                                        │
│ processIdleTick() runs every 1 minute (testing) / 10 min (prod) │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ kayleyExperienceService.ts                                      │
│ generateKayleyExperience(context) → 70% chance to generate      │
│ cleanupExperiences() → cap at 5, expire after 14 days           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ kayley_experiences table                                        │
│ INSERT with surfaced_at = NULL                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Experience Prompt Injection Flow (WORKING)

```
┌─────────────────────────────────────────────────────────────────┐
│ systemPromptBuilder.ts:323-332                                  │
│ const experiencesPrompt = await formatExperiencesForPrompt();   │
│ if (experiencesPrompt) { prompt += experiencesPrompt; }         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ System prompt includes:                                         │
│ ====================================================            │
│ THINGS THAT HAPPENED TO YOU TODAY                               │
│ ====================================================            │
│ - Spilled coffee on my notes (laughing it off)                  │
│ - Recorded a cover but I'm not sure if I'll post it (satisfied) │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Experience Surfacing Detection Flow (NOT WORKING)

```
┌─────────────────────────────────────────────────────────────────┐
│ geminiChatService.ts - After AI generates response              │
│                                                                 │
│ SHOULD HAVE:                                                    │
│ detectAndMarkSurfacedExperiences(response.text_response)        │
│   .catch(err => console.warn('Failed to detect experiences'))   │
│                                                                 │
│ ACTUALLY HAS:                                                   │
│ ... nothing for experiences ...                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Result: surfaced_at stays NULL forever                          │
│ Same experiences keep appearing in prompts until:               │
│ - They expire (14 days)                                         │
│ - They're pushed out by cap (max 5 unsurfaced)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Detection Algorithm Assessment

Even if integrated, the current detection algorithm has limitations:

### 4.1 Current Algorithm (Brittle)

```typescript
const contentSnippet = exp.content.slice(0, 30).toLowerCase();
if (responseLower.includes(contentSnippet)) {
  // Mark as surfaced
}
```

### 4.2 Problems

| Issue | Example |
|-------|---------|
| **Only checks first 30 chars** | "Spilled coffee on my notes ri..." may not match |
| **Exact substring match** | Kayley might say "I spilled my coffee" instead |
| **No semantic understanding** | Paraphrasing won't be detected |
| **False positives possible** | Common phrases might match accidentally |

### 4.3 Comparison with Other Systems

| System | Detection Method | Quality |
|--------|------------------|---------|
| Open Loops | Pre-selected by ID before response generation | Reliable |
| Ongoing Threads | Pre-selected by ID before response generation | Reliable |
| Kayley Experiences | Post-hoc substring matching | Brittle |

The experiences system takes a different approach (post-response detection) which is inherently less reliable than the pre-selection approach used by the other systems.

---

## 5. Impact Assessment

### 5.1 What's Actually Happening

1. **Experiences ARE being generated** - ✅ Working
2. **Experiences ARE being injected into prompts** - ✅ Working
3. **Kayley CAN mention experiences in responses** - ✅ Working
4. **Surfacing is NOT being tracked** - ❌ Broken
5. **Same experiences keep appearing** - Side effect of #4

### 5.2 User Experience Impact

| Scenario | Impact |
|----------|--------|
| **Current state** | Kayley may mention the same experiences repeatedly |
| **With fix** | Experiences would be mentioned once, then new ones surface |
| **Without feature** | No change (cleanup caps at 5, expires at 14 days anyway) |

### 5.3 Why It "Works Anyway"

The system appears to function because:
1. **Cap of 5 unsurfaced** - Old experiences get deleted when new ones come in
2. **14-day expiration** - Stale experiences auto-delete
3. **Prompt variety** - The LLM doesn't always mention experiences
4. **New experiences** - Fresh content is regularly generated

---

## 6. Recommendations

### Option A: Complete the Integration (Recommended if feature matters)

**Effort:** Low (30 minutes to 1 hour)

Add detection call in `geminiChatService.ts` following the existing pattern:

```typescript
// In geminiChatService.ts, after response generation
// Add alongside the existing markLoopSurfaced and markThreadMentionedAsync calls:

import { detectAndMarkSurfacedExperiences } from './idleLife';

// In generateResponse() or generateGreeting(), after getting response:
detectAndMarkSurfacedExperiences(response.text_response).catch((err) =>
  console.warn("[GeminiService] Failed to detect surfaced experiences:", err)
);
```

**Pros:**
- Completes the original design intent
- Prevents repetitive experience sharing
- Follows existing patterns in codebase

**Cons:**
- Detection algorithm is brittle (substring matching)
- May have false negatives (paraphrased experiences not detected)

### Option B: Improve Detection + Integrate

**Effort:** Medium (2-4 hours)

1. Implement smarter detection (word overlap, fuzzy matching)
2. Add integration in geminiChatService.ts

```typescript
export async function detectAndMarkSurfacedExperiences(
  aiResponse: string
): Promise<string[]> {
  const unsurfaced = await getUnsurfacedExperiences();
  const responseWords = new Set(aiResponse.toLowerCase().split(/\W+/));
  const markedIds: string[] = [];

  for (const exp of unsurfaced) {
    const contentWords = exp.content.toLowerCase().split(/\W+/);
    const matchingWords = contentWords.filter(w => responseWords.has(w) && w.length > 3);
    const matchRatio = matchingWords.length / contentWords.length;

    // Require 40%+ word overlap for detection
    if (matchRatio >= 0.4) {
      await markExperienceSurfaced(exp.id, "detected in response");
      markedIds.push(exp.id);
    }
  }
  return markedIds;
}
```

### Option C: Delete Unused Columns (Simplest)

**Effort:** Very Low (15-30 minutes)

If the feature isn't needed, clean up the unused infrastructure:

```sql
-- Migration: drop_unused_experience_columns.sql
ALTER TABLE kayley_experiences DROP COLUMN surfaced_at;
ALTER TABLE kayley_experiences DROP COLUMN conversation_context;
DROP INDEX IF EXISTS idx_kayley_experiences_unsurfaced;

-- Create simpler index
CREATE INDEX idx_kayley_experiences_recent
  ON kayley_experiences(user_id, created_at DESC);
```

Update TypeScript:
- Remove `surfacedAt` and `conversationContext` from types
- Remove `markExperienceSurfaced()` function
- Remove `detectAndMarkSurfacedExperiences()` function
- Simplify `getUnsurfacedExperiences()` to just `getRecentExperiences()`

### Option D: Switch to Pre-Selection Pattern

**Effort:** Medium-High (4-8 hours)

Follow the pattern used by Open Loops and Ongoing Threads:
1. Pre-select an experience to surface BEFORE generating response
2. Include specific instruction in prompt: "Mention this experience naturally"
3. Mark as surfaced after response (regardless of detection)

This is more reliable but requires architectural changes.

---

## 7. Files Affected by Each Option

### Option A (Minimal Integration)
| File | Change |
|------|--------|
| `src/services/geminiChatService.ts` | Add import and call |

### Option B (Improved Detection)
| File | Change |
|------|--------|
| `src/services/idleLife/kayleyExperienceService.ts` | Improve algorithm |
| `src/services/geminiChatService.ts` | Add import and call |

### Option C (Delete Columns)
| File | Change |
|------|--------|
| `supabase/migrations/` | Add new migration |
| `src/services/idleLife/kayleyExperienceService.ts` | Remove functions, update types |
| `src/services/idleLife/index.ts` | Remove exports |
| `src/services/tests/idleLife.test.ts` | Update tests |
| `src/services/docs/KayleyExperienceService.md` | Update documentation |

### Option D (Pre-Selection Pattern)
| File | Change |
|------|--------|
| `src/services/idleLife/kayleyExperienceService.ts` | Add selection logic |
| `src/services/geminiChatService.ts` | Integrate selection |
| `src/services/system_prompts/builders/systemPromptBuilder.ts` | Add specific experience prompt |

---

## 8. Recommendation

**For immediate action: Option A (Complete the Integration)**

Rationale:
1. The feature was clearly intended to work this way (documentation says so)
2. The pattern already exists for Open Loops and Ongoing Threads
3. Minimal code change (one import, one function call)
4. Can be enhanced later if detection proves unreliable

**For long-term improvement: Option D (Pre-Selection Pattern)**

If experience repetition becomes a noticeable problem, switch to the more reliable pre-selection pattern used by the other surfacing systems.

---

## 9. Appendix: Related Code Locations

| Component | File | Line |
|-----------|------|------|
| Experience generation | `idleLife/kayleyExperienceService.ts` | 148-206 |
| Experience cleanup | `idleLife/kayleyExperienceService.ts` | 447-483 |
| Prompt injection | `system_prompts/builders/systemPromptBuilder.ts` | 323-332 |
| Detection function | `idleLife/kayleyExperienceService.ts` | 309-344 |
| Open loop surfacing | `geminiChatService.ts` | 1174-1177, 1400-1404 |
| Thread surfacing | `geminiChatService.ts` | 1169-1172 |
| Idle scheduler | `idleThoughtsScheduler.ts` | 155-166 |
| Documentation | `services/docs/KayleyExperienceService.md` | 231-238 |
