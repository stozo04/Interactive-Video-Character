# TDD Implementation Prompt: Proactive Conversation Starters

> **Goal**: Implement the Proactive Conversation Starters feature using Test-Driven Development (TDD) with the highest probability of success.

---

## 🎯 Implementation Strategy

**Approach**: Red-Green-Refactor cycle, implemented in small, incremental steps with tests written first.

**Success Criteria**:
1. All tests pass
2. Code follows existing patterns in the codebase
3. Priority Router logic works correctly
4. Bridging prompts are enforced
5. Integration points work seamlessly
6. Edge cases are handled gracefully

---

## 📋 Phase-by-Phase TDD Implementation

### Phase 1: Thread Selection Logic (ongoingThreads.ts)

#### Step 1.1: Write Tests First

**File**: `src/services/tests/ongoingThreads.proactive.test.ts` (NEW)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { selectProactiveThread, markThreadMentionedAsync } from '../ongoingThreads';
import type { OngoingThread } from '../ongoingThreads';
import { getOngoingThreadsAsync } from '../ongoingThreads';

describe('selectProactiveThread', () => {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  it('should return null if no threads provided', () => {
    expect(selectProactiveThread([])).toBeNull();
  });

  it('should return null if all threads have intensity < 0.6', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.5,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
        status: 'active'
      }
    ];
    expect(selectProactiveThread(threads)).toBeNull();
  });

  it('should return null if thread was mentioned in last 24 hours', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: now - (12 * 60 * 60 * 1000), // 12 hours ago
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
        status: 'active'
      }
    ];
    expect(selectProactiveThread(threads)).toBeNull();
  });

  it('should return null if thread is less than 4 hours old', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - (2 * 60 * 60 * 1000), // 2 hours ago
        status: 'active'
      }
    ];
    expect(selectProactiveThread(threads)).toBeNull();
  });

  it('should return null if thread status is not active', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
        status: 'archived' // Not active
      }
    ];
    expect(selectProactiveThread(threads)).toBeNull();
  });

  it('should return thread with highest intensity when multiple eligible', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
        status: 'active'
      },
      {
        id: '2',
        theme: 'family',
        currentState: 'Thinking about family',
        intensity: 0.9, // Higher intensity
        lastMentioned: null,
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
        status: 'active'
      }
    ];
    const result = selectProactiveThread(threads);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('2');
    expect(result!.intensity).toBe(0.9);
  });

  it('should boost user-related threads by 0.1', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.75,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
        status: 'active'
      },
      {
        id: '2',
        theme: 'user_reflection',
        currentState: 'Thinking about what user said',
        intensity: 0.7, // Lower intensity BUT user-related
        lastMentioned: null,
        userRelated: true, // Gets 0.1 boost = 0.8 total
        createdAt: now - ONE_DAY_MS,
        status: 'active'
      }
    ];
    const result = selectProactiveThread(threads);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('2'); // Should win due to boost
  });

  it('should return thread that was mentioned more than 24 hours ago', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: now - (25 * 60 * 60 * 1000), // 25 hours ago
        userRelated: false,
        createdAt: now - (2 * ONE_DAY_MS),
        status: 'active'
      }
    ];
    const result = selectProactiveThread(threads);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('1');
  });

  it('should return thread that is at least 4 hours old', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - (5 * 60 * 60 * 1000), // 5 hours ago
        status: 'active'
      }
    ];
    const result = selectProactiveThread(threads);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('1');
  });
});

describe('markThreadMentionedAsync', () => {
  // Mock Supabase calls
  beforeEach(() => {
    // Setup mocks for getOngoingThreadsAsync and saveAllOngoingThreads
  });

  it('should update lastMentioned timestamp for specified thread', async () => {
    // Test implementation
    // Verify that the thread's lastMentioned is updated
    // Verify that other threads are unchanged
    // Verify that saveAllOngoingThreads is called with updated threads
  });

  it('should handle thread not found gracefully', async () => {
    // Test that it doesn't crash if threadId doesn't exist
  });

  it('should handle Supabase errors gracefully', async () => {
    // Test error handling
  });
});
```

#### Step 1.2: Implement selectProactiveThread

**File**: `src/services/ongoingThreads.ts`

Add the function (implementation from the plan). Run tests - they should pass.

#### Step 1.3: Implement markThreadMentionedAsync

**File**: `src/services/ongoingThreads.ts`

Add the function. Run tests - they should pass.

#### Step 1.4: Refactor

- Review code for clarity
- Check for any edge cases missed
- Ensure error handling is robust

---

### Phase 2: Proactive Thread Prompt Builder

#### Step 2.1: Write Tests First

**File**: `src/services/tests/promptUtils.proactive.test.ts` (NEW)

```typescript
import { describe, it, expect } from 'vitest';
import { buildProactiveThreadPrompt } from '../promptUtils';
import type { OngoingThread } from '../ongoingThreads';

describe('buildProactiveThreadPrompt', () => {
  it('should build prompt for user-related thread with bridging', () => {
    const thread: OngoingThread = {
      id: '1',
      theme: 'user_reflection',
      currentState: 'I keep thinking about what they said about their job',
      intensity: 0.7,
      lastMentioned: null,
      userRelated: true,
      userTrigger: 'I hate my job, it\'s so stressful',
      createdAt: Date.now(),
      status: 'active'
    };

    const prompt = buildProactiveThreadPrompt(thread);
    
    // Verify bridging instructions are present
    expect(prompt).toContain('BRIDGE');
    expect(prompt).toContain('question');
    expect(prompt).toContain('user-related');
    expect(prompt).toContain(thread.userTrigger!.slice(0, 150));
    expect(prompt).toContain(thread.currentState);
    
    // Verify it includes good examples
    expect(prompt).toContain('GOOD examples');
    
    // Verify it includes bad examples
    expect(prompt).toContain('BAD examples');
    
    // Verify it explicitly says to ask a question
    expect(prompt).toMatch(/question|invitation|ask/i);
  });

  it('should build prompt for autonomous thread with bridging', () => {
    const thread: OngoingThread = {
      id: '2',
      theme: 'creative_project',
      currentState: 'I watched this documentary about mushrooms',
      intensity: 0.8,
      lastMentioned: null,
      userRelated: false,
      createdAt: Date.now(),
      status: 'active'
    };

    const prompt = buildProactiveThreadPrompt(thread);
    
    // Verify bridging instructions
    expect(prompt).toContain('BRIDGE');
    expect(prompt).toContain('question');
    expect(prompt).toContain(thread.currentState);
    
    // Verify it warns against dead ends
    expect(prompt).toContain('dead end');
    expect(prompt).toContain('No question');
    
    // Verify it includes examples
    expect(prompt).toContain('GOOD examples');
    expect(prompt).toContain('BAD examples');
  });

  it('should include emotional state if present', () => {
    const thread: OngoingThread = {
      id: '3',
      theme: 'user_reflection',
      currentState: 'Thinking about their situation',
      intensity: 0.7,
      lastMentioned: null,
      userRelated: true,
      userTrigger: 'I\'m stressed about work',
      emotionalState: 'curious',
      createdAt: Date.now(),
      status: 'active'
    };

    const prompt = buildProactiveThreadPrompt(thread);
    expect(prompt).toContain('curious');
  });

  it('should handle thread without userTrigger gracefully', () => {
    const thread: OngoingThread = {
      id: '4',
      theme: 'creative_project',
      currentState: 'Working on a project',
      intensity: 0.7,
      lastMentioned: null,
      userRelated: false,
      createdAt: Date.now(),
      status: 'active'
    };

    const prompt = buildProactiveThreadPrompt(thread);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(0);
  });
});
```

#### Step 2.2: Implement buildProactiveThreadPrompt

**File**: `src/services/promptUtils.ts`

Add the function (implementation from the plan). Run tests - they should pass.

#### Step 2.3: Refactor

- Ensure prompts are clear and actionable
- Verify all examples are realistic
- Check that bridging is emphasized

---

### Phase 3: Priority Router Integration (Idle Breaker)

#### Step 3.1: Write Integration Tests

**File**: `src/App.test.tsx` or `src/tests/idleBreaker.proactive.test.ts` (NEW)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getOngoingThreadsAsync, selectProactiveThread } from '../services/ongoingThreads';
import { getTopLoopToSurface } from '../services/presenceDirector';

// Mock the services
vi.mock('../services/ongoingThreads');
vi.mock('../services/presenceDirector');

describe('Idle Breaker Priority Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should prioritize high-salience open loop over thread', async () => {
    // Setup: High-priority open loop AND high-intensity thread
    const highPriorityLoop = {
      id: 'loop1',
      topic: 'How did your doctor appointment go?',
      salience: 0.9, // High priority
      triggerContext: 'You mentioned a doctor appointment',
      suggestedFollowup: 'How did it go?'
    };

    const highIntensityThread = {
      id: 'thread1',
      currentState: 'I watched an amazing movie',
      intensity: 0.8
    };

    vi.mocked(getTopLoopToSurface).mockResolvedValue(highPriorityLoop as any);
    vi.mocked(getOngoingThreadsAsync).mockResolvedValue([highIntensityThread as any]);
    vi.mocked(selectProactiveThread).mockReturnValue(highIntensityThread as any);

    // Execute priority router logic
    const openLoop = await getTopLoopToSurface('user1');
    const threads = await getOngoingThreadsAsync('user1');
    const activeThread = selectProactiveThread(threads);

    // Verify: Open loop wins
    expect(openLoop).not.toBeNull();
    expect(openLoop!.salience).toBeGreaterThan(0.7);
    
    // In actual implementation, systemInstruction should use open loop
    const shouldUseOpenLoop = openLoop && openLoop.salience > 0.7;
    expect(shouldUseOpenLoop).toBe(true);
  });

  it('should use thread when open loop salience is low', async () => {
    const lowPriorityLoop = {
      id: 'loop1',
      topic: 'Random follow-up',
      salience: 0.5, // Low priority
    };

    const highIntensityThread = {
      id: 'thread1',
      currentState: 'I watched an amazing movie',
      intensity: 0.8
    };

    vi.mocked(getTopLoopToSurface).mockResolvedValue(lowPriorityLoop as any);
    vi.mocked(getOngoingThreadsAsync).mockResolvedValue([highIntensityThread as any]);
    vi.mocked(selectProactiveThread).mockReturnValue(highIntensityThread as any);

    const openLoop = await getTopLoopToSurface('user1');
    const threads = await getOngoingThreadsAsync('user1');
    const activeThread = selectProactiveThread(threads);

    // Verify: Thread wins because open loop is low priority
    const shouldUseOpenLoop = openLoop && openLoop.salience > 0.7;
    expect(shouldUseOpenLoop).toBe(false);
    expect(activeThread).not.toBeNull();
  });

  it('should fall back to generic when no open loop and no thread', async () => {
    vi.mocked(getTopLoopToSurface).mockResolvedValue(null);
    vi.mocked(getOngoingThreadsAsync).mockResolvedValue([]);
    vi.mocked(selectProactiveThread).mockReturnValue(null);

    const openLoop = await getTopLoopToSurface('user1');
    const threads = await getOngoingThreadsAsync('user1');
    const activeThread = selectProactiveThread(threads);

    // Verify: Should use generic fallback
    expect(openLoop).toBeNull();
    expect(activeThread).toBeNull();
  });

  it('should mark thread as mentioned when used', async () => {
    // Test that markThreadMentionedAsync is called when thread is used
    // This is more of an integration test
  });

  it('should mark loop as surfaced when used', async () => {
    // Test that markLoopSurfaced is called when open loop is used
  });
});
```

#### Step 3.2: Implement Priority Router in triggerIdleBreaker

**File**: `src/App.tsx`

Update `triggerIdleBreaker()` with Priority Router logic. Run tests - they should pass.

#### Step 3.3: Manual Testing

1. Create high-priority open loop → Trigger idle → Verify open loop is used
2. Create low-priority open loop + high-intensity thread → Verify thread is used
3. Create neither → Verify generic check-in

---

### Phase 4: Greeting Flow Integration

#### Step 4.1: Write Tests

**File**: `src/services/tests/promptUtils.greeting.test.ts` (NEW)

```typescript
import { describe, it, expect } from 'vitest';
import { buildGreetingPrompt } from '../promptUtils';
import type { OpenLoop } from '../presenceDirector';
import type { OngoingThread } from '../ongoingThreads';

describe('buildGreetingPrompt with Priority Router', () => {
  it('should include proactive thread when no open loop', () => {
    const thread: OngoingThread = {
      id: '1',
      theme: 'creative_project',
      currentState: 'Working on a video',
      intensity: 0.7,
      lastMentioned: null,
      userRelated: false,
      createdAt: Date.now(),
      status: 'active'
    };

    const prompt = buildGreetingPrompt(null, false, null, null, thread);
    
    expect(prompt).toContain('PROACTIVE THOUGHT');
    expect(prompt).toContain(thread.currentState);
  });

  it('should prioritize high-salience open loop over thread', () => {
    const highPriorityLoop: OpenLoop = {
      id: 'loop1',
      userId: 'user1',
      loopType: 'pending_event',
      topic: 'Doctor appointment',
      salience: 0.9, // High priority
      createdAt: new Date(),
      status: 'active',
      surfaceCount: 0,
      maxSurfaces: 2
    };

    const thread: OngoingThread = {
      id: '1',
      theme: 'creative_project',
      currentState: 'Working on a video',
      intensity: 0.7,
      lastMentioned: null,
      userRelated: false,
      createdAt: Date.now(),
      status: 'active'
    };

    const prompt = buildGreetingPrompt(null, false, null, highPriorityLoop, thread);
    
    // Should mention open loop prominently
    expect(prompt).toContain(highPriorityLoop.topic);
    
    // Thread should be optional/less prominent
    // (Implementation may vary, but open loop should take precedence)
  });

  it('should include thread when open loop salience is low', () => {
    const lowPriorityLoop: OpenLoop = {
      id: 'loop1',
      userId: 'user1',
      loopType: 'curiosity_thread',
      topic: 'Random thought',
      salience: 0.5, // Low priority
      createdAt: new Date(),
      status: 'active',
      surfaceCount: 0,
      maxSurfaces: 2
    };

    const thread: OngoingThread = {
      id: '1',
      theme: 'creative_project',
      currentState: 'Working on a video',
      intensity: 0.7,
      lastMentioned: null,
      userRelated: false,
      createdAt: Date.now(),
      status: 'active'
    };

    const prompt = buildGreetingPrompt(null, false, null, lowPriorityLoop, thread);
    
    // Thread should be included since open loop is low priority
    expect(prompt).toContain('PROACTIVE THOUGHT');
  });
});
```

#### Step 4.2: Update buildGreetingPrompt

**File**: `src/services/promptUtils.ts`

Update function signature and add Priority Router logic. Run tests.

#### Step 4.3: Update Greeting Services

**Files**: `src/services/grokChatService.ts`, `src/services/geminiChatService.ts`, `src/services/chatGPTService.ts`

Update all `generateGreeting` functions. Test each one.

---

### Phase 5: System Prompt Updates

#### Step 5.1: Write Tests

**File**: `src/services/tests/promptUtils.system.test.ts` (NEW)

```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../promptUtils';

describe('buildSystemPrompt with Proactive Threads', () => {
  it('should include bridging instructions in system prompt', async () => {
    const prompt = await buildSystemPrompt(
      // ... existing parameters ...
    );

    // Verify bridging instructions are present
    expect(prompt).toContain('PROACTIVE CONVERSATION STARTERS');
    expect(prompt).toContain('bridge');
    expect(prompt).toContain('question');
    expect(prompt).toContain('dead end');
    expect(prompt).toContain('GOOD examples');
    expect(prompt).toContain('BAD examples');
  });

  it('should emphasize that bridging is mandatory', async () => {
    const prompt = await buildSystemPrompt(
      // ... existing parameters ...
    );

    expect(prompt).toMatch(/MUST|CRITICAL|ALWAYS/i);
    expect(prompt).toContain('bridge');
  });
});
```

#### Step 5.2: Update buildSystemPrompt

**File**: `src/services/promptUtils.ts`

Add the PROACTIVE CONVERSATION STARTERS section. Run tests.

---

### Phase 6: End-to-End Integration Tests

#### Step 6.1: Write E2E Tests

**File**: `src/tests/e2e/proactiveStarters.test.ts` (NEW)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('Proactive Conversation Starters E2E', () => {
  beforeEach(() => {
    // Setup: Clear any existing state
  });

  it('should surface thread in idle breaker when conditions are met', async () => {
    // 1. Create a thread with intensity > 0.6, > 4 hours old, not mentioned in 24h
    // 2. Wait for idle breaker to trigger (or simulate)
    // 3. Verify the response includes the thread content
    // 4. Verify the response includes a question (bridging)
    // 5. Verify thread is marked as mentioned
  });

  it('should prioritize open loop over thread in idle breaker', async () => {
    // 1. Create high-salience open loop (salience > 0.7)
    // 2. Create high-intensity thread
    // 3. Trigger idle breaker
    // 4. Verify open loop is used, not thread
  });

  it('should include thread in greeting when appropriate', async () => {
    // 1. Create eligible thread
    // 2. Generate greeting
    // 3. Verify thread is included (optionally)
    // 4. Verify bridging is present
  });

  it('should not repeat same thread within 24 hours', async () => {
    // 1. Create thread and surface it
    // 2. Mark as mentioned
    // 3. Try to surface again within 24 hours
    // 4. Verify it's not selected
  });

  it('should handle errors gracefully', async () => {
    // 1. Simulate Supabase errors
    // 2. Verify system doesn't crash
    // 3. Verify fallback behavior works
  });
});
```

---

## 🧪 Test Execution Strategy

### Before Each Phase:
1. **Run existing tests** - Ensure nothing is broken
2. **Write new tests** - Red phase (tests fail)
3. **Implement feature** - Green phase (tests pass)
4. **Refactor** - Improve code quality
5. **Re-run all tests** - Ensure everything still works

### Test Coverage Goals:
- **Unit Tests**: 90%+ coverage for new functions
- **Integration Tests**: All integration points tested
- **E2E Tests**: Critical user flows tested

---

## ✅ Acceptance Criteria Checklist

### Functional Requirements:
- [ ] `selectProactiveThread` filters threads correctly (intensity, cooldown, settling time, status)
- [ ] `selectProactiveThread` prioritizes user-related threads
- [ ] `markThreadMentionedAsync` updates timestamp correctly
- [ ] `buildProactiveThreadPrompt` includes bridging instructions
- [ ] `buildProactiveThreadPrompt` handles user-related and autonomous threads
- [ ] Priority Router: Open Loop (salience > 0.7) wins over Thread
- [ ] Priority Router: Thread wins when Open Loop is low/none
- [ ] Priority Router: Generic fallback when both are unavailable
- [ ] Idle breaker uses Priority Router correctly
- [ ] Greeting flow uses Priority Router correctly
- [ ] System prompt includes bridging instructions
- [ ] Threads are marked as mentioned when surfaced

### Non-Functional Requirements:
- [ ] All tests pass
- [ ] No console errors in production code
- [ ] Error handling is graceful (no crashes)
- [ ] Code follows existing patterns
- [ ] TypeScript types are correct
- [ ] No linting errors

### Edge Cases:
- [ ] Empty thread array
- [ ] All threads below intensity threshold
- [ ] All threads on cooldown
- [ ] All threads too new
- [ ] Thread not found when marking as mentioned
- [ ] Supabase connection errors
- [ ] Missing userTrigger in user-related thread
- [ ] Missing emotionalState

---

## 🚨 Common Pitfalls to Avoid

1. **Forgetting to mark threads as mentioned** - Leads to repetition
2. **Not checking thread status** - May surface archived threads
3. **Missing bridging in prompts** - Creates dead-end conversations
4. **Incorrect Priority Router logic** - User needs should always win
5. **Not handling errors** - System crashes on Supabase errors
6. **Type mismatches** - TypeScript errors from incorrect types
7. **Race conditions** - Multiple idle breakers firing simultaneously

---

## 📝 Implementation Order (Recommended)

1. **Phase 1** - Thread Selection (foundation)
2. **Phase 2** - Prompt Builder (needed for later phases)
3. **Phase 5** - System Prompt (can be done in parallel)
4. **Phase 3** - Idle Breaker Integration (uses Phase 1 & 2)
5. **Phase 4** - Greeting Flow Integration (uses Phase 1 & 2)
6. **Phase 6** - E2E Tests (validates everything)

---

## 🎯 Success Validation

After implementation, verify:

1. **All tests pass** - `npm test` or `vitest`
2. **Manual testing**:
   - Create thread → Wait for idle → Verify it surfaces
   - Create high-priority open loop → Verify it wins over thread
   - Check that responses include questions (bridging)
3. **Code review**:
   - Check for TypeScript errors
   - Check for linting errors
   - Verify error handling
   - Verify code follows patterns

---

## 💡 Tips for Success

1. **Start small** - Get one test passing, then move to the next
2. **Test edge cases early** - Don't wait until the end
3. **Use TypeScript strictly** - Catch errors at compile time
4. **Follow existing patterns** - Look at how open loops are implemented
5. **Test in isolation first** - Unit tests before integration tests
6. **Keep tests readable** - Clear test names and descriptions
7. **Refactor frequently** - Don't let technical debt accumulate

---

*This TDD approach ensures high confidence that the feature works correctly and integrates seamlessly with the existing codebase.*

