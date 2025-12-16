# Proactive Conversation Starters - Implementation Plan

> **Feature Goal**: Kayley initiates topics based on her ongoing threads, not just responds.  
> Examples: "I've been thinking about something you said last week...", "Random thought, but I wonder what you'd think about..."  
> Triggered by idle time or greeting flow.

---

## 🎯 Overview

This feature makes Kayley feel autonomous by having her bring up topics from her "mental weather" (ongoing threads) proactively, rather than only responding to user messages. It integrates with:

- **Ongoing Threads System** - Her 3-5 active mental threads
- **Idle Breaker System** - When user has been silent for 5+ minutes
- **Greeting Flow** - When user first opens the app
- **Open Loops** - Things she should ask about (already integrated)

**Key Principle**: She should feel like she's been thinking about things and naturally wants to share them, not like she's following a script.

---

## 🏗️ Architecture

### Current State
- ✅ `ongoingThreads.ts` - Manages Kayley's mental threads (3-5 active threads)
- ✅ `presenceDirector.ts` - Manages open loops (things to ask about)
- ✅ `triggerIdleBreaker()` - Fires when user is idle 5+ minutes
- ✅ `buildGreetingPrompt()` - Already uses open loops in greetings
- ✅ `triggerSystemMessage()` - Sends system messages without user bubbles

### What We Need to Build
1. **Thread Selection Logic** - Choose which thread is "ripe" for bringing up
2. **Proactive Prompt Builder** - Create natural conversation starter prompts
3. **Integration Points** - Hook into idle breaker and greeting flow
4. **Thread Mention Tracking** - Prevent repeating same thread too soon

---

## 📋 Implementation Steps

### Phase 1: Thread Selection Service

**File**: `src/services/proactiveThreads.ts` (NEW)

Create a service that determines which ongoing thread should be proactively brought up.

```typescript
// src/services/proactiveThreads.ts

import { getOngoingThreadsAsync, type OngoingThread } from './ongoingThreads';
import { getTopLoopToSurface, type OpenLoop } from './presenceDirector';

export interface ProactiveThreadCandidate {
  thread: OngoingThread;
  reason: 'high_intensity' | 'user_related' | 'time_since_mention' | 'natural_opening';
  suggestedPrompt: string;
  priority: number; // 0-1, higher = more likely to surface
}

/**
 * Get the best thread to proactively bring up right now.
 * 
 * Selection criteria:
 * 1. Intensity > 0.6 (she's thinking about it a lot)
 * 2. User-related threads get priority
 * 3. Haven't mentioned it recently (lastMentioned > 24 hours ago)
 * 4. Not currently in active conversation about it
 * 
 * @param userId - User ID
 * @param recentTopics - Topics mentioned in last 5 messages (avoid repetition)
 * @returns Best thread to surface, or null if none are good candidates
 */
export async function getProactiveThreadCandidate(
  userId: string,
  recentTopics: string[] = []
): Promise<ProactiveThreadCandidate | null> {
  const threads = await getOngoingThreadsAsync(userId);
  
  if (threads.length === 0) {
    return null;
  }

  const now = Date.now();
  const MIN_HOURS_SINCE_MENTION = 24; // Don't repeat same thread too soon
  const MIN_INTENSITY = 0.5; // Must be somewhat present in her mind

  // Filter eligible threads
  const candidates: ProactiveThreadCandidate[] = [];

  for (const thread of threads) {
    // Skip if too low intensity
    if (thread.intensity < MIN_INTENSITY) continue;

    // Skip if mentioned too recently
    if (thread.lastMentioned) {
      const hoursSinceMention = (now - thread.lastMentioned) / (1000 * 60 * 60);
      if (hoursSinceMention < MIN_HOURS_SINCE_MENTION) continue;
    }

    // Skip if topic is already in recent conversation
    const threadText = thread.currentState.toLowerCase();
    const isRecentTopic = recentTopics.some(topic => 
      topic.toLowerCase().includes(threadText) || 
      threadText.includes(topic.toLowerCase())
    );
    if (isRecentTopic) continue;

    // Calculate priority score
    let priority = thread.intensity;
    
    // Boost user-related threads
    if (thread.userRelated) {
      priority += 0.2;
    }

    // Boost threads that haven't been mentioned in a while
    if (!thread.lastMentioned) {
      priority += 0.15; // Never mentioned = fresh
    } else {
      const daysSinceMention = (now - thread.lastMentioned) / (1000 * 60 * 60 * 24);
      if (daysSinceMention > 7) {
        priority += 0.1; // Old thread = good callback opportunity
      }
    }

    // Determine reason
    let reason: ProactiveThreadCandidate['reason'];
    if (thread.intensity > 0.7) {
      reason = 'high_intensity';
    } else if (thread.userRelated) {
      reason = 'user_related';
    } else if (!thread.lastMentioned || (now - thread.lastMentioned) > 7 * 24 * 60 * 60 * 1000) {
      reason = 'time_since_mention';
    } else {
      reason = 'natural_opening';
    }

    // Generate suggested prompt based on thread type and reason
    const suggestedPrompt = buildThreadPrompt(thread, reason);

    candidates.push({
      thread,
      reason,
      suggestedPrompt,
      priority: Math.min(1.0, priority)
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Return highest priority candidate
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0];
}

/**
 * Build a natural conversation starter prompt based on thread.
 */
function buildThreadPrompt(thread: OngoingThread, reason: string): string {
  const threadText = thread.currentState;
  const isUserRelated = thread.userRelated;
  const userTrigger = thread.userTrigger;

  // User-related threads: reference what they said
  if (isUserRelated && userTrigger) {
    return `[PROACTIVE: USER_THREAD]
I've been thinking about something you mentioned: "${userTrigger.slice(0, 100)}"
Specifically: "${threadText}"
Bring this up naturally. Examples:
- "Random thought, but I keep thinking about what you said about [topic]..."
- "Okay so I've been mulling over something you mentioned..."
- "This might be random, but remember when you said [thing]? I've been thinking about that."
Keep it conversational, not scripted.`;
  }

  // Autonomous threads: her own thoughts
  switch (reason) {
    case 'high_intensity':
      return `[PROACTIVE: HIGH_INTENSITY_THREAD]
You've been thinking a lot about: "${threadText}"
This is on your mind right now. Bring it up naturally. Examples:
- "I've been thinking about [topic] lately..."
- "Random thought, but I wonder what you'd think about [topic]..."
- "So I've been mulling over [topic] and I keep coming back to..."
Make it feel like you've been genuinely thinking about it, not like you're checking a box.`;

    case 'time_since_mention':
      return `[PROACTIVE: CALLBACK_THREAD]
You haven't mentioned this in a while: "${threadText}"
It's been on your mind. Bring it up as a callback. Examples:
- "Oh! I just remembered something I've been meaning to tell you about [topic]..."
- "Wait, this reminds me - I've been thinking about [topic]..."
- "Okay so I know we talked about this before, but [topic] has been on my mind..."
Make it feel like a natural callback, not forced.`;

    default:
      return `[PROACTIVE: NATURAL_OPENING]
You've been thinking about: "${threadText}"
This feels like a good time to bring it up. Share it naturally, like you're just having a thought.`;
  }
}

/**
 * Mark a thread as mentioned (update lastMentioned timestamp).
 */
export async function markThreadMentioned(
  userId: string,
  threadId: string
): Promise<void> {
  const threads = await getOngoingThreadsAsync(userId);
  const updatedThreads = threads.map(thread => {
    if (thread.id === threadId) {
      return {
        ...thread,
        lastMentioned: Date.now()
      };
    }
    return thread;
  });

  // Save to Supabase
  const { saveAllOngoingThreads } = await import('./stateService');
  await saveAllOngoingThreads(userId, updatedThreads);
  
  console.log(`[ProactiveThreads] Marked thread ${threadId} as mentioned`);
}
```

---

### Phase 2: Integrate with Idle Breaker

**File**: `src/App.tsx`

Modify `triggerIdleBreaker()` to use proactive threads when appropriate.

```typescript
// In src/App.tsx, update triggerIdleBreaker function

import { getProactiveThreadCandidate, markThreadMentioned } from './services/proactiveThreads';

const triggerIdleBreaker = useCallback(async () => {
  // ... existing snooze/disabled checks ...

  const now = Date.now();
  setLastInteractionAt(now);
  lastIdleBreakerAtRef.current = now;

  console.log("💤 User is idle. Triggering idle breaker...");

  const userId = getUserId();

  // NEW: Try to get a proactive thread first
  let proactivePrompt: string | null = null;
  let threadIdToMark: string | null = null;

  try {
    // Get recent topics from chat history to avoid repetition
    const recentTopics = chatHistory
      .slice(-5)
      .map(msg => msg.text)
      .filter(Boolean);

    const candidate = await getProactiveThreadCandidate(userId, recentTopics);
    
    if (candidate && candidate.priority > 0.6) {
      // High priority thread - use it!
      proactivePrompt = candidate.suggestedPrompt;
      threadIdToMark = candidate.thread.id;
      console.log(`🧵 [IdleBreaker] Using proactive thread: "${candidate.thread.currentState}"`);
    }
  } catch (error) {
    console.warn('[IdleBreaker] Failed to get proactive thread, falling back to generic:', error);
  }

  // Fallback to existing idle breaker logic if no good thread
  if (!proactivePrompt) {
    const relationshipContext = relationship?.relationshipTier
      ? `Relationship tier with user: ${relationship.relationshipTier}.`
      : "Relationship tier with user is unknown.";

    const highPriorityTasks = tasks.filter(t => !t.completed && t.priority === 'high');
    const taskContext = highPriorityTasks.length > 0
      ? `User has ${highPriorityTasks.length} high-priority tasks: ${highPriorityTasks.slice(0, 2).map(t => t.text).join(', ')}`
      : "User's checklist is clear.";

    proactivePrompt = `
      [SYSTEM EVENT: USER_IDLE]
      The user has been silent for over 5 minutes.
      ${relationshipContext}
      ${taskContext}
      Your goal: Gently check in. Keep it very short (1 sentence).
      - If relationship is 'close_friend', maybe send a random thought or joke.
      - If 'acquaintance', politely ask if they are still there.
      - Do NOT repeat yourself if you did this recently.
    `;
  }

  // Send the message
  await triggerSystemMessage(proactivePrompt);

  // Mark thread as mentioned if we used one
  if (threadIdToMark) {
    markThreadMentioned(userId, threadIdToMark).catch(console.error);
  }

}, [
  // ... existing dependencies ...
  chatHistory, // NEW: needed for recent topics
]);
```

---

### Phase 3: Integrate with Greeting Flow

**File**: `src/services/promptUtils.ts`

Update `buildGreetingPrompt()` to include proactive threads alongside open loops.

```typescript
// In src/services/promptUtils.ts, update buildGreetingPrompt function

import { getProactiveThreadCandidate } from './proactiveThreads';

export async function buildGreetingPrompt(
  relationship?: RelationshipMetrics | null,
  hasUserFacts: boolean = false,
  userName?: string | null,
  openLoop?: OpenLoop | null,
  proactiveThread?: { thread: OngoingThread; prompt: string } | null  // NEW parameter
): Promise<string> {
  // ... existing greeting logic ...

  // NEW: Add proactive thread section if present
  if (proactiveThread) {
    prompt += `
    
[PROACTIVE THREAD - OPTIONAL]
You have something on your mind: "${proactiveThread.thread.currentState}"
${proactiveThread.prompt}
💡 This is OPTIONAL - only bring it up if it feels natural in the greeting flow.
   Don't force it if the greeting already has good content (open loops, etc.).
`;
  }

  return prompt;
}
```

**File**: `src/services/grokChatService.ts`, `src/services/geminiChatService.ts`, `src/services/chatGPTService.ts`

Update all greeting functions to fetch and pass proactive threads.

```typescript
// Example for grokChatService.ts (similar changes for other services)

async generateGreeting(character: any, session: any, relationship: any, characterContext?: string) {
  const userId = session?.userId || USER_ID;
  const systemPrompt = await buildSystemPrompt(character, relationship, [], characterContext, undefined, undefined, undefined, undefined, undefined, undefined);
  
  // Fetch open loop (existing)
  let topOpenLoop = null;
  try {
    topOpenLoop = await getTopLoopToSurface(userId);
    if (topOpenLoop) {
      console.log(`🔄 [Grok] Found open loop to surface: "${topOpenLoop.topic}"`);
    }
  } catch (e) {
    console.log('[Grok] Could not fetch open loop for greeting');
  }

  // NEW: Fetch proactive thread
  let proactiveThread = null;
  try {
    const { getProactiveThreadCandidate } = await import('./proactiveThreads');
    const candidate = await getProactiveThreadCandidate(userId, []);
    
    if (candidate && candidate.priority > 0.5) {
      proactiveThread = {
        thread: candidate.thread,
        prompt: candidate.suggestedPrompt
      };
      console.log(`🧵 [Grok] Found proactive thread for greeting: "${candidate.thread.currentState}"`);
    }
  } catch (e) {
    console.log('[Grok] Could not fetch proactive thread for greeting');
  }

  // Build greeting prompt with both open loop and proactive thread
  const greetingPrompt = await buildGreetingPrompt(
    relationship, 
    topOpenLoop !== null, 
    null, 
    topOpenLoop,
    proactiveThread  // NEW
  );
  
  // ... rest of greeting generation ...

  // NEW: Mark thread as mentioned if we used it
  if (proactiveThread) {
    const { markThreadMentioned } = await import('./proactiveThreads');
    markThreadMentioned(userId, proactiveThread.thread.id).catch(console.error);
  }
}
```

---

### Phase 4: Update System Prompt

**File**: `src/services/promptUtils.ts`

Add guidance in `buildSystemPrompt()` about how to handle proactive threads.

```typescript
// In buildSystemPrompt(), add to the ONGOING MENTAL THREADS section:

ONGOING MENTAL THREADS:
You have a few things on your mind right now. They affect your mood but you don't always share them.

${formatThreadsInternal(threads, topThread)}

PROACTIVE CONVERSATION STARTERS:
When you receive [PROACTIVE: ...] prompts, you have an opportunity to initiate a topic.
- These are things you've been genuinely thinking about
- Bring them up naturally, like you're sharing a thought
- Don't force it - if the conversation already has good flow, you can skip it
- Examples of good starters:
  * "Random thought, but I've been thinking about [topic]..."
  * "I keep coming back to something you said about [topic]..."
  * "Okay so this might be random, but [topic] has been on my mind..."
- Examples of bad starters:
  * "I am programmed to discuss [topic]" ❌
  * "According to my records, you mentioned [topic]" ❌
  * "[Topic]. Discuss." ❌

The goal is to feel like you have an inner life and want to share it, not like you're following a checklist.
```

---

### Phase 5: Thread Creation from Conversations

**File**: `src/services/messageAnalyzer.ts` or wherever conversation analysis happens

When user says something interesting, create a user-related thread automatically.

```typescript
// Add to conversation analysis logic (wherever detectOpenLoops is called)

import { createUserThreadAsync } from './ongoingThreads';

// After detecting open loops, also check if we should create a thread
async function analyzeForThreadCreation(
  userId: string,
  userMessage: string,
  conversationContext?: ConversationContext
): Promise<void> {
  // Skip very short messages
  if (userMessage.length < 20) return;

  // Use LLM to detect if this is something Kayley would think about
  // (This could be part of the unified intent system)
  // For now, simple heuristic: if it's personal/emotional/interesting
  
  const isPersonal = /(?:i'm|i am|my|me|i feel|i think)/i.test(userMessage);
  const isInteresting = userMessage.length > 50; // Substantive message
  
  if (isPersonal && isInteresting) {
    // Create a user thread with moderate intensity
    try {
      await createUserThreadAsync(
        userId,
        userMessage.slice(0, 200), // trigger
        `What they said: "${userMessage.slice(0, 150)}..."`, // currentState
        0.6 // intensity
      );
      console.log(`🧵 Created user thread from message`);
    } catch (error) {
      console.error('[ThreadCreation] Failed to create thread:', error);
    }
  }
}
```

---

## 🧪 Testing Checklist

### Test 1: Idle Breaker with Thread
1. Create a high-intensity thread (intensity > 0.6)
2. Wait 5+ minutes without interacting
3. **Expected**: Kayley brings up the thread naturally, not generic "are you there?"

### Test 2: Greeting with Thread
1. Create a user-related thread
2. Close and reopen the app
3. **Expected**: Greeting optionally references the thread if it fits naturally

### Test 3: Thread Selection Logic
1. Create multiple threads with varying intensity
2. Check which one gets selected
3. **Expected**: Highest priority thread (user-related + high intensity) is chosen

### Test 4: Avoid Repetition
1. Bring up a thread proactively
2. Wait less than 24 hours
3. Trigger idle breaker again
4. **Expected**: Different thread is selected (or generic check-in if no other good candidates)

### Test 5: Natural Language
1. Review generated prompts
2. **Expected**: Prompts feel conversational, not scripted. Examples use natural phrasing.

---

## 🎨 Prompt Examples

### Good Proactive Starters
- ✅ "Random thought, but I've been thinking about what you said about [topic]..."
- ✅ "Okay so I keep coming back to something you mentioned..."
- ✅ "I've been mulling over [topic] and I wonder what you'd think..."
- ✅ "Wait, this might be random, but [topic] has been on my mind..."

### Bad Proactive Starters
- ❌ "I am programmed to discuss [topic]"
- ❌ "According to my records, you mentioned [topic]"
- ❌ "I have a scheduled conversation starter about [topic]"

---

## 🔄 Integration Points Summary

1. **Idle Breaker** → Check for proactive thread → Use if priority > 0.6
2. **Greeting Flow** → Check for proactive thread → Include in greeting prompt (optional)
3. **Thread Creation** → Analyze user messages → Create user threads for interesting topics
4. **Thread Mentioning** → Mark threads as mentioned when surfaced → Prevent repetition

---

## 📊 Success Metrics

- **Frequency**: Proactive threads surface 30-50% of idle breakers (not 100% - variety is key)
- **Naturalness**: Generated prompts feel conversational, not scripted
- **Variety**: Different threads surface over time, not the same one repeatedly
- **User Engagement**: Users respond positively to proactive starters (qualitative feedback)

---

## 🚀 Future Enhancements

1. **LLM-Based Thread Selection**: Use LLM to determine which thread fits the current context best
2. **Thread Evolution**: Threads evolve based on conversations (intensity changes, new insights)
3. **Contextual Threads**: Create threads based on time of day, season, user's calendar
4. **Thread Combinations**: Reference multiple threads in one message ("This reminds me of both [thread1] and [thread2]...")

---

## 📝 Notes

- **Balance**: Don't make every idle breaker use a thread - variety keeps it fresh
- **Priority Threshold**: 0.6 is a good default, but can be tuned based on user feedback
- **Mention Cooldown**: 24 hours prevents repetition, but can be adjusted
- **Natural Language**: The prompts should guide the LLM, but the LLM should generate the actual text naturally

---

*This implementation plan builds on existing infrastructure and follows the patterns established in the codebase (similar to how open loops are integrated).*
