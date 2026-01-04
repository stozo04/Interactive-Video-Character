# useIdleTracking Hook

**File:** `src/hooks/useIdleTracking.ts`
**Tests:** `src/hooks/__tests__/useIdleTracking.test.ts`

## Overview

Custom React hook for tracking user idle state. Used to trigger proactive behaviors like idle breakers when the user hasn't interacted for a period of time. Extracted from App.tsx as part of Phase 4B refactoring.

## Usage

```typescript
import { useIdleTracking } from './hooks/useIdleTracking';

const {
  lastInteractionAt,
  hasInteractedRef,
  registerInteraction,
  getIdleTime,
  isIdle,
} = useIdleTracking();

// Record user interaction on activity
const handleClick = () => {
  registerInteraction();
  // ... handle click
};

// Check if user is idle (default 5 min threshold)
if (isIdle()) {
  triggerIdleBreaker();
}

// Check with custom threshold (10 seconds)
if (isIdle(10000)) {
  showIdlePrompt();
}
```

## Return Values

| Property | Type | Description |
|----------|------|-------------|
| `lastInteractionAt` | `number` | Timestamp of the last user interaction |
| `setLastInteractionAt` | `Dispatch<SetStateAction<number>>` | Setter for last interaction timestamp |
| `hasInteractedRef` | `MutableRefObject<boolean>` | Ref tracking whether user has ever interacted |
| `registerInteraction` | `() => void` | Record a user interaction |
| `getIdleTime` | `() => number` | Get time elapsed since last interaction (ms) |
| `isIdle` | `(thresholdMs?: number) => boolean` | Check if user is idle (default 5 min threshold) |

## Functions

### registerInteraction()

Records a user interaction by:
1. Updating `lastInteractionAt` to current timestamp
2. Setting `hasInteractedRef.current` to `true`

Call this whenever the user performs an action:
- Sending a message
- Opening settings
- Managing characters
- Navigating views

### getIdleTime()

Returns the number of milliseconds since the last user interaction.

```typescript
const idleMs = getIdleTime();
console.log(`User idle for ${idleMs / 1000} seconds`);
```

### isIdle(thresholdMs?)

Returns `true` if the user has been idle longer than the threshold.

```typescript
// Use default 5-minute threshold
if (isIdle()) { ... }

// Use custom 30-second threshold
if (isIdle(30000)) { ... }
```

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_IDLE_THRESHOLD` | `5 * 60 * 1000` | 5 minutes in milliseconds |

## Dependencies

- `react` (useState, useCallback, useRef, Dispatch, SetStateAction, MutableRefObject)

## Notes

- The hook initializes `lastInteractionAt` to `Date.now()` on mount
- `hasInteractedRef` is a ref (not state) to avoid closure issues in async callbacks
- The idle threshold can be customized per-call via `isIdle(thresholdMs)`
- This hook doesn't set up any timers - the caller is responsible for scheduling idle checks
