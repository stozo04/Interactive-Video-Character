# Calendar Data in Intent Detection - RESOLVED

**Resolution Date:** 2026-01-13  
**Status:** ✅ Fixed

## Problem
Calendar data (~1500-2000 chars) was being included in intent detection prompts unnecessarily, causing:
- Bloated payloads (~5600 chars instead of ~3000 chars)
- Higher token costs (~400 extra tokens per calendar query)
- Potential confusion in intent analysis (LLM seeing event IDs, timestamps, etc.)

## Root Cause
In `messageOrchestrator.ts`, calendar data was appended to the user message:

```typescript
// Before fix:
let textToSend = userMessage;
if (calendarContext) {
  textToSend = `${userMessage}\n\n[LIVE CALENDAR DATA - ${upcomingEvents.length} EVENTS:\n${calendarContext}]`;
}

// This enriched message was sent to AI service
const content = { type: 'text', text: textToSend };

// AI service passed this bloated message to intent detection
intentPromise = detectFullIntentLLMCached(textToSend, context);
```

**The issue:** Intent detection only needs to know the user asked about their calendar, not the actual calendar data. The calendar data is only needed for the main chat response.

## Solution Implemented
Added architecture to separate clean message (for intent) from enriched message (for main chat):

### 1. Added `originalMessageForIntent` to AIChatOptions
**File:** `src/services/aiService.ts`

```typescript
export interface AIChatOptions {
  // ... existing fields
  
  /**
   * Original user message (before enrichment with calendar/email data).
   * Used for intent detection to keep payload small.
   * If not provided, falls back to using the main input message.
   */
  originalMessageForIntent?: string;
}
```

### 2. Updated Gemini Service to use original message
**File:** `src/services/geminiChatService.ts`

```typescript
// Extract clean message for intent detection
const messageForIntent = options.originalMessageForIntent || userMessageText;

// Use clean message for intent detection
const trimmedMessageForIntent = messageForIntent.trim();
if (trimmedMessageForIntent && trimmedMessageForIntent.length > 5) {
  intentPromise = detectFullIntentLLMCached(
    trimmedMessageForIntent,  // ← CLEAN message
    conversationContext
  );
}
```

### 3. Updated Orchestrator to pass original message
**File:** `src/services/messageOrchestrator.ts`

```typescript
// Build enriched message for main chat
let textToSend = userMessage;
if (calendarContext) {
  textToSend = `${userMessage}\n\n[LIVE CALENDAR DATA...]`;
}

// Pass BOTH versions to AI service
const content = { type: 'text', text: textToSend };  // Enriched for main chat
const options = {
  originalMessageForIntent: calendarContext ? userMessage : undefined,  // Clean for intent
  // ... other options
};
```

## Architecture After Fix

```
User message: "Any big plans tonight?"
    ↓
    ├→ Intent Detection: "Any big plans tonight?" (CLEAN - ~3000 chars)
    │  └→ Result: tone=neutral, topic=calendar
    │
    └→ Main Chat: "Any big plans tonight?\n\n[CALENDAR DATA...]" (ENRICHED - ~5000 chars)
       └→ Response: "Yeah! You've got Dr. Gomez at 2pm..."
```

## Results
### Payload Reduction
- **Intent detection before:** ~5600 chars (~1400 tokens)
- **Intent detection after:** ~3000 chars (~750 tokens)
- **Savings:** 40% reduction on calendar queries

### Combined with Previous Optimization
- **Original intent payload:** 5638 chars (~1410 tokens)
- **After removing user facts:** 3938 chars (~985 tokens)
- **After removing calendar data:** ~3000 chars (~750 tokens)
- **Total reduction:** **47% smaller** (from 1410 → 750 tokens)

### Benefits
- ✅ Intent detection is faster (smaller payload)
- ✅ More accurate intent analysis (less noise)
- ✅ ~650 fewer tokens per calendar query
- ✅ Main chat still gets full calendar context when needed
- ✅ Clean separation of concerns

## Testing
To verify the fix works:
1. Ask a calendar question: "What's on my calendar today?"
2. Check browser console logs
3. Intent detection should show clean message without `[LIVE CALENDAR DATA...]`
4. Main chat response should still have accurate calendar info

## Files Modified
- `src/services/aiService.ts` - Added `originalMessageForIntent` field
- `src/services/geminiChatService.ts` - Use original message for intent detection
- `src/services/messageOrchestrator.ts` - Pass original message when calendar enrichment occurs

## Related
- Previous optimization: `docs/bugs/truncated_intent_json_RESOLVED.md`
- Intent service: `src/services/intentService.ts`
