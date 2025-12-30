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
2. **Priority Router** - Resolve conflicts between Open Loops (user needs) vs Threads (Kayley's thoughts)
3. **Bridge Prompting Strategy** - Ensure threads are bridged back to the user (not dead ends)
4. **Proactive Prompt Builder** - Create natural conversation starter prompts with bridging
5. **Integration Points** - Hook into idle breaker and greeting flow
6. **Thread Mention Tracking** - Prevent repeating same thread too soon

### Critical Architectural Decisions

#### 1. Priority Router (Conflict Resolution)
**Problem**: What happens if Kayley has a high-priority Open Loop (e.g., asking how your doctor's appointment went) AND a high-intensity Thread (she just watched a crazy movie)?

**Rule**: **User Needs > Kayley's Thoughts**

- If an Open Loop has salience > 0.8 (urgent/emotional), it always wins
- If Open Loops are low/none, THEN check for high-intensity Threads
- If both are low, fall back to a generic greeting or a lower-priority Thread

#### 2. Bridge Prompting Strategy
**Problem**: Simply injecting the thread into the context might make Kayley say "I watched a movie." It ends the conversation.

**Solution**: Prompts must explicitly instruct her to bridge the thread back to the user.

- ❌ Bad: "I'm reading a book about mushrooms."
- ✅ Good: "I'm reading this book about mushrooms and it's wild—do you have any weird niche interests like that?"

---

## 📋 Implementation Steps

### Phase 1: Thread Selection in ongoingThreads.ts

**File**: `src/services/ongoingThreads.ts`

Add thread selection logic directly to the ongoing threads service (simpler than a separate file).

```typescript
// src/services/ongoingThreads.ts

export function selectProactiveThread(threads: OngoingThread[]): OngoingThread | null {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  // Filter candidates
  const candidates = threads.filter(t => {
    // 1. Intensity Check
    if (t.intensity < 0.6) return false;
    
    // 2. Cooldown Check
    if (t.lastMentioned && (now - t.lastMentioned) < ONE_DAY_MS) return false;
    
    // 3. Settling Time
    if ((now - t.createdAt) < FOUR_HOURS_MS) return false;
    
    // 4. Status Check (Good to keep this from my version for safety)
    if (t.status !== 'active') return false;
    
    return true;
  });

  if (candidates.length === 0) return null;

  // Sort: Intensity desc, with 0.1 boost for user-related threads
  candidates.sort((a, b) => {
    // Safety check: cast boolean to number (true=1, false=0) if property exists
    const aBonus = (a as any).userRelated ? 0.1 : 0; 
    const bBonus = (b as any).userRelated ? 0.1 : 0;
    
    const aScore = a.intensity + aBonus;
    const bScore = b.intensity + bBonus;
    
    return bScore - aScore;
  });
  
  return candidates[0];
}

/**
 * Mark a thread as mentioned (update lastMentioned timestamp).
 * Call this after proactively bringing up a thread.
 */
export async function markThreadMentionedAsync(
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
  await saveAllOngoingThreads(userId, updatedThreads);
  
  console.log(`[OngoingThreads] Marked thread ${threadId} as mentioned`);
}
```

---

### Phase 1b: Proactive Thread Prompt Builder

**File**: `src/services/promptUtils.ts`

Add a dedicated function to build proactive thread prompts with explicit bridging instructions.

```typescript
// src/services/promptUtils.ts

/**
 * Build a proactive thread prompt with explicit bridging instructions.
 * CRITICAL: This prompt must force Kayley to bridge her thought back to the user.
 * 
 * @param thread - The ongoing thread to bring up
 * @returns Formatted prompt section with bridging instructions
 */
export function buildProactiveThreadPrompt(thread: OngoingThread): string {
  const threadText = thread.currentState;
  const isUserRelated = thread.userRelated;
  const userTrigger = thread.userTrigger;

  // User-related threads: reference what they said, then bridge
  if (isUserRelated && userTrigger) {
    return `
====================================================
💭 PROACTIVE THOUGHT (User-Related)
====================================================
You've been thinking about something the user mentioned, and you want to bring it up naturally.

WHAT THEY SAID: "${userTrigger.slice(0, 150)}"
YOUR THOUGHT: "${threadText}"
CURRENT EMOTION: "${thread.emotionalState}"  <-- Added this for flavor

CRITICAL INSTRUCTIONS:
1. Initiate this topic naturally. Don't wait for them to ask.
2. BRIDGE it to the user: Share your thought, then ask for their take/experience/opinion.
3. Don't be robotic. Be curious and engaged.

GOOD examples:
- "Random thought, but I keep thinking about what you said about [topic]... [your thought]. What made you think about that?"
- "Okay so I've been mulling over something you mentioned... [your thought]. Have you thought more about it?"
- "This might be random, but remember when you said [thing]? I've been thinking about that because [your thought]. What do you think?"

BAD examples (dead ends):
- "I've been thinking about what you said about [topic]." ❌ (No question, conversation ends)
- "You mentioned [thing]." ❌ (Statement only, no engagement)
`;
  }

  // Autonomous threads: her own thoughts, must bridge to user
  return `
====================================================
💭 PROACTIVE THOUGHT (Kayley's Mind)
====================================================
You've been thinking about this recently, and you want to bring it up naturally.

TOPIC: "${threadText}"

CRITICAL INSTRUCTIONS:
1. Initiate this topic naturally. Don't wait for the user to ask.
2. BRIDGE it to the user: Share your thought, then ask for their take/experience/opinion.
3. Don't be robotic. Be excited/curious.

GOOD examples:
- "Random thought, but I've been obsessing over [TOPIC] lately... [CONTEXT]. Do you ever get down rabbit holes like that?"
- "I've been thinking about [TOPIC] and I keep coming back to [IDEA]. What do you think about [RELATED QUESTION]?"
- "Okay so this might be random, but [TOPIC] has been on my mind... [WHY]. Have you ever experienced something like that?"

BAD examples (dead ends):
- "I've been thinking about [TOPIC]." ❌ (No question, conversation ends)
- "I watched a movie about [TOPIC]." ❌ (Statement only, no engagement)
- "[TOPIC] is interesting." ❌ (Dead end, no hook)

REMEMBER: Every proactive thought MUST end with a question or invitation for the user to respond.
`;
}
```

---

### Phase 2: Priority Router & Idle Breaker Integration

**File**: `src/App.tsx`

Modify `triggerIdleBreaker()` to use the Priority Router logic: Open Loops (user needs) > Threads (Kayley's thoughts).

```typescript
// In src/App.tsx, update triggerIdleBreaker function

import { getOngoingThreadsAsync, selectProactiveThread, markThreadMentionedAsync } from './services/ongoingThreads';
import { getTopLoopToSurface, markLoopSurfaced } from './services/presenceDirector';
import { buildProactiveThreadPrompt } from './services/promptUtils';

const triggerIdleBreaker = useCallback(async () => {
  // ... existing snooze/disabled checks ...

  const now = Date.now();
  setLastInteractionAt(now);
  lastIdleBreakerAtRef.current = now;

  console.log("💤 User is idle. Triggering idle breaker...");

  const userId = getUserId();

  // ============================================
  // PRIORITY ROUTER: User Needs > Kayley's Thoughts
  // ============================================
  
  let systemInstruction = "";
  let threadIdToMark: string | null = null;
  let loopIdToMark: string | null = null;

  try {
    // Step 1: Check for high-priority Open Loop (user needs)
    const openLoop = await getTopLoopToSurface(userId);
    
    // Step 2: Check for proactive thread (Kayley's thoughts)
    const threads = await getOngoingThreadsAsync(userId);
    const activeThread = selectProactiveThread(threads);

    // LOGIC: Open Loop wins if high priority, otherwise Thread wins if available
    if (openLoop && openLoop.salience > 0.7) {
      // High-priority user need - always prioritize this
      systemInstruction = `
[SYSTEM EVENT: USER_IDLE - OPEN LOOP]
The user has been silent for over 5 minutes.
You have something important to ask about: "${openLoop.topic}"
Context: ${openLoop.triggerContext ? `They said: "${openLoop.triggerContext.slice(0, 100)}..."` : 'From a previous conversation'}
Suggested ask: "${openLoop.suggestedFollowup || `How did things go with ${openLoop.topic}?`}"

Bring this up naturally. This is about THEM, not you.
`;
      loopIdToMark = openLoop.id;
      console.log(`🔄 [IdleBreaker] Using high-priority open loop: "${openLoop.topic}"`);
      
    } else if (activeThread) {
      // No urgent user needs - use Kayley's proactive thought
      systemInstruction = buildProactiveThreadPrompt(activeThread);
      threadIdToMark = activeThread.id;
      console.log(`🧵 [IdleBreaker] Using proactive thread: "${activeThread.currentState}"`);
      
    } else {
      // Fallback: Generic check-in
      const relationshipContext = relationship?.relationshipTier
        ? `Relationship tier with user: ${relationship.relationshipTier}.`
        : "Relationship tier with user is unknown.";

      const highPriorityTasks = tasks.filter(t => !t.completed && t.priority === 'high');
      const taskContext = highPriorityTasks.length > 0
        ? `User has ${highPriorityTasks.length} high-priority tasks: ${highPriorityTasks.slice(0, 2).map(t => t.text).join(', ')}`
        : "User's checklist is clear.";

      systemInstruction = `
[SYSTEM EVENT: USER_IDLE]
The user has been silent for over 5 minutes.
${relationshipContext}
${taskContext}
Your goal: Gently check in. Keep it very short (1 sentence).
- If relationship is 'close_friend', maybe send a random thought or joke.
- If 'acquaintance', politely ask if they are still there.
- Do NOT repeat yourself if you did this recently.
`;
      console.log(`💤 [IdleBreaker] Using generic check-in`);
    }
  } catch (error) {
    console.warn('[IdleBreaker] Failed to get proactive content, using generic:', error);
    systemInstruction = `[SYSTEM EVENT: USER_IDLE] The user has been silent. Gently check in naturally.`;
  }

  // Send the message
  await triggerSystemMessage(systemInstruction);

  // Mark thread/loop as mentioned if we used one
  if (threadIdToMark) {
    markThreadMentionedAsync(userId, threadIdToMark).catch(console.error);
  }
  if (loopIdToMark) {
    markLoopSurfaced(loopIdToMark).catch(console.error);
  }

}, [
  // ... existing dependencies ...
  relationship,
  tasks,
]);
```

---

### Phase 3: Integrate with Greeting Flow (with Priority Router)

**File**: `src/services/promptUtils.ts`

Update `buildGreetingPrompt()` to use Priority Router logic and include proactive threads with bridging.

```typescript
// In src/services/promptUtils.ts, update buildGreetingPrompt function signature

export function buildGreetingPrompt(
  relationship?: RelationshipMetrics | null,
  hasUserFacts: boolean = false,
  userName?: string | null,
  openLoop?: OpenLoop | null,
  proactiveThread?: OngoingThread | null  // NEW: Pass thread directly, not wrapped
): string {
  // ... existing greeting logic ...

  // NEW: Add proactive thread section if present (only if no high-priority open loop)
  // Priority Router: Open Loop takes precedence, thread is optional fallback
  if (proactiveThread && (!openLoop || openLoop.salience < 0.8)) {
    const threadPrompt = buildProactiveThreadPrompt(proactiveThread);
    prompt += `
    
${threadPrompt}

💡 This is OPTIONAL - only bring it up if it feels natural in the greeting flow.
   If you already have a good open loop to ask about, prioritize that instead.
   The thread is a nice-to-have, not a must-have.
`;
  }

  return prompt;
}
```

**File**: `src/services/grokChatService.ts`, `src/services/geminiChatService.ts`, `src/services/chatGPTService.ts`

Update all greeting functions to use Priority Router and fetch proactive threads.

```typescript
// Example for grokChatService.ts (similar changes for other services)

import { getOngoingThreadsAsync, selectProactiveThread, markThreadMentionedAsync } from './ongoingThreads';
import { buildProactiveThreadPrompt } from './promptUtils';

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

  // NEW: Fetch proactive thread (only if no high-priority open loop)
  let proactiveThread = null;
  if (!topOpenLoop || topOpenLoop.salience < 0.8) {
    try {
      const threads = await getOngoingThreadsAsync(userId);
      proactiveThread = selectProactiveThread(threads);
      
      if (proactiveThread) {
        console.log(`🧵 [Grok] Found proactive thread for greeting: "${proactiveThread.currentState}"`);
      }
    } catch (e) {
      console.log('[Grok] Could not fetch proactive thread for greeting');
    }
  }

  // Build greeting prompt with Priority Router logic
  const greetingPrompt = buildGreetingPrompt(
    relationship, 
    topOpenLoop !== null, 
    null, 
    topOpenLoop,
    proactiveThread  // NEW: Pass thread directly
  );
  
  // ... rest of greeting generation ...

  // NEW: Mark thread as mentioned if we used it
  if (proactiveThread) {
    markThreadMentionedAsync(userId, proactiveThread.id).catch(console.error);
  }
}
```

---

### Phase 4: Update System Prompt (Bridging Emphasis)

**File**: `src/services/promptUtils.ts`

Add guidance in `buildSystemPrompt()` about how to handle proactive threads with explicit bridging requirements.

```typescript
// In buildSystemPrompt(), add to the ONGOING MENTAL THREADS section:

ONGOING MENTAL THREADS:
You have a few things on your mind right now. They affect your mood but you don't always share them.

${formatThreadsInternal(threads, topThread)}

PROACTIVE CONVERSATION STARTERS (CRITICAL RULES):
When you receive [PROACTIVE THOUGHT] prompts, you have an opportunity to initiate a topic.

🚨 CRITICAL: EVERY proactive thought MUST bridge back to the user.

GOOD examples (with bridging):
- "Random thought, but I've been thinking about [topic]... [your thought]. What do you think about that?"
- "I keep coming back to something you said about [topic]... [your reflection]. Have you thought more about it?"
- "Okay so this might be random, but [topic] has been on my mind... [why]. Do you ever experience something like that?"

BAD examples (dead ends - NO BRIDGING):
- "I've been thinking about [topic]." ❌ (No question, conversation ends)
- "I watched a movie about [topic]." ❌ (Statement only, no engagement)
- "[Topic] is interesting." ❌ (Dead end, no hook)
- "I am programmed to discuss [topic]" ❌ (Robotic, breaks character)

RULES:
1. Share your thought naturally (1-2 sentences)
2. ALWAYS end with a question or invitation for their take/experience/opinion
3. Don't force it - if the conversation already has good flow, you can skip it
4. Make it feel like you genuinely want to know their perspective, not like you're checking a box

The goal is to feel like you have an inner life and want to share it WITH them, not AT them.
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

### Test 5: Natural Language & Bridging
1. Review generated prompts
2. **Expected**: Prompts feel conversational, not scripted. Examples use natural phrasing.
3. **Expected**: Every proactive thread prompt ends with a question or invitation (no dead ends)

### Test 6: Priority Router
1. Create a high-salience open loop (salience > 0.8) AND a high-intensity thread
2. Trigger idle breaker
3. **Expected**: Open loop is used, not the thread (user needs > Kayley's thoughts)

### Test 7: Bridge Prompting
1. Create a proactive thread about a movie
2. Trigger idle breaker
3. **Expected**: Response includes the movie AND asks a question (e.g., "Have you seen anything good lately?")
4. **NOT Expected**: Just "I watched a movie about X." (dead end)

---

## 🎨 Prompt Examples

### Good Proactive Starters (with Bridging)
- ✅ "Random thought, but I've been thinking about what you said about [topic]... [reflection]. What made you think about that?"
- ✅ "Okay so I keep coming back to something you mentioned... [thought]. Have you thought more about it?"
- ✅ "I've been mulling over [topic] and I wonder what you'd think... [why]. Do you ever experience something like that?"
- ✅ "Wait, this might be random, but [topic] has been on my mind... [context]. What do you think about [related question]?"

### Bad Proactive Starters (Dead Ends - No Bridging)
- ❌ "I've been thinking about [topic]." (No question, conversation ends)
- ❌ "I watched a movie about [topic]." (Statement only, no engagement)
- ❌ "[Topic] is interesting." (Dead end, no hook)
- ❌ "I am programmed to discuss [topic]" (Robotic, breaks character)
- ❌ "According to my records, you mentioned [topic]" (Robotic, breaks character)
- ❌ "I have a scheduled conversation starter about [topic]" (Robotic, breaks character)

---

## 🔄 Integration Points Summary

1. **Priority Router** → Open Loop (salience > 0.7) wins → Otherwise Thread → Otherwise Generic
2. **Idle Breaker** → Use Priority Router → Mark thread/loop as mentioned
3. **Greeting Flow** → Use Priority Router → Include thread only if no high-priority open loop
4. **Thread Creation** → Analyze user messages → Create user threads for interesting topics
5. **Thread Mentioning** → Mark threads as mentioned when surfaced → Prevent repetition
6. **Bridging** → All proactive prompts must end with a question/invitation → No dead ends

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

- **Priority Router**: User needs (Open Loops) always take precedence over Kayley's thoughts (Threads)
- **Salience Threshold**: Open Loops with salience > 0.7 win over threads (tunable)
- **Bridging is Mandatory**: Every proactive thread must end with a question/invitation - no exceptions
- **Balance**: Don't make every idle breaker use a thread - variety keeps it fresh
- **Intensity Threshold**: Threads need intensity >= 0.6 to be considered (tunable)
- **Mention Cooldown**: 24 hours prevents repetition, but can be adjusted
- **Thread Settle Time**: Threads must be at least 4 hours old before being surfaced (prevents immediate repetition)
- **Natural Language**: The prompts should guide the LLM, but the LLM should generate the actual text naturally

---

*This implementation plan builds on existing infrastructure and follows the patterns established in the codebase (similar to how open loops are integrated).*

