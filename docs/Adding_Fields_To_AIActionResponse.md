# ⚠️ CRITICAL: Adding New Fields to AIActionResponse

**If you're adding a new field to the AI's JSON response, you MUST follow ALL steps below or the field will be silently stripped out!**

## The Problem

When you add a new field to `AIActionResponseSchema` (in `aiSchema.ts`), the field needs to be in TWO places:
1. The Zod schema (for validation)
2. The `normalizeAiResponse()` function (for parsing)

**If you forget step 2, your field will be silently dropped during response parsing!**

## Real Example: Promise Fulfillment Bug

We added `fulfilling_promise_id` to the schema but forgot to add it to `normalizeAiResponse()`. Result:
- ✅ LLM correctly set the field in JSON
- ✅ Schema validation passed
- ❌ Field was `undefined` in the parsed response
- ❌ Promise fulfillment never happened

Debugging took hours because there were no errors - the field was just missing.

## The 3-Step Checklist

### ✅ Step 1: Add to `AIActionResponseSchema` (aiSchema.ts)

```typescript
// src/services/aiSchema.ts
export const AIActionResponseSchema = z.object({
  text_response: z.string()...,
  action_id: z.string().nullable()...,

  // YOUR NEW FIELD HERE
  your_new_field: z.string().nullable().optional().describe("..."),
});
```

### ✅ Step 2: Add to `normalizeAiResponse()` (geminiChatService.ts)

**THIS IS THE STEP EVERYONE FORGETS!**

```typescript
// src/services/geminiChatService.ts
function normalizeAiResponse(rawJson: any, rawText: string): AIActionResponse {
  // ... other code ...

  return {
    text_response: rawJson.text_response || rawJson.response || rawText,
    action_id: actionId,
    user_transcription: rawJson.user_transcription || null,
    // ... other fields ...

    // YOUR NEW FIELD HERE (must match the schema field name exactly!)
    your_new_field: rawJson.your_new_field || null,
  };
}
```

### ✅ Step 3: Update Type (if needed)

The TypeScript type is auto-inferred from the schema:
```typescript
export type AIActionResponse = z.infer<typeof AIActionResponseSchema>;
```

So once you update the schema (Step 1), the type updates automatically.

## Why This Happens

The response parsing flow:
1. Gemini API returns raw JSON string
2. We parse it: `JSON.parse(jsonText)` → gets ALL fields
3. We normalize it: `normalizeAiResponse(parsed)` → **manually constructs the response object**
4. Fields not in `normalizeAiResponse()` get dropped ❌

## How to Verify It Works

After adding your field:

1. **Check the console logs** for the raw response:
   ```javascript
   console.log("Raw JSON:", rawJson);
   console.log("Normalized response:", normalizedResponse);
   ```

2. **Verify the field exists** in both objects

3. **Test the feature** that uses the new field

## Common Mistakes

❌ **Adding to schema only** → Field is validated but then stripped out
❌ **Adding to normalizeAiResponse only** → No validation, can cause runtime errors
❌ **Typo in field name** → Silent mismatch, field appears undefined
❌ **Wrong null/undefined handling** → Field exists but has wrong default value

## Summary

**Every field in `AIActionResponseSchema` must also be in `normalizeAiResponse()`!**

When adding a new field:
1. Add to schema → for validation
2. Add to normalizeAiResponse() → for parsing (DON'T FORGET!)
3. Test thoroughly → verify field is not undefined

---

**Created:** 2026-01-21
**Reason:** Hours wasted debugging `fulfilling_promise_id` being undefined
**Lesson:** Silent failures are the worst kind of bugs
