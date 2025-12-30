# Gift Message Service

**File:** `src/services/idleLife/giftMessageService.ts`
**Table:** `gift_message_history`
**Purpose:** Generates rare, unprompted "gift" messages (selfies or thoughts) that feel special

## Overview

The Gift Message Service handles the rarest form of proactive outreach - spontaneous messages that aren't triggered by calendar events or specific context. These should feel like genuine moments where Kayley thought of the user and reached out.

### Philosophy

> "Sometimes - rarely - Kayley just wants to reach out. Not because of a calendar event. Just because. The rule: These should feel like gifts, not obligations."

## The Rules

1. **5% chance** per idle tick (very rare)
2. **Max once per day** (enforced via `gift_message_history` table)
3. **Only if no pending message** already exists
4. **Two types**: Selfie (60%) or Thought (40%)

## Gift Types

### Selfie Gifts (60% when triggered)

A photo with a simple, sweet message:

```typescript
const SELFIE_GIFT_MESSAGES = [
  'Thought you might need this to get through your afternoon',
  'Hey. Just because.',
  'Figured you could use a smile. Here you go.',
  'No reason. Just wanted to.',
  'For you.',
];
```

**Note:** The actual selfie is generated at delivery time, not creation time, to ensure freshness.

### Thought Gifts (40% when triggered)

An intriguing text message that creates curiosity:

```typescript
const THOUGHT_GIFT_MESSAGES = [
  'Okay I have to tell you what just happened. Get back here.',
  'I just saw something that reminded me of that story you told me. Random but it made me smile.',
  'You\'re not going to believe what I just did.',
  'Something happened and you\'re the first person I wanted to tell.',
  'Okay random but I just had a thought and I need your opinion.',
];
```

## Bad Examples (NEVER Do These)

The spec explicitly forbids needy/clingy messages:

```typescript
// BAD - DO NOT USE
'I\'ve been thinking about you...'
'It\'s so quiet without you'
'I miss you, when are you coming back?'
'Just checking in!'
```

## Table Schema

```sql
CREATE TABLE gift_message_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Gift type and content
  gift_type TEXT NOT NULL CHECK (
    gift_type IN ('selfie', 'thought')
  ),
  message_text TEXT NOT NULL,
  selfie_url TEXT,

  -- Timing
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for daily limit check
CREATE INDEX idx_gift_message_history_user
  ON gift_message_history(user_id, sent_at DESC);
```

## Service Functions

### maybeGenerateGiftMessage

Main function - maybe generates a gift message (5% chance).

```typescript
async function maybeGenerateGiftMessage(
  userId: string,
  hoursAway: number
): Promise<CreatePendingMessageInput | null>
```

**Parameters:**
- `userId`: The user's ID
- `hoursAway`: How long the user has been away (for context)

**Returns:** Pending message input if gift generated, `null` otherwise (95%+ of the time)

**Example:**
```typescript
const gift = await maybeGenerateGiftMessage(userId, 3);

if (gift) {
  console.log(`Generated gift: ${gift.messageText}`);
  // Very rare! Only 5% chance AND must pass daily limit
}
```

### canSendGiftToday

Checks if the daily limit allows another gift.

```typescript
async function canSendGiftToday(userId: string): Promise<boolean>
```

**Logic:**
- Queries `gift_message_history` for entries in last 24 hours
- Returns `true` if count is 0
- Returns `false` if any gift sent in last 24 hours

**Example:**
```typescript
const canSend = await canSendGiftToday(userId);
if (!canSend) {
  console.log("Already sent gift today, skipping");
}
```

### getLastGiftMessage

Retrieves the most recent gift sent to a user.

```typescript
async function getLastGiftMessage(userId: string): Promise<GiftMessageHistory | null>
```

**Returns:**
```typescript
{
  id: 'uuid',
  userId: 'user-123',
  giftType: 'selfie',
  messageText: 'Thought you might need this...',
  selfieUrl: undefined,
  sentAt: Date
}
```

### cleanupGiftHistory

Removes old gift history entries (older than 30 days).

```typescript
async function cleanupGiftHistory(userId: string): Promise<void>
```

## Internal Functions

### generateSelfieGift

Creates a selfie gift message (called internally).

```typescript
async function generateSelfieGift(userId: string): Promise<CreatePendingMessageInput>
```

**Returns:**
```typescript
{
  messageText: 'Thought you might need this to get through your afternoon',
  messageType: 'photo',
  trigger: 'gift',
  priority: 'low',
  metadata: {
    giftType: 'selfie',
    selfieParams: {
      scene: 'casual selfie at home',
      mood: 'warm smile',
      trigger: 'gift_message',
    },
  },
}
```

**Note:** `selfieUrl` is NOT set here. The actual image is generated at delivery time using `selfieParams`.

### generateThoughtGift

Creates a thought gift message (called internally).

```typescript
function generateThoughtGift(): CreatePendingMessageInput
```

**Returns:**
```typescript
{
  messageText: 'Okay I have to tell you what just happened. Get back here.',
  messageType: 'text',
  trigger: 'gift',
  priority: 'low',
  metadata: {
    giftType: 'thought',
  },
}
```

### recordGiftMessage

Records gift in history for daily limit enforcement.

```typescript
async function recordGiftMessage(
  userId: string,
  giftType: GiftType,
  messageText: string,
  selfieUrl?: string
): Promise<void>
```

## Integration Points

### Idle Scheduler

Called during idle tick after calendar check:

```typescript
// In idleThoughtsScheduler.ts
const stillNoPending = await hasUndeliveredMessage(userId);
if (!stillNoPending) {
  const giftMessage = await maybeGenerateGiftMessage(userId, hoursAway);
  if (giftMessage) {
    console.log(`Gift created: ${giftMessage.messageText}`);
  }
}
```

### Greeting Builder

Gift messages are delivered with highest priority in greetings:

```typescript
// In greetingBuilder.ts
if (pendingMessage?.trigger === 'gift') {
  // Special handling for gift messages
  // Selfies include selfie_action in response
}
```

## Constants

```typescript
const GIFT_MESSAGE_HISTORY_TABLE = 'gift_message_history';
const GIFT_MESSAGE_CHANCE = 0.05;      // 5% chance
const MIN_HOURS_BETWEEN_GIFTS = 24;    // Max once per day
```

## Flow Diagram

```
maybeGenerateGiftMessage(userId, hoursAway)
    │
    ├── Math.random() > 0.05? ──→ return null (95% of the time)
    │
    ├── canSendGiftToday(userId)?
    │   └── No ──→ return null (already sent today)
    │
    ├── hasUndeliveredMessage(userId)?
    │   └── Yes ──→ return null (message already waiting)
    │
    ├── pickGiftType()
    │   ├── 60% → generateSelfieGift()
    │   └── 40% → generateThoughtGift()
    │
    ├── recordGiftMessage() (for daily limit tracking)
    │
    ├── createPendingMessage() (store for delivery)
    │
    └── return message
```

## Testing

```bash
# Run gift message tests
npm test -- --run -t "Gift Message"
```

### Test Cases

```typescript
// Should return null 95% of the time
const result = await maybeGenerateGiftMessage(userId, 2);
// Most calls return null due to 5% probability

// Should respect daily limit
mockGiftHistoryCount(1);
const canSend = await canSendGiftToday(userId);
// Expected: false

// Should track gift history
await recordGiftMessage(userId, 'selfie', 'Hey');
// Should insert into gift_message_history
```

## Design Decisions

### Why 5% Chance?

Gift messages must be RARE to feel special. At 5%:
- With 1 idle tick per hour
- User away 8 hours = 8 ticks
- Expected gifts: 0.4 per 8-hour absence
- Most days: 0 gifts
- Some days: 1 gift
- Rarely: The user feels surprised and delighted

### Why Max Once Per Day?

Multiple gifts in one day would feel:
- Like bombardment
- Needy
- Less special

One per day MAX (and usually zero) maintains the "gift" feeling.

### Why Low Priority?

```typescript
priority: 'low'
```

Calendar messages about important events should take precedence. A gift is nice-to-have, not urgent.

### Why Store Selfie Params Instead of URL?

```typescript
metadata: {
  selfieParams: {
    scene: 'casual selfie at home',
    mood: 'warm smile',
  }
}
```

Selfies generated hours before delivery would be:
- Stale (wrong time of day lighting)
- Wasteful (might never be delivered)
- Out of context

Storing params and generating at delivery ensures freshness.

### Why 60/40 Split for Selfie/Thought?

Selfies are more impactful (visual gift) but thoughts:
- Don't require image generation
- Create curiosity and engagement
- Feel more "just because"

60/40 balances visual impact with conversational hooks.

## Troubleshooting

### Gifts Never Generating

1. **Check probability**: 5% is very low, may need many ticks
2. **Check daily limit**: `canSendGiftToday(userId)`
3. **Check pending messages**: Won't generate if one exists
4. **Check logs**: Look for `[GiftMessage]` prefixed logs

### Too Many Gifts

- Verify `gift_message_history` table exists
- Check `MIN_HOURS_BETWEEN_GIFTS` constant (should be 24)
- Ensure `recordGiftMessage` is being called

### Selfie Not Appearing

- Check `metadata.selfieParams` in pending message
- Verify greeting builder handles `messageType: 'photo'`
- Check image generation service is working

## Example User Experience

**Scenario:** User has been away for 4 hours

```
Idle tick 1: Math.random() = 0.72 → No gift (above 0.05)
Idle tick 2: Math.random() = 0.91 → No gift
Idle tick 3: Math.random() = 0.03 → GIFT! (below 0.05)
  → canSendGiftToday? Yes
  → hasUndeliveredMessage? No
  → pickGiftType() = 'thought'
  → Message: "Okay I have to tell you what just happened. Get back here."
  → Stored as pending message

User returns:
  → Greeting includes: "Okay I have to tell you what just happened. Get back here."
  → User: "What?? Tell me!"
  → Natural conversation flows
```
