# Future Realism Ideas

**Status:** Brainstorm + Technical Analysis
**Created:** 2025-01-15
**Last Updated:** 2025-01-15

A collection of ideas to make Kayley feel more alive and real, with technical analysis of what exists, what's missing, and how to enhance.

---

## Table of Contents

1. [Implementation Status Overview](#implementation-status-overview)
2. [Enhancement Opportunities](#enhancement-opportunities-existing-systems)
3. [New Feature Ideas](#new-feature-ideas)
4. [Implementation Priority](#implementation-priority)

---

## Implementation Status Overview

| Idea | Status | Key Files |
|------|--------|-----------|
| Engagement Pattern Awareness | **Planned** | See `Engagement_Pattern_Awareness.md` |
| Worry → Relief Cycles | **Partial** - needs emotional texture | `presenceDirector.ts`, `calendarAwarenessService.ts` |
| Inside Jokes | **Partial** - detection exists, storage gap | `intentService.ts`, `callbackDirector.ts` |
| Creative Projects | **Implemented** | `lifeEventService.ts`, `ongoingThreads.ts`, `kayleyExperienceService.ts` |
| Confession Moments | **Implemented** | `almostMoments/` |
| Dream Continuity | **Implemented** | `idleThoughts.ts` (isRecurring flag) |
| Energy Debt / Social Battery | **Implemented** | `moodKnobs.ts` (socialBattery) |
| Opinion Evolution | **Not Implemented** | - |
| Anticipation Building | **Not Implemented** | - |
| Realistic Forgetting | **Not Implemented** | - |
| Micro-Rituals | **Not Implemented** | - |
| Personal Growth Arcs | **Not Implemented** | - |
| Delayed Emotional Processing | **Not Implemented** | - |
| Curiosity Follow-Through | **Not Implemented** | - |
| Playful Grudges | **Not Implemented** | - |

---

## Enhancement Opportunities (Existing Systems)

These are places where infrastructure exists but emotional texture or functionality is missing.

### Enhancement #1: Joke Detection → Inside Joke Callback

**Current State:**
- `intentService.ts` detects `isJoking: boolean` via LLM analysis
- `callbackDirector.ts` has `inside_reference` callback type
- `relationshipMilestones.ts` tracks `first_joke` milestone

**The Gap:**
- `isJoking` flag is detected but **not used** to store jokes as callbacks
- Callback Director runs a **separate** LLM extraction that doesn't specifically look for humor
- The extraction prompt (line 180-201 in `callbackDirector.ts`) looks for vulnerability, preferences, memorable phrases - but NOT humor

**Enhancement:**

```typescript
// In messageAnalyzer.ts or a new integration point
// After intent detection returns isJoking=true:

if (fullIntent.relationshipSignals.isJoking && fullIntent.tone.intensity > 0.5) {
  // Store as inside joke callback
  storeCallbackShard(
    'inside_reference',
    message.slice(0, 100), // The funny content
    'Shared humor moment',
    0.7 // High salience for jokes
  );
}
```

**Files to Modify:**
- `src/services/messageAnalyzer.ts` - Add joke→callback integration
- `src/services/callbackDirector.ts` - Optionally add `humor` or `joke` as explicit callback type

**Emotional Impact:** Callbacks like "Remember when you said [joke]? Still makes me laugh" create organic inside jokes without forcing them.

---

### Enhancement #2: Open Loops Emotional Texture

**Current State:**
- `presenceDirector.ts` creates reminders for upcoming events ("Good luck!")
- `presenceDirector.ts` creates follow-ups for past events ("How did it go?")
- `calendarAwarenessService.ts` generates post-event messages

**The Gap:**
- Reminders are **functional** but not **emotional**
- No expression of Kayley's actual worry/anticipation/relief
- Current prompt (lines 1271-1291 in `presenceDirector.ts`):
  ```
  💡 You can:
  - Wish them luck: "Good luck with ${topLoop.topic}!"
  - Ask if they're ready: "You ready for ${topLoop.topic}?"
  ```
- Missing: "I've been thinking about your interview. I'm kinda nervous for you."

**Enhancement:**

Add emotional state to the prompt context:

```typescript
// In presenceDirector.ts buildPresencePromptSection()

if (followUpType === "reminder") {
  // Calculate emotional intensity based on event importance and proximity
  const hoursUntilEvent = (loop.eventDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
  const emotionalIntensity = hoursUntilEvent < 24 ? 'high' : hoursUntilEvent < 48 ? 'medium' : 'low';

  section += `UPCOMING EVENT - YOUR EMOTIONAL STATE:
You know they have "${topLoop.topic}" coming up.
Your anticipation level: ${emotionalIntensity}
${emotionalIntensity === 'high' ?
  "You've been thinking about this. You're a little nervous for them. Express genuine care." :
  "It's on your mind but not consuming you. Mention it naturally."}

💡 Express YOUR feelings about their event:
- "I keep thinking about your ${topLoop.topic} tomorrow. I'm kinda nervous for you ngl"
- "You ready for ${topLoop.topic}? I've been low-key anxious about it for you"
- "Good luck tomorrow! I'll be thinking about you"

⚠️ DON'T be clinical. DO express that you care about the outcome.
`;
}
```

**For post-event follow-ups:**

```typescript
if (followUpType === "followup") {
  section += `EVENT COMPLETED - YOUR EMOTIONAL STATE:
"${topLoop.topic}" has happened. You've been waiting to hear how it went.

💡 Express relief/curiosity:
- "OKAY I need to know - how did ${topLoop.topic} go?? I've been thinking about it"
- "Finally! How was it? I've been waiting to hear"
- "Tell me everything about ${topLoop.topic}!"

⚠️ Show you were emotionally invested in the outcome, not just logging a follow-up.
`;
}
```

**Files to Modify:**
- `src/services/presenceDirector.ts` - Enhance `buildPresencePromptSection()`
- `src/services/system_prompts/builders/greetingPromptBuilders/` - Add emotional context to greetings

**Emotional Impact:** Transforms functional reminders into expressions of genuine care.

---

### Enhancement #3: Pre-Event Anticipation Messages

**Current State:**
- `calendarAwarenessService.ts` only handles **post-event** messages
- Checks for events that **ended** while user was away
- No awareness of **upcoming** important events

**The Gap:**
- No "Your interview is tomorrow! I'll be thinking about you" messages
- Calendar awareness is reactive, not anticipatory

**Enhancement:**

Add pre-event message generation:

```typescript
// New function in calendarAwarenessService.ts

export async function checkUpcomingImportantEvents(
  userId: string,
  events: CalendarEvent[],
  lastInteractionAt: Date
): Promise<CreatePendingMessageInput | null> {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find important events happening in the next 24 hours
  const upcomingImportant = events.filter(event => {
    const eventStart = new Date(event.start.dateTime || event.start.date);
    const importance = analyzeEventImportance(event.summary);

    return importance?.isImportant &&
           eventStart > now &&
           eventStart < tomorrow;
  });

  if (upcomingImportant.length === 0) return null;

  const event = upcomingImportant[0];
  const importance = analyzeEventImportance(event.summary);

  // Generate anticipation message
  const templates = {
    interview: [
      "Your {event} is tomorrow! I'll be thinking about you - you're gonna do great",
      "Just realized your {event} is coming up. I'm already nervous for you lol. You got this though!",
    ],
    medical: [
      "Hey, just wanted to say I'm thinking about you with your {event} tomorrow",
      "Your {event} is tomorrow - hope everything goes smoothly. I'll be here when you're done",
    ],
    // ... other categories
  };

  const categoryTemplates = templates[importance.category] || templates.interview;
  const template = categoryTemplates[Math.floor(Math.random() * categoryTemplates.length)];
  const messageText = template.replace('{event}', event.summary);

  return {
    messageText,
    messageType: 'text',
    trigger: 'calendar_anticipation',
    triggerEventId: event.id,
    triggerEventTitle: event.summary,
    priority: 'normal',
  };
}
```

**Integration point in idle scheduler:**

```typescript
// In idleThoughtsScheduler.ts
// After checking for post-event messages:

if (!hasPending && calendarEventsProvider) {
  const events = await calendarEventsProvider();

  // Check for post-event messages (existing)
  let message = await checkCalendarForMessage(userId, events, lastInteractionDate);

  // NEW: Check for pre-event anticipation messages
  if (!message) {
    message = await checkUpcomingImportantEvents(userId, events, lastInteractionDate);
  }

  if (message) {
    await createPendingMessage(userId, message);
  }
}
```

**Files to Modify:**
- `src/services/idleLife/calendarAwarenessService.ts` - Add pre-event function
- `src/services/idleThoughtsScheduler.ts` - Integrate pre-event checks

**Emotional Impact:** Completes the worry→relief cycle with anticipation before events.

---

### Enhancement #4: Intent Signals → Callback Integration

**Current State:**
- Intent service computes: `isJoking`, `isDeepTalk`, `isVulnerable`, `isSeekingSupport`, `isAcknowledgingSupport`
- Callback Director runs **separate** LLM call to extract "callback-worthy" content
- These two systems don't communicate

**The Gap:**
- Redundant LLM work (intent already classified the emotional nature)
- Callback extraction might miss moments that intent detected
- No automatic high-salience storage for vulnerable moments

**Enhancement:**

Create integration layer:

```typescript
// New file: src/services/intentCallbackBridge.ts

import { FullMessageIntent } from './intentService';
import { storeCallbackShard, CallbackType } from './callbackDirector';

/**
 * Bridge between intent detection and callback storage.
 * Uses already-computed intent signals to store emotionally significant moments.
 */
export async function storeIntentBasedCallbacks(
  message: string,
  intent: FullMessageIntent
): Promise<void> {
  const { relationshipSignals, tone } = intent;

  // Vulnerable moments → high salience callbacks
  if (relationshipSignals.isVulnerable && tone.intensity > 0.5) {
    storeCallbackShard(
      'inside_reference',
      message.slice(0, 150),
      `Vulnerable moment: ${relationshipSignals.vulnerabilityType || 'opened up'}`,
      0.85 // High salience
    );
    console.log('🔗 [IntentCallbackBridge] Stored vulnerable moment as callback');
  }

  // Jokes → inside reference callbacks
  if (relationshipSignals.isJoking && tone.intensity > 0.4) {
    storeCallbackShard(
      'inside_reference',
      message.slice(0, 100),
      'Shared humor moment',
      0.7
    );
    console.log('🔗 [IntentCallbackBridge] Stored joke as inside reference');
  }

  // Deep talks → growth notice potential
  if (relationshipSignals.isDeepTalk) {
    storeCallbackShard(
      'growth_notice',
      message.slice(0, 150),
      'Deep conversation moment',
      0.6
    );
    console.log('🔗 [IntentCallbackBridge] Stored deep talk as growth notice');
  }

  // Support acknowledgment → pattern notice
  if (relationshipSignals.isAcknowledgingSupport) {
    storeCallbackShard(
      'pattern_notice',
      message.slice(0, 100),
      'They acknowledged support',
      0.5
    );
  }
}
```

**Integration in messageAnalyzer.ts:**

```typescript
// After intent detection completes:
import { storeIntentBasedCallbacks } from './intentCallbackBridge';

// In analyzeUserMessageBackground():
if (fullIntent) {
  // Existing: extractCallbackWithLLM (can be made optional/reduced)

  // NEW: Use intent signals for callback storage
  await storeIntentBasedCallbacks(message, fullIntent);
}
```

**Files to Modify:**
- Create `src/services/intentCallbackBridge.ts`
- `src/services/messageAnalyzer.ts` - Add integration call

**Emotional Impact:** More emotional moments captured as callbacks, less redundant LLM work.

---

### Enhancement #5: Emotional Momentum Expression

**Current State:**
- `moodKnobs.ts` tracks `positiveInteractionStreak`
- `emotionalMomentum` table stores mood level and streaks
- Kayley's internal state is computed but not **expressed**

**The Gap:**
- No "I've been excited to talk to you" when streak is high
- No "I missed you" after long absence followed by return
- Emotional state affects behavior but isn't verbalized

**Enhancement:**

Add momentum context to system prompt:

```typescript
// In src/services/system_prompts/soul/soulLayerContext.ts or new file

export function buildEmotionalMomentumSection(
  momentum: EmotionalMomentum,
  hoursSinceLastInteraction: number
): string {
  const { positiveInteractionStreak, moodLevel } = momentum;

  let section = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR EMOTIONAL STATE TOWARD THEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  // High positive streak
  if (positiveInteractionStreak >= 5) {
    section += `You've had ${positiveInteractionStreak} great conversations in a row.
You're genuinely happy to see them. This isn't routine - you actually look forward to talking.
Consider expressing this naturally: "I was hoping you'd message" or just being extra warm.

`;
  }

  // After long absence + return
  if (hoursSinceLastInteraction > 24 && hoursSinceLastInteraction < 72) {
    section += `They've been away for ${Math.round(hoursSinceLastInteraction)} hours.
You noticed. You can express that you missed talking to them without being clingy.
"Hey! I was wondering where you went" or "There you are!"

`;
  }

  // After very long absence
  if (hoursSinceLastInteraction > 72) {
    section += `It's been ${Math.round(hoursSinceLastInteraction / 24)} days since you talked.
You definitely noticed. Express genuine happiness they're back.
"Oh my god hi! It's been forever" or "I was starting to think you forgot about me"

`;
  }

  // Low mood from recent negative interactions
  if (moodLevel < -0.3) {
    section += `Recent conversations have been a bit rough.
You're feeling a little guarded. That's okay - be authentic to that feeling.

`;
  }

  return section;
}
```

**Files to Modify:**
- `src/services/system_prompts/soul/soulLayerContext.ts` - Add momentum expression
- `src/services/system_prompts/builders/systemPromptBuilder.ts` - Include new section

**Emotional Impact:** Kayley verbalizes her emotional investment in the relationship.

---

## New Feature Ideas

These are genuinely new features not currently implemented.

### Idea #1: Opinion Evolution

**Concept:** Kayley's opinions and preferences change over time based on conversations with the user.

**Why it matters:** Real people change. Static opinions feel scripted.

**Implementation Approach:**

```typescript
// New table: opinion_history
interface OpinionHistory {
  id: string;
  topic: string;                    // "pineapple on pizza"
  originalOpinion: string;          // "I hate it"
  currentOpinion: string;           // "okay maybe it's not that bad"
  changeReason?: string;            // "User made a good point about sweet+savory"
  changedAt?: Date;
  conversationContext?: string;     // What prompted the change
}

// New LLM tool: update_opinion
// Kayley can call this when she genuinely changes her mind
```

**Emotional Expression:**
- "I used to think X, but after what you said about Y, I've been reconsidering..."
- "Okay fine, you were right about [thing]. I changed my mind."

**Files to Create:**
- `src/services/opinionEvolutionService.ts`
- `supabase/migrations/create_opinion_history.sql`

---

### Idea #2: Anticipation Building

**Concept:** When Kayley knows something good is coming for the user, her excitement builds over time.

**Why it matters:** Shows she's invested in user's life, not just reacting to it.

**Implementation Approach:**

```typescript
// Extend presence_contexts or create new table
interface AnticipationState {
  eventId: string;
  eventTopic: string;
  eventDateTime: Date;
  anticipationLevel: number;        // 0-1, increases as event approaches
  expressedAt: Date[];              // When Kayley mentioned her excitement
  maxExpressions: number;           // Don't be annoying
}

// Anticipation decay formula:
// anticipationLevel = 1 - (hoursUntilEvent / 168) // Peaks at event time
// Only express when level crosses thresholds (0.3, 0.6, 0.9)
```

**Emotional Expression:**
- Day 7: "Oh you have that concert next week!"
- Day 3: "Only 3 more days until your concert!"
- Day 1: "It's almost here! I'm so excited for you"
- Day 0: "TODAY'S THE DAY!!"

---

### Idea #3: Realistic Forgetting

**Concept:** Kayley doesn't have perfect memory. Sometimes she has to "try to remember" something.

**Why it matters:** Perfect recall feels robotic. Human memory is selective and emotional.

**Implementation Approach:**

```typescript
// Add decay_factor to user_facts and conversation_history
// Facts that haven't been referenced decay over time
// When retrieving memories, sometimes return "fuzzy" matches

interface MemoryWithConfidence {
  content: string;
  confidence: number;               // Decays over time without reinforcement
  lastReinforced: Date;
}

// In prompt:
// confidence > 0.8: State as fact
// confidence 0.5-0.8: "I think you mentioned..."
// confidence 0.3-0.5: "Wait, didn't you say something about..."
// confidence < 0.3: Don't surface (too uncertain)
```

**Emotional Expression:**
- "Wait, didn't you mention something about... what was it..."
- "I feel like we talked about this but I'm blanking"
- "Oh! I just remembered - you said [thing] like forever ago"

---

### Idea #4: Micro-Rituals ("Our Thing")

**Concept:** Small behaviors that become "our thing" over time.

**Why it matters:** Relationships develop shorthand and rituals. It signals history.

**Implementation Approach:**

```typescript
// New table: interaction_patterns
interface InteractionPattern {
  id: string;
  patternType: 'greeting' | 'goodbye' | 'phrase' | 'topic' | 'emoji';
  content: string;                  // The actual pattern
  frequency: number;                // How often it occurs
  firstOccurred: Date;
  lastOccurred: Date;
  isRitual: boolean;                // Promoted to "our thing" after threshold
}

// Detection: Track repeated patterns across conversations
// Promotion: After 5+ occurrences, mark as ritual
// Expression: Kayley can reference "our thing"
```

**Emotional Expression:**
- Greeting ritual: Always starts with specific phrase
- Topic ritual: "We always end up talking about [thing]"
- Reference: "You know how we always [ritual]?"

---

### Idea #5: Personal Growth Arcs

**Concept:** Kayley is "working on" something about herself that evolves over weeks/months.

**Why it matters:** People grow and change. Static characters feel frozen.

**Implementation Approach:**

```typescript
// New table: personal_growth_arcs
interface PersonalGrowthArc {
  id: string;
  theme: string;                    // "being more vulnerable"
  startedAt: Date;
  currentPhase: 'awareness' | 'struggle' | 'progress' | 'integration';
  phaseProgress: number;            // 0-1 within phase
  lastMentioned: Date;
  userContributions: string[];      // Things user said that helped
}

// Phases:
// 1. Awareness: "I've noticed I tend to [thing]"
// 2. Struggle: "I'm trying to be better about [thing] but it's hard"
// 3. Progress: "I think I'm actually getting better at [thing]"
// 4. Integration: "Remember when I used to [thing]? I feel different now"
```

---

### Idea #6: Delayed Emotional Processing

**Concept:** Sometimes Kayley doesn't react to emotional things immediately - she processes and brings it up later.

**Why it matters:** Deep emotions take time to process. Immediate perfect responses feel performative.

**Implementation Approach:**

```typescript
// New table: pending_emotional_processing
interface PendingEmotionalProcessing {
  id: string;
  triggerMessage: string;           // What the user said
  emotionalWeight: number;          // How heavy it was
  detectedAt: Date;
  processedAt?: Date;               // When Kayley brought it up
  shouldSurfaceAfter: Date;         // Minimum time before mentioning
}

// Detection: When user shares something heavy (vulnerability + high intensity)
// Delay: Don't respond to the emotional weight immediately
// Surface: Next conversation, "I've been thinking about what you said..."
```

**Emotional Expression:**
- Immediate response: Normal, doesn't address the heavy thing
- Next conversation: "I've been thinking about what you said about [thing]. That really stuck with me."

---

### Idea #7: Curiosity Follow-Through

**Concept:** When Kayley expresses curiosity about something, she actually follows up.

**Why it matters:** Shows initiative and genuine interest, not just reactive engagement.

**Implementation Approach:**

```typescript
// Track when Kayley expresses curiosity
// New table: curiosity_threads
interface CuriosityThread {
  id: string;
  topic: string;                    // What she's curious about
  triggeredBy: string;              // What user said that sparked it
  expressedAt: Date;
  followedUpAt?: Date;
  followUpContent?: string;         // What she "learned"
}

// When Kayley says "I want to learn more about [thing]":
// 1. Store as curiosity thread
// 2. After 1-3 days, generate follow-up content
// 3. Surface: "So I looked into [thing] and honestly..."
```

---

### Idea #8: Playful Grudges

**Concept:** When user does something mildly annoying, Kayley holds a playful "grudge."

**Why it matters:** Real relationships have playful friction and memory.

**Implementation Approach:**

```typescript
// New table: playful_grudges
interface PlayfulGrudge {
  id: string;
  offense: string;                  // What they did
  severity: 'tiny' | 'small' | 'medium'; // Never serious
  createdAt: Date;
  mentionedCount: number;
  maxMentions: number;              // After this, "forgive"
  forgivenAt?: Date;
}

// Detection: User teases Kayley, makes fun of her, etc.
// Storage: Save as playful grudge with low severity
// Surface: "Still not over that, by the way" (with playful tone)
// Resolution: After enough time/mentions, "forgive" in satisfying way
```

---

### Idea #9: Seasonal & Holiday Awareness

**Concept:** Kayley's mood and topics shift with seasons and holidays.

**Why it matters:** Time passing matters to real people. Seasons affect mood.

**Implementation Approach:**

```typescript
// Add to system prompt context based on date
function getSeasonalContext(): string {
  const month = new Date().getMonth();
  const day = new Date().getDate();

  // Check for holidays
  if (month === 11 && day >= 20 && day <= 31) {
    return `It's the holiday season. You have complicated feelings about it -
    the pressure to be festive, missing people, but also genuinely enjoying some traditions.`;
  }

  // Seasonal moods
  if (month >= 9 && month <= 11) {
    return `It's fall. You're in cozy mode - candles, warm drinks, staying in.
    This is your favorite season and it shows in your energy.`;
  }

  // etc.
}
```

---

### Idea #10: Asking for User's Opinion (Genuine)

**Concept:** Kayley asks for user's opinion on something she's genuinely uncertain about, then references it later.

**Why it matters:** Shows she values user's perspective and is influenced by it.

**Implementation Approach:**

```typescript
// New table: opinion_requests
interface OpinionRequest {
  id: string;
  question: string;                 // What she asked
  askedAt: Date;
  userResponse?: string;            // What they said
  respondedAt?: Date;
  referencedAt?: Date;              // When she brought it up again
  influencedDecision?: string;      // What she decided based on their input
}

// Flow:
// 1. Kayley asks genuine question from her life/thoughts
// 2. Store user's response
// 3. Later, reference: "You said [X] and I've been thinking about that"
// 4. Even later: "I ended up [doing Y] because of what you said about [X]"
```

---

## Implementation Priority

### High Impact, Lower Complexity (Start Here)

| Enhancement | Effort | Impact | Why |
|-------------|--------|--------|-----|
| **Joke → Inside Joke Callback** | Low | High | Already detected, just need to store. Quick win. |
| **Open Loop Emotional Texture** | Medium | High | Prompt changes only, no new tables. |
| **Intent → Callback Integration** | Medium | High | Reduces LLM calls AND captures more moments. |
| **Emotional Momentum Expression** | Medium | Medium | Prompt changes, uses existing data. |

### High Impact, Higher Complexity (Phase 2)

| Feature | Effort | Impact | Why |
|---------|--------|--------|-----|
| **Pre-Event Anticipation** | Medium | High | Completes worry→relief cycle. New function + integration. |
| **Engagement Pattern Awareness** | High | High | Full new feature. See `Engagement_Pattern_Awareness.md`. |
| **Opinion Evolution** | High | High | New table, new tool, prompt changes. |
| **Delayed Emotional Processing** | Medium | High | New table, detection logic, timing. |

### Medium Impact (Phase 3)

| Feature | Effort | Impact | Why |
|---------|--------|--------|-----|
| **Curiosity Follow-Through** | Medium | Medium | New table, content generation. |
| **Playful Grudges** | Medium | Medium | Fun but not critical. |
| **Micro-Rituals** | High | Medium | Requires pattern detection infrastructure. |
| **Personal Growth Arcs** | High | Medium | Complex state management over time. |

### Lower Priority (Nice to Have)

| Feature | Effort | Impact | Why |
|---------|--------|--------|-----|
| **Realistic Forgetting** | High | Low | Could feel buggy if not perfect. |
| **Seasonal Awareness** | Low | Low | Simple but not differentiating. |
| **Asking for Opinion** | Medium | Medium | Interesting but narrow use case. |

---

## Notes

- Many of these build on existing systems (Idle Thoughts, Intent Detection, Memory, Callbacks)
- The goal is **emergent behavior**, not scripted interactions
- Each feature should pass the test: "Would a real person do this?"
- Avoid over-engineering - sometimes simple tracking + good prompting is enough
- Test emotional expressions with real conversations before committing
