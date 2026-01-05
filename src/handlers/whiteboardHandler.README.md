# Whiteboard Handler

Handles AI interaction for whiteboard/drawing mode. Extracted from App.tsx as part of Phase 8 refactoring.

## Overview

This handler manages:
- Image capture processing from the whiteboard canvas
- AI response generation for whiteboard interactions
- User facts pre-fetching for context enrichment
- Whiteboard action parsing (drawing, game moves, etc.)
- Async audio playback

## Usage

```typescript
import { handleWhiteboardCapture } from './handlers/whiteboardHandler';

// In your component
const result = await handleWhiteboardCapture(
  base64ImageData,
  'draw a cat',
  'You are in drawing mode. The user wants you to draw on the canvas.',
  {
    selectedCharacter,
    session,
    aiSession,
    activeService,
    setAiSession,
    playAction,
    isMutedRef,
    enqueueAudio: media.enqueueAudio,
  }
);

// Result contains:
// - textResponse: AI's text reply
// - whiteboardAction: Parsed action (draw, game_move, etc.)
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `selectedCharacter` | `CharacterProfile \| null` | Currently selected character |
| `session` | `{ accessToken: string } \| null` | Google session with access token |
| `aiSession` | `AIChatSession \| null` | Current AI chat session |
| `activeService` | `IAIChatService` | Active AI service instance |
| `setAiSession` | `(session: AIChatSession) => void` | Callback to update AI session |
| `playAction` | `(actionId: string) => void` | Callback to play character action |
| `isMutedRef` | `{ current: boolean }` | Ref tracking muted state |
| `enqueueAudio` | `(audioData: string) => void` | Callback to enqueue audio |

## Return Value

| Property | Type | Description |
|----------|------|-------------|
| `textResponse` | `string` | AI's text response |
| `whiteboardAction` | `WhiteboardAction \| null \| undefined` | Parsed whiteboard action |

## Whiteboard Actions

The handler parses AI responses for whiteboard-specific actions:

- `draw` - Drawing instructions for the canvas
- `mark_cell` - Game move for tic-tac-toe
- `clear` - Clear the canvas
- Custom actions defined in `whiteboardModes.ts`

## Features

### User Facts Pre-fetching

The handler pre-fetches user facts from memory to provide context:
- If user says "draw my name" and their name is known, AI uses it
- Prevents redundant questions about information already stored

### Async Audio

Audio is processed asynchronously:
- Doesn't block drawing/action responses
- Respects mute state at callback time
- Uses `audioMode: 'async'` with `onAudioData` callback

### Debug Logging

Enable detailed timing logs with localStorage:
```javascript
localStorage.setItem('debug:whiteboard', '1');
```

Logs include:
- User facts fetch timing
- AI response generation timing
- Action parsing timing
- Total request duration

## Dependencies

- `whiteboardModes.ts` - Action parsing
- `memoryService.ts` - User facts fetching
- `aiService.ts` - AI response generation

## Tests

Tests are located at `src/handlers/__tests__/whiteboardHandler.test.ts` with 10 test cases covering:
- Missing character/session handling
- AI response generation
- Session updates
- Action playback
- Error handling
- User facts context enrichment

Run tests with:
```bash
npm test -- --run -t "whiteboardHandler"
```

## Migration from App.tsx

This handler was extracted from App.tsx Phase 8 refactoring (~113 lines).

The following was moved:
- `handleWhiteboardCapture()` function
- Debug logging helpers
- User facts pre-fetching logic
- AI response generation for whiteboard mode
- Whiteboard action parsing
