# Phase 1b Plan Comparison: Your Plan vs My Plan

**Date:** 2026-02-12

---

## Executive Summary

Both plans solve the same problem (long-thread continuity) with similar architecture, but differ in:
1. **Schema design** (flat columns vs JSONB)
2. **Generation method** (deterministic-first vs LLM-always)
3. **Update triggers** (90s time guard vs 2hr TTL)
4. **Size enforcement** (explicit caps vs soft limits)
5. **Feature flag default** (false vs true)

**Key question for you:** Do you prefer the **deterministic-first approach** (your plan) or **LLM-always approach** (my plan) for anchor generation?

---

## Detailed Comparison

### 1. Schema Design

| Aspect | Your Plan | My Plan | Winner |
|--------|-----------|---------|--------|
| **Storage** | Flat columns (anchor_summary, unresolved_asks, active_emotional_context, etc.) | Single JSONB (anchor_document) | **Your plan** (explicit schema, easier to query) |
| **Version control** | schema_version integer | schema_version integer | Tie |
| **Turn tracking** | last_turn_index integer | turn_count integer | Tie (same concept) |
| **Topic tracking** | last_topic_hash text | topics_snapshot text[] | **My plan** (stores actual topics, not hash) |
| **Staleness** | updated_at (90s guard) | expires_at timestamptz (2hr TTL) | **Your plan** (more granular) |
| **Last message** | last_user_message text | Not stored | **Your plan** (enables in-DB topic shift calc) |

**Recommendation:** Use **your schema** (flat columns). More explicit, easier to query, better for admin/debugging.

---

### 2. Update Triggers

| Trigger | Your Plan | My Plan | Analysis |
|---------|-----------|---------|----------|
| **Bootstrap** | No existing anchor → refresh | No anchor + turn >= 3 → refresh | **Your plan** (refresh immediately, not after 3 turns) |
| **Turn delta** | turnIndex - last_turn_index >= 3 | Turn delta >= 3 (soft) or >= 5 (hard) | **My plan** (explicit soft/hard distinction) |
| **Topic shift** | Overlap < 0.2, marker boost words | Overlap < 0.3, ignore if <5 tokens | **Your plan** (more sensitive, smarter with marker words) |
| **Time guard** | >= 90s since updated_at + >= 1 new turn | Stale if now - updated_at > 2h | **Your plan** (90s is more responsive) |
| **Out-of-order** | Skip if turnIndex <= last_turn_index | Not explicitly handled | **Your plan** (monotonic writes enforced) |

**Recommendation:** Use **your trigger logic** with these tweaks:
- Keep 90s time guard (not 2hr)
- Keep overlap < 0.2 threshold (more sensitive)
- Add marker boost words ("anyway", "switching gears", "different topic")
- Add explicit out-of-order write rejection

---

### 3. Generation Method

| Approach | Your Plan | My Plan | Trade-offs |
|----------|-----------|---------|------------|
| **Primary** | Deterministic parser (extract asks/commitments/tone) | LLM call (Gemini with JSON schema) | Your plan: faster, cheaper, deterministic<br>My plan: higher quality, context-aware |
| **Fallback** | Optional LLM refinement (timeout 1200ms) | N/A (always LLM) | Your plan: best-effort upgrade |
| **Latency** | ~10-50ms (deterministic) + optional 1200ms (LLM) | ~500-1000ms (LLM always) | **Your plan wins** |
| **Quality** | Good for structured extraction, may miss nuance | High quality, context-aware summarization | **My plan wins** |
| **Cost** | Low (no API calls unless refinement) | Medium (1 Gemini call per anchor update) | **Your plan wins** |

**Key question:** What's the quality floor of deterministic extraction?

**Example:**
```
User: "Can you check the weather for Saturday?"
Model: "Sure! I'll look that up for you."

Deterministic extraction:
- unresolved_asks: ["check the weather for Saturday"]  ← Regex match on "can you...?"
- pending_commitments: ["look that up"]                ← Regex match on "I'll..."

LLM extraction:
- unresolved_asks: ["weather forecast for Saturday"]   ← Normalized phrasing
- pending_commitments: ["check weather for Saturday"]  ← Cleaner commitment
```

**Recommendation:** Start with **your deterministic approach**. Add LLM refinement only if quality is insufficient. This is the right engineering tradeoff (fast, cheap, deterministic >> perfect).

---

### 4. Size Caps & Enforcement

| Aspect | Your Plan | My Plan |
|--------|-----------|---------|
| **Caps defined** | Explicit per-field character limits | Soft "~150-200 tokens" |
| **anchor_summary** | <= 450 chars | No explicit cap |
| **unresolved_asks** | <= 4 items, each <= 120 chars | No explicit cap |
| **pending_commitments** | <= 4 items, each <= 120 chars | No explicit cap |
| **emotional_context** | <= 180 chars | No explicit cap |
| **Total section** | <= 1200 chars | ~150-200 tokens (~600-800 chars) |
| **Overflow behavior** | Truncate and degrade to summary-first | Not specified |

**Recommendation:** Use **your explicit caps**. Hard limits prevent prompt bloat and are easier to enforce in code.

---

### 5. Turn Index Tracking

| Aspect | Your Plan | My Plan |
|--------|-----------|---------|
| **Source** | chatHistory.length (in-memory) | Query conversation_history table |
| **Latency** | ~0ms (instant) | ~10-20ms (DB query) |
| **Accuracy** | Requires chatHistory state in orchestrator | Always accurate (source of truth) |
| **Edge case** | If chatHistory not passed, can't compute | Always computable |

**Recommendation:** Use **your approach** (chatHistory.length). Faster and simpler. Pass turnIndex explicitly to `refreshConversationAnchor()`.

---

### 6. Topic Shift Detection

| Aspect | Your Plan | My Plan |
|--------|-----------|---------|
| **Method** | Overlap ratio < 0.2 between prev/current user message | Jaccard overlap < 0.3 (topics_snapshot) |
| **Threshold** | 0.2 (20% overlap) | 0.3 (30% overlap) |
| **Marker words** | Boost on "anyway", "switching gears", "different topic" | Not included |
| **Input** | Compare last_user_message (stored in DB) vs current | Compare topics_snapshot vs current topics |
| **Min length check** | Both messages pass min token threshold | Ignore if <5 meaningful tokens |

**Key difference:** Your plan compares **user messages directly**, mine compares **extracted topics**.

**Example:**
```
Turn 5: "I'm really stressed about work"
Turn 6: "Anyway, let's talk about coffee"

Your method:
- Overlap("stressed about work", "talk about coffee") = 0% → SHIFT DETECTED
- Marker word "anyway" boosts signal → SHIFT CONFIRMED

My method:
- Previous topics: ["work", "stress"]
- Current topics: ["coffee"]
- Jaccard overlap = 0% → SHIFT DETECTED
```

**Recommendation:** Use **your method** (direct message comparison + marker words). Simpler, faster, more responsive. No dependency on topic extraction service.

---

### 7. Feature Flag & Rollout

| Aspect | Your Plan | My Plan |
|--------|-----------|---------|
| **Flag name** | VITE_USE_CONVERSATION_ANCHOR | VITE_USE_CONVERSATION_ANCHOR (same) |
| **Default** | false (safer rollout) | true (user confirmed in discussion) |
| **Rollout strategy** | Deploy migration → ship with flag=false → enable in staging → production | Not specified |
| **Rollback** | Flip flag to false, keep table | Flip flag to false, keep table (same) |

**Recommendation:** Use **your rollout strategy** (default false, explicit staging validation). Safer for production.

---

### 8. Missing interactionId Handling

| Aspect | Your Plan | My Plan |
|--------|-----------|---------|
| **Read behavior** | Return empty section | Return empty section (same) |
| **Write behavior** | Skip update, debug-level log | Generate random UUID as fallback |
| **Philosophy** | Fail open, don't create invalid data | Attempt to continue with synthetic ID |

**Recommendation:** Use **your approach** (skip update). Random UUID creates orphaned anchor rows with no conversation history. Better to skip.

---

### 9. Prompt Integration

| Aspect | Your Plan | My Plan |
|--------|-----------|---------|
| **Injection order** | Anchor → Synthesis → Topic suppression | Same |
| **Conflict rule** | Explicit: "If anchor conflicts with current user message, trust current user message" | Not included |
| **Signature change** | Pass interactionId to buildSystemPromptForNonGreeting() | Same |
| **Empty handling** | Return "" on any error | Return "" on stale/missing (same) |

**Recommendation:** Add **your conflict rule** to prompt. Makes LLM behavior more predictable when anchor is stale.

---

### 10. Orchestrator Integration

| Aspect | Your Plan | My Plan |
|--------|-----------|---------|
| **Hook location** | messageOrchestrator.ts post-processing | Same |
| **Fire-and-forget** | Yes, wrapped in .catch() | Yes, Promise.all() with .catch() |
| **Turn index source** | chatHistory.length | Query DB |
| **Recent turns window** | Last 6-8 turns | Last 10 turns (5 user + 5 model) |

**Recommendation:** Use **your approach** (chatHistory.length for turnIndex, 6-8 turn window is sufficient).

---

## Key Architectural Differences Summary

| Decision | Your Plan | My Plan | Recommendation |
|----------|-----------|---------|----------------|
| **Schema** | Flat columns | JSONB document | **Your plan** (explicit schema) |
| **Generation** | Deterministic + optional LLM | LLM always | **Your plan** (fast, cheap) |
| **Time guard** | 90s + 1 turn | 2 hour TTL | **Your plan** (responsive) |
| **Topic shift** | Message overlap + markers | Topic overlap | **Your plan** (simpler, faster) |
| **Size caps** | Explicit char limits | Soft token estimate | **Your plan** (enforceable) |
| **Turn tracking** | chatHistory.length | DB query | **Your plan** (faster) |
| **Feature flag default** | false | true | **Your plan** (safer) |
| **Conflict rule** | Explicit in prompt | Not included | **Your plan** (clearer) |

---

## Critical Questions for You

### 1. Deterministic vs LLM Generation

**Your plan:** Deterministic extraction (regex, heuristics) with optional LLM refinement

**Example deterministic patterns:**
```typescript
// Extract unresolved asks
function extractUnresolvedAsks(recentTurns): string[] {
  const userQuestions = recentTurns
    .filter(t => t.role === 'user')
    .map(t => t.text)
    .flatMap(extractQuestions); // Regex: /can you.*\?|could you.*\?|would you.*\?/i

  // Filter out questions that were answered
  return userQuestions.filter(q => !wasAnsweredInSubsequentTurns(q, recentTurns));
}

// Extract commitments
function extractCommitments(recentTurns): string[] {
  const modelPromises = recentTurns
    .filter(t => t.role === 'model')
    .map(t => t.text)
    .flatMap(extractPromises); // Regex: /I'll|I will|let me|I can/i

  return modelPromises;
}

// Emotional context
function extractEmotionalContext(recentTurns): string {
  const userTone = detectTone(last3UserMessages); // Heuristic: sentiment words
  return `User seems ${userTone}`;
}
```

**Question:** Do you believe deterministic extraction quality is sufficient? Or should we always use LLM for higher quality?

**My take:** Your approach is right. Start deterministic. If quality is poor in testing, add LLM refinement with timeout.

---

### 2. Time Guard: 90s vs 2 hours

**Your plan:** 90s time guard (refresh if >= 90s since updated_at AND >= 1 new turn)

**My plan:** 2 hour TTL (expires_at field, refresh on stale read)

**Example:**
```
Turn 5 at 10:00:00 → Anchor generated
Turn 6 at 10:00:30 → No refresh (< 90s, < 3 turns)
Turn 7 at 10:01:45 → REFRESH (>= 90s + >= 1 turn since last update)

vs

Turn 5 at 10:00:00 → Anchor generated (expires_at = 12:00:00)
Turn 6 at 10:00:30 → No refresh (not expired)
Turn 7 at 10:01:45 → No refresh (not expired)
Turn 20 at 12:05:00 → REFRESH (expired)
```

**Question:** Which time-based trigger makes more sense for "working memory"?

**My take:** Your 90s guard is better. It's more responsive to pauses in conversation. 2 hours is too long for "turn-local" memory.

---

### 3. Topic Shift Threshold: 0.2 vs 0.3

**Your plan:** Overlap < 0.2 (20%) triggers shift

**My plan:** Overlap < 0.3 (30%) triggers shift

**Question:** Which threshold better balances sensitivity vs noise?

**My take:** 0.2 is more sensitive (good for catching topic pivots). But we need to test with marker word boosts. If marker words are present, maybe even 0.4 overlap should trigger.

---

### 4. Bootstrap Timing: Immediate vs Turn 3

**Your plan:** Refresh immediately if no anchor exists

**My plan:** Wait until turn >= 3 before first refresh

**Question:** Should the first anchor be generated after turn 1 or turn 3?

**My take:** Your approach (immediate) is better. We want anchor from the start, not after 3 turns. The anchor captures unresolved asks from turn 1-2.

---

### 5. Schema: Flat Columns vs JSONB

**Your plan:** Flat columns (easier to query, explicit schema)

**My plan:** JSONB document (flexible schema, harder to query)

**Question:** Which schema makes more sense for Phase 1b?

**My take:** Your flat columns are better for Phase 1b. JSONB makes sense when schema is evolving rapidly or deeply nested. This schema is stable and simple.

---

## Hybrid Recommendation: Best of Both Plans

### Schema (Use Your Plan)

```sql
create table public.conversation_anchor (
  id uuid not null default extensions.uuid_generate_v4(),
  interaction_id text not null unique,
  schema_version integer not null default 1,
  anchor_summary text not null default '',
  unresolved_asks jsonb not null default '[]'::jsonb,
  active_emotional_context text not null default '',
  pending_commitments jsonb not null default '[]'::jsonb,
  last_user_message text not null default '',
  last_turn_index integer not null default 0,
  last_topic_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_anchor_pkey primary key (id),
  constraint conversation_anchor_interaction_id_unique unique (interaction_id)
);
```

### Update Triggers (Use Your Plan + My Refinements)

```typescript
function shouldRefreshAnchor(params: {
  existing: ConversationAnchorRow | null;
  turnIndex: number;
  topicShift: boolean;
  nowIso: string;
}): boolean {
  const { existing, turnIndex, topicShift, nowIso } = params;

  // 1. No existing anchor -> refresh immediately
  if (!existing) return true;

  // 2. Out-of-order write -> skip
  if (turnIndex <= existing.last_turn_index) return false;

  // 3. Topic shift detected -> refresh
  if (topicShift) return true;

  // 4. Turn delta >= 5 (hard cap) -> force refresh
  const turnDelta = turnIndex - existing.last_turn_index;
  if (turnDelta >= 5) return true;

  // 5. Turn delta >= 3 (soft target) + time guard (90s) -> refresh
  if (turnDelta >= 3) {
    const timeSinceUpdate = Date.now() - new Date(existing.updated_at).getTime();
    if (timeSinceUpdate >= 90_000) return true;
  }

  return false;
}
```

### Topic Shift (Use Your Plan)

```typescript
function computeTopicShift(previousUserMessage: string, currentUserMessage: string): boolean {
  // 1. Normalize to tokens
  const prevTokens = normalizeToTokens(previousUserMessage);
  const currTokens = normalizeToTokens(currentUserMessage);

  // 2. Min length check
  if (prevTokens.length < 3 || currTokens.length < 3) return false;

  // 3. Compute overlap
  const prevSet = new Set(prevTokens);
  const currSet = new Set(currTokens);
  const intersection = [...prevSet].filter(t => currSet.has(t));
  const overlapRatio = intersection.length / Math.max(prevSet.size, currSet.size);

  // 4. Marker word boost
  const markerWords = ['anyway', 'switching gears', 'different topic', 'changing subject', 'moving on'];
  const hasMarker = markerWords.some(m => currentUserMessage.toLowerCase().includes(m));

  // 5. Shift if overlap < 0.2 OR has marker word
  return overlapRatio < 0.2 || hasMarker;
}
```

### Generation (Use Your Plan: Deterministic First)

```typescript
async function refreshConversationAnchor(input: RefreshAnchorInput): Promise<void> {
  // 1. Deterministic extraction
  const deterministicAnchor = {
    anchor_summary: generateSummary(input.recentTurns),
    unresolved_asks: extractUnresolvedAsks(input.recentTurns),
    active_emotional_context: extractEmotionalContext(input.recentTurns),
    pending_commitments: extractCommitments(input.recentTurns),
  };

  // 2. Optional LLM refinement (timeout 1200ms)
  try {
    const refined = await Promise.race([
      refineLLM(deterministicAnchor, input.recentTurns),
      timeout(1200),
    ]);
    await storeAnchor(input.interactionId, refined, input.turnIndex);
  } catch (err) {
    // Timeout or LLM failure -> use deterministic
    await storeAnchor(input.interactionId, deterministicAnchor, input.turnIndex);
  }
}
```

### Size Caps (Use Your Plan)

```typescript
const SIZE_CAPS = {
  anchor_summary: 450,
  unresolved_asks_count: 4,
  unresolved_asks_item: 120,
  pending_commitments_count: 4,
  pending_commitments_item: 120,
  emotional_context: 180,
  total_section: 1200,
};

function enforceSizeCaps(anchor: ConversationAnchorRow): ConversationAnchorRow {
  return {
    ...anchor,
    anchor_summary: truncate(anchor.anchor_summary, SIZE_CAPS.anchor_summary),
    unresolved_asks: anchor.unresolved_asks
      .slice(0, SIZE_CAPS.unresolved_asks_count)
      .map(a => truncate(a, SIZE_CAPS.unresolved_asks_item)),
    pending_commitments: anchor.pending_commitments
      .slice(0, SIZE_CAPS.pending_commitments_count)
      .map(c => truncate(c, SIZE_CAPS.pending_commitments_item)),
    active_emotional_context: truncate(anchor.active_emotional_context, SIZE_CAPS.emotional_context),
  };
}
```

---

## Final Recommendation

Use **your plan** as the foundation with these additions from my plan:
1. ✅ Your schema (flat columns)
2. ✅ Your generation method (deterministic + optional LLM)
3. ✅ Your time guard (90s, not 2hr)
4. ✅ Your topic shift detection (message overlap + marker words)
5. ✅ Your size caps (explicit character limits)
6. ✅ Your feature flag default (false, safer rollout)
7. ✅ Your conflict rule in prompt
8. ✅ Your missing interactionId handling (skip, don't create synthetic)
9. ➕ Add soft/hard turn distinction (3/5) from my plan
10. ➕ Add logging recommendations from my plan

**Your plan is more production-ready:** deterministic-first, explicit caps, safer defaults, better edge case handling.

**My plan is more LLM-heavy:** always calls Gemini, less explicit, optimistic defaults.

For Phase 1b, **your approach is the right tradeoff**.
