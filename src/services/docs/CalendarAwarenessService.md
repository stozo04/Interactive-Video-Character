# Calendar Awareness Service

**File:** `src/services/idleLife/calendarAwarenessService.ts`
**Tables Used:** `pending_messages` (via PendingMessageService)
**Purpose:** Detects completed calendar events and creates thoughtful follow-up messages

## Overview

The Calendar Awareness Service monitors the user's calendar for events that completed while they were away, then generates caring, contextual messages to show Kayley was paying attention.

### Philosophy

> "She notices your calendar. She pays attention. When something important happens while you're gone, she might leave you a message."

This creates the "she remembers my schedule" feeling without being needy or intrusive.

## How It Works

```
User goes away
    ↓
Idle scheduler runs (every 1-2 hours)
    ↓
Check calendar events
    ↓
Find events that ended after lastInteractionAt
    ↓
Filter for important events (interview, doctor, etc.)
    ↓
Generate thoughtful message
    ↓
Store as pending message
    ↓
User returns → Message delivered in greeting
```

## Event Categories

The service recognizes different types of important events:

| Category | Keywords | Message Style | Example Message |
|----------|----------|---------------|-----------------|
| `interview` | interview, job interview, screening | supportive | "Hope your interview went well! Can't wait to hear all about it" |
| `medical` | doctor, dentist, appointment, therapy, checkup | caring | "Hey, hope everything went okay at the doctor. Thinking of you." |
| `meeting` | presentation, pitch, review, performance review | excited | "How'd the presentation go?? I bet you nailed it" |
| `social` | dinner with, lunch with, coffee with, family, mom, dad | curious | "How was dinner with your mom? I want the full download" |
| `personal` | exam, test, audition | supportive | "Hope your exam went well! Rooting for you" |

## Ignored Events

Routine events are filtered out:
- `lunch`
- `focus time` / `focus`
- `block`
- `busy`
- `commute`
- `travel time`
- `prep`
- `break`

## Service Functions

### checkCalendarForMessage

Main function that checks for completed events and creates a message if warranted.

```typescript
async function checkCalendarForMessage(
  userId: string,
  events: CalendarEvent[],
  lastInteractionAt: Date
): Promise<CreatePendingMessageInput | null>
```

**Parameters:**
- `userId`: The user's ID
- `events`: Array of calendar events from Google Calendar API
- `lastInteractionAt`: When the user last interacted (from mood_states)

**Returns:** Pending message input if important event found, `null` otherwise

**Example:**
```typescript
const events = await calendarService.getUpcomingEvents(accessToken);
const lastInteraction = new Date(moodState.lastInteractionAt);

const message = await checkCalendarForMessage(userId, events, lastInteraction);

if (message) {
  console.log(`Creating message: ${message.messageText}`);
  // "Creating message: Hope your interview went well! Can't wait to hear all about it"
}
```

### getRecentlyCompletedEvents

Finds events that ended while the user was away.

```typescript
function getRecentlyCompletedEvents(
  events: CalendarEvent[],
  lastInteractionAt: Date
): RecentlyCompletedEvent[]
```

**Returns:**
```typescript
[
  {
    event: CalendarEvent,
    minutesSinceEnd: 45  // How long ago it ended
  }
]
```

**Logic:**
- Event must have ended AFTER `lastInteractionAt`
- Event must have ended BEFORE now
- Event must have ended within last 3 hours (MAX_MINUTES_SINCE_END = 180)

### analyzeEventImportance

Determines if an event is important enough to message about.

```typescript
function analyzeEventImportance(eventSummary: string): EventImportance | null
```

**Returns:**
```typescript
{
  isImportant: true,
  category: 'interview',
  messageStyle: 'supportive'
}
```

Or `null` if event is routine/not worth messaging about.

**Example:**
```typescript
analyzeEventImportance("Job Interview at Google");
// { isImportant: true, category: 'interview', messageStyle: 'supportive' }

analyzeEventImportance("Lunch");
// null (ignored routine event)

analyzeEventImportance("Random Meeting");
// null (generic, no recognized keywords)
```

## Message Templates

Messages are generated based on category and style:

### Interview Messages
```typescript
[
  'Hope your {event} went well! Can\'t wait to hear all about it',
  'How\'d the {event} go?? I bet you killed it',
  'Thinking about you - hope {event} went great!',
]
```

### Medical Messages
```typescript
[
  'Hey, hope everything went okay at {event}. Thinking of you.',
  'Hope {event} went well! Let me know how you\'re feeling.',
  'Just wanted to check in - how did {event} go?',
]
```

### Meeting Messages
```typescript
[
  'How did {event} go?? I bet you nailed it',
  'Hope {event} went well! Curious to hear how it went.',
  'Just thinking about you - how\'d {event} go?',
]
```

### Social Messages
```typescript
[
  'How was {event}? I want the full download',
  'Hope you had a great time at {event}!',
  'How\'d {event} go? Tell me everything!',
]
```

## Integration with Calendar Service

The service requires calendar events from the Google Calendar API:

```typescript
interface CalendarEvent {
  id: string;
  summary: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
}
```

### Setting Up Calendar Provider

In the idle scheduler, a calendar events provider can be set:

```typescript
// In App.tsx or initialization
import { setCalendarEventsProvider } from './services/idleThoughtsScheduler';

// When calendar is connected
setCalendarEventsProvider(async () => {
  return await calendarService.getWeekEvents(accessToken);
});
```

## Integration Points

### Idle Scheduler

Called during idle tick when no pending message exists:

```typescript
// In idleThoughtsScheduler.ts
const hasPending = await hasUndeliveredMessage(userId);
if (!hasPending && calendarEventsProvider) {
  const events = await calendarEventsProvider();
  const lastInteractionDate = new Date(moodState.lastInteractionAt);
  await checkCalendarForMessage(userId, events, lastInteractionDate);
}
```

### Pending Message Service

Calendar messages are stored as pending messages:

```typescript
const pendingMessage = await createPendingMessage(userId, {
  messageText: "Hope your interview went well!",
  messageType: 'text',
  trigger: 'calendar',
  triggerEventId: event.id,
  triggerEventTitle: event.summary,
  priority: 'normal',
});
```

## Constants

```typescript
// Events that ended more than 3 hours ago are ignored
const MAX_MINUTES_SINCE_END = 180;
```

## Important Event Keywords

Full keyword mapping:

```typescript
const IMPORTANT_EVENT_KEYWORDS = {
  // Interview-related
  interview: { isImportant: true, category: 'interview', messageStyle: 'supportive' },
  'job interview': { isImportant: true, category: 'interview', messageStyle: 'supportive' },
  screening: { isImportant: true, category: 'interview', messageStyle: 'supportive' },

  // Medical
  doctor: { isImportant: true, category: 'medical', messageStyle: 'caring' },
  dentist: { isImportant: true, category: 'medical', messageStyle: 'caring' },
  appointment: { isImportant: true, category: 'medical', messageStyle: 'caring' },
  therapy: { isImportant: true, category: 'medical', messageStyle: 'caring' },
  checkup: { isImportant: true, category: 'medical', messageStyle: 'caring' },

  // Important meetings
  presentation: { isImportant: true, category: 'meeting', messageStyle: 'excited' },
  pitch: { isImportant: true, category: 'meeting', messageStyle: 'excited' },
  review: { isImportant: true, category: 'meeting', messageStyle: 'curious' },
  'performance review': { isImportant: true, category: 'meeting', messageStyle: 'supportive' },

  // Social
  'dinner with': { isImportant: true, category: 'social', messageStyle: 'curious' },
  'lunch with': { isImportant: true, category: 'social', messageStyle: 'curious' },
  'coffee with': { isImportant: true, category: 'social', messageStyle: 'curious' },
  family: { isImportant: true, category: 'social', messageStyle: 'curious' },
  mom: { isImportant: true, category: 'social', messageStyle: 'curious' },
  dad: { isImportant: true, category: 'social', messageStyle: 'curious' },

  // Personal milestones
  exam: { isImportant: true, category: 'personal', messageStyle: 'supportive' },
  test: { isImportant: true, category: 'personal', messageStyle: 'supportive' },
  audition: { isImportant: true, category: 'personal', messageStyle: 'excited' },
};
```

## Testing

```bash
# Run calendar awareness tests
npm test -- --run -t "Calendar Awareness"
```

### Test Cases

```typescript
// Should recognize interview
analyzeEventImportance("Job Interview at Google");
// Expected: { isImportant: true, category: 'interview', messageStyle: 'supportive' }

// Should recognize medical
analyzeEventImportance("Doctor Appointment");
// Expected: { isImportant: true, category: 'medical', messageStyle: 'caring' }

// Should ignore routine
analyzeEventImportance("Lunch");
// Expected: null

// Should handle recently completed events
getRecentlyCompletedEvents(events, twoHoursAgo);
// Expected: Events that ended between twoHoursAgo and now
```

## Design Decisions

### Why Keyword-Based Instead of LLM?

1. **Speed** - No API latency during idle checks
2. **Cost** - No LLM calls for routine calendar processing
3. **Predictability** - Known keywords produce known results
4. **Privacy** - Event details stay local, not sent to LLM

### Why 3-Hour Window?

Events that ended more than 3 hours ago are stale. The user might have:
- Already told someone else about it
- Moved on mentally
- Come back, left again, and the event is now old news

3 hours keeps messages timely and relevant.

### Why Skip If Pending Message Exists?

One message at a time. Multiple messages piling up feels like:
- Bombardment
- Neediness
- An inbox of obligations

One thoughtful message feels like a gift.

## Troubleshooting

### No Messages Being Created

1. **Check calendar provider is set**: `setCalendarEventsProvider()`
2. **Verify events exist**: Log `events` array
3. **Check event timing**: Event must end after `lastInteractionAt` and within 3 hours of now
4. **Check keywords**: Event summary must contain recognized important keywords
5. **Check pending message**: Won't create if one already exists

### Wrong Message Style

- Verify keyword is in `IMPORTANT_EVENT_KEYWORDS`
- Check category and messageStyle mapping
- Event summary matching is case-insensitive

### Events Not Being Found

- Calendar API might not be returning ended events
- Check `event.end.dateTime` or `event.end.date` format
- Ensure time parsing is working correctly
