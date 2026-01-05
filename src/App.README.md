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
│                              App.tsx (~2,000 lines)                         │
│                         Core Orchestration Layer                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  useTasks   │  │ useCalendar │  │useProactive │  │useCharacter │        │
│  │             │  │             │  │  Settings   │  │  Actions    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐         │
│  │useIdle     │  │useCharacter │  │    Message Action Handlers   │         │
│  │ Tracking   │  │ Management  │  │  (calendar, task, news,      │         │
│  └─────────────┘  └─────────────┘  │   selfie)                    │         │
│                                    └─────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Service Layer                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ BaseAIService   │  │ System Prompts  │  │  State Services │              │
│  │ (Gemini/GPT/    │  │ Builder         │  │  (Supabase)     │              │
│  │  Grok)          │  │                 │  │                 │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── App.tsx                      # Core orchestration (this file)
├── App.README.md                # This documentation
├── hooks/                       # Extracted custom hooks
│   ├── useTasks.ts              # Task state & CRUD
│   ├── useCalendar.ts           # Calendar polling & check-ins
│   ├── useProactiveSettings.ts  # Snooze & proactive toggles
│   ├── useIdleTracking.ts       # User activity tracking
│   ├── useCharacterActions.ts   # Video playback & action logic
│   └── useCharacterManagement.ts# Character CRUD operations
├── handlers/
│   ├── whiteboardHandler.ts     # Whiteboard AI interaction
│   └── messageActions/          # AI response action handlers
│       ├── calendarActions.ts   # Calendar create/delete
│       ├── taskActions.ts       # Task CRUD from AI
│       ├── newsActions.ts       # News fetching
│       ├── selfieActions.ts     # Image generation
│       └── index.ts             # Consolidated exports
└── services/
    ├── geminiChatService.ts     # Gemini AI provider
    ├── system_prompts/          # Modular prompt architecture
    │   └── builders/
    │       └── systemPromptBuilder.ts
    └── aiSchema.ts              # Tool declarations & types
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
│ STEP 2: PRE-PROCESSING (App.tsx lines 1267-1346)                            │
│ • registerInteraction() - Reset idle timer                                   │
│ • Add user message to chatHistory                                            │
│ • recordExchange() - Track for callbacks                                     │
│ • Predict action optimistically (play video immediately)                     │
│ • Inject calendar context if schedule-related query                          │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: AI SERVICE CALL (services/geminiChatService.ts)                     │
│                                                                              │
│ activeService.generateResponse({                                             │
│   type: 'text',                                                              │
│   text: message + injectedContext                                            │
│ }, options, session)                                                         │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: CONTEXT FETCHING (services/geminiChatService.ts generateResponse)   │
│                                                                              │
│ Parallel fetches:                                                            │
│ • getFullCharacterContext() - Unified RPC (relationship, mood, facts)        │
│ • detectFullIntentLLMCached() - Intent detection                             │
│ • getRelevantMemories() - Semantic search                                    │
│ • getUnsharedThoughts() - Idle thoughts to surface                           │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: SYSTEM PROMPT BUILDING                                               │
│ (services/system_prompts/builders/systemPromptBuilder.ts)                   │
│                                                                              │
│ buildSystemPrompt({                                                          │
│   characterName, relationship, mood, intent,                                 │
│   upcomingEvents, tasks, memories, characterFacts...                         │
│ })                                                                           │
│                                                                              │
│ Assembles prompt from modular sections:                                      │
│ • core/ - Identity, anti-assistant rules                                     │
│ • behavior/ - Comfort, curiosity, friction                                   │
│ • relationship/ - Tier-specific behavior                                     │
│ • tools/ - Tool usage instructions                                           │
│ • format/ - JSON schema, output rules                                        │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 6: LLM CALL (Gemini API)                                               │
│                                                                              │
│ model.generateContent({                                                      │
│   contents: [systemPrompt, chatHistory, userMessage],                        │
│   tools: GeminiMemoryToolDeclarations,  // From aiSchema.ts                  │
│   generationConfig: { responseMimeType: 'application/json' }                 │
│ })                                                                           │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 7: TOOL CALL PROCESSING (services/geminiChatService.ts)                │
│                                                                              │
│ If LLM returns tool calls (e.g., store_user_info, manage_task):             │
│ • executeMemoryTool() processes each tool                                    │
│ • Results fed back to LLM for final response                                 │
│ • Loop until no more tool calls                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 8: RESPONSE PARSING (services/geminiChatService.ts)                    │
│                                                                              │
│ Parse JSON response into AIResponse:                                         │
│ {                                                                            │
│   text_response: "Hey! Here's what I found...",                              │
│   action_id: "happy_wave",                                                   │
│   task_action: { action: "create", task_text: "Buy milk" },                 │
│   calendar_action: { action: "create", summary: "Meeting" },                │
│   news_action: { action: "fetch" },                                          │
│   selfie_action: { scene: "coffee shop", mood: "happy" }                    │
│ }                                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 9: AUDIO GENERATION (Parallel)                                         │
│                                                                              │
│ generateSpeech(text_response) → ElevenLabs API → audioData                  │
│ (Can be sync or async mode based on options.audioMode)                       │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 10: ACTION HANDLER PROCESSING (App.tsx lines 1474-1694)                │
│ (handlers/messageActions/*.ts)                                               │
│                                                                              │
│ Process in order:                                                            │
│ 1. Task Actions → processTaskAction()                                        │
│ 2. Calendar Actions → processCalendarAction()                                │
│ 3. News Actions → processNewsAction()                                        │
│ 4. Selfie Actions → processSelfieAction()                                    │
│ 5. Fallback: Calendar tags in text → parseCalendarTagFromResponse()         │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 11: UI UPDATE (App.tsx)                                                │
│                                                                              │
│ • setChatHistory([...prev, { role: 'model', text: response }])              │
│ • media.enqueueAudio(audioData) - Queue for playback                        │
│ • playAction(action_id) - Trigger video                                      │
│ • Save to conversationHistoryService                                         │
│ • Start background sentiment analysis                                        │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 12: DISPLAY                                                            │
│                                                                              │
│ ChatPanel renders new message                                                │
│ AudioPlayer plays queued audio                                               │
│ VideoPlayer shows action video                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Adding a New UI Button

### Example: Adding a Slack Integration Button

Follow these steps to add a new button to the UI (e.g., Slack connection toggle).

#### Step 1: Add State in App.tsx

```typescript
// src/App.tsx - In the state section (around line 269)

// --------------------------------------------------------------------------
// SLACK INTEGRATION STATE
// --------------------------------------------------------------------------
const [isSlackConnected, setIsSlackConnected] = useState(false);
const [slackChannels, setSlackChannels] = useState<string[]>([]);
```

#### Step 2: Create the Service (if needed)

```typescript
// src/services/slackService.ts

export interface SlackMessage {
  channel: string;
  text: string;
  timestamp: string;
  user: string;
}

class SlackService extends EventTarget {
  private accessToken: string | null = null;

  async connect(token: string): Promise<boolean> {
    this.accessToken = token;
    // Implement OAuth or webhook connection
    return true;
  }

  async getChannels(): Promise<string[]> {
    // Fetch channels from Slack API
    return [];
  }

  async sendMessage(channel: string, text: string): Promise<void> {
    // Send message to Slack
  }
}

export const slackService = new SlackService();
```

#### Step 3: Add Button to Header (App.tsx render section)

```typescript
// src/App.tsx - In the header section (around line 1888)

<div className="absolute top-0 right-0 flex items-center gap-2">
  {/* Slack Connection Button */}
  {view === 'chat' && selectedCharacter && (
    <button
      onClick={() => handleSlackConnect()}
      className={`rounded-full p-3 shadow-lg transition-all hover:scale-110 ${
        isSlackConnected
          ? 'bg-green-500 text-white'
          : 'bg-gray-600 text-gray-300'
      }`}
      title={isSlackConnected ? 'Slack Connected' : 'Connect Slack'}
    >
      {/* Slack Icon SVG */}
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
      </svg>
    </button>
  )}

  {/* Existing Task Panel Toggle */}
  {view === 'chat' && selectedCharacter && (
    // ... existing task button
  )}
</div>
```

#### Step 4: Add Handler Function

```typescript
// src/App.tsx - In handlers section (around line 1030)

const handleSlackConnect = async () => {
  if (isSlackConnected) {
    // Disconnect
    setIsSlackConnected(false);
    setSlackChannels([]);
    console.log('📱 Slack disconnected');
  } else {
    // Open OAuth flow or settings modal
    try {
      // Example: Open settings panel or OAuth popup
      const token = await openSlackOAuth(); // You'd implement this
      const connected = await slackService.connect(token);
      if (connected) {
        setIsSlackConnected(true);
        const channels = await slackService.getChannels();
        setSlackChannels(channels);
        console.log('📱 Slack connected');
      }
    } catch (error) {
      console.error('Slack connection failed:', error);
      setErrorMessage('Failed to connect to Slack');
    }
  }
};
```

#### Step 5: Add to SettingsPanel (Optional)

```typescript
// src/components/SettingsPanel.tsx

interface SettingsPanelProps {
  // ... existing props
  onSlackConnectionChange?: (connected: boolean) => void;
  isSlackConnected?: boolean;
}

// Add Slack toggle in the settings panel UI
```

---

## Adding a New AI Action

### Example: Adding a Slack Select Action

This allows the AI to select a Slack channel and send a message.

#### Step 1: Define Types in aiSchema.ts

```typescript
// src/services/aiSchema.ts

// Add to MemoryToolName enum (around line 20)
export type MemoryToolName =
  | 'store_user_info'
  | 'search_memories'
  | 'manage_task'
  // ... existing tools
  | 'send_slack_message';  // NEW

// Add to ToolCallArgs type (around line 50)
export type ToolCallArgs =
  | StoreUserInfoArgs
  | SearchMemoriesArgs
  // ... existing args
  | SendSlackMessageArgs;  // NEW

// Define the new args interface
export interface SendSlackMessageArgs {
  channel: string;
  message: string;
}

// Add to MemoryToolArgs union (CRITICAL - around line 80)
export type MemoryToolArgs =
  | { name: 'store_user_info'; args: StoreUserInfoArgs }
  // ... existing
  | { name: 'send_slack_message'; args: SendSlackMessageArgs };  // NEW

// Add to PendingToolCall.name union (CRITICAL - around line 100)
export interface PendingToolCall {
  name: 'store_user_info' | 'search_memories' | 'manage_task'
    | /* ... */ | 'send_slack_message';  // NEW
  args: ToolCallArgs;
}
```

#### Step 2: Add Tool Declaration to Gemini

```typescript
// src/services/aiSchema.ts - GeminiMemoryToolDeclarations array

{
  name: 'send_slack_message',
  description: 'Send a message to a Slack channel on behalf of the user',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      channel: {
        type: SchemaType.STRING,
        description: 'The Slack channel name (e.g., #general)',
      },
      message: {
        type: SchemaType.STRING,
        description: 'The message to send',
      },
    },
    required: ['channel', 'message'],
  },
},
```

#### Step 3: Add Tool Execution in memoryService.ts

```typescript
// src/services/memoryService.ts - executeMemoryTool function

case 'send_slack_message': {
  const { channel, message } = args as SendSlackMessageArgs;
  console.log(`📱 [MemoryTool] Sending Slack message to ${channel}`);

  try {
    await slackService.sendMessage(channel, message);
    return {
      success: true,
      message: `Message sent to ${channel}`,
    };
  } catch (error) {
    console.error('Failed to send Slack message:', error);
    return {
      success: false,
      error: 'Failed to send message',
    };
  }
}
```

#### Step 4: Add Tool Documentation

```typescript
// src/services/system_prompts/tools/index.ts

export function buildToolsSection(): string {
  return `
====================================================
AVAILABLE TOOLS
====================================================

// ... existing tools ...

## send_slack_message
Send a message to a Slack channel.
- Use when user asks you to message someone on Slack
- Requires: channel (string), message (string)

Example:
User: "Tell the team in #general that I'll be late"
→ Call send_slack_message with channel="#general", message="Hey team, I'll be running a bit late today!"
`;
}
```

#### Step 5: Add Response Action Type (if needed)

If you want the AI to return a `slack_action` in its response (separate from tool calls):

```typescript
// src/services/aiSchema.ts - AIResponse interface

export interface AIResponse {
  text_response: string;
  action_id?: string;
  task_action?: TaskAction;
  calendar_action?: CalendarAction;
  news_action?: NewsAction;
  selfie_action?: SelfieAction;
  slack_action?: SlackAction;  // NEW
}

export interface SlackAction {
  action: 'send' | 'read';
  channel?: string;
  message?: string;
}
```

#### Step 6: Create Action Handler

```typescript
// src/handlers/messageActions/slackActions.ts

import { slackService } from '../../services/slackService';

export interface SlackAction {
  action: 'send' | 'read';
  channel?: string;
  message?: string;
}

export interface SlackActionResult {
  handled: boolean;
  success: boolean;
  error?: string;
}

export async function processSlackAction(
  slackAction: SlackAction | null | undefined
): Promise<SlackActionResult> {
  if (!slackAction || !slackAction.action) {
    return { handled: false, success: false };
  }

  console.log('📱 Slack action detected:', slackAction);

  try {
    if (slackAction.action === 'send' && slackAction.channel && slackAction.message) {
      await slackService.sendMessage(slackAction.channel, slackAction.message);
      return { handled: true, success: true };
    }

    return { handled: false, success: false };
  } catch (error) {
    console.error('Slack action failed:', error);
    return {
      handled: true,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

#### Step 7: Export from Index

```typescript
// src/handlers/messageActions/index.ts

export {
  processSlackAction,
  type SlackAction,
  type SlackActionResult,
} from './slackActions';
```

#### Step 8: Process in handleSendMessage

```typescript
// src/App.tsx - In handleSendMessage (around line 1550)

// ============================================
// SLACK ACTIONS
// ============================================
const slackAction = response.slack_action;

if (slackAction && slackAction.action) {
  const slackResult = await processSlackAction(slackAction);

  if (slackResult.handled) {
    if (slackResult.success) {
      // Show confirmation
      setChatHistory(prev => [...prev, {
        role: 'model',
        text: response.text_response
      }]);

      if (!isMuted && audioData) {
        media.enqueueAudio(audioData);
      }
    } else {
      setErrorMessage(slackResult.error || 'Failed to send Slack message');
    }

    // Continue to handle other actions or return early
  }
}
```

#### Step 9: Update Snapshot Tests

```bash
npm test -- --run -t "snapshot" -u
```

---

## Key Files Reference

| File | Purpose | When to Modify |
|------|---------|----------------|
| `App.tsx` | Core orchestration, state, UI | Adding UI elements, new state |
| `services/aiSchema.ts` | Tool declarations, response types | Adding new AI tools/actions |
| `services/memoryService.ts` | Tool execution logic | Implementing tool behavior |
| `services/geminiChatService.ts` | AI provider implementation | Modifying AI request/response |
| `services/system_prompts/builders/systemPromptBuilder.ts` | Prompt assembly | Adding context to prompts |
| `services/system_prompts/tools/index.ts` | Tool documentation | Documenting new tools |
| `handlers/messageActions/*.ts` | Response action processing | Adding new action handlers |

---

## Custom Hooks

### useTasks
**File:** `src/hooks/useTasks.ts`
**Purpose:** Task state management and CRUD operations

```typescript
const {
  tasks,                    // Task[] - Current tasks
  setTasks,                 // Setter for tasks
  isTaskPanelOpen,          // boolean - Panel visibility
  setIsTaskPanelOpen,       // Setter for panel state
  loadTasks,                // () => Promise<Task[]>
  refreshTasks,             // () => Promise<Task[]>
  handleTaskCreate,         // (text, priority?) => Promise<void>
  handleTaskToggle,         // (taskId) => Promise<void>
  handleTaskDelete,         // (taskId) => Promise<void>
} = useTasks({ onCelebrate, onPlayPositiveAction });
```

### useCalendar
**File:** `src/hooks/useCalendar.ts`
**Purpose:** Calendar polling and check-ins

```typescript
const {
  upcomingEvents,           // CalendarEvent[] - Next 7 days
  weekEvents,               // CalendarEvent[] - Week events
  setUpcomingEvents,        // Setter
  refreshEvents,            // (accessToken) => Promise<CalendarEvent[]>
  refreshWeekEvents,        // (accessToken) => Promise<void>
  triggerCalendarCheckin,   // (event, type) => void
  registerCalendarEffects,  // () => cleanup function
  checkForApplicableCheckins, // (events) => void
} = useCalendar({ session, selectedCharacter, proactiveSettings, ... });
```

### useProactiveSettings
**File:** `src/hooks/useProactiveSettings.ts`
**Purpose:** Proactive feature toggles and snooze state

```typescript
const {
  proactiveSettings,        // { checkins, calendar, news }
  updateProactiveSettings,  // (updates) => void
  isSnoozed,                // boolean
  setIsSnoozed,             // Setter
  snoozeUntil,              // number | null
  setSnoozeUntil,           // Setter
  loadSnoozeState,          // () => void
} = useProactiveSettings();
```

### useIdleTracking
**File:** `src/hooks/useIdleTracking.ts`
**Purpose:** Track user activity for idle detection

```typescript
const {
  lastInteractionAt,        // number - Timestamp
  hasInteractedRef,         // Ref<boolean>
  registerInteraction,      // () => void
} = useIdleTracking();
```

### useCharacterActions
**File:** `src/hooks/useCharacterActions.ts`
**Purpose:** Video playback and action categorization

```typescript
const {
  currentActionId,          // string | null
  setCurrentActionId,       // Setter
  actionVideoUrls,          // Record<string, string>
  setActionVideoUrls,       // Setter
  playAction,               // (actionId, force?) => boolean
  playRandomTalkingAction,  // (force?) => string | null
  triggerIdleAction,        // () => void
  scheduleIdleAction,       // () => void
  clearIdleActionTimer,     // () => void
  isTalkingActionId,        // (actionId) => boolean
} = useCharacterActions({ selectedCharacter, isProcessingAction, media, registerInteraction });
```

### useCharacterManagement
**File:** `src/hooks/useCharacterManagement.ts`
**Purpose:** Character CRUD operations

```typescript
const {
  isSavingCharacter,        // boolean
  isCreatingAction,         // boolean
  updatingActionId,         // string | null
  deletingActionId,         // string | null
  isAddingIdleVideo,        // boolean
  deletingIdleVideoId,      // string | null
  isUpdatingImage,          // boolean
  uploadedImage,            // UploadedImage | null
  setUploadedImage,         // Setter
  handleImageUpload,        // (image) => void
  handleCharacterCreated,   // (name, videos) => Promise<void>
  handleSelectLocalVideo,   // (files) => void
  handleManageCharacter,    // (character) => void
  handleDeleteCharacter,    // (characterId) => void
  handleBackToSelection,    // () => void
  handleCreateAction,       // (name, phrases, video) => Promise<void>
  handleUpdateAction,       // (actionId, name, phrases, video?) => Promise<void>
  handleDeleteAction,       // (actionId) => Promise<void>
  handleAddIdleVideo,       // (videoFile) => Promise<void>
  handleDeleteIdleVideo,    // (videoUrl) => Promise<void>
  applyCharacterUpdate,     // (characterId, updater) => void
  cleanupActionUrls,        // (urls) => void
} = useCharacterManagement({ characters, setCharacters, ... });
```

---

## Message Action Handlers

Located in `src/handlers/messageActions/`

### Calendar Actions
**File:** `calendarActions.ts`

```typescript
// Process structured calendar_action from AI response
processCalendarAction(action, context) → CalendarActionResult

// Parse legacy [CALENDAR_CREATE]/[CALENDAR_DELETE] tags
parseCalendarTagFromResponse(text) → CalendarTagParseResult | null

// Process parsed calendar tag
processCalendarTag(parsed, context) → CalendarActionResult
```

### Task Actions
**File:** `taskActions.ts`

```typescript
// Process task_action from AI response
processTaskAction(action, tasks, handlers) → TaskActionResult

// Parse embedded JSON task_action from text
parseTaskActionFromResponse(text) → TaskAction | null

// Detect task completion from user message (fallback)
detectTaskCompletionFallback(message, tasks) → TaskAction | null
```

### News Actions
**File:** `newsActions.ts`

```typescript
// Fetch and format news
processNewsAction(action) → NewsActionResult

// Format stories for AI prompt
formatNewsForAI(stories) → string
```

### Selfie Actions
**File:** `selfieActions.ts`

```typescript
// Generate AI companion selfie
processSelfieAction(action, context) → SelfieActionResult
```

---

## Checklist: Adding a New Feature

### For UI Button:
- [ ] Add state variables in App.tsx
- [ ] Create service file (if external API)
- [ ] Add button to render section
- [ ] Add handler function
- [ ] Add to SettingsPanel (if toggleable)
- [ ] Test manually

### For AI Action (Tool Call):
- [ ] Add to `MemoryToolName` in aiSchema.ts
- [ ] Add args interface in aiSchema.ts
- [ ] Add to `MemoryToolArgs` union in aiSchema.ts
- [ ] Add to `PendingToolCall.name` union in aiSchema.ts
- [ ] Add to `GeminiMemoryToolDeclarations` array in aiSchema.ts
- [ ] Add case to `executeMemoryTool` switch in memoryService.ts
- [ ] Add documentation in system_prompts/tools/index.ts
- [ ] Update snapshots: `npm test -- --run -t "snapshot" -u`
- [ ] Test with AI interaction

### For Response Action (Non-Tool):
- [ ] Add type to `AIResponse` interface in aiSchema.ts
- [ ] Create handler in `handlers/messageActions/`
- [ ] Export from `handlers/messageActions/index.ts`
- [ ] Process in `handleSendMessage` in App.tsx
- [ ] Add to JSON schema in system prompt format section
- [ ] Update snapshots
- [ ] Test with AI interaction
