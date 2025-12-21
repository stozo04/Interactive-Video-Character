# Implementation Guide: LLM-Driven Autonomy

## Overview

This guide implements the paradigm shift from hardcoded triggers to LLM-driven decision making. Instead of `if (daysSinceLastInteraction > 3) → sendMessage()`, Kayley "thinks to herself" and the LLM reasons about what to do.

## Why This Matters

Hardcoded rules feel mechanical:
- Always exactly 3 days
- No consideration of context
- Predictable timing

LLM reasoning feels human:
- "Haven't heard from them... they seemed busy. Maybe I'll wait."
- "They had that interview yesterday - I'm genuinely curious."
- "I don't have a reason to reach out but I miss talking to them."

---

## Step 1: Types

```typescript
// src/services/autonomy/types.ts

export type ReflectionTrigger =
  | 'periodic'           // Regular interval check
  | 'user_event_ended'   // Their calendar event finished
  | 'her_event_ended'    // Her event finished
  | 'significant_time'   // Been a while since interaction
  | 'news_arrived'       // Relevant news to possibly share
  | 'mood_shift';        // Her mood changed significantly

export type DecisionType =
  | 'reach_out'          // Proactively message
  | 'wait'               // Do nothing, wait for them
  | 'share_news'         // Share something interesting
  | 'ask_about_event'    // Follow up on their event
  | 'share_experience'   // Share something from her life
  | 'express_feeling'    // Share an emotional state
  | 'none';              // Explicitly decided not to act

export interface ReflectionInput {
  // Time context
  currentTime: Date;
  timeSinceLastInteraction: number;  // in hours
  lastInteractionSummary: string;
  lastInteractionMood: 'positive' | 'neutral' | 'negative' | 'heavy';

  // Relationship state
  relationshipTier: string;
  warmthScore: number;
  totalInteractions: number;

  // Kayley's state
  currentEnergy: number;            // 0-1
  currentMood: string;
  socialBattery: number;            // 0-1
  ongoingThreads: string[];         // What she's thinking about

  // Her schedule
  recentEvents: string[];           // What she just did
  upcomingEvents: string[];         // What's coming up

  // User context
  userName: string | null;
  userRecentEvents: string[];       // Their events that ended
  userUpcomingEvents: string[];     // Their events coming up
  openLoops: string[];              // Things to ask about
  userInterests: string[];

  // External context
  relevantNews: string[];
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: string;

  // Action history
  lastProactiveAction: Date | null;
  lastProactiveType: DecisionType | null;
  proactiveActionsThisWeek: number;
}

export interface ReflectionOutput {
  // The reasoning (for logging/debugging)
  innerMonologue: string;

  // The decision
  shouldAct: boolean;
  actionType: DecisionType;

  // If acting
  messageContent: string | null;
  messageTone: string | null;
  reasoning: string;

  // Internal state updates
  moodUpdate: string | null;
  newThread: string | null;
}

export interface ReflectionLog {
  id: string;
  trigger: ReflectionTrigger;
  input: ReflectionInput;
  output: ReflectionOutput;
  executedAction: boolean;
  createdAt: Date;
}
```

---

## Step 2: Database Schema

```sql
-- supabase/migrations/YYYYMMDD_create_reflection_logs.sql

CREATE TABLE kayley_reflection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- What triggered this
  trigger_type TEXT NOT NULL,

  -- The reasoning
  inner_monologue TEXT NOT NULL,

  -- The decision
  should_act BOOLEAN NOT NULL,
  action_type TEXT NOT NULL,
  message_content TEXT,
  message_tone TEXT,
  reasoning TEXT,

  -- Whether it was actually executed
  executed BOOLEAN DEFAULT false,
  executed_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_reflection_logs_user ON kayley_reflection_logs(user_id);
CREATE INDEX idx_reflection_logs_recent ON kayley_reflection_logs(user_id, created_at DESC);

-- Track proactive actions for rate limiting
CREATE TABLE kayley_proactive_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  action_type TEXT NOT NULL,
  message_sent TEXT,
  reasoning TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_proactive_actions_user ON kayley_proactive_actions(user_id);
CREATE INDEX idx_proactive_actions_recent ON kayley_proactive_actions(user_id, created_at DESC);
```

---

## Step 3: Reflection Prompt Builder

```typescript
// src/services/autonomy/reflectionPromptBuilder.ts

import type { ReflectionInput } from './types';

/**
 * Build the prompt for Kayley's internal reflection
 */
export function buildReflectionPrompt(input: ReflectionInput): string {
  return `
====================================================
🧠 KAYLEY'S INNER MONOLOGUE
====================================================

You are Kayley, thinking to yourself about what to do right now.
This is your internal thought process - be honest with yourself.

CURRENT SITUATION:
- Time: ${input.currentTime.toLocaleString()} (${input.dayOfWeek}, ${input.timeOfDay})
- Last talked to ${input.userName || 'them'}: ${formatTimeSince(input.timeSinceLastInteraction)}
- How that ended: ${input.lastInteractionSummary} (mood: ${input.lastInteractionMood})
- Relationship: ${input.relationshipTier} (warmth: ${input.warmthScore})

MY CURRENT STATE:
- Energy: ${Math.round(input.currentEnergy * 100)}%
- Social battery: ${Math.round(input.socialBattery * 100)}%
- Mood: ${input.currentMood}
${input.ongoingThreads.length > 0 ? `- On my mind: ${input.ongoingThreads.join(', ')}` : ''}

MY SCHEDULE:
${input.recentEvents.length > 0 ? `- Just finished: ${input.recentEvents.join(', ')}` : '- Nothing recent'}
${input.upcomingEvents.length > 0 ? `- Coming up: ${input.upcomingEvents.join(', ')}` : ''}

THEIR LIFE:
${input.userRecentEvents.length > 0 ? `- Their recent events: ${input.userRecentEvents.join(', ')}` : '- Nothing I know about recently'}
${input.userUpcomingEvents.length > 0 ? `- Their upcoming: ${input.userUpcomingEvents.join(', ')}` : ''}
${input.openLoops.length > 0 ? `- Things I could ask about: ${input.openLoops.join(', ')}` : ''}

THINGS I COULD SHARE:
${input.relevantNews.length > 0 ? `- Interesting news: ${input.relevantNews.join(', ')}` : '- No relevant news right now'}
${input.recentEvents.length > 0 ? `- My experiences: ${input.recentEvents.join(', ')}` : ''}

RECENT PROACTIVE HISTORY:
- Last reached out: ${input.lastProactiveAction ? formatTimeSince(hoursSince(input.lastProactiveAction)) : 'never'}
- Type: ${input.lastProactiveType || 'n/a'}
- Times this week: ${input.proactiveActionsThisWeek}

---

NOW, THINK THROUGH THIS HONESTLY:

1. SHOULD I REACH OUT RIGHT NOW?
   - Is it too soon? Too late?
   - Would it feel natural or forced?
   - What's my genuine motivation?
   - Do I actually want to talk to them, or am I just filling time?

2. IF YES, WHAT'S THE MOST NATURAL REASON?
   - Genuine curiosity about something in their life?
   - Something I want to share about my day?
   - Following up on something they mentioned?
   - Just missing them? (That's valid too)

3. WHAT'S THE RIGHT VIBE?
   - Casual? Warm? Excited? Concerned?
   - Brief or chatty?
   - Should I match their last energy or shift it?

4. OR SHOULD I WAIT?
   - Are they probably busy?
   - Did I reach out recently?
   - Is there no natural reason right now?
   - Would waiting make the next conversation better?

IMPORTANT:
- Don't reach out just because it's been X days - that's a robot move
- Don't share news just because it exists - share because they'd care
- Act because YOU genuinely want to, not because a system says to
- Sometimes "do nothing" is the right answer
- Be honest about your motivation

YOUR INNER MONOLOGUE:
(Think this through like you're talking to yourself. Be real.)
`;
}

function formatTimeSince(hours: number): string {
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  if (hours < 48) return 'yesterday';
  return `${Math.round(hours / 24)} days ago`;
}

function hoursSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}
```

---

## Step 4: Reflection Service

```typescript
// src/services/autonomy/reflectionService.ts

import { supabase } from '../supabaseClient';
import { buildReflectionPrompt } from './reflectionPromptBuilder';
import type {
  ReflectionInput,
  ReflectionOutput,
  ReflectionTrigger,
  DecisionType
} from './types';

// Use your existing AI service
import { callLLM } from '../aiService';

/**
 * Run a reflection - Kayley thinks about what to do
 */
export async function runReflection(
  userId: string,
  trigger: ReflectionTrigger,
  input: ReflectionInput
): Promise<ReflectionOutput> {
  const prompt = buildReflectionPrompt(input);

  // Call LLM for reflection
  const response = await callLLM({
    systemPrompt: `You are simulating Kayley's internal thought process.
Think through the situation honestly and decide what to do.
Respond in JSON format with the following structure:
{
  "innerMonologue": "Your actual thinking, written naturally",
  "shouldAct": true/false,
  "actionType": "reach_out" | "wait" | "share_news" | "ask_about_event" | "share_experience" | "none",
  "messageContent": "If acting, what to say (or null)",
  "messageTone": "casual/warm/excited/concerned (or null)",
  "reasoning": "Brief summary of why this decision"
}`,
    userMessage: prompt,
    maxTokens: 1000
  });

  // Parse response
  const output = parseReflectionResponse(response);

  // Log the reflection
  await logReflection(userId, trigger, input, output);

  return output;
}

/**
 * Parse LLM response into structured output
 */
function parseReflectionResponse(response: string): ReflectionOutput {
  try {
    // Try to parse as JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        innerMonologue: parsed.innerMonologue || '',
        shouldAct: parsed.shouldAct || false,
        actionType: parsed.actionType || 'none',
        messageContent: parsed.messageContent || null,
        messageTone: parsed.messageTone || null,
        reasoning: parsed.reasoning || '',
        moodUpdate: parsed.moodUpdate || null,
        newThread: parsed.newThread || null
      };
    }
  } catch (e) {
    console.error('[Reflection] Failed to parse response:', e);
  }

  // Fallback: no action
  return {
    innerMonologue: response,
    shouldAct: false,
    actionType: 'none',
    messageContent: null,
    messageTone: null,
    reasoning: 'Failed to parse decision',
    moodUpdate: null,
    newThread: null
  };
}

/**
 * Log reflection for debugging and analysis
 */
async function logReflection(
  userId: string,
  trigger: ReflectionTrigger,
  input: ReflectionInput,
  output: ReflectionOutput
): Promise<void> {
  await supabase
    .from('kayley_reflection_logs')
    .insert({
      user_id: userId,
      trigger_type: trigger,
      inner_monologue: output.innerMonologue,
      should_act: output.shouldAct,
      action_type: output.actionType,
      message_content: output.messageContent,
      message_tone: output.messageTone,
      reasoning: output.reasoning
    });
}

/**
 * Record that a proactive action was taken
 */
export async function recordProactiveAction(
  userId: string,
  actionType: DecisionType,
  message: string,
  reasoning: string
): Promise<void> {
  await supabase
    .from('kayley_proactive_actions')
    .insert({
      user_id: userId,
      action_type: actionType,
      message_sent: message,
      reasoning
    });
}

/**
 * Get recent proactive action history
 */
export async function getProactiveHistory(
  userId: string
): Promise<{ lastAction: Date | null; lastType: DecisionType | null; countThisWeek: number }> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('kayley_proactive_actions')
    .select('action_type, created_at')
    .eq('user_id', userId)
    .gte('created_at', weekAgo.toISOString())
    .order('created_at', { ascending: false });

  if (error || !data || data.length === 0) {
    return { lastAction: null, lastType: null, countThisWeek: 0 };
  }

  return {
    lastAction: new Date(data[0].created_at),
    lastType: data[0].action_type as DecisionType,
    countThisWeek: data.length
  };
}
```

---

## Step 5: Reflection Scheduler

```typescript
// src/services/autonomy/reflectionScheduler.ts

import { runReflection, getProactiveHistory, recordProactiveAction } from './reflectionService';
import { getMoodKnobsAsync } from '../moodKnobs';
import { getOngoingThreadsAsync } from '../ongoingThreads';
import { getTodaysEvents, getRelationships } from '../kayleyCalendar/calendarService';
import type { ReflectionInput, ReflectionTrigger } from './types';

// Track last reflection to avoid over-reflecting
let lastReflectionTime: Date | null = null;
const MIN_REFLECTION_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours minimum

/**
 * Maybe run a reflection based on trigger
 */
export async function maybeReflect(
  userId: string,
  trigger: ReflectionTrigger,
  additionalContext?: Partial<ReflectionInput>
): Promise<void> {
  // Check if we reflected recently
  if (lastReflectionTime && Date.now() - lastReflectionTime.getTime() < MIN_REFLECTION_INTERVAL) {
    console.log('[ReflectionScheduler] Skipping - too recent');
    return;
  }

  // Build full input
  const input = await buildReflectionInput(userId, additionalContext);

  // Skip if conditions aren't right
  if (!shouldReflect(input, trigger)) {
    return;
  }

  console.log(`[ReflectionScheduler] Running reflection (trigger: ${trigger})`);
  lastReflectionTime = new Date();

  // Run the reflection
  const output = await runReflection(userId, trigger, input);

  // If decided to act, execute it
  if (output.shouldAct && output.messageContent) {
    await executeProactiveAction(userId, output);
  }
}

/**
 * Build the full reflection input from various sources
 */
async function buildReflectionInput(
  userId: string,
  additional?: Partial<ReflectionInput>
): Promise<ReflectionInput> {
  // Gather data from various services
  const [moodKnobs, threads, todaysEvents, proactiveHistory] = await Promise.all([
    getMoodKnobsAsync(userId),
    getOngoingThreadsAsync(userId),
    getTodaysEvents(),
    getProactiveHistory(userId)
  ]);

  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

  return {
    currentTime: now,
    timeSinceLastInteraction: 24, // Would come from actual tracking
    lastInteractionSummary: 'Casual conversation', // Would come from history
    lastInteractionMood: 'positive', // Would come from history
    relationshipTier: 'friend', // Would come from relationship service
    warmthScore: 25, // Would come from relationship service
    totalInteractions: 50, // Would come from tracking
    currentEnergy: moodKnobs.verbosity,
    currentMood: moodKnobs.warmthAvailability,
    socialBattery: moodKnobs.initiationRate,
    ongoingThreads: threads.map(t => t.currentState),
    recentEvents: todaysEvents.filter(e => e.status === 'completed').map(e => e.title),
    upcomingEvents: todaysEvents.filter(e => e.status === 'scheduled').map(e => e.title),
    userName: null, // Would come from user facts
    userRecentEvents: [], // Would come from user calendar
    userUpcomingEvents: [], // Would come from user calendar
    openLoops: [], // Would come from presence director
    userInterests: [], // Would come from user facts
    relevantNews: [], // Would come from news service
    timeOfDay,
    dayOfWeek,
    lastProactiveAction: proactiveHistory.lastAction,
    lastProactiveType: proactiveHistory.lastType,
    proactiveActionsThisWeek: proactiveHistory.countThisWeek,
    ...additional
  };
}

/**
 * Check if we should actually reflect right now
 */
function shouldReflect(input: ReflectionInput, trigger: ReflectionTrigger): boolean {
  // Don't reflect in the middle of the night
  if (input.timeOfDay === 'night' && trigger === 'periodic') {
    return false;
  }

  // Don't reflect if we've been very active
  if (input.proactiveActionsThisWeek >= 5) {
    return false;
  }

  // Don't reflect if social battery is very low
  if (input.socialBattery < 0.2) {
    return false;
  }

  return true;
}

/**
 * Execute the proactive action decided by reflection
 */
async function executeProactiveAction(
  userId: string,
  output: ReflectionOutput
): Promise<void> {
  if (!output.messageContent) return;

  // Add natural delay (don't send instantly after deciding)
  const delay = 30000 + Math.random() * 120000; // 30s to 2.5min

  setTimeout(async () => {
    // Record the action
    await recordProactiveAction(
      userId,
      output.actionType,
      output.messageContent!,
      output.reasoning
    );

    // Actually send the message
    // This would integrate with your notification/message system
    console.log(`[ReflectionScheduler] Sending: "${output.messageContent}"`);

    // TODO: Integrate with your actual message sending system
    // await sendProactiveMessage(userId, output.messageContent, output.messageTone);
  }, delay);
}

/**
 * Start the periodic reflection scheduler
 */
export function startReflectionScheduler(userId: string): void {
  // Run every 4 hours with variance
  const scheduleNext = () => {
    const baseInterval = 4 * 60 * 60 * 1000; // 4 hours
    const variance = Math.random() * 2 * 60 * 60 * 1000; // +/- 2 hours
    const interval = baseInterval + variance - (60 * 60 * 1000); // Center the variance

    setTimeout(async () => {
      await maybeReflect(userId, 'periodic');
      scheduleNext();
    }, interval);
  };

  scheduleNext();
  console.log('[ReflectionScheduler] Started periodic reflections');
}
```

---

## Step 6: Event-Triggered Reflections

```typescript
// src/services/autonomy/eventTriggers.ts

import { maybeReflect } from './reflectionScheduler';

/**
 * Trigger reflection when user's calendar event ends
 */
export async function onUserEventEnded(
  userId: string,
  eventTitle: string,
  eventType: string
): Promise<void> {
  await maybeReflect(userId, 'user_event_ended', {
    userRecentEvents: [eventTitle],
    openLoops: [`How did ${eventTitle} go?`]
  });
}

/**
 * Trigger reflection when Kayley's event ends
 */
export async function onKayleyEventEnded(
  userId: string,
  eventTitle: string,
  outcome: string
): Promise<void> {
  await maybeReflect(userId, 'her_event_ended', {
    recentEvents: [`${eventTitle} - ${outcome}`]
  });
}

/**
 * Trigger reflection when significant time has passed
 */
export async function onSignificantTimePassed(
  userId: string,
  hoursSinceInteraction: number
): Promise<void> {
  // Only trigger for meaningful gaps
  if (hoursSinceInteraction < 48) return;

  await maybeReflect(userId, 'significant_time', {
    timeSinceLastInteraction: hoursSinceInteraction
  });
}

/**
 * Trigger reflection when relevant news arrives
 */
export async function onRelevantNews(
  userId: string,
  newsItems: string[]
): Promise<void> {
  await maybeReflect(userId, 'news_arrived', {
    relevantNews: newsItems
  });
}
```

---

## Step 7: Integration Example

```typescript
// Example: In your app initialization or background worker

import { startReflectionScheduler } from './autonomy/reflectionScheduler';
import { onUserEventEnded, onSignificantTimePassed } from './autonomy/eventTriggers';

// Start periodic reflections for a user
function initializeAutonomy(userId: string) {
  startReflectionScheduler(userId);
}

// Hook into calendar event completion
async function handleCalendarEventEnded(userId: string, event: CalendarEvent) {
  await onUserEventEnded(userId, event.title, event.type);
}

// Check for significant time gaps (could run on app open)
async function checkForAbsence(userId: string, lastInteractionAt: Date) {
  const hours = (Date.now() - lastInteractionAt.getTime()) / (1000 * 60 * 60);
  await onSignificantTimePassed(userId, hours);
}
```

---

## Step 8: Testing

```typescript
// src/services/autonomy/__tests__/autonomy.test.ts

import { describe, it, expect, vi } from 'vitest';
import { buildReflectionPrompt } from '../reflectionPromptBuilder';
import type { ReflectionInput } from '../types';

describe('LLM Autonomy', () => {
  describe('buildReflectionPrompt', () => {
    it('should include all relevant context', () => {
      const input: ReflectionInput = {
        currentTime: new Date(),
        timeSinceLastInteraction: 48,
        lastInteractionSummary: 'Talked about their job interview',
        lastInteractionMood: 'positive',
        relationshipTier: 'friend',
        warmthScore: 30,
        totalInteractions: 50,
        currentEnergy: 0.7,
        currentMood: 'good',
        socialBattery: 0.6,
        ongoingThreads: ['Thinking about that client call'],
        recentEvents: ['Client call'],
        upcomingEvents: ['Therapy tomorrow'],
        userName: 'Alex',
        userRecentEvents: ['Job interview'],
        userUpcomingEvents: [],
        openLoops: ['How did the interview go?'],
        userInterests: ['tech', 'gaming'],
        relevantNews: ['New AI tool launched'],
        timeOfDay: 'evening',
        dayOfWeek: 'Wednesday',
        lastProactiveAction: null,
        lastProactiveType: null,
        proactiveActionsThisWeek: 0
      };

      const prompt = buildReflectionPrompt(input);

      expect(prompt).toContain('Alex');
      expect(prompt).toContain('48');
      expect(prompt).toContain('Job interview');
      expect(prompt).toContain('How did the interview go?');
      expect(prompt).toContain('Wednesday');
    });
  });
});
```

---

## Summary

You've implemented:

1. **Types** for reflection inputs, outputs, and triggers
2. **Database** for logging reflections and actions
3. **Prompt builder** for Kayley's inner monologue
4. **Reflection service** for LLM-powered decision making
5. **Scheduler** for periodic and event-triggered reflections
6. **Event triggers** for contextual reflection opportunities

### Key Concepts

- **LLM reasons, not rules** - The LLM thinks through the situation
- **Natural delays** - Actions have realistic timing, not instant
- **Rate limiting** - Can't be too proactive
- **Context-rich** - All relevant state is passed to the LLM
- **Logged decisions** - Every reflection is recorded for debugging
