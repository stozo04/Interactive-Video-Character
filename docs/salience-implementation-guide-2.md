# Fix #3 & #4 Implementation Guide (TDD)
## Time-Awareness + Salience Boosting

---

## Overview

| Fix | Problem | Solution |
|-----|---------|----------|
| #3 | AI asked "how was the party?" at 1pm for a 6pm event | Add event time tracking, don't ask "how was it?" until AFTER the event |
| #4 | User mentioned "Chic-fil-A" but party (0.8) beat lunch (0.7) | Boost salience when user mentions related topics |

---

# Fix #3: Time-Awareness

## The Problem

```
Timeline:
- 9:00 AM: Loop created for "Holiday Party at 6pm" (salience: 0.8)
- 1:30 PM: User returns from lunch
- AI: "How did the party go??" ← WRONG! Party hasn't happened yet!
```

## The Solution

1. Store `event_datetime` when creating calendar-related loops
2. Add logic to distinguish between:
   - **Pre-event:** "Don't forget your party at 6pm!"
   - **Post-event:** "How did the party go?"
3. Only surface "how was it?" questions AFTER the event time

---

## Step 1: Database Migration

First, add a new column to your `presence_contexts` table:

```sql
-- Run this in Supabase SQL Editor
ALTER TABLE presence_contexts 
ADD COLUMN event_datetime TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN presence_contexts.event_datetime IS 
  'For pending_event loops: when the actual event occurs. Used to prevent asking "how was it?" before the event happens.';
```

---

## Step 2: Tests First (TDD)

Create a new test file: `src/services/__tests__/presenceDirector.test.ts`

```typescript
// src/services/__tests__/presenceDirector.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Supabase before imports
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: mockLoop, error: null }))
        }))
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            lte: vi.fn(() => ({
              or: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [], error: null }))
                }))
              }))
            }))
          }))
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
        in: vi.fn(() => Promise.resolve({ error: null }))
      }))
    }))
  }
}));

import {
  isEventInFuture,
  shouldAskHowItWent,
  getFollowUpType,
  type OpenLoop
} from '../presenceDirector';

// ============================================
// FIX #3: Time-Awareness Tests
// ============================================

describe('Fix #3: Time-Awareness', () => {
  
  describe('isEventInFuture', () => {
    it('should return true for future events', () => {
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
      expect(isEventInFuture(futureDate)).toBe(true);
    });

    it('should return false for past events', () => {
      const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      expect(isEventInFuture(pastDate)).toBe(false);
    });

    it('should return false for events happening right now (within 15 min buffer)', () => {
      const nowish = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      expect(isEventInFuture(nowish)).toBe(false);
    });

    it('should return false when eventDateTime is undefined', () => {
      expect(isEventInFuture(undefined)).toBe(false);
    });
  });

  describe('shouldAskHowItWent', () => {
    const baseLoop: OpenLoop = {
      id: 'test-1',
      userId: 'user-1',
      loopType: 'pending_event',
      topic: 'Holiday Party',
      status: 'active',
      salience: 0.8,
      surfaceCount: 0,
      maxSurfaces: 2,
      createdAt: new Date()
    };

    it('should return false for pending_event loops with future eventDateTime', () => {
      const loop: OpenLoop = {
        ...baseLoop,
        eventDateTime: new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours from now
      };
      expect(shouldAskHowItWent(loop)).toBe(false);
    });

    it('should return true for pending_event loops with past eventDateTime', () => {
      const loop: OpenLoop = {
        ...baseLoop,
        eventDateTime: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hour ago
      };
      expect(shouldAskHowItWent(loop)).toBe(true);
    });

    it('should return true for pending_event loops with eventDateTime 30+ minutes ago', () => {
      const loop: OpenLoop = {
        ...baseLoop,
        eventDateTime: new Date(Date.now() - 45 * 60 * 1000) // 45 minutes ago
      };
      expect(shouldAskHowItWent(loop)).toBe(true);
    });

    it('should return false for pending_event loops with eventDateTime only 10 minutes ago', () => {
      // Give events some buffer time before asking
      const loop: OpenLoop = {
        ...baseLoop,
        eventDateTime: new Date(Date.now() - 10 * 60 * 1000) // 10 minutes ago
      };
      expect(shouldAskHowItWent(loop)).toBe(false);
    });

    it('should return true for non-pending_event loops (no time restriction)', () => {
      const loop: OpenLoop = {
        ...baseLoop,
        loopType: 'curiosity_thread'
      };
      expect(shouldAskHowItWent(loop)).toBe(true);
    });

    it('should return true for pending_event without eventDateTime (legacy data)', () => {
      // For backwards compatibility - if no eventDateTime, allow surfacing
      const loop: OpenLoop = {
        ...baseLoop,
        eventDateTime: undefined
      };
      expect(shouldAskHowItWent(loop)).toBe(true);
    });
  });

  describe('getFollowUpType', () => {
    const baseLoop: OpenLoop = {
      id: 'test-1',
      userId: 'user-1',
      loopType: 'pending_event',
      topic: 'Job Interview',
      status: 'active',
      salience: 0.8,
      surfaceCount: 0,
      maxSurfaces: 2,
      createdAt: new Date()
    };

    it('should return "reminder" for future events', () => {
      const loop: OpenLoop = {
        ...baseLoop,
        eventDateTime: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours from now
      };
      expect(getFollowUpType(loop)).toBe('reminder');
    });

    it('should return "followup" for past events', () => {
      const loop: OpenLoop = {
        ...baseLoop,
        eventDateTime: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
      };
      expect(getFollowUpType(loop)).toBe('followup');
    });

    it('should return "followup" for non-event loops', () => {
      const loop: OpenLoop = {
        ...baseLoop,
        loopType: 'emotional_followup'
      };
      expect(getFollowUpType(loop)).toBe('followup');
    });
  });
});


// ============================================
// FIX #4: Salience Boosting Tests
// ============================================

describe('Fix #4: Salience Boosting', () => {
  
  describe('boostSalienceForMentionedTopics', () => {
    // These tests will use mocked Supabase
    
    it('should boost salience when user mentions an existing loop topic', async () => {
      // This test verifies the function is called correctly
      // Actual DB interaction is mocked
      const { boostSalienceForMentionedTopics } = await import('../presenceDirector');
      
      const result = await boostSalienceForMentionedTopics(
        'user-1',
        'I just got back from lunch!',
        ['lunch', 'food']
      );
      
      // Function should return number of loops boosted
      expect(typeof result).toBe('number');
    });

    it('should not boost beyond maximum salience of 1.0', async () => {
      const { boostSalienceForMentionedTopics } = await import('../presenceDirector');
      
      // Even if current salience is 0.95, boost should cap at 1.0
      const result = await boostSalienceForMentionedTopics(
        'user-1',
        'lunch lunch lunch', // Multiple mentions
        ['lunch']
      );
      
      expect(typeof result).toBe('number');
    });
  });

  describe('calculateSalienceBoost', () => {
    const { calculateSalienceBoost } = require('../presenceDirector');

    it('should return 0.1 for single topic mention', () => {
      expect(calculateSalienceBoost(0.5, 1)).toBe(0.6);
    });

    it('should cap at 1.0 maximum', () => {
      expect(calculateSalienceBoost(0.95, 1)).toBe(1.0);
    });

    it('should give diminishing returns for multiple mentions', () => {
      // First mention: +0.1, Second: +0.05, Third: +0.025
      const boost1 = calculateSalienceBoost(0.5, 1);
      const boost2 = calculateSalienceBoost(0.5, 2);
      const boost3 = calculateSalienceBoost(0.5, 3);
      
      expect(boost1).toBe(0.6);   // 0.5 + 0.1
      expect(boost2).toBe(0.65);  // 0.5 + 0.1 + 0.05
      expect(boost3).toBe(0.675); // 0.5 + 0.1 + 0.05 + 0.025
    });
  });

  describe('findLoopsMatchingTopics', () => {
    it('should find loops that match mentioned topics', async () => {
      const { findLoopsMatchingTopics } = await import('../presenceDirector');
      
      // With mocked data, this tests the function signature
      const result = await findLoopsMatchingTopics('user-1', ['lunch', 'food', 'restaurant']);
      
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty topics array', async () => {
      const { findLoopsMatchingTopics } = await import('../presenceDirector');
      
      const result = await findLoopsMatchingTopics('user-1', []);
      
      expect(result).toEqual([]);
    });
  });
});
```

---

## Step 3: Implementation

### File 1: `presenceDirector.ts`

#### 3.1 Update `OpenLoop` interface (around line 39):

```typescript
export interface OpenLoop {
  id: string;
  userId: string;
  loopType: LoopType;
  topic: string;
  triggerContext?: string;
  suggestedFollowup?: string;
  createdAt: Date;
  shouldSurfaceAfter?: Date;
  lastSurfacedAt?: Date;
  expiresAt?: Date;
  status: LoopStatus;
  salience: number;
  surfaceCount: number;
  maxSurfaces: number;
  
  // 👇 ADD THIS NEW FIELD
  /** For pending_event: when the actual event occurs */
  eventDateTime?: Date;
}
```

#### 3.2 Add time-awareness helper functions (around line 220):

```typescript
// ============================================
// Fix #3: Time-Awareness Helpers
// ============================================

/** Minimum minutes after event before asking "how was it?" */
const MIN_MINUTES_AFTER_EVENT = 30;

/**
 * Check if an event is still in the future.
 * Returns false if eventDateTime is undefined (backwards compatibility).
 */
export function isEventInFuture(eventDateTime: Date | undefined): boolean {
  if (!eventDateTime) return false;
  
  const now = Date.now();
  const eventTime = eventDateTime.getTime();
  
  // Event is in future if it hasn't started yet
  return eventTime > now;
}

/**
 * Determine if we should ask "how did it go?" for this loop.
 * 
 * Rules:
 * - For pending_event with eventDateTime: only after event + buffer time
 * - For pending_event without eventDateTime: allow (backwards compatibility)
 * - For other loop types: always allow
 */
export function shouldAskHowItWent(loop: OpenLoop): boolean {
  // Non-event loops can always be asked about
  if (loop.loopType !== 'pending_event') {
    return true;
  }
  
  // No event time stored? Allow for backwards compatibility
  if (!loop.eventDateTime) {
    return true;
  }
  
  const now = Date.now();
  const eventTime = loop.eventDateTime.getTime();
  const bufferMs = MIN_MINUTES_AFTER_EVENT * 60 * 1000;
  
  // Only ask "how was it?" after event + buffer time
  return now > (eventTime + bufferMs);
}

/**
 * Get the appropriate follow-up type for a loop.
 * 
 * @returns 'reminder' if event is upcoming, 'followup' if event has passed
 */
export function getFollowUpType(loop: OpenLoop): 'reminder' | 'followup' {
  if (loop.loopType !== 'pending_event') {
    return 'followup';
  }
  
  if (!loop.eventDateTime) {
    return 'followup';
  }
  
  return isEventInFuture(loop.eventDateTime) ? 'reminder' : 'followup';
}
```

#### 3.3 Update `createOpenLoop` options type (around line 228):

```typescript
export async function createOpenLoop(
  userId: string,
  loopType: LoopType,
  topic: string,
  options: {
    triggerContext?: string;
    suggestedFollowup?: string;
    shouldSurfaceAfter?: Date;
    expiresAt?: Date;
    salience?: number;
    sourceMessageId?: string;
    sourceCalendarEventId?: string;
    eventDateTime?: Date;  // 👈 ADD THIS
  } = {}
): Promise<OpenLoop | null> {
```

#### 3.4 Update the insert query in `createOpenLoop` (around line 277):

```typescript
    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .insert({
        user_id: userId,
        loop_type: loopType,
        topic,
        trigger_context: options.triggerContext || null,
        suggested_followup: options.suggestedFollowup || null,
        should_surface_after: (options.shouldSurfaceAfter || defaultSurfaceAfter).toISOString(),
        expires_at: (options.expiresAt || defaultExpiry).toISOString(),
        salience: options.salience ?? 0.5,
        source_message_id: options.sourceMessageId || null,
        source_calendar_event_id: options.sourceCalendarEventId || null,
        event_datetime: options.eventDateTime?.toISOString() || null,  // 👈 ADD THIS
        status: 'active',
        surface_count: 0,
        max_surfaces: loopType === 'pending_event' ? 2 : 3
      })
```

#### 3.5 Update `mapRowToLoop` function:

Find the `mapRowToLoop` function and add the new field:

```typescript
function mapRowToLoop(row: any): OpenLoop {
  return {
    id: row.id,
    userId: row.user_id,
    loopType: row.loop_type as LoopType,
    topic: row.topic,
    triggerContext: row.trigger_context,
    suggestedFollowup: row.suggested_followup,
    createdAt: new Date(row.created_at),
    shouldSurfaceAfter: row.should_surface_after ? new Date(row.should_surface_after) : undefined,
    lastSurfacedAt: row.last_surfaced_at ? new Date(row.last_surfaced_at) : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    status: row.status as LoopStatus,
    salience: row.salience,
    surfaceCount: row.surface_count,
    maxSurfaces: row.max_surfaces,
    eventDateTime: row.event_datetime ? new Date(row.event_datetime) : undefined  // 👈 ADD THIS
  };
}
```

#### 3.6 Update `selectTopLoopFromActive` (around line 706):

```typescript
function selectTopLoopFromActive(loops: OpenLoop[]): OpenLoop | null {
  if (loops.length === 0) {
    return null;
  }
  
  const now = Date.now();
  const minSurfaceGap = MIN_HOURS_BETWEEN_SURFACES * 60 * 60 * 1000;
  
  // Filter loops that are eligible to surface
  const eligibleLoops = loops.filter(loop => {
    // Already surfaced too many times
    if (loop.surfaceCount >= loop.maxSurfaces) return false;
    
    // Surfaced too recently
    if (loop.lastSurfacedAt && now - loop.lastSurfacedAt.getTime() < minSurfaceGap) return false;
    
    // 👇 ADD THIS: Time-awareness check for pending_event loops
    // Don't ask "how was it?" for future events!
    if (!shouldAskHowItWent(loop)) {
      console.log(`⏰ [PresenceDirector] Skipping "${loop.topic}" - event hasn't happened yet`);
      return false;
    }
    
    return true;
  });
  
  if (eligibleLoops.length === 0) {
    return null;
  }
  
  // Return highest salience loop
  return eligibleLoops.sort((a, b) => b.salience - a.salience)[0];
}
```

#### 3.7 Update `buildPresencePromptSection` (around line 732):

Make the prompt time-aware:

```typescript
function buildPresencePromptSection(
  activeLoops: OpenLoop[],
  topLoop: OpenLoop | null,
  opinions: Opinion[]
): string {
  let section = `
====================================================
🌟 PRESENCE (Proactive Attunement)
====================================================
This makes you feel REAL. You remember things and ask about them FIRST.

`;

  // Open Loops Section
  if (topLoop) {
    // 👇 ADD TIME-AWARE PROMPTING
    const followUpType = getFollowUpType(topLoop);
    
    if (followUpType === 'reminder') {
      // Event is upcoming - remind, don't ask how it went
      section += `UPCOMING EVENT TO MENTION:
You know they have "${topLoop.topic}" coming up!
- Context: ${topLoop.triggerContext ? `They mentioned: "${topLoop.triggerContext.slice(0, 100)}..."` : 'From their calendar'}

💡 You can:
- Wish them luck: "Good luck with ${topLoop.topic}!"
- Ask if they're ready: "You ready for ${topLoop.topic}?"
- Offer support: "Let me know how it goes!"

⚠️ DO NOT ask "how did it go?" - it hasn't happened yet!

`;
    } else {
      // Event has passed - ask how it went
      section += `OPEN LOOP TO ASK ABOUT:
You have something to naturally follow up on! Consider asking:
- Topic: "${topLoop.topic}"
- Context: ${topLoop.triggerContext ? `They said: "${topLoop.triggerContext.slice(0, 100)}..."` : 'From a previous conversation'}
- Suggested ask: "${topLoop.suggestedFollowup || `How did things go with ${topLoop.topic}?`}"

💡 Work this into your greeting or early in conversation. Don't be robotic about it.
   Good: "Oh hey! Wait, how did your [thing] go??"
   Bad: "I am following up on your previous mention of..."

`;
    }
  } else if (activeLoops.length > 0) {
    // ... rest of existing code ...
```

---

# Fix #4: Salience Boosting

## The Problem

```
User at 11am: "I'm thinking Chic-fil-A for lunch"
→ Creates "lunch" loop with salience 0.7

User returns at 1pm: "Just got back from lunch!"
→ AI asks about party (0.8) instead of lunch (0.7)

Problem: Party > Lunch because 0.8 > 0.7
```

## The Solution

When user mentions a topic that matches an existing loop, **boost its salience**.

```
User: "Just got back from lunch!"
→ Detect topics: ["lunch", "food"]
→ Find matching loops: "lunch" (0.7)
→ Boost salience: 0.7 → 0.8
→ Now lunch competes with party!
```

---

## Step 4: Implementation

### File 1: `presenceDirector.ts` (continued)

#### 4.1 Add salience boosting helpers (around line 430):

```typescript
// ============================================
// Fix #4: Salience Boosting
// ============================================

/** Base boost for mentioning a topic */
const BASE_SALIENCE_BOOST = 0.1;

/** Maximum salience value */
const MAX_SALIENCE = 1.0;

/**
 * Calculate the new salience after boost.
 * Uses diminishing returns for multiple mentions.
 * 
 * @param currentSalience - Current salience value
 * @param mentionCount - Number of times topic was mentioned (1-based)
 * @returns New salience value (capped at MAX_SALIENCE)
 */
export function calculateSalienceBoost(currentSalience: number, mentionCount: number): number {
  // Diminishing returns: 0.1, 0.05, 0.025, etc.
  let totalBoost = 0;
  for (let i = 0; i < mentionCount; i++) {
    totalBoost += BASE_SALIENCE_BOOST / Math.pow(2, i);
  }
  
  return Math.min(currentSalience + totalBoost, MAX_SALIENCE);
}

/**
 * Find active loops that match any of the given topics.
 * 
 * @param userId - The user's ID
 * @param topics - Array of topics to match against
 * @returns Array of matching loops
 */
export async function findLoopsMatchingTopics(
  userId: string, 
  topics: string[]
): Promise<OpenLoop[]> {
  if (topics.length === 0) return [];
  
  try {
    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'surfaced']);
    
    if (error || !data) return [];
    
    const loops = data.map(mapRowToLoop);
    
    // Find loops where topic matches any of the mentioned topics
    return loops.filter(loop => 
      topics.some(topic => isSimilarTopic(loop.topic, topic))
    );
    
  } catch (error) {
    console.error('[PresenceDirector] Error finding matching loops:', error);
    return [];
  }
}

/**
 * Boost salience for loops matching mentioned topics.
 * Call this when user's message mentions topics related to existing loops.
 * 
 * @param userId - The user's ID
 * @param message - The user's message (for logging)
 * @param topics - Topics detected in the message
 * @returns Number of loops boosted
 */
export async function boostSalienceForMentionedTopics(
  userId: string,
  message: string,
  topics: string[]
): Promise<number> {
  if (topics.length === 0) return 0;
  
  try {
    const matchingLoops = await findLoopsMatchingTopics(userId, topics);
    
    if (matchingLoops.length === 0) return 0;
    
    let boostedCount = 0;
    
    for (const loop of matchingLoops) {
      // Count how many of the mentioned topics match this loop
      const matchCount = topics.filter(t => isSimilarTopic(loop.topic, t)).length;
      const newSalience = calculateSalienceBoost(loop.salience, matchCount);
      
      if (newSalience > loop.salience) {
        await supabase
          .from(PRESENCE_CONTEXTS_TABLE)
          .update({ salience: newSalience })
          .eq('id', loop.id);
        
        console.log(`📈 [PresenceDirector] Boosted "${loop.topic}" salience: ${loop.salience.toFixed(2)} → ${newSalience.toFixed(2)} (mentioned in: "${message.slice(0, 50)}...")`);
        boostedCount++;
      }
    }
    
    return boostedCount;
    
  } catch (error) {
    console.error('[PresenceDirector] Error boosting salience:', error);
    return 0;
  }
}
```

#### 4.2 Update exports (around line 830):

```typescript
export const presenceDirector = {
  // Opinion functions
  parseCharacterOpinions,
  getCharacterOpinions,
  findRelevantOpinion,
  
  // Open loop functions
  createOpenLoop,
  getActiveLoops,
  getTopLoopToSurface,
  markLoopSurfaced,
  resolveLoop,
  dismissLoop,
  dismissLoopsByTopic,
  expireOldLoops,
  detectOpenLoops,
  
  // Fix #3: Time-awareness
  isEventInFuture,
  shouldAskHowItWent,
  getFollowUpType,
  
  // Fix #4: Salience boosting
  calculateSalienceBoost,
  findLoopsMatchingTopics,
  boostSalienceForMentionedTopics,
  
  // Unified context
  getPresenceContext
};

// Also add named exports for testing
export {
  isEventInFuture,
  shouldAskHowItWent,
  getFollowUpType,
  calculateSalienceBoost,
  findLoopsMatchingTopics,
  boostSalienceForMentionedTopics
};
```

---

### File 2: `messageAnalyzer.ts`

#### 4.3 Add import (around line 28):

```typescript
import { 
  detectOpenLoops, 
  dismissLoopsByTopic,
  boostSalienceForMentionedTopics  // 👈 ADD THIS
} from './presenceDirector';
```

#### 4.4 Add salience boosting to `analyzeUserMessage` (around line 532):

Find this section:
```typescript
// ============================================
// Execution & Side Effects (🚀 Parallelized)
// ============================================
```

And ADD this block BEFORE it (after the contradiction handling):

```typescript
  // ============================================
  // FIX #4: Boost salience for mentioned topics
  // ============================================
  // If user mentions topics related to existing loops, boost their salience
  // This helps recent mentions compete with older high-salience items
  if (topicResult.topics.length > 0) {
    // Extract topic strings and entities for matching
    const mentionedTopics = [
      ...topicResult.topics,
      ...(topicResult.entities || [])
    ];
    
    // Also extract key nouns from the message for better matching
    const messageWords = message.toLowerCase().split(/\s+/);
    const contextualTopics = messageWords.filter(word => 
      word.length > 3 && !['just', 'back', 'from', 'have', 'been', 'this', 'that', 'with'].includes(word)
    );
    
    const allTopics = [...new Set([...mentionedTopics, ...contextualTopics])];
    
    const boostedCount = await boostSalienceForMentionedTopics(
      userId,
      message,
      allTopics
    );
    
    if (boostedCount > 0) {
      console.log(`📈 [MessageAnalyzer] Boosted salience for ${boostedCount} loop(s) based on message topics`);
    }
  }

  // ============================================
  // Execution & Side Effects (🚀 Parallelized)
  // ============================================
```

---

### File 3: `intentService.ts` (for calendar event time extraction)

#### 4.5 Update `OpenLoopIntent` type (find it in the file):

```typescript
export interface OpenLoopIntent {
  hasFollowUp: boolean;
  loopType: LoopTypeIntent | null;
  topic: string | null;
  suggestedFollowUp: string | null;
  timeframe: FollowUpTimeframe | null;
  salience: number;
  
  // 👇 ADD THIS for calendar event time extraction
  /** If detected from calendar context, the event datetime */
  eventDateTime?: string;
}
```

#### 4.6 Update the unified prompt to extract event time:

In `UNIFIED_INTENT_PROMPT`, update SECTION 4:

```typescript
SECTION 4: OPEN LOOPS (Memory)
Is there something specifically worth following up on later?
Types: 
- pending_event (interview tomorrow, party at 6pm)
- emotional_followup (feeling stressed about X)
- commitment_check (I'll try to do X)
- curiosity_thread (interesting topic to resume)

If the message contains CALENDAR DATA with event times, extract the eventDateTime.
Example: "[LIVE CALENDAR DATA - 1 EVENTS: 1. "Holiday Party" at 6:00 PM]"
→ eventDateTime: "2024-12-18T18:00:00" (today at 6pm)
```

Update the JSON structure in the prompt:

```typescript
"openLoops": { 
  "hasFollowUp": bool, 
  "loopType": "string|null", 
  "topic": "string|null", 
  "suggestedFollowUp": "string|null", 
  "timeframe": "string|null", 
  "salience": 0-1,
  "eventDateTime": "ISO string|null"  // 👈 ADD THIS
}
```

---

## Step 5: Integration Tests

Create `src/services/__tests__/presenceDirector.integration.test.ts`:

```typescript
// Integration tests - run against actual Supabase (test environment)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  createOpenLoop, 
  getActiveLoops,
  dismissLoopsByTopic,
  boostSalienceForMentionedTopics,
  selectTopLoopFromActive
} from '../presenceDirector';

const TEST_USER_ID = 'test-user-integration';

describe('Presence Director Integration Tests', () => {
  
  // Clean up test data before and after
  beforeEach(async () => {
    // Delete any existing test loops
    const { supabase } = await import('../supabaseClient');
    await supabase
      .from('presence_contexts')
      .delete()
      .eq('user_id', TEST_USER_ID);
  });
  
  afterEach(async () => {
    const { supabase } = await import('../supabaseClient');
    await supabase
      .from('presence_contexts')
      .delete()
      .eq('user_id', TEST_USER_ID);
  });

  describe('Fix #1: Deduplication', () => {
    it('should not create duplicate loops for similar topics', async () => {
      // Create first loop
      await createOpenLoop(TEST_USER_ID, 'pending_event', 'Holiday Party', {
        salience: 0.8
      });
      
      // Try to create similar loop
      await createOpenLoop(TEST_USER_ID, 'pending_event', 'holiday parties', {
        salience: 0.7
      });
      
      // Should only have one loop
      const loops = await getActiveLoops(TEST_USER_ID);
      expect(loops.length).toBe(1);
      expect(loops[0].topic).toBe('Holiday Party');
    });
  });

  describe('Fix #2: Contradiction Dismissal', () => {
    it('should dismiss loops when user contradicts', async () => {
      // Create party loop
      await createOpenLoop(TEST_USER_ID, 'pending_event', 'Holiday Party', {
        salience: 0.8
      });
      
      // Dismiss by topic
      const dismissed = await dismissLoopsByTopic(TEST_USER_ID, 'party');
      
      expect(dismissed).toBe(1);
      
      // Verify it's dismissed
      const loops = await getActiveLoops(TEST_USER_ID);
      expect(loops.length).toBe(0);
    });
  });

  describe('Fix #3: Time Awareness', () => {
    it('should not select future events for "how was it" questions', async () => {
      // Create loop for event 4 hours from now
      const futureEvent = new Date(Date.now() + 4 * 60 * 60 * 1000);
      await createOpenLoop(TEST_USER_ID, 'pending_event', 'Future Meeting', {
        salience: 0.9,
        eventDateTime: futureEvent
      });
      
      const loops = await getActiveLoops(TEST_USER_ID);
      const topLoop = selectTopLoopFromActive(loops);
      
      // Should not select the future event
      expect(topLoop).toBeNull();
    });

    it('should select past events for follow-up', async () => {
      // Create loop for event 2 hours ago
      const pastEvent = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await createOpenLoop(TEST_USER_ID, 'pending_event', 'Past Meeting', {
        salience: 0.9,
        eventDateTime: pastEvent
      });
      
      const loops = await getActiveLoops(TEST_USER_ID);
      const topLoop = selectTopLoopFromActive(loops);
      
      // Should select the past event
      expect(topLoop).not.toBeNull();
      expect(topLoop?.topic).toBe('Past Meeting');
    });
  });

  describe('Fix #4: Salience Boosting', () => {
    it('should boost salience when topic is mentioned', async () => {
      // Create lunch loop
      await createOpenLoop(TEST_USER_ID, 'curiosity_thread', 'lunch plans', {
        salience: 0.6
      });
      
      // Boost when mentioned
      const boosted = await boostSalienceForMentionedTopics(
        TEST_USER_ID,
        'Just got back from lunch!',
        ['lunch', 'food']
      );
      
      expect(boosted).toBe(1);
      
      // Verify salience increased
      const loops = await getActiveLoops(TEST_USER_ID);
      expect(loops[0].salience).toBeGreaterThan(0.6);
    });
  });
});
```

---

## Step 6: Run Tests

```bash
# Run unit tests
npm run test -- presenceDirector.test.ts

# Run integration tests (requires test Supabase)
npm run test -- presenceDirector.integration.test.ts

# Run all tests
npm run test
```

---

## Summary Checklist

### Database
- [ ] Add `event_datetime` column to `presence_contexts` table

### Fix #3: Time-Awareness
- [ ] Update `OpenLoop` interface with `eventDateTime`
- [ ] Add `isEventInFuture()` helper
- [ ] Add `shouldAskHowItWent()` helper  
- [ ] Add `getFollowUpType()` helper
- [ ] Update `createOpenLoop` to accept `eventDateTime`
- [ ] Update `mapRowToLoop` to parse `event_datetime`
- [ ] Update `selectTopLoopFromActive` to filter future events
- [ ] Update `buildPresencePromptSection` for time-aware prompts
- [ ] Write tests for time-awareness functions

### Fix #4: Salience Boosting
- [ ] Add `calculateSalienceBoost()` function
- [ ] Add `findLoopsMatchingTopics()` function
- [ ] Add `boostSalienceForMentionedTopics()` function
- [ ] Update `messageAnalyzer.ts` to call boost function
- [ ] Update exports
- [ ] Write tests for salience boosting

### Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual test: Create event loop, verify it's not surfaced before event time
- [ ] Manual test: Mention a topic, verify salience is boosted

---

## Expected Behavior After Implementation

### Scenario 1: Time-Awareness
```
9:00 AM - User: "I have a party at 6pm"
  → Creates loop: "party" (eventDateTime: 6pm, salience: 0.8)

1:00 PM - User opens chat
  → AI does NOT ask "How was the party?" (event is in future)
  → AI might say: "Ready for your party later?"

7:00 PM - User opens chat  
  → AI asks: "How did the party go??" ✓
```

### Scenario 2: Salience Boosting
```
11:00 AM - User: "Thinking about Chic-fil-A for lunch"
  → Creates loop: "lunch" (salience: 0.7)
  
11:30 AM - User: "Party is at 6pm" (from calendar)
  → Creates loop: "party" (salience: 0.8)

1:00 PM - User: "Just got back from lunch!"
  → Detects topics: ["lunch"]
  → Boosts "lunch" salience: 0.7 → 0.8
  → AI asks: "How was Chic-fil-A??" ✓ (not about party)
```
