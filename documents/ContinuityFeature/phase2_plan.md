# Phase 2: Per-Turn Relevance Matching ("Active Recall")

**Status:** Ready for implementation (unified plan)
**Depends on:** Phase 1 (Synthesis) + Phase 1b (Anchor) must be live first
**Last updated:** 2026-02-12

---

## Problem Statement

Even with synthesis (Phase 1) and conversation anchor (Phase 1b), the system still has a **known-fact miss rate** problem:

**Example failure:**
```
User: "My brother just got promoted to senior architect"
Kayley: "That's amazing! What field is he in?"

[System has fact: brother_profession: "software architect" from 2 months ago]
```

The fact exists in `user_facts` table but isn't in the synthesis document (which prioritizes recent/high-value facts). The LLM doesn't know to recall it because:
1. Synthesis picks top 10-15 facts globally (out of 100+)
2. Anchor is turn-local (doesn't carry historical facts)
3. No per-turn retrieval of relevant facts based on current message

**Solution:** Add **per-turn relevance matching** — on each user message, query stored memory and inject the top 6-7 most relevant items into the prompt.

---

## Architecture Overview

### Phase 2 Flow

```
User message
    ↓
[NEW] Per-turn relevance matching:
  - Extract keywords from user message
  - Query user_facts, character_facts, active storylines
  - Rank by relevance (lexical + key bonus + recency + confidence + pinned)
  - Select top 6-7 items
    ↓
Build system prompt:
  - Static shell
  - Conversation anchor (turn-local state)
  - [NEW] Active recall section (top 6-7 relevant items) ← HIGHEST PRIORITY
  - Synthesis (daily briefing, background)
  - Topic suppression
  - Real-time context
    ↓
Send to Gemini
```

**Result:** Relevant facts are pulled to the **top of the prompt** on each turn, mimicking human active recall during conversation.

---

## Design Principles

### 1. Start Deterministic, Evolve to Semantic

**Phase 2a (MVP):** Lexical matching
- Keyword overlap between user message and stored facts
- Boosted by key match, recency, confidence, and pinned status
- **No embeddings**, **no vector DB** (fast, simple)
- Latency: ~40-80ms

**Phase 2b (Future):** Semantic matching
- Embed user message and all facts (once)
- Cosine similarity search via pgvector
- Requires: embedding generation pipeline, vector index
- Latency: ~60-120ms (embedding + search)

**Rationale:** Start simple. Most fact recalls are lexical ("my brother" → retrieve `brother_*` facts). Semantic search adds complexity and cost; validate the pattern first.

### 2. Multi-Source Coverage

**Sources included:**
- `user_facts` (100-200 items): User preferences, family, work, hobbies
- `character_facts` (20-30 items): Kayley's traits, backstory, preferences
- `storylines` (5-10 active): Ongoing narrative threads

**Rationale:** "Tell me about yourself" should recall Kayley's traits. "My brother" should recall brother facts. "How's that project going?" should recall active storylines.

### 3. Fail-Open Safety

- If retrieval fails or times out → return empty section
- If feature flag off → return empty section
- No blocking on hot path, no destructive operations

---

## Phase 2a: Lexical Matching (MVP)

### Data Model

```typescript
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
  confidence: number;       // 0.0-1.0 (normalized)
  pinned: boolean;          // user_facts only
}

export interface RankedRecallCandidate extends RecallCandidate {
  score: number;            // 0-105
  reasons: string[];        // ["lexical_match", "key_bonus", "recent", ...]
}
```

### Relevance Scoring Algorithm

**Total score = lexical + keyBonus + recencyBoost + confidenceBoost + pinnedBoost**

| Component | Range | Description |
|-----------|-------|-------------|
| **Lexical** | 0-60 | Token overlap between message and candidate text |
| **Key bonus** | 0-15 | Exact/partial match on fact_key tokens |
| **Recency** | 0-15 | How recently the fact was updated |
| **Confidence** | 0-10 | Fact confidence level (high/medium/low) |
| **Pinned** | 0-5 | Pinned user facts get priority |
| **MAX** | 105 | Total possible score |

#### 1. Lexical Score (0-60 points)

Token overlap between user message and candidate text.

```typescript
function computeLexicalScore(
  messageTokens: string[],
  candidateTokens: string[]
): number {
  const msgSet = new Set(messageTokens);
  const candSet = new Set(candidateTokens);
  const intersection = [...msgSet].filter(t => candSet.has(t));
  const overlapRatio = intersection.length / Math.max(msgSet.size, candSet.size);
  return overlapRatio * 60;
}
```

**Candidate text:**
- User fact: `${fact_key} ${fact_value}`
- Character fact: `${fact_key} ${fact_value}`
- Storyline: `${title} ${initialAnnouncement} ${stakes} ${currentEmotionalTone}`

**Example:**
```
User: "My brother just got promoted"
Fact: brother_name: "Alex"

Message tokens: ["brother", "promoted"]
Candidate tokens: ["brother", "name", "alex"]

Overlap: ["brother"] = 1 token
Ratio: 1 / max(2, 3) = 1/3 = 0.33
Score: 0.33 * 60 = 20 points
```

#### 2. Key Bonus (0-15 points)

Boost facts where the **key itself** matches message tokens (not just value).

```typescript
function computeKeyBonus(messageTokens: string[], keyTokens: string[]): number {
  const msgSet = new Set(messageTokens);
  const keySet = new Set(keyTokens);
  const keyMatches = [...keySet].filter(t => msgSet.has(t)).length;

  if (keyMatches === keySet.size) return 15;  // Exact key match
  if (keyMatches > 0) return 8;               // Partial key match
  return 0;
}
```

**Example:**
```
User: "Tell me about my brother"
Fact key: "brother_name"

Key tokens: ["brother", "name"]
Message contains "brother" → +5 points (partial)
```

**Rationale:** "brother" in message → prioritize ALL `brother_*` facts.

#### 3. Recency Boost (0-15 points)

More recent facts rank higher.

```typescript
function computeRecencyBoost(updatedAt: string): number {
  const daysSince = daysBetween(updatedAt, new Date());
  if (daysSince <= 7) return 15;    // Last week
  if (daysSince <= 30) return 8;    // Last month
  return 0;                         // Older
}
```

**Rationale:** Recent facts are more conversationally relevant.

#### 4. Confidence Boost (0-10 points)

Higher-confidence facts rank higher.

```typescript
function computeConfidenceBoost(confidence: number): number {
  // confidence is 0.0-1.0
  return Math.round(confidence * 10);
}
```

**Mapping:**
- `confidence: 1.0` → 15 points
- `confidence: 0.6` → 9 points
- `confidence: 0.3` → 4 points

**For storylines** (no confidence field): Use default `0.6` → 9 points.

#### 5. Pinned Boost (0-5 points)

Pinned user facts get priority (honors `user_facts.pinned` field).

```typescript
function computePinnedBoost(pinned: boolean): number {
  return pinned ? 5 : 0;
}
```

**Rationale:** User explicitly pinned these facts as important.

---

### Selection Algorithm

```typescript
export async function getRankedRecallCandidates(
  userMessage: string,
  maxItems: number = 6
): Promise<RankedRecallCandidate[]> {
  // 1. Gather candidates from all sources (parallel fetch)
  const [userFacts, characterFacts, storylines] = await Promise.all([
    getUserFacts("all"),
    getCharacterFacts(),
    getActiveStorylines(),
  ]);

  // 2. Map to RecallCandidate format
  const candidates: RecallCandidate[] = [
    ...mapUserFacts(userFacts),
    ...mapCharacterFacts(characterFacts),
    ...mapStorylines(storylines),
  ];

  // 3. Tokenize message (once)
  const messageTokens = tokenize(userMessage);

  // 4. Score all candidates
  const scored: RankedRecallCandidate[] = candidates.map(cand => {
    const candTokens = tokenize(getCandidateText(cand));
    const keyTokens = tokenize(cand.key);

    const lexical = computeLexicalScore(messageTokens, candTokens);
    const keyBonus = computeKeyBonus(messageTokens, keyTokens);
    const recency = computeRecencyBoost(cand.updatedAt);
    const confidence = computeConfidenceBoost(cand.confidence);
    const pinned = computePinnedBoost(cand.pinned);

    const score = lexical + keyBonus + recency + confidence + pinned;
    const reasons = buildReasonList({ lexical, keyBonus, recency, confidence, pinned });

    return { ...cand, score, reasons };
  });

  // 5. Filter by min threshold
  const MIN_SCORE = parseInt(import.meta.env.VITE_ACTIVE_RECALL_MIN_SCORE || "18", 10);
  const aboveThreshold = scored.filter(c => c.score >= MIN_SCORE);

  // 6. Deduplicate by key+value fingerprint
  const deduped = deduplicateCandidates(aboveThreshold);

  // 7. Sort by score DESC, then updatedAt DESC
  deduped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  // 8. Take top N
  return deduped.slice(0, maxItems);
}
```

**Tokenization:**
```typescript
function tokenize(text: string): string[] {
  const stopwords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at",
    "to", "for", "of", "with", "by", "from", "as", "is", "was",
    "are", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "should", "could",
    "i", "you", "he", "she", "it", "we", "they",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")  // Remove punctuation
    .split(/\s+/)
    .filter(token => token.length > 2 && !stopwords.has(token));
}
```

**Deduplication:**
```typescript
function deduplicateCandidates(candidates: RankedRecallCandidate[]): RankedRecallCandidate[] {
  const seen = new Set<string>();
  return candidates.filter(c => {
    const fingerprint = `${c.sourceType}:${c.key}:${c.value.toLowerCase()}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}
```

---

## Prompt Integration

### File: `src/services/system_prompts/builders/systemPromptBuilder.ts`

**Modified signature:**
```typescript
export async function buildSystemPromptForNonGreeting(
  options: BuildPromptOptions,
  interactionId?: string | null,
  currentUserMessage?: string  // NEW PARAMETER
): Promise<string>
```

**Injection point:** After anchor, before synthesis

```typescript
const anchorSection = await buildConversationAnchorPromptSection(interactionId);
const activeRecallSection = await buildActiveRecallPromptSection(currentUserMessage); // NEW

let prompt = `
${KAYLEY_CONDENSED_PROFILE}
${buildAntiAssistantSection()}
${await buildCurrentWorldContext()}
${anchorSection}              // Turn-local state (unresolved asks, commitments)
${activeRecallSection}        // ← NEW: Per-turn relevant facts (HIGHEST PRIORITY)
${synthesisSection}           // Daily briefing (background context)
${topicSuppressionPrompt}
// ... rest unchanged
`.trim();
```

### File: `src/services/geminiChatService.ts`

**Pass user message to prompt builder:**

```typescript
// For text input
if (input.type === "text") {
  systemPrompt = await buildSystemPromptForNonGreeting(
    options,
    session?.interactionId,
    input.text  // ← Pass current message
  );
}

// For image + text input
if (input.type === "image_text") {
  systemPrompt = await buildSystemPromptForNonGreeting(
    options,
    session?.interactionId,
    input.text  // ← Pass text component
  );
}

// For audio input (skip recall, no text to match against)
if (input.type === "audio") {
  systemPrompt = await buildSystemPromptForNonGreeting(
    options,
    session?.interactionId,
    undefined  // ← No user message, recall section will be empty
  );
}

// For generateNonGreeting (background idle thinking, skip recall)
systemPrompt = await buildSystemPromptForNonGreeting(
  options,
  undefined,
  undefined  // ← No active conversation
);
```

---

## Prompt Section Format

### Active Recall Section Template

```typescript
export async function buildActiveRecallPromptSection(
  currentUserMessage: string | undefined
): Promise<string> {
  // Feature flag check
  if (import.meta.env.VITE_USE_ACTIVE_RECALL !== "true") {
    return "";
  }

  // No message → skip
  if (!currentUserMessage) {
    return "";
  }

  try {
    const limit = parseInt(import.meta.env.VITE_ACTIVE_RECALL_LIMIT || "6", 10);
    const timeoutMs = parseInt(import.meta.env.VITE_ACTIVE_RECALL_TIMEOUT_MS || "120", 10);

    // Retrieve with timeout guard
    const candidates = await Promise.race([
      getRankedRecallCandidates(currentUserMessage, limit),
      timeout(timeoutMs),
    ]);

    if (!candidates || candidates.length === 0) {
      return "";
    }

    // Build section
    const items = candidates.map(c => {
      const sourcePrefix = c.sourceType;
      const truncatedValue = truncate(c.value, 140);
      return `- ${sourcePrefix}.${c.key}: ${truncatedValue}`;
    }).join("\n");

    const section = `
====================================================
ACTIVE RECALL (relevant memory for this message)
====================================================
${items}

Use these only if relevant to the current user message.
If current user message conflicts, trust the current message.
====================================================
`.trim();

    // Hard cap: 900 chars
    return section.length > 900 ? truncate(section, 900) : section;
  } catch (err) {
    console.error("[ActiveRecall] Failed to build section", { err });
    return ""; // Graceful degradation
  }
}
```

**Example output:**
```
====================================================
ACTIVE RECALL (relevant memory for this message)
====================================================
- user_fact.brother_profession: software architect
- user_fact.brother_company: Google
- user_fact.brother_name: Alex
- storyline.family: Mom health check follow-up this week

Use these only if relevant to the current user message.
If current user message conflicts, trust the current message.
====================================================
```

**Token impact:** ~100-150 tokens (6-7 items)

---

## Configuration

### Environment Variables

```bash
# Feature flag (required)
VITE_USE_ACTIVE_RECALL=false            # Enable/disable active recall

# Tuning parameters (optional, with defaults)
VITE_ACTIVE_RECALL_LIMIT=6              # Max items to retrieve (max 7)
VITE_ACTIVE_RECALL_MIN_SCORE=18         # Min relevance score (0-105 scale)
VITE_ACTIVE_RECALL_TIMEOUT_MS=120       # Retrieval timeout (milliseconds)
```

**Defaults:**
- Feature flag: `false` (opt-in for safe rollout)
- Limit: `6` items (max `7`)
- Min score: `18` points (filters weak matches)
- Timeout: `120ms` (fail-open if slow)

**Rollback:**
Set `VITE_USE_ACTIVE_RECALL=false` → instant rollback, zero prompt impact.

---

## Service Architecture

### New File: `src/services/activeRecallService.ts`

**Exports:**
```typescript
// Types
export enum RecallSourceType { ... }
export interface RecallCandidate { ... }
export interface RankedRecallCandidate { ... }

// Core functions
export async function getRankedRecallCandidates(
  userMessage: string,
  maxItems?: number
): Promise<RankedRecallCandidate[]>;

export async function buildActiveRecallPromptSection(
  currentUserMessage: string | undefined
): Promise<string>;

// Internal helpers (exported for testing)
export function tokenize(text: string): string[];
export function computeLexicalScore(msgTokens: string[], candTokens: string[]): number;
export function computeKeyBonus(msgTokens: string[], keyTokens: string[]): number;
export function computeRecencyBoost(updatedAt: string): number;
export function computeConfidenceBoost(confidence: number): number;
export function computePinnedBoost(pinned: boolean): number;
```

**Key implementation notes:**
- Parallel fetch for all 3 sources (user_facts, character_facts, storylines)
- Single tokenization pass for message
- In-memory scoring (no DB writes)
- Timeout guard around entire retrieval path
- Structured logging with `[ActiveRecall]` prefix

---

## Latency Analysis

### Phase 2a (Lexical)

| Operation | Time | Notes |
|-----------|------|-------|
| Parallel fetch (3 sources) | ~15-25ms | Indexed DB queries |
| Tokenize message | ~2-5ms | Single pass |
| Map candidates | ~5-10ms | ~150-250 items |
| Score candidates | ~15-30ms | In-memory operations |
| Sort & dedupe | ~2-5ms | ~150 items |
| Build prompt section | ~1-3ms | String formatting |
| **Total (p50)** | **~40-80ms** | Acceptable overhead |
| **Total (p95)** | **~80-120ms** | Within timeout guard |

**Impact:** Acceptable. Adds <100ms to turn latency on hot path.

### Phase 2b (Semantic)

| Operation | Time | Notes |
|-----------|------|-------|
| Generate embedding | ~50-100ms | Gemini API call |
| Vector search (pgvector) | ~10-20ms | Indexed similarity search |
| **Total** | **~60-120ms** | Slightly higher but worth it |

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No facts in DB | Empty section, graceful fallback |
| All facts score < min threshold | Empty section |
| User message too short (<3 tokens) | Empty section (no meaningful matches) |
| Retrieval timeout (>120ms) | Empty section, log warning |
| Feature flag off | Empty section, zero impact |
| currentUserMessage = undefined | Empty section (audio/idle paths) |
| Duplicate candidates | Deduplicated by key+value fingerprint |
| Section > 900 chars | Truncated to 900 chars |

---

## Implementation Phases

### Phase 2a: Lexical Matching (MVP) — THIS PHASE

**Scope:**
1. Create `src/services/activeRecallService.ts` (~300 lines)
   - Candidate mapping from 3 sources
   - 5-component scoring algorithm
   - Deduplication and selection
   - Prompt section builder
2. Modify `src/services/system_prompts/builders/systemPromptBuilder.ts` (~10 lines)
   - Add `currentUserMessage` parameter
   - Inject active recall section after anchor
3. Modify `src/services/geminiChatService.ts` (~10 lines)
   - Pass current user message to prompt builder
4. Add feature flag and config to `.env`
5. Manual smoke tests (see Verification below)

**Timeline:** 1-2 days (after Phase 1b is live)

**Risk:** Low (feature flag, fail-open, no DB writes)

---

### Phase 2b: Semantic Matching (Future)

**Scope:**
1. Add `fact_embeddings` table with pgvector
2. Implement embedding generation pipeline (on fact write)
3. Add `match_facts()` RPC for similarity search
4. Implement `getRelevantFactsSemantic()` function
5. A/B test lexical vs semantic
6. Promote to default if >15% improvement

**Timeline:** 1-2 weeks (requires infrastructure)

**Risk:** Medium (new dependencies, API costs, complexity)

---

## Database Schema

### Phase 2a: No Changes

No new tables or migrations required. Uses existing:
- `user_facts` (via `getUserFacts("all")`)
- `character_facts` (via `getCharacterFacts()`)
- `storylines` (via `getActiveStorylines()`)

### Phase 2b: Embeddings Table (Future)

```sql
-- New table for semantic search
create table public.fact_embeddings (
  id uuid not null default extensions.uuid_generate_v4(),
  fact_table text not null,           -- "user_facts" | "character_facts" | "storylines"
  fact_id uuid not null,              -- FK to source table
  fact_text text not null,            -- Concatenated key + value
  embedding vector(768) not null,     -- Gemini text-embedding-004 (768 dims)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fact_embeddings_pkey primary key (id),
  constraint fact_embeddings_fact_unique unique (fact_table, fact_id)
);

-- Vector similarity index (requires pgvector extension)
create index idx_fact_embeddings_vector
  on public.fact_embeddings using ivfflat (embedding vector_cosine_ops);

-- Standard updated_at trigger
create trigger update_fact_embeddings_updated_at
  before update on public.fact_embeddings
  for each row
  execute function update_updated_at_column();
```

**Embedding generation:**
```typescript
// On fact write (insert/update)
const factText = `${fact.fact_key}: ${fact.fact_value}`;
const embedding = await generateEmbedding(factText); // Gemini API
await storeFactEmbedding(fact.id, "user_facts", embedding);
```

**Similarity search:**
```sql
CREATE OR REPLACE FUNCTION match_facts(
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  fact_table text,
  fact_id uuid,
  fact_text text,
  similarity float
)
LANGUAGE sql
AS $$
  SELECT
    fact_table,
    fact_id,
    fact_text,
    1 - (embedding <=> query_embedding) AS similarity
  FROM fact_embeddings
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
```

---

## Verification

### Manual Tests (Phase 2a)

1. **Keyword match:**
   - Fact: `user_fact.brother_name: "Alex"`
   - Message: "My brother just got promoted"
   - Expected: Fact appears in active recall section (lexical + key bonus)

2. **Key bonus:**
   - Facts: `brother_name`, `brother_profession`, `brother_company`
   - Message: "Tell me about my brother"
   - Expected: All `brother_*` facts rank high (key bonus)

3. **Recency boost:**
   - Fact A: `espresso_machine: "Breville" (updated 2 days ago)`
   - Fact B: `coffee_grinder: "Baratza" (updated 60 days ago)`
   - Message: "I spilled coffee this morning"
   - Expected: Fact A ranks higher (recency + lexical)

4. **Confidence boost:**
   - Fact A: `mom_profession: "CPA" (confidence: high = 1.0)`
   - Fact B: `uncle_hobby: "fishing" (confidence: low = 0.3)`
   - Message: "Tell me about my family"
   - Expected: Fact A ranks higher (confidence boost)

5. **Pinned boost:**
   - Fact A: `coffee_preference: "espresso" (pinned: true)`
   - Fact B: `tea_preference: "green tea" (pinned: false)`
   - Message: "I need caffeine"
   - Expected: Fact A ranks higher if lexical scores are close

6. **Multi-source recall:**
   - User fact: `brother_name: "Alex"`
   - Character fact: `kayley_siblings: "2 older sisters"`
   - Message: "Tell me about siblings"
   - Expected: Both user fact and character fact appear

7. **Storyline recall:**
   - Active storyline: `family: "Mom health scare follow-up"`
   - Message: "How's that thing with my mom going?"
   - Expected: Storyline appears in recall section

8. **No match fallback:**
   - Message: "The weather is nice today"
   - Expected: Empty recall section (no relevant facts)

9. **Prompt inspection:**
   - Log full prompt with `VITE_USE_ACTIVE_RECALL=true`
   - Verify active recall appears after anchor, before synthesis
   - Verify format: `- source_type.key: value`

10. **Feature flag off:**
    - Set `VITE_USE_ACTIVE_RECALL=false`
    - Send message
    - Expected: No active recall section, prompt identical to pre-Phase 2

### Metrics (Phase 2a)

**Primary:**
- **Known-fact miss rate:** % of turns where relevant fact exists in DB but wasn't recalled in response
- **Recall usage rate:** % of turns where active recall section is non-empty

**Secondary:**
- **Retrieval latency:** p50/p95/p99 for `getRankedRecallCandidates()`
- **Section size:** Average chars in active recall section
- **Candidate count:** Average number of candidates scored per turn
- **Timeout rate:** % of turns where retrieval hits 120ms timeout

---

## Logging

**Prefix:** `[ActiveRecall]`

**Structured log fields:**
```typescript
console.log("[ActiveRecall] Retrieved candidates", {
  messageTokenCount: number,
  candidateCount: number,
  selectedCount: number,
  durationMs: number,
  featureEnabled: boolean,
  timedOut: boolean,
});
```

**Do NOT log:**
- Raw user message text (PII)
- Full fact values (privacy)

---

## Open Questions (Resolved)

1. ~~**Should character facts be included?**~~
   - ✅ **Resolved:** Yes, include character_facts (user asks "tell me about yourself")

2. ~~**Should storylines be included?**~~
   - ✅ **Resolved:** Yes, include active storylines with default confidence 0.6

3. ~~**Min relevance threshold?**~~
   - ✅ **Resolved:** 18 points (configurable via env)

4. ~~**Should we cache tokenized facts?**~~
   - ⏭️ **Deferred:** Optimize if p95 latency > 120ms after launch

---

## Phase 2b: Semantic Matching (Future — After Phase 2a Validates Pattern)

**Status:** Detailed implementation plan (not yet started)
**Prerequisites:** Phase 2a deployed, stable, and demonstrating value
**Timeline:** 2-3 weeks (infrastructure + implementation + A/B test)

---

### Problem Statement

Phase 2a (lexical matching) works well for direct keyword matches but misses semantically-related facts:

**Example failures that semantic matching solves:**

1. **Synonym mismatch:**
   ```
   User: "I need to unwind after this crazy week"
   Relevant fact: hobby_relaxation: "playing guitar"

   Lexical: No overlap ("unwind" ≠ "guitar", "crazy" ≠ "relaxation")
   Semantic: High similarity (both about stress relief/relaxation)
   ```

2. **Conceptual relationship:**
   ```
   User: "I'm thinking about adopting a pet"
   Relevant fact: apartment_rules: "no pets allowed"

   Lexical: Weak overlap ("pet" appears once)
   Semantic: Strong relationship (adopting → pet ownership → apartment rules)
   ```

3. **Contextual inference:**
   ```
   User: "My caffeine addiction is getting expensive"
   Relevant fact: coffee_shop_favorite: "Ascension Coffee"

   Lexical: No overlap ("caffeine" ≠ "coffee shop")
   Semantic: Clear connection (caffeine → coffee → coffee shop)
   ```

**Hypothesis:** Semantic matching improves known-fact recall by 20-30% over lexical alone.

---

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    WRITE PATH (Background)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
                  Fact written to DB
                  (user_facts / character_facts / storylines)
                              │
                              v
                  Generate embedding via Gemini API
                  (text-embedding-004, 768 dims)
                              │
                              v
                  Store in fact_embeddings table
                  (with pgvector index)

┌─────────────────────────────────────────────────────────────┐
│                    READ PATH (Hot path)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
                  User sends message
                              │
                              v
                  Generate message embedding
                  (Gemini API, 768 dims)
                              │
                              v
                  Vector similarity search
                  (pgvector: <=> operator)
                              │
                              v
                  Retrieve top N candidates
                  (cosine similarity > threshold)
                              │
                              v
                  Hybrid scoring: semantic + lexical
                  (combine with Phase 2a scores)
                              │
                              v
                  Return ranked candidates
```

**Key differences from Phase 2a:**
- **Write path:** Background embedding generation on fact write
- **Read path:** Embed user message + vector search (not tokenization + scoring)
- **Hybrid mode:** Combine semantic similarity with lexical/recency/confidence boosts

---

### Database Schema

#### Table: `fact_embeddings`

```sql
-- supabase/migrations/20260220_fact_embeddings.sql

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Embeddings table
CREATE TABLE public.fact_embeddings (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),

  -- Source reference
  fact_table text NOT NULL,           -- "user_facts" | "character_facts" | "storylines"
  fact_id uuid NOT NULL,              -- FK to source table

  -- Cached text and embedding
  fact_text text NOT NULL,            -- Concatenated key + value for display
  embedding vector(768) NOT NULL,     -- Gemini text-embedding-004 (768 dims)

  -- Metadata
  embedding_model text NOT NULL DEFAULT 'text-embedding-004',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fact_embeddings_pkey PRIMARY KEY (id),
  CONSTRAINT fact_embeddings_fact_unique UNIQUE (fact_table, fact_id)
);

-- Vector similarity index (IVFFlat for fast approximate search)
CREATE INDEX idx_fact_embeddings_vector
  ON public.fact_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);  -- Tune based on dataset size

-- Standard indexes
CREATE INDEX idx_fact_embeddings_fact_table
  ON public.fact_embeddings (fact_table);

CREATE INDEX idx_fact_embeddings_updated_at
  ON public.fact_embeddings (updated_at DESC);

-- Auto-update trigger
CREATE TRIGGER update_fact_embeddings_updated_at
  BEFORE UPDATE ON public.fact_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row-level security (if needed)
ALTER TABLE public.fact_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users"
  ON public.fact_embeddings
  FOR ALL
  TO authenticated
  USING (true);
```

**Index tuning:**
- `lists = 100` is a good starting point for ~500-1000 embeddings
- Adjust based on dataset size:
  - < 1000 rows: `lists = 50`
  - 1000-10000 rows: `lists = 100`
  - > 10000 rows: `lists = sqrt(num_rows)`

---

### Embedding Generation Pipeline

#### When embeddings are generated:

1. **On fact creation** (new user_facts, character_facts, storylines)
2. **On fact update** (if fact_key or fact_value changes)
3. **On backfill** (one-time migration for existing facts)

#### Service: `embeddingService.ts`

```typescript
// src/services/embeddingService.ts

import { GoogleGenAI } from "@google/genai";
import { supabase } from "./supabaseClient";

const LOG_PREFIX = "[Embeddings]";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMS = 768;

let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error("VITE_GEMINI_API_KEY is not set");
    }
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return aiClient;
}

// ============================================================================
// Types
// ============================================================================

export type FactTable = "user_facts" | "character_facts" | "storylines";

export interface EmbeddingRow {
  id: string;
  fact_table: FactTable;
  fact_id: string;
  fact_text: string;
  embedding: number[]; // 768-dim vector
  embedding_model: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embedding for a single text via Gemini API.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const ai = getAIClient();
    const response = await ai.embeddings.create({
      model: EMBEDDING_MODEL,
      content: text,
    });

    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error("No embeddings returned from Gemini API");
    }

    const embedding = response.embeddings[0].values;

    if (embedding.length !== EMBEDDING_DIMS) {
      throw new Error(`Expected ${EMBEDDING_DIMS} dims, got ${embedding.length}`);
    }

    return embedding;
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to generate embedding`, { err });
    throw err;
  }
}

/**
 * Generate embeddings for multiple texts in batch (if API supports it).
 * Falls back to sequential generation if batch not supported.
 */
export async function generateEmbeddingsBatch(
  texts: string[]
): Promise<number[][]> {
  // TODO: Check if Gemini API supports batch embedding
  // For now, generate sequentially
  const embeddings: number[][] = [];
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }
  return embeddings;
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Store or update embedding for a fact.
 */
export async function storeFactEmbedding(
  factTable: FactTable,
  factId: string,
  factText: string,
  embedding: number[]
): Promise<boolean> {
  try {
    const { error } = await supabase.from("fact_embeddings").upsert(
      {
        fact_table: factTable,
        fact_id: factId,
        fact_text: factText,
        embedding: embedding,
        embedding_model: EMBEDDING_MODEL,
      },
      { onConflict: "fact_table,fact_id" }
    );

    if (error) {
      console.error(`${LOG_PREFIX} Failed to store embedding`, { error });
      return false;
    }

    console.log(`${LOG_PREFIX} Stored embedding`, { factTable, factId });
    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} storeFactEmbedding failed`, { err });
    return false;
  }
}

/**
 * Delete embedding when fact is deleted.
 */
export async function deleteFactEmbedding(
  factTable: FactTable,
  factId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("fact_embeddings")
      .delete()
      .eq("fact_table", factTable)
      .eq("fact_id", factId);

    if (error) {
      console.error(`${LOG_PREFIX} Failed to delete embedding`, { error });
      return false;
    }

    console.log(`${LOG_PREFIX} Deleted embedding`, { factTable, factId });
    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} deleteFactEmbedding failed`, { err });
    return false;
  }
}

// ============================================================================
// Fact Write Hooks
// ============================================================================

/**
 * Generate and store embedding when a fact is created/updated.
 * Called from memoryService, characterFactsService, storylineService.
 */
export async function generateAndStoreFactEmbedding(
  factTable: FactTable,
  factId: string,
  factKey: string,
  factValue: string
): Promise<void> {
  try {
    // Build fact text (same format as Phase 2a candidate text)
    const factText = `${factKey}: ${factValue}`;

    // Generate embedding
    const embedding = await generateEmbedding(factText);

    // Store in DB
    await storeFactEmbedding(factTable, factId, factText, embedding);
  } catch (err) {
    console.error(`${LOG_PREFIX} generateAndStoreFactEmbedding failed`, { err });
    // Don't throw - embedding generation failure should not block fact writes
  }
}

/**
 * Backfill embeddings for existing facts (one-time migration).
 */
export async function backfillEmbeddings(): Promise<{
  success: number;
  failed: number;
}> {
  console.log(`${LOG_PREFIX} Starting backfill...`);

  let success = 0;
  let failed = 0;

  try {
    // Fetch all facts that don't have embeddings yet
    const { data: userFacts } = await supabase
      .from("user_facts")
      .select("id, fact_key, fact_value");

    const { data: characterFacts } = await supabase
      .from("character_facts")
      .select("id, fact_key, fact_value");

    const { data: storylines } = await supabase
      .from("storylines")
      .select("id, title, initial_announcement, stakes, current_emotional_tone");

    // Generate embeddings for each fact
    if (userFacts) {
      for (const fact of userFacts) {
        try {
          await generateAndStoreFactEmbedding(
            "user_facts",
            fact.id,
            fact.fact_key,
            fact.fact_value
          );
          success++;
        } catch {
          failed++;
        }
      }
    }

    if (characterFacts) {
      for (const fact of characterFacts) {
        try {
          await generateAndStoreFactEmbedding(
            "character_facts",
            fact.id,
            fact.fact_key,
            fact.fact_value
          );
          success++;
        } catch {
          failed++;
        }
      }
    }

    if (storylines) {
      for (const storyline of storylines) {
        try {
          const value = [
            storyline.initial_announcement,
            storyline.stakes,
            storyline.current_emotional_tone,
          ]
            .filter(Boolean)
            .join(" ");

          await generateAndStoreFactEmbedding(
            "storylines",
            storyline.id,
            storyline.title,
            value
          );
          success++;
        } catch {
          failed++;
        }
      }
    }

    console.log(`${LOG_PREFIX} Backfill complete`, { success, failed });
    return { success, failed };
  } catch (err) {
    console.error(`${LOG_PREFIX} Backfill failed`, { err });
    return { success, failed };
  }
}
```

---

### Vector Search Implementation

#### RPC Function: `match_facts`

```sql
-- supabase/migrations/20260220_match_facts_rpc.sql

CREATE OR REPLACE FUNCTION match_facts(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 7,
  filter_fact_table text DEFAULT NULL
)
RETURNS TABLE (
  fact_table text,
  fact_id uuid,
  fact_text text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    fe.fact_table,
    fe.fact_id,
    fe.fact_text,
    1 - (fe.embedding <=> query_embedding) AS similarity
  FROM fact_embeddings fe
  WHERE
    (filter_fact_table IS NULL OR fe.fact_table = filter_fact_table)
    AND (1 - (fe.embedding <=> query_embedding)) > match_threshold
  ORDER BY fe.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION match_facts TO authenticated;
```

**Operator notes:**
- `<=>` is the cosine distance operator (pgvector)
- `1 - distance` converts to cosine similarity (0-1 scale)
- `ORDER BY distance ASC` = "most similar first"

---

### Service Integration: Phase 2b Functions

#### Update `activeRecallService.ts`

```typescript
// Add to activeRecallService.ts

import { generateEmbedding } from "./embeddingService";

/**
 * Get ranked recall candidates via semantic search (Phase 2b).
 * Combines vector similarity with lexical/recency/confidence boosts.
 */
export async function getRankedRecallCandidatesSemantic(
  userMessage: string,
  maxItems: number = 6
): Promise<RankedRecallCandidate[]> {
  const startTime = Date.now();
  const config = getConfig();

  try {
    // 1. Generate embedding for user message
    const messageEmbedding = await generateEmbedding(userMessage);

    // 2. Vector similarity search via RPC
    const { data: matches, error } = await supabase.rpc("match_facts", {
      query_embedding: messageEmbedding,
      match_threshold: 0.6, // Configurable via env
      match_count: maxItems * 2, // Fetch more for hybrid scoring
    });

    if (error) {
      console.error(`${LOG_PREFIX} Vector search failed`, { error });
      return [];
    }

    if (!matches || matches.length === 0) {
      return [];
    }

    // 3. Fetch full fact data for matched IDs
    const candidates = await fetchFactsByIds(matches);

    // 4. Tokenize message (for lexical/key bonus)
    const messageTokens = tokenize(userMessage);

    // 5. Hybrid scoring: semantic + lexical + recency + confidence + pinned
    const scored: RankedRecallCandidate[] = candidates.map((cand) => {
      const match = matches.find(
        (m) => m.fact_table === cand.sourceType && m.fact_id === cand.id
      );
      const semanticSimilarity = match?.similarity || 0;

      // Semantic score (0-60 points, scaled from 0-1 similarity)
      const semantic = semanticSimilarity * 60;

      // Lexical/key bonus (if there's also keyword overlap, boost further)
      const candTokens = tokenize(getCandidateText(cand));
      const keyTokens = tokenize(cand.key);
      const lexical = computeLexicalScore(messageTokens, candTokens);
      const keyBonus = computeKeyBonus(messageTokens, keyTokens);

      // Boosts (only if semantic OR lexical relevance)
      const hasRelevance = semantic > 0 || lexical > 0 || keyBonus > 0;
      const recency = hasRelevance ? computeRecencyBoost(cand.updatedAt) : 0;
      const confidence = hasRelevance ? computeConfidenceBoost(cand.confidence) : 0;
      const pinned = hasRelevance ? computePinnedBoost(cand.pinned) : 0;

      const score = semantic + lexical + keyBonus + recency + confidence + pinned;
      const reasons = buildReasonList({
        semantic,
        lexical,
        keyBonus,
        recency,
        confidence,
        pinned,
      });

      return { ...cand, score, reasons };
    });

    // 6. Filter by min threshold
    const aboveThreshold = scored.filter((c) => c.score >= config.minScore);

    // 7. Deduplicate
    const deduped = deduplicateCandidates(aboveThreshold);

    // 8. Sort and select top N
    deduped.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const selected = deduped.slice(0, maxItems);

    const durationMs = Date.now() - startTime;
    console.log(`${LOG_PREFIX} Retrieved candidates (semantic)`, {
      messageTokenCount: messageTokens.length,
      candidateCount: candidates.length,
      selectedCount: selected.length,
      durationMs,
      featureEnabled: config.enabled,
      timedOut: false,
    });

    return selected;
  } catch (err) {
    console.error(`${LOG_PREFIX} getRankedRecallCandidatesSemantic failed`, { err });
    return [];
  }
}

/**
 * Fetch full fact data for matched IDs from vector search.
 */
async function fetchFactsByIds(
  matches: Array<{ fact_table: string; fact_id: string }>
): Promise<RecallCandidate[]> {
  // Group by fact_table for efficient batch fetch
  const byTable: Record<string, string[]> = {};
  for (const match of matches) {
    if (!byTable[match.fact_table]) byTable[match.fact_table] = [];
    byTable[match.fact_table].push(match.fact_id);
  }

  const candidates: RecallCandidate[] = [];

  // Fetch user_facts
  if (byTable["user_facts"]) {
    const { data } = await supabase
      .from("user_facts")
      .select("*")
      .in("id", byTable["user_facts"]);
    if (data) candidates.push(...mapUserFacts(data));
  }

  // Fetch character_facts
  if (byTable["character_facts"]) {
    const { data } = await supabase
      .from("character_facts")
      .select("*")
      .in("id", byTable["character_facts"]);
    if (data) candidates.push(...mapCharacterFacts(data));
  }

  // Fetch storylines
  if (byTable["storylines"]) {
    const { data } = await supabase
      .from("storylines")
      .select("*")
      .in("id", byTable["storylines"]);
    if (data) candidates.push(...mapStorylines(data));
  }

  return candidates;
}
```

---

### Hybrid Scoring Model (Phase 2b)

**Total score = semantic + lexical + keyBonus + recency + confidence + pinned**

| Component | Range | Description |
|-----------|-------|-------------|
| **Semantic** | 0-60 | Vector cosine similarity (0-1 scaled to 60) |
| **Lexical** | 0-60 | Token overlap (Phase 2a, but lower weight) |
| **Key bonus** | 0-15 | Exact/partial key match |
| **Recency** | 0-15 | How recently updated |
| **Confidence** | 0-10 | Fact confidence level |
| **Pinned** | 0-5 | Pinned user facts |
| **MAX** | **165** | Total possible (higher than Phase 2a due to dual signals) |

**Rationale:**
- Semantic (0-60) and Lexical (0-60) are equal weight → both signals matter
- If a fact has BOTH semantic similarity AND keyword overlap → it ranks very high
- Example: "unwind" → "playing guitar" gets semantic boost, but "brother" → "brother_name" gets both

**Min threshold adjustment:**
- Phase 2a: 18 points (lexical-only)
- Phase 2b: 30 points (semantic baseline higher, prevents weak matches)

---

### Cost Analysis

#### Gemini Embedding API Pricing

**As of 2026 (estimate):**
- Free tier: 1500 requests/day
- Paid tier: $0.001 per 1K tokens

**Phase 2b costs:**

**Write path (embedding generation):**
- Per fact embedding: ~10-30 tokens (fact_key + fact_value)
- Cost per fact: ~$0.00001 (negligible)
- Initial backfill (200 facts): ~$0.002
- Ongoing (1-5 new facts/day): ~$0.0001/day = $0.03/month

**Read path (message embedding):**
- Per user message: ~10-50 tokens
- Cost per message: ~$0.00005
- At 100 messages/day: $0.005/day = $0.15/month

**Total estimated cost:**
- Initial backfill: $0.01 (one-time)
- Monthly ongoing: $0.20/month

**Verdict:** Cost is negligible (<$3/year for embedding generation).

---

### A/B Testing Framework

#### Metrics to track:

**Primary:**
1. **Known-fact miss rate:** % of turns where relevant fact exists but wasn't recalled
2. **Retrieval quality:** Average relevance score of recalled facts (user feedback)

**Secondary:**
3. **Retrieval latency:** p50/p95/p99 for getRankedRecallCandidates
4. **Recall usage rate:** % of turns with non-empty recall section
5. **User satisfaction:** Qualitative feedback ("Does Kayley remember better?")

#### A/B test design:

```typescript
// Feature flag for A/B test
const USE_SEMANTIC_RECALL = import.meta.env.VITE_USE_SEMANTIC_RECALL === "true";

// In buildActiveRecallPromptSection():
const candidates = USE_SEMANTIC_RECALL
  ? await getRankedRecallCandidatesSemantic(currentUserMessage, config.limit)
  : await getRankedRecallCandidates(currentUserMessage, config.limit);
```

**Test groups:**
- **Control (A):** Lexical matching (Phase 2a)
- **Treatment (B):** Semantic matching (Phase 2b)

**Duration:** 2 weeks minimum

**Decision criteria:**
- If semantic improves miss rate by >15% AND p95 latency < 150ms → **promote to default**
- If semantic improves miss rate by 5-15% → **offer as opt-in**
- If semantic improves miss rate by <5% OR p95 latency > 200ms → **keep lexical as default**

---

### Migration Strategy

#### Phase 2b rollout steps:

1. **Infrastructure setup** (1-2 days)
   - Enable pgvector extension in Supabase
   - Run `20260220_fact_embeddings.sql` migration
   - Run `20260220_match_facts_rpc.sql` migration

2. **Backfill existing facts** (1 day)
   - Run `backfillEmbeddings()` to generate embeddings for all existing facts
   - Monitor progress and handle failures
   - Verify embeddings in `fact_embeddings` table

3. **Integrate write hooks** (1 day)
   - Update `memoryService.ts`: call `generateAndStoreFactEmbedding()` after `storeUserFact()`
   - Update `characterFactsService.ts`: call after `storeCharacterFact()`
   - Update `storylineService.ts`: call after storyline creation/update

4. **Implement semantic retrieval** (2-3 days)
   - Add `getRankedRecallCandidatesSemantic()` to `activeRecallService.ts`
   - Add `fetchFactsByIds()` helper
   - Update `buildActiveRecallPromptSection()` to support semantic mode

5. **A/B test setup** (1 day)
   - Add `VITE_USE_SEMANTIC_RECALL` feature flag
   - Instrument metrics logging
   - Deploy with flag OFF

6. **Staged rollout** (2 weeks)
   - Week 1: Enable for 10% of messages (or dev/staging only)
   - Week 2: Expand to 50% if metrics look good
   - Monitor latency, miss rate, user feedback

7. **Decision and cleanup** (1 day)
   - Analyze A/B test results
   - Promote to default OR keep lexical OR offer opt-in
   - Document findings

---

### Implementation Checklist

**Prerequisites:**
- [x] Phase 2a deployed and stable
- [ ] Supabase has pgvector extension available
- [ ] Gemini embedding API quota sufficient

**Infrastructure (Week 1):**
- [ ] Enable pgvector extension in Supabase
- [ ] Create `fact_embeddings` table migration
- [ ] Create `match_facts()` RPC migration
- [ ] Run migrations on dev/staging
- [ ] Verify vector index created

**Embedding service (Week 1):**
- [ ] Create `embeddingService.ts`
- [ ] Implement `generateEmbedding()`
- [ ] Implement `storeFactEmbedding()`
- [ ] Implement `deleteFactEmbedding()`
- [ ] Implement `backfillEmbeddings()`
- [ ] Test embedding generation + storage

**Write hooks (Week 1):**
- [ ] Update `memoryService.ts` (storeUserFact)
- [ ] Update `characterFactsService.ts` (storeCharacterFact)
- [ ] Update `storylineService.ts` (create/update)
- [ ] Test: Create fact → verify embedding stored

**Backfill (Week 1-2):**
- [ ] Run `backfillEmbeddings()` on dev
- [ ] Verify all existing facts have embeddings
- [ ] Run on staging
- [ ] Run on production (off-peak hours)

**Semantic retrieval (Week 2):**
- [ ] Implement `getRankedRecallCandidatesSemantic()`
- [ ] Implement `fetchFactsByIds()`
- [ ] Test vector search via Supabase RPC
- [ ] Test hybrid scoring (semantic + lexical)
- [ ] Add feature flag check

**A/B test (Week 2-3):**
- [ ] Add `VITE_USE_SEMANTIC_RECALL` flag
- [ ] Deploy with flag OFF
- [ ] Enable for dev/staging
- [ ] Manual smoke tests
- [ ] Enable for 10% production traffic
- [ ] Monitor metrics for 1 week

**Decision (Week 4):**
- [ ] Analyze A/B results
- [ ] Decide: promote / opt-in / keep lexical
- [ ] Update documentation
- [ ] Clean up unused code paths

---

### Critical Files (Phase 2b)

**New:**
- `src/services/embeddingService.ts` (~300 lines)
  - Embedding generation via Gemini API
  - Database operations for fact_embeddings
  - Backfill utility
- `supabase/migrations/20260220_fact_embeddings.sql` (~50 lines)
- `supabase/migrations/20260220_match_facts_rpc.sql` (~30 lines)

**Modified:**
- `src/services/activeRecallService.ts` (~200 lines added)
  - `getRankedRecallCandidatesSemantic()`
  - `fetchFactsByIds()`
  - Hybrid scoring logic
- `src/services/memoryService.ts` (~10 lines)
  - Write hook: `generateAndStoreFactEmbedding()`
- `src/services/characterFactsService.ts` (~10 lines)
  - Write hook: `generateAndStoreFactEmbedding()`
- `src/services/storylineService.ts` (~10 lines)
  - Write hook: `generateAndStoreFactEmbedding()`

---

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Embedding generation fails | Log error, skip embedding storage, don't block fact write |
| pgvector extension not available | Fall back to Phase 2a (lexical only) |
| Vector search times out | Return empty results, fall back to lexical |
| Message embedding fails | Fall back to lexical matching |
| Semantic similarity < threshold | Return empty results (no weak matches) |
| Backfill interrupted | Resume from last processed fact (idempotent) |
| Schema version mismatch | Regenerate embeddings for affected facts |

---

### Open Questions

1. **Should we support hybrid mode permanently?**
   - Option A: Always use semantic (Phase 2b replaces Phase 2a)
   - Option B: Hybrid (use both semantic + lexical, add scores)
   - Option C: Fallback (try semantic first, fall back to lexical if fails)

   **Recommendation:** Option B (hybrid) — both signals are valuable

2. **Should we cache message embeddings?**
   - Pros: Saves API calls if user repeats similar messages
   - Cons: Adds cache complexity, minor benefit

   **Recommendation:** Skip for Phase 2b MVP, add if latency becomes issue

3. **Should embeddings auto-refresh when facts are updated?**
   - Pros: Always fresh
   - Cons: API cost for every fact edit

   **Recommendation:** Yes, regenerate on update (cost is negligible)

---

### Summary

**Phase 2b (Semantic Matching):**
- **What:** Embedding-based vector search with hybrid scoring
- **When:** After Phase 2a validates pattern (1-2 months)
- **Timeline:** 2-3 weeks (infrastructure + implementation + A/B test)
- **Latency:** +60-120ms (p50), includes embedding generation + vector search
- **Cost:** ~$0.20/month (embedding API calls)
- **Infrastructure:** pgvector extension, fact_embeddings table, match_facts RPC
- **Risk:** Medium (new dependencies, API costs, complexity)
- **Expected impact:** 10-20% improvement in recall over lexical alone

**Key benefits over Phase 2a:**
- Catches semantic relationships (synonyms, concepts, context)
- Better handling of paraphrased queries
- More robust to vocabulary mismatch

**When to use Phase 2b:**
- User messages often use different words than stored facts
- Conceptual relationships matter (e.g., "caffeine" → coffee shop)
- Phase 2a showing good results but still missing ~15-20% of relevant facts

---

## Critical Files (Phase 2a)

**New:**
- `src/services/activeRecallService.ts` (~300 lines)
  - Candidate mapping
  - 5-component scoring
  - Deduplication
  - Prompt builder

**Modified:**
- `src/services/system_prompts/builders/systemPromptBuilder.ts` (~10 lines)
  - Add `currentUserMessage` parameter
  - Inject active recall section
- `src/services/geminiChatService.ts` (~10 lines)
  - Pass user message to prompt builder

**Reference (no changes):**
- `src/services/memoryService.ts` (getUserFacts pattern)
- `src/services/characterFactsService.ts` (getCharacterFacts pattern)
- `src/services/storylineService.ts` (getActiveStorylines pattern)

---

## Summary

**Phase 2a (Lexical Matching):**
- **What:** Per-turn keyword-based fact retrieval (user_facts + character_facts + storylines)
- **When:** After Phase 1b is live and stable
- **Latency:** +40-80ms (p50), +80-120ms (p95)
- **Token cost:** +100-150 tokens per turn
- **Risk:** Low (feature flag, fail-open, no DB changes)
- **Expected impact:** Reduces known-fact miss rate by 30-40%

**Phase 2b (Semantic Matching):**
- **What:** Embedding-based semantic search
- **When:** After Phase 2a validates the pattern (1-2 months)
- **Latency:** +60-120ms (p50)
- **Infrastructure:** Requires pgvector, embedding pipeline, API costs
- **Risk:** Medium (new dependencies, higher complexity)
- **Expected impact:** Additional 10-20% improvement in recall over lexical

**Overall goal:** Eliminate "Wait, I told you that already" moments by surfacing relevant stored knowledge on every turn.
