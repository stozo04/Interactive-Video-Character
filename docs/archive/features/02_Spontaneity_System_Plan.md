# Spontaneity System - Implementation Plan

> **Created**: 2025-12-26
> **Status**: In Progress
> **Approach**: TDD (Test-Driven Development)
> **Sub-Agents Used**: state-manager, prompt-architect, test-engineer, presence-proactivity, relationship-dynamics, intent-analyst, chat-engine-specialist

---

## Overview

This plan implements the Spontaneity System from `02_Spontaneity_System.md` with additional enhancements based on feedback:

1. **Visual-Emotional Bridge** - Map internal states to video manifests
2. **Independent Reflection Loop** - Post-session synthesis and dream generation
3. **Orchestration & Latency Management** - Dirty flag system, optimized fetches
4. **Explicit Relationship Thresholds** - Milestone-gated advancement, rupture penalties

---

## Phase 1: Database Schema (state-manager)

### New Tables

```sql
-- 1. kayley_pending_shares - Things Kayley wants to share
-- 2. spontaneous_selfie_history - Track selfie patterns for cooldown
-- 3. session_reflections - Post-session synthesis (NEW from feedback)
-- 4. idle_thoughts - Dream/thought generation during absence (NEW from feedback)
-- 5. visual_state_mapping - Map emotional states to video manifests (NEW from feedback)
```

### RPC Function Updates

- Update `get_full_character_context()` to include spontaneity state
- Add dirty flag support for selective fetching

---

## Phase 2: Core Types (types.ts)

### Files to Create

- `src/services/spontaneity/types.ts` - Core type definitions
- `src/services/spontaneity/index.ts` - Barrel export

### Types to Define

```typescript
- ConversationalMood
- SpontaneousActionType
- SpontaneousSelfieReason
- SpontaneousSelfieContext
- SpontaneityContext
- PendingShare
- SpontaneityDecision
- SessionReflection (NEW)
- IdleThought (NEW)
- VisualStateMapping (NEW)
```

---

## Phase 3: Spontaneity Tracker (presence-proactivity + state-manager)

### Files to Create

- `src/services/spontaneity/spontaneityTracker.ts`
- `src/services/spontaneity/__tests__/spontaneityTracker.test.ts`

### Functions

1. `resetConversationState()` - Reset at conversation start
2. `trackMessage(topics: string[])` - Track topics discussed
3. `trackLaughter()` - Track humor landing
4. `recordSpontaneousAction(type)` - Record for cooldown
5. `getPendingShares(userId)` - Fetch active pending shares
6. `createPendingShare(userId, share)` - Create new pending share
7. `markShareAsShared(shareId)` - Mark as shared
8. `calculateSpontaneityProbability()` - Base probability
9. `calculateSelfieProbability()` - Selfie-specific probability
10. `determineSelfieReason()` - Best reason for selfie

### TDD Approach

1. Write tests first for each function
2. Implement to make tests pass
3. Run snapshot tests to verify integration

---

## Phase 4: Spontaneity Prompt Builder (prompt-architect)

### Files to Create

- `src/services/system_prompts/soul/spontaneityPrompt.ts`
- `src/services/system_prompts/soul/__tests__/spontaneityPrompt.test.ts`

### Functions

1. `buildSpontaneityPrompt(context, pendingShares)` - Main section
2. `buildSpontaneousSelfiePrompt(context)` - Selfie guidance
3. `buildHumorGuidance(context)` - Humor calibration

### Integration Points

- Wire into `systemPromptBuilder.ts`
- Export from `system_prompts/soul/index.ts`
- Update `system_prompts/index.ts`

---

## Phase 5: Association Engine (intent-analyst)

### Files to Create

- `src/services/spontaneity/associationEngine.ts`
- `src/services/spontaneity/__tests__/associationEngine.test.ts`

### Functions

1. `findRelevantAssociations(pendingShares, currentTopics)` - Topic matching
2. `calculateTopicSimilarity(topic1, topic2)` - Similarity score
3. `generateAssociationOpener(match)` - Natural opener generation

---

## Phase 6: Visual-Emotional Bridge (NEW - chat-engine-specialist)

### Files to Create

- `src/services/spontaneity/visualStateMapper.ts`
- `src/services/spontaneity/__tests__/visualStateMapper.test.ts`

### Purpose

Map internal emotional states to video manifest IDs and backgrounds.

### Functions

1. `mapEmotionalStateToVideo(momentum, energy, mood)` - Get video manifest
2. `mapLocationToBackground(location)` - Get UI background
3. `getVisualContext(fullState)` - Combined visual context

### Example Mapping

```typescript
{
  'guarded': 'idle_reserved',
  'open': 'idle_warm',
  'playful': 'idle_bouncy',
  'vulnerable': 'idle_soft'
}
```

---

## Phase 7: Independent Reflection Loop (NEW - presence-proactivity + intent-analyst)

### Files to Create

- `src/services/spontaneity/sessionReflection.ts`
- `src/services/spontaneity/idleThoughts.ts`
- `src/services/spontaneity/__tests__/sessionReflection.test.ts`
- `src/services/spontaneity/__tests__/idleThoughts.test.ts`

### Session Reflection

When user leaves:
1. Summarize session's emotional arc
2. Store memorable moments
3. Identify unresolved threads

### Idle Thought Generation

During long absences:
1. Generate thoughts based on memorable statements
2. Create dream-like associations
3. Prepare proactive starters for return

---

## Phase 8: Integration with Chat Flow (chat-engine-specialist)

### Files to Modify

- `src/services/BaseAIService.ts` - Add spontaneity integration
- `src/services/system_prompts/builders/systemPromptBuilder.ts` - Wire prompts

### Integration Points

1. Pre-message: Build spontaneity context
2. Prompt building: Include spontaneity sections
3. Post-message: Record spontaneous actions, update state
4. Session end: Trigger reflection loop

---

## Phase 9: Relationship Thresholds (relationship-dynamics)

### Files to Modify

- `src/services/relationshipService.ts`

### Enhancements

1. **Milestone-Gated Advancement**
   - Define required milestones per tier
   - Check milestones before tier advancement

2. **Rupture Penalty**
   - Define momentum loss for conflict severity
   - Implement tier demotion mechanics
   - Add "Repair Attempt" detection

---

## Phase 10: Orchestration & Latency (state-manager)

### Optimization Strategy

1. **Dirty Flag System**
   - Track which state has changed
   - Only fetch changed components

2. **Parallel Fetch RPC**
   - Update `get_full_character_context()` to include:
     - Spontaneity state
     - Session reflection
     - Visual state mapping

3. **Caching Strategy**
   - Cache spontaneity context (30s TTL)
   - Invalidate on spontaneous action

---

## SQL Scripts Required

The following SQL migrations need to be executed:

1. `supabase/migrations/20251226_create_pending_shares.sql`
2. `supabase/migrations/20251226_create_selfie_history.sql`
3. `supabase/migrations/20251226_create_session_reflections.sql`
4. `supabase/migrations/20251226_create_idle_thoughts.sql`
5. `supabase/migrations/20251226_create_visual_state_mapping.sql`
6. `supabase/migrations/20251226_update_character_context_rpc.sql`

---

## Testing Strategy (TDD)

### Test Order

1. **Unit Tests First**
   - Types and interfaces
   - Pure functions (probability calculations, similarity)
   - Prompt builders

2. **Integration Tests**
   - Database operations
   - State tracking across messages
   - Prompt integration

3. **Snapshot Tests**
   - Prompt output verification
   - Ensure no regression

### Test Files

```
src/services/spontaneity/__tests__/
├── spontaneityTracker.test.ts
├── spontaneityPromptBuilder.test.ts
├── associationEngine.test.ts
├── visualStateMapper.test.ts
├── sessionReflection.test.ts
└── idleThoughts.test.ts
```

---

## Sub-Agent Responsibilities

| Agent | Responsibility | Files |
|-------|---------------|-------|
| `state-manager` | Database schema, RPC, caching | SQL migrations, stateService |
| `prompt-architect` | Prompt sections, integration | system_prompts/soul/* |
| `test-engineer` | TDD tests, coverage | __tests__/* |
| `presence-proactivity` | Tracker, reflection loop | spontaneityTracker, sessionReflection |
| `relationship-dynamics` | Tier thresholds, rupture | relationshipService |
| `intent-analyst` | Association engine, mood | associationEngine |
| `chat-engine-specialist` | Chat integration, visual bridge | BaseAIService, visualStateMapper |

---

## Documentation Updates

After implementation:

1. **README.md**
   - Add Spontaneity System section
   - Update architecture diagram
   - Document new sub-agent usage

2. **System_Prompt_Guidelines.md**
   - Add spontaneity prompt section
   - Document conditional inclusion patterns
   - Add testing examples

3. **Sub-Agent Usage Guide** (NEW)
   - How to invoke each agent
   - Best practices
   - Examples for each domain

---

## Execution Order

1. Create SQL migrations (state-manager)
2. Create types (manual)
3. Write tracker tests, then implement (test-engineer + presence-proactivity)
4. Write prompt tests, then implement (test-engineer + prompt-architect)
5. Write association tests, then implement (test-engineer + intent-analyst)
6. Write visual bridge tests, then implement (test-engineer + chat-engine-specialist)
7. Write reflection tests, then implement (test-engineer + presence-proactivity)
8. Integrate with chat flow (chat-engine-specialist)
9. Update relationship thresholds (relationship-dynamics)
10. Update documentation (manual)
11. Create sub-agent usage guide (manual)

---

## Success Criteria

- [ ] All new tests pass
- [ ] Existing 554+ tests still pass
- [ ] Response latency remains <2s
- [ ] Snapshot tests updated and verified
- [ ] SQL migrations documented
- [ ] README and guidelines updated
- [ ] Sub-agent guide created
