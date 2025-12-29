# Bug Report: Idle Thoughts System Not Integrated

**Status:** ✅ RESOLVED (2025-12-29)
**Severity:** Medium
**Date Reported:** 2025-12-29
**Component:** Idle Thoughts System / Spontaneity
**Resolution:** See [IDLE_THOUGHTS_DATABASE_FIXES.md](IDLE_THOUGHTS_DATABASE_FIXES.md)

---

## Summary

The idle thought generation system is **fully implemented but never triggered**. The application has no mechanism to periodically call `generateIdleThought()` during user absence, making this entire feature non-functional.

## Current Implementation Status

### What Exists (Working)
- ✅ `generateIdleThought()` - Generates thoughts, dreams, memories, curiosities, anticipations
- ✅ `getUnsharedThoughts()` - Retrieves unshared thoughts from database
- ✅ `markThoughtAsShared()` - Marks thoughts as shared after being mentioned
- ✅ `idle_thoughts` table schema - Stores generated thoughts
- ✅ Unit tests - 25+ tests covering all scenarios
- ✅ Documentation - `docs/Kayley_Thinking_Process.md`

### What's Missing (Not Working)
- ❌ **No idle detection trigger** - Nothing checks if user has been away 4+ hours
- ❌ **No periodic scheduler** - No job that runs periodically to generate thoughts
- ❌ **No integration call** - `generateIdleThought()` is never invoked in application code
- ❌ **No prompt injection** - Unshared thoughts are never injected into system prompt for conversation
- ❌ **No proactive presentation** - Idle thoughts never surface as conversation starters

---

## Code References

**Idle Thoughts Implementation:**
- `src/services/spontaneity/idleThoughts.ts` - Core service (lines 127-212)
- `src/services/spontaneity/types.ts` - Type definitions
- `src/services/spontaneity/index.ts` - Exports

**Where It Should Be Called (Currently Missing):**
- No background scheduler
- No idle detector
- No integration in `App.tsx`
- No integration in `BaseAIService.ts`
- No integration in `buildGreetingPrompt()`

**Related But Not Connected:**
- `src/services/presenceDirector.ts` - Open loop system (4-hour cooldown)
- `src/services/ongoingThreads.ts` - Mental threads system (4-hour settling time)
- `src/services/spontaneity/integrateSpontaneity.ts` - Spontaneity integration (placeholder imports only)

---

## Impact

**User Experience:**
- Kayley never mentions dreams about the user
- Never recalls conversations while user was away
- Never asks questions that "popped into her head"
- Loses the "she was thinking about me" feeling during absence
- No proactive reconnection on return

**System Design:**
- 25+ lines of test code for unused feature
- `idle_thoughts` table sits empty
- Documentation describes non-functional behavior

---

## Root Cause

The feature was designed and implemented but the **orchestration layer** was never added. Missing pieces:

1. **Idle Detection** - No check for "has user been away 4+ hours?"
2. **Periodic Trigger** - No scheduler to periodically generate thoughts
3. **Prompt Integration** - No code to inject unshared thoughts into chat prompt
4. **Conversation Flow** - No logic to surface thoughts as natural conversation starters

---

## Proposed Solution

1. **Add Idle Detector** - Check user's `last_interaction` timestamp on app init
2. **Add Periodic Scheduler** - Run every 4 hours (or configurable interval) to generate thoughts
3. **Inject into Greeting** - When user returns after 4+ hours, check for unshared thoughts
4. **Surface in Prompt** - Include top unshared thought in greeting or first response context
5. **Mark as Shared** - After Kayley mentions a thought, mark it as shared in database

---

## Related Issues

- Open loops system exists but may not be properly surfaced (has cooldown logic)
- Ongoing threads system exists but may not be proactively mentioned
- Spontaneity system doesn't call `generateIdleThought()`

---

## Configuration

**Constants Updated:**
- `MIN_ABSENCE_HOURS_FOR_THOUGHT = 10 / 60` (10 minutes for testing)
- Location: `src/services/spontaneity/idleThoughts.ts:32`

---

## Next Steps

1. ✅ Create implementation plan in `docs/` - See `docs/plans/08_Idle_Thoughts_Integration.md`
2. ✅ Add idle detection logic - Implemented in `idleThoughtsScheduler.ts`
3. ✅ Add periodic thought generation - Background scheduler checks every 1 minute
4. ✅ Wire idle thoughts into greeting prompt - Integrated with ongoing threads system
5. ✅ Update integration tests - 10 unit tests added
6. ✅ Manual testing with simulated absence - Completed

---

## Resolution (2025-12-29)

The idle thoughts system has been **fully implemented and tested**. See [IDLE_THOUGHTS_DATABASE_FIXES.md](IDLE_THOUGHTS_DATABASE_FIXES.md) for details.

### Implementation Summary

**New Files Created**:
- `src/services/idleThoughtsScheduler.ts` - Background scheduler service (181 lines)
- `src/services/__tests__/idleThoughtsScheduler.test.ts` - Unit tests (190 lines)
- `docs/plans/08_Idle_Thoughts_Integration.md` - Implementation plan (709 lines)
- `supabase/migrations/fix_idle_thoughts_absence_duration_type.sql` - Database fix

**Files Modified**:
- `src/App.tsx` - Added scheduler lifecycle management (+10 lines)
- `src/services/spontaneity/idleThoughts.ts` - Added thought detection (+55 lines)
- `src/services/BaseAIService.ts` - Added thought marking integration (+20 lines)
- `src/services/stateService.ts` - Fixed race condition in `saveAllOngoingThreads()` (+41/-27 lines)

**Test Results**: ✅ 10/10 scheduler tests passing, ✅ 22/22 idle thoughts tests passing

**Architecture**:
- Background scheduler checks for user absence every 1 minute (testing mode)
- Generates idle thoughts after 1 minute of absence (configurable)
- Converts thoughts to ongoing threads (unified mental model)
- Thoughts surface naturally via existing `presenceDirector` idle breaker
- Automatic detection and marking of shared thoughts

**Database Fixes**:
- Fixed `absence_duration_hours` column type (INTEGER → NUMERIC(5,2))
- Fixed race condition in ongoing threads (upsert instead of delete + insert)

**User Action Required**:
1. Apply database migration: `supabase db push`
2. Restart dev server: `npm run dev`

