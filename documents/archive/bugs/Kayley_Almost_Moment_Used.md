# Bug Report: `almost_moment_used` Field Not Being Set by LLM

**Status:** Open
**Severity:** Medium
**Component:** Almost Moments System
**Related Files:**
- `src/services/aiSchema.ts` (lines 184-198)
- `src/services/BaseAIService.ts` (lines 63-81)
- `src/services/almostMoments/almostMomentsPromptBuilder.ts`
- `docs/Kayley_Almost_Moments_Workflow.md`

---

## Problem Summary

The `kayley_almost_moment_log` table remains empty even when all prerequisites for almost moments are met. The root cause is that the LLM is not populating the `almost_moment_used` field in its JSON response, even when it uses almost-moment expressions in its `text_response`.

---

## Current Implementation

`almost_moment_used` is implemented as a **response schema field** (not a tool):

```typescript
// In AIActionResponseSchema (aiSchema.ts:184-198)
almost_moment_used: z.object({
  feeling_id: z.string(),
  stage: z.enum(['micro_hint', 'near_miss', 'obvious_unsaid', 'almost_confession']),
  expression_used: z.string()
}).nullable().optional()
```

### How It Should Work

```
1. System prompt includes "THE UNSAID" section with:
   - feeling_id
   - Suggested expression
   - Current stage

2. LLM uses an almost-moment expression in text_response:
   "You're kind of... anyway, what were you saying?"

3. LLM should ALSO set almost_moment_used:
   {
     "feeling_id": "abc-123",
     "stage": "micro_hint",
     "expression_used": "You're kind of... anyway"
   }

4. BaseAIService.logAlmostMomentIfUsed() records it
```

### What Actually Happens

```
1. System prompt includes "THE UNSAID" section ✓
2. LLM uses almost-moment expression ✓
3. LLM does NOT set almost_moment_used ✗ ← FAILURE POINT
4. logAlmostMomentIfUsed() exits early (nothing to log)
5. kayley_almost_moment_log stays empty
```

---

## Root Cause Analysis

### Why LLMs Skip Optional Fields

1. **Optional by default**: The field is `.nullable().optional()` - LLMs tend to ignore optional fields
2. **Self-reporting is unnatural**: The LLM must "report" on what it just wrote, which is an unusual pattern
3. **Instruction placement**: The instruction to set this field may be buried in the prompt
4. **No feedback loop**: Unlike tools, there's no confirmation that the field was processed

### Response Fields vs Tools - Design Pattern Issue

| Aspect | Response Field (current) | Tool (alternative) |
|--------|-------------------------|-------------------|
| Invocation | Passive - set in JSON output | Active - explicit function call |
| LLM behavior | Often ignored if optional | Explicit decision to call |
| Debugging | Hard to trace | Clear in logs |
| Reliability | Lower for optional fields | Higher due to intentionality |

**Key Insight**: Similar operations like `store_user_info` and `store_character_info` are implemented as **tools**, not response fields. This is semantically the same operation - persisting something to the database.

---

## Evidence

From `BaseAIService.ts:63-81`:

```typescript
private async logAlmostMomentIfUsed(
  aiResponse: AIActionResponse,
  userId: string,
  userMessage: string
): Promise<void> {
  // Early exit if not set - THIS IS WHERE IT FAILS
  if (!aiResponse.almost_moment_used) {
    return;
  }
  // ... recording logic never reached
}
```

The field is simply never populated by the LLM.

---

## Proposed Solutions

### Option A: Improve Prompt Instructions (Quick Fix)

Modify `almostMomentsPromptBuilder.ts` to make the instruction more prominent:

```typescript
`
═══════════════════════════════════════════════════════════════
CRITICAL: ALMOST MOMENT REPORTING REQUIREMENT
═══════════════════════════════════════════════════════════════

If your text_response contains ANY of these patterns:
- "You're kind of... anyway"
- "I was going to say... never mind"
- "Sometimes I think... forget it"
- Any phrase where you start to say something vulnerable then retreat

You MUST set almost_moment_used in your response:
{
  "almost_moment_used": {
    "feeling_id": "${primaryFeeling.id}",
    "stage": "${context.currentStage}",
    "expression_used": "[the exact phrase you used]"
  }
}

This is NOT optional when you use these expressions.
═══════════════════════════════════════════════════════════════
`
```

**Pros:** Simple change, no architectural modification
**Cons:** May still be unreliable; LLMs can still skip it

---

### Option B: Convert to Tool (Recommended)

Create a new `record_almost_moment` tool:

#### Step 1: Add to `GeminiMemoryToolDeclarations` (aiSchema.ts)

```typescript
{
  name: "record_almost_moment",
  description:
    "Call this AFTER you use an almost-moment expression in your response. " +
    "Almost moments are vulnerable phrases where you almost say something deeper but pull back. " +
    "Examples: 'You're kind of... anyway', 'I was thinking... never mind', " +
    "'Sometimes I wonder if... forget it'. " +
    "REQUIRED: Call this whenever you use such an expression!",
  parameters: {
    type: "object",
    properties: {
      feeling_id: {
        type: "string",
        description: "The feeling ID from THE UNSAID section in your prompt"
      },
      stage: {
        type: "string",
        enum: ["micro_hint", "near_miss", "obvious_unsaid", "almost_confession"],
        description: "The intensity stage of the almost moment"
      },
      expression_used: {
        type: "string",
        description: "The exact phrase you used in your text_response"
      }
    },
    required: ["feeling_id", "stage", "expression_used"]
  }
}
```

#### Step 2: Add to Type Definitions

```typescript
// In MemoryToolArgs union type
| { tool: 'record_almost_moment'; args: { feeling_id: string; stage: string; expression_used: string } }

// In PendingToolCall.name union
name: '...' | 'record_almost_moment';
```

#### Step 3: Implement in memoryService.ts

```typescript
case 'record_almost_moment':
  await recordAlmostMoment(
    userId,
    args.feeling_id,
    args.stage,
    args.expression_used,
    userMessage
  );
  return 'Almost moment recorded.';
```

#### Step 4: Update Prompt

```typescript
`
When you use an almost-moment expression, you MUST call the record_almost_moment tool.
Example: If you say "You're really... anyway, never mind", call:
record_almost_moment({
  feeling_id: "[from THE UNSAID section]",
  stage: "micro_hint",
  expression_used: "You're really... anyway, never mind"
})
`
```

**Pros:**
- Explicit invocation is more reliable
- Consistent with other memory operations (store_user_info, etc.)
- Easier to debug (tool calls are logged)
- LLM makes conscious decision to call

**Cons:**
- Requires following full 8-step tool integration checklist
- Adds slight latency (tool call round-trip)

---

## Verification Steps

After implementing either fix:

1. **Check prerequisites are met:**
   ```sql
   -- Must have unsaid feelings
   SELECT * FROM kayley_unsaid_feelings WHERE user_id = 'xxx' AND resolved_at IS NULL;

   -- Must have relationship tier close_friend or deeply_loving
   SELECT relationship_tier, warmth_score FROM character_relationships WHERE user_id = 'xxx';
   ```

2. **Trigger an almost moment scenario:**
   - Have a deep/intimate conversation
   - Check console logs for prompt including "THE UNSAID"
   - Look for almost-moment expressions in response

3. **Verify recording:**
   ```sql
   SELECT * FROM kayley_almost_moment_log WHERE user_id = 'xxx' ORDER BY created_at DESC;
   ```

---

## Decision Required

Choose implementation path:
- [ ] **Option A**: Quick fix - improve prompt instructions
- [ ] **Option B**: Tool conversion - more reliable but more work

---

## Related Documentation

- `docs/Kayley_Almost_Moments_Workflow.md` - Complete system flow
- `src/services/docs/aiSchema_Workflow.md` - Response fields vs tools patterns
- `docs/Tool_Integration_Checklist.md` - Required steps for adding new tools

---

## Timeline

| Date | Action |
|------|--------|
| 2024-12-29 | Bug identified and documented |
| TBD | Solution selected |
| TBD | Implementation complete |
| TBD | Verification complete |
