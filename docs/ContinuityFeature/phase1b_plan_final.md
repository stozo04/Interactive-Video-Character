# Phase 1b: Conversation Working Memory Anchor (FINAL PLAN)

**Status:** Ready for implementation
**Last updated:** 2026-02-12
**Based on:** User's plan + corrections to Claude's plan

---

## Critical Corrections Applied

1. ✅ **LLM-only generation** (no regex/deterministic extraction)
2. ✅ **Skip update when interactionId missing** (no crypto.randomUUID() fallback)
3. ✅ **Pass interactionId as argument** to systemPromptBuilder (not from aiResult scope)
4. ✅ **Feature flag required** (VITE_USE_CONVERSATION_ANCHOR, default false)
5. ✅ **Turn index from chatHistory.length** (primary), DB count only as fallback

---

## Problem Statement

Long conversations cause attention decay. Kayley asks about things already discussed ("how did the mom call go?" when discussed 10 turns ago).

**Example failure:**
```
Turn 1: "I had a tough call with my mom today"
Turn 2: "Want to talk about it?"
Turn 3-10: [work, coffee, weekend plans]
Turn 11: "So back to my mom..."
Turn 12: "How did the call go?" ← CONTINUITY FAILURE
```

**Solution:** Turn-local "conversation anchor" that captures active conversation state.

---

## Database Schema

### Table: `conversation_anchor`

```sql
-- supabase/migrations/20260213_conversation_anchor.sql

create table public.conversation_anchor (
  id uuid not null default extensions.uuid_generate_v4(),
  interaction_id text not null,
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

create index if not exists idx_conversation_anchor_interaction_id
  on public.conversation_anchor using btree (interaction_id);

create index if not exists idx_conversation_anchor_updated_at
  on public.conversation_anchor using btree (updated_at desc);

create trigger update_conversation_anchor_updated_at
  before update on public.conversation_anchor
  for each row
  execute function update_updated_at_column();
```

**Key fields:**
- `interaction_id` (UNIQUE) — Conversation grouping key
- `anchor_summary` — 1-2 sentence summary of conversation state
- `unresolved_asks` — Array of open questions from user
- `active_emotional_context` — Tone/mood of conversation
- `pending_commitments` — Promises Kayley made
- `last_user_message` — For topic shift detection
- `last_turn_index` — Monotonic write guard
- `last_topic_hash` — Optional topic fingerprint

---

## Size Caps (Enforced Before Write)

```typescript
const SIZE_CAPS = {
  anchor_summary: 450,              // chars
  unresolved_asks_count: 4,         // max items
  unresolved_asks_item: 120,        // chars per item
  pending_commitments_count: 4,     // max items
  pending_commitments_item: 120,    // chars per item
  emotional_context: 180,           // chars
  total_section: 1200,              // chars (total prompt injection)
};
```

**Overflow behavior:** Truncate and degrade to summary-first layout.

---

## Service Architecture

### New File: `src/services/conversationAnchorService.ts`

**Types:**
```typescript
export interface ConversationAnchorRow {
  id: string;
  interaction_id: string;
  schema_version: number;
  anchor_summary: string;
  unresolved_asks: string[];
  active_emotional_context: string;
  pending_commitments: string[];
  last_user_message: string;
  last_turn_index: number;
  last_topic_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefreshAnchorInput {
  interactionId: string;
  turnIndex: number;              // From chatHistory.length (primary source)
  userMessage: string;
  modelResponse: string;
  recentTurns: Array<{ role: "user" | "model"; text: string }>;
}
```

**Core functions:**
```typescript
// Read (hot path - must be fast)
export async function getConversationAnchor(
  interactionId: string
): Promise<ConversationAnchorRow | null>;

// Prompt builder (hot path - no LLM calls)
export async function buildConversationAnchorPromptSection(
  interactionId: string | null | undefined
): Promise<string>;

// Update orchestration (background - fire-and-forget)
export async function refreshConversationAnchor(
  input: RefreshAnchorInput
): Promise<void>;

// Refresh logic
export function shouldRefreshAnchor(params: {
  existing: ConversationAnchorRow | null;
  turnIndex: number;
  topicShift: boolean;
  nowIso: string;
}): boolean;

// Topic shift detection
export function computeTopicShift(
  previousUserMessage: string,
  currentUserMessage: string
): boolean;
```

---

## Update Triggers

### Refresh Conditions (Deterministic)

```typescript
function shouldRefreshAnchor(params: {
  existing: ConversationAnchorRow | null;
  turnIndex: number;
  topicShift: boolean;
  nowIso: string;
}): boolean {
  const { existing, turnIndex, topicShift, nowIso } = params;

  // 1. No existing anchor → refresh
  if (!existing) return true;

  // 2. Out-of-order write → skip (monotonic write guard)
  if (turnIndex <= existing.last_turn_index) {
    console.log(`[ConversationAnchor] Stale write skipped`, {
      turnIndex,
      lastTurnIndex: existing.last_turn_index,
    });
    return false;
  }

  // 3. Topic shift detected → refresh
  if (topicShift) return true;

  // 4. Turn delta >= 3 → refresh
  const turnDelta = turnIndex - existing.last_turn_index;
  if (turnDelta >= 3) return true;

  // 5. Time guard: >= 90s since updated_at AND >= 1 new turn → refresh
  const timeSinceUpdate = Date.now() - new Date(existing.updated_at).getTime();
  if (timeSinceUpdate >= 90_000 && turnDelta >= 1) return true;

  return false;
}
```

### Topic Shift Detection

```typescript
function computeTopicShift(
  previousUserMessage: string,
  currentUserMessage: string
): boolean {
  // 1. Normalize to tokens (lowercase, remove stopwords, split)
  const prevTokens = normalizeToTokens(previousUserMessage);
  const currTokens = normalizeToTokens(currentUserMessage);

  // 2. Min length check (ignore very short messages)
  if (prevTokens.length < 3 || currTokens.length < 3) return false;

  // 3. Compute overlap ratio
  const prevSet = new Set(prevTokens);
  const currSet = new Set(currTokens);
  const intersection = [...prevSet].filter(t => currSet.has(t));
  const overlapRatio = intersection.length / Math.max(prevSet.size, currSet.size);

  // 4. Marker word boost (instant topic shift signals)
  const markerWords = [
    'anyway',
    'switching gears',
    'different topic',
    'changing subject',
    'moving on',
    'by the way',
    'off topic',
  ];
  const hasMarker = markerWords.some(m =>
    currentUserMessage.toLowerCase().includes(m)
  );

  // 5. Shift if overlap < 0.2 OR has marker word
  return overlapRatio < 0.2 || hasMarker;
}

function normalizeToTokens(text: string): string[] {
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at',
    'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was',
    'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may',
    'might', 'must', 'can', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
    .split(/\s+/)
    .filter(token => token.length > 2 && !stopwords.has(token));
}
```

---

## LLM Generation (No Regex/Deterministic)

### System Prompt

```typescript
function buildAnchorSystemPrompt(): string {
  return `
ROLE:
You are a conversation memory synthesizer for Kayley (AI companion) and Steven (user).
Your job is to extract the current working memory anchor for this conversation thread.

RULES:
1. Be concise. This is working memory, not long-term storage.
2. Extract ONLY unresolved asks (questions Steven asked that Kayley hasn't fully answered yet).
3. Extract ONLY pending commitments (promises Kayley made that haven't been fulfilled yet).
4. Capture the emotional tone of the conversation (venting, playful, serious, stressed, excited).
5. Summarize the conversation in 1-2 sentences (what's being discussed, what Steven cares about).
6. If nothing is unresolved or pending, use empty arrays.

OUTPUT:
Return raw JSON only. No markdown. No explanation. Schema:
{
  "anchor_summary": "1-2 sentence summary of conversation state",
  "unresolved_asks": ["list", "of", "open", "questions"],
  "active_emotional_context": "Tone/mood description",
  "pending_commitments": ["list", "of", "promises", "Kayley made"]
}

SIZE LIMITS:
- anchor_summary: max 450 characters
- unresolved_asks: max 4 items, each max 120 characters
- pending_commitments: max 4 items, each max 120 characters
- active_emotional_context: max 180 characters
`.trim();
}
```

### User Prompt

```typescript
function buildAnchorPrompt(recentTurns: Array<{ role: string; text: string }>): string {
  const formatted = recentTurns
    .map(t => `${t.role === 'user' ? 'Steven' : 'Kayley'}: ${t.text}`)
    .join('\n\n');

  return `
RECENT CONVERSATION (last 6-8 turns):
${formatted}

Task: Extract the working memory anchor for this conversation.
Return JSON only.
`.trim();
}
```

### Generation Function

```typescript
const LOG_PREFIX = '[ConversationAnchor]';
const GEMINI_MODEL = 'gemini-2.0-flash-001';
const SCHEMA_VERSION = 1;

export async function refreshConversationAnchor(
  input: RefreshAnchorInput
): Promise<void> {
  const { interactionId, turnIndex, userMessage, modelResponse, recentTurns } = input;

  try {
    // 1. Fetch existing anchor
    const existing = await getConversationAnchor(interactionId);

    // 2. Compute topic shift
    const topicShift = existing
      ? computeTopicShift(existing.last_user_message, userMessage)
      : false;

    // 3. Check if refresh needed
    if (!shouldRefreshAnchor({ existing, turnIndex, topicShift, nowIso: new Date().toISOString() })) {
      return;
    }

    console.log(`${LOG_PREFIX} Refreshing anchor`, {
      interactionId,
      turnIndex,
      reason: !existing ? 'new' : topicShift ? 'topic_shift' : 'turn_delta',
    });

    // 4. Call Gemini LLM
    const systemPrompt = buildAnchorSystemPrompt();
    const prompt = buildAnchorPrompt(recentTurns);

    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
      },
    });

    // 5. Parse JSON response
    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`${LOG_PREFIX} No JSON in response`);
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // 6. Validate and enforce size caps
    const anchor = enforceSizeCaps({
      anchor_summary: parsed.anchor_summary || '',
      unresolved_asks: Array.isArray(parsed.unresolved_asks) ? parsed.unresolved_asks : [],
      active_emotional_context: parsed.active_emotional_context || '',
      pending_commitments: Array.isArray(parsed.pending_commitments) ? parsed.pending_commitments : [],
    });

    // 7. Compute topic hash (optional)
    const topicHash = computeTopicHash(userMessage);

    // 8. Upsert to DB
    const { error } = await supabase
      .from('conversation_anchor')
      .upsert(
        {
          interaction_id: interactionId,
          schema_version: SCHEMA_VERSION,
          anchor_summary: anchor.anchor_summary,
          unresolved_asks: anchor.unresolved_asks,
          active_emotional_context: anchor.active_emotional_context,
          pending_commitments: anchor.pending_commitments,
          last_user_message: userMessage,
          last_turn_index: turnIndex,
          last_topic_hash: topicHash,
        },
        { onConflict: 'interaction_id' }
      );

    if (error) {
      console.error(`${LOG_PREFIX} Failed to store anchor`, { error });
      return;
    }

    console.log(`${LOG_PREFIX} Anchor stored`, { interactionId, turnIndex });
  } catch (err) {
    console.error(`${LOG_PREFIX} refreshConversationAnchor failed`, { err });
  }
}

function enforceSizeCaps(anchor: {
  anchor_summary: string;
  unresolved_asks: string[];
  active_emotional_context: string;
  pending_commitments: string[];
}) {
  return {
    anchor_summary: truncate(anchor.anchor_summary, SIZE_CAPS.anchor_summary),
    unresolved_asks: anchor.unresolved_asks
      .slice(0, SIZE_CAPS.unresolved_asks_count)
      .map(a => truncate(a, SIZE_CAPS.unresolved_asks_item)),
    active_emotional_context: truncate(
      anchor.active_emotional_context,
      SIZE_CAPS.emotional_context
    ),
    pending_commitments: anchor.pending_commitments
      .slice(0, SIZE_CAPS.pending_commitments_count)
      .map(c => truncate(c, SIZE_CAPS.pending_commitments_item)),
  };
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;
}
```

---

## Prompt Integration

### File: `src/services/system_prompts/builders/systemPromptBuilder.ts`

**CRITICAL FIX:** Pass `interactionId` as argument, don't reference `aiResult.session` (wrong scope).

**Modified signature:**
```typescript
export async function buildSystemPromptForNonGreeting(
  options: BuildPromptOptions,
  interactionId?: string | null  // ← NEW PARAMETER
): Promise<string>
```

**Injection point:**
```typescript
// Inside buildSystemPromptForNonGreeting()
const anchorSection = await buildConversationAnchorPromptSection(interactionId);

let prompt = `
${KAYLEY_CONDENSED_PROFILE}
${buildAntiAssistantSection()}
${await buildCurrentWorldContext()}
${anchorSection}              // ← NEW: Highest priority (before synthesis)
${synthesisSection}
${topicSuppressionPrompt}
// ... rest unchanged
`.trim();
```

### File: `src/services/geminiChatService.ts`

**Pass interactionId from geminiChatService:**

```typescript
// In generateResponse() or wherever buildSystemPromptForNonGreeting is called
const systemPrompt = await buildSystemPromptForNonGreeting(
  options,
  session?.interactionId  // ← Pass from session
);
```

### Anchor Section Format

```typescript
export async function buildConversationAnchorPromptSection(
  interactionId: string | null | undefined
): Promise<string> {
  // Feature flag check
  if (import.meta.env.VITE_USE_CONVERSATION_ANCHOR !== 'true') {
    return '';
  }

  // Missing interactionId → skip (don't create synthetic ID)
  if (!interactionId) {
    console.debug(`${LOG_PREFIX} Skipped (missing interactionId)`);
    return '';
  }

  try {
    // Single DB read (fast)
    const anchor = await getConversationAnchor(interactionId);
    if (!anchor) return '';

    // Schema version check
    if (anchor.schema_version !== SCHEMA_VERSION) {
      console.warn(`${LOG_PREFIX} Schema mismatch`);
      return '';
    }

    // Enforce size caps before rendering
    const capped = enforceSizeCaps(anchor);

    // Build section
    const unresolvedSection =
      capped.unresolved_asks.length > 0
        ? `\nUNRESOLVED ASKS:\n${capped.unresolved_asks.map(a => `- ${a}`).join('\n')}`
        : '';

    const commitmentsSection =
      capped.pending_commitments.length > 0
        ? `\nPENDING COMMITMENTS:\n${capped.pending_commitments.map(c => `- ${c}`).join('\n')}`
        : '';

    const section = `
====================================================
CONVERSATION ANCHOR (turn ${anchor.last_turn_index})
====================================================

SUMMARY: ${capped.anchor_summary}

EMOTIONAL CONTEXT:
${capped.active_emotional_context}
${unresolvedSection}
${commitmentsSection}

IMPORTANT: If this anchor conflicts with the current user message,
trust the current user message. The anchor may be slightly stale.
====================================================
`.trim();

    // Total section size cap
    return section.length > SIZE_CAPS.total_section
      ? truncate(section, SIZE_CAPS.total_section)
      : section;
  } catch (err) {
    console.error(`${LOG_PREFIX} buildConversationAnchorPromptSection failed`, { err });
    return ''; // Graceful degradation
  }
}
```

---

## Orchestrator Integration

### File: `src/services/messageOrchestrator.ts`

**CRITICAL FIX:** Use `chatHistory.length` as turn index (primary source), not DB query.

**Location:** Post-processing phase (~line 372)

```typescript
// After response generation, in post-processing block
const turnIndex = chatHistory.length; // ← PRIMARY SOURCE (in-request context)

// Fire-and-forget background updates
Promise.all([
  extractAndRecordTopics(response.text_response, userMessage),

  // NEW: Anchor refresh (skip if missing interactionId)
  aiResult.session?.interactionId
    ? refreshConversationAnchor({
        interactionId: aiResult.session.interactionId,
        turnIndex,  // From chatHistory.length
        userMessage,
        modelResponse: response.text_response,
        recentTurns: chatHistory.slice(-8),  // Last 6-8 turns
      })
    : Promise.resolve(), // Skip if no interactionId
]).catch(err =>
  console.error('❌ [Orchestrator] Background post-processing failed:', err)
);
```

**Key fixes:**
1. ✅ No `crypto.randomUUID()` fallback (skip update if missing interactionId)
2. ✅ Use `chatHistory.length` as primary turn index source
3. ✅ Pass recent turns from `chatHistory.slice(-8)`

---

## Feature Flag

### Environment Variable

```bash
VITE_USE_CONVERSATION_ANCHOR=true
```

**Default:** `false` (opt-in for safer rollout)

**Behavior:**
- If `false` or unset: `buildConversationAnchorPromptSection()` returns `""`, `refreshConversationAnchor()` is not called
- If `true`: Anchor system is active

### Rollout Strategy

1. Deploy migration first
2. Ship code with `VITE_USE_CONVERSATION_ANCHOR=false`
3. Enable in local/staging
4. Validate continuity + latency
5. Enable in production

### Rollback

1. Set `VITE_USE_CONVERSATION_ANCHOR=false`
2. Redeploy (or hot-reload if env var is read dynamically)
3. Keep table in place (no destructive rollback)

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Missing interactionId | Skip update, debug log, return empty section |
| Out-of-order turnIndex | Skip write (monotonic guard) |
| LLM returns malformed JSON | Log warning, skip update |
| Anchor generation timeout | Catch timeout, log error, skip update |
| DB write failure | Log error, continue (fire-and-forget) |
| Schema version mismatch | Return empty section, log warning |
| Total section > 1200 chars | Truncate to 1200 chars |
| Feature flag false | Empty section, no updates |

---

## Logging

**Prefix:** `[ConversationAnchor]`

**Events:**
```typescript
// Read
console.debug('[ConversationAnchor] Skipped (missing interactionId)');
console.debug('[ConversationAnchor] Skipped (feature flag off)');
console.warn('[ConversationAnchor] Schema mismatch');

// Refresh
console.log('[ConversationAnchor] Refreshing anchor', {
  interactionId,
  turnIndex,
  reason: 'new' | 'topic_shift' | 'turn_delta' | 'time_guard',
});
console.log('[ConversationAnchor] Stale write skipped', { turnIndex, lastTurnIndex });
console.log('[ConversationAnchor] Anchor stored', { interactionId, turnIndex });

// Errors
console.warn('[ConversationAnchor] No JSON in response');
console.error('[ConversationAnchor] Failed to store anchor', { error });
console.error('[ConversationAnchor] refreshConversationAnchor failed', { err });
```

**Avoid:** Logging full message text (PII risk).

---

## Implementation Checklist

1. ✅ Migration: `conversation_anchor` table
2. ✅ Service: `conversationAnchorService.ts`
   - getConversationAnchor()
   - buildConversationAnchorPromptSection()
   - refreshConversationAnchor()
   - shouldRefreshAnchor()
   - computeTopicShift()
   - enforceSizeCaps()
3. ✅ Prompt builder: Add `interactionId` parameter to `buildSystemPromptForNonGreeting()`
4. ✅ Prompt builder: Inject anchor section before synthesis
5. ✅ Gemini service: Pass `session?.interactionId` to prompt builder
6. ✅ Orchestrator: Fire-and-forget anchor refresh with `turnIndex = chatHistory.length`
7. ✅ Feature flag: Check `VITE_USE_CONVERSATION_ANCHOR` in both read and write paths
8. ✅ Tests: Service + integration tests
9. ✅ Build: `tsc --noEmit && vite build`
10. ✅ Manual test: Long conversation with unresolved ask

---

## Verification

### Manual Test Scenarios

1. **Bootstrap:** First 3 messages → verify anchor created after turn 1
2. **Turn delta:** Send 6 messages → verify refresh at turn 4
3. **Topic shift:** Coffee discussion → switch to work → verify refresh
4. **Time guard:** Wait 90s, send message → verify refresh
5. **Missing interactionId:** Force missing ID → verify skip (no crash)
6. **Feature flag off:** Verify empty section, no updates
7. **Prompt inspection:** Log prompt → verify anchor before synthesis

### Database Checks

```sql
-- Check anchor exists
SELECT * FROM conversation_anchor ORDER BY updated_at DESC LIMIT 5;

-- Verify turn index monotonic
SELECT interaction_id, last_turn_index, updated_at
FROM conversation_anchor
ORDER BY updated_at DESC;

-- Check size caps enforced
SELECT interaction_id,
  length(anchor_summary) as summary_len,
  jsonb_array_length(unresolved_asks) as asks_count,
  length(active_emotional_context) as emotion_len
FROM conversation_anchor;
```

---

## Critical Files

**New:**
- `src/services/conversationAnchorService.ts` (~400 lines)
- `supabase/migrations/20260213_conversation_anchor.sql` (~40 lines)

**Modified:**
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
  - Add `interactionId` parameter to `buildSystemPromptForNonGreeting()`
  - Inject anchor section (~5 lines)
- `src/services/geminiChatService.ts`
  - Pass `session?.interactionId` to prompt builder (~2 lines)
- `src/services/messageOrchestrator.ts`
  - Fire-and-forget anchor refresh (~10 lines)

---

## Final Summary

**Key decisions:**
1. ✅ LLM-only generation (no regex)
2. ✅ Skip update when interactionId missing (no synthetic IDs)
3. ✅ Pass interactionId as argument to prompt builder
4. ✅ Feature flag required (default false)
5. ✅ Turn index from chatHistory.length (primary), DB fallback
6. ✅ Flat schema (not JSONB)
7. ✅ 90s time guard (not 2hr TTL)
8. ✅ Topic shift: overlap < 0.2 + marker words
9. ✅ Explicit size caps enforced
10. ✅ Monotonic writes (reject out-of-order)

Ready for implementation. All critical issues addressed.
