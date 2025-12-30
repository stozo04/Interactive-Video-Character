# Pending Message Service

**File:** `src/services/idleLife/pendingMessageService.ts`
**Table:** `pending_messages`
**Purpose:** Manages messages waiting for user return, creating the "gift" experience

## Overview

The Pending Message Service is the storage and delivery system for messages that wait for the user. Instead of sending messages immediately (which would feel interruptive or needy), messages are stored and delivered when the user returns - creating a "gift" feeling.

### Philosophy

> "These are RARE and SPECIAL. Not spam. One message waiting feels like a gift. Multiple messages feel like an inbox of obligations."

## Message Types

Messages are categorized by their trigger:

| Trigger | Source | Priority | Example |
|---------|--------|----------|---------|
| `calendar` | CalendarAwarenessService | normal | "Hope your interview went well!" |
| `gift` | GiftMessageService | low | "Thought you might need this to get through your afternoon" |
| `urgent` | Future use | high | Reserved for time-sensitive messages |

### Message Content Types

| Type | Description | Has Selfie |
|------|-------------|------------|
| `text` | Text-only message | No |
| `photo` | Message with selfie | Yes (generated at delivery) |

### Priority Levels

| Priority | Sorting | Use Case |
|----------|---------|----------|
| `high` | First | Urgent/time-sensitive |
| `normal` | Second | Calendar-triggered |
| `low` | Last | Gift messages |

## Table Schema

```sql
CREATE TABLE pending_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Message content
  message_text TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (
    message_type IN ('text', 'photo')
  ),
  selfie_url TEXT,

  -- Trigger info
  trigger TEXT NOT NULL CHECK (
    trigger IN ('calendar', 'gift', 'urgent')
  ),
  trigger_event_id TEXT,     -- Calendar event ID if applicable
  trigger_event_title TEXT,  -- Calendar event title
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (
    priority IN ('low', 'normal', 'high')
  ),

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,  -- NULL until shown to user
  reaction TEXT,             -- User's reaction after delivery

  -- Extra data
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for finding undelivered messages
CREATE INDEX idx_pending_messages_undelivered
  ON pending_messages(user_id)
  WHERE delivered_at IS NULL;
```

## Service Functions

### createPendingMessage

Creates a new message to wait for user return.

```typescript
async function createPendingMessage(
  userId: string,
  input: CreatePendingMessageInput
): Promise<PendingMessage>
```

**Input Type:**
```typescript
interface CreatePendingMessageInput {
  messageText: string;
  messageType?: MessageType;     // defaults to 'text'
  selfieUrl?: string;
  trigger: MessageTrigger;
  triggerEventId?: string;
  triggerEventTitle?: string;
  priority?: MessagePriority;    // defaults to 'normal'
  metadata?: Record<string, unknown>;
}
```

**Example:**
```typescript
const message = await createPendingMessage(userId, {
  messageText: "Hope your interview went well! Can't wait to hear all about it",
  trigger: 'calendar',
  triggerEventId: 'event-123',
  triggerEventTitle: 'Job Interview',
  priority: 'normal',
});
```

### getUndeliveredMessage

Gets the next message to show the user (highest priority, oldest first).

```typescript
async function getUndeliveredMessage(userId: string): Promise<PendingMessage | null>
```

**Returns:**
```typescript
{
  id: 'uuid',
  userId: 'user-123',
  messageText: "Hope your interview went well!",
  messageType: 'text',
  trigger: 'calendar',
  triggerEventTitle: 'Job Interview',
  priority: 'normal',
  createdAt: Date,
  // deliveredAt is undefined (not yet delivered)
}
```

**Sorting Logic:**
1. Priority: high > normal > low
2. Creation time: oldest first (FIFO within priority)

### hasUndeliveredMessage

Quick check if any message is waiting (used to prevent creating duplicates).

```typescript
async function hasUndeliveredMessage(userId: string): Promise<boolean>
```

**Example:**
```typescript
const hasPending = await hasUndeliveredMessage(userId);
if (!hasPending) {
  // Safe to create a new message
  await createPendingMessage(userId, {...});
}
```

### markMessageDelivered

Marks a message as shown to the user.

```typescript
async function markMessageDelivered(messageId: string): Promise<void>
```

**Example:**
```typescript
// After showing message in greeting
await markMessageDelivered(pendingMessage.id);
```

### recordMessageReaction

Records how the user reacted to a message (for analytics/tuning).

```typescript
async function recordMessageReaction(
  messageId: string,
  reaction: 'positive' | 'neutral' | 'negative'
): Promise<void>
```

**Example:**
```typescript
// If user engages positively with message
await recordMessageReaction(messageId, 'positive');
```

### getAllUndeliveredMessages

Gets all waiting messages (for admin/debug purposes).

```typescript
async function getAllUndeliveredMessages(userId: string): Promise<PendingMessage[]>
```

### cleanupDeliveredMessages

Removes old delivered messages (cleanup, called periodically).

```typescript
async function cleanupDeliveredMessages(userId: string): Promise<void>
```

**Behavior:**
- Deletes delivered messages older than 7 days
- Keeps undelivered messages indefinitely (until delivered)

## Integration Points

### Creating Messages

Messages are created by other services:

```typescript
// CalendarAwarenessService
const calendarMsg = await checkCalendarForMessage(userId, events, lastInteraction);
if (calendarMsg) {
  await createPendingMessage(userId, calendarMsg);
}

// GiftMessageService
const giftMsg = await maybeGenerateGiftMessage(userId, hoursAway);
if (giftMsg) {
  await createPendingMessage(userId, giftMsg);
}
```

### Delivering Messages (Greeting Builder)

```typescript
// In greetingBuilder.ts
const pendingMessage = await getUndeliveredMessage(userId);
if (pendingMessage) {
  // Include message in greeting prompt
  // Message gets highest priority
}
```

### Idle Scheduler Flow

```typescript
// In idleThoughtsScheduler.ts
const hasPending = await hasUndeliveredMessage(userId);
if (!hasPending) {
  // Calendar check
  const calendarMsg = await checkCalendarForMessage(...);
  if (calendarMsg) {
    await createPendingMessage(userId, calendarMsg);
    return; // One message max
  }

  // Gift check (only if no calendar message)
  const giftMsg = await maybeGenerateGiftMessage(...);
  if (giftMsg) {
    await createPendingMessage(userId, giftMsg);
  }
}
```

## Key Design Decisions

### Why Wait for User Return?

Messages wait instead of sending immediately because:

1. **Gift feeling** - Something waiting for you feels special
2. **Not interruptive** - Doesn't pull you away from what you're doing
3. **Not needy** - "I miss you" messages feel clingy; "I was thinking about your interview" feels caring
4. **Natural timing** - Message arrives when you're ready to engage

### Why One Message at a Time?

Multiple messages piling up creates:
- Inbox overwhelm
- Obligation feeling
- Reduced specialness

One thoughtful message is a gift. Five messages is homework.

### Why Priority System?

Not all messages are equal:
- **Urgent** (high): Time-sensitive, show first
- **Calendar** (normal): Contextual, usually most relevant
- **Gift** (low): Nice-to-have, don't compete with calendar

### Why Track Reactions?

Recording reactions enables future optimization:
- Which message styles work best?
- Is gift frequency right?
- Are calendar messages appreciated?

## Message Lifecycle

```
Message Created
    │
    ├── trigger = 'calendar' (priority: normal)
    ├── trigger = 'gift' (priority: low)
    └── trigger = 'urgent' (priority: high)
    │
    ▼
Stored in pending_messages
    │ (delivered_at = NULL)
    │
    ▼
User Returns
    │
    ▼
getUndeliveredMessage() called
    │
    ├── Returns highest priority, oldest message
    │
    ▼
Message shown in greeting
    │
    ▼
markMessageDelivered() called
    │ (delivered_at = NOW())
    │
    ▼
[Optional] recordMessageReaction()
    │
    ▼
cleanupDeliveredMessages() (after 7 days)
```

## Testing

```bash
# Run pending message tests
npm test -- --run -t "Pending Message"
```

### Test Cases

```typescript
// Should create message
const msg = await createPendingMessage(userId, {
  messageText: "Test message",
  trigger: 'calendar',
});
expect(msg.id).toBeDefined();

// Should retrieve by priority
await createPendingMessage(userId, { trigger: 'gift', priority: 'low', ... });
await createPendingMessage(userId, { trigger: 'calendar', priority: 'normal', ... });
const next = await getUndeliveredMessage(userId);
expect(next.priority).toBe('normal'); // Higher priority first

// Should mark as delivered
await markMessageDelivered(msg.id);
const after = await getUndeliveredMessage(userId);
expect(after).toBeNull(); // No more waiting
```

## Troubleshooting

### Messages Not Appearing

1. **Check message exists**: `await getAllUndeliveredMessages(userId)`
2. **Check greeting builder integration**: Verify `getUndeliveredMessage` is called
3. **Check delivery**: Was `markMessageDelivered` called prematurely?

### Too Many Messages Waiting

- This shouldn't happen - `hasUndeliveredMessage` check prevents new messages
- If it does: `hasUndeliveredMessage` check might be failing
- Check: Are multiple services creating without checking?

### Messages Not Being Cleaned Up

- Cleanup only removes delivered messages (7+ days old)
- Undelivered messages stay until delivered
- Call `cleanupDeliveredMessages` periodically (e.g., on app init)

### Priority Not Working

- Verify `priority` field is set correctly
- Check: Are you passing `priority` in `CreatePendingMessageInput`?
- Default is 'normal' if not specified

## Constants

```typescript
const PENDING_MESSAGES_TABLE = 'pending_messages';
const CLEANUP_AFTER_DAYS = 7;  // Days before delivered messages are deleted
```

## Related Services

- **CalendarAwarenessService** - Creates calendar-triggered messages
- **GiftMessageService** - Creates rare gift messages
- **Greeting Builder** - Delivers messages when user returns
- **Idle Scheduler** - Orchestrates message creation during idle time

## Example User Experience

**Scenario:** User has interview at 2pm, returns at 4pm

```
2:00 PM - User leaves, interview starts
    │
3:00 PM - Interview ends
    │
3:30 PM - Idle tick runs
    │     → Calendar check sees "Job Interview" ended
    │     → Creates pending message: "Hope your interview went well!"
    │
4:00 PM - User returns
    │     → getUndeliveredMessage() returns the message
    │     → Greeting includes: "Hope your interview went well! Can't wait to hear all about it"
    │     → markMessageDelivered() called
    │
User feels: "She remembered my interview. That's sweet."
```
