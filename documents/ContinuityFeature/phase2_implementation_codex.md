# Phase 2 Implementation (Codex)

Status: Ready to implement  
Date: 2026-02-12  
Depends on: Phase 1 (context synthesis) and Phase 1B (conversation anchor)

---

## 1) Objective

Reduce known-fact misses during normal chat turns by adding per-turn "active recall":
- On each user message, retrieve the most relevant stored memory items.
- Inject a compact recall section near the top of the non-greeting prompt.
- Keep failure mode safe: if retrieval fails, prompt builds normally without recall section.

Phase 2 target outcome:
- Fewer responses that ask for facts we already have.
- Better continuity on personal details (family, preferences, current life context).

---

## 2) Final Scope For Phase 2A (MVP)

In scope:
- Deterministic lexical relevance scoring (no embeddings yet).
- Source coverage:
  - `user_facts` via `getUserFacts("all")`
  - `character_facts` via `getCharacterFacts()`
  - active storylines via `getActiveStorylines()`
- Prompt injection only for non-greeting response path.
- Feature-flagged rollout with strict prompt-size limits.

Out of scope (Phase 2B):
- Vector embeddings
- pgvector migration
- semantic similarity RPC

---

## 3) Architecture

Flow for each non-greeting text turn:

1. User sends message.
2. Build non-greeting system prompt.
3. New active recall service computes top relevant memory items for this message.
4. Prompt order becomes:
- identity shell
- anti-assistant
- world context
- conversation anchor
- active recall (new)
- synthesis
- topic suppression
- existing remaining sections
5. Send prompt to Gemini.

Fail-open behavior:
- If active recall fails or times out, return empty recall section and continue.

---

## 4) File-Level Implementation Plan

### New file

`src/services/activeRecallService.ts`

Responsibilities:
- gather candidates from memory sources
- tokenize message and candidate text
- score candidates deterministically
- dedupe and pick top N
- format prompt section

Proposed interfaces:

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
  maxItems?: number
): Promise<RankedRecallCandidate[]>;

export async function buildActiveRecallPromptSection(
  userMessage: string | undefined
): Promise<string>;
```

### Modify

`src/services/system_prompts/builders/systemPromptBuilder.ts`
- Add optional parameter for current user text:
  - `currentUserMessage?: string`
- Call `buildActiveRecallPromptSection(currentUserMessage)` in both:
  - synthesis path
  - fallback path
- Place section after anchor and before synthesis/curiosity.

`src/services/geminiChatService.ts`
- Pass user message text into `buildSystemPromptForNonGreeting(...)` on live chat path:
  - for `input.type === "text"` use `input.text`
  - for `input.type === "image_text"` use `input.text`
  - for `input.type === "audio"` pass `undefined` (skip recall section)
- For `generateNonGreeting(...)`, pass `undefined`.

### Optional tests

`src/services/__tests__/activeRecallService.test.ts`
- scoring logic
- threshold behavior
- dedupe behavior
- prompt-size cap
- graceful failure behavior

---

## 5) Scoring Model (Deterministic)

Use a bounded additive score with explicit components:

`totalScore = lexical + keyBonus + recencyBoost + confidenceBoost + pinnedBoost`

Component ranges:
- `lexical`: 0..60
- `keyBonus`: 0..15
- `recencyBoost`: 0..15
- `confidenceBoost`: 0..10
- `pinnedBoost`: 0..5

### 5.1 Lexical score (0..60)

Tokenize both sides, compute overlap ratio:

`overlapRatio = intersection(tokensA, tokensB) / max(sizeA, sizeB)`

`lexical = overlapRatio * 60`

Candidate text for scoring:
- user fact: `fact_key + " " + fact_value`
- character fact: `fact_key + " " + fact_value`
- storyline: `title + " " + initialAnnouncement + " " + stakes + " " + currentEmotionalTone`

### 5.2 Key bonus (0..15)

Direct key hit bonus if message contains meaningful key fragments:
- exact/near match on key tokens -> +15
- partial key match -> +8

### 5.3 Recency boost (0..15)

Based on `updated_at` (or mapped source timestamp):
- <= 7 days: +15
- <= 30 days: +8
- else: +0

### 5.4 Confidence boost (0..10)

For tables with numeric confidence (0..1):
- `confidenceBoost = round(clamp(confidence, 0, 1) * 10)`

For storylines (no confidence field):
- fixed default confidence `0.6` -> +6

### 5.5 Pinned boost (0..5)

Only for user facts:
- `pinned === true` -> +5

### 5.6 Filter, dedupe, select

- Minimum threshold: `score >= minScore` (configurable, default 18).
- Dedupe by normalized `key + value` fingerprint.
- Sort by `score DESC`, then `updatedAt DESC`.
- Select top `N` (configurable, default 6, max 7).

---

## 6) Prompt Section Format

Keep section compact and deterministic:

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

Prompt constraints:
- hard cap: 900 chars total for active recall section
- max items: 7
- max line length: truncate value to 140 chars

---

## 7) Config and Flags

Use env config with safe defaults:

```bash
VITE_USE_ACTIVE_RECALL=false
VITE_ACTIVE_RECALL_LIMIT=6
VITE_ACTIVE_RECALL_MIN_SCORE=18
VITE_ACTIVE_RECALL_TIMEOUT_MS=120
```

Behavior:
- if `VITE_USE_ACTIVE_RECALL !== "true"` -> return `""`
- if timeout/error -> return `""`
- no DB writes in Phase 2A

---

## 8) Performance and Safety

Latency guardrails:
- single parallel fetch for three sources
- cap candidate count before scoring if needed (for example first 300 by updated_at)
- timeout guard around overall retrieval/scoring path

Safety:
- no destructive operations
- no migration required for Phase 2A
- no changes to existing memory write APIs

Logging (structured):
- prefix: `[ActiveRecall]`
- include:
  - `messageTokenCount`
  - `candidateCount`
  - `selectedCount`
  - `durationMs`
  - `featureEnabled`
  - `timedOut`

Do not log raw user message text.

---

## 9) Implementation Steps (Order)

1. Create `src/services/activeRecallService.ts` with candidate mapping, scoring, and prompt builder.
2. Add recall section integration to `src/services/system_prompts/builders/systemPromptBuilder.ts`.
3. Pass current user message into prompt builder from `src/services/geminiChatService.ts`.
4. Add unit tests in `src/services/__tests__/activeRecallService.test.ts`.
5. Add documentation notes to `docs/phase2_plan.md` once implementation stabilizes.

---

## 10) Acceptance Criteria

Functional:
1. With flag on, known matching facts appear in prompt recall section for relevant user messages.
2. With flag off, prompt output is unchanged from current behavior.
3. Recall section never appears on greeting path.
4. On failures/timeouts, app still responds normally.

Quality:
1. No duplicate entries in recall section.
2. Recall section respects item and size caps.
3. Latency overhead stays bounded (target p95 under ~120ms for recall path).

---

## 11) Verification Commands (Proposed, Not Run)

```bash
npm run build
npm test -- --run
```

Optional focused check:

```bash
npm test -- --run -t "activeRecallService"
```

---

## 12) Phase 2B Preview (After Phase 2A Stabilizes)

When Phase 2A quality is confirmed:
- add embedding generation pipeline
- add `fact_embeddings` table + vector index
- run lexical vs semantic A/B evaluation
- promote semantic path only if recall gain justifies added latency and complexity

