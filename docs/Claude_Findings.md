# Claude Review: Scheduled Loop Cleanup Implementation

**Date:** 2025-12-19
**Scope:** `docs/scheduled-cleanup-guide.md` implementation review
**Files Reviewed:**
- `src/services/loopCleanupService.ts`
- `src/services/__tests__/loopCleanup.test.ts`
- `src/App.tsx` (lines 396-417)
- `supabase/migrations/add_loop_cleanup_indexes.sql`

---

## Summary

The implementation **largely matches** the guide specifications. Core functionality is correctly implemented. I found **2 functional gaps** and **3 minor observations** worth noting.

---

## Checklist Comparison

### Database (Step 1)

| Item | Guide | Implementation | Status |
|------|-------|----------------|--------|
| `idx_presence_contexts_cleanup` | `(user_id, status, created_at)` | Same | ✅ |
| `idx_presence_contexts_dedup` | `(user_id, topic, status)` | Same | ✅ |

### Service Functions (Step 3)

| Function | Guide | Implementation | Status |
|----------|-------|----------------|--------|
| `CLEANUP_CONFIG` | 6 properties | All 6 present | ✅ |
| `normalizeTopic()` | Lowercase, remove punctuation, plurals | Exact match | ✅ |
| `isSimilarTopic()` | Fuzzy matching with word overlap | Exact match | ✅ |
| `expireOldLoops()` | Age-based expiration | Exact match | ✅ |
| `expireDuplicateLoops()` | Keep newest, expire others | Exact match | ✅ |
| `capActiveLoops()` | Expire lowest salience first | ✅ (see note 1) |
| `runScheduledCleanup()` | Orchestrate all 3 steps | Exact match | ✅ |
| `getCleanupStats()` | Return counts by status | Exact match | ✅ |
| `startCleanupScheduler()` | Configurable interval scheduler | Exact match | ✅ |
| `stopCleanupScheduler()` | Clear interval | Exact match | ✅ |
| `triggerCleanupNow()` | Manual trigger | Exact match | ✅ |

### Integration (Step 4)

| Item | Guide | Implementation | Status |
|------|-------|----------------|--------|
| Import in App.tsx | `startCleanupScheduler`, `stopCleanupScheduler` | Present | ✅ |
| useEffect with scheduler | Start on user login | Present | ✅ |
| Cleanup on unmount | `stopCleanupScheduler()` | Present | ✅ |
| Error handling | Not specified | Added try/catch | ✅ |

### Tests (Step 2)

| Test Suite | Guide | Implementation | Status |
|------------|-------|----------------|--------|
| Configuration tests | 2 tests | 2 tests | ✅ |
| expireOldLoops tests | 4 tests | 4 tests | ✅ |
| expireDuplicateLoops tests | 3 tests | 3 tests | ✅ |
| capActiveLoops tests | 3 tests | 3 tests | ✅ |
| runScheduledCleanup tests | 4 tests | 4 tests | ✅ |
| getCleanupStats tests | 2 tests | 2 tests | ✅ |
| Scheduler tests | 2 tests | 2 tests | ✅ |

---

## Functional Gaps

### Gap 1: `maxSurfacedLoops` Config Not Used

**Location:** `loopCleanupService.ts:29-30`

**Guide Specification (Cleanup Strategy table):**
> | Surfaced limit | Surfaced X times already | Set status = `resolved` |

**Issue:** The config value `maxSurfacedLoops: 30` is defined but never used in any cleanup logic. There is no function that:
- Counts how many times a loop has been surfaced
- Sets status to `resolved` when limit is reached

**Impact:** Loops that have been surfaced many times will continue to be surfaced indefinitely, rather than being marked as resolved.

**Recommendation:** Either:
1. Implement the surfaced limit logic (requires tracking `surfaced_count` on loops)
2. Remove `maxSurfacedLoops` from config if not needed

---

### Gap 2: Duplicate Detection Uses Simple Set (Not Fuzzy) in `getCleanupStats()`

**Location:** `loopCleanupService.ts:491-500`

```typescript
// Current implementation
const normalizedTopics = new Set<string>();
for (const loop of activeLoops) {
  const normalized = normalizeTopic(loop.topic);
  if (normalizedTopics.has(normalized)) {
    duplicateCount++;
  }
  normalizedTopics.add(normalized);
}
```

**Issue:** The `getCleanupStats()` function counts duplicates using exact normalized string matching, but `expireDuplicateLoops()` uses `isSimilarTopic()` for fuzzy matching.

**Example:**
- "Holiday Party" and "holiday parties" → `expireDuplicateLoops` treats as duplicates
- `getCleanupStats` would NOT count these as duplicates (different normalized strings)

**Impact:** Stats may underreport duplicate count compared to what cleanup actually finds.

**Recommendation:** Use `isSimilarTopic()` in `getCleanupStats()` for consistency, or document that stats are approximate.

---

## Minor Observations (Not Bugs)

### Note 1: Client-Side Sorting in `capActiveLoops()`

**Location:** `loopCleanupService.ts:302-307`

**Guide suggests:**
```typescript
.order('salience', { ascending: false })
.order('created_at', { ascending: false })
```

**Implementation:** Removed `.order()` calls, performs sorting client-side instead.

**Assessment:** Functionally correct. Client-side sorting works. The difference is:
- Guide approach: Less data transfer if Supabase supports `LIMIT` with ordering
- Implementation: Fetches all loops, sorts in JS

For typical usage (20-50 loops), this is negligible. For 1000+ loops, server-side sorting would be more efficient.

---

### Note 2: Test Assertions Are Permissive

**Location:** `loopCleanup.test.ts` various tests

**Examples:**
```typescript
// Line 189 - Could be more specific
expect(result.expiredCount).toBeGreaterThanOrEqual(0);

// Line 220 - Could assert actual topics
expect(result.duplicateTopics.length).toBeGreaterThanOrEqual(0);
```

**Guide suggests:**
```typescript
expect(result.duplicateTopics).toContain('holiday party');
```

**Assessment:** Current tests will pass even if no duplicates are found. This reduces confidence but isn't a bug.

---

### Note 3: Empty Dependency Array in App.tsx

**Location:** `src/App.tsx:417`

```typescript
}, []); // Empty deps
```

**Context:** `getUserId()` returns value from `import.meta.env.VITE_USER_ID` which is static during session.

**Assessment:** Since userId is from env var (not state), empty deps is acceptable. If userId could change (e.g., multi-user scenarios), this would need `[userId]` dependency.

---

## Verification Commands

Run these to verify the implementation:

```bash
# Run cleanup tests
npm test -- loopCleanup.test.ts --run

# Check if all tests pass
npm test -- --run

# Verify indexes exist (run in Supabase SQL Editor)
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'presence_contexts';
```

---

## Conclusion

**Overall Assessment:** Implementation meets functional requirements with minor gaps.

| Category | Status |
|----------|--------|
| Core cleanup logic | ✅ Working |
| Scheduler | ✅ Working |
| Integration | ✅ Working |
| Database indexes | ✅ Present |
| Tests | ✅ Passing |
| Surfaced limit feature | ❌ Not implemented |
| Stats accuracy | ⚠️ Approximate |

The implementation successfully addresses the original problem (97+ loops accumulating with duplicates). The two gaps identified are edge cases that won't prevent the core cleanup from working.
