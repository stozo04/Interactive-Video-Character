# Message Action Handlers

Consolidated handlers for processing AI response actions. Extracted from `App.tsx` as part of Phase 5 refactoring.

## Overview

These handlers process structured actions from AI responses:
- **Calendar actions**: Create/delete calendar events
- **Task actions**: Create/complete/delete/list tasks
- **News actions**: Fetch and format tech news from Hacker News
- **Selfie actions**: Generate AI companion images

## Architecture

```
src/handlers/messageActions/
├── index.ts              # Consolidated exports
├── calendarActions.ts    # Calendar CRUD operations
├── taskActions.ts        # Task management
├── newsActions.ts        # News fetching
├── selfieActions.ts      # Image generation
├── README.md             # This file
└── __tests__/            # 46 unit tests
    ├── calendarActions.test.ts
    ├── taskActions.test.ts
    ├── newsActions.test.ts
    └── selfieActions.test.ts
```

## Design Principles

1. **Pure functions** - Handlers receive all dependencies as parameters
2. **Early returns** - Check for valid action before processing
3. **Result objects** - Return `{ handled: boolean, ... }` for consistent handling
4. **Error resilience** - Catch and report errors without crashing

## Usage

```typescript
import {
  processCalendarAction,
  processTaskAction,
  processNewsAction,
  processSelfieAction,
} from './handlers/messageActions';

// In handleSendMessage:
const calendarResult = await processCalendarAction(
  aiResponse.calendar_action,
  { accessToken, currentEvents }
);

if (calendarResult.handled) {
  // Calendar action was processed
}
```

## Handler Details

### Calendar Actions (`calendarActions.ts`)

Handles calendar event creation and deletion.

**Exports:**
- `processCalendarAction(action, context)` - Process structured calendar_action
- `parseCalendarTagFromResponse(text)` - Parse legacy `[CALENDAR_CREATE]` tags
- `processCalendarTag(parsed, context)` - Process parsed calendar tags

**Actions:**
- `create`: Creates a new calendar event
- `delete`: Deletes one or more events (by ID or delete_all)

### Task Actions (`taskActions.ts`)

Handles task CRUD operations.

**Exports:**
- `processTaskAction(action, tasks, handlers)` - Process structured task_action
- `parseTaskActionFromResponse(text)` - Parse embedded task_action JSON
- `detectTaskCompletionFallback(message, tasks)` - Detect completion intent from user message

**Actions:**
- `create`: Creates a new task with optional priority
- `complete`: Marks a task as completed (by ID or text match)
- `delete`: Deletes a task (by ID or text match)
- `list`: Opens the task panel

### News Actions (`newsActions.ts`)

Fetches and formats tech news.

**Exports:**
- `processNewsAction(action)` - Fetch news from Hacker News
- `formatNewsForAI(stories)` - Format stories for AI consumption

### Selfie Actions (`selfieActions.ts`)

Generates AI companion images.

**Exports:**
- `processSelfieAction(action, context)` - Generate selfie image

**Context includes:**
- User message
- Chat history (last 10 messages)
- Upcoming calendar events (for outfit context)
- Kayley's presence state (outfit, mood)

## Testing

Run message action tests:
```bash
npm test -- --run src/handlers/messageActions/__tests__/
```

Coverage: 46 tests covering all handlers and edge cases.

## Migration Notes

These handlers were extracted from `App.tsx` to:
1. Reduce App.tsx complexity (~850 lines removed)
2. Enable isolated unit testing
3. Improve code organization
4. Allow reuse across different entry points
