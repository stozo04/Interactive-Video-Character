# Bug: Interaction ID Timezone Issue - Reusing Yesterday's Conversation ID

**Date Reported:** 2026-01-14
**Date Fixed:** 2026-01-14
**Severity:** High (prevents app from working)
**Status:** ✅ RESOLVED

## Resolution

**Fixed by:** Claude Code
**Date:** 2026-01-14
**Files Modified:** `src/services/conversationHistoryService.ts`

### Changes Applied

Changed all three date calculation functions to use UTC-based date operations:

1. **`getTodaysMessageCount()`** (line 149)
   - Changed: `today.setHours(0, 0, 0, 0)` → `today.setUTCHours(0, 0, 0, 0)`

2. **`loadTodaysConversationHistory()`** (line 176)
   - Changed: `today.setHours(0, 0, 0, 0)` → `today.setUTCHours(0, 0, 0, 0)`

3. **`getTodaysInteractionId()`** (line 209)
   - Changed: `today.setHours(0, 0, 0, 0)` → `today.setUTCHours(0, 0, 0, 0)`

### Result

All date calculations now consistently use UTC, matching Supabase's timestamp storage format. The app correctly identifies "today's" messages regardless of user timezone.

---

## Summary

When selecting a character, the app attempts to reuse yesterday's conversation/interaction ID instead of creating a new one for today. This causes Gemini API to reject the request with a 400 error: "Invalid turn token" because Gemini only allows conversation IDs to be used for 24 hours.

## Error Details

### Console Error
```
POST http://localhost:3000/api/google/v1beta/interactions?key=... 400 (Bad Request)

Gemini Non-Greeting Error: Error: Proxy error: Bad Request - {
  "error": {
    "message": "Invalid turn token: 0a209b96-280a-4d22-bf0c-b015c0b3b30d",
    "code": "invalid_request"
  }
}
```

### Console Logs Showing the Issue
```
App.tsx:917 🧠 [App] Starting FRESH session - AI will use memory tools for context
App.tsx:940 🔗 [App] Restoring today's interaction ID: 0a209b96-280a-4d22-bf0c-b015c0b3b30d
App.tsx:1012 🧠 [App] Chat detected today (1 messages) - reloading history and generating non-greeting
geminiChatService.ts:1555 🔗 [GeminiService] Restoring continuity for Non-Greeting: 0a209b96-280a-4d22-bf0c-b015c0b3b30d
```

The app thinks it's restoring "today's" interaction ID, but that ID is actually from yesterday and has expired.

## Root Cause

The bug is in `src/services/conversationHistoryService.ts` in three functions:

1. `getTodaysInteractionId()` (lines 208-209)
2. `getTodaysMessageCount()` (lines 148-149)
3. `loadTodaysConversationHistory()` (lines 175-176)

All three use this problematic pattern:

```typescript
const today = new Date();
today.setHours(0, 0, 0, 0);
// ... then later ...
.gte("created_at", today.toISOString())
```

### The Problem

**`setHours()` operates in the LOCAL timezone, but `toISOString()` converts to UTC.**

This causes a date shift for users in timezones ahead of UTC.

### Example Scenario (User in UTC+8)

1. Current time: January 14, 2026, 08:00 AM (UTC+8)
2. `new Date()` creates: `2026-01-14T08:00:00+08:00`
3. `setHours(0, 0, 0, 0)` sets: `2026-01-14T00:00:00+08:00` (local midnight)
4. `toISOString()` converts to: `2026-01-13T16:00:00.000Z` (UTC)
5. Query looks for messages >= January 13, 16:00 UTC
6. **Messages from January 13, 20:00 UTC onwards are included as "today"**
7. But those messages are actually from **yesterday** (January 13)!
8. Yesterday's interaction ID gets restored
9. Gemini rejects it (>24 hours old) ❌

### Affected Timezones

This bug affects users in timezones UTC+1 and higher, including:
- Europe (UTC+1 to UTC+3)
- Middle East (UTC+3 to UTC+4)
- Asia (UTC+5 to UTC+9)
- Australia (UTC+8 to UTC+11)
- New Zealand (UTC+12)

## Fix

Replace `setHours(0, 0, 0, 0)` with `setUTCHours(0, 0, 0, 0)` to ensure consistent UTC-based date calculations.

### Code Changes Required

**File:** `src/services/conversationHistoryService.ts`

#### 1. Fix `getTodaysMessageCount()` (line 148-149)

**Before:**
```typescript
const today = new Date();
today.setHours(0, 0, 0, 0);
```

**After:**
```typescript
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
```

#### 2. Fix `loadTodaysConversationHistory()` (line 175-176)

**Before:**
```typescript
const today = new Date();
today.setHours(0, 0, 0, 0);
```

**After:**
```typescript
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
```

#### 3. Fix `getTodaysInteractionId()` (line 208-209)

**Before:**
```typescript
const today = new Date();
today.setHours(0, 0, 0, 0);
```

**After:**
```typescript
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
```

## Impact

- **User Experience:** App fails to load character, cannot start conversation
- **Frequency:** Happens every day for users in affected timezones
- **Workaround:** None (user cannot use the app until midnight local time when the old messages truly expire from Supabase)

## Testing After Fix

1. Test with system timezone set to UTC+8 (e.g., Asia/Shanghai)
2. Create a conversation on day 1
3. Wait until day 2 (or manually change system date)
4. Select character and verify:
   - ✅ New interaction ID is created (not yesterday's ID)
   - ✅ No "Invalid turn token" error
   - ✅ Character loads successfully

## Related Code Locations

- `src/App.tsx` line 938: Calls `getTodaysInteractionId()`
- `src/App.tsx` line 925: Calls `getTodaysMessageCount()`
- `src/App.tsx` line 1014: Calls `loadTodaysConversationHistory()`
- `src/services/conversationHistoryService.ts`: All three functions

## Notes

- This bug was likely present since the interaction ID restoration feature was implemented
- It only manifests for users in timezones ahead of UTC
- The "promises" commit from 2026-01-13 did not introduce this bug, but may have made it more visible due to changes in the app flow
- Supabase stores all timestamps in UTC, so all date comparisons must also use UTC
