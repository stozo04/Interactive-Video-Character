# System Prompt Architecture Deep Dive

> **Created**: 2025-12-30
> **Purpose**: Complete analysis of the modular prompt system with consolidation recommendations

---

## Overview

The system prompt is built from **34 TypeScript files** organized into 8 folders. This modular architecture follows the **single responsibility principle** - each file handles ONE aspect of character behavior.

**Total: ~3,200 lines of code** (excluding tests)

---

## Architecture Diagram

```
buildSystemPrompt() in systemPromptBuilder.ts (638 lines)
    │
    ├── CORE IDENTITY (4 files, ~210 lines)
    │   ├── identityAnchor.ts      "You are Kayley Adams"
    │   ├── antiAssistant.ts       Anti-AI-assistant rules
    │   ├── opinionsAndPushback.ts Opinions, disagreement
    │   └── selfKnowledge.ts       Self-knowledge rules
    │
    ├── BEHAVIOR (5 files, ~365 lines)
    │   ├── comfortableImperfection.ts  Uncertainty, brevity
    │   ├── bidDetection.ts             Emotional bid types
    │   ├── selectiveAttention.ts       Focus on 1-2 points
    │   ├── motivatedFriction.ts        Boundaries, friction
    │   └── curiosityEngagement.ts      Mood-aware engagement
    │
    ├── CONTEXT (2 files, ~278 lines)
    │   ├── messageContext.ts      Semantic intent formatting
    │   └── styleOutput.ts         Style rules, brevity
    │
    ├── RELATIONSHIP (2 files, ~169 lines)
    │   ├── tierBehavior.ts        Per-tier rules
    │   └── dimensionEffects.ts    Warmth/trust/playfulness
    │
    ├── SOUL (4 files, ~490 lines)
    │   ├── soulLayerContext.ts    Orchestrates soul components
    │   ├── presencePrompt.ts      Presence/opinions
    │   ├── spontaneityPrompt.ts   Humor, playfulness
    │   └── (spontaneity/ folder)  External integration
    │
    ├── FEATURES (1 file, ~121 lines)
    │   └── selfieRules.ts         Image generation rules
    │
    ├── TOOLS (1 file, ~178 lines)
    │   └── toolsAndCapabilities.ts Tool documentation
    │
    └── FORMAT (1 file, ~117 lines)
        └── outputFormat.ts        JSON schema, output rules
```

---

## File-by-File Analysis

### 1. Core Identity (`core/`)

| File | Lines | Purpose | Called From |
|------|-------|---------|-------------|
| `identityAnchor.ts` | 54 | "You are Kayley Adams..." | systemPromptBuilder:169 |
| `antiAssistant.ts` | 74 | "You are NOT an AI assistant" | systemPromptBuilder:169 |
| `opinionsAndPushback.ts` | 54 | Opinions and disagreement | systemPromptBuilder:170 |
| `selfKnowledge.ts` | 28 | Rules for self-awareness | systemPromptBuilder:177 |

**Status**: All actively used. Cannot consolidate - each is distinct.

---

### 2. Behavior (`behavior/`)

| File | Lines | Purpose | Input | Called From |
|------|-------|---------|-------|-------------|
| `comfortableImperfection.ts` | 145 | Uncertainty is okay | None | systemPromptBuilder:316 |
| `bidDetection.ts` | 48 | COMFORT, PLAY, VALIDATION types | None | systemPromptBuilder:310 |
| `selectiveAttention.ts` | 25 | Focus on 1-2 points | None | systemPromptBuilder:313 |
| `motivatedFriction.ts` | 85 | When to push back | **KayleyMood** | systemPromptBuilder:319 |
| `curiosityEngagement.ts` | 62 | How deeply to engage | **KayleyMood** | systemPromptBuilder:294 |

**Consolidation Opportunity**: `motivatedFriction.ts` and `curiosityEngagement.ts` both take `KayleyMood` and generate mood-dependent behavior rules.

---

### 3. Context (`context/`)

| File | Lines | Purpose | Input | Called From |
|------|-------|---------|-------|-------------|
| `messageContext.ts` | 147 | Format intent/tone data | KayleyMood, Intent | systemPromptBuilder:195,186 |
| `styleOutput.ts` | 131 | Output style (brevity, formality) | KayleyMood, Relationship | systemPromptBuilder:299 |

**Consolidation Opportunity**: Both files format context for the prompt. They have similar structure and inputs.

---

### 4. Relationship (`relationship/`)

| File | Lines | Purpose | Input | Called From |
|------|-------|---------|-------|-------------|
| `tierBehavior.ts` | 103 | Per-tier behavior rules | RelationshipTier | systemPromptBuilder:237 |
| `dimensionEffects.ts` | 66 | Warmth/trust effects | RelationshipMetrics | systemPromptBuilder:238 |

**Status**: All actively used. Distinct concerns - keep separate.

---

### 5. Soul (`soul/`)

| File | Lines | Purpose | Input | Called From |
|------|-------|---------|-------|-------------|
| `soulLayerContext.ts` | 147 | Orchestrates soul components | userId | systemPromptBuilder:126 |
| `presencePrompt.ts` | 52 | Presence context | None | systemPromptBuilder:267 |
| `spontaneityPrompt.ts` | 291 | Humor/playfulness prompts | SpontaneityContext | via soulLayerContext |

**Note**: `spontaneityPrompt.ts` is large (291 lines) but provides distinct functionality.

---

### 6. Features (`features/`)

| File | Lines | Purpose | Input | Called From |
|------|-------|---------|-------|-------------|
| `selfieRules.ts` | 121 | When/how to take selfies | RelationshipTier | systemPromptBuilder:239 |

**Status**: Actively used. No consolidation needed.

---

### 7. Tools (`tools/`)

| File | Lines | Purpose | Called From |
|------|-------|---------|-------------|
| `toolsAndCapabilities.ts` | 178 | Tool documentation | systemPromptBuilder:178-180 |

**Status**: Actively used. No consolidation needed.

---

### 8. Format (`format/`)

| File | Lines | Purpose | Called From |
|------|-------|---------|-------------|
| `outputFormat.ts` | 117 | JSON schema, output rules | systemPromptBuilder:633-635 |

**Status**: Actively used. Must stay at END of prompt (recency bias).

---

## Dead Code Analysis

### Files Checked

| File | Status | Notes |
|------|--------|-------|
| All `core/` files | **ACTIVE** | Used in systemPromptBuilder |
| All `behavior/` files | **ACTIVE** | Used in systemPromptBuilder |
| All `context/` files | **ACTIVE** | Used in systemPromptBuilder |
| All `relationship/` files | **ACTIVE** | Used in systemPromptBuilder |
| All `soul/` files | **ACTIVE** | Used via soulLayerContext |
| All `features/` files | **ACTIVE** | Used in systemPromptBuilder |
| All `tools/` files | **ACTIVE** | Used in systemPromptBuilder |
| All `format/` files | **ACTIVE** | Used in systemPromptBuilder |

### Exported But Unused in Production

| Export | File | Used In |
|--------|------|---------|
| `UNCERTAINTY_RESPONSES` | comfortableImperfection.ts | Internal + Tests only |
| `BRIEF_RESPONSE_EXAMPLES` | comfortableImperfection.ts | Internal + Tests only |

**Conclusion**: No dead code found. All files and exports are actively used.

---

## Consolidation Recommendations

### Recommendation 1: Merge Mood-Based Behavior Files

**Merge**: `motivatedFriction.ts` + `curiosityEngagement.ts` → `moodBehavior.ts`

**Rationale**:
- Both take `KayleyMood` as input
- Both generate mood-dependent behavioral guidance
- Combined: ~147 lines (manageable)

**Before**:
```typescript
// Two separate calls
prompt += buildCuriosityEngagementSection(moodKnobs);  // line 294
prompt += buildMotivatedFrictionPrompt(moodKnobs);     // line 319
```

**After**:
```typescript
// Single consolidated call
prompt += buildMoodBehaviorSection(moodKnobs);
```

**Estimated Savings**: ~25 lines (removing duplicate mood threshold logic)

---

### Recommendation 2: Merge Context Formatting Files

**Merge**: `messageContext.ts` + `styleOutput.ts` → `contextFormatting.ts`

**Rationale**:
- Both format context for prompt injection
- Both use `KayleyMood` + relationship state
- Similar output structure (string building)

**Before**:
```typescript
// Two separate formatting calls
${buildMinifiedSemanticIntent(toneIntent, fullIntent, relationshipSignals, moodKnobs)}
// ... later ...
${buildStyleOutputSection(moodKnobs, relationship)}
```

**After**:
```typescript
// Could be consolidated but placement matters
// styleOutput MUST be after soul layer for proper token positioning
```

**Caveat**: These are called at different positions in the prompt. May need to keep separate for prompt ordering reasons.

---

### Recommendation 3: Keep Static Sections Separate

**DO NOT merge**:
- `bidDetection.ts` (48 lines) - Static content, no inputs
- `selectiveAttention.ts` (25 lines) - Static content, no inputs
- `comfortableImperfection.ts` (145 lines) - Complex, with example arrays

**Reason**: These are small, have no shared inputs, and serve distinct purposes.

---

## Complexity Assessment

### Is This Too Complex?

**Pros of Current Architecture**:
1. **Single Responsibility**: Each file does ONE thing
2. **Easy to Modify**: Change one aspect without affecting others
3. **Test Isolation**: Can test each section independently
4. **Clear Ownership**: Easy to find what controls behavior
5. **Conditional Inclusion**: Can skip sections based on state

**Cons**:
1. **Many Files**: 34 files across 8 folders
2. **Import Overhead**: systemPromptBuilder has ~25 imports
3. **Mental Load**: Need to understand file organization

### Verdict

The architecture is **appropriately complex** for the functionality it provides. The prompt system generates a ~15,000 token system prompt with:
- Dynamic mood-based behavior
- Tier-specific rules
- Context-aware formatting
- Tool documentation
- Output schema

**Simpler alternatives would sacrifice**:
- Maintainability (monolithic file is harder to modify)
- Testability (can't test sections independently)
- Flexibility (can't conditionally include sections)

---

## Simplification Options (If Desired)

### Option A: Light Consolidation (Recommended)
- Merge `motivatedFriction.ts` + `curiosityEngagement.ts`
- Keep everything else as-is
- **Impact**: Removes 1 file, ~25 lines saved

### Option B: Moderate Consolidation
- Merge all `behavior/` files except `comfortableImperfection.ts`
- Keep `context/` files separate (due to prompt ordering)
- **Impact**: Removes 3 files, ~50 lines saved

### Option C: Heavy Consolidation (Not Recommended)
- Merge multiple folders into larger files
- **Risk**: Loses benefits of modularity
- **Impact**: Removes 8+ files, harder to maintain

---

## Quick Reference: What Each File Does

| File | One-Line Description |
|------|---------------------|
| `identityAnchor.ts` | "You are Kayley Adams, a 23-year-old..." |
| `antiAssistant.ts` | "You are NOT an AI assistant" |
| `opinionsAndPushback.ts` | "You have opinions and can disagree" |
| `selfKnowledge.ts` | "Use vector search for self-knowledge" |
| `comfortableImperfection.ts` | "It's okay to be brief and uncertain" |
| `bidDetection.ts` | "Recognize COMFORT, PLAY, VALIDATION bids" |
| `selectiveAttention.ts` | "Focus on 1-2 salient points" |
| `motivatedFriction.ts` | "When to push back based on mood" |
| `curiosityEngagement.ts` | "How deeply to engage based on mood" |
| `messageContext.ts` | "Format intent/tone as prompt context" |
| `styleOutput.ts` | "Output style based on mood/tier" |
| `tierBehavior.ts` | "Stranger vs friend vs close friend rules" |
| `dimensionEffects.ts` | "How warmth/trust/playfulness affect behavior" |
| `soulLayerContext.ts` | "Get mood, threads, spontaneity context" |
| `presencePrompt.ts` | "Inject presence/opinions" |
| `spontaneityPrompt.ts` | "Humor and playfulness prompts" |
| `selfieRules.ts` | "When/how to generate selfies" |
| `toolsAndCapabilities.ts` | "Tool documentation for LLM" |
| `outputFormat.ts` | "JSON schema and output rules" |

---

## Summary

1. **No dead code found** - All 34 files are actively used
2. **Light consolidation possible** - 2 merges could reduce file count by 2
3. **Architecture is appropriate** - Complexity matches functionality
4. **Keep format at end** - Output rules MUST be last (recency bias)

---

## Related Documents

- [System Prompt Guidelines](./System_Prompt_Guidelines.md)
- [Sub-Agent Usage Guide](./Sub_Agent_Usage_Guide.md)
- [CLAUDE.md - System Prompt Section](../CLAUDE.md)
