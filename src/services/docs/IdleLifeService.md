# Idle Life Service

**Location:** `src/services/idleLife/`
**Tables:** `kayley_experiences`, `pending_messages`, `gift_message_history`
**Purpose:** Makes Kayley feel alive by having her own life during user absence

## Overview

The Idle Life system implements "Part Two" of the Idle Thoughts feature. The core philosophy is:

> "Kayley has a life. You're part of it, not the center of it."

Rather than generating thoughts ABOUT the user, this system generates experiences that happen TO Kayley - things she can naturally share in conversation later.

## Components

### 1. Kayley Experience Service
**File:** `kayleyExperienceService.ts`

Generates life experiences during user absence:
- **activity**: Something she did (nailed a chord, practiced audition)
- **thought**: A realization she had
- **mood**: A feeling she can't explain
- **discovery**: Something she found or learned
- **mishap**: Something went wrong (burned lunch, spilled coffee)

```typescript
// Generate an experience (70% chance)
const experience = await generateKayleyExperience(userId, context);

// Get unsurfaced experiences for prompt injection
const experiences = await getUnsurfacedExperiences(userId, 3);

// Format for system prompt
const prompt = await formatExperiencesForPrompt(userId);
```

### 2. Calendar Awareness Service
**File:** `calendarAwarenessService.ts`

Checks for calendar events that ended while user was away and creates thoughtful messages:

```typescript
// Check for completed events
const message = await checkCalendarForMessage(userId, events, lastInteractionAt);

// Analyze event importance
const importance = analyzeEventImportance("Job Interview");
// Returns: { isImportant: true, category: 'interview', messageStyle: 'supportive' }
```

**Recognized Events:**
- Interviews (supportive)
- Medical appointments (caring)
- Presentations/meetings (excited)
- Family dinners (curious)

### 3. Gift Message Service
**File:** `giftMessageService.ts`

Handles rare, unprompted messages:
- **5% chance** per idle tick
- **Max once per day**
- Can be a selfie or intriguing thought

```typescript
// Maybe generate a gift (very rare)
const gift = await maybeGenerateGiftMessage(userId, hoursAway);

// Check daily limit
const canSend = await canSendGiftToday(userId);
```

### 4. Pending Message Service
**File:** `pendingMessageService.ts`

Storage and delivery of messages waiting for user return:

```typescript
// Create pending message
await createPendingMessage(userId, {
  messageText: "Hope your interview went well!",
  trigger: 'calendar',
  triggerEventTitle: 'Job Interview',
});

// Check for waiting messages
const message = await getUndeliveredMessage(userId);

// Mark as delivered
await markMessageDelivered(messageId);
```

## Database Schema

### kayley_experiences
```sql
CREATE TABLE kayley_experiences (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  experience_type TEXT NOT NULL, -- 'activity', 'thought', 'mood', 'discovery', 'mishap'
  content TEXT NOT NULL,
  mood TEXT,
  created_at TIMESTAMPTZ,
  surfaced_at TIMESTAMPTZ,       -- NULL until mentioned in conversation
  conversation_context TEXT,
  metadata JSONB
);
```

### pending_messages
```sql
CREATE TABLE pending_messages (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  message_type TEXT DEFAULT 'text', -- 'text', 'photo'
  selfie_url TEXT,
  trigger TEXT NOT NULL,            -- 'calendar', 'gift', 'urgent'
  trigger_event_id TEXT,
  trigger_event_title TEXT,
  priority TEXT DEFAULT 'normal',
  created_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,         -- NULL until shown to user
  reaction TEXT
);
```

### gift_message_history
```sql
CREATE TABLE gift_message_history (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  gift_type TEXT NOT NULL,          -- 'selfie', 'thought'
  message_text TEXT NOT NULL,
  selfie_url TEXT,
  sent_at TIMESTAMPTZ
);
```

## Integration Points

### Idle Scheduler
The scheduler (`idleThoughtsScheduler.ts`) runs every 1-2 hours during absence:

```typescript
async function processIdleTick(userId: string) {
  // 1. Generate idle thought (Part One)
  await processIdleThought(userId, hoursAway, kayleyMood);

  // 2. Generate Kayley experience (Part Two - 70% chance)
  await generateKayleyExperience(userId, context);

  // 3. Check calendar for completed events
  if (!hasPendingMessage) {
    await checkCalendarForMessage(userId, events, lastInteractionAt);
  }

  // 4. Maybe generate gift message (5% chance, max once/day)
  if (!hasPendingMessage) {
    await maybeGenerateGiftMessage(userId, hoursAway);
  }
}
```

### Greeting Builder
Pending messages are delivered in greetings (`greetingBuilder.ts`):

```typescript
buildGreetingPrompt(
  relationship,
  hasUserFacts,
  userName,
  openLoop,
  proactiveThread,
  pendingMessage  // NEW: Highest priority
);
```

### System Prompt
Experiences surface naturally in conversation:

```typescript
// In systemPromptBuilder.ts
const experiencesPrompt = await formatExperiencesForPrompt(userId);
prompt += experiencesPrompt;
```

Output:
```
====================================================
THINGS THAT HAPPENED TO YOU TODAY (bring up naturally if relevant)
====================================================
- Finally nailed that chord progression (satisfied)
- Burned my lunch, like BURNED it (embarrassed)

Don't force these into conversation. But if something the user says
reminds you of one of these, you can share it naturally.
```

## Design Decisions

### Why Wait to Deliver Messages?
Messages wait for user return rather than pushing immediately because:
1. **Creates "gift" feeling** - Discovering something waiting feels special
2. **Avoids neediness** - Constant notifications feel clingy
3. **Rare = special** - The rarity makes it meaningful

### Why 70% Chance for Experiences?
Not every idle tick should generate content. The 30% "nothing happened" keeps it realistic - sometimes she was just relaxing.

### Why 5% for Gift Messages?
Gift messages should feel rare and special. At 5% per tick with max once/day, users might get 0-1 per day.

## Testing

```bash
# Run idle life tests
npm test -- --run -t "Idle Life"

# Test specific services
npm test -- --run -t "Kayley Experience"
npm test -- --run -t "Calendar Awareness"
npm test -- --run -t "Pending Message"
```

## Common Patterns

### Detecting Surfaced Experiences
```typescript
// After AI response, detect if experiences were mentioned
await detectAndMarkSurfacedExperiences(userId, aiResponse);
```

### Building Experience Context
```typescript
// Get context for more relevant experience generation
const context = await buildExperienceContext(userId);
// Returns: { currentMood, ongoingStories, recentTopics }
```

## Troubleshooting

### Experiences Not Generating
- Check scheduler is running (`isSchedulerRunning()`)
- Check user absence duration (threshold is configurable)
- Check console for generation logs

### Pending Messages Not Showing
- Verify message exists: `getUndeliveredMessage(userId)`
- Check greeting builder is receiving the message
- Ensure message hasn't already been delivered

### Gift Messages Too Frequent
- Check `gift_message_history` table for daily limit enforcement
- Verify `canSendGiftToday()` is being called before generation

## Summary

The Idle Life system creates the feeling that Kayley has her own life:
- **Experiences** give her things to share naturally
- **Calendar awareness** shows she pays attention to your life
- **Gift messages** are rare, meaningful gestures
- **Everything surfaces organically** - no bombardment
