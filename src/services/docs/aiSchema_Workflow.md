# AI Schema Workflow

**File:** `src/services/aiSchema.ts`
**Purpose:** Defines the structured output schema and tool declarations for AI providers

---

## Overview

The `aiSchema.ts` file defines two distinct mechanisms for AI interaction:

1. **Response Schema** (`AIActionResponseSchema`) - The structured JSON output format
2. **Tool Declarations** (`GeminiMemoryToolDeclarations`, `OpenAIMemoryToolDeclarations`) - Functions the LLM can call

Understanding the difference between these two mechanisms is critical for implementing new features correctly.

---

## The Two Mechanisms Explained

### 1. Response Schema Fields

These are fields in the structured JSON response that the LLM returns **after** generating its output.

```typescript
export const AIActionResponseSchema = z.object({
  text_response: z.string(),           // The conversational reply
  action_id: z.string().nullable(),    // Video action to play
  selfie_action: z.object({...}),      // Image generation request
  almost_moment_used: z.object({...}), // Self-report of expression used
  // ... more fields
});
```

**Characteristics:**
- Set once, at the end of response generation
- No feedback loop - LLM doesn't know if it was processed
- Good for: actions tightly coupled with the response itself
- Processed by the calling service after receiving the response

**Processing Flow:**
```
┌─────────────────────────────────────────────────────┐
│ LLM generates complete response                     │
│                                                     │
│ Returns JSON:                                       │
│ {                                                   │
│   "text_response": "Here's a selfie from the...",  │
│   "selfie_action": {                                │
│     "scene": "coffee shop",                         │
│     "mood": "cozy"                                  │
│   }                                                 │
│ }                                                   │
└─────────────────────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────┐
│ Service processes response fields:                  │
│                                                     │
│ if (response.selfie_action) {                       │
│   await generateSelfie(response.selfie_action);     │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

### 2. Tools (Function Calls)

These are functions the LLM can invoke **during** response generation. They execute and return results that can influence the response.

```typescript
export const GeminiMemoryToolDeclarations = [
  {
    name: "store_user_info",
    description: "Save facts about the user...",
    parameters: { ... }
  },
  {
    name: "recall_memory",
    description: "Search past conversations...",
    parameters: { ... }
  }
];
```

**Characteristics:**
- Called mid-generation, can happen multiple times
- Returns result to LLM for continued processing
- Good for: queries, data retrieval, explicit commands
- Processed by `memoryService.ts` during generation

**Processing Flow:**
```
┌─────────────────────────────────────────────────────┐
│ LLM starts generating response...                   │
│                                                     │
│ "The user mentioned their name, let me store it"   │
│                                                     │
│ TOOL CALL: store_user_info({                        │
│   category: "identity",                             │
│   key: "name",                                      │
│   value: "John"                                     │
│ })                                                  │
└─────────────────────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────┐
│ memoryService.executeMemoryTool() runs              │
│                                                     │
│ Returns: "Stored: name = John"                      │
└─────────────────────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────┐
│ LLM continues with tool result                      │
│                                                     │
│ "Got it, John! Nice to meet you properly..."        │
│                                                     │
│ Returns final JSON response                         │
└─────────────────────────────────────────────────────┘
```

---

## Decision Guide: When to Use Which

### Use Response Schema Fields When:

| Scenario | Example |
|----------|---------|
| Action is tightly coupled with the response text | `selfie_action` - describes what image to generate based on the text |
| No feedback needed during generation | `action_id` - video selection doesn't change the text |
| Self-reporting what was just written | `almost_moment_used` - reporting expression used |
| Simple flags or metadata | `game_move` - single value set at end |

### Use Tools When:

| Scenario | Example |
|----------|---------|
| Need to query/retrieve data | `recall_memory` - search past conversations |
| Result influences the response | `recall_user_info` - personalize greeting with name |
| Explicit "command" semantics | `store_user_info` - intentional save operation |
| Multiple calls may be needed | Store several facts in one conversation |
| Operation should feel intentional | LLM explicitly decides to remember something |

---

## Current Schema Fields

### Core Response Fields

| Field | Type | Purpose |
|-------|------|---------|
| `text_response` | `string` | The conversational text to display |
| `action_id` | `string \| null` | Video action ID to play |
| `user_transcription` | `string \| null` | Audio input transcription |
| `open_app` | `string \| null` | URL scheme to launch external app |

### Action Fields

| Field | Type | Purpose |
|-------|------|---------|
| `calendar_action` | `object \| null` | Create/delete calendar events |
| `game_move` | `number \| null` | Tic-tac-toe cell position (0-8) |
| `user_move_detected` | `number \| null` | User's detected move from image |
| `news_action` | `object \| null` | Fetch latest tech/AI news |
| `whiteboard_action` | `object \| null` | Drawing/guessing actions |
| `selfie_action` | `object \| null` | Image generation request |

### Memory/State Fields

| Field | Type | Purpose |
|-------|------|---------|
| `store_self_info` | `object \| null` | Store new fact about Kayley |
| `almost_moment_used` | `object \| null` | Report almost-moment expression used |

---

## Current Tools

### Memory Tools

| Tool | Purpose | Returns |
|------|---------|---------|
| `recall_memory` | Search past conversations | Matching conversation snippets |
| `recall_user_info` | Get stored user facts | Fact values by category |
| `store_user_info` | Save user fact | Confirmation message |
| `store_character_info` | Save Kayley fact | Confirmation message |

### Relationship Tools

| Tool | Purpose | Returns |
|------|---------|---------|
| `manage_narrative_arc` | Track Kayley's ongoing projects | Status update |
| `manage_dynamic_relationship` | Manage Kayley's relationships | Status update |

### Story Tools

| Tool | Purpose | Returns |
|------|---------|---------|
| `recall_story` | Check if story was told before | Story details + told status |
| `manage_story_retelling` | Mark story as told or create new | Confirmation |

### Task/Calendar Tools

| Tool | Purpose | Returns |
|------|---------|---------|
| `task_action` | Manage user's checklist | Task list or confirmation |
| `calendar_action` | Create/delete calendar events | Event details or confirmation |

---

## Type Definitions

### Response Type

```typescript
export type AIActionResponse = z.infer<typeof AIActionResponseSchema>;
```

### Tool Argument Types

```typescript
// Union of all tool argument types
export type MemoryToolArgs =
  | { tool: 'recall_memory'; args: RecallMemoryArgs }
  | { tool: 'recall_user_info'; args: RecallUserInfoArgs }
  | { tool: 'store_user_info'; args: StoreUserInfoArgs }
  | { tool: 'store_character_info'; args: { category: string; key: string; value: string } }
  | { tool: 'manage_narrative_arc'; args: { action: string; arc_key: string; ... } }
  // ... more tools

// Tool call pending execution
export interface PendingToolCall {
  id: string;
  name: 'recall_memory' | 'store_user_info' | ... ; // Union of all tool names
  arguments: Record<string, any>;
}
```

---

## Adding New Functionality

### Adding a Response Schema Field

1. Add to `AIActionResponseSchema` in `aiSchema.ts`
2. Process in the appropriate service (e.g., `BaseAIService.ts`)
3. Add to system prompt instructions if LLM needs to know about it

**Example:**
```typescript
// In AIActionResponseSchema
mood_shift: z.object({
  from: z.string(),
  to: z.string(),
  reason: z.string()
}).nullable().optional()
```

### Adding a Tool

Follow the **8-step Tool Integration Checklist** (see `docs/Tool_Integration_Checklist.md`):

1. Add to `memoryService.ts` - `MemoryToolName`, `ToolCallArgs`, `executeMemoryTool()`
2. Add to `GeminiMemoryToolDeclarations` array
3. Add to `MemoryToolArgs` union type
4. Add to `PendingToolCall.name` union type
5. Add to `OpenAIMemoryToolDeclarations` (if using OpenAI)
6. Add to `toolsAndCapabilities.ts` documentation
7. Add context injection in `systemPromptBuilder.ts` (if needed)
8. Update snapshot tests

---

## Common Patterns

### Pattern: Response Field with Conditional Processing

```typescript
// In service processing the response
if (response.selfie_action) {
  const { scene, mood } = response.selfie_action;
  await generateSelfie(userId, scene, mood);
}
```

### Pattern: Tool with Feedback

```typescript
// In memoryService.ts
case 'recall_user_info':
  const facts = await getUserFacts(userId, args.category);
  return facts.length > 0
    ? `Found: ${facts.map(f => `${f.key}=${f.value}`).join(', ')}`
    : 'No facts found for this category.';
```

### Pattern: Dual Implementation (Both Field AND Tool)

Some operations exist as both (e.g., `store_self_info` field AND `store_character_info` tool):

```typescript
// Response field approach
store_self_info: z.object({
  category: z.enum(['quirk', 'experience', ...]),
  key: z.string(),
  value: z.string()
})

// Tool approach
{
  name: "store_character_info",
  description: "Save NEW facts about yourself...",
  parameters: { ... }
}
```

**Recommendation:** Prefer tools for database operations - they're more reliable and explicit.

---

## Known Issues

### Issue: Optional Fields Often Ignored

LLMs tend to skip optional response fields, especially for "self-reporting" patterns.

**Example:** `almost_moment_used` is frequently not set even when the LLM uses an almost-moment expression.

**Solutions:**
1. Make field required (if always needed)
2. Convert to tool for explicit invocation
3. Add prominent instructions in system prompt

See `docs/bugs/Kayley_Almost_Moment_Used.md` for detailed analysis.

---

## Provider Differences

### Gemini (Google)

```typescript
// Uses GeminiMemoryToolDeclarations format
{
  name: "tool_name",
  description: "...",
  parameters: {
    type: "object",
    properties: { ... },
    required: [...]
  }
}
```

### OpenAI (ChatGPT/GPT-4)

```typescript
// Uses OpenAIMemoryToolDeclarations format
{
  type: "function",
  name: "tool_name",
  description: "...",
  parameters: { ... }
}
```

Both arrays should be kept in sync when adding new tools.

---

## Best Practices

1. **Prefer tools for database writes** - More reliable than optional response fields
2. **Keep tool descriptions concise but clear** - LLMs need to understand when to use them
3. **Include examples in descriptions** - Helps LLM know what values to pass
4. **Update both provider arrays** - Keep Gemini and OpenAI declarations in sync
5. **Follow the 8-step checklist** - Don't skip steps when adding tools
6. **Test with multiple providers** - Behavior may differ between Gemini/OpenAI

---

## Summary

| Mechanism | Best For | Reliability | Complexity |
|-----------|----------|-------------|------------|
| Response Fields | Actions coupled with response text | Lower for optional fields | Simple |
| Tools | Data queries, explicit operations | Higher (explicit invocation) | More setup required |

When in doubt, prefer tools for anything that:
- Writes to the database
- Needs to be reliably executed
- Benefits from explicit LLM decision-making
