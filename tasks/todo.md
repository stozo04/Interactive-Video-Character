## Plan: Runtime Stability Fixes (Phase 2B Follow-Up)

1) Fix context synthesis watermark query to use valid timestamp columns per table in `src/services/contextSynthesisService.ts`.
2) Include `storyline_updates` watermark so storyline edits invalidate synthesis freshness checks.
3) Remove API key from Interactions request URL in `src/services/geminiChatService.ts` (header-only key).
4) Verification (if approved): `npm test -- --run`, then manual non-greeting turn to confirm:
- no `life_storylines.updated_at` 400
- no `key=` in Interactions request URL.

## Progress
- [x] Watermark source mapping patched (`life_storylines.created_at`, `storyline_updates.created_at`).
- [x] Interactions URL patched to remove `?key=` query parameter.
- [x] Active recall semantic timeout stabilization patched to race late semantic completion vs lexical fallback.
- [x] Interactions tool-loop hardening patched (dynamic `create_life_storyline` gating + duplicate call suppression).
- [x] Fallback prompt sections bounded with hardcoded constants (daily notes, Mila milestones, curiosity facts, answered idle questions).
- [x] Active recall timeout logging refined to avoid false fallback warnings when semantic recovers.
- [x] Calendar prompt date-only handling fixed to prevent birthday/reminder timezone drift from appearing as timed events on wrong day.
- [x] Calendar ownership guardrails added (prompt policy + calendar context + live injected label + persona temporal grounding).
- [ ] Verification not run (requires approval).

## Review Notes
- Focused fixes only; no schema mutations and no behavior changes outside watermark/read-path logging and request URL construction.

---

## Plan: Feature Notes Article (Tool Suggestions / Agency Gap)

1) Capture plan + scope based on commit `78448025dc68969f0a5f9653fe7ac7634c43717d`.
2) Draft blog post with required sections and constraints in `docs/Feature_Notes.txt`.
3) Fix encoding artifacts in `docs/Feature_Notes.txt` (e.g., smart quotes, en dashes).
4) Optional verification (if approved): `npm test -- --run`.

## Progress
- [x] Plan captured
- [x] Draft written in `docs/Feature_Notes.txt`
- [x] Encoding cleaned in `docs/Feature_Notes.txt`
- [ ] Verification run (if approved)

## Review Notes
- Draft complete; awaiting any edits or verification requests.

---

## Plan: Mila Moments Tool Call (Append-Only Notes)

1) Review existing daily notes flow and tool plumbing (`src/services/memoryService.ts`, `src/services/aiSchema.ts`, `src/services/system_prompts/tools/toolsAndCapabilities.ts`, `src/services/system_prompts/builders/systemPromptBuilder.ts`).
2) Define `mila_milestone_notes` table schema (UTC `created_at`, optional `note_entry_date`) + helper functions + migration under `supabase/migrations/`.
3) Add `mila_note` + `retrieve_mila_notes` tool schemas, args types, declarations, and pending tool list updates (`src/services/aiSchema.ts`).
4) Implement tool execution + retrieval by month (`src/services/memoryService.ts`).
5) Add tool usage guidance (`src/services/system_prompts/tools/toolsAndCapabilities.ts`).
6) Inject Mila milestones prompt section (similar to DAILY NOTES) (`src/services/system_prompts/builders/systemPromptBuilder.ts`).
7) Update tool catalog (`src/services/toolCatalog.ts`).
8) Verification (if approved): `npm test -- --run -t "snapshot"`, `npm test -- --run`.

## Progress
- [x] Migration, services, schemas, prompts, and tool catalog updated.
- [x] Verification run (user-confirmed).

## Review Notes
- Verified by user. Ready to commit.

---

## Plan: Mila Milestones Documentation + No .single() Guidance

1) Add feature doc for Mila milestones in `docs/features/`.
2) Update tool integration guidance to avoid `.single()` when rows may be absent (`docs/AI_Notes_Tool_Integration_Checklist.md`).
3) Verification (if approved): none required (docs only).

## Progress
- [x] Documentation created and checklist updated.

## Review Notes
- Done; no verification needed.

---

## Plan: Stop Silent Google OAuth On Startup (Option 1) + Bug Update

1) Document findings and fix plan in `docs/bugs/BUG-2026-02-01-google-auth-gmail-401.md`.
2) Update Google auth startup logic to avoid silent OAuth on load in `src/contexts/GoogleAuthContext.tsx`.
3) Adjust any related messaging or guardrails if needed in `src/services/googleAuth.ts` and `src/components/AuthWarningBanner.tsx`.
4) Verification (if approved): `npm test -- --run` and/or `npm run dev`.

## Progress
- [x] Bug doc updated with findings + fix
- [x] Silent OAuth on startup disabled
- [x] Guardrails/messaging reviewed
- [ ] Verification run (if approved)

## Review Notes
- Pending approval to patch.

---

## Plan: Improve IdleThinking "Theme Recently Used" Log

1) Confirm desired log detail and format in `src/services/idleThinkingService.ts`.
2) Update the log message and context payload for the theme-skip case.
3) Verification (if approved): `npm test -- --run`.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: Canonicalize User Facts + Pinned Facts + Data Cleanup

1) Define canonical keys (e.g., identity.nickname) and pinning flag behavior.
2) Normalize existing data in C:\Users\gates\Downloads\user_facts_rows.json and return cleaned JSON.
3) Update server-side fact normalization + tool rules to enforce canonical keys.
4) Optional: add dynamic pinned-facts section to greeting prompt (if approved).
5) Verification (if approved): 
pm test -- --run.

---

## Plan: AI Returns Empty Object Response ({}) Bug

1) Get console log file path and HAR file path (confirm safe to inspect).
2) Review logs + HAR to capture request/response payloads, HTTP status, and parsing flow.
3) Identify likely root-cause area(s) in code and note risks/edge cases.
4) Draft a bug document in `docs/bugs/` with findings, evidence, and next steps.
5) Verification (if approved): `npm test -- --run`.

## Progress
- [x] Logs and HAR reviewed.
- [x] Root cause identified (tool loop hits max iterations, no text output).
- [x] Bug doc created in `docs/bugs/BUG-2026-02-11-ai-empty-object-response.md`.
- [ ] Verification not run (requires approval).

## Review Notes
- Ready for review.

---

## Plan: Phase 2 Codex Implementation Document

1) Reconcile existing Phase 2 concept with current production architecture (`synthesis` + `anchor` + non-greeting prompt flow).
2) Define implementation-ready service contract for per-turn active recall (Phase 2a lexical, Phase 2b optional semantic).
3) Map exact file touch points and rollout flags for low-risk integration.
4) Create a new implementation document in `docs/phase2_implementation_codex.md`.
5) Verification (if approved): `npm run build`, `npm test -- --run`.

## Progress
- [x] Existing docs + relevant services inspected.
- [x] Drafted and created implementation document in `docs/phase2_implementation_codex.md`.
- [ ] Verification not run (requires approval).

## Review Notes
- Document focuses on a shippable Phase 2a with deterministic scoring and fail-open behavior.

---

## Plan: Phase 2A Best-Of-Both Final Plan

1) Merge the product framing from `docs/phase2_plan.md` with concrete implementation details from `docs/phase2_implementation_codex.md`.
2) Resolve identified plan gaps: numeric confidence mapping, lexical-gated scoring, integration path through `geminiChatService`, and explicit prompt/latency caps.
3) Create a new final planning doc in `docs/phase2_plan_final.md` without overwriting existing drafts.
4) Verification (if approved): `npm run build`, `npm test -- --run`.

## Progress
- [x] Merge strategy defined from both docs.
- [x] Final merged plan document created.
- [ ] Verification not run (requires approval).

## Review Notes
- Created `docs/phase2_plan_final.md` with merged product framing + implementation-ready technical details.

---

## Plan: Phase 2A Uncommitted Implementation Review

1) Compare uncommitted Phase 2A code to `docs/phase2_plan_final.md`.
2) Validate integration path (`geminiChatService` -> `systemPromptBuilder` -> `activeRecallService`).
3) Identify severity-ordered defects and plan drift.
4) Record findings/questions in a docs review file.

## Progress
- [x] Uncommitted diffs inspected for Phase 2A files.
- [x] Plan-vs-code comparison completed.
- [x] Review written to `docs/phase2a_implementation_review.md`.
- [ ] Verification not run (requires approval).

## Review Notes
- Primary residual issue: lexical gating rule from the finalized plan is not implemented yet.

---

## Plan: Expand Phase 2B in Final Plan Doc

1) Re-read `docs/phase2_plan_final.md` and identify missing Phase 2B implementation detail.
2) Merge prior semantic retrieval ideas with current Phase 2A guardrails.
3) Expand Phase 2B with migration design, sync pipeline, runtime mode flags, fallback behavior, and acceptance criteria.
4) Keep verification commands proposed only (do not run).

## Progress
- [x] Phase 2B gaps identified.
- [x] `docs/phase2_plan_final.md` expanded with detailed Phase 2B sections.
- [ ] Verification not run (requires approval).

## Review Notes
- Phase 2B now includes schema, sync triggers, hybrid retrieval mode, rollout/rollback, observability, and acceptance criteria.

---

## Plan: Build Phase 2B

1) Extend `src/services/activeRecallService.ts` to support retrieval modes (`lexical`, `hybrid`, `semantic`) with semantic-first fallback chain.
2) Add `src/services/factEmbeddingsService.ts` for embedding generation, semantic match RPC calls, and source sync helpers.
3) Wire embedding sync hooks into fact/storyline write paths:
- `src/services/memoryService.ts`
- `src/services/characterFactsService.ts`
- `src/services/storylineService.ts`
4) Add semantic index migration in `supabase/migrations/20260213_phase2b_fact_embeddings.sql`.
5) Verification (if approved): `npm run build`, `npm test -- --run`.

## Progress
- [x] Retrieval mode support implemented in `src/services/activeRecallService.ts`.
- [x] Embedding service created at `src/services/factEmbeddingsService.ts`.
- [x] Write-path sync hooks added for user facts, character facts, and storylines.
- [x] Migration created at `supabase/migrations/20260213_phase2b_fact_embeddings.sql`.
- [ ] Verification not run (requires approval).

## Review Notes
- Implementation is fail-open: semantic path degrades to lexical, then empty section.

---

## Plan: Context Synthesis Review + Codex Solution Doc

1) Review `docs/context_synthesis_thoughts.md` and extract strengths, risks, and unresolved design gaps.
2) Create a new solution document in `docs/context_synthesis_thoughts_codex_solution.md` with:
- problem restatement
- review of current proposal
- recommended architecture
- phased implementation
- observability, guardrails, and rollback
3) Propose verification commands (if approved): `Get-Content docs/context_synthesis_thoughts_codex_solution.md`, `git diff -- docs/context_synthesis_thoughts_codex_solution.md`.

## Progress
- [x] Existing context synthesis doc reviewed.
- [x] Plan approved by user.
- [x] New solution doc drafted.

## Review Notes
- Created `docs/context_synthesis_thoughts_codex_solution.md` with a critical review of the current proposal and a revised architecture (versioned snapshots, per-turn relevance selector, and conversation anchor).

---

## Plan: Phase 1 Code Review Document

1) Re-read `docs/context_synthesis_thoughts.md` and extract revised Phase 1 expectations.
2) Review all uncommitted Phase 1 changes (`src/services/**`, `supabase/migrations/**`) against the plan.
3) Create `docs/phase1_Review.md` with severity-ordered findings, evidence, and targeted recommendations.
4) Document open questions and verification gaps (tests/build not executed).

## Progress
- [x] Updated plan reviewed.
- [x] Uncommitted code/migrations inspected.
- [x] Review document drafted in `docs/phase1_Review.md`.

## Review Notes
- Completed review doc with severity-ordered findings and file/line evidence.

---

## Plan: Phase 1 Re-Review (Post-Fixes)

1) Re-check prior 10 findings against current uncommitted code.
2) Validate each fix with file-level evidence.
3) Identify any new bugs/oversights introduced by the latest changes.
4) Overwrite `docs/phase1_Review.md` with updated conclusions.

## Progress
- [x] Prior findings re-validated against current code.
- [x] New risks/oversights assessed.
- [x] `docs/phase1_Review.md` overwritten with updated review.

## Review Notes
- All original 10 findings are addressed; residual/new items are mostly medium/low risk (topic key quality, hot-path query overhead, migration schema guard edge case).

---

## Plan: Phase 1 Re-Review (Third Pass)

1) Re-validate all previously reported findings against the latest uncommitted code.
2) Confirm user-reported fixes in `contextSynthesisService.ts`, `topicExhaustionService.ts`, and migration SQL.
3) Identify any new bugs/oversights introduced by those fixes.
4) Overwrite `docs/phase1_Review.md` with updated findings.

## Progress
- [x] Prior findings re-checked.
- [x] Latest 3 fix claims validated in code.
- [x] New/residual issues documented.
- [x] `docs/phase1_Review.md` overwritten.

## Review Notes
- Third-pass review completed. Prior findings are resolved; remaining items are new/residual robustness concerns around runtime schema validation for `seed_topics`, strictness of topic-key filtering, and idempotent seeding under concurrency.

---

## Plan: Verify Remaining Phase 1 Findings (Pre-Anchor)

1) Re-read `docs/phase1_Review.md` and list unresolved findings.
2) Validate fixes in `src/services/contextSynthesisService.ts`, `src/services/topicExhaustionService.ts`, and `supabase/migrations/20260213_topic_exhaustion.sql`.
3) Check for new regressions in the same code paths.
4) Deliver a severity-ordered code review result before starting conversation-anchor work.

## Progress
- [x] Review request acknowledged and scope defined.
- [x] Findings re-validated against current code.
- [x] New regressions assessed.
- [x] Final verification review delivered.

## Review Notes
- Verification complete: all items from `docs/phase1_Review.md` are fixed in code. One new robustness risk identified in `src/services/contextSynthesisService.ts` (topic array element type not validated before `isQualityTopicKey`).

---

## Plan: Phase 1b Conversation Anchor Design Doc

1) Translate agreed Phase 1b goals into an implementation-ready plan in `docs/`.
2) Include proactive guardrails for freshness, cadence, first-turn missing `interactionId`, contradiction handling, and prompt size limits.
3) Define migration schema, service API contract, update heuristics, prompt injection order, and rollback strategy.
4) Add a focused test plan and acceptance criteria.

## Progress
- [x] Scope and risk guardrails confirmed with user.
- [x] Phase 1b design doc drafted in `docs/`.
- [x] Review summary delivered.

## Review Notes
- Created `docs/phase1b_conversation_anchor_plan.md` with detailed schema, service contracts, update heuristics, prompt injection order, rollout/rollback, and test matrix.

---

## Plan: Fix X Media Upload 403 (Add media.write scope + guardrails)

1) Confirm current upload/auth flow and token scopes in `src/services/xTwitterService.ts`.
2) Update OAuth scope to include `media.write` and add a clear guardrail if scope is missing.
3) Ensure upload errors preserve response details for debugging (no behavior change beyond logging).
4) Verification (if approved): reconnect X account, then `npm run dev` and attempt a tweet with media.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: Align X Media Upload With X Best Practices (Binary Upload + Size Guard)

1) Adjust `uploadMedia` to send raw binary (`media`) instead of base64 `media_data` to avoid Content-Transfer-Encoding requirements in `src/services/xTwitterService.ts`.
2) Add explicit size/type checks for images (<= 5 MB; JPG/PNG/GIF/WEBP) with clear errors in `src/services/xTwitterService.ts`.
3) Make `media_category=tweet_image` explicit in the upload request for clarity.
4) Verification (if approved): reconnect X account, then `npm run dev` and attempt a tweet with a generated image.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: Switch Media Upload To X v2 Endpoint (OAuth2-Compatible)

1) Update media upload to call `/api/x/2/media/upload` with `multipart/form-data` or JSON per docs in `src/services/xTwitterService.ts`.
2) Parse v2 response (`data.id`) and use it as the media id for tweet creation in `src/services/xTwitterService.ts`.
3) Keep existing size/type guards and scope checks.
4) Verification (if approved): reconnect X account, then `npm run dev` and attempt a media tweet.

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: X Media Upload UX Guardrail + Tests

1) Add X token scope check for UI in `src/services/xTwitterService.ts`.
2) Surface a missing `media.write` banner in `src/components/SettingsPanel.tsx`.
3) Add a focused unit test for media upload response parsing in `src/services/__tests__/xTwitterService.test.ts`.
4) Verification (if approved): `npm test -- --run -t "xTwitterService"` (or full `npm test -- --run`).

## Progress
- [ ] Waiting on approval to patch.

## Review Notes
- Not started.

---

## Plan: X Posting Mode Lookup 406 (Use maybeSingle)

1) Update the `user_facts` lookup for `x_posting_mode` to use `.maybeSingle()` in `src/services/idleThinkingService.ts`.
2) Update the settings panel lookup to use `.maybeSingle()` in `src/components/SettingsPanel.tsx`.
3) Confirm no behavior regressions when the row is missing (defaults still apply).
4) Verification (if approved): `npm test -- --run`.

## Progress
- [x] Updated `x_posting_mode` lookups to use `.maybeSingle()`.
- [ ] Verification not run (requires approval).

## Review Notes
- Ready for review.

---

## Plan: Active Recall Timeout Noise Reduction

1) Switch active recall config to code constants (no env dependency) in `src/services/activeRecallService.ts`.
2) Increase default timeout values to reduce false timeout errors on normal latency.
3) Log timeout failures as warning (expected fail-open), keep non-timeout failures as error.
4) Verification (if approved): `npm run build`, `npm test -- --run`, manual chat turn to inspect console logs.

## Progress
- [x] Plan captured in `tasks/todo.md`.
- [x] Patch completed in `src/services/activeRecallService.ts`.
- [ ] Verification pending approval.

## Review Notes
- Requested by user: keep config as constants, no env files.

---

## Plan: Phase 2 Runtime Validation + Sequential Fixes

1) Create a runtime validation review doc from:
- `C:\Users\gates\Downloads\convo.txt`
- `C:\Users\gates\Downloads\non-greeting.txt`
- `C:\Users\gates\Downloads\non-greeting-network-1.txt`
- `C:\Users\gates\Downloads\non-greeting-network-2.txt`
2) Capture severity-ranked findings, expected-vs-actual behavior, and concrete remediation order.
3) Execute fixes one-by-one only after user confirmation per step.
4) Verification (if approved later): `npm run build`, `npm test -- --run`, targeted manual non-greeting conversation replay.

## Progress
- [x] Runtime artifacts reviewed (read-only).
- [x] Findings summarized for user.
- [x] Documentation created in `docs/phase2_runtime_validation_review.md`.
- [x] Step 1 approved and implemented in `src/services/geminiChatService.ts`.
- [x] Step 2 approved and implemented in `src/services/activeRecallService.ts`.
- [x] Step 3 approved and implemented in `src/services/activeRecallService.ts`.
- [x] Step 4 approved and implemented in `src/services/system_prompts/builders/systemPromptBuilder.ts`.
- [ ] Next sequential fix pending user approval.
- [ ] Verification pending approval.

## Review Notes
- Initial runtime audit indicates active recall is wired and fail-open, but semantic retrieval is not materially contributing in sampled turns.
- Step 1 logging redaction is implemented; runtime verification is still pending.
- Step 2 relevance tightening is implemented; runtime verification is required to confirm lower recall noise.
- Step 3 semantic tuning is implemented; runtime verification is required to confirm higher semantic contribution rate.
- Step 4 fallback prompt bloat reduction is implemented; runtime verification is required to confirm improved prompt focus.

