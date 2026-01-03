# Utils

Shared utility functions and enums used across the application.

## Files

| File | Purpose |
|------|---------|
| `enums.ts` | Shared enums replacing magic strings (StorageKey, TaskAction, CalendarTag, etc.) |
| `textUtils.ts` | Text sanitization and question detection |
| `jsonUtils.ts` | JSON extraction from strings (handles nested objects) |
| `arrayUtils.ts` | Array shuffle and random selection utilities |
| `actionKeyMapper.ts` | Maps simple action keys to UUIDs for LLM token reduction |
| `intentUtils.ts` | Predicts character actions from user message content |

## Usage

### Enums (Type-Safe Constants)

```typescript
import { StorageKey, TaskAction, LogPrefix, Timing } from './enums';

// Storage keys - avoid typos
localStorage.setItem(StorageKey.SnoozeUntil, JSON.stringify(Date.now() + 3600000));

// Log prefixes - consistent visual scanning
console.log(`${LogPrefix.Tasks} Creating task...`);
console.log(`${LogPrefix.Success} Task created!`);
console.log(`${LogPrefix.Error} Failed to create task`);

// Timing constants - no magic numbers
setTimeout(checkIdle, Timing.IDLE_CHECK_INTERVAL);
```

### Action Key Mapping

```typescript
import { buildActionKeyMap, resolveActionKey } from './actionKeyMapper';

// Initialize when character loads
buildActionKeyMap(character.actions);

// Resolve LLM response to UUID
const actionId = resolveActionKey(response.action_id);
if (actionId) playAction(actionId);
```

### Intent Prediction

```typescript
import { predictActionFromMessage } from './intentUtils';

// Predict action from user message (optimistic playback)
const predictedActionId = predictActionFromMessage(message, character.actions);
if (predictedActionId) {
  playAction(predictedActionId, true); // Play immediately
}
```

### Text Utilities

```typescript
import { sanitizeText, isQuestionMessage } from './textUtils';

// Sanitize text for comparison (lowercase, remove special chars, normalize spaces)
sanitizeText('Hello, World!'); // 'hello world'

// Detect if a message is a question
isQuestionMessage('What time is it?'); // true (ends with ?)
isQuestionMessage('Do you like pizza'); // true (starts with question word)
isQuestionMessage('I like pizza');      // false
```

### JSON Utilities

```typescript
import { extractJsonObject } from './jsonUtils';

// Extract JSON from AI response text
const response = 'Here is the data: {"action": "wave", "mood": "happy"} Hope that helps!';
const json = extractJsonObject(response);
// Returns: '{"action": "wave", "mood": "happy"}'

// Handles nested objects correctly
extractJsonObject('{"outer": {"inner": true}}');
// Returns: '{"outer": {"inner": true}}'
```

### Array Utilities

```typescript
import { randomFromArray, shuffleArray } from './arrayUtils';

// Get random item from array
const actions = ['wave', 'smile', 'nod'];
const action = randomFromArray(actions); // 'wave', 'smile', or 'nod'

// Shuffle array (returns new array, doesn't mutate original)
const shuffled = shuffleArray([1, 2, 3, 4, 5]);
// Returns: [3, 1, 5, 2, 4] (random order)
```

## Enums Reference

### StorageKey
Keys for localStorage to avoid string typos:
- `SnoozeIndefinite` - Boolean flag for indefinite snooze
- `SnoozeUntil` - Timestamp for timed snooze
- `ProactiveSettings` - Proactive feature configuration
- `LastBriefing` - Last briefing timestamp per character
- `GmailHistoryId` - Gmail polling history ID

### LogPrefix
Emoji prefixes for scannable logs:
- `Tasks` (📋), `Calendar` (📅), `Email` (📧)
- `Video` (🎬), `Audio` (🔊), `Idle` (💤)
- `Success` (✅), `Error` (❌), `Loading` (🔄)
- `Memory` (🧠), `Relationship` (💕), `News` (📰)

### Timing
Centralized timing constants (all in milliseconds):
- `IDLE_TIMEOUT` - 5 minutes
- `CALENDAR_POLL_INTERVAL` - 5 minutes
- `GMAIL_POLL_INTERVAL` - 1 minute
- `EMAIL_DEBOUNCE` - 5 seconds

## Adding New Enums

When adding new enums:
1. Add to `enums.ts` with clear comments
2. Update this README with usage examples
3. Use the enum in code instead of magic strings

## Related Files

- `src/types.ts` - Core type definitions
- `src/App.tsx` - Main application (uses these utils)
- `docs/features/App_Refactor.md` - Refactoring guidelines
