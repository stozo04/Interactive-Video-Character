# App.tsx Refactoring Plan

## Executive Summary

The App.tsx file has grown to **3,136 lines**, containing multiple feature domains mixed together. This plan extracts functionality into dedicated custom hooks, services, and handler modules while maintaining the existing architecture patterns established in the codebase.

**Goal:** Reduce App.tsx to **500-700 lines** with clear separation of concerns.

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
│   ├── useTasks.ts                (NEW - Task state + handlers)
│   ├── useCalendar.ts             (NEW - Calendar state + handlers)
│   ├── useProactive.ts            (NEW - Idle breaker + proactive features)
│   ├── useCharacterActions.ts     (NEW - Action video playback)
│   ├── useCharacterManagement.ts  (NEW - Character CRUD)
│   └── useAIChat.ts               (NEW - Chat session + message handling)
│
├── handlers/
│   ├── messageActions/
│   │   ├── index.ts               (NEW - Export all action handlers)
│   │   ├── calendarActions.ts     (NEW - Calendar create/delete parsing)
│   │   ├── taskActions.ts         (NEW - Task action parsing)
│   │   ├── newsActions.ts         (NEW - News fetch handling)
│   │   └── selfieActions.ts       (NEW - Selfie generation handling)
│   └── whiteboardHandler.ts       (NEW - Whiteboard AI interaction)
│
├── utils/
│   ├── textUtils.ts               (NEW - sanitizeText, isQuestionMessage)
│   ├── jsonUtils.ts               (NEW - extractJsonObject)
│   ├── arrayUtils.ts              (NEW - randomFromArray, shuffleArray)
│   └── actionKeyMapper.ts         (existing)
│
└── App.tsx                        (REDUCED to ~500-700 lines)
```

---

## Detailed Migration Plan

### Phase 1: Extract Utility Functions (Low Risk)

**Priority: HIGH (Foundation for other extractions)**

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

#### Create `src/hooks/useTasks.ts`:

```typescript
import { useState, useCallback } from 'react';
import { Task, CharacterProfile, ChatMessage } from '../types';
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
  handleTaskCreate: (text: string, priority?: 'low' | 'medium' | 'high') => Promise<void>;
  handleTaskToggle: (taskId: string) => Promise<void>;
  handleTaskDelete: (taskId: string) => Promise<void>;
  loadTasks: () => Promise<Task[]>;
}

export function useTasks(options: UseTasksOptions): UseTasksResult {
  const { selectedCharacter, isMuted, enqueueAudio, playAction, addChatMessage } = options;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);

  const handleTaskCreate = useCallback(async (text: string, priority?: 'low' | 'medium' | 'high') => {
    const newTask = await taskService.createTask(text, priority);
    if (newTask) {
      setTasks(prev => [...prev, newTask]);

      if (selectedCharacter && !isMuted) {
        const celebrations = [
          "Got it! Added to your list",
          "Done! I'll help you remember that.",
          "Added! One step at a time",
          "On the list! You've got this."
        ];
        const message = celebrations[Math.floor(Math.random() * celebrations.length)];

        generateSpeech(message).then(audio => {
          if (audio) enqueueAudio(audio);
        });

        addChatMessage({ role: 'model', text: message });
      }
    }
  }, [selectedCharacter, isMuted, enqueueAudio, addChatMessage]);

  const handleTaskToggle = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const updatedTask = await taskService.toggleTask(taskId, task.completed);
    if (updatedTask) {
      setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));

      if (updatedTask.completed && selectedCharacter && !isMuted) {
        const celebrations = [
          "Nice! That's one thing off your plate",
          "You crushed it! One down!",
          "Look at you go!",
          "Done and done! Great work",
          "Boom! Another one bites the dust!"
        ];
        const message = celebrations[Math.floor(Math.random() * celebrations.length)];

        generateSpeech(message).then(audio => {
          if (audio) enqueueAudio(audio);
        });

        addChatMessage({ role: 'model', text: message });

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
    const success = await taskService.deleteTask(taskId);
    if (success) {
      setTasks(prev => prev.filter(t => t.id !== taskId));
    }
  }, []);

  const loadTasks = useCallback(async () => {
    const currentTasks = await taskService.fetchTasks();
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

**Dependencies:**
- `taskService` (existing)
- `generateSpeech` (for celebration audio)
- `ChatMessage` type

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

const PROACTIVE_SETTINGS_KEY = 'kayley_proactive_settings';

interface UseProactiveResult {
  proactiveSettings: ProactiveSettings;
  updateProactiveSettings: (updates: Partial<ProactiveSettings>) => void;
  isSnoozed: boolean;
  snoozeUntil: number | null;
  setSnooze: (until: number | null) => void;
  clearSnooze: () => void;
  loadSnoozeState: () => void;
}

export function useProactive(): UseProactiveResult {
  const [proactiveSettings, setProactiveSettings] = useState<ProactiveSettings>(() => {
    const stored = localStorage.getItem(PROACTIVE_SETTINGS_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_PROACTIVE_SETTINGS;
  });

  const [isSnoozed, setIsSnoozed] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);

  const updateProactiveSettings = useCallback((updates: Partial<ProactiveSettings>) => {
    setProactiveSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem(PROACTIVE_SETTINGS_KEY, JSON.stringify(next));
      console.log('Proactive settings updated:', next);
      return next;
    });
  }, []);

  const setSnooze = useCallback((until: number | null) => {
    setIsSnoozed(true);
    setSnoozeUntil(until);
    if (until === null) {
      localStorage.setItem('kayley_snooze_indefinite', 'true');
      localStorage.removeItem('kayley_snooze_until');
    } else {
      localStorage.removeItem('kayley_snooze_indefinite');
      localStorage.setItem('kayley_snooze_until', String(until));
    }
  }, []);

  const clearSnooze = useCallback(() => {
    setIsSnoozed(false);
    setSnoozeUntil(null);
    localStorage.removeItem('kayley_snooze_indefinite');
    localStorage.removeItem('kayley_snooze_until');
  }, []);

  const loadSnoozeState = useCallback(() => {
    const snoozeIndefinite = localStorage.getItem('kayley_snooze_indefinite');
    const snoozeUntilStr = localStorage.getItem('kayley_snooze_until');

    if (snoozeIndefinite === 'true') {
      setIsSnoozed(true);
      setSnoozeUntil(null);
      console.log('Check-ins are snoozed indefinitely');
    } else if (snoozeUntilStr) {
      const snoozeEnd = parseInt(snoozeUntilStr);
      if (Date.now() < snoozeEnd) {
        setIsSnoozed(true);
        setSnoozeUntil(snoozeEnd);
        console.log('Check-ins are snoozed until', new Date(snoozeEnd).toLocaleTimeString());
      } else {
        localStorage.removeItem('kayley_snooze_until');
        setIsSnoozed(false);
        setSnoozeUntil(null);
        console.log('Snooze period expired (cleared on load)');
      }
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

**Dependencies:** Many (calendar, tasks, AI service, chat history, etc.)

**Risk:** HIGH (heavily coupled, consider partial extraction)

---

### Phase 5: Extract Message Action Handlers (High Priority)

**Priority: HIGH (Biggest cleanup impact)**

#### Create `src/handlers/messageActions/calendarActions.ts`:

```typescript
import { calendarService, type CalendarEvent, type NewEventPayload } from '../../services/calendarService';
import { extractJsonObject } from '../../utils/jsonUtils';

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
  const calendarTagIndex = responseText.indexOf('[CALENDAR_CREATE]');

  if (calendarTagIndex === -1) {
    return { handled: false };
  }

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

### Phase 6: Extract Character Action Hook (Medium Risk)

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

1. **Phase 1: Utility Functions** - Zero risk, enables other phases
2. **Phase 2: Task Hook** - Self-contained, good practice run
3. **Phase 8: Whiteboard Handler** - Well-isolated, simple extraction
4. **Phase 5: Message Action Handlers** - Biggest cleanup impact
5. **Phase 6: Character Actions Hook** - Reduces video complexity
6. **Phase 3: Calendar Hook** - Prepares for proactive
7. **Phase 4: Proactive Hook** - High complexity, do last
8. **Phase 7: Character Management Hook** - Lower priority
9. **Phase 9: Email Hook** - Lowest priority

---

## Testing Strategy

For each phase:
1. Run existing tests before extraction
2. Create new tests for extracted module
3. Run full test suite after extraction
4. Manual testing of affected features
5. Update snapshots if needed: `npm test -- --run -t "snapshot" -u`

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
