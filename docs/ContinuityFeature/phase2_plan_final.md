# Phase 2A Final Plan (Best Of Both)

Status: Ready for implementation  
Date: 2026-02-12  
Depends on: Phase 1 (Context Synthesis) + Phase 1B (Conversation Anchor)

---

## 1. Problem and Goal

Problem:
- The app still misses known facts during live chat turns, even with synthesis and anchor.
- Example: user references brother promotion, but model asks for already-known brother context.

Goal:
- Add per-turn active recall that retrieves and injects the top relevant stored memory items for the current user message.
- Keep the system safe and fast: fail-open, feature-flagged, bounded latency, bounded prompt size.

---

## 2. Scope

Phase 2A in scope:
- Deterministic lexical relevance matching (no embeddings).
- Sources:
  - `user_facts` from `getUserFacts("all")`
  - `character_facts` from `getCharacterFacts()`
  - active storylines from `getActiveStorylines()`
- Non-greeting prompt path only.
- Feature flag rollout and rollback.

Phase 2B out of scope (future):
- Embeddings and vector search.
- `fact_embeddings` table and pgvector.

---

## 3. Architecture

Turn flow:
1. User sends message.
2. `geminiChatService` builds non-greeting prompt and passes current user text.
3. `activeRecallService` retrieves and ranks memory candidates for that text.
4. Prompt is assembled in this order:
   - static identity shell
   - anti-assistant guardrails
   - world context
   - conversation anchor
   - active recall (new)
   - synthesis
   - topic suppression
   - existing remaining sections
5. Gemini receives prompt.

Fail-open:
- If active recall is disabled, times out, or errors, return empty section and continue normally.

---

## 4. File-Level Changes

New file:
- `src/services/activeRecallService.ts`

Modified:
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
- `src/services/geminiChatService.ts`

Optional tests:
- `src/services/__tests__/activeRecallService.test.ts`

No schema migration for Phase 2A.

---

## 5. Service Contract (Phase 2A)

```ts
export enum RecallSourceType {
  USER_FACT = "user_fact",
  CHARACTER_FACT = "character_fact",
  STORYLINE = "storyline",
}

export interface RecallCandidate {
  id: string;
  sourceType: RecallSourceType;
  key: string;
  value: string;
  updatedAt: string;
  confidence: number; // normalized 0..1
  pinned: boolean;
}

export interface RankedRecallCandidate extends RecallCandidate {
  score: number; // 0..100
  reasons: string[];
}

export async function getRankedRecallCandidates(
  userMessage: string,
  limit?: number
): Promise<RankedRecallCandidate[]>;

export async function buildActiveRecallPromptSection(
  userMessage?: string
): Promise<string>;
```

---

## 6. Scoring Rules (Deterministic)

Total score:
- `score = lexical + keyBonus + recencyBoost + confidenceBoost + pinnedBoost`

Component ranges:
- lexical: `0..60`
- keyBonus: `0..15`
- recencyBoost: `0..15`
- confidenceBoost: `0..10`
- pinnedBoost: `0..5`

Critical gating rule:
- Recency/confidence/pinned boosts apply only if lexical or key match is present.
- This prevents irrelevant facts with high confidence from outranking relevant facts.

Lexical score:
- Tokenize message and candidate text.
- `overlapRatio = intersection / max(tokenSetA, tokenSetB)`
- `lexical = overlapRatio * 60`

Key bonus:
- strong key hit: `+15`
- partial key hit: `+8`

Recency:
- updated <= 7 days: `+15`
- updated <= 30 days: `+8`
- else: `+0`

Confidence mapping (numeric in current tables):
- Clamp confidence to `0..1`.
- `confidenceBoost = round(confidence * 10)`.
- Storyline default confidence: `0.6`.

Pinned boost:
- user fact with `pinned=true`: `+5`.

Selection:
- Filter by `minScore` (default `18`).
- Dedupe normalized `key + value`.
- Sort by `score DESC`, tie-break by `updatedAt DESC`.
- Return top `N` (default `6`, max `7`).

---

## 7. Prompt Integration

### 7.1 `systemPromptBuilder` signature

Update:

```ts
buildSystemPromptForNonGreeting(
  relationship?,
  upcomingEvents?,
  characterContext?,
  messageCount?,
  interactionId?,
  currentUserMessage?
): Promise<string>
```

Injection point:
- In synthesis and fallback paths, place active recall section after anchor and before synthesis/curiosity sections.

### 7.2 `geminiChatService` pass-through

`generateResponse(...)`:
- If `input.type` is `text` or `image_text`, pass `input.text` as `currentUserMessage`.
- If `input.type` is `audio`, pass `undefined`.

`generateNonGreeting(...)`:
- Pass `undefined` for `currentUserMessage`.

---

## 8. Active Recall Prompt Format

```text
====================================================
ACTIVE RECALL (relevant memory for this message)
====================================================
- user_fact.brother_profession: software architect
- user_fact.brother_company: Google
- storyline.family: Mom health check follow-up this week

Use these only if relevant to the current user message.
If current user message conflicts, trust the current message.
====================================================
```

Prompt caps:
- max items: `7`
- max item value length: `140` chars
- total recall section cap: `900` chars

---

## 9. Flags and Runtime Guards

Env flags:

```bash
VITE_USE_ACTIVE_RECALL=false
VITE_ACTIVE_RECALL_LIMIT=6
VITE_ACTIVE_RECALL_MIN_SCORE=18
VITE_ACTIVE_RECALL_TIMEOUT_MS=120
```

Behavior:
- If flag off: return `""`.
- If timeout/error: return `""`.
- Do not block response generation for retrieval failures.

---

## 10. Latency and Safety

Target:
- Added p95 latency under ~120ms for active recall path.

Safety controls:
- Use `Promise.all` to fetch three sources in parallel.
- Optional cap on candidates scored in-memory (for example first 300 by recency).
- Timeout wrapper for retrieval/scoring.
- Avoid logging raw user message text.

Structured logs with prefix:
- `[ActiveRecall]` and include `candidateCount`, `selectedCount`, `durationMs`, `timedOut`, `featureEnabled`.

---

## 11. Implementation Sequence

1. Create `src/services/activeRecallService.ts` with candidate mapping, scoring, and section builder.
2. Integrate section into `src/services/system_prompts/builders/systemPromptBuilder.ts`.
3. Thread `currentUserMessage` through `src/services/geminiChatService.ts`.
4. Add focused tests in `src/services/__tests__/activeRecallService.test.ts`.
5. Run manual smoke tests and collect latency/recall logs.

---

## 12. Acceptance Criteria

Functional:
1. Relevant known facts appear in prompt when message has clear match.
2. No recall section when feature flag is off.
3. No recall section in greeting path.
4. If active recall errors, chat still works with normal prompt.

Quality:
1. No duplicate recall entries.
2. Recall section always within caps.
3. Irrelevant high-confidence facts do not appear without lexical/key match.
4. Latency remains within target bounds.

---

## 13. Verification (Proposed, Not Run)

```bash
npm run build
npm test -- --run
npm test -- --run -t "activeRecallService"
```

Manual checks:
1. Brother-related message retrieves brother facts.
2. Unrelated message yields empty or low-noise recall section.
3. Flag off produces no behavior change.
4. Prompt order confirms `anchor -> active recall -> synthesis`.

---

## 14. Phase 2B Entry Criteria

Move to semantic retrieval only after Phase 2A proves:
- measurable reduction in known-fact misses
- acceptable latency and token cost
- stable low-noise recall quality

Then implement:
- embeddings pipeline
- vector store/index
- lexical vs semantic A/B evaluation

---

## 15. Phase 2B Objective

Phase 2B upgrades Active Recall from lexical-only retrieval to semantic retrieval, so the system can recall relevant facts even when wording does not overlap directly.

Example:
- User message: "I think my sibling finally got that title bump."
- Stored fact: `brother_profession: software architect`
- Lexical match may be weak.
- Semantic retrieval should still surface the correct family/profession facts.

Primary objective:
- Improve recall quality on paraphrased, indirect, or loosely worded references while keeping Phase 2A safety behavior.

---

## 16. Phase 2B Retrieval Mode

Use a hybrid retrieval mode first:

1. Generate query embedding for current user message.
2. Retrieve top semantic candidates from embedding index.
3. Re-rank with deterministic boosts (recency, confidence, pinned, optional lexical/key signal).
4. Keep fail-open fallback chain:
   - semantic/hybrid retrieval
   - lexical Phase 2A retrieval
   - empty section

Final mode can later move to pure semantic if hybrid does not improve quality.

---

## 17. Data Model and Migrations

### 17.1 `fact_embeddings` table

```sql
create extension if not exists vector;

create table if not exists public.fact_embeddings (
  id uuid not null default extensions.uuid_generate_v4(),
  source_type text not null,              -- 'user_fact' | 'character_fact' | 'storyline'
  source_id text not null,                -- source row id
  source_key text not null,               -- denormalized key/title
  source_value text not null,             -- denormalized value/body
  source_updated_at timestamptz not null,
  confidence numeric not null default 0.6,
  pinned boolean not null default false,
  embedding_model text not null,          -- e.g. text-embedding-004
  embedding vector(768) not null,
  embedding_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fact_embeddings_pkey primary key (id),
  constraint fact_embeddings_unique unique (source_type, source_id, embedding_model, embedding_version)
);
```

Indexes:

```sql
create index if not exists idx_fact_embeddings_source
  on public.fact_embeddings (source_type, source_id);

create index if not exists idx_fact_embeddings_updated
  on public.fact_embeddings (source_updated_at desc);

create index if not exists idx_fact_embeddings_vector
  on public.fact_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
```

### 17.2 Optional job table for resiliency

If inline embedding writes become unreliable, add:
- `fact_embedding_jobs` for retry/backoff and dead-letter handling.
- This can be deferred until needed, but schema should be easy to add without breaking `fact_embeddings`.

---

## 18. Embedding Sync Pipeline

### 18.1 Sources to embed

- `user_facts`
- `character_facts`
- active `life_storylines` (or all storylines, if needed for recall quality)

### 18.2 Sync triggers

Run on source writes (insert/update/delete):
- `storeUserFact(...)` in `src/services/memoryService.ts`
- `storeCharacterFact(...)` in `src/services/characterFactsService.ts`
- storyline create/update paths in `src/services/storylineService.ts`

Behavior:
- insert/update source -> upsert embedding row
- delete source -> delete embedding row
- failures should not block user request path

### 18.3 Backfill

Before enabling semantic retrieval:
1. Backfill all existing source rows into `fact_embeddings`.
2. Validate row counts by source type.
3. Log and retry failed rows.

---

## 19. Semantic Retrieval Contract

Extend `activeRecallService` with semantic path:

```ts
export async function getRankedRecallCandidatesSemantic(
  userMessage: string,
  maxItems?: number
): Promise<RankedRecallCandidate[]>;
```

Semantic candidate retrieval:
- query embedding generated from current user message
- top-K nearest neighbors by cosine similarity
- apply min semantic threshold before re-ranking

Hybrid re-rank (recommended first):
- `finalScore = semanticScore + recencyBoost + confidenceBoost + pinnedBoost + optionalLexicalBonus`
- keep dedupe and output caps from Phase 2A

---

## 20. Runtime Flags and Rollout

Add Phase 2B flags:

```bash
VITE_ACTIVE_RECALL_MODE=lexical              # lexical | hybrid | semantic
VITE_ACTIVE_RECALL_EMBEDDING_MODEL=text-embedding-004
VITE_ACTIVE_RECALL_SEMANTIC_TOP_K=20
VITE_ACTIVE_RECALL_SEMANTIC_MIN_SIM=0.70
VITE_ACTIVE_RECALL_SEMANTIC_TIMEOUT_MS=180
```

Rollout sequence:
1. Deploy schema + backfill with `mode=lexical`.
2. Enable `mode=hybrid` in staging.
3. Validate quality/latency/error rate.
4. Enable `mode=hybrid` in production.
5. Optionally test `mode=semantic`.

Rollback:
- set `VITE_ACTIVE_RECALL_MODE=lexical`
- no data rollback required

---

## 21. Latency and Cost Targets (Phase 2B)

Targets:
- p95 retrieval overhead <= 180ms
- embedding failure rate < 1%
- prompt size caps unchanged from Phase 2A

Expected incremental cost:
- per-turn query embedding generation
- storage + maintenance of embedding rows

Guardrails:
- timeout semantic path aggressively
- fallback to lexical path on timeout/error
- avoid blocking chat flow on embedding sync failures

---

## 22. Observability

Add structured logs with `[ActiveRecall]` and mode tags:
- `mode`
- `semanticTopK`
- `semanticCandidates`
- `semanticMinSim`
- `fallbackUsed` (`none`, `lexical`, `empty`)
- `durationMs`
- `timedOut`
- `featureEnabled`

Track metrics:
- known-fact miss rate (lexical vs hybrid/semantic)
- recall section usage rate
- semantic retrieval latency p50/p95
- fallback rate from semantic to lexical
- embedding sync failure counts

---

## 23. Phase 2B Acceptance Criteria

Functional:
1. Semantic/hybrid mode retrieves relevant facts for paraphrased user messages where lexical retrieval fails.
2. Fallback chain works: semantic failure automatically degrades to lexical, then empty.
3. Existing Phase 2A section caps and prompt ordering remain unchanged.

Quality:
1. Known-fact miss rate improves over lexical baseline.
2. No significant increase in noisy/irrelevant recall entries.
3. p95 overhead remains within target.

Operational:
1. Backfill complete with reconciled counts.
2. Error/fallback metrics visible in logs/dashboard.
3. Rollback to lexical mode is immediate via env flag.

---

## 24. Phase 2B Verification (Proposed, Not Run)

```bash
npm run build
npm test -- --run
npm test -- --run -t "activeRecallService"
```

Manual checks:
1. Paraphrase test cases: semantic/hybrid finds correct memories with low lexical overlap.
2. Forced timeout test: semantic path times out and lexical fallback still produces section.
3. Mode switch test: `lexical` vs `hybrid` behavior changes without code changes.
4. Data sync test: updating a fact updates its embedding row.
