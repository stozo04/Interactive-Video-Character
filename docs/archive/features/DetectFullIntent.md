# Unified Intent Detection (Optimized Design)

> **Status**: ✅ **IMPLEMENTED** (2025-12-14)  
> **Goal**: Consolidate 6 individual LLM calls into a single `detectFullIntent` call to reduce latency and cost.

## Overview
Currently, the system makes parallel LLM calls for:
1. Genuine Moment Detection
2. Tone & Sentiment
3. Mood (derived from Tone/Topic)
4. Topics
5. Open Loops
6. Relationship Signals

This optimization proposes a single "Master Call"  that returns a nested JSON object containing all these insights.

## Architecture

### New Interface
```typescript
export interface FullMessageIntent {
    genuineMoment: GenuineMomentIntent;
    tone: ToneIntent;
    topics: TopicIntent;
    openLoops: OpenLoopIntent;
    relationshipSignals: RelationshipSignalIntent;
}
```

### New Function
`detectFullIntentLLM(message: string, context?: ConversationContext)`

### Prompt Strategy
Combine the essential instructions from all 6 phases into a single structured prompt requesting a nested JSON response.

## Integration Plan

### Intent Service (`src/services/intentService.ts`)
- Add `FullMessageIntent` interface.
- Implement `detectFullIntentLLM` function.
- Implement `detectFullIntentLLMCached`.

### Presence Director (`src/services/presenceDirector.ts`)
- Update `detectOpenLoops` to accept an optional `OpenLoopIntent` injection.
- This prevents `detectOpenLoops` from making its own redundant LLM call when we already have the intent.

### Message Analyzer (`src/services/messageAnalyzer.ts`)
- ✅ Replace the `Promise.all` block of individual calls with a single `detectFullIntentLLM` call.
- ✅ Distribute the results to the respective services.
- ✅ **Fallback**: If the master call fails, fall back to individual keyword detection strategies for each component (implemented per design).

## Technical Considerations & Refinements (Added Analysis)

### 1. "All-or-Nothing" Fallback Strategy ✅ IMPLEMENTED
If the master `detectFullIntent` call fails (e.g., network error, malformed JSON), strict rule: **Do NOT fallback to individual LLM calls.**
- **Reason:** Falling back to 6 separate LLM calls would cause massive latency spikes (2s+).
- **Solution:** Fall back immediately and exclusively to the **Keyword/Regex** detection functions already implemented in each service. This ensures the chat remains responsive even if the "brain" hiccups.

**Implementation Status:**
- ✅ Fallback uses `detectGenuineMoment()` (keyword function from `moodKnobs.ts`)
- ✅ Fallback uses `analyzeMessageToneKeywords()` (keyword function from `messageAnalyzer.ts`)
- ✅ Fallback uses `detectTopics()` (keyword function from `userPatterns.ts`)
- ✅ Open loops and relationship signals return safe defaults (no LLM calls)
- ✅ All fallback logic is synchronous (<10ms, no network latency)

### 2. Latency vs. Throughput Trade-off
- **Expectation:** Network overhead drops by ~80% (1 call vs 6).
- **Reality Check:** The *generation* time for the LLM might increase slightly because it is generating a larger JSON object (more tokens = more time).
- **Verdict:** Net latency should still decrease or stay neutral, but *cost* and *complexity* will drop significantly. The system will be "smoother" rather than drastically "faster."

### 3. Prompt Isolation
- **Risk:** "Context Bleeding." For example, if the prompt detects a "Work" topic, it might hallucinate a "Work" open loop even if one doesn't exist.
- **Mitigation:** The prompt must clearly delineate sections. We will use strict system instructions: *"Evaluate each section independently based solely on the evidence provided."*

### 4. Service Injection Pattern
- **Critical Implementation Detail:** Services like `presenceDirector` currently encapsulate their own detection logic.
- **Requirement:** We must refactor `presenceDirector.detectOpenLoops` and `relationshipService.updateRelationship` to accept an *optional* pre-calculated intent object.
    - `detectOpenLoops(..., intent?: OpenLoopIntent)`
    - `updateRelationship(..., intent?: RelationshipSignalIntent)`
- This allows `messageAnalyzer` to act as the "Orchestrator" that feeds these services.

## Verification ✅ COMPLETE

### Implementation Status
- ✅ Unified intent detection implemented (`detectFullIntentLLM` in `intentService.ts`)
- ✅ Integration complete (`messageAnalyzer.ts` uses unified call)
- ✅ Fallback strategy implemented (keyword functions, no LLM calls)
- ✅ Pre-calculation in `BaseAIService` (intent calculated before response generation)
- ✅ Service injection pattern (services accept optional pre-calculated intent)

### Performance Improvements
- ✅ Reduced from 6 parallel LLM calls to 1 unified call
- ✅ Token limit increased from 1000 to 2000 to prevent truncation
- ✅ Cache strategy prevents duplicate calls within same message flow
- ✅ Fallback uses keyword functions (<10ms, no network latency)

### Testing
- ✅ Validate that the "Master Prompt" fits within context limits
- ✅ Ensure `gemini-2.5-flash` can handle the complexity without hallucinating
- ✅ Verify fallback path works correctly (keyword detection when unified call fails)
- ✅ Test that pre-calculated intent is properly passed through the flow
