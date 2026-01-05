# Message Orchestrator Refactor

**Status**: Planning
**Priority**: High
**Estimated Effort**: Medium
**Date Created**: 2025-01-05

## Executive Summary

Extract ~400 lines of message handling business logic from `App.tsx` into a dedicated `messageOrchestrator.ts` service. This will make App.tsx a thin UI layer that only applies results, while all decision-making happens in testable service code.

## Problem Statement

### Current State
`App.tsx` contains ~400 lines of business logic in `handleSendMessage`:
- Calendar context injection
- AI response processing
- Action routing (task → calendar → news → selfie)
- Post-processing (user facts, character facts, presence detection)
- Chat history management
- Audio/action coordination

### Why This Is Bad
1. **Untestable** - Can't unit test without rendering React components
2. **Violates SRP** - App.tsx does too many things
3. **Hard to follow** - Business logic mixed with UI updates
4. **Duplicated patterns** - Each action handler has similar boilerplate

### Desired State
- App.tsx: ~50 lines - receives result, updates UI
- messageOrchestrator.ts: All business logic, fully testable
- Clear separation: Service decides, UI displays

---

## Architecture

### New Files
```
src/
├── services/
│   └── messageOrchestrator.ts    # NEW: Main orchestration service
├── handlers/
│   └── messageActions/
│       ├── index.ts              # EXISTING: Re-exports
│       ├── types.ts              # NEW: Shared enums and types
│       ├── taskActions.ts        # EXISTING
│       ├── calendarActions.ts    # EXISTING
│       ├── newsActions.ts        # EXISTING
│       └── selfieActions.ts      # EXISTING
```

### Data Flow (After Refactor)
```
User types message
       ↓
App.tsx calls processUserMessage()
       ↓
messageOrchestrator.ts:
  1. Pre-process (calendar context injection)
  2. Call AI service
  3. Route to action handlers
  4. Post-process (facts, presence)
  5. Return OrchestratorResult
       ↓
App.tsx applies result to UI
```

---

## Type Definitions

### File: `src/handlers/messageActions/types.ts`

```typescript
// ============================================================================
// ENUMS (No magic strings!)
// ============================================================================

export enum ActionType {
  TASK = 'task',
  CALENDAR = 'calendar',
  NEWS = 'news',
  SELFIE = 'selfie',
  NONE = 'none',
}

export enum CalendarQueryType {
  NONE = 'none',
  READ = 'read',      // "What's on my calendar?"
  WRITE = 'write',    // "Add/delete event"
}

export enum ProcessingStage {
  PREPROCESSING = 'preprocessing',
  AI_CALL = 'ai_call',
  ACTION_ROUTING = 'action_routing',
  POSTPROCESSING = 'postprocessing',
  COMPLETE = 'complete',
}

// ============================================================================
// INTERFACES
// ============================================================================

export interface OrchestratorInput {
  userMessage: string;
  aiService: IAIChatService;
  session: AIChatSession | null;
  accessToken?: string;
  chatHistory: ChatMessage[];
  upcomingEvents: CalendarEvent[];
  tasks: Task[];
  isMuted: boolean;
}

export interface OrchestratorResult {
  // What happened
  success: boolean;
  actionType: ActionType;
  stage: ProcessingStage;

  // Messages to add to chat
  chatMessages: ChatMessage[];

  // Media to play
  audioToPlay?: string;
  actionToPlay?: string;

  // App to open
  appToOpen?: string;

  // State refresh flags
  refreshCalendar: boolean;
  refreshTasks: boolean;
  openTaskPanel: boolean;

  // Session update
  updatedSession?: AIChatSession;

  // Error handling
  error?: string;
}

export interface ActionHandlerResult {
  handled: boolean;
  success: boolean;
  chatMessages: ChatMessage[];
  audioToPlay?: string;
  refreshCalendar?: boolean;
  refreshTasks?: boolean;
  openTaskPanel?: boolean;
  error?: string;
}
```

---

## Implementation Plan

### Phase 1: Setup & Types (TDD)

#### Step 1.1: Create types file
**Test First**: N/A (type definitions)

```bash
# Create the types file
touch src/handlers/messageActions/types.ts
```

**Implementation**:
- Create enums: `ActionType`, `CalendarQueryType`, `ProcessingStage`
- Create interfaces: `OrchestratorInput`, `OrchestratorResult`, `ActionHandlerResult`
- Export from `index.ts`

#### Step 1.2: Update existing handlers to use new types
**Files to modify**:
- `taskActions.ts` - Return `ActionHandlerResult`
- `calendarActions.ts` - Return `ActionHandlerResult`
- `newsActions.ts` - Return `ActionHandlerResult`
- `selfieActions.ts` - Return `ActionHandlerResult`

---

### Phase 2: Create Orchestrator Skeleton (TDD)

#### Step 2.1: Write orchestrator tests first
**File**: `src/services/__tests__/messageOrchestrator.test.ts`

```typescript
describe('MessageOrchestrator', () => {
  describe('processUserMessage', () => {
    it('should return success=false when AI service throws', async () => {
      // Test error handling
    });

    it('should detect calendar queries and inject context', async () => {
      // Test calendar detection
    });

    it('should route task actions correctly', async () => {
      // Test task routing
    });

    it('should route calendar actions correctly', async () => {
      // Test calendar routing
    });

    it('should route news actions correctly', async () => {
      // Test news routing
    });

    it('should route selfie actions correctly', async () => {
      // Test selfie routing
    });

    it('should handle no action (plain response)', async () => {
      // Test plain text response
    });

    it('should log at each processing stage', async () => {
      // Verify logging
    });
  });

  describe('detectCalendarQuery', () => {
    it('should return READ for schedule questions', () => {
      expect(detectCalendarQuery('what is on my calendar')).toBe(CalendarQueryType.READ);
    });

    it('should return WRITE for delete requests', () => {
      expect(detectCalendarQuery('delete my meeting')).toBe(CalendarQueryType.WRITE);
    });

    it('should return NONE for unrelated messages', () => {
      expect(detectCalendarQuery('hello there')).toBe(CalendarQueryType.NONE);
    });
  });
});
```

#### Step 2.2: Create orchestrator skeleton
**File**: `src/services/messageOrchestrator.ts`

```typescript
// src/services/messageOrchestrator.ts

/**
 * Message Orchestrator Service
 *
 * Handles all business logic for processing user messages:
 * 1. Pre-processing (calendar context injection)
 * 2. AI service call
 * 3. Action routing (task, calendar, news, selfie)
 * 4. Post-processing (facts, presence detection)
 *
 * Returns a result object that App.tsx applies to UI.
 */

import {
  ActionType,
  CalendarQueryType,
  ProcessingStage,
  OrchestratorInput,
  OrchestratorResult
} from '../handlers/messageActions/types';

// ============================================================================
// CONSTANTS
// ============================================================================

const CALENDAR_KEYWORDS = [
  'event', 'calendar', 'schedule', 'meeting',
  'appointment', 'plan', 'today', 'tomorrow'
];

const CALENDAR_WRITE_KEYWORDS = ['delete', 'remove', 'cancel', 'add', 'create'];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Detect if message is a calendar query and what type
 */
export function detectCalendarQuery(message: string): CalendarQueryType {
  const lower = message.toLowerCase();

  const hasCalendarKeyword = CALENDAR_KEYWORDS.some(kw => lower.includes(kw));
  if (!hasCalendarKeyword) {
    return CalendarQueryType.NONE;
  }

  const hasWriteKeyword = CALENDAR_WRITE_KEYWORDS.some(kw => lower.includes(kw));
  return hasWriteKeyword ? CalendarQueryType.WRITE : CalendarQueryType.READ;
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

export async function processUserMessage(
  input: OrchestratorInput
): Promise<OrchestratorResult> {
  console.log('🎯 [Orchestrator] Processing message:', input.userMessage.substring(0, 50));

  // TODO: Implement in Phase 3

  return {
    success: false,
    actionType: ActionType.NONE,
    stage: ProcessingStage.PREPROCESSING,
    chatMessages: [],
    refreshCalendar: false,
    refreshTasks: false,
    openTaskPanel: false,
    error: 'Not implemented yet',
  };
}
```

---

### Phase 3: Implement Pre-processing (TDD)

#### Step 3.1: Calendar context injection

**Test**:
```typescript
it('should inject calendar context for schedule queries', async () => {
  const input = createMockInput({ userMessage: 'what is on my schedule today?' });
  const result = await processUserMessage(input);

  // Verify the message sent to AI includes calendar data
  expect(mockAIService.generateResponse).toHaveBeenCalledWith(
    expect.objectContaining({
      text: expect.stringContaining('[LIVE CALENDAR DATA')
    }),
    expect.anything(),
    expect.anything()
  );
});
```

**Implementation**:
```typescript
async function preprocessMessage(
  message: string,
  accessToken: string | undefined,
  currentEvents: CalendarEvent[]
): Promise<{ processedMessage: string; freshEvents: CalendarEvent[] }> {
  const queryType = detectCalendarQuery(message);

  if (queryType === CalendarQueryType.NONE || !accessToken) {
    console.log('📅 [Orchestrator] No calendar context needed');
    return { processedMessage: message, freshEvents: currentEvents };
  }

  console.log('⚡ [Orchestrator] Fetching live calendar data...');

  try {
    const freshEvents = await calendarService.getUpcomingEvents(accessToken);
    console.log(`📅 [Orchestrator] Got ${freshEvents.length} events`);

    if (freshEvents.length === 0) {
      return { processedMessage: message, freshEvents };
    }

    const eventList = formatEventsForContext(freshEvents);
    const isWriteQuery = queryType === CalendarQueryType.WRITE;

    const contextSuffix = isWriteQuery
      ? `\n\n[LIVE CALENDAR DATA - ${freshEvents.length} EVENTS: ${eventList}]\n\n⚠️ DELETE REMINDER: Use calendar_action with exact event_id from above.`
      : `\n\n[LIVE CALENDAR DATA - ${freshEvents.length} EVENTS: ${eventList}]`;

    console.log(`📅 [Orchestrator] Injected ${isWriteQuery ? 'WRITE' : 'READ'} calendar context`);

    return {
      processedMessage: message + contextSuffix,
      freshEvents,
    };
  } catch (error) {
    console.error('❌ [Orchestrator] Calendar fetch failed:', error);
    return { processedMessage: message, freshEvents: currentEvents };
  }
}
```

---

### Phase 4: Implement AI Call & Action Routing (TDD)

#### Step 4.1: AI service call wrapper

**Test**:
```typescript
it('should call AI service and return response', async () => {
  const mockResponse = { text_response: 'Hello!', action_id: null };
  mockAIService.generateResponse.mockResolvedValue({ response: mockResponse });

  const input = createMockInput({ userMessage: 'hi' });
  const result = await processUserMessage(input);

  expect(result.success).toBe(true);
  expect(result.chatMessages[0].text).toBe('Hello!');
});
```

#### Step 4.2: Action routing

**Test**:
```typescript
it('should route task_action to task handler', async () => {
  const mockResponse = {
    text_response: 'Added!',
    task_action: { action: 'create', text: 'Buy milk' }
  };
  mockAIService.generateResponse.mockResolvedValue({ response: mockResponse });

  const input = createMockInput({ userMessage: 'add task buy milk' });
  const result = await processUserMessage(input);

  expect(result.actionType).toBe(ActionType.TASK);
  expect(result.refreshTasks).toBe(true);
});
```

**Implementation**:
```typescript
function determineActionType(response: AIActionResponse): ActionType {
  if (response.task_action) return ActionType.TASK;
  if (response.calendar_action) return ActionType.CALENDAR;
  if (response.news_action) return ActionType.NEWS;
  if (response.selfie_action) return ActionType.SELFIE;
  return ActionType.NONE;
}

async function routeToActionHandler(
  actionType: ActionType,
  response: AIActionResponse,
  context: ActionContext
): Promise<ActionHandlerResult> {
  console.log(`🎯 [Orchestrator] Routing to ${actionType} handler`);

  switch (actionType) {
    case ActionType.TASK:
      return processTaskAction(response.task_action, context.tasks, context.taskCallbacks);

    case ActionType.CALENDAR:
      return processCalendarAction(response.calendar_action, {
        accessToken: context.accessToken,
        currentEvents: context.upcomingEvents,
      });

    case ActionType.NEWS:
      return processNewsAction(response.news_action);

    case ActionType.SELFIE:
      return processSelfieAction(response.selfie_action, {
        userMessage: context.userMessage,
        chatHistory: context.chatHistory,
        upcomingEvents: context.upcomingEvents,
      });

    default:
      return { handled: false, success: true, chatMessages: [] };
  }
}
```

---

### Phase 5: Implement Post-processing (TDD)

#### Step 5.1: Background processing (non-blocking)

**Test**:
```typescript
it('should trigger fact detection in background', async () => {
  const mockResponse = { text_response: 'Nice!' };
  const mockIntent = { userFacts: { hasFactsToStore: true, facts: [{ category: 'preference' }] } };
  mockAIService.generateResponse.mockResolvedValue({ response: mockResponse, intent: mockIntent });

  const input = createMockInput({ userMessage: 'I love coffee' });
  await processUserMessage(input);

  // Verify background processing was triggered (not awaited)
  expect(processDetectedFacts).toHaveBeenCalledWith(mockIntent.userFacts.facts);
});
```

**Implementation**:
```typescript
function triggerBackgroundProcessing(
  response: AIActionResponse,
  intent: FullMessageIntent | undefined,
  userMessage: string
): void {
  // User fact detection (non-blocking)
  if (intent?.userFacts?.hasFactsToStore && intent.userFacts.facts.length > 0) {
    console.log(`🧠 [Orchestrator] Storing ${intent.userFacts.facts.length} user facts (background)`);
    processDetectedFacts(intent.userFacts.facts).catch(err =>
      console.warn('❌ [Orchestrator] Failed to process user facts:', err)
    );
  }

  // Character fact detection (non-blocking)
  if (response.text_response) {
    console.log('🎭 [Orchestrator] Processing character facts (background)');
    processAndStoreCharacterFacts(response.text_response).catch(err =>
      console.warn('❌ [Orchestrator] Failed to process character facts:', err)
    );
  }

  // Presence detection (non-blocking)
  if (response.text_response) {
    console.log('👁️ [Orchestrator] Detecting presence (background)');
    detectAndUpdatePresence(response.text_response, userMessage).catch(err =>
      console.warn('❌ [Orchestrator] Failed to detect presence:', err)
    );
  }
}
```

---

### Phase 6: Update App.tsx (Final Integration)

#### Step 6.1: Replace handleSendMessage

**Before** (~400 lines):
```typescript
const handleSendMessage = async (message: string) => {
  // ... 400 lines of business logic
};
```

**After** (~50 lines):
```typescript
const handleSendMessage = async (message: string) => {
  if (!message.trim() || !session || !selectedCharacter) return;

  registerInteraction();
  setIsProcessingAction(true);
  setErrorMessage(null);

  // Add user message to chat
  const updatedHistory = [...chatHistory, { role: 'user' as const, text: message }];
  setChatHistory(updatedHistory);

  try {
    const result = await processUserMessage({
      userMessage: message,
      aiService: activeService,
      session: aiSession,
      accessToken: session.accessToken,
      chatHistory,
      upcomingEvents,
      tasks,
      isMuted,
    });

    // Apply result to UI
    if (result.chatMessages.length > 0) {
      setChatHistory(prev => [...prev, ...result.chatMessages]);
    }

    if (result.updatedSession) {
      setAiSession(result.updatedSession);
    }

    if (result.audioToPlay && !isMuted) {
      media.enqueueAudio(result.audioToPlay);
    }

    if (result.actionToPlay) {
      playAction(result.actionToPlay);
    }

    if (result.refreshCalendar) {
      refreshCalendarEvents();
    }

    if (result.refreshTasks) {
      refreshTasks();
    }

    if (result.openTaskPanel) {
      setIsTaskPanelOpen(true);
    }

    if (result.appToOpen) {
      console.log('🚀 [App] Launching app:', result.appToOpen);
      window.location.href = result.appToOpen;
    }

    if (result.error) {
      setErrorMessage(result.error);
    }

    console.log(`✅ [App] Message processed: ${result.actionType}, success=${result.success}`);

  } catch (error) {
    console.error('❌ [App] Message processing failed:', error);
    setErrorMessage('Failed to process message');
  } finally {
    setIsProcessingAction(false);
  }
};
```

---

## Testing Checklist

### Unit Tests
- [ ] `detectCalendarQuery` - all keyword combinations
- [ ] `preprocessMessage` - context injection
- [ ] `determineActionType` - all action types
- [ ] `routeToActionHandler` - each action handler
- [ ] `triggerBackgroundProcessing` - all background tasks
- [ ] `processUserMessage` - full flow

### Integration Tests
- [ ] Task creation flow
- [ ] Calendar read flow
- [ ] Calendar write flow
- [ ] News fetch flow
- [ ] Selfie generation flow
- [ ] Plain message flow (no action)
- [ ] Error handling flow

### Manual Testing
- [ ] Send "add task buy groceries" - verify task created
- [ ] Send "what's on my calendar" - verify events shown
- [ ] Send "delete my 2pm meeting" - verify event deleted
- [ ] Send "get me tech news" - verify news fetched
- [ ] Send "take a selfie" - verify image generated
- [ ] Send "hello" - verify plain response works

---

## File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `src/handlers/messageActions/types.ts` | CREATE | ~80 |
| `src/services/messageOrchestrator.ts` | CREATE | ~250 |
| `src/services/__tests__/messageOrchestrator.test.ts` | CREATE | ~300 |
| `src/handlers/messageActions/index.ts` | MODIFY | +5 |
| `src/App.tsx` | MODIFY | -350 |

**Net change**: App.tsx loses ~350 lines, gains ~630 lines in proper service layer (testable!)

---

## Success Criteria

1. **All tests pass**: `npm test -- --run`
2. **Build succeeds**: `npm run build`
3. **App.tsx < 1700 lines** (currently ~1900)
4. **handleSendMessage < 60 lines**
5. **Each action type has dedicated test coverage**
6. **Logs visible at each processing stage**

---

## Future Enhancements (v2)

- [ ] Add retry logic for failed AI calls
- [ ] Add action queueing for rapid messages
- [ ] Add undo support for actions
- [ ] Add action analytics/metrics
