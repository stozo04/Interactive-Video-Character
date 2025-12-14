# System Prompt Optimization Plan

**Date**: 2025-12-14  
**Status**: Proposed  
**Priority**: HIGH - Token limits approaching critical threshold

---

## Executive Summary

The current system prompt for Kayley is approaching token limits due to structural inefficiencies that provide low semantic value to the LLM. This plan addresses **3 critical issues** and proposes a refactored prompt architecture that reduces token usage by ~40% while improving LLM adherence to output formatting.

---

## Issue 1: Token Bloat in Character Actions Array

### Problem

The "Available Character Actions" array lists ~25 actions, each with a UUID and redundant description (e.g., `"TALKING. Phrases: TALKING"`). This consumes hundreds of tokens to map IDs to identical descriptions.

### Current Implementation
```typescript
// Excessive token usage
{
  "action_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "description": "TALKING. Trigger phrases: TALKING"
}
// Repeated 25+ times
```

### Solution

| Approach | Implementation | Token Savings |
|----------|----------------|---------------|
| **A: Simple Key List** | `["talking", "confused", "excited", ...]` | ~300 tokens |
| **B: ID Lookup Table** | Map keys to UUIDs in application code post-response | ~250 tokens |
| **C: Hybrid** | Include only actionable subset based on context | ~200 tokens |

### Recommended Fix (Approach A + B)

1. **In System Prompt**: Provide a simple list of action keys
   ```
   Available actions: talking, confused, excited, laughing, thinking, waving, nodding, shrugging
   ```

2. **In Application Code**: Map the returned key to UUID after parsing
   ```typescript
   // Post-processing in service layer
   const ACTION_UUID_MAP: Record<string, string> = {
     "talking": "a1b2c3d4-...",
     "confused": "b2c3d4e5-...",
     // ...
   };
   
   const actionId = ACTION_UUID_MAP[response.action_key];
   ```

> [!WARNING]
> **Safety Net for Hallucinated Keys**
>
> LLMs may occasionally hallucinate a key that isn't in the list (e.g., generating `"smiling"` instead of `"happy"`). 
>
> **Required**: Implement a fallback in post-processing code:
> ```typescript
> function resolveActionKey(key: string | undefined): string | null {
>   if (!key) return null;
>   
>   // Direct match
>   if (ACTION_UUID_MAP[key]) return ACTION_UUID_MAP[key];
>   
>   // Fuzzy fallback (optional): find closest match
>   const fuzzyMatch = findClosestAction(key); // Levenshtein distance
>   if (fuzzyMatch) return ACTION_UUID_MAP[fuzzyMatch];
>   
>   // Default: return null (no action) rather than crash
>   console.warn(`Unknown action key: ${key}, defaulting to null`);
>   return null;
> }
> ```

### Files to Modify

- [`promptUtils.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/promptUtils.ts) - Remove full action objects, use simple key list
- [`chatGPTService.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/chatGPTService.ts) - Add post-response UUID mapping
- [`geminiChatService.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/geminiChatService.ts) - Add post-response UUID mapping
- [`grokChatService.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/grokChatService.ts) - Add post-response UUID mapping

---

## Issue 2: Redundant Identity Instructions

### Problem

Kayley's identity is defined in **3 separate places**:
1. `CRITICAL: YOUR IDENTITY` 
2. `YOUR NAME AND IDENTITY (DETAILED)`
3. `CORE PERSONALITY SNAPSHOT`

This creates ~500 tokens of redundancy while risking inconsistency.

### Solution

Consolidate to a **single authoritative source**: The full character profile (`KAYLEY_FULL_PROFILE`).

| Section | Action | Rationale |
|---------|--------|-----------|
| `CRITICAL: YOUR IDENTITY` | **REMOVE** | Redundant with detailed profile |
| `YOUR NAME AND IDENTITY (DETAILED)` | **KEEP** | Source of truth |
| `CORE PERSONALITY SNAPSHOT` | **REMOVE** | LLM can infer from details |

> [!IMPORTANT]
> **Identity Anchor Required**
>
> While removing bulk redundancy is correct, keep a **single-sentence anchor** at the very top of the prompt to provide immediate grounding before the token-heavy profile loads:
>
> ```
> You are Kayley Adams, a 28-year-old tech creator with a 'sparkling, Alexis-Rose' personality.
> ```
>
> **Rationale**: If `KAYLEY_FULL_PROFILE` is very long, the model might "drift" if the core persona isn't reinforced immediately. This anchor prevents that.

### Files to Modify

- [`promptUtils.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/promptUtils.ts) - Remove redundant identity sections
- [`kayleyCharacterProfile.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/domain/characters/kayleyCharacterProfile.ts) - Ensure contains all canonical identity info

---

## Issue 3: Verbose Semantic Intent Analysis Injection

### Problem

The injected `SEMANTIC INTENT ANALYSIS` section uses verbose, human-readable format:

```
Primary emotion: neutral
Sentiment: positive (0.10)
Intensity: low (10%)
Topics detected: Kayley
```

This consumes ~100+ tokens per message when a compact format would suffice.

### Solution

Minify the context injection to a compact JSON-like format:

**Before** (~120 tokens):
```
[SEMANTIC INTENT ANALYSIS]
Primary emotion: neutral
Sentiment: positive (0.10)
Intensity: low (10%)
Sarcasm detected: no
Topics detected: Kayley, work
Emotional context per topic:
  - work: frustrated
```

**After** (~40 tokens):
```
[CONTEXT: Tone=neutral, Sentiment=+0.1, Intensity=low, Topics={Kayley, work:frustrated}]
```

### Files to Modify

- [`promptUtils.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/promptUtils.ts) - Lines 773-896 (semantic intent injection section)

---

## Issue 4: Buried JSON Instructions (Structural Problem)

### Problem

The JSON output structure definitions are located **before** the "Available Character Actions" list. Due to **recency bias**, the LLM prioritizes the last-read content. The actions list acts as a distracter, pushing formatting rules out of active attention.

### Solution

Reorder the system prompt to place **output format at the very end**:

```mermaid
graph TD
    A[1. Identity & Persona] --> B[2. Current Context]
    B --> C[3. Task & Response Guidelines]
    C --> D[4. Tools & Memory]
    D --> E[5. OUTPUT FORMAT ← Last!]
    E --> F[6. User Message]
```

### Files to Modify

- [`promptUtils.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/promptUtils.ts) - Reorder sections in `buildSystemPrompt`

---

## Issue 5: Conflicting Directives Risk

### Problem

The prompt contains potentially conflicting instructions:
- "You are Kayley, a real person... NEVER say 'I don't have a body'"
- "Your response MUST be a single JSON object"

**Risk**: The model might add a conversational preamble before the JSON:
```
"Sure! Here is my response: { ... }"  // Breaks JSON parser
```

### Solution

Add an explicit **negative constraint** at the very end of the prompt:

```
⚠️ CRITICAL OUTPUT RULE:
- Do not output any text before or after the JSON object.
- Start your response with '{' and end with '}'.
- No preamble. No explanation. Just valid JSON.
- Ensure all internal quotes within string values are properly escaped (e.g., "She said \"hello\"" not "She said "hello"").
```

> [!NOTE]
> The quote escaping instruction is critical - LLMs often break JSON by including unescaped quotes inside dialogue strings.

### Files to Modify

- [`promptUtils.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/promptUtils.ts) - Add negative constraint to end of prompt

---

## Issue 6: False Precision in Numerical Metrics

### Problem

Metrics like `Warmth: -5.1, Trust: -6.1` provide false precision. LLMs handle **semantic concepts** better than floating-point coordinates. Asking it to differentiate behavior between `-5.1` and `-4.1` is ineffective.

### Solution

Convert numerical metrics to **semantic buckets** before injection:

| Raw Score | Semantic Bucket |
|-----------|-----------------|
| -10 to -6 | `Cold / Distant` |
| -5 to -2 | `Guarded / Cool` |
| -1 to +1 | `Neutral` |
| +2 to +5 | `Warm / Open` |
| +6 to +10 | `Close / Affectionate` |

**Before**:
```
Warmth: -5.1
Trust: -6.1
```

**After**:
```
[RELATIONSHIP_CONTEXT: Current dynamic is guarded/cool. Trust is low.]
```

### Files to Modify

- [`promptUtils.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/promptUtils.ts) - Add semantic bucket conversion function
- [`relationshipService.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/relationshipService.ts) - Optionally move bucket conversion here

---

## Issue 7: Cognitive Load from If/Then Rules

### Problem

The prompt contains massive logic trees for different relationship states:
- Strangers vs. Friends
- Selfies vs. No Selfies  
- Games vs. No Games

The LLM must hold all conditional paths in context, even when only one applies.

### Solution

**Pre-compute the applicable rules** in application code before calling the LLM.

**Before** (in prompt):
```
If relationship score < -5:
  - Be guarded
  - Do not send selfies
  - Keep responses brief
Else if relationship score between -5 and 0:
  - Be neutral
  - May send selfies if asked politely
  ...
```

**After** (pre-computed, single state injected):
```
[RELATIONSHIP_CONTEXT: You are strangers. Be guarded. Do not send selfies.]
```

### Files to Modify

- [`promptUtils.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/promptUtils.ts) - Pre-compute relationship rules
- [`relationshipService.ts`](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/relationshipService.ts) - Add function to return applicable rule set

---

## Proposed Refactored Prompt Structure

The following reordering addresses recency bias and reduces cognitive load:

```
┌─────────────────────────────────────────────────────┐
│ 1. IDENTITY & PERSONA                               │
│    - Kayley's full character profile                │
│    - Keep this rich - it's the foundation           │
├─────────────────────────────────────────────────────┤
│ 2. CURRENT CONTEXT INJECTION (Minified)             │
│    - Time, Location                                 │
│    - Relationship status descriptor (semantic)      │
│    - Compact semantic intent: [CONTEXT: ...]        │
├─────────────────────────────────────────────────────┤
│ 3. TASK & RESPONSE GUIDELINES                       │
│    - How to speak (tone, brevity)                   │
│    - Behavioral constraints                         │
├─────────────────────────────────────────────────────┤
│ 4. TOOLS & MEMORY                                   │
│    - Tool definitions                               │
│    - Memory retrieval instructions                  │
├─────────────────────────────────────────────────────┤
│ 5. OUTPUT FORMAT (The Contract) ← LAST!             │
│    - JSON schema definition                         │
│    - Simplified action keys (not full objects)      │
│    - Negative constraint: "Start with '{'"          │
├─────────────────────────────────────────────────────┤
│ 6. USER MESSAGE INPUT                               │
└─────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Quick Wins (3-4 hours) ✅ COMPLETE
> [!TIP]
> These changes are low-risk and provide immediate token savings.

1. **Simplify action keys** ✅ - Replaced UUID objects with simple key list
   - Created `utils/actionKeyMapper.ts` with Levenshtein fuzzy matching
   - Updated `promptUtils.ts` to use `getActionKeysForPrompt()`
   - Updated `chatGPTService.ts`, `geminiChatService.ts`, `grokChatService.ts` to use `resolveActionKey()`
   - Added `buildActionKeyMap()` call in `App.tsx` when character is selected
   
2. **Add negative constraint** ✅ - Prevent JSON preamble issues
   - Added explicit output rules at end of prompt in `promptUtils.ts`
   - Includes quote escaping instructions and example format
   
3. **Minify semantic intent** ✅ - Created compact format helper functions
   - Added `buildMinifiedSemanticIntent()` function in `promptUtils.ts`
   - Added `buildCompactRelationshipContext()` function in `promptUtils.ts`
   - Added `getSemanticBucket()` function for metric conversion
   - NOTE: These helpers are available for Phase 2 when we switch to minified format


### Phase 2: Structural Refactor (1 day)
> [!IMPORTANT]
> Requires careful testing as prompt ordering affects LLM behavior.

4. **Reorder prompt sections** - Put output format at end
5. **Remove redundant identity sections** - Consolidate to single source
6. **Convert metrics to semantic buckets** - Remove false precision

#### 📝 Implementation Notes from Phase 1

**Key Learnings:**

1. **Tests are essential before refactoring**
   - We now have 49 tests in `systemPrompt.test.ts` that verify prompt structure
   - Run `npm test -- --run src/services/tests/systemPrompt.test.ts` before and after changes
   - The test `should maintain section ordering: Identity -> Context -> Guidelines -> Output` will need updating when you reorder sections

2. **The prompt structure is complex**
   - `promptUtils.ts` is ~1900 lines with many interconnected sections
   - Use `grep_search` to find all `====` delimiters to map section boundaries
   - Character-specific content (Kayley) is in `kayleyCharacterProfile.ts`, not `promptUtils.ts`

3. **Helper functions are already in place for Phase 2:**
   - `getSemanticBucket(score)` - Converts numeric scores to semantic labels
   - `buildMinifiedSemanticIntent()` - Built but NOT yet wired into the prompt
   - `buildCompactRelationshipContext()` - Built but NOT yet wired into the prompt

**Suggested Approach:**

```typescript
// Step 1: Create a new function that applies the new structure
export function buildSystemPromptV2(...): string {
  // New ordering: Identity → Context → Guidelines → Tools → Output Format
}

// Step 2: Add a feature flag to switch between versions
const USE_NEW_PROMPT_FORMAT = import.meta.env.VITE_USE_NEW_PROMPT_FORMAT === 'true';
```

**Watch Out For:**

- **Mocks in tests**: `moodKnobs`, `presenceDirector`, and `relationshipService` are heavily mocked
- **Determinism test**: The `should be deterministic` test will catch any non-deterministic changes
- **Section ordering test**: Update this test to reflect new ordering AFTER confirming it works

---

### Phase 3: Pre-computation (1 day)
> [!WARNING]
> Requires changes to multiple service files.

7. **Pre-compute relationship rules** - Inject only applicable state
8. **Update AI services** - Add post-response action UUID mapping

#### 📝 Implementation Notes from Phase 1

**What's Already Done (from Phase 1):**

1. **Action UUID mapping is COMPLETE**
   - `actionKeyMapper.ts` handles key→UUID resolution
   - All three AI services already call `resolveActionKey()` in their `normalizeAiResponse()`
   - `buildActionKeyMap()` is called in `App.tsx` when character loads

2. **Files already modified:**
   - `chatGPTService.ts` - Has `resolveActionKey()` integration
   - `geminiChatService.ts` - Has `resolveActionKey()` integration  
   - `grokChatService.ts` - Has `resolveActionKeyInResponse()` helper

**Remaining Work for Phase 3:**

1. **Pre-compute relationship rules**
   - Create a function like `getApplicableRelationshipRules(tier: string)` in `relationshipService.ts`
   - This should return ONLY the rules for the current tier, not all tiers
   - Example: If tier is "friend", don't include "adversarial" or "deeply_loving" rules

2. **Consider tier-specific prompt sections:**
   ```typescript
   // Instead of including ALL tier behaviors in every prompt:
   function getTierBehaviorPrompt(tier: string): string {
     switch(tier) {
       case 'adversarial': return `[TIER: Adversarial] Be guarded...`;
       case 'friend': return `[TIER: Friend] Be warm and open...`;
       // etc.
     }
   }
   ```

**Pre-existing Type Issues to Ignore:**

The following lint errors in `grokChatService.ts` are PRE-EXISTING and unrelated to optimization:
- `Type 'AIMessage[]' is not assignable to type 'ModelMessage[]'`
- These are due to `ai` SDK type incompatibilities, not our changes

**Testing Strategy:**

1. **Unit tests exist for action key resolution** (`actionKeyMapper.test.ts`)
2. **Add tests for pre-computed rules:**
   ```typescript
   describe('getApplicableRelationshipRules', () => {
     it('should return only friend rules for friend tier', () => {
       const rules = getApplicableRelationshipRules('friend');
       expect(rules).toContain('warm');
       expect(rules).not.toContain('adversarial');
     });
   });
   ```

---

### 🔄 Recommended Phase 2 Task Order

Based on Phase 1 implementation, here's the recommended order for Phase 2:

1. **First: Enable minified semantic intent**
   - Wire `buildMinifiedSemanticIntent()` into `buildSystemPrompt()`
   - This is low-risk since the function already exists
   - Measure token savings

2. **Second: Enable compact relationship context**
   - Wire `buildCompactRelationshipContext()` into the prompt
   - Replace verbose relationship metrics with semantic buckets
   - Measure token savings

3. **Third: Reorder sections**
   - This is the highest-risk change
   - Create `buildSystemPromptV2()` with new ordering
   - Add feature flag
   - Test extensively with manual QA

4. **Fourth: Remove redundant identity sections**
   - Search for duplicate identity instructions
   - Consolidate to single source of truth
   - Verify character still behaves correctly


---

## Expected Outcomes

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| System prompt tokens | ~8000 | ~4800 | **40% reduction** |
| JSON parsing failures | ~5% | <1% | **5x improvement** |
| Context window headroom | ~4K tokens | ~7K tokens | **More conversation history** |
| LLM adherence to format | ~85% | ~95% | **Better reliability** |

---

## Verification Plan

### Automated Testing

1. **Unit Tests** - Verify prompt generation produces expected structure
   ```bash
   npm run test -- promptUtils.test.ts
   ```

2. **Integration Tests** - Verify end-to-end response parsing
   ```bash
   npm run test -- --grep "JSON parsing"
   ```

### Manual Testing

1. **Token Count Validation**
   - Use [OpenAI Tokenizer](https://platform.openai.com/tokenizer) to count before/after
   - Target: <5000 tokens for system prompt

2. **Response Format Check**
   - Send 20 test messages across different relationship states
   - Verify 100% of responses are valid JSON with no preamble

3. **Behavioral Regression**
   - Test guardrails still work (inappropriate message handling)
   - Test relationship-appropriate responses (stranger vs. friend)

---

## Risk Mitigation

> [!CAUTION]
> Prompt changes can have unexpected behavioral effects.

1. **A/B Testing**: Run both prompt versions for a subset of users
2. **Gradual Rollout**: Phase 1 → Phase 2 → Phase 3 with validation between each
3. **Rollback Plan**: Keep current prompt as fallback, feature flag to switch
4. **Logging**: Add detailed logging for JSON parse failures during transition

---

## Related Documents

- [Semantic_Feedback.md](file:///c:/Users/gates/Personal/Interactive-Video-Character/docs/Semantic_Feedback.md) - Detailed review of intent detection system
- [Semantic_Intent_Detection.md](file:///c:/Users/gates/Personal/Interactive-Video-Character/docs/Semantic_Intent_Detection.md) - Implementation details
- [KAYLEY_CHARACTER_PROFILE_GUIDE.md](file:///c:/Users/gates/Personal/Interactive-Video-Character/docs/KAYLEY_CHARACTER_PROFILE_GUIDE.md) - Character profile documentation

---

## 🗂️ Key Files Reference (from Phase 1 Implementation)

### Core Files to Modify

| File | Purpose | Lines | Notes |
|------|---------|-------|-------|
| `src/services/promptUtils.ts` | System prompt construction | ~1900 | Main file for prompt changes |
| `src/utils/actionKeyMapper.ts` | Action key→UUID resolution | ~80 | **NEW in Phase 1** |
| `src/services/chatGPTService.ts` | ChatGPT integration | ~350 | Uses `resolveActionKey()` |
| `src/services/geminiChatService.ts` | Gemini integration | ~800 | Uses `resolveActionKey()` |
| `src/services/grokChatService.ts` | Grok integration | ~200 | Uses `resolveActionKeyInResponse()` |

### Test Files

| File | Tests | Purpose |
|------|-------|---------|
| `src/utils/tests/actionKeyMapper.test.ts` | 30 | Action key mapping tests |
| `src/services/tests/systemPrompt.test.ts` | 49 | Prompt structure tests |
| `src/services/tests/phase1Helpers.test.ts` | 31 | Helper function tests |
| `src/services/tests/promptUtils.test.ts` | 27 | Comfortable imperfection tests |

### Supporting Files

| File | Purpose |
|------|---------|
| `src/domain/characters/kayleyCharacterProfile.ts` | Character identity content |
| `src/services/relationshipService.ts` | Relationship metrics |
| `src/services/moodKnobs.ts` | Behavior parameters |
| `src/services/presenceDirector.ts` | Open loops & opinions |
| `src/services/intentService.ts` | Intent detection |

---

## ⚠️ Known Gotchas

### 1. Type Errors in grokChatService.ts
```
Type 'AIMessage[]' is not assignable to type 'ModelMessage[]'
```
**Status**: Pre-existing, unrelated to optimization. The `ai` SDK types don't match our `AIMessage` interface.

### 2. Mock Complexity in Tests
The `systemPrompt.test.ts` file mocks 6+ services. If you add new dependencies to `promptUtils.ts`, remember to mock them:
```typescript
vi.mock("../yourNewService", () => ({
  yourFunction: vi.fn(() => "mocked value"),
}));
```

### 3. Character-Specific vs Generic
- **Generic prompts**: In `promptUtils.ts` (sections like COMFORTABLE IMPERFECTION)
- **Character-specific**: In `kayleyCharacterProfile.ts` (Kayley's personality, insecurities)
- The prompt combines both - don't accidentally duplicate character content

### 4. Section Delimiters
Sections use `====` delimiters. Search with this regex to find all sections:
```bash
grep -n "====" src/services/promptUtils.ts | head -30
```

### 5. Determinism
The test `should be deterministic` ensures same input = same output. If you add any randomness (even timestamps), this test will fail.

---

## 📊 Phase 1 Metrics

**Lines of Code Changed:**
- `promptUtils.ts`: ~50 lines added
- `actionKeyMapper.ts`: 80 lines (new file)
- AI services: ~30 lines each

**Tests Added:**
- 110 new tests across 3 files

**Token Savings Estimate (Phase 1 only):**
- Action keys simplified: ~300 tokens saved per prompt
- Full Phase 1+2+3 target: ~3200 tokens (40% reduction)
