# Code Review Feedback: Continuity Feature

Date: 2026-02-13
Branch reviewed: `context-synthesis`
Reviewer: Codex

## Scope Reviewed

- Continuity design docs under `docs/ContinuityFeature/`
- New continuity services:
  - `src/services/contextSynthesisService.ts`
  - `src/services/conversationAnchorService.ts`
  - `src/services/topicExhaustionService.ts`
  - `src/services/activeRecallService.ts`
  - `src/services/factEmbeddingsService.ts`
- Integration points:
  - `src/services/system_prompts/builders/systemPromptBuilder.ts`
  - `src/services/messageOrchestrator.ts`
  - `src/services/geminiChatService.ts`
  - `src/services/memoryService.ts`
  - `src/services/characterFactsService.ts`
  - `src/services/storylineService.ts`
  - `src/services/idleThinkingService.ts`
- Migrations:
  - `supabase/migrations/20260213_context_synthesis.sql`
  - `supabase/migrations/20260213_conversation_anchor.sql`
  - `supabase/migrations/20260213_topic_exhaustion.sql`
  - `supabase/migrations/20260213_phase2b_fact_embeddings.sql`

---

## Resolution Status

### Already resolved (no code changes needed)

- **M6** (embedding sync) — already wired in `characterFactsService.ts:197` and `storylineService.ts:874,972`
- **H4** (`isQualityTopicKey`) — code says `wordCount < 1`, single-word keys pass
- **Q2** (freshness 120min vs 90sec) — 120min is read-path freshness, 90s time guard is at line 324
- **H1/Fix 5** (scoring weights) — code already matches plan: lexical `*60`, key `15/8`, recency `15/8`, confidence `*10`, pinned `5`
- **Q3** (topic shift 0.3) — user confirmed intentional, keep as-is

### Fixed (2026-02-13)

- **Finding #2** (Fallback prompt lost storyline context) — Restored `getStorylinePromptContext(0)` in fallback `Promise.all` and injected result into fallback prompt template
- **Finding #4** (Semantic-timeout race returns empty) — Added empty-result check: if semantic wins race with `[]`, falls through to lexical before returning empty
- **Finding #5** (Topic extraction false positives) — Replaced `includes()` substring matching with Gemini LLM call (`gemini-2.0-flash`, 2s timeout, fail-open)
- **Finding #6** (Storyline recency tied to phase start) — Added `updated_at` to `StorylineRow`/`LifeStoryline`, mapped in `mapRowToStoryline()`, updated references in `activeRecallService.ts:129` and `factEmbeddingsService.ts:255`

---

## Remaining Findings (informational, not blocking)

### M1: Conversation anchor monotonic write guard may skip valid refreshes

**Severity: Medium**
**File:** `conversationAnchorService.ts`

The monotonic turnIndex guard prevents writing an anchor with a lower turnIndex than the existing one. But if two messages are processed concurrently (race condition in fast-typing scenarios), the second message's refresh could be silently dropped even though it has newer context.

**Impact:** Unlikely in practice due to sequential message processing, but worth noting if you ever parallelize message handling.

### M2: `extractAndRecordTopics` only matches against existing tracked keys

**Severity: Medium**
**File:** `topicExhaustionService.ts`

The extraction function matches AI response text against keys already in the `topic_exhaustion` table. New topics that the AI starts discussing won't be tracked until they're first seeded by synthesis. This means:
- If synthesis is stale, new topics won't get cooldown tracking
- If the AI starts a topic that was never in any user/character fact, it's invisible to exhaustion

This is documented as intentional for Phase 1, but worth flagging as a gap.

### M3: Semantic timeout raised to 350ms may cause noticeable latency

**Severity: Medium**
**File:** `activeRecallService.ts`

The runtime validation review recommended tuning, and the timeout was raised from 250ms to 350ms. Combined with the Gemini embedding API call, this adds up to ~350ms worst-case to every non-greeting turn.

The plan target was p95 under 180ms for the entire active recall path. A 350ms semantic timeout alone exceeds that.

**Recommendation:** Monitor actual p95 and consider whether the semantic path is earning its latency cost. The runtime validation already showed it producing zero candidates frequently.

### M4: `max_items` clamping may not be effective

**Severity: Medium**
**File:** `activeRecallService.ts`

The `SIZE_CAPS.max_items = 7` exists but the actual selection uses `config.limit` (hardcoded to 6). The clamping from the 2A review (`Math.min(SIZE_CAPS.max_items, config.limit)`) should be verified to actually be in the selection path, not just in config parsing.

### M5: Fire-and-forget embedding sync has no retry

**Severity: Medium**
**File:** `memoryService.ts` (lines ~728-733)

If the embedding API is temporarily down, the fact gets stored but the embedding is silently lost. Over time, the embedding index drifts from the source of truth. The plan mentioned an optional `fact_embedding_jobs` table for retry/backoff.

### L1-L5: Low severity findings

Retained for reference — see git history for full details. None are blocking.

---

## Behavioral Review Summary

- **Prompt Assembly Order:** Matches plan in both synthesis and fallback paths.
- **Synthesis Generation Flow:** Works as designed. Cap of 4/day with 8hr TTL.
- **Active Recall Flow:** Hybrid mode works. Semantic may add latency for limited benefit until embedding corpus matures.
- **Topic Exhaustion Flow:** Now uses LLM extraction (no more false positives from substring matching).
- **Conversation Anchor Flow:** Turn count and topic shift triggers work. Time guard (120 min) is effectively inert.
