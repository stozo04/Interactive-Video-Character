# Phase 1b Plan: Conversation Working Memory Anchor

## Status

Planned. Not implemented yet.

This Phase 1b design targets the long-thread continuity failure:
- "how did the mom call go?" style misses near end of long conversations.

---

## Objective

Add a short, turn-local memory anchor per conversation that is:
1. Fast to read at prompt-build time.
2. Updated asynchronously after responses.
3. Injected ahead of synthesis in non-greeting prompts.

The anchor is not long-term memory. It is working memory for the current thread.

---

## Non-Goals

1. No semantic retrieval/embedding system in this phase.
2. No greeting-prompt changes.
3. No heavy observability dashboard in this phase.
4. No synchronous model call on hot prompt path.

---

## Success Criteria

1. Continuity failures in long threads are meaningfully reduced.
2. Non-greeting prompt build remains low-latency.
3. Anchor section is token-bounded and never bloats prompt.
4. Missing `interactionId` never breaks message flow.
5. Safe rollback via feature flag with no migration rollback required.

---

## Core Invariants

1. Anchor update is never on the user-response critical path.
2. Latest user message always overrides anchor if conflict.
3. Anchor writes are monotonic by `last_turn_index`.
4. Anchor section has strict max size and item caps.
5. Failures in anchor read/write degrade to no-anchor, never hard-fail.

---

## Data Model

Create table: `conversation_anchor`

Columns:
1. `id uuid primary key default extensions.uuid_generate_v4()`
2. `interaction_id text not null unique`
3. `schema_version integer not null default 1`
4. `anchor_summary text not null default ''`
5. `unresolved_asks jsonb not null default '[]'::jsonb`
6. `active_emotional_context text not null default ''`
7. `pending_commitments jsonb not null default '[]'::jsonb`
8. `last_user_message text not null default ''`
9. `last_turn_index integer not null default 0`
10. `last_topic_hash text null`
11. `created_at timestamptz not null default now()`
12. `updated_at timestamptz not null default now()`

Indexes:
1. Unique on `interaction_id`
2. Optional index on `updated_at desc` for housekeeping/admin queries

Triggers:
1. `update_updated_at_column()` on update

Migration file:
1. `supabase/migrations/20260213_conversation_anchor.sql`

---

## Feature Flag

Add:
1. `VITE_USE_CONVERSATION_ANCHOR=true`

Behavior:
1. If `false`, builder does not inject anchor and orchestrator does not update anchor.
2. If unset, treat as enabled for phase testing only if desired; otherwise default false for safer rollout.

Recommended initial rollout:
1. Default `false` in production.
2. Enable in local/dev + staging first.

---

## Service Contract

New file:
1. `src/services/conversationAnchorService.ts`

Types:
```ts
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
  last_topic_hash?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefreshAnchorInput {
  interactionId: string;
  turnIndex: number;
  userMessage: string;
  modelResponse: string;
  recentTurns: Array<{ role: "user" | "model"; text: string }>;
}
```

Functions:
```ts
export async function getConversationAnchor(interactionId: string): Promise<ConversationAnchorRow | null>;
export async function buildConversationAnchorPromptSection(interactionId?: string | null): Promise<string>;
export async function refreshConversationAnchor(input: RefreshAnchorInput): Promise<void>;
export function shouldRefreshAnchor(params: {
  existing: ConversationAnchorRow | null;
  turnIndex: number;
  topicShift: boolean;
  nowIso: string;
}): boolean;
export function computeTopicShift(previousUserMessage: string, currentUserMessage: string): boolean;
```

---

## Refresh Strategy

Refresh trigger rules (deterministic):
1. No existing anchor -> refresh.
2. Topic shift detected -> refresh.
3. `turnIndex - last_turn_index >= 3` -> refresh.
4. Time guard: if `>= 90s` since `updated_at` and at least 1 new turn -> refresh.

Do not refresh when:
1. `turnIndex <= last_turn_index` (out-of-order or duplicate write).

Topic shift heuristic:
1. Normalize text to tokens (lowercase, alpha-numeric, stopword-lite removal).
2. Compute overlap ratio between previous and current user messages.
3. Shift if overlap ratio < 0.2 and both messages pass min token threshold.
4. Add marker boost words like "anyway", "switching gears", "different topic".

---

## Update Generation

Anchor update should use bounded summarization, not raw append.

Recommended generation method:
1. Deterministic first pass:
- Extract unresolved asks from question marks/open loops in recent turns.
- Extract commitments from model promises/intents.
- Extract emotional context from response tone markers.
2. Optional lightweight LLM refinement:
- Use a small constrained JSON schema prompt.
- Timeout aggressively (for example 1200ms) and fail open to deterministic fallback.

For Phase 1b simplicity:
1. Prefer deterministic parser first.
2. Add LLM refinement only if deterministic output quality is insufficient.

---

## Prompt Injection Order

Current non-greeting assembly in:
1. `src/services/system_prompts/builders/systemPromptBuilder.ts`

Planned order:
1. Static shell + anti-assistant + world context
2. `CONVERSATION ANCHOR` section (if present)
3. Synthesis section
4. Topic suppression + existing dynamic sections

Conflict rule in section header:
1. "If anchor conflicts with current user message, trust current user message."

---

## Hot Path Safety

In `buildConversationAnchorPromptSection`:
1. Single DB read by `interaction_id`.
2. No LLM calls.
3. Return `""` on any error.
4. Hard size caps before returning text.

Caps:
1. `anchor_summary <= 450 chars`
2. `unresolved_asks <= 4 items`, each `<= 120 chars`
3. `pending_commitments <= 4 items`, each `<= 120 chars`
4. `active_emotional_context <= 180 chars`
5. Total anchor section `<= 1200 chars`

If over budget:
1. Truncate and degrade to summary-first layout.

---

## Orchestrator Integration

Update location:
1. `src/services/messageOrchestrator.ts` post-processing block

Add fire-and-forget call:
1. Build `turnIndex` from `chatHistory` length.
2. Call `refreshConversationAnchor(...)` with:
- `interactionId` from `aiResult.session?.interactionId`
- current `userMessage`
- `response.text_response`
- recent turn window (last 6-8 turns)
3. Wrap with `.catch(...)` log and continue.

Missing `interactionId` handling:
1. Skip update.
2. Debug-level log only.

---

## Gemini Service Integration

Update call sites in:
1. `src/services/geminiChatService.ts`

Change `buildSystemPromptForNonGreeting(...)` signature to accept optional:
1. `interactionId?: string | null`

Pass:
1. `session?.interactionId` from `generateResponse(...)`
2. `session.interactionId` in `generateNonGreeting(...)`

Builder behavior:
1. If missing `interactionId`, anchor section returns `""`.

---

## Rollout And Rollback

Rollout:
1. Deploy migration first.
2. Ship code with `VITE_USE_CONVERSATION_ANCHOR=false`.
3. Enable in staging.
4. Validate continuity + latency.
5. Enable in production.

Rollback:
1. Flip `VITE_USE_CONVERSATION_ANCHOR=false`.
2. Keep table in place; no destructive rollback needed.

---

## Logging

Prefix:
1. `[ConversationAnchor]`

Events:
1. read success/fail
2. skipped due to missing `interactionId`
3. refresh triggered with reason (`new|turn_delta|topic_shift|time_guard`)
4. stale/out-of-order write skipped
5. section truncated due to budget

Avoid:
1. logging raw sensitive content in full text

---

## Test Plan

New tests:
1. `src/services/__tests__/conversationAnchorService.test.ts`
2. `src/services/system_prompts/builders/__tests__/systemPromptBuilder.anchor.test.ts`

Cases:
1. Missing `interactionId` -> empty section, no throw.
2. First turn creates/refreshes anchor.
3. Refresh every 3 turns when no topic shift.
4. Topic-shift refresh triggers early.
5. Out-of-order `turnIndex` write is skipped.
6. Prompt section enforces caps and truncation.
7. Conflict rule line present in rendered section.
8. Feature flag off -> no injection and no refresh calls.

Manual verification scenarios:
1. Long conversation with early unresolved ask and late follow-up.
2. Hard topic switch mid-thread.
3. High message volume thread to confirm no latency regression.

---

## Acceptance Criteria

1. Anchor section appears before synthesis in non-greeting prompt when enabled.
2. No anchor-related blocking on response path.
3. Continuity scenario reproduces correctly in test dialog.
4. Prompt size remains bounded with anchor enabled.
5. No uncaught exceptions on malformed anchor payloads.

---

## Implementation Sequence

1. Migration: `conversation_anchor` table + indexes + trigger.
2. Service: `conversationAnchorService.ts` with read/build/update/heuristics.
3. Prompt builder: inject anchor ahead of synthesis.
4. Gemini service: pass `interactionId` into prompt builder.
5. Orchestrator: fire-and-forget post-turn anchor refresh.
6. Tests: service + builder integration.
7. Verification: test/build/manual continuity scenario.

---

## Verification Commands (Proposed, Not Run)

1. `npm test -- --run`
2. `npm run build`
3. `rg "conversation_anchor|ConversationAnchor|buildConversationAnchorPromptSection|refreshConversationAnchor" src`
