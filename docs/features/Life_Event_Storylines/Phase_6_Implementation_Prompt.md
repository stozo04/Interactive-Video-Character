# Phase 6: Life Event Storylines - Polish & Testing Implementation Prompt

**Context Window:** Use this prompt in a fresh Codex session to implement Phase 6.

---

## ?? What You're Implementing

**Feature:** Life Event Storylines - Phase 6 (Polish & Testing)

**Goal:** Validate the full lifecycle, tighten tuning, and add regression tests for storylines, callbacks, and closure sequences.

**Status:** Phases 1-5 are COMPLETE. Phase 6 needs implementation.

---

## ? What’s Already Completed (Phases 1-5)

- Phase 1: Database tables, CRUD, migrations
- Phase 2: Phase transitions, daily processing, LLM updates
- Phase 3: Mood integration
- Phase 4: Prompt injection on 2nd user message
- Phase 5: Closure sequences, historical callbacks, character fact storage

---

## ?? Phase 6 Goals

### 1) End-to-End Lifecycle Tests
**Create tests that validate:**
- Storyline creation ? phase transitions
- Update generation correctness per phase
- Closure sequence generation (4 updates)
- Auto-resolution logic after 5 days in climax
- Resolved storylines become callbacks after 30 days

### 2) Callback Tuning + Safeguards
- Ensure storyline callbacks do not overwhelm other callbacks
- Ensure storyline callbacks only trigger when relevant
- Validate session guard prevents repetition

### 3) Closure Tone QA
- Validate closure prompt outputs are in Kayley’s voice
- Spot-check outcomes for realism (success, failure, abandoned, transformed)
- Ensure emotional progression feels natural (not forced positivity)

### 4) Performance Review
- Verify LLM usage for closure generation is only on resolution
- Ensure daily processing doesn’t trigger extra LLM calls unnecessarily
- Confirm callback selection doesn’t add latency to prompt generation

---

## ?? Suggested Testing Steps

### Manual Scenario
1. Create a storyline in `climax` phase and backdate `phase_started_at` to 6+ days ago
2. Run `processStorylineDay()` and confirm it auto-resolves
3. Check `storyline_updates` for 4 closure updates
4. Confirm `life_storylines.phase` is `resolving`
5. Fast-forward `resolved_at` to 31 days ago
6. Call `getResolvedStorylineForCallback()` and verify selection

### Unit Test Ideas
- Mock Gemini client response for closure generation JSON
- Verify `resolveStoryline()` adds 4 updates with correct updateType sequencing
- Verify `getResolvedStorylineForCallback()` respects 30/14 day rules
- Verify `markStorylineCallbackUsed()` updates `last_mentioned_at`

---

## ?? Key Files

- `src/services/storylineService.ts`
- `src/services/callbackDirector.ts`
- `src/services/docs/StorylineService.md`
- `docs/features/Life_Event_Storylines.md`

---

## ? Deliverables

1. **Phase 6 Implementation Summary**
   - File: `docs/Phase_6_Storylines_Implementation_Summary.md`
   - Describe tests, tuning, and adjustments

2. **Feature Spec Update**
   - Mark Phase 6 as complete in `docs/features/Life_Event_Storylines.md`

3. **Service Doc Update**
   - Mark Phase 6 as complete in `src/services/docs/StorylineService.md`

---

## ? Success Criteria

Phase 6 is complete when:
- [ ] End-to-end lifecycle tests pass
- [ ] Closure sequences validated
- [ ] Callback selection verified
- [ ] No regressions in daily processing
- [ ] Docs updated

---

## ?? Tips

- Prefer mocking Gemini responses in tests
- Keep closure prompts short and consistent
- Use explicit dates in log output for clarity

Good luck! ??
