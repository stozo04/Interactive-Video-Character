# Bug Report: Intent Detection JSON Truncation

## Description
The `IntentService` fails to parse the JSON response from the LLM for unified intent detection. This happens because the response is truncated, leading to malformed JSON (e.g., `Unterminated string in JSON`).

## Root Cause
The `detectFullIntentLLM` function calls a reasoning-capable model (e.g., `gemini-3-flash-preview` or similar) with `maxOutputTokens: 5000`. 

The Google diagnostic logs show that:
- `candidatesTokenCount`: ~188
- `thoughtsTokenCount`: ~4797
- **Total tokens used**: ~4985

The "thoughts" (reasoning tokens) consumed nearly the entire 5000-token budget, leaving no room for the actual JSON response to complete. This causes the model to stop mid-sentence, resulting in the truncation.

## Symptoms
- Console log: `⚠️ [IntentService] Response may be truncated - JSON appears incomplete`
- Error log: `❌ [IntentService] Unified detection failed: Error: JSON parse failed - response may be truncated. Original error: SyntaxError: Unterminated string in JSON`
- Fallback triggered: `⚠️ [MessageAnalyzer] Unified intent detection failed, falling back to keyword detection`

## Impact
Sophisticated intent detection (genuine moments, relationship signals, etc.) fails, and the system falls back to basic keyword matching, reducing the "intelligence" of the companion's responses.

## Proposed Fixes

### Option 1: Increase `maxOutputTokens` (Implemented)
Increase the token budget from `5000` to `10000` to accommodate both the reasoning tokens and the actual response.
```typescript
// src/services/intentService.ts
maxOutputTokens: 10000, // Increased from 5000
```

### Option 2: Disable Thinking/Reasoning (If supported)
If the model supports a mode without internal reasoning (which isn't strictly necessary for structured JSON intent detection), disabling it would save thousands of tokens per call.

### Option 3: Use a Dedicated Model
Switch from a preview/reasoning model to a more stable production model like `gemini-1.5-flash` or `gemini-2.0-flash`, which typically doesn't consume output tokens for "thoughts" in the same way, or has higher default limits.

## Verification
1. Monitor `📊 [IntentService] Response length` and `📊 [IntentService] Finish reason` in logs.
2. Verify that `finishReason` is `STOP` and not `MAX_TOKENS`.
3. Check that `detectFullIntentLLM` successfully returns a full JSON object.
