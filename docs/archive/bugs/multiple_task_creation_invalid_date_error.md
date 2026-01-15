# Bug: Multiple Task Creation Causes Invalid Date Error in Open Loop Detection

**Status:** Active
**Severity:** High
**Date Reported:** 2026-01-15
**Reported By:** User
**File:** `src/services/presenceDirector.ts:632`

## Summary

When creating multiple tasks via the `task_action` tool, the system crashes with a `RangeError: Invalid time value` when attempting to create open loops for tasks that contain temporal information (e.g., "Go to Dr. Gomez at 2pm").

## Error Details

```
[PresenceDirector] Error creating open loop: RangeError: Invalid time value
    at Date.toISOString (<anonymous>)
    at createOpenLoop (presenceDirector.ts:632:48)
    at async detectOpenLoops (presenceDirector.ts:958:20)
```

## Reproduction Steps

1. Send a message asking Kayley to create multiple tasks, where at least one contains a specific time:
   ```
   I have a few tasks that I need you to create and manage:
   - Research consistent Id for non conversations (low priority)
   - Take out trash (high)
   - Prep Laundry (high)
   - Go to Dr. Gomez at 2pm (high)
   ```

2. Observe console logs:
   - All 4 `task_action` tool calls execute successfully
   - Task creation completes
   - Background analysis (`analyzeUserMessage`) attempts to detect open loops
   - Error occurs when `createOpenLoop` tries to insert into `presence_contexts` table

3. Result: Tasks are created, but open loop creation fails, potentially losing important follow-up context

## Root Cause Analysis

### The Flow

1. **Task Creation** (Works ✅)
   - `memoryService.ts:556-558` - All 4 tasks are created successfully
   - Each task is inserted into the database correctly

2. **Background Analysis** (Partial failure ❌)
   - `messageAnalyzer.ts:399` - Calls `detectOpenLoops()` in background
   - Intent detection identifies "Go to Dr. Gomez at 2pm" as a `pending_event`
   - LLM returns `OpenLoopIntent` with `eventDateTime` field

3. **Invalid Date Conversion** (Bug 🐛)
   - `intentService.ts:806` - LLM returns `eventDateTime` as a string
   - `presenceDirector.ts:966-968` - String is converted to Date object:
     ```typescript
     eventDateTime: llmResult.eventDateTime
       ? new Date(llmResult.eventDateTime)
       : undefined,
     ```
   - **Problem**: When LLM returns an invalid date string (e.g., "2pm", malformed ISO string, or other unparseable format), `new Date()` creates an **Invalid Date** object
   - Invalid Date objects have `date.toString() === "Invalid Date"` and `isNaN(date.getTime()) === true`

4. **Error on .toISOString()** (Crash 💥)
   - `presenceDirector.ts:632` - Attempts to call `.toISOString()` on Invalid Date:
     ```typescript
     event_datetime: options.eventDateTime?.toISOString() || null,
     ```
   - Calling `.toISOString()` on an Invalid Date throws `RangeError: Invalid time value`

### Why This Happens with Multiple Tasks

The bug is triggered when:
- Multiple tasks are created in one message
- At least one task contains temporal information ("at 2pm", "tomorrow", etc.)
- The LLM's intent detection extracts a datetime for an open loop
- The extracted datetime string is not a valid ISO 8601 format

**Example Invalid Date Strings from LLM:**
- `"2pm"` (no date component)
- `"at 2pm"` (includes prefix)
- `"2:00"` (ambiguous format)
- Partially formed ISO strings
- Empty string or `undefined` coerced to string

## Affected Code Locations

### Primary Bug Location
**File:** `src/services/presenceDirector.ts`
**Line:** 632

```typescript
event_datetime: options.eventDateTime?.toISOString() || null,
```

**Issue:** No validation that `options.eventDateTime` is a valid Date before calling `.toISOString()`

### Contributing Locations

1. **File:** `src/services/presenceDirector.ts:966-968`
   ```typescript
   eventDateTime: llmResult.eventDateTime
     ? new Date(llmResult.eventDateTime)
     : undefined,
   ```
   **Issue:** No validation that `new Date(llmResult.eventDateTime)` creates a valid Date

2. **File:** `src/services/intentService.ts:806`
   ```typescript
   eventDateTime: parsed.openLoops?.eventDateTime ? String(parsed.openLoops.eventDateTime) : undefined
   ```
   **Issue:** LLM can return any string, no format validation

3. **Similar potential issues on:**
   - `presenceDirector.ts:625-628` - Other `.toISOString()` calls (currently safe because they use constructed Dates)

## Impact

**User Impact:**
- Tasks are created successfully ✅
- But open loops for time-sensitive tasks are lost ❌
- No follow-up reminders for appointments/events
- Silent failure (error logged to console, but user sees no indication)

**System Impact:**
- Background analysis crashes partway through
- Other background operations (momentum updates, relationship tracking) still complete
- Data inconsistency: tasks exist but no corresponding open loops

**Frequency:**
- Reproduces consistently when tasks contain specific times
- More likely with multiple tasks (increases chance of temporal references)

## Proposed Fix

### Option 1: Validate Date Before .toISOString() (Recommended)

**Location:** `presenceDirector.ts:632`

```typescript
// Before (current code)
event_datetime: options.eventDateTime?.toISOString() || null,

// After (with validation)
event_datetime: options.eventDateTime && !isNaN(options.eventDateTime.getTime())
  ? options.eventDateTime.toISOString()
  : null,
```

**Pros:**
- Minimal change, surgical fix
- Handles Invalid Date gracefully
- Allows open loop creation to succeed (without eventDateTime)

**Cons:**
- Loses datetime information when LLM provides invalid format
- Doesn't fix root cause (LLM returning bad data)

### Option 2: Validate at Conversion Point (Defense in Depth)

**Location:** `presenceDirector.ts:966-968`

```typescript
// Before
eventDateTime: llmResult.eventDateTime
  ? new Date(llmResult.eventDateTime)
  : undefined,

// After
eventDateTime: llmResult.eventDateTime
  ? (() => {
      const parsed = new Date(llmResult.eventDateTime);
      return !isNaN(parsed.getTime()) ? parsed : undefined;
    })()
  : undefined,
```

**Pros:**
- Validates closer to source of bad data
- Prevents invalid Dates from propagating
- Could add logging to identify LLM issues

**Cons:**
- More complex code
- Silent data loss (no indication datetime was invalid)

### Option 3: Improve LLM Date Extraction (Comprehensive)

**Location:** `intentService.ts:806` + LLM schema

1. Add stricter schema validation for `eventDateTime` in `intentService.ts`
2. Add example valid ISO strings in schema description
3. Add post-processing validation with error logging

```typescript
// In intentService.ts after line 806
eventDateTime: (() => {
  if (!parsed.openLoops?.eventDateTime) return undefined;

  const dateStr = String(parsed.openLoops.eventDateTime);
  const parsed = new Date(dateStr);

  if (isNaN(parsed.getTime())) {
    console.warn(
      `[IntentService] LLM returned invalid eventDateTime: "${dateStr}". Ignoring.`
    );
    return undefined;
  }

  return dateStr;
})(),
```

**Pros:**
- Catches issues at data entry point
- Provides debugging information
- Prevents bad data from entering the system

**Cons:**
- Requires changes in multiple locations
- Still needs defense at .toISOString() call

### Recommended Approach

**Implement ALL THREE options (defense in depth):**

1. ✅ **Option 3** - Validate and log at LLM parsing (`intentService.ts:806`)
2. ✅ **Option 2** - Validate at Date conversion (`presenceDirector.ts:966`)
3. ✅ **Option 1** - Validate before `.toISOString()` (`presenceDirector.ts:632`)

This provides:
- **Early detection** of invalid data from LLM
- **Debugging visibility** via console warnings
- **Fail-safe** at final usage point
- **Graceful degradation** (open loops created without datetime rather than total failure)

## Testing Plan

### Unit Tests Needed

1. **Test Invalid Date Handling in createOpenLoop**
   ```typescript
   it('should handle invalid eventDateTime gracefully', async () => {
     const invalidDate = new Date('invalid');
     const loop = await createOpenLoop('pending_event', 'Doctor appointment', {
       eventDateTime: invalidDate
     });
     expect(loop).not.toBeNull();
     expect(loop.event_datetime).toBeNull();
   });
   ```

2. **Test LLM Invalid Date String Parsing**
   ```typescript
   it('should validate eventDateTime from LLM response', () => {
     const invalidDateStrings = ['2pm', 'at 2pm', 'tomorrow', '', 'invalid'];

     invalidDateStrings.forEach(dateStr => {
       const result = parseOpenLoopIntent({
         openLoops: {
           hasFollowUp: true,
           loopType: 'pending_event',
           topic: 'appointment',
           eventDateTime: dateStr
         }
       });

       // Should either be undefined or a valid ISO string
       if (result.eventDateTime) {
         expect(() => new Date(result.eventDateTime).toISOString()).not.toThrow();
       }
     });
   });
   ```

3. **Integration Test: Multiple Tasks with Time References**
   ```typescript
   it('should handle multiple task creation with temporal references', async () => {
     const message = "Create these tasks: Take out trash (high), Go to Dr. Gomez at 2pm (high)";

     // Should not throw
     await expect(analyzeUserMessage(message, ...)).resolves.not.toThrow();
   });
   ```

### Manual Testing

1. Reproduce original scenario with multiple tasks
2. Test with various invalid time formats:
   - "at 2pm"
   - "2:00"
   - "tomorrow at noon"
   - "next week"
3. Verify:
   - Tasks are created ✅
   - No console errors ✅
   - Open loops created (with or without eventDateTime) ✅
   - Logs show validation warnings if datetime invalid ✅

## Related Files

- `src/services/presenceDirector.ts` - Open loop creation and management
- `src/services/intentService.ts` - LLM intent parsing and validation
- `src/services/messageAnalyzer.ts` - Orchestrates background analysis
- `src/services/memoryService.ts` - Task action execution

## Prevention for Future

1. **Add Date validation helper**
   ```typescript
   // src/utils/dateHelpers.ts
   export function isValidDate(date: unknown): date is Date {
     return date instanceof Date && !isNaN(date.getTime());
   }

   export function toISOStringOrNull(date: Date | undefined | null): string | null {
     return date && isValidDate(date) ? date.toISOString() : null;
   }
   ```

2. **Use helper consistently**
   - Replace all `.toISOString()` calls with `toISOStringOrNull()`
   - Search codebase for pattern: `\.toISOString\(\)`
   - Add ESLint rule to discourage direct `.toISOString()` usage

3. **Improve LLM Schema Documentation**
   - Add examples of valid ISO 8601 strings in schema
   - Explicitly state "must be valid ISO 8601 or null"
   - Consider adding format validation in schema if supported

## Notes

- This bug is NOT a race condition or concurrency issue
- The four task creations all succeed independently
- The error occurs in the background analysis phase
- Similar bugs may exist anywhere `.toISOString()` is called on user/LLM-provided dates

## Next Steps

1. Implement recommended fix (all three validation points)
2. Add unit tests
3. Add `toISOStringOrNull` helper utility
4. Search codebase for other `.toISOString()` vulnerabilities
5. Update snapshot tests if system prompt changes
6. Manual testing with original reproduction case
