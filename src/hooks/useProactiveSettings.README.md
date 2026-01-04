# useProactiveSettings Hook

**File:** `src/hooks/useProactiveSettings.ts`
**Tests:** `src/hooks/__tests__/useProactiveSettings.test.ts`

## Overview

Custom React hook for managing proactive feature settings and snooze state with localStorage persistence. Extracted from App.tsx as part of Phase 4A refactoring.

## Usage

```typescript
import { useProactiveSettings } from './hooks/useProactiveSettings';

const {
  // State
  proactiveSettings,
  isSnoozed,
  snoozeUntil,

  // Operations
  updateProactiveSettings,
  setIsSnoozed,
  setSnoozeUntil,
  loadSnoozeState,
  clearSnooze,
} = useProactiveSettings();

// Update a single setting
updateProactiveSettings({ calendar: false });

// Load snooze state on character selection
const { isSnoozed, snoozeUntil } = loadSnoozeState();
```

## Return Values

| Property | Type | Description |
|----------|------|-------------|
| `proactiveSettings` | `ProactiveSettings` | Current proactive settings |
| `updateProactiveSettings` | `(updates: Partial<ProactiveSettings>) => void` | Update settings (partial update, persists to localStorage) |
| `isSnoozed` | `boolean` | Whether check-ins are currently snoozed |
| `setIsSnoozed` | `Dispatch<SetStateAction<boolean>>` | Setter for snoozed state |
| `snoozeUntil` | `number \| null` | When the snooze expires (null for indefinite) |
| `setSnoozeUntil` | `Dispatch<SetStateAction<number \| null>>` | Setter for snooze until time |
| `loadSnoozeState` | `() => SnoozeState` | Load snooze state from localStorage and update React state |
| `clearSnooze` | `() => void` | Clear snooze state and localStorage |

## ProactiveSettings Type

```typescript
interface ProactiveSettings {
  calendar: boolean;    // Calendar event check-ins
  dailyCatchup: boolean; // Daily briefing feature
  news: boolean;        // News updates
  idleBreakers: boolean; // Idle check-ins
}
```

## Default Settings

All proactive features are enabled by default:

```typescript
const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  calendar: true,
  dailyCatchup: true,
  news: true,
  idleBreakers: true,
};
```

## localStorage Keys

| Key | Purpose |
|-----|---------|
| `kayley_proactive_settings` | Stores the proactive settings object |
| `kayley_snooze_indefinite` | Set to `'true'` for indefinite snooze |
| `kayley_snooze_until` | Timestamp (ms) when timed snooze expires |

## Snooze State

The hook supports two types of snooze:

1. **Indefinite Snooze**: `isSnoozed = true`, `snoozeUntil = null`
2. **Timed Snooze**: `isSnoozed = true`, `snoozeUntil = <timestamp>`

### loadSnoozeState()

Reads snooze state from localStorage, updates React state, and handles expiry:
- Checks for indefinite snooze (`kayley_snooze_indefinite`)
- Checks for timed snooze (`kayley_snooze_until`)
- Automatically clears expired timed snooze from localStorage
- Returns `{ isSnoozed, snoozeUntil }` for immediate use

### clearSnooze()

Clears all snooze state:
- Removes both localStorage keys
- Sets `isSnoozed` to false
- Sets `snoozeUntil` to null

## Dependencies

- `react` (useState, useCallback, Dispatch, SetStateAction)
- `src/types` (ProactiveSettings)

## Notes

- Settings are automatically persisted to localStorage on update
- The hook exports `DEFAULT_PROACTIVE_SETTINGS` for use elsewhere
- Snooze state is loaded lazily via `loadSnoozeState()` (typically on character selection)
- Uses console logging with emoji prefixes for debugging
