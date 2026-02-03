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

