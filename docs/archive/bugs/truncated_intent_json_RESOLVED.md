# Truncated Intent JSON - RESOLVED

**Resolution Date:** 2026-01-13
**Status:** ✅ Fixed

## Problem
Intent detection LLM calls were returning truncated JSON responses, failing to parse at position 1151 with text cut off mid-field (e.g., `"isSarcasti` instead of `"isSarcastic"`).

## Root Causes
1. **Payload too large** (~5638 chars, ~1410 tokens) for `gemini-3-flash-preview` model
2. **Unnecessary user facts detection** (~1200 chars) included in time-critical intent call
3. **Too much conversation context** (5 messages = ~750 chars)
4. **Verbose contradiction examples** (~450 chars with 9 examples)

## Solution Implemented
Applied **3 optimizations** to reduce payload by **30%**:

### 1. Removed User Facts Detection (Section 7) - Saved 1200 chars
- **Before:** Section 7 included full user fact detection with categories, rules, and 10 examples
- **After:** Removed entirely from intent detection
- **Rationale:** Not time-critical. Facts can be stored via `store_user_info` tool in main chat
- **Files Modified:**
  - `intentService.ts`: Removed Section 7 from UNIFIED_INTENT_PROMPT
  - `intentService.ts`: Removed `userFacts` from responseSchema
  - `messageOrchestrator.ts`: Removed userFacts processing
  - `aiSchema.ts`: Added documentation for optional userFacts field

### 2. Reduced Contradiction Examples - Saved 200 chars
- **Before:** 6 trigger patterns + 3 examples = ~300 chars
- **After:** 2 concise examples = ~100 chars
- **File Modified:** `intentService.ts` lines 1931-1937

### 3. Reduced Conversation Context - Saved 300 chars
- **Before:** Last 5 messages × 150 chars = 750 chars
- **After:** Last 3 messages × 150 chars = 450 chars
- **File Modified:** `intentService.ts` line 1977 (`.slice(-5)` → `.slice(-3)`)

## Results
- **Before:** ~5638 chars (~1410 tokens)
- **After:** ~3938 chars (~985 tokens)
- **Reduction:** 30% smaller payload

### Expected Impact
- ✅ No more truncated JSON responses
- ✅ Faster intent detection (less processing time)
- ✅ Lower API costs (fewer tokens)
- ✅ All time-critical detection still intact:
  - Genuine moments
  - Tone & sentiment
  - Topics
  - Open loops
  - Relationship signals
  - Contradiction detection

## Trade-offs
- **User facts no longer auto-detected in intent** - Users must explicitly trigger fact storage via conversation
- **Less conversation context** - May reduce accuracy for ambiguous messages (mitigated by keeping most recent 3 messages)
- **Fewer contradiction examples** - LLM has less guidance (but still has core examples)

## Verification
To verify the fix:
1. Send a message like "Can you do something for me please?!"
2. Check console - should see `🧠 [IntentService] UNIFIED INTENT DETECTED` without truncation errors
3. No more `⚠️ Response may be truncated` warnings
4. No more `❌ Failed to parse JSON` errors

## Related
- Original bug report: `docs/bugs/truncated_intent_json.md`
- Intent service: `src/services/intentService.ts`
- Schema definitions: `src/services/aiSchema.ts`
