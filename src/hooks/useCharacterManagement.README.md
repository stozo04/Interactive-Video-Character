# useCharacterManagement Hook

Manages character CRUD operations, action management, and idle video management. Extracted from App.tsx as part of Phase 7 refactoring.

## Overview

This hook centralizes all character management functionality:
- Character creation and deletion
- Action CRUD (create, update, delete)
- Idle video management
- Image upload handling
- Navigation between views

## Usage

```tsx
import { useCharacterManagement } from './hooks/useCharacterManagement';

// In your component
const {
  // Loading states
  isSavingCharacter,
  isCreatingAction,
  updatingActionId,
  deletingActionId,
  isAddingIdleVideo,
  deletingIdleVideoId,
  isUpdatingImage,

  // Image upload
  uploadedImage,
  setUploadedImage,
  handleImageUpload,

  // Character handlers
  handleCharacterCreated,
  handleSelectLocalVideo,
  handleManageCharacter,
  handleDeleteCharacter,
  handleBackToSelection,

  // Action handlers
  handleCreateAction,
  handleUpdateAction,
  handleDeleteAction,

  // Idle video handlers
  handleAddIdleVideo,
  handleDeleteIdleVideo,

  // Utilities
  applyCharacterUpdate,
  cleanupActionUrls,
} = useCharacterManagement({
  characters,
  setCharacters,
  selectedCharacter,
  setSelectedCharacter,
  characterForManagement,
  setCharacterForManagement,
  actionVideoUrls,
  setActionVideoUrls,
  setView,
  reportError,
  registerInteraction,
  media,
});
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `characters` | `CharacterProfile[]` | List of all characters |
| `setCharacters` | `Dispatch<SetStateAction<CharacterProfile[]>>` | Setter for characters list |
| `selectedCharacter` | `CharacterProfile \| null` | Currently selected character for chat |
| `setSelectedCharacter` | `Dispatch<SetStateAction<CharacterProfile \| null>>` | Setter for selected character |
| `characterForManagement` | `CharacterProfile \| null` | Character being managed |
| `setCharacterForManagement` | `Dispatch<SetStateAction<CharacterProfile \| null>>` | Setter for management character |
| `actionVideoUrls` | `Record<string, string>` | Map of action IDs to video blob URLs |
| `setActionVideoUrls` | `Dispatch<SetStateAction<Record<string, string>>>` | Setter for action video URLs |
| `setView` | `(view: View) => void` | Function to change the current view |
| `reportError` | `(message: string, error?: unknown) => void` | Error reporting callback |
| `registerInteraction` | `() => void` | Function to register user interaction |
| `media` | `{ setVideoQueue, setAudioQueue? }` | Media hook for queue management |

## Return Values

### Loading States

| Property | Type | Description |
|----------|------|-------------|
| `isSavingCharacter` | `boolean` | True while saving a new character |
| `isCreatingAction` | `boolean` | True while creating an action |
| `updatingActionId` | `string \| null` | ID of action being updated, or null |
| `deletingActionId` | `string \| null` | ID of action being deleted, or null |
| `isAddingIdleVideo` | `boolean` | True while adding an idle video |
| `deletingIdleVideoId` | `string \| null` | ID of idle video being deleted, or null |
| `isUpdatingImage` | `boolean` | True while updating character image |

### Character Handlers

| Function | Parameters | Description |
|----------|------------|-------------|
| `handleImageUpload` | `(image: UploadedImage)` | Set uploaded image for character creation |
| `handleCharacterCreated` | `(image, idleVideoBlob)` | Create a new character |
| `handleSelectLocalVideo` | `(videoFile: File)` | Create character with uploaded video |
| `handleManageCharacter` | `(character)` | Enter management view for a character |
| `handleDeleteCharacter` | `(id: string)` | Delete a character (with confirmation) |
| `handleBackToSelection` | `()` | Return to character selection |

### Action Handlers

| Function | Parameters | Description |
|----------|------------|-------------|
| `handleCreateAction` | `({ name, phrases, videoFile })` | Create a new action |
| `handleUpdateAction` | `(actionId, { name?, phrases?, videoFile? })` | Update an existing action |
| `handleDeleteAction` | `(actionId)` | Delete an action |

### Idle Video Handlers

| Function | Parameters | Description |
|----------|------------|-------------|
| `handleAddIdleVideo` | `(videoFile: File)` | Add an idle video to character |
| `handleDeleteIdleVideo` | `(videoId: string)` | Delete an idle video (format: "idle-{index}") |

### Utility Functions

| Function | Parameters | Description |
|----------|------------|-------------|
| `applyCharacterUpdate` | `(characterId, updater)` | Apply update to character in all state locations |
| `cleanupActionUrls` | `(urls)` | Revoke all object URLs |

## Notes

### handleSelectCharacter

The `handleSelectCharacter` function is NOT included in this hook because it has complex dependencies:
- Loads tasks via `useTasks` hook
- Generates greeting/non-greeting via AI service
- Manages conversation history
- Initializes video queue with character's idle videos

This function remains in App.tsx.

### handleUpdateImage

The `handleUpdateImage` function is also NOT included because it uses DOM APIs (`document.createElement('input')`) which don't work well in the React hooks pattern. This remains in App.tsx.

## Tests

Tests are located at `src/hooks/__tests__/useCharacterManagement.test.ts` with 24 test cases covering:
- Initial state
- Image upload
- Action CRUD operations
- Idle video management
- Character deletion
- Navigation
- Utility functions

Run tests with:
```bash
npm test -- --run -t "useCharacterManagement"
```

## Migration from App.tsx

This hook was extracted from App.tsx Phase 7 refactoring. The following were moved:

**State declarations:**
- `isSavingCharacter`
- `isCreatingAction`
- `updatingActionId`
- `deletingActionId`
- `isAddingIdleVideo`
- `deletingIdleVideoId`
- `isUpdatingImage`
- `uploadedImage`

**Functions:**
- `handleImageUpload`
- `handleCharacterCreated`
- `handleCreateAction`
- `handleUpdateAction`
- `handleDeleteAction`
- `handleSelectLocalVideo`
- `handleManageCharacter`
- `handleAddIdleVideo`
- `handleDeleteIdleVideo`
- `handleDeleteCharacter`
- `handleBackToSelection`
- `applyCharacterUpdate`
- `cleanupActionUrls`
