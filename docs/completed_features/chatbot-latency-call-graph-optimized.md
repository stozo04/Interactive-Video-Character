# Chatbot Latency - Optimized Call Graph

## Overview

This document shows the **AFTER** state of the optimizations applied to reduce latency in the AI chatbot's prompt building phase.

**Total Estimated Savings: ~650-880ms**

---

## High-Level Flow (Optimized)

```
User Message
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  BaseAIService.processMessage()                                 │
│                                                                 │
│  1. Intent Detection (parallel with prompt build - future)      │
│  2. buildSystemPrompt() ◄─── OPTIMIZED                          │
│  3. AI Call (Gemini/OpenAI) ~5,700ms                            │
│  4. TTS (async, non-blocking) ◄─── OPTIMIZED                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detailed Call Graph: `buildSystemPrompt()`

### BEFORE (Sequential) - ~1,000-1,500ms
```
buildSystemPrompt()
     │
     ▼
getSoulLayerContextAsync()
     │
     ├──► getFullCharacterContext()      607ms  ⏳ BLOCKING
     │         ▼
     ├──► formatThreadsForPromptAsync()  ~100ms ⏳ BLOCKING (redundant fetch)
     │         ▼
     └──► getPresenceContext()           ~400ms ⏳ BLOCKING
               │
               ├──► expireOldLoops()     ~50ms  ⏳ BLOCKING (write)
               ├──► getActiveLoops()     ~150ms ⏳ BLOCKING
               └──► getTopLoopToSurface()~150ms ⏳ BLOCKING (duplicate fetch!)
     │
     ▼
formatCharacterFactsForPrompt()          ~100ms ⏳ BLOCKING
```

**Total: ~1,000-1,500ms sequential**

---

### AFTER (Parallel) - ~400-600ms

```
buildSystemPrompt()
     │
     ▼
getSoulLayerContextAsync()
     │
     ├─────────────────────────────────────────────┐
     │            Promise.all (PARALLEL)           │
     │  ┌─────────────────┬───────────────────┐   │
     │  │                 │                   │   │
     │  ▼                 ▼                   │   │
     │  getFullCharacterContext()             │   │
     │       607ms                            │   │
     │       │                                │   │
     │       ├─ mood_state ────────┐          │   │
     │       ├─ emotional_momentum │          │   │
     │       └─ ongoing_threads ───┼──► formatThreadsFromData()
     │                             │          │   │ (CPU-only, ~1ms)
     │                             │          │   │
     │                             │  getPresenceContext()
     │                             │       ~200ms (optimized)
     │                             │       │
     │                             │       ├─► expireOldLoops() 🔥 FIRE-AND-FORGET
     │                             │       │   (background, non-blocking)
     │                             │       │
     │                             │       ├───────────────────────┐
     │                             │       │   Promise.all         │
     │                             │       │   (PARALLEL READS)    │
     │                             │       │  ┌────────┬────────┐  │
     │                             │       │  ▼        ▼        │  │
     │                             │       │ getActive getChar  │  │
     │                             │       │ Loops()  Opinions()│  │
     │                             │       │ ~150ms   ~0ms(sync)│  │
     │                             │       │  │        │        │  │
     │                             │       │  └───┬────┘        │  │
     │                             │       │      ▼             │  │
     │                             │       │ selectTopLoopFromActive()
     │                             │       │ (CPU-only, derived)│  │
     │                             │       └───────────────────┘  │
     │                             │                              │
     └─────────────────────────────┴──────────────────────────────┘
     │
     ▼
formatCharacterFactsForPrompt()          ~100ms (can be parallelized next)
```

**Total: ~400-600ms (parallel)**

---

## TTS Optimization

### BEFORE
```
AI Response Complete
     │
     ▼ (sync wait)
generateSpeech()  ~233ms ⏳ BLOCKING
     │
     ▼
Return to UI
```

### AFTER
```
AI Response Complete
     │
     ├──► Return to UI immediately ✅
     │
     └──► generateSpeech() 🔥 FIRE-AND-FORGET
              │
              ▼
         onAudioData callback (when ready)
```

---

## Optimization Summary

| Optimization | Location | Technique | Savings |
|--------------|----------|-----------|---------|
| Parallel context fetch | promptUtils.ts:71-77 | `Promise.all` | ~300ms |
| Fire-and-forget expiry | presenceDirector.ts:673 | Background write | ~50ms |
| Parallel presence reads | presenceDirector.ts:680 | `Promise.all` | ~150ms |
| Eliminate duplicate fetch | presenceDirector.ts:686 | `selectTopLoopFromActive` | ~150ms |
| Use pre-fetched threads | promptUtils.ts:93-94 | `formatThreadsFromData` | ~100ms |
| Async TTS | BaseAIService.ts:232 | Fire-and-forget | ~233ms perceived |
| **TOTAL** | | | **~650-880ms** |

---

## Code References

### promptUtils.ts (lines 58-124)
```typescript
export async function getSoulLayerContextAsync(userId: string): Promise<SoulLayerContext> {
  const callbackPrompt = formatCallbackForPrompt(); // Sync, no network
  
  let moodKnobs: MoodKnobs;
  let threadsPrompt: string = '';
  let presenceContext: PresenceContext | undefined;
  
  try {
    // 🚀 PARALLEL: Fire both major async operations simultaneously
    const [fullContext, presenceResult] = await Promise.all([
      getFullCharacterContext(userId),
      getPresenceContext(userId).catch(error => {
        console.warn("[PromptUtils] Failed to get presence context:", error);
        return undefined;
      })
    ]);
    
    presenceContext = presenceResult;
    
    // Process mood knobs from unified fetch (CPU-only)
    if (fullContext.mood_state && fullContext.emotional_momentum) {
      moodKnobs = calculateMoodKnobsFromState(fullContext.mood_state, fullContext.emotional_momentum);
    } else {
      moodKnobs = await getMoodKnobsAsync(userId);
    }
    
    // 🚀 OPTIMIZATION: Format threads directly from fetched data
    if (fullContext.ongoing_threads) {
      threadsPrompt = formatThreadsFromData(fullContext.ongoing_threads);
    } else {
      threadsPrompt = await formatThreadsForPromptAsync(userId);
    }
    
  } catch (error) {
    // 🚀 PARALLEL FALLBACK
    const [moodKnobsResult, threadsResult, presenceResult] = await Promise.all([
      getMoodKnobsAsync(userId),
      formatThreadsForPromptAsync(userId),
      getPresenceContext(userId).catch(() => undefined)
    ]);
    
    moodKnobs = moodKnobsResult;
    threadsPrompt = threadsResult;
    presenceContext = presenceResult;
  }
  
  return { moodKnobs, threadsPrompt, callbackPrompt, presenceContext };
}
```

### presenceDirector.ts (lines 670-697)
```typescript
export async function getPresenceContext(userId: string): Promise<PresenceContext> {
  // 🔥 FIRE-AND-FORGET: Expiry is a write operation
  expireOldLoops(userId).catch(err => 
    console.warn('[PresenceDirector] Background expiry failed:', err)
  );
  
  // 🚀 PARALLEL: Run all read operations simultaneously
  const [activeLoops, opinions] = await Promise.all([
    getActiveLoops(userId),
    Promise.resolve(getCharacterOpinions())  // Sync, wrapped for consistency
  ]);
  
  // Derive top loop from active loops (avoids second DB call)
  const topLoop = selectTopLoopFromActive(activeLoops);
  
  // Build the prompt section (CPU-only)
  const promptSection = buildPresencePromptSection(activeLoops, topLoop, opinions);
  
  return { activeLoops, topLoop, opinions, promptSection };
}
```

### ongoingThreads.ts (lines 184-188)
```typescript
export function formatThreadsFromData(threads: OngoingThread[]): string {
  const processed = processThreads(threads);
  const topThread = findThreadToSurface(processed);
  return formatThreadsInternal(processed, topThread);
}
```

### BaseAIService.ts (line 232)
```typescript
const audioMode = options.audioMode ?? 'async';  // was 'sync'
```

---

## Visual Timeline Comparison

### BEFORE
```
0ms        300ms       600ms       900ms       1200ms      1500ms
│          │           │           │           │           │
├──────────┼───────────┼───────────┼───────────┼───────────┤
│ getFullCharacterContext ──────────────────────────────►  │
│                                607ms                     │
│                                  ├─► formatThreadsForPromptAsync ──►
│                                  │         ~100ms                   │
│                                  │              ├─► getPresenceContext ──────►
│                                  │              │         ~400ms           │
│                                  │              │                          │
└──────────────────────────────────┴──────────────┴──────────────────────────┘
                                               TOTAL: ~1,100ms
```

### AFTER
```
0ms        300ms       600ms       900ms
│          │           │           │
├──────────┼───────────┼───────────┤
│ ┌─ getFullCharacterContext ─────────────────►
│ │        607ms                              │
│ │                                           │
│ └─ getPresenceContext ──────►               │ (parallel)
│          ~200ms (optimized)                 │
│                     │                       │
│                     ├─► formatThreadsFromData (~1ms, CPU)
│                     │                       │
└─────────────────────┴───────────────────────┘
                      TOTAL: ~607ms (limited by slowest parallel op)
```

---

## Next Optimizations (Future)

1. **Parallelize Intent Detection + Prompt Building** (~500ms potential)
   - Risk: Medium (need to handle dependency carefully)
   
2. **Extend Cache TTL** (30s → 60s)
   - Easy win for repeat calls
   
3. **Parallelize `formatCharacterFactsForPrompt`**
   - Run alongside other fetches in Promise.all

---

*Generated: December 18, 2025*
*Status: All optimizations implemented and verified*
