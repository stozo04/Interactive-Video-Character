# Phase 2 Runtime Validation Review

Date: 2026-02-13  
Scope: Runtime behavior validation for Phase 1/1B/2 during non-greeting chat flow  
Artifacts reviewed:
- `C:\Users\gates\Downloads\convo.txt`
- `C:\Users\gates\Downloads\non-greeting.txt`
- `C:\Users\gates\Downloads\non-greeting-network-1.txt`
- `C:\Users\gates\Downloads\non-greeting-network-2.txt`

---

## Executive Summary

Implementation is partially successful:
- Conversation continuity and tool execution are working.
- Active recall is integrated and fail-open behavior works.
- Semantic path is configured but did not provide useful candidates in sampled turns.

Primary gaps to fix:
1. Sensitive token/key logging in runtime logs.
2. Active recall relevance quality (noisy matches in prompt section).
3. Semantic path effectiveness (timeouts/zero candidates in sampled turns).
4. Prompt bloat in fallback path reducing recall signal quality.

---

## Expected vs Actual

Expected:
- Non-greeting flow should inject anchor + active recall + synthesis when fresh.
- Hybrid active recall should contribute semantic matches where useful and fallback safely.
- Logs should be structured without exposing secrets.

Actual:
- Synthesis was frequently stale during sampled turns and fell back to raw sections.
- Active recall section was injected and built each turn, mostly from lexical fallback.
- Semantic retrieval often timed out or returned zero candidates in sampled turns.
- Logs included sensitive tokens/API key values.

---

## Findings (Severity Ordered)

### 1) High: Sensitive token/key data appears in logs

Evidence:
- `non-greeting.txt` contains full access token and API key-bearing request context.

Impact:
- Security exposure in screenshots/log sharing.
- Prevents safe external review and incident response hygiene.

Fix priority: P0 (first)

---

### 2) Medium: Semantic retrieval not materially contributing in sampled turns

Evidence:
- Repeated `semanticCandidates: 0` and semantic timeout warnings in `non-greeting.txt`.
- Active recall ultimately built via lexical fallback.

Impact:
- Phase 2B quality uplift is not realized.
- Latency cost without observed recall gain.

Fix priority: P1

---

### 3) Medium: Active recall relevance quality is noisy

Evidence:
- Active recall items in network payload include unrelated facts for meeting/calendar turns
  (for example rental properties, podcasts, unrelated storyline entries).

Impact:
- Prompt budget consumed by low-relevance memory.
- Potential response drift.

Fix priority: P1

---

### 4) Medium: Fallback prompt bloat dilutes active recall signal

Evidence:
- Non-greeting payload includes very large “known user facts” sections plus active recall.

Impact:
- Attention dilution and higher latency risk.
- Harder to verify actual contribution from active recall.

Fix priority: P2

---

### 5) Low: Synthesis availability lag observed in session

Evidence:
- `ContextSynthesis stale or missing` observed repeatedly.
- Later log shows synthesis generation/store completes (`durationMs` ~13.6s).

Impact:
- During stale windows, runtime depends on heavier fallback sections.

Fix priority: P3

---

## What Is Working

- Active recall path is wired in non-greeting system prompt construction.
- Fail-open behavior works (timeouts do not block response generation).
- Gemini interaction continuity (`previous_interaction_id`) remains stable.
- Tool call execution (calendar create) succeeded in observed flow.

---

## Sequential Remediation Plan

1. **P0: Remove sensitive runtime logging**
- Redact or remove logs containing raw tokens/API keys/request payload secrets.
- Keep structured diagnostics without credentials.

2. **P1: Tighten active recall relevance**
- Raise selection strictness (thresholds/scoring gates).
- Reduce noisy candidates in lexical fallback.

3. **P1: Improve semantic utility in hybrid**
- Validate query/embed thresholds and semantic timeout behavior.
- Ensure semantic path is producing candidates for paraphrased references.

4. **P2: Reduce fallback prompt bloat**
- Limit or summarize large legacy sections when active recall is present.

5. **P3: Synthesis freshness follow-up**
- Monitor stale windows and synthesis generation cadence.

---

## Execution Log

### Step 1 (P0) - Sensitive Logging Redaction

Status: Implemented (pending runtime verification)

Scope:
- `src/services/geminiChatService.ts` (primary)
- `src/services/messageOrchestrator.ts` (confirm no token-bearing object logs)

Planned changes:
- Replace raw object dumps with structured redacted summaries.
- Remove logs that print full request/config objects containing headers or access tokens.
- Keep operational debug fields only:
  - model
  - interaction ids
  - tool count
  - message/input type
  - duration/status

Implemented changes:
- Updated `src/services/geminiChatService.ts` to replace raw object dumps with structured summaries for:
  - interaction request logging
  - session/options context
  - interaction creation/finalization
  - response/session summaries
  - greeting context and interaction summaries
- Removed direct logging of full interaction config objects in the above paths.

### Step 2 (P1) - Active Recall Relevance Tightening

Status: Implemented (pending runtime verification)

Scope:
- `src/services/activeRecallService.ts`

Implemented changes:
- Added stronger lexical/key signal gates before deterministic boost application.
- Added weak-signal filtering before final candidate selection.
- Added structured metrics to lexical retrieval logs:
  - `weakFilteredCount`
  - `eligibleCount`

Intended effect:
- Reduce noisy recall items that only matched by weak overlap.
- Preserve relevant recall while keeping fail-open behavior unchanged.

### Step 3 (P1) - Semantic Utility Tuning

Status: Implemented (pending runtime verification)

Scope:
- `src/services/activeRecallService.ts`

Implemented changes:
- Raised semantic retrieval budget and timeout:
  - `semanticTopK: 20 -> 30`
  - `semanticTimeoutMs: 250 -> 350`
- Lowered semantic query threshold:
  - `semanticMinSim: 0.70 -> 0.55`
- Added explicit semantic eligibility filter and observability:
  - `MIN_SEMANTIC_SIGNAL_FOR_SELECTION = 0.55`
  - new log fields:
    - `semanticEligibleCount`
    - `semanticSelectionMinSim`

Intended effect:
- Reduce zero-candidate semantic runs in hybrid mode.
- Improve odds that semantic contributes before lexical fallback.

### Step 4 (P2) - Fallback Prompt Bloat Reduction

Status: Implemented (pending runtime verification)

Scope:
- `src/services/system_prompts/builders/systemPromptBuilder.ts`

Implemented changes:
- Bounded curiosity facts context used in fallback prompt path:
  - max facts per category: `12`
  - max fact value length: `120` chars
- Added omitted-facts summary marker:
  - `[Curiosity] Additional stored facts omitted for brevity: N`
- Added structured log for bounded context build:
  - total facts
  - omitted facts
  - configured caps

Intended effect:
- Reduce prompt size and attention dilution in fallback mode.
- Keep broad context coverage while preventing full corpus dumps.

Acceptance criteria:
- No console output contains:
  - `googleAccessToken`
  - `x-goog-api-key`
  - `AIza`
  - raw bearer token strings
- Non-greeting interaction debugging remains usable.

---

## Verification Plan (Proposed, Not Run)

Commands:
- `npm run build`
- `npm test -- --run`

Manual replay:
1. Run a 5-8 turn non-greeting conversation similar to the provided sample.
2. Confirm no sensitive data in logs.
3. Confirm active recall items are directly relevant to the user turn.
4. Confirm semantic path contributes candidates on paraphrased fact references.
5. Confirm response quality remains stable after prompt-size reductions.
