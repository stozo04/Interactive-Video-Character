# Phase 2B Implementation Review

**Date:** 2026-02-12
**Reviewer:** Claude Sonnet 4.5
**Status:** Uncommitted code review
**Scope:** Phase 2B (Semantic Active Recall) implementation vs. `docs/phase2_plan.md`

---

## Executive Summary

**Overall Assessment:** ✅ **Implementation is SOLID**

Your Phase 2B implementation is well-executed, production-ready, and demonstrates strong engineering discipline. The code:
- Implements both Phase 2A (lexical) and Phase 2B (semantic/hybrid) retrieval modes
- Has proper fail-open behavior with semantic→lexical→empty fallback chain
- Integrates write hooks cleanly using fire-and-forget pattern
- Includes proper migration with pgvector indexing
- Compiles cleanly with no TypeScript errors

**Key Strengths:**
1. Proper retrieval mode abstraction (`lexical`, `hybrid`, `semantic`)
2. Fire-and-forget embedding sync (doesn't block user writes)
3. Fail-open design throughout
4. Clean separation of concerns (activeRecallService, factEmbeddingsService)
5. Proper timeout guards and structured logging

**Critical Issues:** None
**High Issues:** 2 (missing backfill, scoring drift from plan)
**Medium Issues:** 3
**Low Issues:** 4

---

## 1. HIGH: Missing Backfill Utility

**File:** N/A (not implemented)
**Severity:** High
**Status:** Missing

### Problem

The plan specifies a backfill utility to generate embeddings for existing facts before enabling Phase 2B. No such utility exists.

### Evidence

From `docs/phase2_plan.md` line 1174-1263:
```typescript
export async function backfillEmbeddings(): Promise<{
  success: number;
  failed: number;
}> { ... }
```

Your `factEmbeddingsService.ts` has no backfill function.

### Impact

- Cannot enable semantic mode without pre-populating `fact_embeddings` table
- No way to batch-process existing facts
- Deployment blocked until backfill is manually written

### Recommendation

Add to `factEmbeddingsService.ts`:

```typescript
export async function backfillFactEmbeddings(): Promise<{
  success: number;
  failed: number;
  errors: Array<{ sourceType: string; sourceId: string; error: string }>;
}> {
  const results = {
    success: 0,
    failed: 0,
    errors: [] as Array<{ sourceType: string; sourceId: string; error: string }>,
  };

  try {
    console.log(`${LOG_PREFIX} Starting backfill...`);

    // Fetch all user facts
    const { data: userFacts } = await supabase
      .from("user_facts")
      .select("*");

    if (userFacts) {
      for (const fact of userFacts) {
        const success = await upsertUserFactEmbedding(fact as UserFact);
        if (success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push({
            sourceType: "user_fact",
            sourceId: fact.id,
            error: "upsert failed",
          });
        }
      }
    }

    // Fetch all character facts
    const { data: characterFacts } = await supabase
      .from("character_facts")
      .select("*");

    if (characterFacts) {
      for (const fact of characterFacts) {
        const success = await upsertCharacterFactEmbedding(fact as CharacterFact);
        if (success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push({
            sourceType: "character_fact",
            sourceId: fact.id,
            error: "upsert failed",
          });
        }
      }
    }

    // Fetch all storylines
    const { data: storylines } = await supabase
      .from("storylines")
      .select("*")
      .eq("status", "active");

    if (storylines) {
      for (const row of storylines) {
        // Map raw row to LifeStoryline type (adjust as needed)
        const storyline = {
          id: row.id,
          title: row.title,
          category: row.category,
          initialAnnouncement: row.initial_announcement,
          stakes: row.stakes,
          currentEmotionalTone: row.current_emotional_tone,
          phaseStartedAt: new Date(row.phase_started_at),
          // ... other required fields
        } as LifeStoryline;

        const success = await upsertStorylineEmbedding(storyline);
        if (success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push({
            sourceType: "storyline",
            sourceId: row.id,
            error: "upsert failed",
          });
        }
      }
    }

    console.log(`${LOG_PREFIX} Backfill complete`, results);
    return results;
  } catch (err) {
    console.error(`${LOG_PREFIX} Backfill failed`, { err });
    return results;
  }
}
```

**CLI helper script** (`scripts/backfill-embeddings.ts`):
```typescript
import { backfillFactEmbeddings } from "../src/services/factEmbeddingsService";

async function main() {
  console.log("Starting backfill...");
  const results = await backfillFactEmbeddings();
  console.log("\nBackfill Results:");
  console.log(`  ✓ Success: ${results.success}`);
  console.log(`  ✗ Failed: ${results.failed}`);
  if (results.errors.length > 0) {
    console.log("\nErrors:");
    results.errors.forEach(e => console.log(`  - ${e.sourceType}:${e.sourceId}: ${e.error}`));
  }
  process.exit(results.failed > 0 ? 1 : 0);
}

main();
```

---

## 2. HIGH: Scoring Range Drift from Plan

**Files:** `src/services/activeRecallService.ts`
**Severity:** High
**Status:** Inconsistency with plan

### Problem

Your implementation uses different scoring ranges than the plan specifies. This affects threshold tuning and A/B test comparison.

### Evidence

**Plan** (`docs/phase2_plan.md` lines 122-131):
```
| Component    | Range | Description |
| Lexical      | 0-55  | Token overlap |
| Key bonus    | 0-10  | Exact/partial key match |
| Recency      | 0-20  | How recently updated |
| Confidence   | 0-15  | Fact confidence level |
| Pinned       | 0-5   | Pinned user facts |
| MAX          | 105   | Total possible score |
```

**Implementation** (`activeRecallService.ts` lines 236-284):
```typescript
// Lexical: 0-60 (not 0-55)
export function computeLexicalScore(...): number {
  return overlapRatio * 60; // PLAN: * 55
}

// Key bonus: 0-15 (not 0-10)
export function computeKeyBonus(...): number {
  if (keyMatches === keySet.size) return 15; // PLAN: 10
  if (keyMatches > 0) return 8; // PLAN: 5
  return 0;
}

// Recency: 0-15 (not 0-20)
export function computeRecencyBoost(...): number {
  if (daysSince <= 7) return 15; // PLAN: 20
  if (daysSince <= 30) return 8; // PLAN: 10
  return 0;
}

// Confidence: 0-10 (not 0-15)
export function computeConfidenceBoost(...): number {
  return Math.round(...) * 10); // PLAN: * 15
}
```

**Semantic mode** (line 443):
```typescript
const semanticScore = Math.max(0, Math.min(1, similarity)) * 70; // Not 60
```

### Impact

- `minScore` threshold of `18` (plan default) may not work correctly
- A/B test results won't match expected baselines
- Scoring components are weighted differently than designed

### Recommendation

**Option 1:** Update plan to match code (if you intentionally tuned these values)
**Option 2:** Update code to match plan (preserves original design)

I recommend **Option 1** if you've found better weights through experimentation. Otherwise, align code to plan.

---

## 3. MEDIUM: Hybrid Mode Doesn't Gate Boosts

**File:** `src/services/activeRecallService.ts:437-465`
**Severity:** Medium
**Status:** Missing gating in semantic path

### Problem

In **lexical mode**, you correctly gate recency/confidence/pinned boosts behind `hasRelevance` (lines 395-398):

```typescript
const hasRelevance = lexical > 0 || keyBonus > 0;
const recency = hasRelevance ? computeRecencyBoost(cand.updatedAt) : 0;
const confidence = hasRelevance ? computeConfidenceBoost(cand.confidence) : 0;
const pinned = hasRelevance ? computePinnedBoost(cand.pinned) : 0;
```

But in **hybrid/semantic mode** (lines 447-451), boosts are **always applied** regardless of relevance:

```typescript
const lexical = mode === "hybrid" ? computeLexicalScore(...) : 0;
const keyBonus = mode === "hybrid" ? computeKeyBonus(...) : 0;
const recency = computeRecencyBoost(candidate.updatedAt); // NO GATING
const confidence = computeConfidenceBoost(candidate.confidence); // NO GATING
const pinned = computePinnedBoost(candidate.pinned); // NO GATING
```

### Impact

A high-confidence, recently-updated, pinned fact with **zero semantic similarity** could still score:
- semantic: 0
- lexical: 0 (semantic mode)
- keyBonus: 0 (semantic mode)
- recency: 15
- confidence: 10
- pinned: 5
- **Total: 30 points** (above default `minScore` of 18!)

This defeats the purpose of semantic filtering.

### Recommendation

Apply the same gating logic:

```typescript
function scoreSemanticCandidate(...): RankedRecallCandidate {
  const semanticScore = Math.max(0, Math.min(1, similarity)) * 70;
  const candidateTokens = tokenize(getCandidateText(candidate));
  const keyTokens = tokenize(candidate.key);

  const lexical = mode === "hybrid" ? computeLexicalScore(messageTokens, candidateTokens) : 0;
  const keyBonus = mode === "hybrid" ? computeKeyBonus(messageTokens, keyTokens) : 0;

  // Gate boosts: only apply if semantic OR lexical relevance exists
  const hasRelevance = semanticScore > 0 || lexical > 0 || keyBonus > 0;
  const recency = hasRelevance ? computeRecencyBoost(candidate.updatedAt) : 0;
  const confidence = hasRelevance ? computeConfidenceBoost(candidate.confidence) : 0;
  const pinned = hasRelevance ? computePinnedBoost(candidate.pinned) : 0;

  return {
    ...candidate,
    score: semanticScore + lexical + keyBonus + recency + confidence + pinned,
    reasons: buildReasonList({
      semantic: semanticScore,
      lexical,
      keyBonus,
      recency,
      confidence,
      pinned,
    }),
  };
}
```

---

## 4. MEDIUM: Vector Literal String Construction Risk

**File:** `src/services/factEmbeddingsService.ts:90-93`
**Severity:** Medium
**Status:** Potential precision loss

### Problem

You construct pgvector literals using string concatenation:

```typescript
function toVectorLiteral(values: number[]): string {
  const sanitized = values.map((v) => (Number.isFinite(v) ? v.toString() : "0"));
  return `[${sanitized.join(",")}]`;
}
```

JavaScript `Number.toString()` can lose precision or use exponential notation (e.g., `1.234567890123456789` → `1.2345678901234568`).

### Impact

- Potential precision loss in embeddings (unlikely to matter in practice)
- May not match Gemini API's exact output format
- Could cause vector index mismatches if precision matters

### Recommendation

Use `toFixed()` or let Supabase/pgvector handle the conversion:

**Option 1: Use JSON array (Supabase auto-converts)**
```typescript
const { error } = await supabase.from(TABLE).upsert({
  ...
  embedding: embedding, // Pass array directly, Supabase handles conversion
});
```

**Option 2: Fixed precision**
```typescript
function toVectorLiteral(values: number[]): string {
  const sanitized = values.map((v) =>
    Number.isFinite(v) ? v.toFixed(8) : "0"
  );
  return `[${sanitized.join(",")}]`;
}
```

Test which format Supabase expects. Option 1 is preferred if it works.

---

## 5. MEDIUM: No Embedding Dimension Validation

**File:** `src/services/factEmbeddingsService.ts:105-140`
**Severity:** Medium
**Status:** Missing validation

### Problem

You don't validate that the embedding returned by Gemini has exactly 768 dimensions before storing it.

```typescript
const values = response.embeddings?.[0]?.values;
if (!values || !values.length) {
  console.warn(`${LOG_PREFIX} Empty embedding response`, { taskType });
  return null;
}
// MISSING: if (values.length !== 768) { ... }
return values;
```

### Impact

- If Gemini changes model output, silent corruption of vector index
- Queries will fail with dimension mismatch errors
- Difficult to debug without dimension logging

### Recommendation

Add dimension validation:

```typescript
const EMBEDDING_DIMS = 768;

async function generateTextEmbedding(
  text: string,
  taskType: EmbeddingTaskType
): Promise<number[] | null> {
  // ... existing code ...

  const values = response.embeddings?.[0]?.values;
  if (!values || !values.length) {
    console.warn(`${LOG_PREFIX} Empty embedding response`, { taskType });
    return null;
  }

  // NEW: Validate dimensions
  if (values.length !== EMBEDDING_DIMS) {
    console.error(`${LOG_PREFIX} Embedding dimension mismatch`, {
      expected: EMBEDDING_DIMS,
      actual: values.length,
      taskType,
    });
    return null;
  }

  return values;
}
```

---

## 6. LOW: Task Type May Be Ignored by Gemini API

**File:** `src/services/factEmbeddingsService.ts:117-122`
**Severity:** Low
**Status:** Needs verification

### Problem

You pass `taskType: "RETRIEVAL_DOCUMENT"` and `taskType: "RETRIEVAL_QUERY"` to the Gemini API:

```typescript
const response = await ai.models.embedContent({
  model: config.embeddingModel,
  contents: [normalized],
  config: {
    taskType, // "RETRIEVAL_DOCUMENT" or "RETRIEVAL_QUERY"
  },
});
```

But I don't see evidence that Google's `text-embedding-004` model uses `taskType` in the `@google/genai` SDK. This parameter might be silently ignored.

### Impact

- No impact if parameter is ignored
- Potential better retrieval quality if parameter IS used
- Misleading code if parameter does nothing

### Recommendation

Check Gemini API docs to confirm `taskType` is supported. If not, remove it:

```typescript
const response = await ai.models.embedContent({
  model: config.embeddingModel,
  contents: [normalized],
  // Remove taskType if not supported
});
```

---

## 7. LOW: Missing `.env.example` Updates

**File:** `.env.example`
**Severity:** Low
**Status:** Missing documentation

### Problem

You added new environment variables but didn't update `.env.example` to document them.

### New Variables

```bash
VITE_ACTIVE_RECALL_MODE=lexical|hybrid|semantic
VITE_ACTIVE_RECALL_EMBEDDING_MODEL=text-embedding-004
VITE_ACTIVE_RECALL_EMBEDDING_VERSION=1
VITE_ACTIVE_RECALL_SEMANTIC_TOP_K=20
VITE_ACTIVE_RECALL_SEMANTIC_MIN_SIM=0.7
VITE_ACTIVE_RECALL_SEMANTIC_TIMEOUT_MS=180
```

### Recommendation

Add to `.env.example`:

```bash
# Phase 2: Active Recall (Per-Turn Relevance Matching)
VITE_USE_ACTIVE_RECALL=false
VITE_ACTIVE_RECALL_MODE=lexical              # lexical | hybrid | semantic
VITE_ACTIVE_RECALL_LIMIT=6                   # Max items to retrieve (1-7)
VITE_ACTIVE_RECALL_MIN_SCORE=18              # Min relevance score threshold
VITE_ACTIVE_RECALL_TIMEOUT_MS=120            # Lexical retrieval timeout (ms)

# Phase 2B: Semantic Retrieval (Optional)
VITE_ACTIVE_RECALL_EMBEDDING_MODEL=text-embedding-004
VITE_ACTIVE_RECALL_EMBEDDING_VERSION=1
VITE_ACTIVE_RECALL_SEMANTIC_TOP_K=20         # Candidates from vector search
VITE_ACTIVE_RECALL_SEMANTIC_MIN_SIM=0.7      # Min cosine similarity (0-1)
VITE_ACTIVE_RECALL_SEMANTIC_TIMEOUT_MS=180   # Semantic retrieval timeout (ms)
```

---

## 8. LOW: Migration Missing RLS Policies

**File:** `supabase/migrations/20260213_phase2b_fact_embeddings.sql`
**Severity:** Low
**Status:** Missing security policies

### Problem

The migration creates the `fact_embeddings` table but doesn't include Row-Level Security (RLS) policies.

### Evidence

Plan includes RLS (line 963-970):
```sql
ALTER TABLE public.fact_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users"
  ON public.fact_embeddings
  FOR ALL
  TO authenticated
  USING (true);
```

Your migration (lines 1-81) doesn't have this.

### Impact

- Table may be inaccessible if database has RLS enabled by default
- Inconsistent with other table security posture

### Recommendation

Add to migration:

```sql
-- Enable RLS
alter table public.fact_embeddings enable row level security;

-- Allow authenticated users to read/write embeddings
create policy "Allow authenticated users full access"
  on public.fact_embeddings
  for all
  to authenticated
  using (true)
  with check (true);
```

---

## 9. LOW: No Tests

**File:** `src/services/__tests__/activeRecallService.test.ts`
**Severity:** Low (acceptable for MVP)
**Status:** Missing

### Problem

The plan specifies optional tests but none exist.

### Recommendation

**For MVP:** Ship without tests, add post-launch.

**For production:** Add focused tests:
1. Scoring component tests (lexical, key bonus, recency, confidence, pinned)
2. Deduplication test
3. Gating rule test (boosts only with relevance)
4. Fallback chain test (semantic → lexical → empty)
5. Timeout behavior test

---

## Positive Observations

### ✅ Excellent Fire-and-Forget Pattern

Your write hooks use `import().then()` to avoid blocking:

```typescript
// memoryService.ts:730-732
import('./factEmbeddingsService')
  .then(({ upsertUserFactEmbedding }) => upsertUserFactEmbedding(data as UserFact))
  .catch((err) => console.warn('[Memory] Failed to sync user fact embedding:', err));
```

This is perfect. Embedding failures won't block user fact writes. ✅

### ✅ Proper Fallback Chain

Your `buildActiveRecallPromptSection` implements semantic→lexical→empty gracefully (lines 543-586). Well done.

### ✅ Clean Service Separation

`activeRecallService` handles retrieval, `factEmbeddingsService` handles embeddings. No cross-concerns. ✅

### ✅ Proper Index Creation

Your migration uses `ivfflat` index with `lists = 100`, which is correct for ~200-500 embeddings. ✅

### ✅ Gating Rule in Lexical Mode

You correctly gate boosts in lexical mode (lines 395-398). ✅

### ✅ Structured Logging

Your logging includes all key fields: `mode`, `candidateCount`, `durationMs`, `fallbackUsed`, etc. ✅

---

## Summary of Recommendations

### Must-Do (Before Enabling Phase 2B)
1. **Add backfill utility** (HIGH) — Required to populate `fact_embeddings` before launch
2. **Gate boosts in semantic mode** (MEDIUM) — Prevents irrelevant high-confidence facts from ranking

### Should-Do (Before Merge)
3. **Resolve scoring drift** (HIGH) — Align plan and code, or update plan to match code
4. **Add RLS policies** (LOW) — Security best practice
5. **Update `.env.example`** (LOW) — Developer experience

### Optional (Post-Launch)
6. **Validate embedding dimensions** (MEDIUM) — Defensive programming
7. **Fix vector literal construction** (MEDIUM) — Use Supabase JSON auto-convert
8. **Verify `taskType` parameter** (LOW) — Remove if not supported
9. **Add tests** (LOW) — Long-term maintainability

---

## Verification Checklist

Before enabling Phase 2B in production:

- [ ] Run backfill utility and verify all facts have embeddings
- [ ] Confirm `fact_embeddings` table row count matches sum of source tables
- [ ] Test semantic mode with `VITE_ACTIVE_RECALL_MODE=semantic`
- [ ] Test hybrid mode with `VITE_ACTIVE_RECALL_MODE=hybrid`
- [ ] Test fallback: disable Gemini embedding API and confirm lexical fallback works
- [ ] Verify latency: p95 semantic retrieval < 180ms
- [ ] Check logs for embedding generation failures
- [ ] Confirm RLS policies allow authenticated access
- [ ] Update plan doc if scoring ranges were intentionally changed

---

## Final Verdict

**Status:** ✅ **PRODUCTION-READY WITH MINOR PATCHES**

Your Phase 2B implementation is excellent. You've:
- Implemented a sophisticated semantic retrieval system
- Maintained fail-open behavior throughout
- Integrated cleanly with existing services
- Written clean, readable code with proper error handling

**Before launch:**
1. Add backfill utility (blocker)
2. Gate boosts in semantic mode (correctness issue)
3. Resolve scoring drift (align plan/code)

**After these 3 fixes**, you're ready to:
1. Run migration on staging
2. Backfill embeddings
3. Enable `VITE_ACTIVE_RECALL_MODE=hybrid` in staging
4. Validate quality/latency
5. Roll out to production

Great work, Steven! 🚀
