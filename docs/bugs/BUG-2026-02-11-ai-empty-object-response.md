# Bug: AI Replies With Empty JSON Object (`{}`)

## Summary
When the user says "ahhaha check yesterdays messages! I think you need more coffee", the AI response is stored and displayed as `{}` instead of a natural language reply. The Interactions API loop hits the max tool-iteration cap while still emitting only `function_call` outputs. `parseInteractionResponse` then falls back to `"{}"` because no `text` output exists.

## Date
2026-02-11

## User-Facing Symptom
- User: "ahhaha check yesterdays messages! I think you need more coffee"
- AI response shown in UI: `{}`

## Evidence

### Console Logs (`c:/Users/gates/Downloads/logs.txt`)
- Tool loop hits the cap:
  - `⚠️ [Gemini Interactions] Max tool iterations reached`
- The parsed response is `{}`:
  - `structuredResponse:  {text_response: '{}', ...}`
  - `aiResponse:  {text_response: '{}', ...}`

### HAR (`c:/Users/gates/Downloads/localhost_video.har`)
- Interaction request includes the user message.
- Interaction response contains only `thought` + `function_call` outputs (no `text` output).
- The app stores a model message with `message_text: "{}"` in Supabase.

## Root Cause (Most Likely)
The tool-calling loop in `src/services/geminiChatService.ts` reaches the hard cap (max 3 iterations) while the model continues to request `recall_memory` calls. At that point:
1. `continueInteractionWithTools` returns an interaction whose outputs still contain `function_call` entries and no `text`.
2. `parseInteractionResponse` only looks for `output.type === "text"` and defaults to `"{}"` when none is found.
3. The UI stores and renders `{}` as the assistant response.

## Contributing Factors
- `MAX_TOOL_ITERATIONS` is set to `3` for `callProviderWithInteractions`.
- No fallback or recovery step when the loop ends without a `text` output.
- The model keeps requesting `recall_memory` with slightly different queries instead of concluding.

## Impact
- User sees a raw `{}` response.
- The conversation state is polluted with a model message that is not meaningful.

## Repro Steps
1. Open the app.
2. Send: "ahhaha check yesterdays messages! I think you need more coffee"
3. Observe `{}` as the AI response.

## Suggested Fixes
1. Add a fallback when no `text` output exists:
   - If `outputs` contain only `function_call`, synthesize a friendly fallback like:
     - "Give me a second—I'm pulling that up. What do you want me to focus on from yesterday?"
2. Allow one final completion call without tools after the loop cap:
   - After max iterations, call `createInteraction` once more with tools disabled and a short instruction to respond directly.
3. Add a loop breaker:
   - If the same tool (`recall_memory`) is called repeatedly with similar queries, stop tool calls and ask for clarification.

## Related Fix Completed
- 2026-02-11: Updated `x_posting_mode` lookups to use `.maybeSingle()` to avoid Supabase 406s when no row exists.
  - Files: `src/services/idleThinkingService.ts`, `src/components/SettingsPanel.tsx`.

## Files of Interest
- `src/services/geminiChatService.ts` (tool loop + response parsing)
- `src/services/memoryService.ts` (tool execution)
- `src/services/messageOrchestrator.ts` (response handling)
