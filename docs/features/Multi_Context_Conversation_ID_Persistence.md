# Multi-Context Conversation ID Persistence System

**Status:** Documentation Only - Pending API Verification
**Created:** 2026-01-15
**Last Updated:** 2026-01-15
**Approach:** Option B - Native API Support Only

## Table of Contents
1. [Overview](#overview)
2. [Current State Analysis](#current-state-analysis)
3. [Problem Statement](#problem-statement)
4. [Proposed Solution](#proposed-solution)
5. [System Design](#system-design)
6. [Database Schema](#database-schema)
7. [Implementation Steps](#implementation-steps)
8. [Testing Strategy](#testing-strategy)
9. [Migration Plan](#migration-plan)
10. [Future Considerations](#future-considerations)

---

## Overview

This document outlines the design and implementation plan for a multi-context conversation ID persistence system. Currently, the application only persists conversation IDs for the main chat conversation. However, Gemini is used in multiple contexts (intent detection, image generation, etc.), and we need to track and persist separate conversation IDs for each context that **natively supports** Gemini's Interactions API.

**Goal:** Persist separate Gemini interaction IDs for contexts where the API natively supports `previous_interaction_id` parameter with 24-hour TTL, mimicking the pattern used for main conversations.

**Constraint:** Only implement for APIs that natively support conversation IDs. If an API doesn't support `previous_interaction_id`, we will NOT build custom workarounds or logical conversation tracking.

---

## Current State Analysis

### How Conversation IDs Work Today (Main Chat)

Based on research of the existing codebase:

**1. Storage Mechanisms:**
- **Database:** `conversation_history` table with `interaction_id` column
- **In-Memory:** `aiSession` state in `App.tsx` (line 118)
- **Gemini API:** Uses `previous_interaction_id` parameter in `createInteraction()` calls

**2. Lifecycle:**
```typescript
// On app load (App.tsx:933-942)
const session: AIChatSession = { model: activeService.model };
const existingInteractionId = await conversationHistoryService.getTodaysInteractionId();
if (existingInteractionId) {
  session.interactionId = existingInteractionId;
}

// During conversation (geminiChatService.ts:626-698)
const interactionConfig = {
  model: "gemini-3-flash-preview",
  previous_interaction_id: session.interactionId, // Maintains conversation context
  input: [...userInput],
  system_instruction: systemPrompt,
  tools: [...]
};
let interaction = await this.createInteraction(interactionConfig);
```

**3. 24-Hour TTL Implementation:**
- **Implicit TTL:** Based on UTC date boundaries, not explicit expiration timestamps
- **Query-based filtering:** `getTodaysInteractionId()` only retrieves IDs created today (UTC)
- **Automatic expiration:** At UTC midnight, old IDs are no longer retrieved

**File:** `conversationHistoryService.ts:206-233`
```typescript
export const getTodaysInteractionId = async (): Promise<string | null> => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); // Start of today (UTC)

  const { data } = await supabase
    .from(CONVERSATION_HISTORY_TABLE)
    .select("interaction_id")
    .gte("created_at", today.toISOString()) // Only today's records
    .not("interaction_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);

  return data?.[0]?.interaction_id || null;
};
```

---

## Problem Statement

### Current Gemini Use Cases

The application uses Gemini API in **5 distinct contexts**:

| Context | File | API Used | Has Interaction ID? |
|---------|------|----------|-------------------|
| **Main Conversation** | `geminiChatService.ts` | `createInteraction()` | ✅ Yes (persisted) |
| **Intent Detection** | `intentService.ts` | `generateContent()` | ❌ No |
| **Temporal Detection** | `imageGeneration/temporalDetection.ts` | `generateContent()` | ❌ No |
| **Image Prompt Generation** | `imageGeneration/promptGenerator.ts` | `generateContent()` | ❌ No |
| **Image Generation (Imagen)** | `imageGenerationService.ts` | `generateContent()` (Imagen) | ❌ No |

### API Capability Assessment

**CRITICAL REQUIREMENT:** Before implementing conversation ID persistence for any context, we must verify that the Gemini API method actually supports `previous_interaction_id` parameter.

**Known API Capabilities:**

| API Method | Supports `previous_interaction_id`? | Evidence |
|------------|-----------------------------------|----------|
| `createInteraction()` | ✅ **YES** | Currently used in main chat (geminiChatService.ts:626-698) |
| `generateContent()` (Flash/Pro) | ⚠️ **UNKNOWN** - Needs verification | Used in intent, temporal, prompt services |
| `generateContent()` (Imagen) | ❌ **NO** | Different API endpoint, no conversation support |

**Action Required:** Verify `generateContent()` API documentation and test whether it accepts `previous_interaction_id` parameter for Flash/Pro models.

### Use Case Analysis

**Which contexts would benefit from conversation IDs?**

| Context | Benefit | Should Implement? |
|---------|---------|-------------------|
| **Main Chat** | ✅ Critical - maintains conversation flow | ✅ Already implemented |
| **Intent Detection** | ❌ Stateless by design - each message analyzed independently | ❌ No |
| **Temporal Detection** | ❌ Stateless - analyzes specific message timing | ❌ No |
| **Image Prompt Generation** | ✅ Helpful - could reference previous selfie requests | ⚠️ **Only if API supports it** |
| **Image Generation (Imagen)** | ❌ Different API, no native support | ❌ No |

---

## Proposed Solution

### Design Decision: **Option B - Native API Support Only**

**Constraint:** We will ONLY implement conversation ID persistence for contexts where Gemini's API natively supports the `previous_interaction_id` parameter. If an API doesn't support it, we will NOT implement the feature.

**Rationale:**
1. **Simplicity:** Avoid building custom "logical conversation tracking" that duplicates what the API should provide
2. **Reliability:** Use Gemini's native conversation context mechanisms rather than trying to simulate them
3. **Maintainability:** Fewer moving parts, less code to maintain
4. **API-First:** Let the API's capabilities drive our implementation, not vice versa

### Implementation Strategy

**Phase 0: API Verification (BLOCKING)** 🚨
- Test whether `generateContent()` API accepts `previous_interaction_id` parameter
- Document which models/APIs support conversation IDs
- Create test cases to verify conversation context is maintained

**Phase 1: Implement ONLY for Verified APIs**
- If `generateContent()` supports it → Implement for image prompt generation
- If `generateContent()` does NOT support it → Skip image prompt generation
- Keep main chat as-is (already working)

**Phase 2: Infrastructure**
- Create centralized service ONLY if we have 2+ contexts to manage
- If only main chat supports it, keep existing implementation

### Decision Tree

```
For each Gemini use case:
  ├─ Does the API method support previous_interaction_id?
  │  ├─ YES → Would conversation context benefit this use case?
  │  │  ├─ YES → Implement conversation ID persistence
  │  │  └─ NO → Skip (stateless by design)
  │  └─ NO → SKIP - Do not implement
  └─ Document decision and reasoning
```

---

## System Design

**Note:** This design is CONDITIONAL on Phase 0 API verification. If `generateContent()` does NOT support `previous_interaction_id`, we will skip this entire implementation and keep only the existing main chat functionality.

### 1. New Service: `conversationContextService.ts` (Conditional)

**Purpose:** Centralized management of conversation contexts across Gemini use cases that NATIVELY support conversation IDs.

**Responsibilities:**
- Store and retrieve interaction IDs by context type
- Manage 24-hour TTL for each context
- Provide context-aware restoration on app load
- Support ONLY contexts where API natively supports `previous_interaction_id`

**Implementation Trigger:** Create this service ONLY IF we have 2+ contexts to manage. If only main chat supports conversation IDs, keep the existing `conversationHistoryService.ts` implementation.

### 2. Context Types (Conditional)

**To be determined after Phase 0 API verification.**

Possible scenarios:

**Scenario A: `generateContent()` supports `previous_interaction_id`**
```typescript
export type ConversationContextType =
  | 'main_chat'              // Main conversation (createInteraction API)
  | 'image_prompt';          // Image prompt generation (generateContent API)
```

**Scenario B: `generateContent()` does NOT support `previous_interaction_id`**
```typescript
// No new service needed - keep existing implementation
// Only main_chat (createInteraction API) supports conversation IDs
```

### 3. Context Configuration (Conditional)

**If implementing new service (Scenario A):**

```typescript
interface ContextConfig {
  type: ConversationContextType;
  apiMethod: 'createInteraction' | 'generateContent'; // Which API method to use
  ttlHours: number;          // Time-to-live in hours (default: 24)
  supportsConversationIds: true; // ALL contexts in this config must support IDs
}

const CONTEXT_CONFIGS: Record<ConversationContextType, ContextConfig> = {
  main_chat: {
    type: 'main_chat',
    apiMethod: 'createInteraction',
    ttlHours: 24,
    supportsConversationIds: true
  },
  image_prompt: {
    type: 'image_prompt',
    apiMethod: 'generateContent',
    ttlHours: 24,
    supportsConversationIds: true // VERIFIED in Phase 0
  }
};
```

**Key Principle:** `supportsConversationIds` is ALWAYS `true` for all entries. We never add contexts that don't support conversation IDs.

### 4. API Design

```typescript
// Get today's interaction ID for a specific context
export async function getContextInteractionId(
  contextType: ConversationContextType
): Promise<string | null>;

// Save interaction ID for a context
export async function saveContextInteractionId(
  contextType: ConversationContextType,
  interactionId: string
): Promise<void>;

// Clear all expired contexts (maintenance)
export async function clearExpiredContexts(): Promise<void>;

// Get all active contexts (debugging)
export async function getActiveContexts(): Promise<ContextInfo[]>;
```

---

## Database Schema (Conditional)

**Note:** Database schema design is CONDITIONAL on Phase 0 verification results.

### Decision Matrix

| Phase 0 Result | Database Action | Rationale |
|----------------|----------------|-----------|
| ✅ `generateContent()` supports `previous_interaction_id` | Create new `conversation_contexts` table | Need to track 2+ contexts (main_chat + image_prompt) |
| ❌ `generateContent()` does NOT support | Keep existing `conversation_history` table | Only 1 context (main_chat) - no need for new infrastructure |

### Proposed Schema (If Needed)

**Scenario A: Create New Table `conversation_contexts`**

Only create this table if Phase 0 verification confirms `generateContent()` supports conversation IDs.

```sql
CREATE TABLE conversation_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_type TEXT NOT NULL,
  interaction_id TEXT NOT NULL,
  api_method TEXT NOT NULL, -- 'createInteraction' or 'generateContent'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  metadata JSONB,
  CONSTRAINT unique_context_per_day UNIQUE(context_type, (created_at AT TIME ZONE 'UTC')::DATE)
);

CREATE INDEX idx_conversation_contexts_type ON conversation_contexts(context_type);
CREATE INDEX idx_conversation_contexts_expires ON conversation_contexts(expires_at);
CREATE INDEX idx_conversation_contexts_created ON conversation_contexts(created_at);

COMMENT ON TABLE conversation_contexts IS 'Tracks Gemini interaction IDs across contexts that natively support previous_interaction_id parameter';
COMMENT ON COLUMN conversation_contexts.api_method IS 'Which Gemini API method: createInteraction or generateContent';
```

**Scenario B: Keep Existing Implementation**

No changes needed. Continue using `conversation_history` table for main chat only.

---

## Implementation Steps

### Phase 0: API Verification (REQUIRED - BLOCKING) 🚨

**Duration:** 1-2 hours
**Status:** NOT STARTED
**Blocker:** Must complete before any implementation

#### Step 0.1: Research Gemini API Documentation

**Objective:** Determine if `generateContent()` API accepts `previous_interaction_id` parameter.

**Resources to check:**
- Google AI JavaScript SDK documentation for `generateContent()` method
- Gemini API reference documentation
- Google AI Studio / API examples

**Expected Outcomes:**
- ✅ **YES** - Documentation confirms `generateContent()` supports `previous_interaction_id`
- ❌ **NO** - Documentation shows no such parameter
- ⚠️ **UNCLEAR** - Need to proceed to Step 0.2 for testing

#### Step 0.2: Create Test Script

**File:** `src/services/tests/apiVerification.test.ts` (Documentation only - no code yet)

**Test Plan:**
```typescript
// Test 1: Verify generateContent accepts previous_interaction_id
describe('Gemini API Verification', () => {
  it('should accept previous_interaction_id in generateContent', async () => {
    // Call generateContent with previous_interaction_id parameter
    // Verify: No error thrown
    // Verify: Response maintains conversation context
  });

  it('should maintain conversation context across calls', async () => {
    // Call 1: Ask "What's my name?"
    // Call 2: Say "My name is Alex"
    // Call 3: Ask "What's my name?" with previous_interaction_id from Call 2
    // Verify: Call 3 response references "Alex"
  });
});
```

#### Step 0.3: Document Findings

**File:** `docs/features/API_Verification_Results.md` (Documentation only - no code yet)

**Required Documentation:**
- Which APIs support `previous_interaction_id`
- Test results with evidence (screenshots, logs)
- Decision: Proceed with implementation or stop here

**Decision Point:**
- If `generateContent()` does NOT support conversation IDs → **STOP HERE** - No further implementation needed
- If `generateContent()` DOES support conversation IDs → **Proceed to Phase 1**

---

### Phase 1: Core Infrastructure (CONDITIONAL)

**Pre-requisite:** Phase 0 completed with ✅ YES result
**Duration:** 2-3 hours (if proceeding)

#### Step 1.1: Create Database Migration
**File:** `supabase/migrations/create_conversation_contexts.sql` (NO CODE YET)

**Description:** Create `conversation_contexts` table with schema from Database Schema section above.

**Key Fields:**
- `context_type`: 'main_chat' or 'image_prompt' (verified contexts only)
- `interaction_id`: Gemini interaction ID from API response
- `api_method`: 'createInteraction' or 'generateContent' (for debugging)
- `created_at` / `expires_at`: 24-hour TTL tracking

**Migration Steps:** User will apply manually after Phase 0 verification completes.

---

#### Step 1.2: Create Service
**File:** `src/services/conversationContextService.ts` (NO CODE YET)

**Description:** Centralized service for managing conversation contexts.

**Core Functions:**
- `getContextInteractionId(contextType)`: Retrieve today's interaction ID for a context
- `saveContextInteractionId(contextType, interactionId)`: Save with automatic 24-hour expiration
- `clearExpiredContexts()`: Maintenance cleanup function
- `getActiveContexts()`: Debug function

**Key Design Principles:**
- Only track contexts where API natively supports `previous_interaction_id`
- Mimic existing `conversationHistoryService.ts` pattern for consistency
- UTC-based date boundaries for TTL (not absolute timestamps)
- Simple CRUD operations, no complex state management

---

#### Step 1.3: Create Tests
**File:** `src/services/tests/conversationContextService.test.ts` (NO CODE YET)

**Test Coverage:**
- Get interaction ID for verified contexts
- Save interaction ID with 24-hour expiration
- Verify TTL behavior (returns null after expiration)
- Verify UTC date boundary logic
- Test concurrent access/updates

---

### Phase 2: Integration with Verified Contexts (CONDITIONAL)

**Pre-requisite:** Phase 1 complete
**Duration:** 2-3 hours (if proceeding)

#### Step 2.1: Update Image Prompt Generation Service (If Verified)
**File:** `src/services/imageGeneration/promptGenerator.ts` (NO CODE YET - CONDITIONAL)

**Changes:**
- Import `conversationContextService`
- Call `getContextInteractionId('image_prompt')` before API call
- Pass `previous_interaction_id` to `generateContent()` if available
- Save returned interaction ID after successful call

**Verification:** Test that image prompt requests maintain conversation context across multiple selfie generations in same day.

---

#### Step 2.2: Migrate Main Chat to Use New Service (Optional)
**File:** `src/services/conversationHistoryService.ts` (NO CODE YET - OPTIONAL)

**Changes:**
- Deprecate `getTodaysInteractionId()` function
- Redirect to `getContextInteractionId('main_chat')`
- Update `saveConversationHistory()` to also save to `conversation_contexts` table

**Note:** This step is OPTIONAL - only do it if we want unified conversation context tracking. Otherwise, keep main chat using existing implementation.

---

### Phase 3: Testing and Validation (CONDITIONAL)

**Pre-requisite:** Phase 2 complete
**Duration:** 1-2 hours

#### Manual Testing Checklist

**Test Case 1: Image Prompt Context Persistence**
- [ ] Generate first selfie of the day
- [ ] Verify interaction ID saved to `conversation_contexts` table
- [ ] Generate second selfie with related request ("similar outfit, different pose")
- [ ] Verify same interaction ID used (conversation context maintained)
- [ ] Verify response references previous selfie context

**Test Case 2: 24-Hour TTL**
- [ ] Create context
- [ ] Fast-forward time (modify `created_at` in DB to yesterday)
- [ ] Call `getContextInteractionId`
- [ ] Verify returns null (expired)

**Test Case 3: Cross-Context Independence**
- [ ] Create interaction IDs for multiple contexts on same day
- [ ] Verify each context tracks independently
- [ ] Verify expiration doesn't affect other contexts

---

### Phase 4: Documentation (CONDITIONAL)

**Pre-requisite:** Phase 3 complete
**Duration:** 1 hour

#### Required Documentation Updates

1. **Service Documentation:**
   - `src/services/docs/ConversationContextService.md` (if new service created)
   - Update `src/services/docs/README.md` with link

2. **Sub-Agent Updates:**
   - Update `.claude/agents/image-generation-specialist.md` (if image context added)
   - Update relevant agent capabilities

3. **Implementation Summary:**
   - Create `docs/features/API_Verification_Results.md` with findings
   - Document which APIs support conversation IDs
   - Include test results and evidence

---

## Testing Strategy

### Phase 0 Testing (API Verification)
- **Objective:** Verify API capabilities
- **Method:** Manual testing with Gemini API
- **Success Criteria:** Documented proof that API supports or doesn't support `previous_interaction_id`

### Unit Tests (If Implementing)
- Service functions (get, save, clear, getActive)
- Edge cases (expired contexts, missing data)
- Error handling (DB failures)

### Integration Tests (If Implementing)
- Image prompt generation with conversation context
- Cross-context independence
- TTL expiration behavior

---

## Migration Plan (CONDITIONAL)

### If Proceeding After Phase 0:

**Step 1: Database Migration**
- User applies migration manually
- Verify table created successfully
- Verify indexes exist

**Step 2: Deploy New Service**
- Deploy `conversationContextService.ts`
- No breaking changes to existing code

**Step 3: Gradual Integration**
- Enable for image prompt generation only (if verified)
- Monitor for errors/performance issues
- Optionally migrate main chat after stabilization

### If NOT Proceeding (API Doesn't Support):

**Action:** No changes needed. Document findings in `API_Verification_Results.md` and close this feature request.

---

## Future Considerations

### If API Supports Conversation IDs

1. **Additional Contexts:**
   - Add conversation IDs for other Gemini use cases as they're added
   - Maintain same verification process (test API support first)

2. **Dynamic TTL:**
   - Allow different TTL per conversation type
   - Support user preferences for context retention

3. **Cross-Context References:**
   - Link related contexts (e.g., "selfie generated during this conversation")
   - Enable richer context awareness

### If API Does NOT Support Conversation IDs

1. **Accept Limitation:**
   - Document that only main chat supports conversation IDs
   - Don't build custom workarounds

2. **Alternative Approaches:**
   - Pass explicit context in prompts instead of relying on conversation IDs
   - Use metadata/cache for short-term context (not persisted across sessions)

3. **Monitor API Updates:**
   - Revisit if Gemini adds conversation ID support to `generateContent()` API in future

---

## Summary

This implementation plan provides:

### ✅ Deliverables (Documentation Only)
- Comprehensive API verification process (Phase 0)
- Conditional implementation plan based on verification results
- Clear decision points: implement vs. don't implement
- Database schema (if needed)
- Service architecture (if proceeding)
- Testing strategy
- Migration plan

### 🚨 Critical Constraint
**ONLY implement for APIs that natively support `previous_interaction_id`**
- If `generateContent()` doesn't support it → STOP, document findings, keep existing implementation
- If `generateContent()` does support it → Proceed with implementation

### ⏱️ Estimated Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 0: API Verification | 1-2 hours | ⚠️ REQUIRED FIRST |
| Phase 1: Core Infrastructure | 2-3 hours | Conditional |
| Phase 2: Integration | 2-3 hours | Conditional |
| Phase 3: Testing | 1-2 hours | Conditional |
| Phase 4: Documentation | 1 hour | Conditional |
| **TOTAL (if proceeding)** | **7-11 hours** | Conditional |
| **TOTAL (if not proceeding)** | **1-2 hours** | Document findings only |

### 🎯 Next Steps

1. **User Action:** Review and approve this documentation
2. **Developer Action:** Execute Phase 0 API verification
3. **Decision Point:** Based on Phase 0 results, either:
   - ✅ Proceed with Phases 1-4 (if API supports it)
   - ❌ Document findings and close (if API doesn't support it)
