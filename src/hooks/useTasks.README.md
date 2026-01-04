# useTasks Hook

**File:** `src/hooks/useTasks.ts`
**Tests:** `src/hooks/__tests__/useTasks.test.ts`

## Overview

Custom React hook for managing task state and CRUD operations. Extracted from App.tsx as part of Phase 2 refactoring.

## Usage

```typescript
import { useTasks } from './hooks/useTasks';

const {
  // State
  tasks,
  setTasks,
  isTaskPanelOpen,
  setIsTaskPanelOpen,

  // Operations
  loadTasks,
  refreshTasks,
  handleTaskCreate,
  handleTaskToggle,
  handleTaskDelete,
} = useTasks({
  onCelebrate: (message) => {
    // Called when task is created or completed
    // Use for speech generation, chat history updates, etc.
  },
  onPlayPositiveAction: () => {
    // Called when task is completed
    // Use for playing happy/celebrate animations
  },
});
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `onCelebrate` | `(message: string) => void` | Called with a celebration message when task is created or completed |
| `onPlayPositiveAction` | `() => void` | Called when a task is completed (for positive animations) |

## Return Values

| Property | Type | Description |
|----------|------|-------------|
| `tasks` | `Task[]` | Current list of tasks |
| `setTasks` | `Dispatch<SetStateAction<Task[]>>` | Direct setter for external updates (e.g., AI tool calls) |
| `isTaskPanelOpen` | `boolean` | Whether the task panel is open |
| `setIsTaskPanelOpen` | `Dispatch<SetStateAction<boolean>>` | Toggle task panel visibility |
| `loadTasks` | `() => Promise<Task[]>` | Load tasks from database (sets state and returns tasks) |
| `refreshTasks` | `() => Promise<Task[]>` | Refresh tasks from database (alias for loadTasks) |
| `handleTaskCreate` | `(text: string, priority?: Priority) => Promise<void>` | Create a new task |
| `handleTaskToggle` | `(taskId: string) => Promise<void>` | Toggle task completion status |
| `handleTaskDelete` | `(taskId: string) => Promise<void>` | Delete a task |

## Integration Pattern

Since callbacks may need access to things defined later in the component (like `playAction`), use refs:

```typescript
// Define refs early
const celebrateRef = useRef<(msg: string) => void>(() => {});
const playPositiveRef = useRef<() => void>(() => {});

// Call hook with ref-based callbacks
const { tasks, handleTaskCreate, ... } = useTasks({
  onCelebrate: (msg) => celebrateRef.current(msg),
  onPlayPositiveAction: () => playPositiveRef.current(),
});

// Wire up refs after dependencies are available
useEffect(() => {
  celebrateRef.current = (message) => {
    if (selectedCharacter && !isMutedRef.current) {
      generateSpeech(message).then(audio => media.enqueueAudio(audio));
      setChatHistory(prev => [...prev, { role: 'model', text: message }]);
    }
  };
  playPositiveRef.current = () => {
    const positiveActions = selectedCharacter?.actions.filter(a =>
      a.name.toLowerCase().includes('happy')
    );
    if (positiveActions?.length) playAction(positiveActions[0].id);
  };
}, [selectedCharacter, media]);
```

## Celebration Messages

The hook includes built-in celebration messages:

**Task Creation:**
- "Got it! Added to your list"
- "Done! I'll help you remember that."
- "Added! One step at a time"
- "On the list! You've got this."

**Task Completion:**
- "Nice! That's one thing off your plate"
- "You crushed it! One down!"
- "Look at you go!"
- "Done and done! Great work"
- "Boom! Another one bites the dust!"

## Dependencies

- `react` (useState, useCallback)
- `src/services/taskService` (CRUD operations)
- `src/types` (Task interface)

## Notes

- State is managed internally; `setTasks` is exposed for external updates (e.g., when AI tools modify tasks directly)
- Uses console logging with emoji prefixes for debugging
- Callbacks are only called if provided; they're optional
