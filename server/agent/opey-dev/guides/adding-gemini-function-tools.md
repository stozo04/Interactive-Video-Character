# Guide: Adding a New Gemini Function Tool

This is the canonical step-by-step process for wiring a new callable function tool into Kayley's Gemini pipeline. Follow every step in order. Do not skip sections.

---

## Background: How the Plumbing Works

When Kayley calls a tool, the flow is:

```
Gemini model → toolBridge.ts (callTool) → executeMemoryTool() → your handler
```

Three files own the contract:

| File | What it owns |
|---|---|
| `src/services/aiSchema.ts` | Tool declaration (name, description, parameters schema) |
| `src/services/memoryService.ts` | `MemoryToolName` union + `ToolCallArgs` interface + `case` in `executeMemoryTool()` |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | How Kayley is instructed to use the tool |

`toolBridge.ts` wires `GeminiMemoryToolDeclarations` (from `aiSchema.ts`) into the SDK's `CallableTool`. It does NOT need to be touched for a new tool unless your tool needs special post-execution logic (like the shadow classifier that runs after `store_user_info`).

---

## Step 1 — Declare the Tool in `aiSchema.ts`

Open `src/services/aiSchema.ts` and find `GeminiMemoryToolDeclarations` (around line 947). Add a new entry to the array.

**Template:**
```typescript
{
  name: "your_tool_name",
  description:
    "One paragraph describing WHEN Kayley should call this, not what it does internally. " +
    "Include example triggers ('use when the user asks about X'). " +
    "Be specific enough that Gemini won't hallucinate calls to it.",
  parameters: {
    type: "object",
    properties: {
      param_one: {
        type: "string",
        description: "What this param means. Include allowed values if it's an enum.",
      },
      param_two: {
        type: "string",
        enum: ["option_a", "option_b"],
        description: "Describe each option.",
      },
      optional_param: {
        type: "string",
        description: "Describe when this is needed vs omitted.",
      },
    },
    required: ["param_one", "param_two"], // only truly required params go here
  },
},
```

**Rules:**
- `name` must be a snake_case string with no spaces.
- `description` is what Gemini reads to decide whether to call this tool. Write it for the model, not for a human.
- Keep `required` minimal — Gemini will error if it can't satisfy required params.
- Do NOT use `z.object()` here. The Gemini SDK expects raw JSON Schema objects, not Zod schemas.

---

## Step 2 — Add to `MemoryToolName` Union in `memoryService.ts`

Open `src/services/memoryService.ts` and find the `MemoryToolName` type (around line 1313). Add your tool name as a new union member:

```typescript
export type MemoryToolName =
  | 'recall_memory'
  | 'store_user_info'
  // ... existing entries ...
  | 'your_tool_name';  // <-- add here
```

---

## Step 3 — Add to `ToolCallArgs` Interface in `memoryService.ts`

In the same file, find the `ToolCallArgs` interface (just below `MemoryToolName`). Add a typed entry for your tool's arguments:

```typescript
export interface ToolCallArgs {
  // ... existing entries ...
  your_tool_name: {
    param_one: string;
    param_two: 'option_a' | 'option_b';
    optional_param?: string;
  };
}
```

The shape here must exactly mirror the `parameters` you declared in Step 1. TypeScript will catch mismatches at the `case` handler in Step 4.

---

## Step 4 — Add a `case` in `executeMemoryTool()` in `memoryService.ts`

Find the `executeMemoryTool` switch statement (look for `case 'recall_memory':` around line 2214 to find the right block). Add your case **before** the `default:` fallthrough:

```typescript
case 'your_tool_name': {
  const { param_one, param_two, optional_param } = args as ToolCallArgs['your_tool_name'];

  // Your implementation. This runs server-side — Supabase, gogcli, filesystem, etc. are all available.
  // Use clientLogger scoped to your tool name for structured logging.
  const log = clientLogger.scoped('YourToolName');
  log.info('Tool called', { param_one, param_two });

  try {
    const result = await yourActualImplementation(param_one, param_two, optional_param);
    return result ? `✓ Done: ${result}` : 'Operation failed.';
  } catch (err) {
    log.error('Tool failed', { error: err instanceof Error ? err.message : String(err) });
    return `${TOOL_FAILURE_PREFIX} your_tool_name failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
```

**Rules:**
- Cast `args` through `ToolCallArgs['your_tool_name']` — never `any`.
- Return a plain string. The SDK wraps it in `functionResponse.response.result` automatically.
- Prefix failure returns with `TOOL_FAILURE_PREFIX` (`'TOOL_FAILED:'`) — `toolBridge.ts` uses this to detect and count failures for the retry loop.
- Never throw from this handler. Catch internally and return an error string.
- Use `clientLogger.scoped('YourToolName')` for logging — never bare `console.log()`.

---

## Step 5 — Document the Tool in `toolsAndCapabilities.ts`

Open `src/services/system_prompts/tools/toolsAndCapabilities.ts`. This file is injected into every system prompt and is Kayley's cheat sheet for how to use tools.

Find the numbered list of tool sections. Add a new numbered entry (increment from the highest existing number):

```typescript
// Inside the template string, add:
`
NN. YOUR TOOL NAME (your_tool_name):
   - Use when: [concrete trigger scenarios — what does Steven say or do that should prompt this call?]
   - Do NOT use when: [false positive scenarios to prevent over-calling]
   - param_two options:
     - "option_a": use for X
     - "option_b": use for Y
   - Example: [show a realistic call scenario in plain English]
   - Limit: [any rate-limiting guidance, e.g., "at most once per conversation"]
`
```

Write this section as behavioral instructions for Kayley, not documentation for a developer.

---

## Step 6 — (If Needed) Add Post-Execution Logic to `toolBridge.ts`

Most tools need nothing here. Only touch `toolBridge.ts` if your tool requires side effects AFTER successful execution — for example:

- Triggering a mutation signal (like `consumeTaskMutationSignal`)
- Running a classifier
- Firing a secondary async action

If needed, add it inside the `callTool` success path, after the `executeMemoryTool` call:

```typescript
// Inside toolBridge.ts → callTool → success branch:
if (toolName === 'your_tool_name') {
  // your post-execution logic
}
```

---

## Step 7 — (If Needed) Add a Supabase Migration

If your tool reads from or writes to a new table:

1. Create `supabase/migrations/YYYYMMDD_description.sql`
2. Follow the existing convention: `uuid_generate_v4()`, `timestamptz`, `CHECK` constraints, `update_updated_at_column` trigger
3. Run it against your local/staging DB before testing

---

## Testing Checklist

### 1. TypeScript Compiles Clean
```bash
npx tsc --noEmit
```
Fix any type errors before moving on. The `ToolCallArgs` cast in Step 4 will surface schema mismatches here.

### 2. Tool Appears in the SDK Declaration
Add a temporary log in `toolBridge.ts` to verify the tool is included:
```typescript
// Temporarily in createCallableTools():
console.log('Declared tools:', GeminiMemoryToolDeclarations.map(d => d.name));
```
Confirm your tool name appears. Remove the log after verifying.

### 3. Happy Path — Kayley Calls It Correctly
Start the server and send a message that should trigger the tool. Check `server_runtime_logs`:
```sql
SELECT occurred_at, severity, source, message, details
FROM server_runtime_logs
WHERE source = 'toolBridge'
  AND details->>'tool' = 'your_tool_name'
ORDER BY occurred_at DESC
LIMIT 10;
```
Confirm you see `"Executing tool via bridge"` and `"tool_call_summary"` with `status: "success"`.

### 4. Handler Logs
Confirm your `clientLogger.scoped('YourToolName')` entries appear in `server_runtime_logs`:
```sql
SELECT occurred_at, message, details
FROM server_runtime_logs
WHERE source = 'YourToolName'
ORDER BY occurred_at DESC
LIMIT 10;
```

### 5. Error Path
Force a failure (e.g., pass invalid args or simulate a DB error) and confirm:
- The tool returns a `TOOL_FAILED:` prefixed string
- `toolBridge.ts` increments `failureCount` and returns the retry feedback to Gemini
- Gemini does NOT crash the turn — she receives the error and responds appropriately

### 6. Verify No Regression on Existing Tools
After adding a new tool, confirm the existing tools still work. Send a message that triggers `recall_memory` or `store_user_info` and verify the `tool_call_summary` logs look normal.

### 7. Edge Cases Specific to Your Tool
- What happens with empty/null inputs?
- What happens if the external service (Supabase, gogcli, etc.) is unavailable?
- What happens if Gemini passes unexpected arg types?

---

## Common Mistakes

| Mistake | Consequence |
|---|---|
| Forgot to add to `MemoryToolName` union | TypeScript error in `executeMemoryTool` switch |
| Forgot to add to `ToolCallArgs` | `args as ToolCallArgs['your_tool_name']` produces `never` type errors |
| Used Zod schema in `GeminiMemoryToolDeclarations` | Gemini SDK can't serialize it; function declarations break silently |
| Threw an exception from the handler | `toolBridge.ts` catches it but the turn may behave unexpectedly; always return error strings |
| Bare `console.log()` in handler | Logs go to terminal only — disappear from `server_runtime_logs` where Kayley can self-audit |
| Didn't document in `toolsAndCapabilities.ts` | Kayley won't know when to call it; she'll under-use or misuse it |
| Declared a param as `required` that Gemini can't always fill | Gemini errors on function call, tool never executes |

---

## Quick Reference: Files to Touch

For a typical new tool (no new DB table):

1. `src/services/aiSchema.ts` — add to `GeminiMemoryToolDeclarations` array
2. `src/services/memoryService.ts` — add to `MemoryToolName` union, `ToolCallArgs` interface, `executeMemoryTool` switch
3. `src/services/system_prompts/tools/toolsAndCapabilities.ts` — add numbered section

That's it. `toolBridge.ts` picks up new tools automatically via `GeminiMemoryToolDeclarations`.
