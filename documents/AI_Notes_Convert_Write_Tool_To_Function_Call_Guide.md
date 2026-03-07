# Convert A Write Tool To Function Calling (Step-By-Step)

## Goal
This guide teaches how to convert a **write/mutation tool** to true SDK function calling, with safety and reliability.

Concrete example in this guide: `store_daily_note`.

You can apply the same pattern to other write tools:

- `store_user_info`
- `store_character_info`
- `store_monthly_note`
- `store_lessons_learned`
- `mila_note`
- `workspace_action`
- `cron_job_action`
- `delegate_to_engineering`

---

## Why write tools should be function calls

Write tools change state. If you rely on plain response JSON fields, the model can claim success without actual execution.

Function calling gives you:

1. Real execution via `toolBridge` and `executeMemoryTool(...)`
2. Observable logs
3. Deterministic return messages to the model
4. Better "don’t claim success unless tool result confirms success" behavior

---

## Repo architecture recap

Function call pipeline:

1. Tool declaration in `src/services/aiSchema.ts`
2. SDK exposes declarations through `server/services/ai/toolBridge.ts`
3. Runtime execution in `src/services/memoryService.ts` (`executeMemoryTool`)
4. Result fed back to model by SDK automatic function calling

Do not confuse this with output JSON fields in `AIActionResponse` (UI response payload).

---

## Step-by-step conversion (`store_daily_note`)

### Step 1) Define/confirm Zod schema

File: `src/services/aiSchema.ts`

```ts
export const StoreDailyNoteSchema = z.object({
  note: z.string().describe(
    "A short note to append as a single bullet line (no dates or timestamps)."
  ),
});
```

And type:

```ts
export type StoreDailyNoteArgs = z.infer<typeof StoreDailyNoteSchema>;
```

Why:
- Enforces tool argument shape.

---

### Step 2) Add/confirm Gemini function declaration

File: `src/services/aiSchema.ts`

Inside `GeminiMemoryToolDeclarations`, make sure this exists:

```ts
{
  name: "store_daily_note",
  description: "...",
  parameters: {
    type: "object",
    properties: {
      note: { type: "string", description: "..." }
    },
    required: ["note"]
  }
}
```

Why:
- If it is not in declarations, SDK can’t call it.

---

### Step 3) Add/confirm union typing

File: `src/services/aiSchema.ts`

```ts
| { tool: "store_daily_note"; args: StoreDailyNoteArgs }
```

Why:
- Keeps compile-time coverage across tool plumbing.

---

### Step 4) Add/confirm runtime tool name and args shape

File: `src/services/memoryService.ts`

`MemoryToolName` must include:

```ts
| "store_daily_note"
```

`ToolCallArgs` must include:

```ts
store_daily_note: {
  note: string;
};
```

Why:
- Dispatch and type-safe args both depend on this.

---

### Step 5) Implement write logic in `executeMemoryTool(...)`

File: `src/services/memoryService.ts`

```ts
case "store_daily_note": {
  const { note } = args as ToolCallArgs["store_daily_note"];
  const { appendDailyNote } = await import("./dailyNotesService");
  const ok = await appendDailyNote(note);
  return ok
    ? `Stored daily note: "${note}"`
    : "Failed to store daily note.";
}
```

Write-tool requirements:

1. Validate required fields
2. Return explicit success/failure text
3. Catch and format exceptions (no silent failure)

---

### Step 6) Prompt instructions: call tool, don’t fake JSON key

File: `src/services/system_prompts/tools/toolsAndCapabilities.ts`

Use explicit language like:

- "Function tools must be invoked as actual tool calls."
- "Do not put `store_daily_note` as a top-level key in output JSON."

Why:
- Prevents pseudo-tool responses.

---

### Step 7) Keep output schema focused on user response fields

File: `src/services/system_prompts/format/outputFormat.ts`

Do not add `store_daily_note` to the output JSON schema.
That schema is for user-visible payload fields, not function tools.

Why:
- If you add tool names there, model tends to emit keys instead of invoking functions.

---

### Step 8) Add/confirm server-side pseudo-tool guardrail

File: `server/services/ai/serverGeminiService.ts`

Recommended behavior:

1. Parse model JSON response
2. Detect tool-name keys in output JSON
3. If detected and no SDK tool tokens used:
   - reprompt once with correction
4. If still wrong:
   - return honest failure response (do not claim completion)

Why:
- This protects write paths from hallucinated completion.

---

## Verification checklist

1. `npm run build`
2. Send a message that should trigger the write tool:
   - "Make a daily note that I scheduled pizza with Andre."
3. Confirm logs:
   - `toolBridge` execution log for `store_daily_note`
   - `memoryService` execution log for `store_daily_note`
4. Confirm follow-up behavior references persisted note correctly.
5. Negative test:
   - force fake JSON key `store_daily_note` in output and confirm retry guard catches it.

---

## Safety checklist for write tools

Use this for every mutation tool:

1. Require minimal but sufficient inputs
2. Reject ambiguous payloads clearly
3. Return explicit success/failure text
4. Never imply success without positive result
5. Log tool name + key args + result status
6. Add deterministic error formatting for model feedback

---

## Optional: stricter write policy

For higher-trust mutation tools (`workspace_action`, delete-like operations):

- Add allowlists (actions, paths, services)
- Add blocked subcommands
- Require explicit confirmations for destructive operations
- Distinguish read-only subcommands from write subcommands

This pattern is already used in `server/services/gogService.ts` for `google_cli`.
