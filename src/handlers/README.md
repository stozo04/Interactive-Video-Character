# Handlers

Extracted handler functions from App.tsx for specific feature domains.

## Overview

Handlers are standalone functions that process specific types of interactions. Unlike hooks, they don't manage React state directly - they receive dependencies as parameters and return results.

## Files

| File | Purpose |
|------|---------|
| `whiteboardHandler.ts` | Whiteboard/drawing mode AI interaction |
| `whiteboardHandler.README.md` | Documentation for whiteboard handler |

## Future Additions (Phase 5)

The `messageActions/` folder will contain handlers for message action parsing:
- `calendarActions.ts` - Calendar create/delete tag handling
- `taskActions.ts` - Task creation/completion parsing
- `newsActions.ts` - News request handling
- `selfieActions.ts` - Selfie generation requests

## Usage Pattern

```typescript
import { handleWhiteboardCapture } from './handlers/whiteboardHandler';

// Call handler with dependencies
const result = await handleWhiteboardCapture(
  base64Data,
  userMessage,
  modeContext,
  {
    selectedCharacter,
    session,
    // ... other dependencies
  }
);

// Use result
if (result.whiteboardAction) {
  // Handle action
}
```

## Design Principles

1. **Pure functions** - Handlers receive all dependencies as parameters
2. **No React hooks** - Can be tested without React context
3. **Single responsibility** - Each handler manages one feature domain
4. **Return values** - Results are returned, not mutated in place
5. **Error handling** - Errors are caught and returned gracefully

## Testing

Tests are in `__tests__/` folder:
```bash
npm test -- --run -t "whiteboardHandler"
```
