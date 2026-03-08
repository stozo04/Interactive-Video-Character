# Guide: Adding a New Gemini Function Tool

This is the current, Gemini-specific process for wiring a new callable function tool into Kayley's SDK chat pipeline.

---

## Background: What Actually Runs

Current flow:

```text
Gemini SDK chat session
  -> server/services/ai/toolBridge.ts (CallableTool.callTool)
  -> src/services/memoryService.ts (executeMemoryTool)
  -> your switch case / handler logic
```

The runtime contract for a normal new tool lives in these files:

| File | What it owns |
|---|---|
| `src/services/aiSchema.ts` | Gemini function declaration (`GeminiMemoryToolDeclarations`) |
| `src/services/memoryService.ts` | `MemoryToolName`, `ToolCallArgs`, `ToolExecutionContext`, and `executeMemoryTool()` |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Behavioral instructions telling Kayley when to use the tool |

Files you usually do **not** need to edit:

| File | Why |
|---|---|
| `server/services/ai/toolBridge.ts` | Automatically exposes everything in `GeminiMemoryToolDeclarations` to the SDK |
| `server/services/ai/serverGeminiService.ts` | Automatically derives the pseudo-tool guardrail from `GeminiMemoryToolDeclarations` |

Only touch those server files if your tool needs special bridge behavior or extra per-turn execution context.

---

## Step 1 - Declare the Tool in `aiSchema.ts`

Open `src/services/aiSchema.ts` and add a new entry to `GeminiMemoryToolDeclarations`.

Minimal template:

```ts
{
  name: "your_tool_name",
  description:
    "Describe when Kayley should call this tool. " +
    "Name real trigger situations so Gemini can choose it correctly.",
  parameters: {
    type: "object",
    properties: {
      param_one: {
        type: "string",
        description: "What this means.",
      },
      mode: {
        type: "string",
        enum: ["option_a", "option_b"],
        description: "Allowed values and when to use each one.",
      },
      optional_note: {
        type: "string",
        description: "Optional extra detail.",
      },
    },
    required: ["param_one", "mode"],
  },
},
```

Rules:
- `name` must be flat `snake_case`.
- `description` is model-facing. Write it for Gemini's tool-selection behavior, not for humans.
- Keep `required` minimal. Over-required params cause bad calls or no calls.
- `GeminiMemoryToolDeclarations` must use raw JSON-schema-like objects. Do not put `z.object(...)` directly in the declaration.

Important nuance:
- `aiSchema.ts` also contains Zod schemas and helper types for many tools. Keeping that pattern is good for consistency, but the Gemini SDK bridge itself reads `GeminiMemoryToolDeclarations`.

---

## Step 2 - Add the Name to `MemoryToolName`

Open `src/services/memoryService.ts` and add your tool to `MemoryToolName`.

```ts
export type MemoryToolName =
  | 'recall_memory'
  | 'store_user_info'
  | 'your_tool_name';
```

---

## Step 3 - Add the Args to `ToolCallArgs`

In the same file, add the argument shape to `ToolCallArgs`.

```ts
export interface ToolCallArgs {
  your_tool_name: {
    param_one: string;
    mode: 'option_a' | 'option_b';
    optional_note?: string;
  };
}
```

This shape should mirror the schema you declared in Step 1.

If your tool needs extra runtime context that is not passed in args (for example the current user message), update `ToolExecutionContext` too.

---

## Step 4 - Implement the Switch Case in `executeMemoryTool()`

Add a new `case` in `src/services/memoryService.ts`.

Template:

```ts
case 'your_tool_name': {
  const { param_one, mode, optional_note } =
    args as ToolCallArgs['your_tool_name'];
  const toolLog = clientLogger.scoped('YourTool');

  toolLog.info('your_tool_name called', {
    param_one,
    mode,
    hasOptionalNote: !!optional_note,
  });

  try {
    const result = await yourImplementation(param_one, mode, optional_note);

    if (!result.ok) {
      return formatToolFailure(
        `your_tool_name failed: ${result.reason}`
      );
    }

    return `Success: ${result.summary}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toolLog.error('your_tool_name crashed', { error: message });
    return formatToolFailure(`your_tool_name failed: ${message}`);
  }
}
```

Rules:
- Cast through `ToolCallArgs['your_tool_name']`, not `any`.
- Return a plain string. `toolBridge.ts` wraps it into `functionResponse.response.result`.
- Use `clientLogger.scoped('YourTool')` for logs. Avoid bare `console.log()` for new tool work.
- For business or validation failures, prefer returning `formatToolFailure(...)`.
- Catch your own errors when you can and return a failure string.

Very important: current failure semantics
- `TOOL_FAILED:` is a model-visible failure string convention coming from `memoryService.ts`.
- `toolBridge.ts` does **not** inspect returned `TOOL_FAILED:` strings.
- `toolBridge.ts` increments `failureCount` only when `executeMemoryTool()` throws all the way out to the bridge.
- Because of that, a returned `TOOL_FAILED: ...` string will still show up in bridge logs as a completed tool call, not a bridge exception.

Practical guidance:
- Use returned failure strings for normal, expected failures you want Gemini to reason about.
- Do not rely on bridge-level `failureCount` for ordinary tool validation errors.

---

## Step 5 - Document When Kayley Should Use It

Open `src/services/system_prompts/tools/toolsAndCapabilities.ts` and add a numbered rule section for the tool.

Template:

```ts
NN. YOUR TOOL NAME (your_tool_name):
   - Use when: concrete trigger situations.
   - Do NOT use when: common false positives.
   - Important args:
     - mode="option_a" -> when X
     - mode="option_b" -> when Y
   - Example: natural-language example of a real user request.
   - Limit: any usage cap or caution.
```

Write this section as prompt policy for Kayley, not developer docs.

What matters most here:
- clear triggers
- clear non-triggers
- any safety boundaries
- any argument disambiguation Gemini tends to get wrong

---

## Step 6 - Optional: Bridge Hooks or Extra Context

Most tools stop at Steps 1-5.

Only edit `server/services/ai/toolBridge.ts` if the tool needs bridge-only behavior such as:
- server-only side effects after a successful tool call
- policy interception before execution
- cross-tool accounting
- extra retry or recovery behavior

Only edit `server/services/ai/serverGeminiService.ts` if the tool needs extra context passed into `createCallableTools(...)`.

Example shape:

```ts
export interface ToolExecutionContext {
  currentEvents?: Array<{ id: string; summary: string }>;
  userMessage?: string;
  yourExtraContext?: string;
}
```

Then pass that context when calling `createCallableTools(...)`.

---

## Step 7 - Optional: New Database Table or Column

If the tool needs new storage:

1. Create a migration in `supabase/migrations/YYYYMMDD_description.sql`
2. Follow the repo's existing schema conventions
3. Do **not** execute the migration from the agent workflow in this repo
4. Have it applied through the normal human/operator database workflow before relying on it

This repo allows creating migrations, but not executing DB mutations from the coding agent workflow.

---

## Verification Checklist

### 1. Add a declaration test

Prefer a focused Vitest over temporary debug logs.

Example pattern:

```ts
import { describe, expect, it } from 'vitest';
import { GeminiMemoryToolDeclarations } from '../aiSchema';

describe('aiSchema your_tool_name declaration', () => {
  it('declares the expected fields', () => {
    const decl = GeminiMemoryToolDeclarations.find(
      (entry) => entry.name === 'your_tool_name'
    );

    expect(decl).toBeDefined();
    expect(decl?.parameters?.properties).toHaveProperty('param_one');
    expect(decl?.parameters?.properties).toHaveProperty('mode');
  });
});
```

Suggested location:
- `src/services/__tests__/aiSchemaYourTool.test.ts`

### 2. Add a handler test if logic branches

If the tool has confirmation flow, validation gates, side effects, or branching behavior, add a focused `executeMemoryTool()` test.

Suggested location:
- `src/services/__tests__/memoryService.yourTool.test.ts`

### 3. Type-check

```bash
npx tsc --noEmit
```

### 4. Run targeted tests

```bash
npm test -- --run
```

Or run a narrower Vitest command if you only added one or two tests.

### 5. Verify runtime logs after a real call

Check `server_runtime_logs` for bridge activity:

```sql
SELECT occurred_at, severity, source, message, details
FROM server_runtime_logs
WHERE source = 'toolBridge'
  AND details->>'tool' = 'your_tool_name'
ORDER BY occurred_at DESC
LIMIT 10;
```

What to expect:
- `Executing tool via bridge`
- `tool_call_summary`

Interpretation note:
- `tool_call_summary` with `status = 'success'` means the bridge call completed without a thrown exception.
- It does **not** necessarily mean your tool returned a business success string.
- If your handler returns `TOOL_FAILED: ...`, inspect the actual returned content too.

### 6. Verify your handler logs

If you used `clientLogger.scoped('YourTool')`, confirm those entries are present:

```sql
SELECT occurred_at, message, details
FROM server_runtime_logs
WHERE source = 'YourTool'
ORDER BY occurred_at DESC
LIMIT 10;
```

### 7. Verify pseudo-tool protection still works

No code change is normally required here.

`serverGeminiService.ts` derives the pseudo-tool guardrail from `GeminiMemoryToolDeclarations`, so your new tool name is automatically included in the retry check that catches fake JSON tool keys.

### 8. Exercise edge cases

At minimum test:
- missing required args
- wrong enum/value combinations
- upstream service unavailable
- empty or whitespace-only inputs
- duplicate or idempotent operations

---

## Common Mistakes

| Mistake | Consequence |
|---|---|
| Forgot to add the tool to `MemoryToolName` | TypeScript breaks at the switch boundary |
| Forgot to add the tool to `ToolCallArgs` | You lose typed args and the case becomes brittle |
| Added the declaration but forgot prompt guidance | Gemini under-uses or misuses the tool |
| Marked too many params as required | Gemini avoids the tool or emits bad calls |
| Put `z.object(...)` directly in `GeminiMemoryToolDeclarations` | The SDK bridge cannot use that declaration shape correctly |
| Assumed `TOOL_FAILED:` increments bridge `failureCount` | It does not in the current implementation |
| Threw from the handler expecting normal retry behavior | The bridge treats that as an execution exception, not a normal tool result |
| Added a tool that needs `userMessage` or other context but did not update `ToolExecutionContext` / `createCallableTools(...)` call sites | The handler cannot see the data it depends on |
| Created a migration and assumed the agent should run it | Conflicts with repo safety rules |

---

## Quick Reference

Typical new Gemini function tool work:

1. `src/services/aiSchema.ts`
   - add `GeminiMemoryToolDeclarations` entry
   - optionally add matching Zod schema/type for consistency
2. `src/services/memoryService.ts`
   - add `MemoryToolName`
   - add `ToolCallArgs`
   - optionally extend `ToolExecutionContext`
   - add `executeMemoryTool()` case
3. `src/services/system_prompts/tools/toolsAndCapabilities.ts`
   - add usage policy so Kayley knows when to call it
4. Optional:
   - `server/services/ai/toolBridge.ts` for bridge-only hooks
   - `server/services/ai/serverGeminiService.ts` for extra per-turn context
   - `supabase/migrations/*` for schema changes
   - `src/services/__tests__/*` for declaration and handler tests

That is the real path for the current Gemini SDK pipeline.
