# App.tsx Developer Guide

Comprehensive guide to the App.tsx architecture, message flow, and how to add new features.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Complete Message Workflow](#complete-message-workflow)
3. [Adding a New UI Button](#adding-a-new-ui-button)
4. [Adding a New AI Action](#adding-a-new-ai-action)
5. [Key Files Reference](#key-files-reference)
6. [Custom Hooks](#custom-hooks)
7. [Message Action Handlers](#message-action-handlers)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Web App (React, port 3000)                          │
│                              THIN CLIENT                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │  useTasks   │  │ useCalendar │  │useProactive │  │useCharacter │       │
│  │             │  │             │  │  Settings   │  │  Actions    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐        │
│  │useIdle     │  │useCharacter │  │    Message Action Handlers   │        │
│  │ Tracking   │  │ Management  │  │  (calendar, task, news,      │        │
│  └─────────────┘  └─────────────┘  │   selfie, gif, video)       │        │
│                                    └─────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                        agentClient.sendMessage()
                        POST /agent/message
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SERVER / AGENT (Node.js, port 4010)                      │
│                              THE BRAIN                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ServerGeminiSvc  │  │ messageOrchest- │  │  memoryService  │             │
│  │SDK Chat sessions│  │ rator.ts        │  │  (tool exec)    │             │
│  │auto fn calling  │  │                 │  │                 │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│  ┌─────────────────┐  ┌─────────────────┐                                  │
│  │ system_prompts/ │  │  Supabase Admin │                                  │
│  │ builders/       │  │  (server-only)  │                                  │
│  └─────────────────┘  └─────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── App.tsx                      # Core orchestration (this file)
├── App.README.md                # This documentation
├── services/
│   ├── agentClient.ts           # Thin HTTP wrapper → POST /agent/message
│   ├── elevenLabsService.ts     # Browser-side audio playback (stays client)
│   ├── supabaseClient.ts        # Browser Supabase (real-time subscriptions)
│   ├── clientLogger.ts          # Browser-side logging
│   └── aiSchema.ts              # Tool declarations & response types (shared)
├── hooks/                       # Extracted custom hooks
│   ├── useTasks.ts
│   ├── useCalendar.ts
│   ├── useProactiveSettings.ts
│   ├── useIdleTracking.ts
│   ├── useCharacterActions.ts
│   └── useCharacterManagement.ts
└── handlers/
    └── messageActions/          # AI response action handlers
        ├── calendarActions.ts
        ├── taskActions.ts
        ├── newsActions.ts
        ├── selfieActions.ts
        └── index.ts

server/
├── routes/agentRoutes.ts        # POST /agent/message gateway
├── services/ai/
│   ├── geminiClient.ts          # Singleton GoogleGenAI (server-only API key)
│   ├── chatSessionManager.ts    # SDK Chat session lifecycle
│   ├── toolBridge.ts            # CallableTool wrapper for executeMemoryTool
│   └── serverGeminiService.ts   # IAIChatService implementation (SDK Chat)
└── services/
    └── messageOrchestrator.ts   # Central coordinator (all clients)
```

---

## Complete Message Workflow

This is the end-to-end flow when a user sends a message:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: USER INPUT                                                           │
│ ChatPanel.tsx → App.tsx handleSendMessage()                                  │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: PRE-PROCESSING (App.tsx)                                             │
│ • registerInteraction() - Reset idle timer                                   │
│ • Add user message to chatHistory                                            │
│ • recordExchange() - Track for callbacks                                     │
│ • Predict action optimistically (play video immediately)                     │
│ • Inject calendar context if schedule-related query                          │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: AGENT CLIENT CALL (src/services/agentClient.ts)                     │
│                                                                              │
│ agentClient.sendMessage({                                                    │
│   message,                                                                   │
│   sessionId: webSessionIdRef.current,   // e.g. "web-<uuid>"                │
│   googleAccessToken,                                                         │
│   chatHistory, upcomingEvents, tasks, isMuted                                │
│ })                                                                           │
│ → POST http://localhost:3000/agent/message (proxied to port 4010)           │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: SERVER — agentRoutes.ts                                              │
│ • Parse request body                                                         │
│ • Call processUserMessage({ aiService: serverGeminiService, ... })          │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: SERVER — messageOrchestrator.ts                                     │
│ • Fetch context (relationship, tasks, calendar, presence)                    │
│ • Build system prompt (systemPromptBuilder.ts)                               │
│ • Call aiService.generateResponse()                                          │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 6: SERVER — serverGeminiService.ts (SDK Chat)                          │
│                                                                              │
│ • getOrCreateSession(sessionId) → SDK Chat instance                         │
│ • chat.sendMessage({ message: parts })                                       │
│ • SDK handles tool calls automatically (automaticFunctionCalling)            │
│ • toolBridge.ts executes executeMemoryTool() for each tool call             │
│ • SDK returns final text response when tool loop complete                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 7: SERVER — Response Parsing                                            │
│                                                                              │
│ Parse JSON response into AIActionResponse:                                   │
│ {                                                                            │
│   text_response, gif_action, selfie_action,                                 │
│   calendar_action, task_action (via tool), email_action,                    │
│   video_action, store_self_info, almost_moment_used, ...                    │
│ }                                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 8: CLIENT — Action Handler Processing (App.tsx)                        │
│ (handlers/messageActions/*.ts)                                               │
│                                                                              │
│ Process in order:                                                            │
│ 1. Selfie Actions → processSelfieAction()                                   │
│ 2. Task Actions → processTaskAction()                                        │
│ 3. Calendar Actions → processCalendarAction()                                │
│ 4. News Actions → processNewsAction()                                        │
│ 5. GIF Actions → fetch from Giphy, render inline                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 9: CLIENT — Audio + UI Update (App.tsx)                                │
│                                                                              │
│ • setChatHistory([...prev, { role: 'model', text: response }])              │
│ • media.enqueueAudio(audioData) - Queue for ElevenLabs playback             │
│ • playAction(action_id) - Trigger character video                           │
│ • Save to conversationHistoryService                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Adding a New AI Action (Tool Call)

The tool pipeline now lives entirely on the server. To add a new tool:

1. **`src/services/aiSchema.ts`** — Add to `GeminiMemoryToolDeclarations`, `MemoryToolName`, `ToolCallArgs`
2. **`src/services/memoryService.ts`** — Add case to `executeMemoryTool()` switch
3. **`src/services/system_prompts/tools/`** — Document the tool for the LLM

The `toolBridge.ts` on the server automatically picks up any tool in `GeminiMemoryToolDeclarations` — no server-side changes needed for new tools.

---

## Key Files Reference

| File | Purpose | When to Modify |
|------|---------|----------------|
| `src/App.tsx` | Core orchestration, state, UI | Adding UI elements, new state |
| `src/services/agentClient.ts` | HTTP wrapper to `/agent/message` | Changing request shape |
| `src/services/aiSchema.ts` | Tool declarations, response types | Adding new AI tools/actions |
| `src/services/memoryService.ts` | Tool execution logic | Implementing tool behavior |
| `src/services/system_prompts/builders/systemPromptBuilder.ts` | Prompt assembly | Adding context to prompts |
| `src/handlers/messageActions/*.ts` | Response action processing | Adding new action handlers |
| `server/services/ai/serverGeminiService.ts` | AI provider (SDK Chat) | Modifying AI request/response |
| `server/services/ai/chatSessionManager.ts` | Session lifecycle | Session TTL, history loading |
| `server/routes/agentRoutes.ts` | HTTP gateway | Adding new agent endpoints |

---

## Custom Hooks

### useTasks
**File:** `src/hooks/useTasks.ts`

```typescript
const {
  tasks, setTasks,
  isTaskPanelOpen, setIsTaskPanelOpen,
  loadTasks, refreshTasks,
  handleTaskCreate, handleTaskToggle, handleTaskDelete,
} = useTasks({ onCelebrate, onPlayPositiveAction });
```

### useCalendar
**File:** `src/hooks/useCalendar.ts`

```typescript
const {
  upcomingEvents, weekEvents, setUpcomingEvents,
  refreshEvents, refreshWeekEvents,
  triggerCalendarCheckin, registerCalendarEffects,
  checkForApplicableCheckins,
} = useCalendar({ session, isAuthConnected, selectedCharacter, proactiveSettings, ... });
```

### useProactiveSettings
**File:** `src/hooks/useProactiveSettings.ts`

```typescript
const {
  proactiveSettings, updateProactiveSettings,
  isSnoozed, setIsSnoozed, snoozeUntil, setSnoozeUntil,
  loadSnoozeState,
} = useProactiveSettings();
```

### useIdleTracking
**File:** `src/hooks/useIdleTracking.ts`

```typescript
const {
  lastInteractionAt, hasInteractedRef, registerInteraction,
} = useIdleTracking();
```

### useCharacterActions
**File:** `src/hooks/useCharacterActions.ts`

```typescript
const {
  currentActionId, setCurrentActionId,
  actionVideoUrls, setActionVideoUrls,
  playAction, playRandomTalkingAction,
  triggerIdleAction, scheduleIdleAction, clearIdleActionTimer,
  isTalkingActionId,
} = useCharacterActions({ selectedCharacter, isProcessingAction, media, registerInteraction });
```

### useCharacterManagement
**File:** `src/hooks/useCharacterManagement.ts`

```typescript
const {
  isSavingCharacter, isCreatingAction, updatingActionId,
  deletingActionId, isAddingIdleVideo, deletingIdleVideoId,
  isUpdatingImage, uploadedImage, setUploadedImage,
  handleImageUpload, handleCharacterCreated, handleSelectLocalVideo,
  handleManageCharacter, handleDeleteCharacter, handleBackToSelection,
  handleCreateAction, handleUpdateAction, handleDeleteAction,
  handleAddIdleVideo, handleDeleteIdleVideo,
  applyCharacterUpdate, cleanupActionUrls,
} = useCharacterManagement({ characters, setCharacters, ... });
```

---

## Message Action Handlers

Located in `src/handlers/messageActions/`

### Calendar Actions (`calendarActions.ts`)
```typescript
processCalendarAction(action, context) → CalendarActionResult
parseCalendarTagFromResponse(text) → CalendarTagParseResult | null
processCalendarTag(parsed, context) → CalendarActionResult
```

### Task Actions (`taskActions.ts`)
```typescript
processTaskAction(action, tasks, handlers) → TaskActionResult
parseTaskActionFromResponse(text) → TaskAction | null
detectTaskCompletionFallback(message, tasks) → TaskAction | null
```

### News Actions (`newsActions.ts`)
```typescript
processNewsAction(action) → NewsActionResult
formatNewsForAI(stories) → string
```

### Selfie Actions (`selfieActions.ts`)
```typescript
processSelfieAction(action, context) → SelfieActionResult
```

---

## Checklist: Adding a New Feature

### For UI Button:
- [ ] Add state variables in App.tsx
- [ ] Create service file (if external API)
- [ ] Add button to render section
- [ ] Add handler function
- [ ] Test manually

### For AI Tool (function calling):
- [ ] Add to `MemoryToolName` in `src/services/aiSchema.ts`
- [ ] Add args interface in `src/services/aiSchema.ts`
- [ ] Add to `GeminiMemoryToolDeclarations` in `src/services/aiSchema.ts`
- [ ] Add case to `executeMemoryTool()` in `src/services/memoryService.ts`
- [ ] Add documentation in `system_prompts/tools/`
- [ ] Update snapshots: `npm test -- --run -t "snapshot" -u`
- [ ] Test with AI interaction

### For Response Action (JSON field):
- [ ] Add type to `AIActionResponse` interface in `src/services/aiSchema.ts`
- [ ] Create handler in `src/handlers/messageActions/`
- [ ] Export from `src/handlers/messageActions/index.ts`
- [ ] Process in `handleSendMessage` in `App.tsx`
- [ ] Add to JSON schema in system prompt format section
- [ ] Update snapshots
- [ ] Test with AI interaction
