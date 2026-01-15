# Bug: Date Operations Using Local Timezone Instead of UTC

**Status:** Active
**Severity:** High
**Date Reported:** 2026-01-15
**Priority:** High
**Related:** `docs/archive/bugs/interaction-id-timezone-bug_RESOLVED.md`

## Summary

Multiple locations in the codebase use `setHours()` with `.toISOString()`, which causes timezone inconsistencies. The `setHours()` method operates in the **local timezone**, but `toISOString()` converts to **UTC**, causing date shifts for users in timezones ahead of UTC (UTC+1 and higher).

This pattern was previously fixed in `conversationHistoryService.ts` (see archived bug report), but the same issue exists in at least 3 other service files.

## Impact

**Affected Users:**
- Users in timezones UTC+1 and higher (Europe, Middle East, Asia, Australia, New Zealand)
- Severity increases the further ahead of UTC the user is

**Consequences:**
- Incorrect date boundaries for calendar events
- Wrong time-of-day calculations
- Gift messages sent at wrong intervals
- Event queries returning incorrect results

**User Experience:**
- Calendar events may be missing or duplicated
- "Today's events" query may include yesterday's events
- Gift messages sent more frequently than intended
- Subtle bugs that only manifest in certain timezones

## Root Cause

### The Pattern

```typescript
// INCORRECT - Timezone Bug
const date = new Date();
date.setHours(0, 0, 0, 0);  // Sets to local midnight
const isoString = date.toISOString();  // Converts to UTC, shifts date

// CORRECT - UTC Consistent
const date = new Date();
date.setUTCHours(0, 0, 0, 0);  // Sets to UTC midnight
const isoString = date.toISOString();  // No date shift
```

### Why This Happens

1. `setHours(0, 0, 0, 0)` sets the date to **midnight in the user's local timezone**
2. `toISOString()` converts the date to **UTC timezone**
3. For users ahead of UTC, this **shifts the date backwards** by the timezone offset

### Example: User in UTC+8 (Asia)

```typescript
// Current time: 2026-01-15 08:00:00 +08:00 (8 AM local time)
const date = new Date();  // 2026-01-15T08:00:00+08:00

date.setHours(0, 0, 0, 0);  // 2026-01-15T00:00:00+08:00 (local midnight)

date.toISOString();  // "2026-01-14T16:00:00.000Z" ❌
// Expected: "2026-01-15T00:00:00.000Z"
// Actual: Date shifted to YESTERDAY (Jan 14) at 4 PM UTC!
```

**Result:** Queries for "today's events" include events from **yesterday**.

### Example: User in UTC-5 (US East Coast)

```typescript
// Current time: 2026-01-15 08:00:00 -05:00
const date = new Date();  // 2026-01-15T08:00:00-05:00

date.setHours(0, 0, 0, 0);  // 2026-01-15T00:00:00-05:00

date.toISOString();  // "2026-01-15T05:00:00.000Z" ❌
// Expected: "2026-01-15T00:00:00.000Z"
// Actual: Date shifted forward by 5 hours
```

**Result:** Queries for "today" start at 5 AM UTC instead of midnight.

## Affected Code Locations

### 1. Calendar Service (High Severity)

**File:** `src/services/calendarService.ts`
**Lines:** 176, 180

```typescript
// BEFORE (Incorrect)
const startDate = new Date(now);
startDate.setHours(0, 0, 0, 0);  // ❌ Local timezone

const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
endDate.setHours(23, 59, 59, 999);  // ❌ Local timezone

return this.getEvents(accessToken, startDate.toISOString(), endDate.toISOString(), 50);
```

**Impact:**
- "Upcoming events" query uses wrong date boundaries
- Events may be missing or duplicated based on user timezone
- Affects calendar synchronization and event reminders

**Fix:**
```typescript
// AFTER (Correct)
const startDate = new Date(now);
startDate.setUTCHours(0, 0, 0, 0);  // ✅ UTC timezone

const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
endDate.setUTCHours(23, 59, 59, 999);  // ✅ UTC timezone

return this.getEvents(accessToken, startDate.toISOString(), endDate.toISOString(), 50);
```

### 2. Memory Service - Calendar Tool (High Severity)

**File:** `src/services/memoryService.ts`
**Lines:** 726, 730

```typescript
// BEFORE (Incorrect)
const startDate = timeMin ? new Date(timeMin) : new Date(now);
if (!timeMin) startDate.setHours(0, 0, 0, 0);  // ❌ Local timezone

const lookaheadDays = days || 7;
const endDate = timeMax ? new Date(timeMax) : new Date(startDate.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);
if (!timeMax) endDate.setHours(23, 59, 59, 999);  // ❌ Local timezone

startISO = startDate.toISOString();
endISO = endDate.toISOString();
```

**Impact:**
- `calendar_action` tool with `action: "list"` returns wrong events
- Kayley may reference events that haven't happened yet or miss current events
- User asks "what's on my calendar today?" and gets wrong results

**Fix:**
```typescript
// AFTER (Correct)
const startDate = timeMin ? new Date(timeMin) : new Date(now);
if (!timeMin) startDate.setUTCHours(0, 0, 0, 0);  // ✅ UTC timezone

const lookaheadDays = days || 7;
const endDate = timeMax ? new Date(timeMax) : new Date(startDate.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);
if (!timeMax) endDate.setUTCHours(23, 59, 59, 999);  // ✅ UTC timezone

startISO = startDate.toISOString();
endISO = endDate.toISOString();
```

### 3. Gift Message Service (Medium Severity)

**File:** `src/services/idleLife/giftMessageService.ts`
**Line:** 134

```typescript
// BEFORE (Incorrect)
const twentyFourHoursAgo = new Date();
twentyFourHoursAgo.setHours(
  twentyFourHoursAgo.getHours() - MIN_HOURS_BETWEEN_GIFTS  // ❌ Uses getHours() (local)
);
```

**Impact:**
- Gift messages sent at wrong intervals for users in different timezones
- May send gifts too frequently or too infrequently
- Less severe than calendar bugs, but still incorrect behavior

**Fix:**
```typescript
// AFTER (Correct)
const twentyFourHoursAgo = new Date();
twentyFourHoursAgo.setUTCHours(
  twentyFourHoursAgo.getUTCHours() - MIN_HOURS_BETWEEN_GIFTS  // ✅ Uses getUTCHours() (UTC)
);
```

**Or better yet, use milliseconds directly:**
```typescript
// BEST (Most clear and no timezone issues)
const twentyFourHoursAgo = new Date(Date.now() - MIN_HOURS_BETWEEN_GIFTS * 60 * 60 * 1000);
```

### 4. Test Files (Low Severity - Test Quality Issue)

**File:** `src/services/tests/userPatterns.test.ts`
**Lines:** 254, 260, 266, 272, 278

```typescript
// Test code using local timezone
const morning = new Date();
morning.setHours(8, 0, 0, 0);  // ⚠️ Test-only, but still misleading
expect(getTimeOfDay(morning)).toBe("morning");
```

**Impact:**
- Tests may pass in one timezone but fail in another
- Doesn't directly affect users, but reduces test reliability

**Fix:**
```typescript
// Use UTC for consistent test behavior
const morning = new Date();
morning.setUTCHours(8, 0, 0, 0);  // ✅ Consistent across all timezones
expect(getTimeOfDay(morning)).toBe("morning");
```

## Previously Fixed

The following file was fixed in the previous timezone bug resolution:

✅ **`src/services/conversationHistoryService.ts`** (lines 149, 176, 209)
- Fixed in: `docs/archive/bugs/interaction-id-timezone-bug_RESOLVED.md`
- All three functions (`getTodaysMessageCount`, `loadTodaysConversationHistory`, `getTodaysInteractionId`) now use `setUTCHours()`

## Detection Strategy

### Find All .toISOString() Calls
```bash
# Found 33 files with .toISOString() usage
grep -r "\.toISOString()" src/services/*.ts
```

### Find Potential Bugs
Look for this pattern:
```typescript
// PATTERN TO FIND:
date.setHours(...)
// ... followed by ...
.toISOString()
```

**Strategy:**
1. Search for all `setHours(` in service files
2. Check if the Date is later converted with `.toISOString()`
3. If yes, change to `setUTCHours()`

## Recommended Fix Strategy

### Phase 1: High Priority (Critical User Impact)
1. ✅ Fix `calendarService.ts:176, 180` - Calendar event queries
2. ✅ Fix `memoryService.ts:726, 730` - Calendar tool for AI

### Phase 2: Medium Priority (Moderate Impact)
3. ✅ Fix `giftMessageService.ts:134` - Gift message intervals

### Phase 3: Low Priority (Test Quality)
4. ✅ Fix `userPatterns.test.ts:254, 260, 266, 272, 278` - Test consistency

### Phase 4: Create Utility Function (Prevention)
5. Create date utility helpers to prevent future bugs:

```typescript
// src/utils/dateHelpers.ts
/**
 * Get start of day in UTC (00:00:00.000Z)
 */
export function getStartOfDayUTC(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of day in UTC (23:59:59.999Z)
 */
export function getEndOfDayUTC(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * Validate that a Date is valid before calling .toISOString()
 */
export function isValidDate(date: unknown): date is Date {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Safely convert Date to ISO string, returns null if invalid
 */
export function toISOStringOrNull(date: Date | undefined | null): string | null {
  return date && isValidDate(date) ? date.toISOString() : null;
}

/**
 * Subtract hours from a date (UTC-safe)
 */
export function subtractHours(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 60 * 60 * 1000);
}
```

**Benefits:**
- Explicit UTC behavior in function names
- Prevents accidental use of local timezone
- Easier to understand intent
- Reduces code duplication

### Phase 5: Add ESLint Rule (Prevention)
```json
// .eslintrc.json
{
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "MemberExpression[object.type='Identifier'][property.name='setHours']",
        "message": "Use setUTCHours() instead of setHours() to avoid timezone bugs when using toISOString()"
      }
    ]
  }
}
```

## Testing Plan

### Unit Tests

1. **Test timezone-agnostic behavior**
   ```typescript
   it('should get start of day in UTC regardless of local timezone', () => {
     const date = new Date('2026-01-15T08:00:00+08:00');  // UTC+8
     const startOfDay = getStartOfDayUTC(date);
     expect(startOfDay.toISOString()).toBe('2026-01-15T00:00:00.000Z');
   });

   it('should get end of day in UTC regardless of local timezone', () => {
     const date = new Date('2026-01-15T08:00:00-05:00');  // UTC-5
     const endOfDay = getEndOfDayUTC(date);
     expect(endOfDay.toISOString()).toBe('2026-01-15T23:59:59.999Z');
   });
   ```

2. **Test calendar queries with different timezones**
   ```typescript
   it('should query correct date range for upcoming events in UTC+8', async () => {
     // Mock system timezone to UTC+8
     const events = await calendarService.getUpcomingEvents(accessToken);
     // Verify date range is correct in UTC
   });
   ```

### Manual Testing

1. Change system timezone to UTC+8 (Asia/Shanghai)
2. Query "what's on my calendar today?"
3. Verify results only include today's events, not yesterday's
4. Change timezone to UTC-5 (America/New_York)
5. Repeat verification

## Prevention Guidelines

**For all future date operations:**

1. ✅ **DO:** Use `setUTCHours()` when date will be converted to ISO string
2. ✅ **DO:** Use utility functions like `getStartOfDayUTC()` for clarity
3. ✅ **DO:** Use millisecond arithmetic when possible (most clear)
4. ❌ **DON'T:** Mix `setHours()` (local) with `.toISOString()` (UTC)
5. ❌ **DON'T:** Use local timezone methods when data is stored in Supabase (always UTC)

**Golden Rule:**
> If a Date object will be converted to ISO string for Supabase storage or API calls, ALL operations on that Date must use UTC methods.

## Related Documentation

- **Previous Fix:** `docs/archive/bugs/interaction-id-timezone-bug_RESOLVED.md`
- **Invalid Date Fix:** `docs/bugs/multiple_task_creation_invalid_date_error.md`
- **Supabase Docs:** All timestamps are stored in UTC (timestamp with time zone)

## Summary

This is a **systemic issue** that affects multiple services. The core problem is mixing local timezone operations (`setHours()`) with UTC output (`.toISOString()`). The fix is straightforward but requires careful auditing of all date operations in the codebase.

**Priority:** High - Calendar bugs directly impact user experience and data accuracy.

**Estimated Effort:**
- 4 file changes (3 services + 1 test file)
- Create utility module with date helpers
- Add ESLint rule
- Update tests
- Total: ~2 hours

**Risk:** Low - Changes are isolated and well-understood. Tests will verify correctness.
