# Chat History Optimization Plan - Junior Developer Guide

## Overview

This plan optimizes conversation history management to reduce API costs by **90-95%**. Currently, every message sends a massive 1400+ line system prompt. We'll use stateful conversations so the system prompt is only sent once per conversation.

## Important Context: All AI Services

**Good News**: ChatGPT and Grok already support stateful conversations! They just use different names:
- **ChatGPT**: Uses `previous_response_id` (already implemented ✅)
- **Grok**: Uses `previous_response_id` (already implemented ✅)  
- **Gemini**: Currently using old API - needs migration to Interactions API with `previous_interaction_id`

**Architecture**: All services inherit from `BaseAIService.ts`, so we must ensure our changes don't break existing services.

---

## Current Problem (Gemini Only)

### What's Happening Now

Every time a user sends a message, `geminiChatService.ts` does this:

1. Calls `buildSystemPrompt()` which creates a **1400+ line prompt** including:
   - Full character profile
   - Relationship metrics
   - Memory tool instructions
   - Calendar events
   - Task list
   - Mood knobs, threads, callbacks
   - All behavioral rules

2. Sends this ENTIRE prompt to Gemini API on EVERY message
3. This costs thousands of tokens per message unnecessarily

### Current Code Location

**File**: `src/services/geminiChatService.ts`

**Lines 78-124** (the `callProvider` method):
```typescript
protected async callProvider(
  systemPrompt: string,  // ← This is 1400+ lines!
  userMessage: UserContent,
  history: any[],
  session?: AIChatSession
) {
  // ... builds chatConfig with systemInstruction ...
  
  const chat = ai.chats.create({  // ← OLD API
    model: this.model,
    config: chatConfig,
    history: historyToUse,
  });
  
  let result = await chat.sendMessage({
    message: messageParts,
  });
  // ...
}
```

---

## Solution: Use Gemini Interactions API

The new Interactions API supports **stateful conversations**:
- **First message**: Send system prompt + user message → get `interaction.id`
- **Subsequent messages**: Only send new message + `previous_interaction_id` → no system prompt needed!

### How Other Services Do It (Reference)

**ChatGPT** (`src/services/chatGPTService.ts` line 119-121):
```typescript
let response = await client.responses.create({
  model: MODEL,
  previous_response_id: session?.previousResponseId,  // ← Stateful!
  instructions: systemPrompt,  // ← Only sent if no previous_response_id
  // ...
});
```

**Grok** (`src/services/grokChatService.ts` line 87-89):
```typescript
providerOptions: {
  xai: {
    previous_response_id: session?.previousResponseId,  // ← Stateful!
  },
}
```

**Gemini** (needs update):
```typescript
// OLD (current):
const chat = ai.chats.create({ ... });  // ← No state management

// NEW (what we'll do):
const interaction = await client.interactions.create({
  previous_interaction_id: session?.interactionId,  // ← Stateful!
  // ...
});
```

---

## Step-by-Step Implementation

### Step 1: Update Type Definitions

**File**: `src/services/aiService.ts`

**Current** (line 38-43):
```typescript
export interface AIChatSession {
  userId: string;
  model?: string;
  previousResponseId?: string;  // ← Used by ChatGPT/Grok
  geminiHistory?: any[];
}
```

**Change to**:
```typescript
export interface AIChatSession {
  userId: string;
  model?: string;
  previousResponseId?: string;  // ← Keep for ChatGPT/Grok compatibility
  interactionId?: string;       // ← NEW: For Gemini Interactions API
  geminiHistory?: any[];         // ← Can remove later if not needed
}
```

**Why**: 
- `previousResponseId` is already used by ChatGPT/Grok - don't break them!
- `interactionId` is the Gemini equivalent
- Both can coexist in the same session object

---

### Step 2: Add Feature Flag (Safety First!)

**File**: `src/services/geminiChatService.ts`

**Add at top** (around line 18):
```typescript
// Feature flag for Interactions API (beta)
const USE_INTERACTIONS_API = import.meta.env.VITE_USE_GEMINI_INTERACTIONS_API === 'true';
```

**Why**: Allows gradual rollout and easy rollback if issues occur.

---

### Step 3: Create Helper Function for Input Formatting

**File**: `src/services/geminiChatService.ts`

**Add new function** (after `convertToGeminiHistory`, around line 46):

```typescript
/**
 * Convert user message to Interactions API input format
 * Supports text, audio, and image_text types
 */
function formatInteractionInput(userMessage: UserContent): any[] {
  if (userMessage.type === 'text') {
    return [{ type: 'text', text: userMessage.text }];
  } else if (userMessage.type === 'audio') {
    return [{
      type: 'audio',
      data: userMessage.data,
      mime_type: userMessage.mimeType
    }];
  } else if (userMessage.type === 'image_text') {
    return [
      { type: 'text', text: userMessage.text },
      {
        type: 'image',
        data: userMessage.imageData,
        mime_type: userMessage.mimeType
      }
    ];
  }
  return [];
}
```

**Why**: Interactions API uses a different input format than the old Chat API.

---

### Step 4: Update `callProvider` Method - Part 1: Check Feature Flag

**File**: `src/services/geminiChatService.ts`

**Location**: Inside `callProvider` method, right after line 98 (after `isCalendarQuery` check)

**Add**:
```typescript
// Check if we should use new Interactions API
if (USE_INTERACTIONS_API) {
  return await this.callProviderWithInteractions(
    systemPrompt,
    userMessage,
    history,
    session,
    isCalendarQuery
  );
}

// Fallback to old API (existing code continues below)
```

**Why**: This creates a clean separation - new code in separate method, old code unchanged.

---

### Step 5: Create New Method `callProviderWithInteractions`

**File**: `src/services/geminiChatService.ts`

**Add new method** (after `callProvider`, around line 220):

```typescript
/**
 * New implementation using Interactions API for stateful conversations
 * This method is called when USE_INTERACTIONS_API flag is enabled
 */
private async callProviderWithInteractions(
  systemPrompt: string,
  userMessage: UserContent,
  history: any[],
  session?: AIChatSession,
  isCalendarQuery: boolean = false
): Promise<{ response: AIActionResponse, session: AIChatSession }> {
  const ai = getAiClient();
  const userId = session?.userId || USER_ID;
  
  // Format user message for Interactions API
  const input = formatInteractionInput(userMessage);
  
  // Determine if this is first message (no previous interaction)
  const isFirstMessage = !session?.interactionId;
  
  // Build interaction config
  const interactionConfig: any = {
    model: this.model,
    input: input,
  };
  
  // FIRST MESSAGE: Include system prompt
  // SUBSEQUENT: Use previous_interaction_id (system prompt not needed!)
  if (isFirstMessage) {
    console.log('🆕 [Gemini Interactions] First message - sending full system prompt');
    interactionConfig.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  } else {
    console.log('🔄 [Gemini Interactions] Continuing conversation - using previous_interaction_id');
    interactionConfig.previous_interaction_id = session.interactionId;
    // NOTE: We don't send system prompt here - it's already in the conversation!
  }
  
  // Add memory tools if enabled
  if (ENABLE_MEMORY_TOOLS) {
    interactionConfig.tools = [{
      functionDeclarations: GeminiMemoryToolDeclarations
    }];
    console.log('🧠 [Gemini Interactions] Memory tools enabled');
  }
  
  // Create interaction
  let interaction = await ai.interactions.create(interactionConfig);
  
  // Handle tool calling loop (similar to old code but with Interactions API)
  const MAX_TOOL_ITERATIONS = 3;
  let iterations = 0;
  
  while (interaction.outputs && iterations < MAX_TOOL_ITERATIONS) {
    // Find function calls in outputs
    const functionCalls = interaction.outputs.filter(
      (output: any) => output.type === 'function_call'
    );
    
    if (functionCalls.length === 0) break;
    
    iterations++;
    console.log(`🔧 [Gemini Interactions] Tool call iteration ${iterations}:`, 
      functionCalls.map((fc: any) => fc.name)
    );
    
    // Execute all tool calls
    const toolResults = await Promise.all(
      functionCalls.map(async (functionCall: any) => {
        const toolName = functionCall.name as MemoryToolName;
        const toolArgs = functionCall.arguments || {};
        
        console.log(`🔧 [Gemini Interactions] Executing tool: ${toolName}`, toolArgs);
        
        const toolResult = await executeMemoryTool(toolName, toolArgs, userId);
        
        return {
          type: 'function_result',
          name: toolName,
          call_id: functionCall.id,
          result: toolResult
        };
      })
    );
    
    // Continue interaction with tool results
    interaction = await ai.interactions.create({
      model: this.model,
      previous_interaction_id: interaction.id,
      input: toolResults,
    });
  }
  
  if (iterations >= MAX_TOOL_ITERATIONS) {
    console.warn('⚠️ [Gemini Interactions] Max tool iterations reached');
  }
  
  // Extract text response from outputs
  const textOutput = interaction.outputs?.find(
    (output: any) => output.type === 'text'
  );
  
  const responseText = textOutput?.text || "{}";
  
  // Parse response (same as old code)
  let structuredResponse: AIActionResponse;
  try {
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanedText);
    structuredResponse = normalizeAiResponse(parsed, cleanedText);
  } catch (e) {
    console.warn("Failed to parse Gemini JSON:", responseText);
    structuredResponse = { 
      text_response: responseText, 
      action_id: null 
    };
  }
  
  // Update session with interaction ID
  const updatedSession: AIChatSession = {
    userId: userId,
    model: this.model,
    interactionId: interaction.id,  // ← Store for next message!
  };
  
  return {
    response: structuredResponse,
    session: updatedSession
  };
}
```

**Key Points**:
- First message: sends system prompt
- Subsequent: uses `previous_interaction_id`, no system prompt
- Tool calling: uses Interactions API pattern
- Response parsing: same as before (backward compatible)

---

### Step 6: Handle Dynamic Context Updates

**Problem**: Some system prompt parts change (calendar, tasks, mood). We have two options:

**Option A (Recommended)**: Accept that dynamic parts are sent each time (small cost)
- Calendar events: ~50-100 tokens
- Task list: ~50-100 tokens  
- Total: ~100-200 tokens vs 2000+ tokens for full prompt
- **Still 90%+ savings!**

**Option B (Advanced)**: Send updates only when they change
- Track what was last sent
- Only send updates when calendar/tasks change
- More complex, but maximum savings

**For now, use Option A** - it's simpler and still saves 90%+.

**Implementation**: No changes needed! The Interactions API will handle it. On first message, full prompt is sent. On subsequent messages, if calendar/tasks change, we can either:
1. Accept the small cost (recommended)
2. Create a new interaction with updated system prompt (advanced)

---

### Step 7: Update `generateGreeting` Method

**File**: `src/services/geminiChatService.ts`

**Location**: `generateGreeting` method (starts around line 222)

**Add at the beginning** (after line 224):
```typescript
// Use Interactions API if enabled
if (USE_INTERACTIONS_API) {
  return await this.generateGreetingWithInteractions(
    character,
    session,
    relationship,
    characterContext
  );
}

// Fallback to old implementation (existing code continues)
```

**Then add new method** (after `generateGreeting`, around line 351):

```typescript
/**
 * Generate greeting using Interactions API
 */
private async generateGreetingWithInteractions(
  character: any,
  session: any,
  relationship: any,
  characterContext?: string
): Promise<any> {
  const ai = getAiClient();
  const userId = session?.userId || USER_ID;
  const systemPrompt = buildSystemPrompt(character, relationship, [], characterContext);
  
  // ... (same logic as old generateGreeting for fetching user facts, open loops, etc.)
  // ... (but use Interactions API instead of ai.chats.create)
  
  // Build greeting prompt
  const greetingPrompt = buildGreetingPrompt(relationship, hasUserFacts, userName, topOpenLoop);
  
  // Create interaction with system prompt (greeting is always first message)
  const interaction = await ai.interactions.create({
    model: this.model,
    input: [{ type: 'text', text: greetingPrompt }],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    tools: ENABLE_MEMORY_TOOLS ? [{
      functionDeclarations: GeminiMemoryToolDeclarations
    }] : undefined,
  });
  
  // Handle tool calls (same pattern as callProviderWithInteractions)
  // ... (tool calling loop)
  
  // Parse response and return
  // ... (same as old generateGreeting)
  
  return {
    greeting: structuredResponse,
    session: {
      userId: userId,
      model: this.model,
      interactionId: interaction.id,  // ← Store for first real message
    },
    audioData
  };
}
```

---

### Step 8: Update Session Persistence

**Check where sessions are stored/retrieved**:

**File**: `src/App.tsx` (or wherever sessions are managed)

**Ensure**:
- When saving session: include `interactionId` if present
- When loading session: restore `interactionId` if present
- If `interactionId` is missing: fall back to old behavior (create new interaction)

**Example check** (pseudo-code):
```typescript
// When saving session
localStorage.setItem('aiSession', JSON.stringify({
  ...session,
  interactionId: session.interactionId  // ← Make sure this is saved
}));

// When loading session
const savedSession = JSON.parse(localStorage.getItem('aiSession') || '{}');
// interactionId will be restored automatically if it exists
```

---

### Step 9: Testing Checklist

Test each scenario:

- [ ] **First message**: System prompt sent, interaction ID stored
- [ ] **Second message**: Uses `previous_interaction_id`, no system prompt
- [ ] **Tool calling**: Memory tools work correctly
- [ ] **Audio input**: Still works
- [ ] **Image input**: Still works
- [ ] **Greeting**: Works with Interactions API
- [ ] **Session persistence**: Interaction ID saved/restored
- [ ] **Error handling**: Falls back to old API if Interactions API fails
- [ ] **ChatGPT still works**: Verify no breaking changes
- [ ] **Grok still works**: Verify no breaking changes

---

### Step 10: Environment Variable Setup

**File**: `.env` or `.env.local`

**Add**:
```bash
# Enable Gemini Interactions API (beta)
VITE_USE_GEMINI_INTERACTIONS_API=false  # Set to 'true' when ready
```

**Why**: Allows gradual rollout. Start with `false`, test thoroughly, then enable.

---

## Expected Results

### Before (Current)
- Message 1: ~2500 tokens (system prompt + message)
- Message 2: ~2500 tokens (system prompt + message)
- Message 3: ~2500 tokens (system prompt + message)
- **Total for 3 messages: ~7500 tokens**

### After (With Interactions API)
- Message 1: ~2500 tokens (system prompt + message)
- Message 2: ~100 tokens (just message + reference)
- Message 3: ~100 tokens (just message + reference)
- **Total for 3 messages: ~2700 tokens**

**Savings: 64% for 3 messages, 90%+ for longer conversations!**

---

## Rollback Plan

If issues occur:

1. Set `VITE_USE_GEMINI_INTERACTIONS_API=false` in `.env`
2. Restart application
3. Old code path will be used automatically
4. No data loss - sessions still work

---

## Important Notes for Junior Developers

### Why This Works

1. **First message**: Gemini stores the system prompt in the interaction
2. **Subsequent messages**: Gemini retrieves the stored system prompt using `previous_interaction_id`
3. **No resending needed**: The system prompt lives on Gemini's servers for that conversation

### Why We Keep Old Code

- **Safety**: Beta APIs can have issues
- **Testing**: Compare old vs new behavior
- **Rollback**: Easy to switch back if needed

### Why Other Services Don't Need Changes

- **ChatGPT**: Already uses `previous_response_id` ✅
- **Grok**: Already uses `previous_response_id` ✅
- **Gemini**: Only one that needs updating

### Common Pitfalls to Avoid

1. **Don't remove old code yet** - Keep both paths until fully tested
2. **Don't break session structure** - Add `interactionId`, don't replace `previousResponseId`
3. **Don't forget tool calling** - Interactions API handles it differently
4. **Don't send system prompt twice** - Only on first message!

---

## Files Changed Summary

1. ✅ `src/services/aiService.ts` - Add `interactionId` to `AIChatSession`
2. ✅ `src/services/geminiChatService.ts` - Add Interactions API implementation
3. ✅ `.env` - Add feature flag
4. ⚠️ `src/App.tsx` (or session manager) - Verify session persistence includes `interactionId`

**No changes needed to**:
- `src/services/chatGPTService.ts` (already optimized ✅)
- `src/services/grokChatService.ts` (already optimized ✅)
- `src/services/BaseAIService.ts` (shared logic unchanged ✅)
- `src/services/promptUtils.ts` (no changes needed ✅)

---

## Questions?

If you get stuck:

1. Check Interactions API docs: https://ai.google.dev/gemini-api/docs/interactions
2. Compare with ChatGPT implementation (it's similar!)
3. Test with feature flag OFF first (old code), then ON (new code)
4. Check console logs - they show which path is being used

---

## Next Steps After Implementation

1. ✅ Test thoroughly with feature flag OFF (old code)
2. ✅ Enable feature flag, test with real conversations
3. ✅ Monitor token usage (should see 90%+ reduction)
4. ✅ Monitor for errors (Interactions API is beta)
5. ✅ After 1-2 weeks of stability, remove old code path
6. ✅ Update documentation

Good luck! 🚀
