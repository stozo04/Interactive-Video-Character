# Phase 1B Implementation Review (Re-Review)

Date: 2026-02-12  
Reviewer: Codex  
Scope: Current uncommitted Phase 1B changes

Reviewed files:
- `src/services/conversationAnchorService.ts`
- `src/services/messageOrchestrator.ts`
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
- `src/services/geminiChatService.ts`
- `supabase/migrations/20260213_conversation_anchor.sql`

## Summary

No high or medium severity defects found in this pass.  
All previously reported Phase 1B findings appear addressed.

## Prior Findings Status

Resolved from prior review:
1. Write-path feature flag enforcement is present in `src/services/conversationAnchorService.ts:209`.
2. Current exchange is included in anchor generation context in `src/services/messageOrchestrator.ts:381`.
3. Read-path freshness guard exists and is configurable in `src/services/conversationAnchorService.ts:26`.
4. Turn index now uses current user turn semantics (`+1`) in `src/services/messageOrchestrator.ts:374`.
5. Topic shift threshold is now a named constant at `0.3` in `src/services/conversationAnchorService.ts:21`.
6. Anchor model is env-driven with fallback in `src/services/conversationAnchorService.ts:19`.

## Findings (Ordered by Severity)

### 1. Low: Freshness env parsing is not validated for invalid/non-positive values
Evidence:
- Freshness is parsed directly from env using `parseInt(...)` in `src/services/conversationAnchorService.ts:26`.
- `FRESHNESS_WINDOW_MS` is computed from the parsed value in `src/services/conversationAnchorService.ts:30`.

Impact:
- If env is malformed (for example `abc`) or non-positive (`0`, `-1`), freshness behavior can become unintuitive:
  - `NaN` can effectively disable stale checks.
  - `0` can mark anchors stale immediately.

Recommended fix:
- Guard and clamp configuration:
  - fallback to `120` when parse fails,
  - enforce a minimum positive value (for example `>= 1` minute).

### 2. Low: Prompt label says "last 6-8 turns" but runtime sends up to 5 turns
Evidence:
- Runtime caps context to 10 messages (5 turns) in `src/services/messageOrchestrator.ts:385`.
- Anchor prompt text says `RECENT CONVERSATION (last 6-8 turns)` in `src/services/conversationAnchorService.ts:460`.

Impact:
- Minor prompt/documentation mismatch. Not a blocker, but it can reduce instruction precision for anchor generation.

Recommended fix:
- Update prompt label to match actual payload (for example `last 5 turns` or `last up to 10 messages`).

## Positive Notes

- Anchor injection ordering remains correct in both synthesis and fallback prompt paths:
  - `src/services/system_prompts/builders/systemPromptBuilder.ts:149`
  - `src/services/system_prompts/builders/systemPromptBuilder.ts:197`
- Interaction ID threading is correct in non-greeting prompt construction:
  - `src/services/geminiChatService.ts:731`
  - `src/services/geminiChatService.ts:922`
- Orchestrator post-processing integration is clean and non-blocking:
  - `src/services/messageOrchestrator.ts:387`

## Verification Status

No tests/build were executed in this review pass (not run).
