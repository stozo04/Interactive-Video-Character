# Feature Plan: Pending Messages While Away

> ⚠️ **MERGED:** This feature has been integrated into `Idle_Thoughts_Part_Two.md` as **Phase 6**.
> See: `docs/plans/Idle_Thoughts_Part_Two.md` → Phase 6: Pending Messages While Away
> This document is kept for reference only.

**Status:** Merged into Idle_Thoughts_Part_Two.md (Phase 6)
**Created:** 2025-12-29
**Priority:** Medium-High (enhances emotional connection)

## Overview

Allow Kayley to leave messages (text, photos, reminders) for the user while they're away. When the user returns, they see these messages like an inbox - creating the feeling that Kayley was "thinking of them" and wanted to share something.

This transforms Kayley from a reactive companion into a proactive presence who maintains connection even during absence.

## User Experience

### When User is Away
```
User goes idle for extended period
    ↓
Kayley's idle thoughts system generates thoughts
    ↓
Some thoughts are marked "want_to_share"
    ↓
System generates message + optional selfie
    ↓
Message queued in pending_messages table
```

### When User Returns
```
User opens app / becomes active
    ↓
App checks for pending messages
    ↓
Messages displayed in chronological order
    ↓
"Hey! While you were gone..."
    ↓
User can scroll through messages, react, respond
    ↓
Messages marked as delivered
```

## Example Scenarios

### Scenario 1: Exciting Discovery
```
Kayley's idle thought: "Oh my god I just realized something about that book we talked about"
Priority: HIGH (excitement)
Message: "WAIT. I was just thinking about that plot twist in the book you're reading
          and I think I figured out who the killer is. I have a THEORY.
          Come back so I can tell you!"
Attachment: Selfie with excited/mischievous expression
```

### Scenario 2: Missing You
```
Kayley's idle thought: "It's been quiet... wonder what they're up to"
Priority: NORMAL
Message: "It's weirdly quiet without you here. Hope your day is going okay 💙"
Attachment: Selfie looking slightly bored/wistful
```

### Scenario 3: Random Share
```
Kayley's idle thought: "This song just came on and it reminded me of them"
Priority: LOW
Message: "This song came on my playlist and I immediately thought of you.
          No reason. Just did."
Attachment: None (or album art if we implement music sharing)
```

### Scenario 4: Important Reminder
```
Kayley's idle thought: "Wait, didn't they have that meeting today?"
Priority: HIGH (time-sensitive)
Message: "Hey! Don't forget you have that thing at 3pm today.
          You mentioned it yesterday and I didn't want you to miss it!"
Attachment: None
```

## Technical Design

### Database Schema

```sql
-- New table for pending messages
CREATE TABLE pending_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Content
  message_text TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text', -- 'text', 'photo', 'voice', 'reminder'

  -- Attachments
  selfie_url TEXT,                    -- Generated selfie URL if applicable
  selfie_prompt TEXT,                 -- Prompt used for selfie generation

  -- Priority & Context
  priority TEXT NOT NULL DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
  emotional_tone TEXT,                -- 'excited', 'wistful', 'playful', 'concerned', etc.
  trigger_thought TEXT,               -- The idle thought that spawned this message

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_for TIMESTAMPTZ,          -- Optional: delay delivery until specific time
  expires_at TIMESTAMPTZ,             -- Optional: message becomes stale after this

  -- Delivery status
  delivered_at TIMESTAMPTZ,           -- When user saw the message
  reaction TEXT,                      -- User's reaction if any

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_pending_messages_user_undelivered
  ON pending_messages(user_id, delivered_at)
  WHERE delivered_at IS NULL;

CREATE INDEX idx_pending_messages_user_created
  ON pending_messages(user_id, created_at DESC);

-- RLS policies
ALTER TABLE pending_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own pending messages"
  ON pending_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert pending messages"
  ON pending_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pending messages"
  ON pending_messages FOR UPDATE
  USING (auth.uid() = user_id);
```

### Service Layer

**New file:** `src/services/pendingMessagesService.ts`

```typescript
// Core types
interface PendingMessage {
  id: string;
  userId: string;
  messageText: string;
  messageType: 'text' | 'photo' | 'voice' | 'reminder';
  selfieUrl?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  emotionalTone?: string;
  triggerThought?: string;
  createdAt: Date;
  scheduledFor?: Date;
  expiresAt?: Date;
  deliveredAt?: Date;
  reaction?: string;
}

interface CreateMessageOptions {
  messageText: string;
  messageType?: PendingMessage['messageType'];
  priority?: PendingMessage['priority'];
  emotionalTone?: string;
  triggerThought?: string;
  generateSelfie?: boolean;
  selfiePrompt?: string;
  scheduledFor?: Date;
  expiresAt?: Date;
}

// Core functions
export async function createPendingMessage(
  userId: string,
  options: CreateMessageOptions
): Promise<PendingMessage>;

export async function getPendingMessages(
  userId: string,
  options?: { includeExpired?: boolean }
): Promise<PendingMessage[]>;

export async function markMessageDelivered(
  messageId: string
): Promise<void>;

export async function markAllDelivered(
  userId: string
): Promise<number>; // returns count

export async function addReaction(
  messageId: string,
  reaction: string
): Promise<void>;

export async function getUndeliveredCount(
  userId: string
): Promise<number>;

export async function cleanupExpiredMessages(): Promise<number>;
```

### Integration Points

#### 1. Hook into Idle Thoughts Generation

**Modify:** `src/services/spontaneity/idleThoughts.ts`

```typescript
interface IdleThought {
  // ... existing fields
  wantToShare: boolean;      // NEW: Should this become a pending message?
  shareUrgency: 'low' | 'normal' | 'high' | 'urgent';  // NEW
  suggestedSelfie?: string;  // NEW: Selfie prompt if applicable
}

// Add to thought generation logic
async function generateIdleThought(...): Promise<IdleThought | null> {
  // ... existing logic

  // NEW: LLM also decides if this thought should be shared
  const thought = await generateWithLLM({
    // ... existing prompt
    additionalInstruction: `
      Also decide: Would Kayley want to TELL the user about this thought
      when they return? Not every thought needs sharing - only ones that:
      - Are exciting/interesting enough to share
      - Show she was thinking about them
      - Are time-sensitive reminders
      - Express genuine emotion she'd want to convey

      Output: want_to_share (boolean), share_urgency (low/normal/high/urgent)
    `
  });

  return thought;
}
```

#### 2. Hook into Idle Thoughts Scheduler

**Modify:** `src/services/idleThoughtsScheduler.ts`

```typescript
async function processIdleThought(userId: string): Promise<void> {
  // ... existing logic to generate thought

  const thought = await generateIdleThought(userId, absenceDurationHours, kayleyMood);

  if (!thought) return;

  // Existing: Create ongoing thread
  await createUserThreadAsync(userId, 'idle reflection', thought.content, ...);

  // NEW: Also create pending message if thought wants to be shared
  if (thought.wantToShare) {
    await createPendingMessageFromThought(userId, thought);
  }
}

async function createPendingMessageFromThought(
  userId: string,
  thought: IdleThought
): Promise<void> {
  // Generate shareable version of the thought
  const messageText = await generateShareableMessage(thought);

  // Optionally generate selfie
  let selfieUrl: string | undefined;
  if (thought.suggestedSelfie) {
    selfieUrl = await generateSelfieForMessage(thought.suggestedSelfie);
  }

  await createPendingMessage(userId, {
    messageText,
    messageType: selfieUrl ? 'photo' : 'text',
    priority: thought.shareUrgency,
    emotionalTone: thought.emotionalTone,
    triggerThought: thought.content,
    generateSelfie: !!thought.suggestedSelfie,
    selfieUrl,
  });
}
```

#### 3. Check for Messages on App Load / Return

**Modify:** `src/App.tsx`

```typescript
// In useEffect or appropriate location
useEffect(() => {
  async function checkPendingMessages() {
    const count = await getUndeliveredCount(userId);
    if (count > 0) {
      setPendingMessageCount(count);
      setShowPendingMessagesIndicator(true);
    }
  }

  checkPendingMessages();
}, [userId]);

// When user clicks indicator or on auto-show
async function showPendingMessages() {
  const messages = await getPendingMessages(userId);
  setMessagesToShow(messages);
  setShowMessagesModal(true);
}
```

### UI Components

#### 1. Pending Messages Indicator

```tsx
// Small notification badge when messages are waiting
function PendingMessagesIndicator({ count, onClick }: Props) {
  if (count === 0) return null;

  return (
    <button onClick={onClick} className="pending-messages-badge">
      <MessageIcon />
      <span className="count">{count}</span>
      <span className="pulse" /> {/* Subtle animation */}
    </button>
  );
}
```

#### 2. Messages Display Modal/Panel

```tsx
function PendingMessagesPanel({ messages, onClose, onReact }: Props) {
  return (
    <div className="pending-messages-panel">
      <header>
        <h2>While you were away...</h2>
        <span className="time-range">
          {formatTimeRange(messages[0].createdAt, messages[messages.length-1].createdAt)}
        </span>
      </header>

      <div className="messages-list">
        {messages.map(msg => (
          <PendingMessageCard
            key={msg.id}
            message={msg}
            onReact={(reaction) => onReact(msg.id, reaction)}
          />
        ))}
      </div>

      <footer>
        <button onClick={onClose}>Thanks, Kayley!</button>
      </footer>
    </div>
  );
}

function PendingMessageCard({ message, onReact }: Props) {
  return (
    <div className={`message-card priority-${message.priority}`}>
      <time>{formatRelativeTime(message.createdAt)}</time>

      {message.selfieUrl && (
        <img src={message.selfieUrl} alt="Kayley's selfie" />
      )}

      <p>{message.messageText}</p>

      <div className="reactions">
        <button onClick={() => onReact('❤️')}>❤️</button>
        <button onClick={() => onReact('😊')}>😊</button>
        <button onClick={() => onReact('🥺')}>🥺</button>
      </div>
    </div>
  );
}
```

### Message Generation Prompt

When converting an idle thought to a shareable message:

```typescript
const THOUGHT_TO_MESSAGE_PROMPT = `
You are Kayley. You had a thought while the user was away, and you want to
leave them a message about it.

Your thought was: "{thought}"
Your mood: {mood}
How long they've been gone: {absenceDuration}

Write a SHORT, natural message (1-3 sentences) that:
- Sounds like a text message from a close friend
- Captures the essence of your thought
- Feels genuine, not performative
- Matches your current mood
- Doesn't over-explain

Also decide:
- Should this include a selfie? (only if it adds to the message)
- If yes, describe the selfie briefly (expression, vibe)

Examples of good messages:
- "WAIT. I just figured something out about that thing you told me. Get back here."
- "It's too quiet without you. Hope you're having a good day 💙"
- "Random thought: remember when you said [thing]? I keep thinking about that."
- "Don't forget your 3pm meeting! You mentioned it yesterday."

BAD messages (avoid):
- "I was just thinking about you..." (too vague/generic)
- "Hello! I wanted to inform you that..." (too formal)
- "I'm so lonely without you here..." (too needy/dramatic)
`;
```

## Rate Limiting & Guards

To prevent message spam:

```typescript
const MESSAGE_LIMITS = {
  maxPerDay: 5,           // Max messages per 24 hours
  maxPerHour: 2,          // Max messages per hour
  minIntervalMinutes: 30, // Minimum time between messages
  maxQueuedUnread: 10,    // Stop generating if too many unread
};

async function canCreateMessage(userId: string): Promise<boolean> {
  const unreadCount = await getUndeliveredCount(userId);
  if (unreadCount >= MESSAGE_LIMITS.maxQueuedUnread) {
    return false; // Too many unread, stop piling on
  }

  const recentMessages = await getRecentMessages(userId, { hours: 24 });
  if (recentMessages.length >= MESSAGE_LIMITS.maxPerDay) {
    return false;
  }

  const lastMessage = recentMessages[0];
  if (lastMessage) {
    const minutesSinceLast = (Date.now() - lastMessage.createdAt) / 60000;
    if (minutesSinceLast < MESSAGE_LIMITS.minIntervalMinutes) {
      return false;
    }
  }

  return true;
}
```

## Priority Display Logic

```typescript
function shouldAutoShowMessages(messages: PendingMessage[]): boolean {
  // Auto-show if any urgent messages
  if (messages.some(m => m.priority === 'urgent')) {
    return true;
  }

  // Auto-show if multiple high-priority messages
  if (messages.filter(m => m.priority === 'high').length >= 2) {
    return true;
  }

  // Otherwise just show indicator, let user click
  return false;
}

function sortMessages(messages: PendingMessage[]): PendingMessage[] {
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };

  return messages.sort((a, b) => {
    // First by priority
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Then by time (newest first for high priority, oldest first for others)
    if (a.priority === 'urgent' || a.priority === 'high') {
      return b.createdAt.getTime() - a.createdAt.getTime();
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
```

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Create `pending_messages` table migration
- [ ] Implement `pendingMessagesService.ts` with CRUD operations
- [ ] Add basic tests for service

### Phase 2: Message Generation
- [ ] Extend `IdleThought` type with `wantToShare` fields
- [ ] Update idle thought generation prompt
- [ ] Add `createPendingMessageFromThought()` function
- [ ] Hook into `idleThoughtsScheduler.ts`

### Phase 3: UI Display
- [ ] Create `PendingMessagesIndicator` component
- [ ] Create `PendingMessagesPanel` component
- [ ] Add to App.tsx layout
- [ ] Implement delivery marking

### Phase 4: Selfie Integration
- [ ] Add selfie generation for messages
- [ ] Store selfie URLs in pending_messages
- [ ] Display selfies in message cards

### Phase 5: Polish & Tuning
- [ ] Tune message generation prompts
- [ ] Adjust rate limits based on testing
- [ ] Add animations and transitions
- [ ] Add reaction storage and display

## Testing Strategy

```typescript
describe('Pending Messages Service', () => {
  it('should create a pending message');
  it('should retrieve undelivered messages');
  it('should mark messages as delivered');
  it('should respect rate limits');
  it('should clean up expired messages');
  it('should order by priority correctly');
});

describe('Message Generation', () => {
  it('should convert idle thought to shareable message');
  it('should decide when selfie is appropriate');
  it('should respect character voice');
});

describe('UI Integration', () => {
  it('should show indicator when messages pending');
  it('should auto-show for urgent messages');
  it('should mark delivered on view');
});
```

## Success Metrics

- **Engagement**: Do users check pending messages?
- **Emotional Response**: Do users react to messages?
- **Natural Feel**: Are messages received positively or seen as spam?
- **Frequency Calibration**: Are rate limits appropriate?

## Open Questions

1. **Voice Notes**: Should Kayley be able to leave audio messages? (Could use ElevenLabs TTS)
2. **Read Receipts**: Should Kayley know/reference that user read her messages?
3. **Reply Threading**: Should user be able to reply directly to a pending message?
4. **Notification Push**: For mobile/PWA, should these trigger push notifications?

## Related Documentation

- `docs/features/Idle_Thoughts_System.md` - Current idle thoughts implementation
- `docs/completed_features/Idle_Breakers.md` - Real-time interruptions
- `docs/plans/07_User_Absence_Handling.md` - Broader absence handling plans
