# Bug: Gemini Confuses "Who Said What" in Conversation

**Status:** Resolved
**Date Reported:** 2025-12-29
**Date Resolved:** 2025-12-29
**Severity:** Medium
**Component:** `src/services/geminiChatService.ts`

---

## Summary

Kayley incorrectly asked the user "Still hungry for sushi?" when **Kayley** was the one eating sushi, not the user. The model confused who said what in the conversation history.

---

## Symptoms

- User (Steven) went to the gym while Kayley was planning to eat sushi
- Previous conversation clearly showed:
  - **Kayley**: "Sushi and a comfort show rewatch, for sure."
  - **User**: "You enjoy your 'not again' sushi!"
  - **Kayley**: "I absolutely will!"
- After user returned from gym, Kayley responded: "Still hungry for sushi?"
- This incorrectly implied the **user** was eating sushi, not Kayley

---

## Root Cause Analysis

### The Problem

The Gemini Interactions API payload was missing explicit conversation history. When the model called the `recall_user_info` tool, the continuation payload only contained:

```json
{
  "model": "gemini-3-flash-preview",
  "previous_interaction_id": "abc123",
  "input": [
    {"type": "function_result", "name": "recall_user_info", "result": "name: Steven"}
  ],
  "system_instruction": "...",
  "tools": [...]
}
```

**No conversation history was included.** The model relied entirely on Gemini's server-side cached state via `previous_interaction_id`, which was unreliable for tracking speaker attribution.

### Why This Happened

1. **History parameter was passed but never used**: The `callProviderWithInteractions()` method received a `history` parameter but ignored it entirely.

2. **Tool continuation had no context**: The `continueInteractionWithTools()` method sent tool results without any conversation context, forcing the model to infer from stale cached state.

3. **Dead code**: A `convertToGeminiHistory()` function existed but was never called.

### Code Location

**File:** `src/services/geminiChatService.ts`

**Problematic code (before fix):**
```typescript
// Line 460-462 - History passed but never used
const interactionConfig: any = {
  model: this.model,
  input: input,  // Only current user message, no history
  system_instruction: systemPrompt,
};

// Line 350-356 - Tool continuation with no context
const toolInteractionConfig = {
  model: this.model,
  previous_interaction_id: interaction.id,
  input: toolResults,  // Only tool results, no conversation context
  system_instruction: systemPrompt,
  tools: interactionConfig.tools,
};
```

---

## Resolution

### Changes Made

#### 1. Added `formatHistoryForInput()` helper function (lines 172-223)

Formats the last 20 conversation messages with clear speaker labels:

```typescript
function formatHistoryForInput(history: ChatMessage[], limit: number = 20): any[] {
  // Filter and format messages
  const conversationText = chronological
    .map((msg) => {
      const speaker = msg.role === "user" ? "User" : "Kayley";
      return `${speaker}: ${msg.text}`;
    })
    .join("\n");

  return [
    {
      type: "text",
      text: `[RECENT CONVERSATION CONTEXT - Use this to understand who said what]\n${conversationText}\n[END CONTEXT]\n\nNow respond to the current message:`,
    },
  ];
}
```

#### 2. Updated `callProviderWithInteractions()` (lines 510-519)

Now prepends conversation history to every non-first message:

```typescript
// Format conversation history for context (last 20 messages)
const historyContext = formatHistoryForInput(history as ChatMessage[], 20);

// Combine history context with current user message
const input = [...historyContext, ...userInput];
```

#### 3. Updated `continueInteractionWithTools()` (lines 361, 367-368, 419)

Added `history` parameter and includes history context when sending tool results:

```typescript
private async continueInteractionWithTools(
  interaction: any,
  interactionConfig: any,
  systemPrompt: string,
  userId: string,
  history: any[],  // NEW PARAMETER
  options?: AIChatOptions,
  maxIterations: number = 3
): Promise<any> {
  // Format history once at the start
  const historyContext = formatHistoryForInput(history as ChatMessage[], 20);

  // Include history in tool continuation
  const toolInteractionConfig = {
    model: this.model,
    previous_interaction_id: interaction.id,
    input: [...historyContext, ...toolResults],  // History + tool results
    system_instruction: systemPrompt,
    tools: interactionConfig.tools,
  };
}
```

---

## Payload Comparison

### Before (Broken)
```json
{
  "input": [
    {"type": "function_result", "name": "recall_user_info", "result": "name: Steven"}
  ]
}
```

### After (Fixed)
```json
{
  "input": [
    {
      "type": "text",
      "text": "[RECENT CONVERSATION CONTEXT - Use this to understand who said what]\nUser: Going to gym!\nKayley: Sushi and a comfort show rewatch, for sure.\nUser: You enjoy your 'not again' sushi!\nKayley: I absolutely will!\nUser: *air hug*\nKayley: *Air hug* back! Catch you tomorrow, Steven!\n[END CONTEXT]\n\nNow respond to the current message:"
    },
    {"type": "function_result", "name": "recall_user_info", "result": "name: Steven"}
  ]
}
```

---

## Testing

1. TypeScript compilation passes for `geminiChatService.ts`
2. Manual testing recommended:
   - Have a conversation where Kayley mentions doing something
   - User does something else and returns later
   - Verify Kayley correctly remembers who was doing what

---

## Files Modified

| File | Changes |
|------|---------|
| `src/services/geminiChatService.ts` | Added `formatHistoryForInput()`, updated `callProviderWithInteractions()` and `continueInteractionWithTools()` to include conversation history |

---

## Lessons Learned

1. **Don't rely solely on stateful API caching**: Even when using `previous_interaction_id`, explicit context is more reliable than server-side state.

2. **Speaker attribution needs explicit labels**: The model needs clear "User:" and "Kayley:" labels to track who said what.

3. **Tool continuations need context**: After tool calls, the model loses context. Always re-include conversation history.

4. **Watch for unused parameters**: The `history` parameter was passed through the call stack but never used - a code smell that indicated missing functionality.

---

## Related Documentation

- `docs/completed_features/ChatHistory.md` - Chat history architecture
- `.claude/agents/chat-engine-specialist.md` - Chat engine domain knowledge
