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

