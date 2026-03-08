# AI Schema Workflow

**Primary file:** `src/services/aiSchema.ts`
**Related runtime files:** `src/services/memoryService.ts`, `server/services/ai/toolBridge.ts`, `server/services/ai/serverGeminiService.ts`

---

## Overview

`aiSchema.ts` defines two different contracts that Gemini works with:

1. `AIActionResponseSchema`
   - the final JSON response Kayley returns to the app
2. `GeminiMemoryToolDeclarations`
   - the callable function tools Gemini can invoke during generation

Those two mechanisms solve different problems and should not be mixed up.

---

## Two Mechanisms

### 1. Response Schema Fields

These are fields in the final JSON payload returned after Gemini finishes the turn.

Example shape:

```ts
export const AIActionResponseSchema = z.object({
  text_response: z.string(),
  user_transcription: z.string().nullable().optional(),
  open_app: z.string().nullable().optional(),
  selfie_action: z.object({
    scene: z.string(),
    mood: z.string().optional(),
  }).nullable().optional(),
  gif_action: z.object({
    query: z.string(),
    message_text: z.string().optional(),
  }).nullable().optional(),
  almost_moment_used: z.object({
    feeling_id: z.string(),
    stage: z.enum(['micro_hint', 'near_miss', 'obvious_unsaid', 'almost_confession']),
    expression_used: z.string(),
  }).nullable().optional(),
});
```

Characteristics:
- returned once at the end of the model turn
- no function-call feedback loop
- best for output content tightly coupled to the reply itself
- parsed by the chat service after Gemini responds

Use response fields when:
- the action is part of the final reply payload
- the server processes it after the model has finished
- Gemini does not need tool feedback before writing the reply

Good examples:
- `selfie_action`
- `gif_action`
- `video_action`
- `open_app`
- `almost_moment_used`

### 2. Function Tools

These are tools Gemini can call while it is still reasoning through the turn.

Example shape:

```ts
export const GeminiMemoryToolDeclarations = [
  {
    name: 'store_user_info',
    description: 'Save an important fact about the user...',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['category', 'key', 'value'],
    },
  },
];
```

Runtime flow:

```text
Gemini SDK chat session
  -> toolBridge.createCallableTools()
  -> toolBridge.callTool(functionCalls)
  -> memoryService.executeMemoryTool(toolName, args, context)
  -> result string returned to Gemini
  -> Gemini continues and emits final JSON
```

Characteristics:
- callable mid-generation
- Gemini receives the tool result before finishing the response
- best for retrieval, writes, commands, and operations that need explicit execution
- exposed to Gemini through `server/services/ai/toolBridge.ts`

Use tools when:
- Gemini must read or write data
- the tool result changes what Gemini says next
- the operation is an intentional command
- you want explicit execution rather than a best-effort optional field

Good examples:
- `recall_memory`
- `recall_user_info`
- `store_user_info`
- `calendar_action`
- `google_task_action`
- `email_action`
- `query_database`

---

## Current Gemini Runtime Path

The live Gemini integration is built around these files:

| File | Role |
|---|---|
| `src/services/aiSchema.ts` | Declares `AIActionResponseSchema` and `GeminiMemoryToolDeclarations` |
| `src/services/memoryService.ts` | Defines `MemoryToolName`, `ToolCallArgs`, `ToolExecutionContext`, and `executeMemoryTool()` |
| `server/services/ai/toolBridge.ts` | Adapts tool declarations + execution to the Gemini SDK `CallableTool` interface |
| `server/services/ai/serverGeminiService.ts` | Creates the chat session, passes tools, and applies pseudo-tool retry protection |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Teaches Kayley when to call which tools |
| `src/services/system_prompts/format/outputFormat.ts` | Explicitly forbids returning tool names as JSON keys |

Important:
- `toolBridge.ts` exposes tools automatically from `GeminiMemoryToolDeclarations`.
- `serverGeminiService.ts` also derives pseudo-tool detection from the same declarations.
- For a normal new Gemini tool, you usually do not edit `toolBridge.ts` or `serverGeminiService.ts`.

---

## Current Response Fields

These are the main fields currently defined in `AIActionResponseSchema`.

| Field | Purpose |
|---|---|
| `text_response` | Main conversational reply |
| `user_transcription` | Transcript of user audio input |
| `open_app` | URL scheme to launch an external app |
| `game_move` | Tic-tac-toe move selection |
| `user_move_detected` | Vision-detected user move |
| `news_action` | News fetch instruction |
| `whiteboard_action` | Whiteboard draw/guess/describe payload |
| `selfie_action` | Image generation request |
| `gif_action` | GIF request |
| `video_action` | Video generation request |
| `almost_moment_used` | Tracks use of an almost-moment expression |
| `fulfilling_promise_id` | Marks that the response fulfills a prior promise |

Important distinction:
- these are JSON output fields
- they are not callable Gemini function tools
- fields like `selfie_action`, `gif_action`, and `video_action` are intentionally handled as output JSON, not as function tools

---

## Current Function Tool Surface

`GeminiMemoryToolDeclarations` currently covers a broad set of tools. The exact list lives in `src/services/aiSchema.ts`; the main categories are:

### Memory and Recall
- `recall_memory`
- `recall_user_info`
- `store_user_info`
- `store_character_info`
- `recall_character_profile`

### Notes and Internal Continuity
- `store_daily_note`
- `retrieve_daily_notes`
- `store_monthly_note`
- `retrieve_monthly_notes`
- `store_lessons_learned`
- `retrieve_lessons_learned`
- `mila_note`
- `retrieve_mila_notes`

### Scheduling, Continuity, and Planning
- `calendar_action`
- `create_open_loop`
- `resolve_open_loop`
- `make_promise`
- `create_life_storyline`
- `cron_job_action`

### Search, Workspace, and Investigation
- `web_search`
- `workspace_action`
- `query_database`
- `read_agent_file`
- `write_agent_file`

### External Integrations
- `google_task_action`
- `google_cli`
- `email_action`
- `email_action_manage`

### Social / Platform Actions
- `resolve_x_tweet`
- `post_x_tweet`
- `resolve_x_mention`

### Engineering Delegation
- `delegate_to_engineering`
- `get_engineering_ticket_status`
- `submit_clarification`

Because this list changes over time, prefer checking `GeminiMemoryToolDeclarations` directly before editing docs or prompts.

---

## Helper Types in `aiSchema.ts`

`aiSchema.ts` also contains helper types such as:
- `MemoryToolArgs`
- `PendingToolCall`
- `ToolCallResult`

These are still useful documentation and typing aids, but for the live Gemini path the main runtime drivers are:
- `GeminiMemoryToolDeclarations`
- `MemoryToolName`
- `ToolCallArgs`
- `executeMemoryTool()`
- `createCallableTools()`

If those runtime pieces drift, the app breaks even if helper types still compile.

---

## Failure Semantics

This matters when adding or debugging tools.

Current behavior:
- `memoryService.ts` defines `TOOL_FAILURE_PREFIX = 'TOOL_FAILED:'`
- many tool handlers return `formatToolFailure(...)` for normal business failures
- `toolBridge.ts` does not inspect returned `TOOL_FAILED:` strings
- `toolBridge.ts` increments `failureCount` only when `executeMemoryTool()` throws up to the bridge

Practical consequence:
- a returned `TOOL_FAILED: ...` string is still a normal function result from the bridge's point of view
- `tool_call_summary` may still show `status: 'success'` even if the returned string says the tool failed in business terms
- bridge retry accounting is for thrown execution exceptions, not every returned failure string

---

## Pseudo-Tool Guardrail

A common model failure mode is to put tool names directly into the final JSON instead of actually calling them.

Current protection:
- `serverGeminiService.ts` builds a set of tool names from `GeminiMemoryToolDeclarations`
- after a response, it checks whether Gemini emitted any of those tool names as top-level JSON keys
- if that happens and no real function call was used, the service sends a one-time correction prompt telling Gemini to retry with actual function calls

This is why these prompt files matter:
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
- `src/services/system_prompts/format/outputFormat.ts`

They reinforce the rule that function tools must be actual tool calls, not JSON keys.

---

## Adding a New Response Field

When adding a final JSON field to `AIActionResponseSchema`:

1. Add the field in `src/services/aiSchema.ts`
2. Update response parsing / normalization in the Gemini service path that consumes the JSON
3. Update any downstream processor that uses the field
4. Update prompt instructions if Gemini needs explicit guidance about when to emit it

Typical examples of downstream consumers include:
- `normalizeAiResponse(...)`
- post-processing in `server/services/ai/serverGeminiService.ts`
- client/UI handlers that act on the returned field

If you add a field but do not add normalization or consumption, it may be silently ignored.

---

## Adding a New Gemini Tool

For the current Gemini SDK path, the normal integration checklist is:

1. Add the declaration to `GeminiMemoryToolDeclarations` in `src/services/aiSchema.ts`
2. Add the tool name to `MemoryToolName` in `src/services/memoryService.ts`
3. Add the args shape to `ToolCallArgs` in `src/services/memoryService.ts`
4. Add the `executeMemoryTool()` switch case in `src/services/memoryService.ts`
5. Add usage guidance to `src/services/system_prompts/tools/toolsAndCapabilities.ts`
6. Optionally extend `ToolExecutionContext` and pass extra context if needed
7. Optionally add bridge-only hooks in `server/services/ai/toolBridge.ts`
8. Add focused Vitest coverage for the declaration and any important handler branches

For a detailed step-by-step guide, see:
- `server/agent/opey-dev/guides/adding-gemini-function-tools.md`

Important:
- you do not need an `OpenAIMemoryToolDeclarations` update for the current Gemini path
- you usually do not need to touch `toolBridge.ts`
- prompt guidance is required, otherwise Gemini may not call the tool correctly

---

## Best Practices

1. Prefer tools for database writes or explicit commands
2. Prefer response fields for final payload actions tightly coupled to the reply
3. Keep tool descriptions behavior-oriented, not implementation-oriented
4. Keep `required` tool params minimal
5. Add prompt guidance in `toolsAndCapabilities.ts` for every meaningful new tool
6. Add focused tests instead of temporary debug logging
7. Treat `GeminiMemoryToolDeclarations` as the source of truth for the live tool surface
8. Re-check `outputFormat.ts` when adding tools that Gemini might try to fake as JSON keys

---

## Summary

| Mechanism | Best For | Reliability | Notes |
|---|---|---|---|
| Response fields | Final reply payload actions | Good when clearly prompted | No mid-turn feedback loop |
| Function tools | Retrieval, writes, commands, external actions | Higher for explicit execution | Gemini can use results before finishing the reply |

When in doubt:
- use a response field for something that belongs in the final JSON payload
- use a function tool for something Gemini must actually execute or look up
