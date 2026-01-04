# useCharacterActions Hook

**File:** `src/hooks/useCharacterActions.ts`
**Tests:** `src/hooks/__tests__/useCharacterActions.test.ts`

## Overview

Custom React hook for managing character action video playback, idle action scheduling, and action categorization (talking, greeting). Extracted from App.tsx as part of Phase 6 refactoring.

## Usage

```typescript
import { useCharacterActions } from './hooks/useCharacterActions';

const {
  // State
  currentActionId,
  setCurrentActionId,
  actionVideoUrls,
  setActionVideoUrls,

  // Playback
  playAction,
  playRandomTalkingAction,

  // Idle Actions
  triggerIdleAction,
  scheduleIdleAction,
  clearIdleActionTimer,

  // Action Categorization
  isTalkingActionId,
  getTalkingActions,
  getNonGreetingActions,
  getGreetingActions,
} = useCharacterActions({
  selectedCharacter,
  isProcessingAction,
  media,
  registerInteraction,
});

// Play a specific action
playAction('action-id', true); // forceImmediate = true

// Play a random talking action (for speech)
const actionId = playRandomTalkingAction();

// Schedule random idle action (10-45s delay)
scheduleIdleAction();
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `selectedCharacter` | `CharacterProfile \| null` | Currently selected character |
| `isProcessingAction` | `boolean` | Whether an action is being processed |
| `media` | `{ playAction: (url, forceImmediate?) => void }` | Media hook for video playback |
| `registerInteraction` | `() => void` | Function to record user interaction |

## Return Values

| Property | Type | Description |
|----------|------|-------------|
| `currentActionId` | `string \| null` | Currently playing action ID |
| `setCurrentActionId` | `Dispatch<SetStateAction<string \| null>>` | Setter for current action |
| `actionVideoUrls` | `Record<string, string>` | Map of action IDs to video URLs |
| `setActionVideoUrls` | `Dispatch<SetStateAction<...>>` | Setter for action URLs |
| `playAction` | `(actionId, forceImmediate?) => boolean` | Play an action by ID |
| `playRandomTalkingAction` | `(forceImmediate?) => string \| null` | Play random talking action |
| `triggerIdleAction` | `() => void` | Immediately trigger an idle action |
| `scheduleIdleAction` | `() => void` | Schedule idle action after random delay |
| `clearIdleActionTimer` | `() => void` | Cancel scheduled idle action |
| `isTalkingActionId` | `(actionId) => boolean` | Check if action is a talking action |
| `getTalkingActions` | `() => CharacterAction[]` | Get all talking actions |
| `getNonGreetingActions` | `() => CharacterAction[]` | Get all non-greeting actions |
| `getGreetingActions` | `() => CharacterAction[]` | Get all greeting actions |

## Exported Helper Functions

The hook also exports standalone helper functions that can be used outside React:

```typescript
import {
  isTalkingAction,
  isGreetingAction,
  getGreetingActions,
  getNonGreetingActions,
  getTalkingActions,
} from './hooks/useCharacterActions';

// Check if an action is a talking action
if (isTalkingAction(action)) { ... }

// Get greeting actions from a list
const greetings = getGreetingActions(character.actions);
```

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `ACTION_VIDEO_BUCKET` | `'character-action-videos'` | Supabase storage bucket |
| `IDLE_ACTION_DELAY_MIN_MS` | `10000` | Minimum idle delay (10s) |
| `IDLE_ACTION_DELAY_MAX_MS` | `45000` | Maximum idle delay (45s) |

## Action Detection

### Talking Actions

Actions are considered "talking" if their name or phrases contain:
- talk, talking, speak, chat, answer, respond

### Greeting Actions

Actions are considered "greeting" if their name or phrases contain:
- greeting

## Dependencies

- `react` (useState, useCallback, useRef)
- `src/types` (CharacterProfile, CharacterAction)
- `src/services/supabaseClient` (for public URL generation)
- `src/utils/arrayUtils` (shuffleArray, randomFromArray)
- `src/utils/textUtils` (sanitizeText)

## Notes

- Action URLs are fetched from Supabase storage if not already cached
- Idle actions exclude greeting actions to avoid awkward triggers
- `registerInteraction` is called when idle actions are triggered
- The hook uses `clearTimeout`/`setTimeout` for idle scheduling
