# Bug Report: Idle Breaker "Missing text in content" Error

**Date Resolved:** 2025-12-29
**Severity:** High (blocked idle breaker functionality)
**Component:** `geminiChatService.ts`, `idleThoughtsScheduler.test.ts`

## Symptoms

When the idle breaker triggered, the following error occurred:

```
POST http://localhost:3000/api/google/v1beta/interactions?key=... 400 (Bad Request)

[IdleBreaker] Error: Error: Proxy error: Bad Request -
{"error":{"message":"Missing text in content of type text.","code":"invalid_request"}}
```

The error originated from:
- `geminiChatService.ts:280` - `createInteraction()`
- `BaseAIService.ts:643` - `triggerIdleBreaker()`

## Root Cause

### Primary Issue: Empty Text Message Rejected by Gemini API

In `BaseAIService.ts:645`, the idle breaker passes an empty text message to trigger Kayley to speak first:

```typescript
const { response, session: updatedSession } = await this.callProvider(
  combinedSystemPrompt,
  { type: 'text', text: '' }, // Empty trigger - she's initiating
  options.chatHistory || [],
  session
);
```

The `formatInteractionInput()` function in `geminiChatService.ts:148-150` then converted this to:

```javascript
[{ type: "text", text: "" }]
```

The Gemini Interactions API rejects content blocks with empty text, returning:
```json
{"error":{"message":"Missing text in content of type text.","code":"invalid_request"}}
```

### Secondary Issue: Failing Unit Tests

Two tests in `idleThoughtsScheduler.test.ts` were failing:
1. "should generate thought when user away >= 10 minutes"
2. "should handle case when generateIdleThought returns null"

**Causes:**
1. Mock was missing `MIN_ABSENCE_MINUTES_FOR_THOUGHT` export (became `undefined`)
2. Async `processIdleThought()` wasn't being awaited properly with fake timers
3. Using `runAllTimersAsync()` caused infinite loop due to the `setInterval`

## Solution

### Fix 1: Handle Empty Text in `formatInteractionInput()`

**File:** `src/services/geminiChatService.ts`

```typescript
function formatInteractionInput(userMessage: UserContent): any[] {
  if (userMessage.type === "text") {
    // Empty text triggers idle breaker - return empty array so AI speaks first
    if (!userMessage.text) {
      return [];
    }
    return [{ type: "text", text: userMessage.text }];
  }
  // ... rest of function
}
```

When text is empty, we now return an empty array `[]` instead of `[{ type: "text", text: "" }]`. This allows the API call to succeed, and the AI generates a response without user input (which is the intended behavior for idle breaker).

### Fix 2: Update Test Mocks and Timer Handling

**File:** `src/services/__tests__/idleThoughtsScheduler.test.ts`

1. Added missing export to mock:
```typescript
vi.mock('../spontaneity/idleThoughts', () => ({
  generateIdleThought: vi.fn(),
  MIN_ABSENCE_MINUTES_FOR_THOUGHT: 10, // Must include this export used by the scheduler
}));
```

2. Fixed async timing by stopping scheduler before flushing timers:
```typescript
startIdleThoughtsScheduler(userId);

// Stop scheduler to prevent interval from running, but immediate call is already in-flight
stopIdleThoughtsScheduler();

// Flush pending microtasks to let the already-started processIdleThought complete
await vi.runOnlyPendingTimersAsync();

expect(generateIdleThought).toHaveBeenCalledWith(userId, 0.25, 'neutral');
```

This approach:
- Starts the scheduler (which immediately fires `processIdleThought`)
- Stops the scheduler before the interval can fire again
- Uses `runOnlyPendingTimersAsync()` instead of `runAllTimersAsync()` to avoid infinite loop

## Files Changed

| File | Change |
|------|--------|
| `src/services/geminiChatService.ts` | Added empty text check in `formatInteractionInput()` |
| `src/services/__tests__/idleThoughtsScheduler.test.ts` | Fixed mock exports and timer handling |

## Verification

```bash
# Build succeeds
npm run build

# All 1197 tests pass
npm test -- --run
```

## Lessons Learned

1. **API Contract Awareness**: The Gemini Interactions API requires non-empty text for text content blocks. Empty arrays are acceptable for "AI speaks first" scenarios.

2. **Mock Completeness**: When mocking a module, ensure ALL exports used by the code under test are included in the mock, not just the functions being tested.

3. **Fake Timers with Intervals**: When testing code that uses `setInterval`, be careful with `runAllTimersAsync()` as it will run indefinitely. Use `runOnlyPendingTimersAsync()` or stop the interval before flushing timers.

## Related Documentation

- `docs/features/Idle_Thoughts_System.md` - Idle thoughts feature documentation
- `docs/completed_features/Idle_Breakers.md` - Idle breaker implementation details
