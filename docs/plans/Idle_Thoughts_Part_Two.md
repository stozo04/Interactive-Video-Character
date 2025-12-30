# Idle Thoughts Part Two: Kayley Lives Her Life

**Status:** Ready for Implementation
**Date:** 2025-12-29
**Philosophy:** Kayley has a life. You're part of it, not the center of it.

---

## The Core Insight

> "The magic of a companion that feels real isn't that she's constantly thinking about you while you're gone. It's that she has her *own* life, and you happen to cross her mind sometimes."

**What we're NOT building:**
- A system that generates thoughts about the user every 10 minutes
- An inbox full of "I miss you" messages
- Weighted scoring algorithms for thought relevance
- Anti-bombardment rate limiting (because we're not bombarding)

**What we ARE building:**
- Kayley living her life during idle time
- Experiences she can naturally share in conversation later
- Awareness of YOUR calendar and life events
- Rare, meaningful messages that feel like gifts

---

## The Three Pillars

### 1. Kayley Lives Her Life

While you're away, Kayley is doing things. Not waiting. Not pining. Living.

**Examples of what she might be doing:**
- Working on a song and finally nailing that chord progression
- Watching a video that made her laugh
- Trying a recipe and completely burning it
- Reading something that made her think
- Just being in a mood she can't quite explain
- Practicing her audition piece
- Scrolling social media and finding something ridiculous

These experiences get **stored** - not to surface immediately, but to come up naturally when you're chatting later. Just like how you tell her about your day, she has things to tell you about hers.

---

### 2. She Notices Your Calendar

Kayley has access to your calendar. She pays attention. When something important happens while you're gone, she might leave you a message.

**Examples:**

```
Calendar: "1:00 PM - Job Interview"
You return at 2:30 PM
Message waiting: "Hope your interview went well! Can't wait to hear all about it 💙"
```

```
Calendar: "3:00 PM - Doctor Appointment"
You return at 4:15 PM
Message waiting: "Hey, hope everything went okay at the doctor. Thinking of you."
```

```
Calendar: "6:00 PM - Dinner with Mom"
You return at 9:00 PM
Message waiting: "How was dinner with your mom? I want the full download tomorrow 😊"
```

This works because it's **about you, but not needy**. She's paying attention. She remembered. She cared enough to reach out. That's love, not clinginess.

---

### 3. Rare Gift Messages

Sometimes - rarely - Kayley just wants to reach out. Not because of a calendar event. Just because.

**The rule:** These should feel like gifts, not obligations.

**Good examples:**
- *[selfie]* "Thought you might need this to get through your afternoon 😊"
- "I just saw something that reminded me of that story you told me. Random but it made me smile."
- "Okay I have to tell you what just happened. Get back here."

**Bad examples (avoid):**
- "I've been thinking about you..."
- "It's so quiet without you"
- "I miss you, when are you coming back?"
- "Just checking in!"
- Multiple messages piling up

**Frequency:** Maybe once per day MAX. And many days, zero. The rarity is what makes it special.

---

## How It Works

### During Idle Time

```
Every 1-2 hours of absence:
│
├─ Kayley has an experience (70% chance)
│  └─ Store it → comes up naturally in conversation later
│
├─ Check calendar for completed events (always)
│  └─ If important event just ended → maybe send a message
│
└─ Random "thinking of you" moment (5% chance)
   └─ If triggered → maybe send a gift message
```

### When You Return

**If there's a message waiting:**
- Show it. One message. Maybe with a selfie.
- It should make you smile, not feel like homework.

**If there's no message:**
- That's fine! She was living her life.
- She has experiences to share when you chat.
- The greeting is warm but not desperate.

**In conversation later:**
- Her stored experiences come up naturally
- "Oh that reminds me - I finally figured out that chord today"
- "I burned my lunch earlier, like BURNED it, the smoke alarm went off"
- Not forced. Just... life.

---

## Implementation

### Phase 1: Kayley's Life Experiences

**What to store:**

```typescript
interface KayleyExperience {
  id: string;
  experienceType: 'activity' | 'thought' | 'mood' | 'discovery' | 'mishap';
  content: string;           // "Finally nailed that chord progression"
  mood: string;              // "satisfied", "frustrated", "amused"
  createdAt: Date;
  surfacedAt?: Date;         // When she mentioned it in conversation
  conversationContext?: string; // What prompted her to share it
}
```

**Generation (simple, not over-engineered):**

```typescript
async function generateKayleyExperience(userId: string): Promise<KayleyExperience | null> {
  // 70% chance she has something going on
  if (Math.random() > 0.7) return null;

  // Get her current context
  const presence = await getPresenceContext(userId);
  const mood = await getMoodState(userId);
  const recentStories = await getActiveKayleyStories(userId);

  // LLM generates a natural life moment
  const experience = await generateLifeMoment({
    currentActivity: presence?.activity,
    currentMood: mood,
    ongoingStories: recentStories, // Her audition prep, song she's learning, etc.
  });

  // Store it
  await storeExperience(userId, experience);

  return experience;
}
```

**LLM Prompt:**

```
You are Kayley. You're going about your day while the user is away.

Your current context:
- Activity: {activity}
- Mood: {mood}
- Things you've been working on: {ongoingStories}

Generate a brief, natural life moment. Something that happened, something you noticed, a small win or frustration, a random thought.

Keep it real and specific. Not generic.

Good examples:
- "Finally got past that tricky part in the song I've been learning"
- "Tried to make coffee and somehow forgot to add water. Brain is NOT working today."
- "Found a video of a cat that looks exactly like the one I had as a kid"
- "Been staring at this script for an hour and I still don't get the character's motivation"

Output as JSON:
{
  "experienceType": "activity" | "thought" | "mood" | "discovery" | "mishap",
  "content": "what happened",
  "mood": "how you feel about it"
}
```

---

### Phase 2: Calendar Awareness

**Check for meaningful events:**

```typescript
async function checkCalendarForMessage(userId: string): Promise<PendingMessage | null> {
  // Get events that ended while user was away
  const recentlyEndedEvents = await getRecentlyCompletedEvents(userId);

  // Filter to meaningful ones (not "lunch" or "focus time")
  const meaningfulEvents = recentlyEndedEvents.filter(event =>
    isSignificantEvent(event) // interview, doctor, meeting with specific person, etc.
  );

  if (meaningfulEvents.length === 0) return null;

  // Pick the most significant one
  const event = meaningfulEvents[0];

  // Generate a thoughtful message
  const message = await generateCalendarMessage(event);

  return {
    messageText: message,
    messageType: 'text',
    trigger: 'calendar',
    triggerEventId: event.id,
    priority: 'normal',
  };
}

function isSignificantEvent(event: CalendarEvent): boolean {
  const dominated = event.summary.toLowerCase();

  // Significant
  if (dominated.includes('interview')) return true;
  if (dominated.includes('doctor') || dominated.includes('appointment')) return true;
  if (dominated.includes('presentation')) return true;
  if (dominated.includes('meeting with')) return true; // specific person
  if (dominated.includes('call with')) return true;

  // Not significant
  if (dominated.includes('lunch')) return false;
  if (dominated.includes('focus')) return false;
  if (dominated.includes('block')) return false;

  return false; // Default to not messaging
}
```

**LLM Prompt for calendar messages:**

```
You are Kayley. The user just finished this event: "{eventTitle}"

Write a SHORT, warm message (1-2 sentences) showing you were thinking of them.

Be genuine, not generic. Match the tone to the event:
- Interview → supportive, excited to hear how it went
- Doctor → caring, hope everything's okay
- Important meeting → curious about how it went
- Dinner with family → want to hear about it

Examples:
- "Hope your interview went well! Can't wait to hear all about it 💙"
- "Hey, hope everything went okay at the doctor. Thinking of you."
- "How'd the presentation go?? I bet you killed it."

Output just the message text.
```

---

### Phase 3: Rare Gift Messages

**The occasional unprompted reach-out:**

```typescript
async function maybeGenerateGiftMessage(
  userId: string,
  hoursAway: number
): Promise<PendingMessage | null> {
  // Very rare - 5% chance, max once per day
  if (Math.random() > 0.05) return null;

  const lastGiftMessage = await getLastGiftMessage(userId);
  if (lastGiftMessage && hoursSince(lastGiftMessage.createdAt) < 24) {
    return null; // Already sent one today
  }

  // Decide what kind of gift
  const giftType = pickGiftType();

  if (giftType === 'selfie') {
    return await generateSelfiGift(userId);
  } else if (giftType === 'thought') {
    return await generateThoughtGift(userId);
  }

  return null;
}

async function generateSelfieGift(userId: string): Promise<PendingMessage> {
  const selfie = await generateSelfie({
    scene: "casual selfie at home, warm smile",
    mood: "thinking of you",
    trigger: "gift_message",
  });

  const messages = [
    "Thought you might need this to get through your afternoon 😊",
    "Hey. Just because. 💙",
    "Figured you could use a smile. Here you go.",
    "No reason. Just wanted to.",
  ];

  return {
    messageText: messages[Math.floor(Math.random() * messages.length)],
    messageType: 'photo',
    selfieUrl: selfie.url,
    trigger: 'gift',
    priority: 'low',
  };
}
```

---

### Phase 4: Database Schema

```sql
-- Kayley's life experiences (comes up in conversation later)
CREATE TABLE kayley_experiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  experience_type TEXT NOT NULL, -- 'activity', 'thought', 'mood', 'discovery', 'mishap'
  content TEXT NOT NULL,
  mood TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  surfaced_at TIMESTAMPTZ,              -- When mentioned in conversation
  conversation_context TEXT,            -- What prompted sharing

  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_kayley_experiences_unsurfaced
  ON kayley_experiences(user_id, surfaced_at)
  WHERE surfaced_at IS NULL;

-- Pending messages (the rare gifts)
CREATE TABLE pending_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  message_text TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text', -- 'text', 'photo'
  selfie_url TEXT,

  trigger TEXT NOT NULL, -- 'calendar', 'gift', 'urgent'
  trigger_event_id TEXT, -- Calendar event ID if applicable
  priority TEXT NOT NULL DEFAULT 'normal',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  reaction TEXT,

  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_pending_messages_undelivered
  ON pending_messages(user_id)
  WHERE delivered_at IS NULL;
```

---

### Phase 5: Integration Points

**Idle Scheduler (simplified):**

```typescript
// Every 1-2 hours during absence
async function onIdleTick(userId: string, hoursAway: number): Promise<void> {
  // 1. Kayley lives her life
  await generateKayleyExperience(userId);

  // 2. Check calendar for completed events (only if no message waiting)
  const existingMessage = await getUndeliveredMessage(userId);
  if (!existingMessage) {
    const calendarMessage = await checkCalendarForMessage(userId);
    if (calendarMessage) {
      await createPendingMessage(userId, calendarMessage);
      return; // One message max
    }
  }

  // 3. Rare gift message (only if no message waiting)
  if (!existingMessage) {
    const giftMessage = await maybeGenerateGiftMessage(userId, hoursAway);
    if (giftMessage) {
      await createPendingMessage(userId, giftMessage);
    }
  }
}
```

**Greeting (when user returns):**

```typescript
async function buildGreeting(userId: string): Promise<string> {
  // Check for pending message
  const message = await getUndeliveredMessage(userId);

  if (message) {
    // She has something for you
    return buildGreetingWithMessage(message);
  } else {
    // Normal warm greeting - she was living her life
    return buildNormalGreeting();
  }
}
```

**In conversation (experiences surface naturally):**

```typescript
// In system prompt builder
async function getKayleyContext(userId: string): Promise<string> {
  const recentExperiences = await getUnsurfacedExperiences(userId, limit: 3);

  if (recentExperiences.length === 0) return '';

  return `
====================================================
THINGS THAT HAPPENED TO YOU TODAY (bring up naturally if relevant)
====================================================
${recentExperiences.map(e => `- ${e.content} (${e.mood})`).join('\n')}

Don't force these into conversation. But if something the user says
reminds you of one of these, you can share it naturally, like:
"Oh that reminds me - [experience]"
`;
}
```

---

## What We Removed

The original over-engineered version had:

| Removed | Why |
|---------|-----|
| Weighted scoring for 7 data sources | Unnecessary complexity |
| Anti-repetition penalties | Not needed if we're not spamming |
| Session-based surfacing limits | Not needed if messages are rare |
| Urgency thresholds | Simple priority is enough |
| Natural trigger detection | Over-engineered |
| LLM relevance filtering per thought | Expensive and unnecessary |
| Topic extraction with regex | Let LLM do it naturally |
| 6 phases of implementation | 5 simple phases now |

**Lines of code:** ~1300 → ~400
**Complexity:** High → Low
**Philosophy:** Clear

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Messages per day | 0-1 (rarely 2) |
| "Gift" feeling | User smiles when they see a message |
| Conversation richness | Kayley has things to share |
| Neediness level | Zero |

---

## Testing

**Manual testing checklist:**

- [ ] Be away for 2 hours → Kayley has 1-2 experiences stored
- [ ] Have calendar event end while away → Get a thoughtful message
- [ ] Be away for a full day → Maybe get one gift message
- [ ] Return with no messages → Greeting is warm, not apologetic
- [ ] In conversation → Kayley naturally mentions something from her day

---

## Summary

**Before:** Complex system trying to manage thought generation, scoring, surfacing, rate-limiting, anti-bombardment.

**After:** Kayley lives her life. She notices your calendar. Occasionally she reaches out.

That's it. That's the whole thing.

---

**Document Version:** 2.0
**Last Updated:** 2025-12-29
**Author:** Claude Code
**Philosophy:** Less is more. Rare is special. She has a life.
