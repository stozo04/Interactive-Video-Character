# Convert A Tool To Function Calling (Step-By-Step)

## Goal
This guide shows exactly how to convert one tool to true SDK function calling.

I will use `recall_character_profile` as the concrete example, but the same process applies to:

- `workspace_action`
- `cron_job_action`
- `delegate_to_engineering`
- `get_engineering_ticket_status`

---

## First: What "function call" means in this repo

There are two different execution paths:

1. Function calling path (real tool execution):
- Model emits a `function_call`.
- `server/services/ai/toolBridge.ts` receives it.
- `src/services/memoryService.ts` runs the tool logic in `executeMemoryTool(...)`.
- Tool result is fed back to the model by the SDK.

2. JSON response field path (not a function call):
- Model returns JSON fields like `selfie_action`, `video_action`, `gif_action`.
- App/orchestrator reads the JSON and triggers UI behavior.

Use function calls for data access and side effects.  
Use JSON fields for presentation/UI behaviors.

---

## Example Conversion: `recall_character_profile`

If a tool is not yet function-call based (or is inconsistent), do these steps in order.

### Step 1) Add/confirm argument schema in `aiSchema.ts`

File: `src/services/aiSchema.ts`

Make sure the Zod schema exists:

```ts
export const RecallCharacterProfileSchema = z.object({
  section: z.enum([
    "background",
    "interests",
    "relationships",
    "challenges",
    "quirks",
    "goals",
    "preferences",
    "anecdotes",
    "routines",
    "full",
  ]),
  reason: z.string().optional(),
});
```

Then export the args type:

```ts
export type RecallCharacterProfileArgs = z.infer<typeof RecallCharacterProfileSchema>;
```

Why this matters:
- This is your source of truth for tool argument validation/shape.

---

### Step 2) Add/confirm tool declaration for Gemini

File: `src/services/aiSchema.ts`

Inside `GeminiMemoryToolDeclarations`, ensure a function declaration exists:

```ts
{
  name: "recall_character_profile",
  description: "...",
  parameters: {
    type: "object",
    properties: {
      section: { type: "string", enum: [...] },
      reason: { type: "string" }
    },
    required: ["section"]
  }
}
```

Why this matters:
- If it is not declared here, the model cannot call it via SDK tools.

---

### Step 3) Add/confirm union typing for tool args

File: `src/services/aiSchema.ts`

Ensure `MemoryToolArgs` includes:

```ts
| { tool: "recall_character_profile"; args: RecallCharacterProfileArgs }
```

Why this matters:
- Keeps compile-time safety and prevents hidden drift.

---

### Step 4) Add/confirm runtime tool name and args in `memoryService.ts`

File: `src/services/memoryService.ts`

Ensure `MemoryToolName` includes:

```ts
| "recall_character_profile"
```

Ensure `ToolCallArgs` includes:

```ts
recall_character_profile: {
  section: "background" | "interests" | "relationships" | "challenges" |
           "quirks" | "goals" | "preferences" | "anecdotes" | "routines" | "full";
  reason?: string;
};
```

Why this matters:
- `executeMemoryTool(...)` dispatch depends on these exact unions.

---

### Step 5) Implement execution branch

File: `src/services/memoryService.ts`

Inside `executeMemoryTool(...)`, add:

```ts
case "recall_character_profile": {
  const { section, reason } = args as ToolCallArgs["recall_character_profile"];
  const { getCharacterProfileSection } = await import("./characterProfileService");
  const profileText = await getCharacterProfileSection(section, reason);
  return profileText || "No character profile details found for that section.";
}
```

Why this matters:
- This is where the actual function call does real work.

---

### Step 6) Make prompt instructions explicit: function call, not JSON field

File: `src/services/system_prompts/tools/toolsAndCapabilities.ts`

Add a direct rule in tool-follow-through language:

- "Function tools must be invoked as actual tool calls."
- "Do not put tool names as top-level keys in output JSON."

Why this matters:
- Reduces "fake tool call" behavior where model claims action without execution.

---

### Step 7) Add a server-side guardrail for pseudo-tool JSON

File: `server/services/ai/serverGeminiService.ts`

Recommended guard pattern:
- Parse model JSON response.
- Detect top-level keys that match function tool names.
- If detected without tool usage tokens, retry once with a strict correction prompt.
- If still broken, return an honesty failure response.

Why this matters:
- Gives you a hard reliability layer even when prompt adherence slips.

---

### Step 8) Keep output schema clean

File: `src/services/system_prompts/format/outputFormat.ts`

Do not add tool names like `recall_character_profile` to the final response JSON schema.
That schema should contain user-facing output fields only.

Why this matters:
- If tool names appear in response schema, the model will try to "output" them instead of calling them.

---

## Verification Checklist

Run these after changes:

1. `npm run build`
2. Trigger a prompt that should force this tool call, for example:
- "What do you remember about your routines?"
3. Inspect logs:
- `toolBridge` should log tool execution.
- `memoryService` should log `Executing: recall_character_profile`.
4. Confirm final user message references actual tool result content.

Optional hard test:
- Force a response that includes a fake top-level `recall_character_profile` key and verify server retry guard catches it.

### How to confirm it was a REAL Gemini function call

You should see **all** of these signals in logs for the same turn:

1. Tool bridge invocation (SDK level)
- `server/services/ai/toolBridge.ts` logs:
  - `Executing tool via bridge`

2. Memory tool execution (runtime level)
- `src/services/memoryService.ts` logs:
  - `🔧 [Memory Tool] Executing: <tool_name>`

3. Function-call telemetry (Gemini usage metadata)
- `server/services/ai/serverGeminiService.ts` logs:
  - `gemini_function_call_signal`
  - `function_call_used: true`
  - `toolUsePromptTokenCount: <number > 0>`

Important:
- `findPseudoToolKeys(...)` is a **guardrail in your code**, not a Gemini mode.
- It only checks if the model tried to output tool names in JSON instead of calling tools.

---

## Common mistakes to avoid

1. Tool declared but not implemented in `executeMemoryTool`.
2. Added to declaration but missing from unions (`MemoryToolName` or `ToolCallArgs`).
3. Accidentally adding tool names to final output JSON format docs.
4. Relying only on prompt wording without runtime guardrails.
5. Claiming success in `text_response` when tool never ran.

---

## Quick decision rule for your project

Use function call for:
- Memory fetch/store
- Calendar/task/email/google CLI operations
- File/database operations
- Any action with side effects or truth-sensitive retrieval

Use JSON output field for:
- UI media intents (`selfie_action`, `video_action`, `gif_action`)
- App-level rendering/navigation hints

If you are unsure, default to function call.

---

## Completed Conversions

### `submit_clarification` (completed 2026-03-07)

**What was done:**
- All steps already wired (`SubmitClarificationSchema`, `GeminiMemoryToolDeclarations`, `MemoryToolArgs`, `MemoryToolName`, `ToolCallArgs`, clean case block with `{ }` braces).
- Replaced 1 `console.log` with `memoryToolLog.info` (logs `ticket_id` only, not the full args which may contain user response text).

---

### `tool_suggestion` (completed 2026-03-07)

**What was done:**
- All steps already wired (`ToolSuggestionSchema`, `GeminiMemoryToolDeclarations`, `MemoryToolArgs`, `MemoryToolName`, `ToolCallArgs`, clean `executeMemoryTool` case with `{ }` braces).
- Replaced 5 `console.*` calls with `memoryToolLog.*` (`info` for entry log, `warning` for validation failures).

---

### Storage/Retrieval batch (completed 2026-03-07)

**Tools:** `store_user_info`, `store_daily_note`, `retrieve_daily_notes`, `store_monthly_note`, `retrieve_monthly_notes`, `store_lessons_learned`, `retrieve_lessons_learned`, `mila_note`, `retrieve_mila_notes`, `store_character_info`, `resolve_idle_question`, `resolve_idle_browse_note`

**What was done:**
- All 12 tools: already fully wired (Zod schemas, `GeminiMemoryToolDeclarations`, `MemoryToolArgs`, `MemoryToolName`, `ToolCallArgs`, `executeMemoryTool` cases with proper `{ }` braces, no `import.meta.env` issues).
- 4 already clean (`store_lessons_learned`, `retrieve_lessons_learned`, `store_character_info`, `resolve_idle_browse_note`) — no changes.
- Added `const memoryToolLog = clientLogger.scoped('MemoryTool')` to `memoryService.ts`.
- Replaced 9 `console.*` calls across 8 tools with `memoryToolLog.*`.

---

### `recall_user_info` (completed 2026-03-07)

**What was done:**
- All 5 steps already complete: `RecallUserInfoSchema` Zod type, `GeminiMemoryToolDeclarations` entry, `MemoryToolArgs`/`MemoryToolName`/`ToolCallArgs` unions, clean `executeMemoryTool` case (proper braces, no `console.*`, no Vite env vars).
- Added `recall_user_info` and `recall_memory` to section 16 anti-fake-call example list in `toolsAndCapabilities.ts`.

---

### `web_search` (completed 2026-03-07)

**What was done:**
- Added `WebSearchSchema` Zod type + `WebSearchArgs` export to `aiSchema.ts`
- `MemoryToolArgs` union updated to use `WebSearchArgs` instead of inline `{ query: string }`
- Function declaration already existed in `GeminiMemoryToolDeclarations` (no change needed)
- `MemoryToolName` and `ToolCallArgs` already correct in `memoryService.ts` (no change needed)
- Fixed `case "web_search"` block in `executeMemoryTool`:
  - Added `{ }` braces for proper scoping
  - Replaced `import.meta.env.VITE_TAVILY_API_KEY` with `process.env.TAVILY_API_KEY`
  - Replaced `console.log`/`console.error` with `clientLogger.scoped('WebSearch')`
- Renamed env var `VITE_TAVILY_API_KEY` → `TAVILY_API_KEY` in `.env.local`
- Added section 13 "WEB SEARCH (FUNCTION TOOL)" to `toolsAndCapabilities.ts`

---

### Engineering + Workspace batch (completed 2026-03-07)

**Tools:** `workspace_action`, `cron_job_action`, `delegate_to_engineering`, `get_engineering_ticket_status`

**What was done:**
- All 4 tools already wired end-to-end:
  - Zod schema + args types in `aiSchema.ts`
  - Gemini declaration in `GeminiMemoryToolDeclarations`
  - `MemoryToolArgs` union
  - `PendingToolCall.name` union
  - `MemoryToolName` + `ToolCallArgs` + `executeMemoryTool` case in `memoryService.ts`
- Logging cleanup:
  - replaced remaining `console.log` usage in these cases with `memoryToolLog.info` structured logs
  - fields are intentionally summarized (no noisy full payload dumps)
