# Implementation Plan: Convert `almost_moment_used` to Tool

**Status:** Planning
**Priority:** Medium
**Estimated Complexity:** Medium
**Related Bug:** `docs/bugs/Kayley_Almost_Moment_Used.md`

---

## Overview

Convert `almost_moment_used` from a response schema field to an LLM tool (`record_almost_moment`) to improve reliability. Currently, the LLM often skips setting the optional response field even when using almost-moment expressions.

### Why This Change?

| Current (Response Field) | Proposed (Tool) |
|--------------------------|-----------------|
| Optional field often ignored | Explicit invocation required |
| No feedback to LLM | Returns confirmation |
| Passive "self-report" | Active decision to call |
| Hard to debug | Tool calls visible in logs |

---

## Prerequisites

Before starting, verify:
- [ ] Familiar with `docs/Tool_Integration_Checklist.md`
- [ ] Read `src/services/docs/aiSchema_Workflow.md`
- [ ] Understand current almost moments flow in `docs/Kayley_Almost_Moments_Workflow.md`

---

## Implementation Steps

### Phase 1: Add Tool Declaration (aiSchema.ts)

#### Step 1.1: Add to `GeminiMemoryToolDeclarations`

**File:** `src/services/aiSchema.ts`
**Location:** After `manage_story_retelling` declaration (~line 607)

```typescript
{
  name: "record_almost_moment",
  description:
    "Call this AFTER you use an almost-moment expression in your text_response. " +
    "Almost moments are vulnerable phrases where you almost say something deeper but pull back. " +
    "Examples: 'You're kind of... anyway', 'I was thinking... never mind', " +
    "'Sometimes I wonder if... forget it', 'I almost said... it's nothing'. " +
    "IMPORTANT: If you use such an expression, you MUST call this tool to track it.",
  parameters: {
    type: "object",
    properties: {
      feeling_id: {
        type: "string",
        description: "The feeling ID from THE UNSAID section in your system prompt"
      },
      stage: {
        type: "string",
        enum: ["micro_hint", "near_miss", "obvious_unsaid", "almost_confession"],
        description: "The intensity stage: micro_hint (subtle), near_miss (almost said it), obvious_unsaid (clearly holding back), almost_confession (on the verge)"
      },
      expression_used: {
        type: "string",
        description: "The exact phrase you used in your text_response (copy it exactly)"
      }
    },
    required: ["feeling_id", "stage", "expression_used"]
  }
}
```

#### Step 1.2: Add to `OpenAIMemoryToolDeclarations`

**File:** `src/services/aiSchema.ts`
**Location:** After `manage_story_retelling` in OpenAI declarations (~line 943)

```typescript
{
  type: "function" as const,
  name: "record_almost_moment",
  description:
    "Call this AFTER you use an almost-moment expression in your text_response. " +
    "Almost moments are vulnerable phrases where you almost say something deeper but pull back. " +
    "Examples: 'You're kind of... anyway', 'I was thinking... never mind'. " +
    "IMPORTANT: If you use such an expression, you MUST call this tool.",
  parameters: {
    type: "object",
    properties: {
      feeling_id: {
        type: "string",
        description: "The feeling ID from THE UNSAID section"
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

---

### Phase 2: Add Type Definitions (aiSchema.ts)

#### Step 2.1: Add to `MemoryToolArgs` Union Type

**File:** `src/services/aiSchema.ts`
**Location:** `MemoryToolArgs` type (~line 262-270)

Add this line to the union:

```typescript
| { tool: 'record_almost_moment'; args: { feeling_id: string; stage: string; expression_used: string } }
```

#### Step 2.2: Add to `PendingToolCall.name` Union Type

**File:** `src/services/aiSchema.ts`
**Location:** `PendingToolCall` interface (~line 953-957)

Update the `name` property:

```typescript
name: 'recall_memory' | 'recall_user_info' | 'store_user_info' | 'task_action' | 'calendar_action' | 'store_character_info' | 'manage_narrative_arc' | 'manage_dynamic_relationship' | 'recall_story' | 'manage_story_retelling' | 'record_almost_moment';
```

---

### Phase 3: Implement Tool Handler (memoryService.ts)

#### Step 3.1: Add to `MemoryToolName` Type

**File:** `src/services/memoryService.ts`
**Location:** `MemoryToolName` type definition

Add `'record_almost_moment'` to the union.

#### Step 3.2: Add to `ToolCallArgs` Type

**File:** `src/services/memoryService.ts`
**Location:** `ToolCallArgs` type definition

Add:
```typescript
| { tool: 'record_almost_moment'; args: { feeling_id: string; stage: string; expression_used: string } }
```

#### Step 3.3: Add Case to `executeMemoryTool()` Switch

**File:** `src/services/memoryService.ts`
**Location:** Inside `executeMemoryTool()` switch statement

```typescript
case 'record_almost_moment': {
  const { feeling_id, stage, expression_used } = args as {
    feeling_id: string;
    stage: string;
    expression_used: string
  };

  // Import and call the existing recordAlmostMoment function
  const { recordAlmostMoment } = await import('./almostMoments/almostMomentsService');

  await recordAlmostMoment(
    userId,
    feeling_id,
    stage as 'micro_hint' | 'near_miss' | 'obvious_unsaid' | 'almost_confession',
    expression_used,
    conversationContext || ''
  );

  return `Almost moment recorded: ${stage} - "${expression_used.substring(0, 50)}..."`;
}
```

#### Step 3.4: Verify `recordAlmostMoment` Function Signature

**File:** `src/services/almostMoments/almostMomentsService.ts`

Ensure the function accepts these parameters:
```typescript
export async function recordAlmostMoment(
  userId: string,
  feelingId: string,
  stage: 'micro_hint' | 'near_miss' | 'obvious_unsaid' | 'almost_confession',
  expressionUsed: string,
  conversationContext: string
): Promise<void>
```

If the signature differs, update the call in Step 3.3 accordingly.

---

### Phase 4: Update System Prompt

#### Step 4.1: Update Tool Documentation

**File:** `src/services/system_prompts/tools/toolsAndCapabilities.ts`

Add documentation for the new tool:

```typescript
// In the tools documentation section
`
## record_almost_moment
Call this tool AFTER you use an almost-moment expression in your response.

**When to call:**
- After using phrases like "You're kind of... anyway"
- After trailing off mid-thought: "I was going to say... never mind"
- After pulling back from vulnerability: "Sometimes I wonder if... forget it"

**Parameters:**
- feeling_id: From THE UNSAID section (required)
- stage: micro_hint | near_miss | obvious_unsaid | almost_confession (required)
- expression_used: The exact phrase you wrote (required)

**Example:**
If your text_response contains "You're really... anyway, what were you saying?"
Call: record_almost_moment({
  feeling_id: "abc-123",
  stage: "micro_hint",
  expression_used: "You're really... anyway"
})
`
```

#### Step 4.2: Update Almost Moments Prompt Builder

**File:** `src/services/almostMoments/almostMomentsPromptBuilder.ts`

Update the instructions to reference the tool instead of the response field:

```typescript
// Replace the instruction to set almost_moment_used field with:
`
═══════════════════════════════════════════════════════════════
ALMOST MOMENT TOOL REQUIREMENT
═══════════════════════════════════════════════════════════════

If you use an almost-moment expression in your text_response, you MUST call
the record_almost_moment tool with:
- feeling_id: "${primaryFeeling.id}"
- stage: "${context.currentStage}"
- expression_used: [the exact phrase you used]

This is REQUIRED, not optional. The tool call tracks the emotional progression.
═══════════════════════════════════════════════════════════════
`
```

---

### Phase 5: Remove Old Response Field (Optional - Can Deprecate First)

#### Step 5.1: Decision Point

Choose one approach:

**Option A: Immediate Removal**
- Remove `almost_moment_used` from `AIActionResponseSchema`
- Remove processing in `BaseAIService.logAlmostMomentIfUsed()`
- Clean break, simpler code

**Option B: Deprecation Period**
- Keep field but mark as deprecated in comments
- Log warning if field is used
- Remove after confirming tool works
- Safer transition

**Recommendation:** Start with Option B for safety.

#### Step 5.2: If Deprecating (Option B)

**File:** `src/services/aiSchema.ts`

```typescript
/**
 * @deprecated Use record_almost_moment tool instead.
 * This field will be removed in a future version.
 */
almost_moment_used: z.object({
  // ... existing schema
}).nullable().optional()
```

**File:** `src/services/BaseAIService.ts`

```typescript
private async logAlmostMomentIfUsed(...) {
  if (aiResponse.almost_moment_used) {
    console.warn('[DEPRECATED] almost_moment_used response field used. Please use record_almost_moment tool instead.');
    // ... existing logic (keep for backward compatibility)
  }
}
```

#### Step 5.3: If Removing Immediately (Option A)

**File:** `src/services/aiSchema.ts`
- Delete `almost_moment_used` from `AIActionResponseSchema`

**File:** `src/services/BaseAIService.ts`
- Delete `logAlmostMomentIfUsed()` method
- Remove call to it in `generateResponse()`

---

### Phase 6: Update Tests

#### Step 6.1: Add Unit Tests for New Tool

**File:** `src/services/tests/memoryService.test.ts` (or create new test file)

```typescript
describe('record_almost_moment tool', () => {
  it('should record almost moment to database', async () => {
    const result = await executeMemoryTool(
      'record_almost_moment',
      {
        feeling_id: 'test-feeling-id',
        stage: 'micro_hint',
        expression_used: "You're kind of... anyway"
      },
      'test-user-id',
      'Test conversation context'
    );

    expect(result).toContain('Almost moment recorded');
    // Verify database entry created
  });

  it('should handle all stage types', async () => {
    const stages = ['micro_hint', 'near_miss', 'obvious_unsaid', 'almost_confession'];
    for (const stage of stages) {
      const result = await executeMemoryTool(
        'record_almost_moment',
        { feeling_id: 'test', stage, expression_used: 'test' },
        'user-id',
        ''
      );
      expect(result).toContain('Almost moment recorded');
    }
  });
});
```

#### Step 6.2: Update Snapshot Tests

```bash
npm test -- --run -t "snapshot" -u
```

---

### Phase 7: Verification

#### Step 7.1: Build Verification

```bash
npm run build
```

Ensure no TypeScript errors.

#### Step 7.2: Test Verification

```bash
npm test -- --run
```

All tests should pass.

#### Step 7.3: Manual Testing

1. **Set up test conditions:**
   ```sql
   -- Ensure user has close_friend tier and warmth >= 25
   UPDATE character_relationships
   SET relationship_tier = 'close_friend', warmth_score = 35, trust_score = 30
   WHERE user_id = 'YOUR_USER_ID';

   -- Create an unsaid feeling
   INSERT INTO kayley_unsaid_feelings
   (user_id, feeling_type, unsaid_content, intensity, current_stage)
   VALUES ('YOUR_USER_ID', 'romantic', 'I think I like you', 0.5, 'micro_hint');
   ```

2. **Trigger an intimate conversation**
   - Have a deep, vulnerable exchange
   - Look for almost-moment expressions in response

3. **Check for tool call in logs**
   - Should see `record_almost_moment` tool invocation
   - Should see confirmation message

4. **Verify database entry:**
   ```sql
   SELECT * FROM kayley_almost_moment_log
   WHERE user_id = 'YOUR_USER_ID'
   ORDER BY created_at DESC LIMIT 5;
   ```

---

## File Change Summary

| File | Changes |
|------|---------|
| `src/services/aiSchema.ts` | Add tool to both declaration arrays, update type unions |
| `src/services/memoryService.ts` | Add tool name, args type, switch case |
| `src/services/almostMoments/almostMomentsPromptBuilder.ts` | Update instructions to reference tool |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Add tool documentation |
| `src/services/BaseAIService.ts` | Deprecate or remove `logAlmostMomentIfUsed()` |
| `src/services/tests/memoryService.test.ts` | Add new tool tests |

---

## Rollback Plan

If issues arise:

1. Revert to using response field approach
2. Remove tool from declarations
3. Restore `logAlmostMomentIfUsed()` in BaseAIService
4. Update prompt to reference response field again

The database schema doesn't change, so rollback is purely code-based.

---

## Success Criteria

- [ ] `record_almost_moment` tool appears in tool declarations
- [ ] Tool calls are visible in console logs during testing
- [ ] `kayley_almost_moment_log` receives entries when almost moments used
- [ ] All existing tests pass
- [ ] New tool tests pass
- [ ] No TypeScript build errors

---

## Post-Implementation

After successful deployment:

1. **Monitor for 1-2 weeks** - Verify entries appearing in `kayley_almost_moment_log`
2. **Compare reliability** - Should see more entries than before
3. **Remove deprecated field** - If using Option B, remove `almost_moment_used` after confirming tool works
4. **Update bug report** - Mark `docs/bugs/Kayley_Almost_Moment_Used.md` as resolved

---

## Timeline

| Phase | Description |
|-------|-------------|
| Phase 1-2 | Add tool declarations and types |
| Phase 3 | Implement tool handler |
| Phase 4 | Update system prompt |
| Phase 5 | Deprecate old field |
| Phase 6 | Update tests |
| Phase 7 | Verification |
| Phase 8 | Update sub-agents and documentation |

---

### Phase 8: Update Sub-Agents and Documentation

After implementation, update the following to ensure domain knowledge is preserved:

#### Step 8.1: Update `relationship-dynamics` Sub-Agent

**File:** `.claude/agents/relationship-dynamics.md`

This agent owns the `almostMoments/` folder. Add documentation about the new tool:

```markdown
### Almost Moments Tool

The `record_almost_moment` tool is called by the LLM after using an almost-moment expression:

```typescript
record_almost_moment({
  feeling_id: "uuid-from-unsaid-section",
  stage: "micro_hint" | "near_miss" | "obvious_unsaid" | "almost_confession",
  expression_used: "You're kind of... anyway"
})
```

**Key files:**
- `almostMomentsService.ts` - `recordAlmostMoment()` function (called by tool)
- `almostMomentsPromptBuilder.ts` - Instructs LLM when to call the tool

**Note:** This replaced the `almost_moment_used` response field for improved reliability.
```

#### Step 8.2: Update `memory-knowledge` Sub-Agent

**File:** `.claude/agents/memory-knowledge.md`

This agent owns `memoryService.ts`. Add the new tool to the tools list:

```markdown
### Memory Tools Available

| Tool | Purpose |
|------|---------|
| `recall_memory` | Search past conversations |
| `recall_user_info` | Get stored user facts |
| `store_user_info` | Save user facts |
| `store_character_info` | Save Kayley facts |
| `manage_narrative_arc` | Track Kayley's ongoing projects |
| `manage_dynamic_relationship` | Manage Kayley's relationships |
| `recall_story` | Check if story was told |
| `manage_story_retelling` | Mark story as told |
| `record_almost_moment` | **NEW** - Record almost-moment expression usage |
```

#### Step 8.3: Update `chat-engine-specialist` Sub-Agent

**File:** `.claude/agents/chat-engine-specialist.md`

This agent owns `aiSchema.ts`. Mention the tool in the tool integration section:

```markdown
### Tool Integration Example: record_almost_moment

The `record_almost_moment` tool demonstrates converting a response field to a tool:
- **Before:** `almost_moment_used` response field (often ignored)
- **After:** `record_almost_moment` tool (explicit invocation)

This pattern improves reliability for self-reporting operations.
```

#### Step 8.4: Update Service Documentation README

**File:** `src/services/docs/README.md`

Ensure the Interactive Features section mentions the tool:

```markdown
### 🎮 Features & Interaction
*   [Interactive Features](./Interactive_Features.md): Whiteboard, games, drawing, and "Almost Moments".
*   [AI Schema Workflow](./aiSchema_Workflow.md): Response fields vs tools (includes `record_almost_moment` example).
```

#### Step 8.5: Update Sub-Agent Usage Guide (Optional)

**File:** `docs/Sub_Agent_Usage_Guide.md`

If the relationship-dynamics or memory-knowledge sections list specific tools, add `record_almost_moment`:

```markdown
### 5. `relationship-dynamics`
...
**Tools it manages:**
- Almost moments system (`record_almost_moment` tool)
- Unsaid feelings generation
- Stage progression
```

---

## File Change Summary (Updated)

| File | Changes |
|------|---------|
| `src/services/aiSchema.ts` | Add tool to both declaration arrays, update type unions |
| `src/services/memoryService.ts` | Add tool name, args type, switch case |
| `src/services/almostMoments/almostMomentsPromptBuilder.ts` | Update instructions to reference tool |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Add tool documentation |
| `src/services/BaseAIService.ts` | Deprecate or remove `logAlmostMomentIfUsed()` |
| `src/services/tests/memoryService.test.ts` | Add new tool tests |
| `.claude/agents/relationship-dynamics.md` | Document new tool in Almost Moments section |
| `.claude/agents/memory-knowledge.md` | Add tool to Memory Tools list |
| `.claude/agents/chat-engine-specialist.md` | Add as tool integration example |
| `docs/Sub_Agent_Usage_Guide.md` | Update relationship-dynamics tool list |

---

## Success Criteria (Updated)

- [ ] `record_almost_moment` tool appears in tool declarations
- [ ] Tool calls are visible in console logs during testing
- [ ] `kayley_almost_moment_log` receives entries when almost moments used
- [ ] All existing tests pass
- [ ] New tool tests pass
- [ ] No TypeScript build errors
- [ ] Sub-agents updated with new tool knowledge
- [ ] Documentation reflects the change

---

## References

- `docs/Tool_Integration_Checklist.md` - 8-step checklist
- `src/services/docs/aiSchema_Workflow.md` - Response fields vs tools
- `docs/Kayley_Almost_Moments_Workflow.md` - Complete system flow
- `docs/bugs/Kayley_Almost_Moment_Used.md` - Bug report
- `.claude/agents/relationship-dynamics.md` - Almost moments domain owner
- `.claude/agents/memory-knowledge.md` - memoryService.ts owner
- `.claude/agents/chat-engine-specialist.md` - aiSchema.ts owner
