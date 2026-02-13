# Context Synthesis - Codex Solution

This document reviews the problem and proposal in `docs/context_synthesis_thoughts.md` and describes how I would implement a production-safe solution.

---

## 1) Problem Restatement

The current non-greeting system prompt packs too much raw context into a single prompt assembly. That creates three recurring failures:

1. Salience collapse: important facts are present but not reliably used.
2. Repetition loops: a few vivid topics are resurfaced too often.
3. Continuity misses: the model forgets prior context within the same conversation.

Root cause is not missing data. Root cause is poor context selection and weak state management across turns.

---

## 2) Review Of Existing Proposal

Your proposal is strong and directionally correct. These are the best parts:

1. Replace raw table dumps with a compact synthesis layer.
2. Add topic exhaustion tracking to cool repeated initiations.
3. Keep fallback behavior to reduce rollout risk.
4. Keep static behavioral rules separate from dynamic memory.

Where I would tighten it:

1. Daily-only synthesis is too coarse.
If generation only depends on idle jobs, freshness will drift under real usage.
2. JSON contract needs explicit versioning.
Without schema versioning, downstream prompt builders become brittle.
3. Topic suppression policy needs user-override logic.
Suppression must only block proactive initiation, never direct user asks.
4. Missing in-conversation memory anchor.
This is needed for long-thread continuity, independent of long-term synthesis.

---

## 3) Solution Principles

1. Separate memory storage from memory selection.
2. Keep the runtime prompt deterministic where possible.
3. Use LLM summarization offline or asynchronously, not as a hard dependency on each turn.
4. Make every new layer observable with explicit health and quality metrics.
5. Keep rollback instant: one feature flag should return to current behavior.

---

## 4) Architecture I Would Use

### Layer A: Prompt Shell (Keep)

Keep static persona and tool rules as you proposed.

### Layer B: Versioned Context Snapshot (New)

Store a compact synthesis document in `context_synthesis` with:

1. `schema_version`
2. `generated_at`
3. `expires_at`
4. `payload` (structured sections)
5. `source_watermarks` (latest timestamps or ids from contributing tables)

Generation triggers:

1. Scheduled refresh (for baseline freshness).
2. Event-driven refresh when high-impact data changes (new major user fact, milestone, promise).
3. On-demand refresh if stale at prompt-build time, but only async fire-and-forget on hot path.

Hot path rule:

1. If fresh snapshot exists, use it.
2. If stale or missing, use last snapshot if available.
3. If no snapshot exists, fallback to legacy assembly.

### Layer C: Per-Turn Relevance Selector (New)

Before final prompt assembly, run a fast selector over candidate memory items:

1. Score by lexical overlap and recency.
2. Boost pinned or high-confidence relationship facts.
3. Penalize exhausted topics unless user directly asked about them.

Output only top N facts/threads into the prompt (for example N=8 to 15).

This can start deterministic (no embeddings), then evolve to semantic retrieval if needed.

### Layer D: Topic Exhaustion Policy (Refined)

Track mention events with three modes:

1. `initiated_by_ai`
2. `initiated_by_user`
3. `resolved`

Suppression policy:

1. Suppress only AI-initiated repeats during cooldown.
2. Never suppress user-initiated topics.
3. Auto-decay counts by time window.

### Layer E: Conversation Working Memory Anchor (New)

Maintain a short turn-local summary per conversation:

1. Updated every 3 to 5 turns or when topic changes sharply.
2. Carries unresolved asks, active emotional context, and pending commitments.
3. Injected into prompt ahead of long-term synthesis to prevent intra-conversation amnesia.

---

## 5) Data Contract

Use a strict schema for synthesis payload and validate on write.

Example top-level fields:

1. `relationship_pulse`
2. `user_now`
3. `active_threads`
4. `priority_facts`
5. `suppressed_topics`
6. `scene_pool`
7. `emotional_register`
8. `confidence_notes`

Add `schema_version` so prompt builders can branch safely during migrations.

---

## 6) Implementation Plan

### Phase 1: Safe Foundation

1. Add tables and indexes:
- `context_synthesis`
- `topic_exhaustion`
- optional `conversation_anchor`
2. Add schema validation and serialization guards in the synthesis service.
3. Add feature flags:
- `USE_CONTEXT_SYNTHESIS`
- `USE_TOPIC_EXHAUSTION`
- `USE_CONVERSATION_ANCHOR`

### Phase 2: Prompt Builder Integration

1. Integrate synthesis read path in `systemPromptBuilder`.
2. Keep exact fallback to current sections.
3. Add deterministic top-N selector for facts/threads.

### Phase 3: Post-Turn Hooks

1. Record topic mentions asynchronously in `messageOrchestrator`.
2. Update conversation anchor asynchronously.
3. Add retries and bounded logging for failed background writes.

### Phase 4: Freshness + Triggering

1. Add scheduler action in idle thinking for baseline synthesis refresh.
2. Add event-triggered invalidation on high-impact writes.
3. Add stale snapshot metrics and alert threshold.

---

## 7) Observability And Acceptance Criteria

Track these metrics from day one:

1. Prompt token count p50 and p95.
2. Snapshot freshness distribution.
3. Repeated-topic initiation rate by AI.
4. Known-fact miss rate (example: reacts as if known facts are new).
5. Conversation continuity misses in long threads.

Acceptance criteria before full rollout:

1. 40%+ reduction in dynamic context tokens.
2. 50%+ drop in repeated proactive topic initiations.
3. No increase in empty/invalid response rate.
4. No regression in tool-call success rates.

---

## 8) Risk Controls

1. Feature-flagged rollout by user cohort.
2. One-click rollback to legacy prompt assembly.
3. Snapshot schema compatibility tests.
4. Prompt parity tests that compare old vs new for required sections.
5. Dead-letter logging for background write failures.

---

## 9) Recommended File-Level Changes

Primary files:

1. `supabase/migrations/*_context_synthesis.sql`
2. `src/services/contextSynthesisService.ts`
3. `src/services/topicExhaustionService.ts`
4. `src/services/conversationAnchorService.ts` (new)
5. `src/services/system_prompts/builders/systemPromptBuilder.ts`
6. `src/services/messageOrchestrator.ts`
7. `src/services/idleThinkingService.ts`

Test targets:

1. `src/services/__tests__/contextSynthesisService.test.ts`
2. `src/services/__tests__/topicExhaustionService.test.ts`
3. `src/services/__tests__/conversationAnchorService.test.ts`
4. `src/services/system_prompts/builders/__tests__/systemPromptBuilder.synthesis.test.ts`

---

## 10) Bottom Line

Your direction is correct. The key upgrade I would add is a three-speed memory model:

1. Versioned snapshot for stable medium-term context.
2. Per-turn selector for immediate relevance.
3. Conversation anchor for continuity within long chats.

This gives better salience control, fewer repetitions, and safer operations than a daily synthesis-only design.
