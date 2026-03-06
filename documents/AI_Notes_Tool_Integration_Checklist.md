# Tool Integration Checklist

> **Purpose**: Step-by-step checklist for adding new LLM tools to the Interactive Video Character project

---

## Overview

When adding a new tool that the AI can call, you must update **8 critical files** in the correct order. Missing any step will cause type errors or runtime failures.

> **Note**: Examples below use `my_new_tool` as a placeholder. Replace with your actual tool name.

---

## The 8 Critical Integration Points

### 1. Tool Implementation (`src/services/memoryService.ts`)

**Purpose**: Execute the tool when LLM calls it

**Steps**:
1. Add tool name to `MemoryToolName` type
2. Add tool args interface to `ToolCallArgs` type
3. Implement execution logic in `executeMemoryTool()` function

**Example**:
```typescript
// 1. Add to MemoryToolName type
export type MemoryToolName =
  | 'recall_memory'
  | 'manage_narrative_arc'  // <-- ADD HERE
  | 'manage_dynamic_relationship';  // <-- ADD HERE

// 2. Add to ToolCallArgs interface
export interface ToolCallArgs {
  recall_memory: { query: string; timeframe?: string };
  manage_narrative_arc: {  // <-- ADD HERE
    action: string;
    arc_key: string;
    arc_title?: string;
    initial_event?: string;
    event?: string;
    resolution?: string;
    reason?: string;
  };
  manage_dynamic_relationship: {  // <-- ADD HERE
    action: string;
    person_key: string;
    relationship_status?: string;
    event?: string;
    warmth_change?: number;
    trust_change?: number;
    familiarity_change?: number;
    sentiment?: string;
  };
}

// 3. Add case statement in executeMemoryTool()
export async function executeMemoryTool(
  toolName: MemoryToolName,
  args: any,
  userId: string,
  context?: ToolExecutionContext
): Promise<string> {
  switch (toolName) {
    case 'recall_memory':
      // existing logic
      break;

    case 'manage_narrative_arc': {  // <-- ADD HERE
      const narr = await import('./narrativeArcsService');
      const narrArgs = args as ToolCallArgs['manage_narrative_arc'];
      // ... implementation
      break;
    }

    case 'manage_dynamic_relationship': {  // <-- ADD HERE
      const dynRel = await import('./dynamicRelationshipsService');
      const relArgs = args as ToolCallArgs['manage_dynamic_relationship'];
      // ... implementation
      break;
    }
  }
}
```

---

### 2. Gemini Tool Definition (`src/services/aiSchema.ts`)

**Purpose**: Define tool schema for Gemini API

**Steps**:
1. Add tool to `GeminiMemoryToolDeclarations` array
2. Define parameters with proper types and descriptions

**Example**:
```typescript
export const GeminiMemoryToolDeclarations = [
  {
    name: "recall_memory",
    description: "...",
    parameters: { /* ... */ }
  },
  {
    name: "manage_narrative_arc",  // <-- ADD HERE
    description:
      "Manage YOUR (Kayley's) ongoing life events and projects. " +
      "Use this to create, update, resolve, or abandon arcs in your life.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "resolve", "abandon"],
          description: "create: start new arc, update: add progress, resolve: finish successfully, abandon: gave up"
        },
        arc_key: {
          type: "string",
          description: "Unique identifier for the arc (e.g., 'collab_sarah_dec2024')"
        },
        // ... other parameters
      },
      required: ["action", "arc_key"]
    }
  },
  // ... more tools
];
```

---

### 3. MemoryToolArgs Type (`src/services/aiSchema.ts`)

**Purpose**: TypeScript type for all tool arguments

**Steps**:
1. Add to `MemoryToolArgs` union type
2. Include args interface with proper typing

**Example**:
```typescript
export type MemoryToolArgs =
  | { tool: 'recall_memory'; args: RecallMemoryArgs }
  | { tool: 'recall_user_info'; args: RecallUserInfoArgs }
  | { tool: 'store_user_info'; args: StoreUserInfoArgs }
  | { tool: 'store_character_info'; args: { category: string; key: string; value: string } }
  | { tool: 'manage_narrative_arc'; args: { action: string; arc_key: string; arc_title?: string; initial_event?: string; event?: string; resolution?: string; reason?: string } }  // <-- ADD HERE
  | { tool: 'manage_dynamic_relationship'; args: { action: string; person_key: string; relationship_status?: string; event?: string; warmth_change?: number; trust_change?: number; familiarity_change?: number; sentiment?: string } };  // <-- ADD HERE
```

---

### 4. PendingToolCall Interface (`src/services/aiSchema.ts`)

**Purpose**: Type for tool calls during execution

**Steps**:
1. Add tool name to `PendingToolCall.name` union type

**Example**:
```typescript
export interface PendingToolCall {
  id: string;
  name: 'recall_memory'
    | 'recall_user_info'
    | 'store_user_info'
    | 'task_action'
    | 'calendar_action'
    | 'store_character_info'
    | 'manage_narrative_arc'  // <-- ADD HERE
    | 'manage_dynamic_relationship';  // <-- ADD HERE
  arguments: Record<string, any>;
}
```

---

### 5. OpenAI Tool Definition (`src/services/aiSchema.ts`)

**Purpose**: Define tool schema for OpenAI/ChatGPT API

**Steps**:
1. Add tool to `OpenAIMemoryToolDeclarations` array
2. Mirror Gemini schema but with OpenAI's `type: "function"` format

**Example**:
```typescript
export const OpenAIMemoryToolDeclarations = [
  {
    type: "function" as const,
    name: "recall_memory",
    description: "...",
    parameters: { /* ... */ }
  },
  {
    type: "function" as const,
    name: "manage_narrative_arc",  // <-- ADD HERE (if using OpenAI)
    description: "Manage YOUR (Kayley's) ongoing life events...",
    parameters: {
      type: "object",
      properties: { /* ... */ },
      required: ["action", "arc_key"]
    }
  },
];
```

**Note**: If you're only using Gemini, you can skip OpenAI declarations.

---

### 6. Tool Documentation (`src/services/system_prompts/tools/toolsAndCapabilities.ts`)

> ⚠️ **CRITICAL STEP - DO NOT SKIP!**
>
> Without this step, the LLM will see the tool in its function list but **WON'T KNOW WHEN TO USE IT**.
> This causes tools to never be called, even when they should be.

**Purpose**: Teach the LLM how and when to use the tool in the system prompt

**Steps**:
1. Add tool to the numbered list with clear examples
2. Include **WHEN** to use it (triggers/scenarios)
3. Include **HOW** to use it (exact parameter patterns)
4. Add usage notes and warnings

**Example**:
```typescript
// In buildToolsAndCapabilitiesSection():
**6. manage_narrative_arc(action, arc_key, ...)** - Manage YOUR ongoing life events/projects
   Actions: "create" (start new), "update" (add progress), "resolve" (finish), "abandon" (gave up)

   Examples:
   - Starting collab video: manage_narrative_arc("create", "collab_sarah_dec2024", "Collab Video with Sarah", "Met Sarah at meetup")
   - Adding progress: manage_narrative_arc("update", "collab_sarah_dec2024", null, null, "Filming complete, editing")
   - Finishing: manage_narrative_arc("resolve", "collab_sarah_dec2024", null, null, null, "Published, got great response")

   ⚠️ This makes you ALIVE - users can ask about your projects weeks later!
   ⚠️ Use unique arc_key (include topic/person/timeframe)

**7. manage_dynamic_relationship(action, person_key, ...)** - Manage people in YOUR life
   People: "lena" (best friend), "ethan" (brother), "mom" (mother)
   Actions: "update_kayley_relationship", "log_kayley_event", "update_user_feeling", "mention_to_user"

   ⚠️ TWO perspectives: YOUR relationship AND user's feelings about them
```

---

### 7. System Prompt Integration (if context needed)

**Purpose**: Inject tool's context/data into system prompt

**File**: `src/services/system_prompts/builders/systemPromptBuilder.ts`

**Steps**:
1. Import the context formatter function
2. Add to parallel fetching (if async)
3. Inject into prompt string

**Example**:
```typescript
import { formatArcsForPrompt } from "../../narrativeArcsService";
import { formatDynamicRelationshipsForPrompt } from "../../dynamicRelationshipsService";

// Add to parallel fetching
[soulContext, characterFactsPrompt, narrativeArcsPrompt, dynamicRelationshipsPrompt] = await Promise.all([
  getSoulLayerContextAsync(effectiveUserId),
  formatCharacterFactsForPrompt(),
  formatArcsForPrompt(effectiveUserId),  // <-- ADD HERE
  formatDynamicRelationshipsForPrompt(effectiveUserId),  // <-- ADD HERE
]);

// Inject into prompt
${KAYLEY_FULL_PROFILE}
${characterFactsPrompt}
${narrativeArcsPrompt}  // <-- ADD HERE
${dynamicRelationshipsPrompt}  // <-- ADD HERE
```

**Note**: Only needed if the tool requires context injection (like narrative arcs or relationships). Simple tools like `recall_memory` don't need this.

---

### 8. Update Snapshot Tests

**Purpose**: Update golden master snapshots after prompt changes

**Steps**:
1. Run snapshot tests: `npm test -- --run -t "snapshot"`
2. Review differences (ensure only expected changes)
3. Update snapshots: `npm test -- --run -t "snapshot" -u`

**Example**:
```bash
# See what changed
npm test -- --run -t "snapshot"

# Review output, verify changes are expected
# Then update snapshots
npm test -- --run -t "snapshot" -u

# Verify all tests pass
npm test -- --run
```

---

## Quick Checklist Summary

When adding a new LLM tool, check all 8 boxes:

- [ ] **1. memoryService.ts**: Add to MemoryToolName, ToolCallArgs, executeMemoryTool()
- [ ] **2. aiSchema.ts - Gemini**: Add to GeminiMemoryToolDeclarations
- [ ] **3. aiSchema.ts - MemoryToolArgs**: Add to union type
- [ ] **4. aiSchema.ts - PendingToolCall**: Add to name union type
- [ ] **5. aiSchema.ts - OpenAI**: Add to OpenAIMemoryToolDeclarations (if using OpenAI)
- [ ] **6. toolsAndCapabilities.ts**: ⚠️ **CRITICAL** - Add documentation with WHEN/HOW to use
- [ ] **7. systemPromptBuilder.ts**: Add context injection (if needed)
- [ ] **8. Snapshot Tests**: Update with `-u` flag

> 💡 **Tip**: Steps 1-5 make the tool *available*. Step 6 makes the LLM *use* it. Don't skip step 6!

---

## Common Mistakes

### ❌ Mistake 1: Skipping Tool Documentation (Most Common!)

**Symptom**: Tool is declared, builds succeed, but LLM NEVER calls the tool

**Cause**: Steps 1-5 register the tool with the API, but the LLM doesn't know **when** to use it

**Fix**: Add documentation to `toolsAndCapabilities.ts` with:
- Clear description of WHEN to use it
- Examples showing exact parameter patterns
- Any warnings or special instructions

**Example of what happens without this step**:
```
You add resolve_open_loop tool → Build passes → LLM sees tool exists
→ User addresses a topic → LLM doesn't call the tool → Loop never resolves
→ You wonder "why isn't my tool being used?"
```

### ❌ Mistake 2: Forgetting MemoryToolArgs

**Symptom**: Tool works in Gemini but fails in type checking

**Fix**: Add to `MemoryToolArgs` union type in aiSchema.ts

### ❌ Mistake 3: Forgetting PendingToolCall

**Symptom**: Type error when LLM tries to call the tool

**Fix**: Add to `PendingToolCall.name` union type in aiSchema.ts

### ❌ Mistake 4: Missing Context Injection

**Symptom**: Tool works but LLM doesn't know current state

**Fix**: Add context formatter to systemPromptBuilder.ts parallel fetch and injection

### ❌ Mistake 5: Not Updating Snapshots

**Symptom**: Snapshot tests fail after adding tool

**Fix**: Run `npm test -- --run -t "snapshot" -u` to update

### ❌ Mistake 6: Using `.single()` When Rows Might Not Exist

**Symptom**: Supabase throws "JSON object requested, multiple (or no) rows returned" when a row is missing.

**Cause**: `.single()` hard-fails if zero rows are returned.

**Fix**: Use `.maybeSingle()` for optional rows, or `select().limit(1)` and handle `data === null`.

---

## Example: Adding a Hypothetical `manage_habits` Tool

Here's a full walkthrough of adding a new tool:

### 1. memoryService.ts
```typescript
export type MemoryToolName =
  | 'recall_memory'
  | 'manage_habits';  // Step 1: Add here

export interface ToolCallArgs {
  manage_habits: {
    action: 'create' | 'update' | 'complete';
    habit_key: string;
    habit_name?: string;
    frequency?: string;
  };
}

// In executeMemoryTool():
case 'manage_habits': {
  const habits = await import('./habitsService');
  const habitsArgs = args as ToolCallArgs['manage_habits'];

  if (habitsArgs.action === 'create') {
    await habits.createHabit(habitsArgs.habit_key, habitsArgs.habit_name);
    return `✓ Created habit: ${habitsArgs.habit_name}`;
  }
  // ... other actions
  break;
}
```

### 2. aiSchema.ts - Gemini Declaration
```typescript
{
  name: "manage_habits",
  description: "Track and manage YOUR daily habits.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "complete"],
        description: "create: start new habit, update: change details, complete: mark done for today"
      },
      habit_key: {
        type: "string",
        description: "Unique habit ID (e.g., 'morning_meditation', 'daily_walk')"
      },
      habit_name: {
        type: "string",
        description: "Human-readable name (for create)"
      },
      frequency: {
        type: "string",
        description: "How often (for create): 'daily', 'weekly', 'weekdays'"
      }
    },
    required: ["action", "habit_key"]
  }
}
```

### 3. aiSchema.ts - MemoryToolArgs
```typescript
export type MemoryToolArgs =
  | { tool: 'recall_memory'; args: RecallMemoryArgs }
  | { tool: 'manage_habits'; args: { action: string; habit_key: string; habit_name?: string; frequency?: string } };
```

### 4. aiSchema.ts - PendingToolCall
```typescript
export interface PendingToolCall {
  id: string;
  name: 'recall_memory' | 'manage_habits';
  arguments: Record<string, any>;
}
```

### 5. toolsAndCapabilities.ts
```typescript
**8. manage_habits(action, habit_key, ...)** - Track YOUR daily habits
   Actions: "create", "update", "complete"

   Examples:
   - Start new: manage_habits("create", "morning_meditation", "Morning Meditation", "daily")
   - Mark done: manage_habits("complete", "morning_meditation")
```

### 6. systemPromptBuilder.ts (if context needed)
```typescript
import { formatHabitsForPrompt } from "../../habitsService";

// Add to parallel fetching
const [soulContext, habitsPrompt] = await Promise.all([
  getSoulLayerContextAsync(userId),
  formatHabitsForPrompt(userId),
]);

// Inject
${habitsPrompt}
```

### 7. Update Snapshots
```bash
npm test -- --run -t "snapshot" -u
```

---

## Testing Your New Tool

After integration, test with these steps:

1. **Type Check**: Run `npm run build` to ensure no type errors
2. **Unit Tests**: Write tests in `src/services/tests/memoryService.test.ts`
3. **Integration Test**: Start dev server and test manually in chat
4. **Snapshot Tests**: Verify and update with `-u` flag
5. **Full Suite**: Run `npm test -- --run` to ensure nothing broke

---

## Related Documentation

- [System Prompt Guidelines](./System_Prompt_Guidelines.md) - Prompt modification guidelines
- [Sub-Agent Usage Guide](./Sub_Agent_Usage_Guide.md) - Which agents handle what
- [CLAUDE.md](../CLAUDE.md) - Project overview and architecture
- `.claude/agents/chat-engine-specialist.md` - Chat engine and tool calling
- `.claude/agents/memory-knowledge.md` - Memory systems and tools

---

## Version History

| Date | Change | Author |
|------|--------|--------|
| 2026-01-07 | **Emphasized step 6 as CRITICAL** - Added warnings that LLM won't use tool without documentation | Claude Opus 4.5 |
| 2025-12-27 | Initial creation after Phase 2 implementation | Claude Sonnet 4.5 |

---

## Questions?

If you're unsure about any step:
1. Check this checklist
2. Review existing tools in `memoryService.ts` for patterns
3. Use the `chat-engine-specialist` sub-agent for tool calling questions
4. Test incrementally - don't skip type checking!
