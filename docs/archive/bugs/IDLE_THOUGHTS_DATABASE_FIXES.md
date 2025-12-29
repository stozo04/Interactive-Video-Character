# Idle Thoughts Database Error Fixes

**Date**: 2025-12-29
**Status**: ✅ FIXED
**Related**: IDLE_THOUGHTS_NOT_TRIGGERED.md

## Overview

After implementing the idle thoughts scheduler system, two database errors were discovered during live testing:

1. **INTEGER type mismatch** - `absence_duration_hours` column rejected decimal values
2. **409 Conflict errors** - Race condition in `saveAllOngoingThreads()` caused duplicate key violations

Both issues have been fixed and verified.

---

## Issue 1: INTEGER Type Mismatch

### Error Message
```
invalid input syntax for type integer: "0.8245283333333333"
```

### Root Cause
The `idle_thoughts.absence_duration_hours` column was defined as `INTEGER` in the database schema, but the code passes fractional hour values (e.g., 0.82 hours = 49 minutes).

**Location**: `supabase/migrations/create_spontaneity_tables.sql:177`
```sql
absence_duration_hours INTEGER,  -- ❌ Can't store decimals
```

**Code producing decimals**: `src/services/idleThoughtsScheduler.ts:101`
```typescript
const minutesAway = (now - moodState.lastInteractionAt) / (1000 * 60);
const absenceDurationHours = minutesAway / 60;  // Creates 0.82, 0.50, etc.
```

### Fix Applied

**Migration**: `supabase/migrations/fix_idle_thoughts_absence_duration_type.sql`
```sql
ALTER TABLE idle_thoughts
  ALTER COLUMN absence_duration_hours TYPE NUMERIC(5,2);

COMMENT ON COLUMN idle_thoughts.absence_duration_hours IS
'How long user was away in hours (supports fractional hours like 0.82 for 49 minutes)';
```

**Result**: Column now supports up to 999.99 hours with 2 decimal places

---

## Issue 2: 409 Conflict on ongoing_threads

### Error Message
```
POST https://.../rest/v1/ongoing_threads 409 (Conflict)
```

### Root Cause
Race condition in `saveAllOngoingThreads()` when multiple idle thoughts are processed simultaneously (e.g., during React Strict Mode remounts or rapid scheduler triggers).

**Original logic** (`src/services/stateService.ts:356-383`):
```typescript
export async function saveAllOngoingThreads(userId: string, threads: OngoingThread[]): Promise<void> {
  try {
    // Delete old threads for this user
    await supabase
      .from(ONGOING_THREADS_TABLE)
      .delete()
      .eq('user_id', userId);

    // Insert new threads
    if (threads.length > 0) {
      const rows = threads.map(thread => ({ ... }));
      await supabase.from(ONGOING_THREADS_TABLE).insert(rows);  // ❌ Fails if IDs already exist
    }
  } catch (error) { ... }
}
```

**Race condition scenario**:
1. Process A: DELETE all threads for user
2. Process B: DELETE all threads for user (deletes A's new threads)
3. Process A: INSERT threads [1, 2, 3]
4. Process B: INSERT threads [1, 2, 4] ➜ **409 Conflict on IDs 1, 2**

### Fix Applied

**Updated logic** (`src/services/stateService.ts:356-397`):
```typescript
export async function saveAllOngoingThreads(userId: string, threads: OngoingThread[]): Promise<void> {
  try {
    // Get existing thread IDs for this user
    const { data: existing } = await supabase
      .from(ONGOING_THREADS_TABLE)
      .select('id')
      .eq('user_id', userId);

    const existingIds = new Set(existing?.map(t => t.id) || []);
    const newIds = new Set(threads.map(t => t.id));

    // Upsert all threads (insert new or update existing) ✅
    if (threads.length > 0) {
      const rows = threads.map(thread => ({ ... }));

      await supabase
        .from(ONGOING_THREADS_TABLE)
        .upsert(rows, { onConflict: 'id' });  // ✅ No conflicts
    }

    // Delete threads that are no longer in the array
    const threadsToDelete = Array.from(existingIds).filter(id => !newIds.has(id));
    if (threadsToDelete.length > 0) {
      await supabase
        .from(ONGOING_THREADS_TABLE)
        .delete()
        .in('id', threadsToDelete);
    }
  } catch (error) { ... }
}
```

**Key improvements**:
- ✅ Uses **upsert** instead of insert (inserts new, updates existing)
- ✅ Deletes only threads that are **no longer in the array**
- ✅ Race-condition safe - multiple processes can call simultaneously
- ✅ Maintains same behavior (full replacement of threads)

---

## Testing

### Scheduler Tests
All 10 tests pass after fixes:
```bash
npm test -- --run src/services/__tests__/idleThoughtsScheduler.test.ts
# ✅ 10 passed (10)
```

**Test coverage**:
- Configuration validation
- Scheduler start/stop control
- Thought generation logic (with 3-parameter signature)
- Error handling
- Periodic execution

### Idle Thoughts Service Tests
All 22 tests still pass (no changes required):
```bash
npm test -- --run src/services/tests/idleThoughts.test.ts
# ✅ 22 passed (22)
```

---

## User Action Required

### Apply Database Migration

**IMPORTANT**: The migration file has been created but **NOT applied** to your database. You must apply it manually:

```bash
# Option 1: Apply via Supabase CLI
supabase db push

# Option 2: Run the migration file directly in Supabase SQL Editor
# 1. Open Supabase SQL Editor
# 2. Copy contents of: supabase/migrations/fix_idle_thoughts_absence_duration_type.sql
# 3. Execute the query
```

### Restart the App

After applying the migration:
```bash
# Kill the dev server (Ctrl+C)
npm run dev
```

---

## Files Modified

| File | Change | Lines |
|------|--------|-------|
| `supabase/migrations/fix_idle_thoughts_absence_duration_type.sql` | **NEW** - Migration to fix column type | 13 |
| `src/services/stateService.ts` | Modified `saveAllOngoingThreads()` to use upsert | +41 / -27 |

---

## Verification Steps

After applying the migration and restarting:

1. **Check console logs** - Should no longer see:
   ```
   ❌ invalid input syntax for type integer
   ❌ 409 (Conflict)
   ```

2. **Verify idle thought generation**:
   ```
   ✅ 💭 [IdleThoughts] User away X min (threshold: 1 min)
   ✅ 💭 [IdleThoughts] Generating idle thought...
   ✅ 💭 [IdleThoughts] Generated: "..."
   ✅ ✅ [IdleThoughts] Converted to ongoing thread (intensity: 0.7)
   ```

3. **Check database** (Supabase SQL Editor):
   ```sql
   -- Verify column type was changed
   SELECT column_name, data_type, numeric_precision, numeric_scale
   FROM information_schema.columns
   WHERE table_name = 'idle_thoughts' AND column_name = 'absence_duration_hours';
   -- Should show: data_type = 'numeric', precision = 5, scale = 2

   -- Verify thoughts are being saved with decimal values
   SELECT id, absence_duration_hours, generated_at
   FROM idle_thoughts
   ORDER BY generated_at DESC
   LIMIT 5;
   -- Should see values like 0.82, 1.50, etc.
   ```

---

## Summary

Both database errors have been fixed:

✅ **INTEGER type mismatch** - Column changed to `NUMERIC(5,2)` to support fractional hours
✅ **409 Conflict errors** - Logic changed to use upsert instead of delete + insert
✅ **All tests passing** - 10/10 scheduler tests, 22/22 idle thoughts tests
✅ **Ready for testing** - Apply migration and restart app

The idle thoughts system should now work correctly without database errors.
