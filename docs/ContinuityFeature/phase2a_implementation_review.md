# Phase 2A Implementation Review (Uncommitted)

Date: 2026-02-12  
Reviewer: Codex  
Guide used: `docs/phase2_plan_final.md`

## Scope Reviewed

- `src/services/activeRecallService.ts`
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
- `src/services/geminiChatService.ts`
- `docs/phase2_plan_final.md`

## Findings (Ordered by Severity)

### 1) High: Lexical-gating rule from final plan is not implemented

Evidence:
- Plan requires boosts only when lexical or key match exists: `docs/phase2_plan_final.md:124`.
- Implementation always adds recency/confidence/pinned regardless of lexical/key match:
  - `src/services/activeRecallService.ts:332`
  - `src/services/activeRecallService.ts:333`
  - `src/services/activeRecallService.ts:334`
  - `src/services/activeRecallService.ts:336`

Impact:
- Irrelevant but recent/high-confidence facts can still pass threshold.
- This violates acceptance criteria for low-noise recall quality (`docs/phase2_plan_final.md:266`).

Recommendation:
- Gate boosts behind `(lexical > 0 || keyBonus > 0)`.
- Or hard-filter candidates with no lexical/key signal before thresholding.

### 2) Medium: Scoring weights diverge from approved Phase 2A final plan

Evidence:
- Final plan component targets:
  - lexical `0..60`, keyBonus `0..15`, recency `0..15`, confidence `0..10` (`docs/phase2_plan_final.md:117`).
- Implemented weights:
  - lexical `0..55` (`src/services/activeRecallService.ts:187`)
  - keyBonus `0..10` (`src/services/activeRecallService.ts:201`)
  - recency `0..20` (`src/services/activeRecallService.ts:217`)
  - confidence `0..15` (`src/services/activeRecallService.ts:227`)

Impact:
- Different ranking behavior than planned.
- `minScore` tuning from plan may not behave as expected.

Recommendation:
- Align code with finalized weights or explicitly update the plan to match implementation.

### 3) Medium: `max_items` cap from plan is not enforced in selection path

Evidence:
- Plan caps recall items at 7 (`docs/phase2_plan_final.md:205`).
- Config limit is read directly from env (`src/services/activeRecallService.ts:52`).
- Selection uses `slice(0, maxItems)` without clamping (`src/services/activeRecallService.ts:362`).
- `SIZE_CAPS.max_items` exists but is not used in selection/build path (`src/services/activeRecallService.ts:62`).

Impact:
- Misconfigured env (`VITE_ACTIVE_RECALL_LIMIT > 7`) can exceed intended item count.
- Section may rely on blunt total-char truncation instead of clean bounded item list.

Recommendation:
- Clamp effective limit with `Math.min(SIZE_CAPS.max_items, config.limit)` and enforce a sane minimum.

### 4) Low: Env parsing is not hardened for invalid values

Evidence:
- `parseInt(...)` is used for `limit`, `minScore`, and `timeoutMs` (`src/services/activeRecallService.ts:52`).
- No fallback recovery if parse returns `NaN` or non-positive values.

Impact:
- Invalid env values can silently disable retrieval quality or return empty sections.

Recommendation:
- Add validation/clamping:
  - `limit`: `1..7`
  - `minScore`: sensible bounded range (for example `0..100`)
  - `timeoutMs`: minimum floor (for example `>= 50`)

### 5) Low: Structured log fields from plan are only partially implemented

Evidence:
- Plan expects `timedOut` and `featureEnabled` in structured logs (`docs/phase2_plan_final.md:241`).
- Current success log includes counts/duration but not those two fields (`src/services/activeRecallService.ts:366`).

Impact:
- Slightly weaker observability when diagnosing rollout behavior.

Recommendation:
- Include `featureEnabled` in retrieval logs and explicit `timedOut: true/false` outcome logs.

## What Looks Good

- Three-source retrieval is implemented and fetched in parallel:
  - `src/services/activeRecallService.ts:304`
- Active recall is injected in both synthesis and fallback prompt paths, after anchor:
  - `src/services/system_prompts/builders/systemPromptBuilder.ts:151`
  - `src/services/system_prompts/builders/systemPromptBuilder.ts:203`
- `geminiChatService` correctly threads current user text for text/image_text and skips audio:
  - `src/services/geminiChatService.ts:731`
  - `src/services/geminiChatService.ts:739`
- Fail-open behavior is present for flag-off, no message, timeout, and errors:
  - `src/services/activeRecallService.ts:394`
  - `src/services/activeRecallService.ts:399`
  - `src/services/activeRecallService.ts:447`

## Questions

1. Do you want strict adherence to the finalized scoring weights in `docs/phase2_plan_final.md`, or should we update that doc to reflect the implemented weighting model?
2. Should lexical/key gating be mandatory for Phase 2A rollout, given the acceptance criterion on low-noise relevance?
3. Should `VITE_ACTIVE_RECALL_LIMIT` be hard-clamped to 7 at runtime?

## Verification Status

No tests/build were executed in this review pass (not run).
