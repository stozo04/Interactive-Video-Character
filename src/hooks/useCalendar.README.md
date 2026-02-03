# useCalendar Hook

**File:** `src/hooks/useCalendar.ts`
**Tests:** `src/hooks/__tests__/useCalendar.test.ts`

## Overview

Custom React hook for managing calendar state, polling, and proactive check-ins. Extracted from App.tsx as part of Phase 3 refactoring.

## Usage

```typescript
import { useCalendar } from './hooks/useCalendar';

// Use ref pattern for triggerSystemMessage since it's defined later
const calendarTriggerRef = useRef<(prompt: string) => void>(() => {});

const {
  // State
  upcomingEvents,
  weekEvents,
  setUpcomingEvents,

  // Operations
  refreshEvents,
  refreshWeekEvents,
  triggerCalendarCheckin,
  registerCalendarEffects,
  checkForApplicableCheckins,
} = useCalendar({
  session,
  isAuthConnected,
  selectedCharacter,
  proactiveSettings,
  isSnoozed,
  isProcessingAction,
  isSpeaking,
  triggerSystemMessage: (prompt) => calendarTriggerRef.current(prompt),
});

// Wire up the ref after triggerSystemMessage is defined
useEffect(() => {
  calendarTriggerRef.current = triggerSystemMessage;
}, [triggerSystemMessage]);

// Register calendar polling effects
useEffect(() => {
  return registerCalendarEffects();
}, [registerCalendarEffects]);

// Check for applicable check-ins
useEffect(() => {
  if (!selectedCharacter || weekEvents.length === 0 || !proactiveSettings.calendar) return;

  const interval = setInterval(() => {
    checkForApplicableCheckins(weekEvents);
  }, 2 * 60 * 1000);

  const initialCheck = setTimeout(() => {
    checkForApplicableCheckins(weekEvents);
  }, 30000);

  return () => {
    clearInterval(interval);
    clearTimeout(initialCheck);
  };
}, [weekEvents, selectedCharacter, proactiveSettings.calendar, checkForApplicableCheckins]);
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `session` | `{ accessToken: string } \| null` | Google auth session with access token |
| `isAuthConnected` | `boolean` | Whether Google auth is currently connected |
| `selectedCharacter` | `{ id, name } \| null` | Currently selected character |
| `proactiveSettings` | `ProactiveSettings` | Proactive feature settings |
| `isSnoozed` | `boolean` | Whether check-ins are snoozed |
| `isProcessingAction` | `boolean` | Whether an action is being processed |
| `isSpeaking` | `boolean` | Whether the character is speaking |
| `triggerSystemMessage` | `(prompt: string) => void` | Function to trigger a system message |

## Return Values

| Property | Type | Description |
|----------|------|-------------|
| `upcomingEvents` | `CalendarEvent[]` | Today's upcoming events |
| `weekEvents` | `CalendarEvent[]` | This week's events (for proactive check-ins) |
| `setUpcomingEvents` | `Dispatch<SetStateAction<CalendarEvent[]>>` | Direct setter for upcoming events |
| `setWeekEvents` | `Dispatch<SetStateAction<CalendarEvent[]>>` | Direct setter for week events |
| `refreshEvents` | `(accessToken: string) => Promise<CalendarEvent[]>` | Refresh upcoming events |
| `refreshWeekEvents` | `(accessToken: string) => Promise<void>` | Refresh week events |
| `triggerCalendarCheckin` | `(event, type) => void` | Trigger a specific check-in |
| `registerCalendarEffects` | `() => () => void` | Register polling, returns cleanup |
| `checkForApplicableCheckins` | `(events) => void` | Manually check for check-ins |

## Polling Intervals

- **Calendar poll:** 5 minutes (300,000ms)
- **Check-in check:** 2 minutes (120,000ms)
- **Initial check delay:** 30 seconds (30,000ms)

## Check-in Types

The hook supports the following check-in types via `calendarCheckinService`:
- `upcoming` - Event starting soon
- `reminder` - Event reminder
- `followup` - Post-event follow-up

## Ref Pattern

Since `triggerSystemMessage` is typically defined later in a component (after other callbacks), use a ref pattern:

```typescript
// 1. Create ref early
const calendarTriggerRef = useRef<(prompt: string) => void>(() => {});

// 2. Pass ref-wrapped function to hook
const { ... } = useCalendar({
  triggerSystemMessage: (prompt) => calendarTriggerRef.current(prompt),
});

// 3. Wire up ref after triggerSystemMessage is defined
useEffect(() => {
  calendarTriggerRef.current = triggerSystemMessage;
}, [triggerSystemMessage]);
```

## Dependencies

- `react` (useState, useCallback, Dispatch, SetStateAction)
- `src/services/calendarService` (API calls)
- `src/services/calendarCheckinService` (check-in logic)
- `src/types` (ProactiveSettings)

## Notes

- `registerCalendarEffects()` must be called in a useEffect to start polling
- Check-in logic respects `isSnoozed` and `proactiveSettings.calendar`
- The hook cleans up old check-in states when week events are refreshed
- Uses console logging with emoji prefixes for debugging
