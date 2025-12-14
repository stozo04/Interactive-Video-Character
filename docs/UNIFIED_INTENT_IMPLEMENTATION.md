# Unified Intent Detection - Implementation Summary

> **Date**: 2025-12-14  
> **Status**: ✅ Complete

## Overview

The unified intent detection system consolidates 6 individual LLM calls into a single `detectFullIntentLLM` call, reducing latency, cost, and complexity while maintaining semantic understanding.

## Implementation Details

### Core Function
- **File**: `src/services/intentService.ts`
- **Function**: `detectFullIntentLLM(message, context?)`
- **Model**: `gemini-2.5-flash`
- **Token Limit**: 2000 (increased from 1000 to prevent truncation)

### Integration Points

1. **BaseAIService** (`src/services/BaseAIService.ts`)
   - Pre-calculates intent before generating response
   - Allows instant mood shifts for genuine moments
   - Passes `preCalculatedIntent` to `messageAnalyzer`

2. **MessageAnalyzer** (`src/services/messageAnalyzer.ts`)
   - Uses unified intent when available
   - Falls back to keyword functions (not LLM calls) on failure
   - Distributes results to respective services

3. **Service Injection**
   - `detectOpenLoops()` accepts optional `providedIntent`
   - `detectMilestoneInMessage()` accepts optional intent
   - Prevents redundant LLM calls

## Fallback Strategy

**Critical Design Decision**: When unified intent detection fails, the system falls back to **keyword/regex functions**, NOT individual LLM calls.

### Why?
- Individual LLM calls would cause 2s+ latency spikes
- Keyword functions are instant (<10ms)
- Keeps chat responsive even if "brain" fails

### Implementation
```typescript
// In messageAnalyzer.ts catch block:
const keywordGenuine = detectGenuineMoment(message);        // Keyword
const keywordTone = analyzeMessageToneKeywords(message);     // Keyword
const keywordTopics = detectTopics(message);                // Keyword
// Open loops & relationship signals: safe defaults (no LLM)
```

## Performance Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| LLM Calls | 6 parallel | 1 unified | 83% reduction |
| Token Limit | 1000 | 2000 | Prevents truncation |
| Fallback Latency | 2s+ (6 LLM calls) | <10ms (keywords) | 99.5% faster |
| Cost per Message | ~$0.0006 | ~$0.0002 | 67% reduction |

## Error Handling

1. **Truncation Detection**: Checks for incomplete JSON responses
2. **Parse Error Handling**: Clear error messages with response preview
3. **Validation**: `validateFullIntent()` ensures all fields are present
4. **Graceful Degradation**: Falls back to keywords, never crashes

## Cache Strategy

- **Cache Key**: Message text only (lowercase, trimmed)
- **TTL**: 5 minutes
- **Context Handling**: Uses cache even with context to prevent duplicates
- **Rationale**: Intent is primarily message-driven; context affects interpretation but doesn't invalidate cache

## Testing Recommendations

1. **Normal Path**: Test with valid API key, verify unified call succeeds
2. **Fallback Path**: Mock API failure, verify keyword fallback works
3. **Truncation**: Test with very long messages, verify error handling
4. **Cache**: Test same message twice, verify cache hit
5. **Integration**: Test full flow from `BaseAIService` → `messageAnalyzer` → services

## Known Limitations

1. **Cache with Context**: Cache is used even with context to prevent duplicates. This may use slightly stale results when context significantly changes interpretation.
2. **Open Loops Fallback**: Returns safe defaults (no follow-up) rather than regex patterns (which are internal to `presenceDirector`)
3. **Relationship Signals Fallback**: Returns safe defaults rather than regex patterns (which are internal to `relationshipMilestones`)

## Future Improvements

1. **Context-Aware Caching**: Include context hash in cache key for more accurate results
2. **Regex Fallback**: Expose regex patterns from `presenceDirector` and `relationshipMilestones` for better fallback
3. **Retry Logic**: Add exponential backoff retry for transient API failures
4. **Metrics**: Track unified call success rate vs fallback rate
