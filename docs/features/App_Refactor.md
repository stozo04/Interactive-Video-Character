# App.tsx Refactoring Plan

## Executive Summary

The App.tsx file has grown to **3,136 lines**, containing multiple feature domains mixed together. This plan extracts functionality into dedicated custom hooks, services, and handler modules while maintaining the existing architecture patterns established in the codebase.

**Goal:** Reduce App.tsx to **500-700 lines** with clear separation of concerns.

---

## Progress Summary

| Phase | Description | Status | Date |
|-------|-------------|--------|------|
| 0 | Shared Enums | ✅ Complete | 2025-01-02 |
| 1 | Utility Functions | ✅ Complete | 2025-01-02 |
| 2 | Task Hook | ✅ Complete | 2025-01-03 |
| 3 | Calendar Hook | ✅ Complete | 2025-01-03 |
| 4A | Proactive Settings Hook | ✅ Complete | 2025-01-03 |
| 4B | Idle Tracking Hook | ✅ Complete | 2025-01-03 |
| 5 | Message Action Handlers | ⏳ Pending (LAST) | - |
| 6 | Character Actions Hook | ✅ Complete | 2025-01-03 |
| 7 | Character Management Hook | ⏳ Pending | - |
| 8 | Whiteboard Handler | ⏳ Pending | - |
| ~~9~~ | ~~Email Hook~~ | ❌ Removed | - |

**Current App.tsx:** ~2,808 lines → **Target:** 500-700 lines

> **Notes:**
> - Phase 9 (Email Hook) removed - only ~125 lines, rarely used, not worth extraction overhead.
> - Phase 5 moved to LAST position due to high complexity (~850 lines, touches everything).
> - Phase 4 split into 4A + 4B after coupling analysis (see deep dive at end of doc). Core proactive logic (`triggerSystemMessage`, `triggerIdleBreaker`) stays in App.tsx by design.
> - Phase 2 (Task Hook) extracted ~126 lines using a ref-based callback pattern to handle dependencies on things defined later in the component (e.g., `playAction`).
> - Phase 3 (Calendar Hook) extracted ~41 lines. Uses same ref pattern for `triggerSystemMessage`. Polling and check-in logic now in hook.

---

## Refactoring Guidelines

### 1. Test-Driven Development (TDD)

**This app works. It must continue to work after every change.**

For each extraction:
1. **Write tests FIRST** for the module being extracted
2. Run existing tests to establish baseline
3. Extract the code
4. Ensure all tests pass (old and new)
5. Manual smoke test the feature
6. Commit only when green

```bash
# Before ANY extraction
npm test -- --run

# After extraction
npm test -- --run
npm run build
```

### 2. Keep It Simple

This is a **personal app**, not a production system. Avoid:
- Over-abstraction
- Unnecessary interfaces
- Complex dependency injection
- Enterprise patterns that add complexity without value

**Good:** Direct function calls, simple state
**Bad:** Factory patterns, abstract base classes, IoC containers

### 3. No User ID

This is a single-user app. **Never add userId parameters** to:
- Function signatures
- Database queries
- Service calls
- Hook options

### 4. Logging

**Keep generous logging!** Every significant operation should log:

```typescript
// Good - descriptive logs
console.log('📋 [useTasks] Creating task:', text);
console.log('✅ [useTasks] Task created:', newTask.id);
console.log('❌ [useTasks] Failed to create task:', error);

// Use emoji prefixes for visual scanning:
// 📋 = Tasks
// 📅 = Calendar
// 📧 = Email
// 🎬 = Video/Actions
// 💤 = Idle/Proactive
// ✅ = Success
// ❌ = Error
// ⚡ = Performance
```

### 5. Use Enums Instead of Magic Strings

Replace string literals with enums for type safety:

```typescript
// BAD - magic strings
if (action === 'create') { ... }
localStorage.setItem('kayley_snooze_indefinite', 'true');

// GOOD - enums
enum TaskAction {
  Create = 'create',
  Complete = 'complete',
  Delete = 'delete',
}

enum StorageKey {
  SnoozeIndefinite = 'kayley_snooze_indefinite',
  SnoozeUntil = 'kayley_snooze_until',
  ProactiveSettings = 'kayley_proactive_settings',
}

if (action === TaskAction.Create) { ... }
localStorage.setItem(StorageKey.SnoozeIndefinite, 'true');
```

### 6. Use Booleans, Not String Booleans

```typescript
// BAD
localStorage.setItem('snooze', 'true');
if (localStorage.getItem('snooze') === 'true') { ... }

// GOOD
localStorage.setItem('snooze', JSON.stringify(true));
const isSnoozed = JSON.parse(localStorage.getItem('snooze') ?? 'false');
```

### 7. README for Every New File

Each new file **MUST** have a companion README so agents understand its purpose:

**File Structure:**
```
src/hooks/
├── useTasks.ts
├── useTasks.README.md    <-- Required!
├── useCalendar.ts
├── useCalendar.README.md <-- Required!
```

**README Template:**
```markdown
# [Module Name]

## Purpose
One sentence explaining what this module does.

## Usage
\`\`\`typescript
const { tasks, handleTaskCreate } = useTasks(options);
\`\`\`

## Exports
- `useTasks(options)` - Main hook
- `TaskAction` - Enum for task operations
- `TaskPriority` - Enum for priority levels

## Dependencies
- `taskService` - Backend operations
- `generateSpeech` - Audio feedback

## State Managed
- `tasks: Task[]` - Current task list
- `isTaskPanelOpen: boolean` - Panel visibility

## Related Files
- `src/services/taskService.ts` - Backend service
- `src/components/TaskPanel.tsx` - UI component
```

---

## Current State Analysis

### State Variables by Domain (Lines 200-300)

| Domain | State Variables | Count |
|--------|-----------------|-------|
| **Core UI** | `view`, `selectedCharacter`, `characters`, `errorMessage`, `isLoadingCharacter`, `loadingCharacterName`, `isVideoVisible` | 7 |
| **Media/Video** | `isSpeaking`, `talkingVideoUrl`, `currentActionId`, `actionVideoUrls`, `isMuted`, `isMutedRef` | 6 |
| **Chat** | `chatHistory`, `aiSession`, `lastSavedMessageIndex`, `relationship` | 4 |
| **Tasks** | `tasks`, `isTaskPanelOpen` | 2 |
| **Calendar** | `upcomingEvents`, `weekEvents`, `kayleyContext` | 3 |
| **Email** | `isGmailConnected`, `emailQueue`, `debouncedEmailQueue` | 3 |
| **Proactive** | `isSnoozed`, `snoozeUntil`, `proactiveSettings` | 3 |
| **Character Management** | `characterForManagement`, `isCreatingAction`, `updatingActionId`, `deletingActionId`, `isAddingIdleVideo`, `deletingIdleVideoId`, `isUpdatingImage` | 7 |
| **Character Creation** | `uploadedImage`, `isSavingCharacter` | 2 |
| **Idle Tracking** | `lastInteractionAt`, `isProcessingAction` | 2 |
| **Refs** | `idleActionTimerRef`, `hasInteractedRef`, `lastIdleBreakerAtRef` | 3 |

### Functions by Domain

#### 1. Whiteboard Domain (~113 lines)
- `handleWhiteboardCapture()` - Main AI interaction handler for whiteboard mode

#### 2. Selfie/Image Generation (~100 lines)
- Selfie action handling within `handleSendMessage()`
- `generateCompanionSelfie()` call with presence state integration

#### 3. Task Domain (~197 lines)
- `handleTaskCreate()` - Creates task with celebration audio
- `handleTaskToggle()` - Toggles task completion with celebration
- `handleTaskDelete()` - Deletes task
- Task action parsing within `handleSendMessage()`

#### 4. Calendar Domain (~464 lines)
- `triggerCalendarCheckin()` - Triggers check-in for calendar events
- Calendar polling effect
- Week events fetching effect
- Calendar action handling (create/delete) in `handleSendMessage()`
- `[CALENDAR_CREATE]` and `[CALENDAR_DELETE]` tag parsing

#### 5. Email/Gmail Domain (~125 lines)
- Gmail polling effect
- Gmail event handlers (`handleNewMail`, `handleAuthError`)
- Email queue processing effect

#### 6. News Domain (~78 lines)
- News action handling within `handleSendMessage()`
- News fetching and story management

#### 7. Idle/Proactive Domain (~276 lines)
- `triggerIdleBreaker()` - Main idle breaker logic
- `triggerSystemMessage()` - System message triggering
- Idle timeout checking effect
- Prefetch on idle effect
- Morning briefing effect

#### 8. Character Actions/Video Domain (~224 lines)
- `playAction()` - Play action video
- `playRandomTalkingAction()` - Play random talking action
- `triggerIdleAction()` - Trigger random idle action
- `handleSpeechStart()` - Handle speech start
- `clearIdleActionTimer()` - Clear idle action timer
- `scheduleIdleAction()` - Schedule next idle action

#### 9. Character Management Domain (~557 lines)
- `handleImageUpload()` - Handle image upload
- `handleCharacterCreated()` - Create new character
- `handleCreateAction()` - Create action video
- `handleUpdateAction()` - Update action video
- `handleDeleteAction()` - Delete action video
- `handleSelectLocalVideo()` - Select local video file
- `handleManageCharacter()` - Enter management view
- `handleAddIdleVideo()` - Add idle video
- `handleDeleteIdleVideo()` - Delete idle video
- `handleSelectCharacter()` - Select character for chat
- `handleDeleteCharacter()` - Delete character
- `handleUpdateImage()` - Update character image
- `handleBackToSelection()` - Return to selection screen

#### 10. Message Handling Domain (~851 lines)
- `handleSendImage()` - Handle image message
- `handleSendMessage()` - Main message handler (LARGEST function)
- `handleUserInterrupt()` - Handle user interrupt
- `markInteraction()` - Mark user interaction

#### 11. Utility Functions (~118 lines)
- `sanitizeText()` - Text sanitization
- `extractJsonObject()` - JSON extraction helper
- `randomFromArray()` - Random array selection
- `shuffleArray()` - Array shuffling
- `isQuestionMessage()` - Question detection
- `isTalkingAction()` - Talking action detection
- `isGreetingAction()` - Greeting action detection
- `getGreetingActions()` - Get greeting actions
- `getNonGreetingActions()` - Get non-greeting actions
- `getTalkingActions()` - Get talking actions

---

## Proposed File Structure

```
src/
├── hooks/
│   ├── useMediaQueues.ts          (existing)
│   ├── useDebounce.ts             (existing)
│   ├── useCacheWarming.ts         (existing)
│   ├── useTasks.ts                (NEW)
│   ├── useTasks.README.md         (NEW - Required docs)
│   ├── useCalendar.ts             (NEW)
│   ├── useCalendar.README.md      (NEW - Required docs)
│   ├── useProactive.ts            (NEW)
│   ├── useProactive.README.md     (NEW - Required docs)
│   ├── useCharacterActions.ts     (NEW)
│   ├── useCharacterActions.README.md (NEW - Required docs)
│   ├── useCharacterManagement.ts  (NEW)
│   ├── useCharacterManagement.README.md (NEW - Required docs)
│   ├── useAIChat.ts               (NEW)
│   └── useAIChat.README.md        (NEW - Required docs)
│
├── handlers/
│   ├── README.md                  (NEW - Folder overview)
│   ├── messageActions/
│   │   ├── README.md              (NEW - Folder overview)
│   │   ├── index.ts               (NEW - Barrel export)
│   │   ├── calendarActions.ts     (NEW)
│   │   ├── taskActions.ts         (NEW)
│   │   ├── newsActions.ts         (NEW)
│   │   └── selfieActions.ts       (NEW)
│   └── whiteboardHandler.ts       (NEW)
│
├── utils/
│   ├── README.md                  (NEW - Folder overview)
│   ├── textUtils.ts               (NEW)
│   ├── jsonUtils.ts               (NEW)
│   ├── arrayUtils.ts              (NEW)
│   ├── enums.ts                   (NEW - Shared enums)
│   └── actionKeyMapper.ts         (existing)
│
└── App.tsx                        (REDUCED to ~500-700 lines)
```

---

## Detailed Migration Plan

---

### Phase 0: Create Shared Enums (Zero Risk) ✅ COMPLETE

**Status:** Completed on 2025-01-02
**Priority:** HIGHEST (Used by all other phases)

#### Files Created
- `src/utils/enums.ts` - All shared enums and constants
- `src/utils/README.md` - Documentation for utils folder

#### Verification
- **Build:** ✅ Successful
- **Tests:** 1077 passed (no regressions from baseline)

#### Implementation Notes for Future Phases

1. **Import Pattern:** When using enums in new files:
   ```typescript
   import { StorageKey, LogPrefix, Timing } from '../utils/enums';
   ```

2. **Additional Enums Added:** Beyond the original plan, we also added:
   - `ProactiveFeature` - For proactive feature toggles
   - `StorageBucket` - Supabase bucket names
   - `Timing` - Centralized timing constants (replaces magic numbers)
   - `LogPrefixType` - TypeScript type for LogPrefix values

3. **Timing Constants:** Use `Timing.*` instead of inline numbers:
   ```typescript
   // Instead of: setTimeout(fn, 5 * 60 * 1000)
   setTimeout(fn, Timing.IDLE_TIMEOUT);
   ```

4. **Backward Compatibility:** The enums use the same string values as the existing code, so gradual migration is safe. You can replace magic strings one at a time.

5. **Not Yet Migrated:** App.tsx still uses magic strings. Each subsequent phase should migrate to enums as code is extracted.

---

#### Original Plan (for reference):

##### Create `src/utils/enums.ts`:

```typescript
/**
 * Shared enums for the application.
 * Use these instead of magic strings for type safety.
 */

// === Storage Keys ===
export enum StorageKey {
  SnoozeIndefinite = 'kayley_snooze_indefinite',
  SnoozeUntil = 'kayley_snooze_until',
  ProactiveSettings = 'kayley_proactive_settings',
  LastBriefing = 'last_briefing',
}

// === Task Operations ===
export enum TaskAction {
  Create = 'create',
  Complete = 'complete',
  Delete = 'delete',
}

export enum TaskPriority {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

// === Calendar Operations ===
export enum CalendarAction {
  Create = 'create',
  Delete = 'delete',
}

export enum CalendarTag {
  Create = '[CALENDAR_CREATE]',
  Delete = '[CALENDAR_DELETE]',
}

// === Character Action Types ===
export enum ActionType {
  Talking = 'talking',
  Greeting = 'greeting',
  Idle = 'idle',
}

// === View States ===
export enum AppView {
  Loading = 'loading',
  SelectCharacter = 'selectCharacter',
  CreateCharacter = 'createCharacter',
  Chat = 'chat',
  ManageCharacter = 'manageCharacter',
  Whiteboard = 'whiteboard',
}

// === Message Types ===
export enum MessageRole {
  User = 'user',
  Model = 'model',
}

// === Log Prefixes (for consistent logging) ===
export const LogPrefix = {
  Tasks: '📋',
  Calendar: '📅',
  Email: '📧',
  Video: '🎬',
  Idle: '💤',
  Success: '✅',
  Error: '❌',
  Performance: '⚡',
  Loading: '🔄',
  Audio: '🔊',
} as const;
```

#### Create `src/utils/README.md`:

```markdown
# Utils

Shared utility functions and enums used across the application.

## Files

| File | Purpose |
|------|---------|
| `enums.ts` | Shared enums replacing magic strings |
| `textUtils.ts` | Text sanitization and question detection |
| `jsonUtils.ts` | JSON extraction from strings |
| `arrayUtils.ts` | Array shuffle and random selection |
| `actionKeyMapper.ts` | Action key mapping for LLM responses |

## Usage

\`\`\`typescript
import { StorageKey, TaskAction, LogPrefix } from '../utils/enums';
import { sanitizeText, isQuestionMessage } from '../utils/textUtils';
import { shuffleArray, randomFromArray } from '../utils/arrayUtils';

// Use enums instead of magic strings
localStorage.setItem(StorageKey.SnoozeUntil, JSON.stringify(Date.now() + 3600000));
console.log(\`\${LogPrefix.Tasks} Creating task...\`);
\`\`\`
```

**Dependencies:** None
**Risk:** Zero
**Test:** Compile-time type checking only

---

### Phase 1: Extract Utility Functions (Low Risk) ✅ COMPLETE

**Status:** Completed on 2025-01-02
**Priority:** HIGH (Foundation for other extractions)

#### Files Created
- `src/utils/textUtils.ts` - `sanitizeText()`, `isQuestionMessage()`, `QUESTION_STARTERS`
- `src/utils/jsonUtils.ts` - `extractJsonObject()`
- `src/utils/arrayUtils.ts` - `randomFromArray()`, `shuffleArray()`
- `src/utils/tests/textUtils.test.ts` - 16 tests
- `src/utils/tests/jsonUtils.test.ts` - 15 tests
- `src/utils/tests/arrayUtils.test.ts` - 13 tests

#### Files Modified
- `src/App.tsx` - Replaced inline definitions with imports (removed ~85 lines)
- `src/utils/README.md` - Added documentation for new utilities

#### Verification
- **Build:** ✅ Successful
- **Tests:** 1147 passed, 44 new tests added (all pass)

#### Implementation Notes for Future Phases

1. **Import Pattern:** When using these utilities:
   ```typescript
   import { sanitizeText, isQuestionMessage } from '../utils/textUtils';
   import { extractJsonObject } from '../utils/jsonUtils';
   import { randomFromArray, shuffleArray } from '../utils/arrayUtils';
   ```

2. **sanitizeText is widely used:** Other functions in App.tsx use `sanitizeText` (e.g., `isTalkingAction`, `isGreetingAction`). These will be extracted in Phase 6 (Character Actions Hook).

3. **extractJsonObject handles edge cases:** Properly handles nested braces, strings containing braces, escaped quotes, and markdown code blocks.

---

#### Original Plan (for reference):

#### Create `src/utils/textUtils.ts`:
```typescript
export const sanitizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const QUESTION_STARTERS = [
  'who','what','when','where','why','how',
  'do','does','did','can','could','would','will','is','are','am','was','were',
  'should','shall','have','has','had'
];

export const isQuestionMessage = (message: string): boolean => {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('?')) return true;
  const normalized = sanitizeText(trimmed);
  if (!normalized) return false;
  const firstWord = normalized.split(' ')[0];
  return QUESTION_STARTERS.includes(firstWord);
};
```

#### Create `src/utils/jsonUtils.ts`:
```typescript
export const extractJsonObject = (str: string): string | null => {
  const firstBrace = str.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = firstBrace; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') depth++;
      if (char === '}') depth--;

      if (depth === 0) {
        return str.substring(firstBrace, i + 1);
      }
    }
  }

  return null;
};
```

#### Create `src/utils/arrayUtils.ts`:
```typescript
export const randomFromArray = <T,>(items: T[]): T => {
  if (items.length === 0) {
    throw new Error('Cannot select a random item from an empty array.');
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
};

export const shuffleArray = <T,>(array: T[]): T[] => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};
```

**Dependencies:** None
**Risk:** Very Low

---

### Phase 2: Extract Task Hook (Medium Risk)

**Priority: HIGH (Self-contained domain)**

#### TDD: Write tests first `src/hooks/__tests__/useTasks.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTasks } from '../useTasks';
import * as taskService from '../../services/taskService';

vi.mock('../../services/taskService');
vi.mock('../../services/elevenLabsService', () => ({
  generateSpeech: vi.fn().mockResolvedValue('audio-url'),
}));

describe('useTasks', () => {
  const mockOptions = {
    selectedCharacter: { actions: [] },
    isMuted: false,
    enqueueAudio: vi.fn(),
    playAction: vi.fn(),
    addChatMessage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load tasks', async () => {
    const mockTasks = [{ id: '1', text: 'Test task', completed: false }];
    vi.mocked(taskService.fetchTasks).mockResolvedValue(mockTasks);

    const { result } = renderHook(() => useTasks(mockOptions));

    await act(async () => {
      await result.current.loadTasks();
    });

    expect(result.current.tasks).toEqual(mockTasks);
  });

  it('should create a task', async () => {
    const newTask = { id: '2', text: 'New task', completed: false };
    vi.mocked(taskService.createTask).mockResolvedValue(newTask);

    const { result } = renderHook(() => useTasks(mockOptions));

    await act(async () => {
      await result.current.handleTaskCreate('New task');
    });

    expect(result.current.tasks).toContainEqual(newTask);
  });

  it('should toggle a task', async () => {
    // ... test implementation
  });

  it('should delete a task', async () => {
    // ... test implementation
  });
});
```

#### Create `src/hooks/useTasks.ts`:

```typescript
import { useState, useCallback } from 'react';
import { Task, CharacterProfile, ChatMessage } from '../types';
import { TaskPriority, LogPrefix, MessageRole } from '../utils/enums';
import * as taskService from '../services/taskService';
import { generateSpeech } from '../services/elevenLabsService';

interface UseTasksOptions {
  selectedCharacter: CharacterProfile | null;
  isMuted: boolean;
  enqueueAudio: (audio: string) => void;
  playAction: (actionId: string) => boolean;
  addChatMessage: (message: ChatMessage) => void;
}

interface UseTasksResult {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  isTaskPanelOpen: boolean;
  setIsTaskPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleTaskCreate: (text: string, priority?: TaskPriority) => Promise<void>;
  handleTaskToggle: (taskId: string) => Promise<void>;
  handleTaskDelete: (taskId: string) => Promise<void>;
  loadTasks: () => Promise<Task[]>;
}

const CELEBRATIONS = {
  create: [
    "Got it! Added to your list",
    "Done! I'll help you remember that.",
    "Added! One step at a time",
    "On the list! You've got this."
  ],
  complete: [
    "Nice! That's one thing off your plate",
    "You crushed it! One down!",
    "Look at you go!",
    "Done and done! Great work",
    "Boom! Another one bites the dust!"
  ],
};

export function useTasks(options: UseTasksOptions): UseTasksResult {
  const { selectedCharacter, isMuted, enqueueAudio, playAction, addChatMessage } = options;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);

  const handleTaskCreate = useCallback(async (text: string, priority?: TaskPriority) => {
    console.log(`${LogPrefix.Tasks} [useTasks] Creating task:`, text);

    const newTask = await taskService.createTask(text, priority);
    if (newTask) {
      console.log(`${LogPrefix.Success} [useTasks] Task created:`, newTask.id);
      setTasks(prev => [...prev, newTask]);

      if (selectedCharacter && !isMuted) {
        const message = CELEBRATIONS.create[Math.floor(Math.random() * CELEBRATIONS.create.length)];

        generateSpeech(message).then(audio => {
          if (audio) enqueueAudio(audio);
        });

        addChatMessage({ role: MessageRole.Model, text: message });
      }
    }
  }, [selectedCharacter, isMuted, enqueueAudio, addChatMessage]);

  const handleTaskToggle = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      console.log(`${LogPrefix.Error} [useTasks] Task not found:`, taskId);
      return;
    }

    console.log(`${LogPrefix.Tasks} [useTasks] Toggling task:`, taskId, '-> completed:', !task.completed);

    const updatedTask = await taskService.toggleTask(taskId, task.completed);
    if (updatedTask) {
      console.log(`${LogPrefix.Success} [useTasks] Task toggled:`, taskId);
      setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));

      if (updatedTask.completed && selectedCharacter && !isMuted) {
        const message = CELEBRATIONS.complete[Math.floor(Math.random() * CELEBRATIONS.complete.length)];

        generateSpeech(message).then(audio => {
          if (audio) enqueueAudio(audio);
        });

        addChatMessage({ role: MessageRole.Model, text: message });

        // Play a positive action if available
        const positiveActions = selectedCharacter.actions.filter(a =>
          a.name.toLowerCase().includes('happy') ||
          a.name.toLowerCase().includes('celebrate') ||
          a.name.toLowerCase().includes('excited')
        );
        if (positiveActions.length > 0) {
          playAction(positiveActions[0].id);
        }
      }
    }
  }, [tasks, selectedCharacter, isMuted, enqueueAudio, addChatMessage, playAction]);

  const handleTaskDelete = useCallback(async (taskId: string) => {
    console.log(`${LogPrefix.Tasks} [useTasks] Deleting task:`, taskId);

    const success = await taskService.deleteTask(taskId);
    if (success) {
      console.log(`${LogPrefix.Success} [useTasks] Task deleted:`, taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } else {
      console.log(`${LogPrefix.Error} [useTasks] Failed to delete task:`, taskId);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    console.log(`${LogPrefix.Loading} [useTasks] Loading tasks...`);
    const currentTasks = await taskService.fetchTasks();
    console.log(`${LogPrefix.Success} [useTasks] Loaded ${currentTasks.length} tasks`);
    setTasks(currentTasks);
    return currentTasks;
  }, []);

  return {
    tasks,
    setTasks,
    isTaskPanelOpen,
    setIsTaskPanelOpen,
    handleTaskCreate,
    handleTaskToggle,
    handleTaskDelete,
    loadTasks,
  };
}
```

#### Create `src/hooks/useTasks.README.md`:

```markdown
# useTasks Hook

## Purpose
Manages task state and CRUD operations with audio/visual feedback.

## Usage
\`\`\`typescript
const {
  tasks,
  isTaskPanelOpen,
  setIsTaskPanelOpen,
  handleTaskCreate,
  handleTaskToggle,
  handleTaskDelete,
  loadTasks,
} = useTasks({
  selectedCharacter,
  isMuted,
  enqueueAudio: media.enqueueAudio,
  playAction,
  addChatMessage: (msg) => setChatHistory(prev => [...prev, msg]),
});
\`\`\`

## Exports
- \`useTasks(options)\` - Main hook

## Dependencies
- \`taskService\` - Supabase task operations
- \`generateSpeech\` - ElevenLabs audio generation

## State Managed
- \`tasks: Task[]\` - Current task list
- \`isTaskPanelOpen: boolean\` - Panel visibility

## Related Files
- \`src/services/taskService.ts\` - Backend service
- \`src/components/TaskPanel.tsx\` - UI component
- \`src/utils/enums.ts\` - TaskPriority enum
```

**Dependencies:**
- `taskService` (existing)
- `generateSpeech` (for celebration audio)
- `enums.ts` (for TaskPriority, LogPrefix, MessageRole)

**Risk:** Medium (relies on audio/action callbacks)

---

### Phase 3: Extract Calendar Hook (Medium Risk)

**Priority: MEDIUM (Connected to proactive features)**

#### Create `src/hooks/useCalendar.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import {
  calendarService,
  type CalendarEvent
} from '../services/calendarService';
import {
  getApplicableCheckin,
  markCheckinDone,
  buildEventCheckinPrompt,
  cleanupOldCheckins,
  type CheckinType,
} from '../services/calendarCheckinService';
import type { CharacterProfile, ProactiveSettings } from '../types';

interface UseCalendarOptions {
  session: { accessToken: string } | null;
  selectedCharacter: CharacterProfile | null;
  proactiveSettings: ProactiveSettings;
  isSnoozed: boolean;
  isProcessingAction: boolean;
  isSpeaking: boolean;
  triggerSystemMessage: (prompt: string) => Promise<void>;
}

interface UseCalendarResult {
  upcomingEvents: CalendarEvent[];
  weekEvents: CalendarEvent[];
  setUpcomingEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>;
  refreshEvents: (accessToken: string) => Promise<CalendarEvent[]>;
  refreshWeekEvents: (accessToken: string) => Promise<void>;
  triggerCalendarCheckin: (event: CalendarEvent, type: CheckinType) => void;
}

export function useCalendar(options: UseCalendarOptions): UseCalendarResult {
  const {
    session,
    selectedCharacter,
    proactiveSettings,
    isSnoozed,
    isProcessingAction,
    isSpeaking,
    triggerSystemMessage,
  } = options;

  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>([]);

  const refreshEvents = useCallback(async (accessToken: string) => {
    const events = await calendarService.getUpcomingEvents(accessToken);
    setUpcomingEvents(events);
    return events;
  }, []);

  const refreshWeekEvents = useCallback(async (accessToken: string) => {
    const events = await calendarService.getWeekEvents(accessToken);
    setWeekEvents(events);
    cleanupOldCheckins(events.map(e => e.id));
  }, []);

  const triggerCalendarCheckin = useCallback((event: CalendarEvent, type: CheckinType) => {
    if (isSnoozed || !proactiveSettings.calendar) {
      console.log(`Skipping calendar check-in (snoozed: ${isSnoozed}, calendar enabled: ${proactiveSettings.calendar})`);
      return;
    }

    markCheckinDone(event.id, type);
    const prompt = buildEventCheckinPrompt(event, type);
    console.log(`Triggering ${type} check-in for event: ${event.summary}`);
    triggerSystemMessage(prompt);
  }, [isSnoozed, proactiveSettings.calendar, triggerSystemMessage]);

  // Calendar polling effect
  useEffect(() => {
    if (!session) return;

    const pollCalendar = async () => {
      try {
        console.log("Polling calendar events...");
        const events = await calendarService.getUpcomingEvents(session.accessToken);
        setUpcomingEvents(events);
      } catch (e) {
        console.error("Calendar poll failed", e);
      }
    };

    pollCalendar();
    const intervalId = setInterval(pollCalendar, 300000); // 5 minutes

    return () => clearInterval(intervalId);
  }, [session]);

  // Week events fetching effect
  useEffect(() => {
    if (!session) return;

    const fetchWeekEvents = async () => {
      try {
        console.log("Fetching week calendar events for proactive check-ins...");
        const events = await calendarService.getWeekEvents(session.accessToken);
        setWeekEvents(events);
        cleanupOldCheckins(events.map(e => e.id));
      } catch (e) {
        console.error('Week calendar fetch failed', e);
      }
    };

    fetchWeekEvents();
    const interval = setInterval(fetchWeekEvents, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [session]);

  // Calendar check-in effect
  useEffect(() => {
    if (!selectedCharacter || weekEvents.length === 0 || !proactiveSettings.calendar) return;

    const checkCalendarEvents = () => {
      if (isProcessingAction || isSpeaking) return;

      for (const event of weekEvents) {
        const applicableType = getApplicableCheckin(event);
        if (applicableType) {
          triggerCalendarCheckin(event, applicableType);
          break;
        }
      }
    };

    const interval = setInterval(checkCalendarEvents, 2 * 60 * 1000);
    const initialCheck = setTimeout(checkCalendarEvents, 30000);

    return () => {
      clearInterval(interval);
      clearTimeout(initialCheck);
    };
  }, [weekEvents, selectedCharacter, isProcessingAction, isSpeaking, proactiveSettings.calendar, triggerCalendarCheckin]);

  return {
    upcomingEvents,
    weekEvents,
    setUpcomingEvents,
    refreshEvents,
    refreshWeekEvents,
    triggerCalendarCheckin,
  };
}
```

**Dependencies:**
- `calendarService` (existing)
- `calendarCheckinService` (existing)
- `proactiveSettings` state

**Risk:** Medium (connected to proactive system)

---

### Phase 4: Extract Proactive Hook (High Complexity)

**Priority: MEDIUM (Core feature but high coupling)**

#### Create `src/hooks/useProactive.ts`:

```typescript
import { useState, useCallback } from 'react';
import { ProactiveSettings, DEFAULT_PROACTIVE_SETTINGS } from '../types';
import { StorageKey, LogPrefix } from '../utils/enums';

interface UseProactiveResult {
  proactiveSettings: ProactiveSettings;
  updateProactiveSettings: (updates: Partial<ProactiveSettings>) => void;
  isSnoozed: boolean;
  snoozeUntil: number | null;
  setSnooze: (until: number | null) => void;
  clearSnooze: () => void;
  loadSnoozeState: () => void;
}

// Helper to safely get boolean from localStorage
const getStoredBoolean = (key: StorageKey, defaultValue = false): boolean => {
  const stored = localStorage.getItem(key);
  if (stored === null) return defaultValue;
  return JSON.parse(stored) as boolean;
};

// Helper to safely get number from localStorage
const getStoredNumber = (key: StorageKey): number | null => {
  const stored = localStorage.getItem(key);
  if (stored === null) return null;
  return JSON.parse(stored) as number;
};

export function useProactive(): UseProactiveResult {
  const [proactiveSettings, setProactiveSettings] = useState<ProactiveSettings>(() => {
    const stored = localStorage.getItem(StorageKey.ProactiveSettings);
    return stored ? JSON.parse(stored) : DEFAULT_PROACTIVE_SETTINGS;
  });

  const [isSnoozed, setIsSnoozed] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);

  const updateProactiveSettings = useCallback((updates: Partial<ProactiveSettings>) => {
    setProactiveSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem(StorageKey.ProactiveSettings, JSON.stringify(next));
      console.log(`${LogPrefix.Idle} [useProactive] Settings updated:`, next);
      return next;
    });
  }, []);

  const setSnooze = useCallback((until: number | null) => {
    console.log(`${LogPrefix.Idle} [useProactive] Setting snooze:`, until === null ? 'indefinite' : new Date(until).toLocaleTimeString());
    setIsSnoozed(true);
    setSnoozeUntil(until);

    if (until === null) {
      // Indefinite snooze - store as boolean true
      localStorage.setItem(StorageKey.SnoozeIndefinite, JSON.stringify(true));
      localStorage.removeItem(StorageKey.SnoozeUntil);
    } else {
      // Timed snooze - store timestamp as number
      localStorage.removeItem(StorageKey.SnoozeIndefinite);
      localStorage.setItem(StorageKey.SnoozeUntil, JSON.stringify(until));
    }
  }, []);

  const clearSnooze = useCallback(() => {
    console.log(`${LogPrefix.Idle} [useProactive] Clearing snooze`);
    setIsSnoozed(false);
    setSnoozeUntil(null);
    localStorage.removeItem(StorageKey.SnoozeIndefinite);
    localStorage.removeItem(StorageKey.SnoozeUntil);
  }, []);

  const loadSnoozeState = useCallback(() => {
    console.log(`${LogPrefix.Loading} [useProactive] Loading snooze state...`);

    const isIndefinite = getStoredBoolean(StorageKey.SnoozeIndefinite);
    const storedUntil = getStoredNumber(StorageKey.SnoozeUntil);

    if (isIndefinite) {
      setIsSnoozed(true);
      setSnoozeUntil(null);
      console.log(`${LogPrefix.Idle} [useProactive] Check-ins snoozed indefinitely`);
    } else if (storedUntil !== null) {
      if (Date.now() < storedUntil) {
        setIsSnoozed(true);
        setSnoozeUntil(storedUntil);
        console.log(`${LogPrefix.Idle} [useProactive] Check-ins snoozed until`, new Date(storedUntil).toLocaleTimeString());
      } else {
        // Snooze expired
        localStorage.removeItem(StorageKey.SnoozeUntil);
        setIsSnoozed(false);
        setSnoozeUntil(null);
        console.log(`${LogPrefix.Idle} [useProactive] Snooze expired (cleared on load)`);
      }
    } else {
      console.log(`${LogPrefix.Idle} [useProactive] No snooze active`);
    }
  }, []);

  return {
    proactiveSettings,
    updateProactiveSettings,
    isSnoozed,
    snoozeUntil,
    setSnooze,
    clearSnooze,
    loadSnoozeState,
  };
}
```

#### Create `src/hooks/useProactive.README.md`:

```markdown
# useProactive Hook

## Purpose
Manages proactive feature settings and snooze state with proper localStorage persistence.

## Usage
\`\`\`typescript
const {
  proactiveSettings,
  updateProactiveSettings,
  isSnoozed,
  snoozeUntil,
  setSnooze,
  clearSnooze,
  loadSnoozeState,
} = useProactive();

// On character load
useEffect(() => {
  loadSnoozeState();
}, []);

// Snooze for 1 hour
setSnooze(Date.now() + 60 * 60 * 1000);

// Snooze indefinitely
setSnooze(null);
\`\`\`

## Exports
- \`useProactive()\` - Main hook (no options needed)

## Dependencies
- \`StorageKey\` enum for localStorage keys
- \`LogPrefix\` for consistent logging

## State Managed
- \`proactiveSettings: ProactiveSettings\` - Feature toggles
- \`isSnoozed: boolean\` - Whether check-ins are snoozed
- \`snoozeUntil: number | null\` - Snooze end timestamp (null = indefinite)

## Storage Format
All values stored as JSON (not string booleans):
- \`StorageKey.SnoozeIndefinite\`: \`true\` (boolean)
- \`StorageKey.SnoozeUntil\`: \`1704067200000\` (number timestamp)
- \`StorageKey.ProactiveSettings\`: \`{...}\` (object)
```

**Dependencies:**
- `StorageKey` enum (from enums.ts)
- `LogPrefix` for logging

**Risk:** HIGH (heavily coupled, consider partial extraction)

---

### Phase 5: Extract Message Action Handlers (High Priority)

**Priority: HIGH (Biggest cleanup impact)**

#### Create `src/handlers/messageActions/calendarActions.ts`:

```typescript
import { calendarService, type CalendarEvent, type NewEventPayload } from '../../services/calendarService';
import { extractJsonObject } from '../../utils/jsonUtils';
import { CalendarTag, LogPrefix } from '../../utils/enums';

interface CalendarActionResult {
  handled: boolean;
  displayText?: string;
  eventCreated?: boolean;
  eventDeleted?: boolean;
  error?: string;
}

export async function handleCalendarCreateTag(
  responseText: string,
  accessToken: string,
  setUpcomingEvents: (events: CalendarEvent[]) => void
): Promise<CalendarActionResult> {
  const calendarTagIndex = responseText.indexOf(CalendarTag.Create);

  if (calendarTagIndex === -1) {
    return { handled: false };
  }

  console.log(`${LogPrefix.Calendar} [calendarActions] Found CALENDAR_CREATE tag`);

  try {
    const tagLength = '[CALENDAR_CREATE]'.length;
    let jsonString = responseText.substring(calendarTagIndex + tagLength).trim();
    jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();

    const extracted = extractJsonObject(jsonString);
    if (!extracted) {
      throw new Error('Could not extract JSON from response');
    }

    const eventData: NewEventPayload = JSON.parse(extracted);

    if (!eventData.summary || !eventData.start?.dateTime || !eventData.end?.dateTime) {
      throw new Error('Missing required fields (summary, start.dateTime, end.dateTime)');
    }

    const confirmationText = `Okay, I'll add "${eventData.summary}" to your calendar.`;
    const textBeforeTag = responseText.substring(0, calendarTagIndex).trim();
    const displayText = textBeforeTag ? `${textBeforeTag}\n\n${confirmationText}` : confirmationText;

    console.log("Creating event:", eventData);
    await calendarService.createEvent(accessToken, eventData);

    const events = await calendarService.getUpcomingEvents(accessToken);
    setUpcomingEvents(events);

    return {
      handled: true,
      displayText,
      eventCreated: true,
    };
  } catch (e) {
    console.error("Failed to create calendar event", e);
    const textBeforeTag = responseText.substring(0, calendarTagIndex).trim();
    const errorText = "I tried to create that event, but I got confused by the details. Could you try again?";

    return {
      handled: true,
      displayText: textBeforeTag ? `${textBeforeTag}\n\n(System: ${errorText})` : errorText,
      error: String(e),
    };
  }
}

export async function handleCalendarDeleteTag(
  responseText: string,
  accessToken: string,
  setUpcomingEvents: (events: CalendarEvent[]) => void
): Promise<CalendarActionResult> {
  const deleteTagIndex = responseText.indexOf('[CALENDAR_DELETE]');

  if (deleteTagIndex === -1) {
    return { handled: false };
  }

  try {
    const tagLength = '[CALENDAR_DELETE]'.length;
    let jsonString = responseText.substring(deleteTagIndex + tagLength).trim();
    jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();

    const extracted = extractJsonObject(jsonString);
    if (!extracted) {
      throw new Error('Could not extract JSON from response');
    }

    const deleteData = JSON.parse(extracted);
    const eventId = deleteData.event_id || deleteData.eventId;

    if (!eventId) {
      throw new Error('Missing event_id in delete request');
    }

    console.log("Deleting event:", eventId);
    await calendarService.deleteEvent(accessToken, eventId);

    const events = await calendarService.getUpcomingEvents(accessToken);
    setUpcomingEvents(events);

    const textBeforeTag = responseText.substring(0, deleteTagIndex).trim();
    const confirmationText = "Done! I've removed that from your calendar.";
    const displayText = textBeforeTag ? `${textBeforeTag}\n\n${confirmationText}` : confirmationText;

    return {
      handled: true,
      displayText,
      eventDeleted: true,
    };
  } catch (e) {
    console.error("Failed to delete calendar event", e);
    const textBeforeTag = responseText.substring(0, deleteTagIndex).trim();
    const errorText = "I tried to delete that event, but something went wrong. Could you try again?";

    return {
      handled: true,
      displayText: textBeforeTag ? `${textBeforeTag}\n\n(System: ${errorText})` : errorText,
      error: String(e),
    };
  }
}
```

#### Create `src/handlers/messageActions/taskActions.ts`:

```typescript
import { Task } from '../../types';
import * as taskService from '../../services/taskService';

interface TaskActionResult {
  handled: boolean;
  action?: 'create' | 'complete' | 'delete';
  taskText?: string;
  taskId?: string;
}

export function parseTaskAction(
  responseText: string,
  userMessage: string,
  tasks: Task[]
): TaskActionResult {
  // Check for task creation patterns
  const createPatterns = [
    /(?:add|create|make|new)\s+(?:a\s+)?task[:\s]+["']?(.+?)["']?$/i,
    /(?:remind me to|don't forget to|remember to)\s+(.+)$/i,
  ];

  for (const pattern of createPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      return {
        handled: true,
        action: 'create',
        taskText: match[1].trim(),
      };
    }
  }

  // Check for task completion patterns
  const completePatterns = [
    /(?:complete|finish|done with|mark done)\s+(?:the\s+)?task[:\s]+["']?(.+?)["']?$/i,
    /(?:i\s+)?(?:completed|finished|did)\s+["']?(.+?)["']?$/i,
  ];

  for (const pattern of completePatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const taskText = match[1].trim().toLowerCase();
      const task = tasks.find(t =>
        t.text.toLowerCase().includes(taskText) ||
        taskText.includes(t.text.toLowerCase())
      );
      if (task) {
        return {
          handled: true,
          action: 'complete',
          taskId: task.id,
          taskText: task.text,
        };
      }
    }
  }

  return { handled: false };
}

export async function executeTaskAction(
  action: TaskActionResult,
  options: {
    handleTaskCreate: (text: string) => Promise<void>;
    handleTaskToggle: (taskId: string) => Promise<void>;
  }
): Promise<void> {
  if (!action.handled) return;

  if (action.action === 'create' && action.taskText) {
    await options.handleTaskCreate(action.taskText);
  } else if (action.action === 'complete' && action.taskId) {
    await options.handleTaskToggle(action.taskId);
  }
}
```

#### Create `src/handlers/messageActions/newsActions.ts`:

```typescript
import {
  fetchTechNews,
  markStoryMentioned,
  storeLastSharedStories,
} from '../../services/newsService';

interface NewsActionResult {
  handled: boolean;
  stories?: any[];
  error?: string;
}

export async function handleNewsAction(
  responseText: string,
  userMessage: string
): Promise<NewsActionResult> {
  const newsPatterns = [
    /(?:what's|whats|what is)\s+(?:the\s+)?(?:latest|new|recent)\s+(?:in\s+)?(?:tech|technology|news)/i,
    /(?:tell me|share|give me)\s+(?:some\s+)?(?:tech\s+)?news/i,
    /(?:any\s+)?(?:interesting\s+)?(?:tech\s+)?news\s+(?:today|lately)/i,
  ];

  const isNewsRequest = newsPatterns.some(pattern => pattern.test(userMessage));

  if (!isNewsRequest) {
    return { handled: false };
  }

  try {
    const stories = await fetchTechNews();

    if (stories.length > 0) {
      // Mark stories as mentioned and store for context
      stories.slice(0, 3).forEach(story => markStoryMentioned(story.id));
      await storeLastSharedStories(stories.slice(0, 3));
    }

    return {
      handled: true,
      stories,
    };
  } catch (e) {
    console.error('Failed to fetch news:', e);
    return {
      handled: true,
      error: String(e),
    };
  }
}
```

#### Create `src/handlers/messageActions/selfieActions.ts`:

```typescript
import { generateCompanionSelfie } from '../../services/imageGenerationService';
import { getKayleyPresenceState } from '../../services/kayleyPresenceService';

interface SelfieActionResult {
  handled: boolean;
  imageUrl?: string;
  error?: string;
}

export async function handleSelfieAction(
  responseText: string,
  userMessage: string
): Promise<SelfieActionResult> {
  const selfiePatterns = [
    /(?:send|take|share)\s+(?:me\s+)?(?:a\s+)?(?:selfie|pic|picture|photo)/i,
    /(?:show me|let me see)\s+(?:your\s+)?(?:face|you|yourself)/i,
    /(?:what do you look like|how do you look)/i,
  ];

  const isSelfieRequest = selfiePatterns.some(pattern => pattern.test(userMessage));

  if (!isSelfieRequest) {
    return { handled: false };
  }

  try {
    const presenceState = await getKayleyPresenceState();
    const imageUrl = await generateCompanionSelfie(presenceState);

    return {
      handled: true,
      imageUrl,
    };
  } catch (e) {
    console.error('Failed to generate selfie:', e);
    return {
      handled: true,
      error: String(e),
    };
  }
}
```

#### Create `src/handlers/messageActions/index.ts`:

```typescript
export * from './calendarActions';
export * from './taskActions';
export * from './newsActions';
export * from './selfieActions';
```

**Dependencies:** Various services

**Risk:** HIGH (largest function, requires careful testing)

---

### Phase 6: Extract Character Action Hook ✅ Complete (2025-01-03)

**Priority: MEDIUM**

#### Create `src/hooks/useCharacterActions.ts`:

```typescript
import { useState, useCallback, useRef } from 'react';
import { CharacterProfile, CharacterAction } from '../types';
import { supabase } from '../services/supabaseClient';
import { shuffleArray } from '../utils/arrayUtils';

const ACTION_VIDEO_BUCKET = 'character-action-videos';
const IDLE_ACTION_DELAY_MIN_MS = 10_000;
const IDLE_ACTION_DELAY_MAX_MS = 45_000;

const TALKING_KEYWORDS = ['talk', 'talking', 'speak', 'chat', 'answer', 'respond'];

const sanitizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const isTalkingAction = (action: CharacterAction): boolean => {
  const normalizedName = sanitizeText(action.name);
  if (TALKING_KEYWORDS.some(keyword => normalizedName.includes(keyword))) {
    return true;
  }
  const normalizedPhrases = action.phrases.map(sanitizeText);
  return normalizedPhrases.some(phrase =>
    TALKING_KEYWORDS.some(keyword => phrase.includes(keyword))
  );
};

const isGreetingAction = (action: CharacterAction): boolean => {
  const normalizedName = sanitizeText(action.name);
  const normalizedPhrases = action.phrases.map(sanitizeText);
  return (
    normalizedName.includes('greeting') ||
    normalizedPhrases.some(phrase => phrase.includes('greeting'))
  );
};

interface UseCharacterActionsOptions {
  selectedCharacter: CharacterProfile | null;
  isProcessingAction: boolean;
  media: {
    playAction: (url: string, forceImmediate?: boolean) => void;
  };
}

interface UseCharacterActionsResult {
  currentActionId: string | null;
  actionVideoUrls: Record<string, string>;
  setActionVideoUrls: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  playAction: (actionId: string, forceImmediate?: boolean) => boolean;
  playRandomTalkingAction: (forceImmediate?: boolean) => string | null;
  triggerIdleAction: () => void;
  scheduleIdleAction: () => void;
  clearIdleActionTimer: () => void;
  isTalkingActionId: (actionId: string) => boolean;
  getTalkingActions: () => CharacterAction[];
  getNonGreetingActions: () => CharacterAction[];
  getGreetingActions: () => CharacterAction[];
}

export function useCharacterActions(options: UseCharacterActionsOptions): UseCharacterActionsResult {
  const { selectedCharacter, isProcessingAction, media } = options;

  const [currentActionId, setCurrentActionId] = useState<string | null>(null);
  const [actionVideoUrls, setActionVideoUrls] = useState<Record<string, string>>({});
  const idleActionTimerRef = useRef<number | null>(null);

  const getActionUrl = useCallback((actionId: string): string | null => {
    let actionUrl = actionVideoUrls[actionId] ?? null;

    if (!actionUrl) {
      const action = selectedCharacter?.actions.find(a => a.id === actionId);
      if (action?.videoPath) {
        const { data } = supabase.storage
          .from(ACTION_VIDEO_BUCKET)
          .getPublicUrl(action.videoPath);
        actionUrl = data?.publicUrl ?? null;
      }
    }

    return actionUrl;
  }, [actionVideoUrls, selectedCharacter]);

  const playAction = useCallback((actionId: string, forceImmediate = false): boolean => {
    const actionUrl = getActionUrl(actionId);
    if (!actionUrl) return false;

    media.playAction(actionUrl, forceImmediate);
    setCurrentActionId(actionId);
    return true;
  }, [getActionUrl, media]);

  const getTalkingActions = useCallback((): CharacterAction[] => {
    if (!selectedCharacter) return [];
    return selectedCharacter.actions.filter(isTalkingAction);
  }, [selectedCharacter]);

  const getNonGreetingActions = useCallback((): CharacterAction[] => {
    if (!selectedCharacter) return [];
    return selectedCharacter.actions.filter(action => !isGreetingAction(action));
  }, [selectedCharacter]);

  const getGreetingActions = useCallback((): CharacterAction[] => {
    if (!selectedCharacter) return [];
    return selectedCharacter.actions.filter(isGreetingAction);
  }, [selectedCharacter]);

  const playRandomTalkingAction = useCallback((forceImmediate = true): string | null => {
    const talkingActions = shuffleArray(getTalkingActions());
    for (const action of talkingActions) {
      const played = playAction(action.id, forceImmediate);
      if (played) {
        return action.id;
      }
    }
    return null;
  }, [getTalkingActions, playAction]);

  const isTalkingActionId = useCallback((actionId: string): boolean => {
    const action = selectedCharacter?.actions.find(a => a.id === actionId);
    return action ? isTalkingAction(action) : false;
  }, [selectedCharacter]);

  const clearIdleActionTimer = useCallback(() => {
    if (idleActionTimerRef.current !== null) {
      window.clearTimeout(idleActionTimerRef.current);
      idleActionTimerRef.current = null;
    }
  }, []);

  const triggerIdleAction = useCallback(() => {
    if (!selectedCharacter || selectedCharacter.actions.length === 0) return;

    const nonGreetingActions = getNonGreetingActions();
    if (nonGreetingActions.length === 0) return;

    const action = nonGreetingActions[Math.floor(Math.random() * nonGreetingActions.length)];
    const actionUrl = getActionUrl(action.id);

    if (actionUrl) {
      media.playAction(actionUrl);
      setCurrentActionId(action.id);
    }
  }, [selectedCharacter, getNonGreetingActions, getActionUrl, media]);

  const scheduleIdleAction = useCallback(() => {
    clearIdleActionTimer();

    if (!selectedCharacter || selectedCharacter.actions.length === 0) return;
    if (isProcessingAction) return;

    const delay =
      Math.floor(
        Math.random() *
          (IDLE_ACTION_DELAY_MAX_MS - IDLE_ACTION_DELAY_MIN_MS + 1)
      ) + IDLE_ACTION_DELAY_MIN_MS;

    idleActionTimerRef.current = window.setTimeout(() => {
      triggerIdleAction();
    }, delay);
  }, [clearIdleActionTimer, selectedCharacter, isProcessingAction, triggerIdleAction]);

  return {
    currentActionId,
    actionVideoUrls,
    setActionVideoUrls,
    playAction,
    playRandomTalkingAction,
    triggerIdleAction,
    scheduleIdleAction,
    clearIdleActionTimer,
    isTalkingActionId,
    getTalkingActions,
    getNonGreetingActions,
    getGreetingActions,
  };
}
```

**Dependencies:**
- `useMediaQueues` hook
- Character profile
- Supabase storage

**Risk:** Medium

---

### Phase 7: Extract Character Management Hook (Medium Risk)

**Priority: LOW (used less frequently)**

This phase extracts all character CRUD operations into a dedicated hook. The implementation follows the same pattern as the previous hooks but handles:
- Action creation/update/delete
- Idle video management
- Character image updates
- Character selection and deletion

**File:** `src/hooks/useCharacterManagement.ts`

**Risk:** Medium

---

### Phase 8: Extract Whiteboard Handler (Low Risk)

**Priority: MEDIUM (self-contained)**

#### Create `src/handlers/whiteboardHandler.ts`:

```typescript
import { CharacterProfile } from '../types';
import { AIChatSession, IAIChatService } from '../services/aiService';
import { parseWhiteboardAction, WhiteboardAction } from '../services/whiteboardModes';

interface WhiteboardHandlerOptions {
  selectedCharacter: CharacterProfile | null;
  session: { accessToken: string } | null;
  aiSession: AIChatSession | null;
  setAiSession: (session: AIChatSession) => void;
  activeService: IAIChatService;
  playAction: (actionId: string) => boolean;
  isMutedRef: React.MutableRefObject<boolean>;
  enqueueAudio: (audio: string) => void;
}

interface WhiteboardHandlerResult {
  textResponse: string;
  whiteboardAction: WhiteboardAction | null;
}

export async function handleWhiteboardCapture(
  base64: string,
  userMessage: string,
  modeContext: string,
  options: WhiteboardHandlerOptions
): Promise<WhiteboardHandlerResult> {
  const {
    selectedCharacter,
    session,
    aiSession,
    setAiSession,
    activeService,
    playAction,
    isMutedRef,
    enqueueAudio,
  } = options;

  if (!selectedCharacter || !session) {
    throw new Error('Missing character or session');
  }

  const sessionToUse: AIChatSession = aiSession || { model: activeService.model };

  const { response, session: updatedSession, audioData } = await activeService.generateResponse(
    {
      type: 'image_text',
      text: `${modeContext}\n\nUser says: "${userMessage}"`,
      imageData: base64,
      mimeType: 'image/png',
    },
    {
      chatHistory: [],
      googleAccessToken: session.accessToken,
    },
    sessionToUse
  );

  setAiSession(updatedSession);

  // Parse for whiteboard actions
  const whiteboardAction = parseWhiteboardAction(response.text_response);

  // Handle audio
  if (!isMutedRef.current && audioData) {
    enqueueAudio(audioData);
  }

  // Handle action video
  if (response.action_id) {
    playAction(response.action_id);
  }

  return {
    textResponse: response.text_response,
    whiteboardAction,
  };
}
```

**Dependencies:**
- AI service
- Whiteboard modes

**Risk:** Low (well-isolated)

---

### Phase 9: Extract Email Hook (Low Priority)

**Priority: LOW (feature often unused)**

#### Create `src/hooks/useEmail.ts`:

Similar pattern to other hooks, extracting Gmail-related state and effects.

**Risk:** Low

---

## Dependency Graph

```
App.tsx
├── useMediaQueues (existing)
├── useTasks (Phase 2)
│   └── taskService
├── useCalendar (Phase 3)
│   ├── calendarService
│   └── calendarCheckinService
├── useProactive (Phase 4)
│   └── useIdleBreaker
│       ├── AI Service
│       └── useCalendar
├── useCharacterActions (Phase 6)
│   └── useMediaQueues
├── useCharacterManagement (Phase 7)
│   ├── dbService
│   └── useCharacterActions
├── useEmail (Phase 9)
│   └── gmailService
└── handlers/messageActions (Phase 5)
    ├── calendarActions
    ├── taskActions
    ├── newsActions
    └── selfieActions
```

---

## Order of Operations (Recommended Sequence)

1. ✅ **Phase 0: Shared Enums** - COMPLETE (2025-01-02)
2. **Phase 1: Utility Functions** - Zero risk, enables other phases
3. **Phase 2: Task Hook** - Self-contained, good TDD practice run
4. **Phase 8: Whiteboard Handler** - Well-isolated, simple extraction
5. **Phase 6: Character Actions Hook** - Reduces video complexity
6. **Phase 3: Calendar Hook** - Prepares for proactive
7. **Phase 4A: Proactive Settings Hook** - Low risk, pure state (~80 lines)
8. **Phase 4B: Idle Tracking Hook** - Low risk, timing only (~60 lines)
9. **Phase 7: Character Management Hook** - Lower priority
10. **Phase 5: Message Action Handlers** - LAST (highest complexity, ~850 lines)

> ❌ **Phase 9: Email Hook** - REMOVED (only ~125 lines, rarely used, not worth extraction)
>
> ℹ️ **Phase 4 Note:** Original plan called for full proactive extraction. After coupling analysis, we split into 4A + 4B. Core orchestration functions (`triggerSystemMessage`, `triggerIdleBreaker`) intentionally stay in App.tsx. See [Phase 4 Deep Dive](#phase-4-deep-dive-proactive-hook-coupling-analysis) for full analysis.

---

## Testing Strategy (TDD Approach)

**CRITICAL: The app works now. It must work after every change.**

### Before Starting ANY Phase

```bash
# 1. Run full test suite - establish baseline
npm test -- --run

# 2. Verify build works
npm run build

# 3. Manual smoke test the feature you're about to extract
```

### For Each Phase

1. **Write tests FIRST** for the new module
   ```bash
   # Create test file
   touch src/hooks/__tests__/useTasks.test.ts

   # Write tests that define expected behavior
   # Tests will fail initially - that's expected!
   ```

2. **Run new tests (expect failures)**
   ```bash
   npm test -- --run -t "useTasks"
   ```

3. **Extract the code** from App.tsx

4. **Run new tests (should pass now)**
   ```bash
   npm test -- --run -t "useTasks"
   ```

5. **Run FULL test suite**
   ```bash
   npm test -- --run
   ```

6. **Build and manual test**
   ```bash
   npm run build
   # Open app, test the feature manually
   ```

7. **Commit only when green**
   ```bash
   git add .
   git commit -m "refactor: Extract useTasks hook from App.tsx"
   ```

### Test File Locations

```
src/
├── hooks/
│   ├── __tests__/
│   │   ├── useTasks.test.ts
│   │   ├── useCalendar.test.ts
│   │   └── useProactive.test.ts
│   ├── useTasks.ts
│   └── useTasks.README.md
├── handlers/
│   ├── __tests__/
│   │   ├── calendarActions.test.ts
│   │   └── taskActions.test.ts
│   └── messageActions/
└── utils/
    ├── __tests__/
    │   ├── textUtils.test.ts
    │   └── arrayUtils.test.ts
    └── textUtils.ts
```

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| App.tsx lines | 3,136 | 500-700 |
| Functions in App.tsx | ~50 | ~15 |
| State variables in App.tsx | ~40 | ~15 |
| Effects in App.tsx | ~15 | ~5 |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking audio/video sync | Keep media hook as-is, pass callbacks |
| Circular dependencies | Use dependency injection via callbacks |
| State inconsistency | Keep single source of truth in App.tsx where needed |
| Test failures | Run tests after each phase, commit incrementally |
| Performance regression | Profile before/after, use React.memo where needed |

---

## Critical Files Reference

- `src/App.tsx` - The monolithic file to refactor (3,136 lines)
- `src/hooks/useMediaQueues.ts` - Pattern to follow for custom hooks
- `src/services/taskService.ts` - Service layer pattern
- `src/services/calendarService.ts` - Service pattern for calendar
- `src/types.ts` - Type definitions needed for new hooks

---

## Phase 4 Deep Dive: Proactive Hook Coupling Analysis

**Date:** 2025-01-02
**Status:** ✅ **YES, I CAN DO THIS** (with modified approach)

### Executive Summary

After thorough analysis, the Proactive Hook extraction is **feasible but requires splitting into smaller pieces**. The original plan proposed a single `useProactive` hook, but the coupling analysis reveals this would create a 500+ line hook with 20+ dependencies—trading one problem for another.

**Recommendation:** Split into 3 focused hooks instead of 1 monolithic hook.

---

### Dependency Analysis

#### 1. `triggerSystemMessage` (Lines 778-834)

**Purpose:** Core function that sends system-initiated messages through the AI chat pipeline.

**Dependencies (17 total):**
```
State Dependencies:
├── isSnoozed (boolean)
├── snoozeUntil (number | null)
├── selectedCharacter (CharacterProfile)
├── session (GoogleSession)
├── relationship (RelationshipState)
├── aiSession (AIChatSession)
├── isMuted (boolean via ref)
├── kayleyContext (KayleyContext)
├── upcomingEvents (CalendarEvent[])

Function Dependencies:
├── activeService.generateResponse()
├── setAiSession()
├── setChatHistory()
├── enqueueAudio()
├── playAction()

Refs:
├── isMutedRef
└── hasInteractedRef
```

**Coupling Assessment:** 🔴 **HEAVY** - This function is the central nervous system of proactive features.

---

#### 2. `triggerIdleBreaker` (Lines 836-952)

**Purpose:** Triggered after user inactivity, makes Kayley initiate conversation.

**Dependencies (16 total):**
```
State Dependencies:
├── isSnoozed (boolean)
├── snoozeUntil (number | null)
├── proactiveSettings.checkins (boolean)
├── selectedCharacter (CharacterProfile)
├── session (GoogleSession)
├── relationship (RelationshipState)
├── tasks (Task[])
├── chatHistory (ChatMessage[])
├── kayleyContext (KayleyContext)
├── upcomingEvents (CalendarEvent[])
├── aiSession (AIChatSession)

Function Dependencies:
├── activeService (IAIChatService)
├── buildIdleBreakerPrompt()
├── triggerSystemMessage()

Refs:
├── lastIdleBreakerAtRef
└── hasInteractedRef
```

**Coupling Assessment:** 🔴 **HEAVY** - Depends on almost everything in the app.

---

#### 3. `triggerCalendarCheckin` (Lines 954-969)

**Purpose:** Proactively mentions upcoming calendar events.

**Dependencies (5 total):**
```
├── isSnoozed (boolean)
├── proactiveSettings.calendar (boolean)
├── triggerSystemMessage() (function)
├── markCheckinDone() (service)
└── buildEventCheckinPrompt() (service)
```

**Coupling Assessment:** 🟢 **LOW** - Small, well-isolated function.

---

#### 4. Effects Analysis

**Idle Timeout Effect (Lines 999-1022):**
```
Dependencies:
├── selectedCharacter
├── lastInteractionAt
├── isProcessingAction
├── isSpeaking
├── proactiveSettings.checkins
├── triggerIdleBreaker()
└── Timing.IDLE_TIMEOUT (5 min)
```

**Calendar Check-in Effect (Lines 972-997):**
```
Dependencies:
├── selectedCharacter
├── weekEvents
├── proactiveSettings.calendar
├── isProcessingAction
├── isSpeaking
├── getApplicableCheckin()
└── triggerCalendarCheckin()
```

**Morning Briefing Effect (Lines 2717-2806):**
```
Dependencies:
├── selectedCharacter
├── proactiveSettings.news
├── isSnoozed
├── hasInteractedRef
├── localStorage (last briefing)
├── fetchTechNews()
├── triggerSystemMessage()
└── Multiple date calculations
```

**Prefetch on Idle Effect (Lines 1024-1048):**
```
Dependencies:
├── lastInteractionAt
├── session
├── triggerCalendarCheckin()
└── Timing.PREFETCH_IDLE_TIMEOUT (30s)
```

---

### The Core Problem

The original `useProactive` plan creates a circular dependency nightmare:

```
useProactive
├── needs: chatHistory, relationship, tasks, calendar events
├── needs: AI service to generate responses
├── needs: playAction() for video
├── needs: enqueueAudio() for speech
└── needs: setChatHistory() to add messages

But these are provided by:
├── App.tsx state (chatHistory, relationship)
├── useTasks (tasks)
├── useCalendar (events)
├── useCharacterActions (playAction)
└── useMediaQueues (enqueueAudio)
```

**Extracting everything into one hook would require:**
- Passing 20+ callback props
- Complex dependency injection
- A hook that's just as hard to understand as the original code

---

### Recommended Approach: Split Into 3 Hooks

Instead of one monolithic `useProactive`, create three focused hooks:

#### Hook 1: `useProactiveSettings` (Low Coupling)
**Lines to extract:** ~80
**Dependencies:** Just localStorage, enums

```typescript
// What it manages:
- proactiveSettings state
- isSnoozed / snoozeUntil state
- loadSnoozeState()
- setSnooze() / clearSnooze()
- updateProactiveSettings()

// No dependencies on AI, chat, or other hooks
```

**Risk:** 🟢 **MINIMAL** - Pure state management, no side effects.

---

#### Hook 2: `useIdleTracking` (Low Coupling)
**Lines to extract:** ~60
**Dependencies:** Timing constants, refs

```typescript
// What it manages:
- lastInteractionAt state
- hasInteractedRef
- lastIdleBreakerAtRef
- markInteraction() callback
- isIdle computed value

// Provides timing info, doesn't trigger anything
```

**Risk:** 🟢 **MINIMAL** - Just tracks time, no business logic.

---

#### Hook 3: Keep `triggerSystemMessage` and Effects in App.tsx
**Why:** These are the glue that connects everything. Moving them creates more problems than it solves.

```typescript
// What stays in App.tsx:
- triggerSystemMessage() - needs everything
- triggerIdleBreaker() - needs everything
- triggerCalendarCheckin() - small, can stay
- Idle timeout effect
- Calendar check-in effect
- Morning briefing effect
```

**Rationale:**
- These functions ARE the coupling point
- They need access to 15+ pieces of state
- Extracting them just moves complexity, doesn't reduce it
- ~200 lines is acceptable to keep in App.tsx

---

### Final Recommendation

**YES, I can do this** with the following modified plan:

| Component | Action | Lines Saved | Risk |
|-----------|--------|-------------|------|
| `useProactiveSettings` | Extract | ~80 | 🟢 Low |
| `useIdleTracking` | Extract | ~60 | 🟢 Low |
| `triggerSystemMessage` | Keep in App | 0 | N/A |
| `triggerIdleBreaker` | Keep in App | 0 | N/A |
| Effects | Keep in App | 0 | N/A |

**Total Lines Saved:** ~140 (not the original ~276 estimate)
**Net Benefit:** Cleaner state management without breaking the app.

---

### Why Not Extract Everything?

The "clean extraction" approach would require:

1. **Callback Hell:**
   ```typescript
   useProactive({
     selectedCharacter,
     session,
     relationship,
     tasks,
     chatHistory,
     kayleyContext,
     upcomingEvents,
     aiSession,
     isMuted,
     activeService,
     setAiSession,
     setChatHistory,
     enqueueAudio,
     playAction,
     // ... 6 more props
   });
   ```

2. **Hidden Complexity:** The hook would be 400+ lines internally.

3. **Testing Nightmare:** Mocking 20 dependencies per test.

4. **No Actual Improvement:** We'd trade one monolith for another.

---

### Revised Phase 4 Plan

**Phase 4A: Extract useProactiveSettings** ✅ Complete (2025-01-03)
1. Create `src/hooks/useProactiveSettings.ts` ✅
2. Move: proactiveSettings state, snooze state, localStorage logic ✅
3. Test: Settings persist correctly ✅ (13 tests)
4. Verify: Build passes, app works ✅

**Phase 4B: Extract useIdleTracking** ✅ Complete (2025-01-03)
1. Create `src/hooks/useIdleTracking.ts` ✅
2. Move: lastInteractionAt, hasInteractedRef, registerInteraction() ✅
3. Test: Idle detection works ✅ (13 tests)
4. Verify: Build passes, app works ✅

**Phase 4C: Keep System Message Functions (NO CHANGE)**
- `triggerSystemMessage`, `triggerIdleBreaker`, effects stay in App.tsx
- This is the pragmatic choice

---

### Conclusion

The proactive system is **intentionally coupled** because it orchestrates the entire app. Trying to extract it completely would:
- Create a 400-line hook with 20 dependencies
- Make testing harder, not easier
- Move complexity without reducing it

The **pragmatic approach** extracts what CAN be cleanly extracted (~140 lines) and leaves the orchestration logic in App.tsx where it belongs.

**Final Verdict:** ✅ **Proceed with modified Phase 4 (split into 4A + 4B)**
