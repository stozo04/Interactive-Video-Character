# Message Orchestrator Service

**File**: `src/services/messageOrchestrator.ts`
**Status**: In Development
**Related Types**: `src/handlers/messageActions/types.ts`

The `messageOrchestrator.ts` is the central coordinator for processing user messages. It handles the complete flow from receiving a message to returning UI updates, keeping `App.tsx` as a thin presentation layer.

## Core Responsibilities

1. **Pre-processing**: Detect calendar queries and inject live context
2. **AI Call**: Coordinate with the AI service to get responses
3. **Action Routing**: Route to appropriate handlers (task, calendar, news, selfie)
4. **Post-processing**: Trigger background fact detection and presence tracking
5. **Result Building**: Return a standardized result for UI updates

## Why This Service Exists

Before this service, `App.tsx` contained ~400 lines of business logic for message handling. This violated several principles:
- **Untestable**: Couldn't unit test without React
- **SRP Violation**: UI component doing business logic
- **Hard to maintain**: Logic scattered across one huge function

## Workflow Interaction

```text
User Message
      |
      V
[App.tsx] --calls--> [messageOrchestrator.processUserMessage()]
                              |
              +---------------+---------------+
              |               |               |
              V               V               V
      [Pre-process]    [AI Service]    [Post-process]
      (Calendar ctx)   (generateResponse)  (Facts, Presence)
              |               |               |
              +-------+-------+               |
                      |                       |
                      V                       |
              [Action Routing]                |
              /    |    |    \               |
            Task  Cal  News  Selfie          |
              \    |    |    /               |
              +----+----+----+               |
                      |                       |
                      V                       |
              [OrchestratorResult] <----------+
                      |
                      V
              [App.tsx applies to UI]
```

## Key Types

### Enums (No Magic Strings!)

```typescript
enum ActionType {
  TASK = 'task',
  CALENDAR = 'calendar',
  NEWS = 'news',
  SELFIE = 'selfie',
  NONE = 'none',
}

enum CalendarQueryType {
  NONE = 'none',
  READ = 'read',   // "What's on my calendar?"
  WRITE = 'write', // "Delete my meeting"
}

enum ProcessingStage {
  PREPROCESSING = 'preprocessing',
  AI_CALL = 'ai_call',
  ACTION_ROUTING = 'action_routing',
  POSTPROCESSING = 'postprocessing',
  COMPLETE = 'complete',
  ERROR = 'error',
}
```

### OrchestratorResult

The standardized return type that tells App.tsx what to do:

```typescript
interface OrchestratorResult {
  // Status
  success: boolean;
  actionType: ActionType;
  stage: ProcessingStage;

  // Chat updates
  chatMessages: ChatMessage[];

  // Media
  audioToPlay?: string;
  actionToPlay?: string;

  // Navigation
  appToOpen?: string;

  // State refresh flags
  refreshCalendar: boolean;
  refreshTasks: boolean;
  openTaskPanel: boolean;

  // Session
  updatedSession?: AIChatSession;

  // Errors
  error?: string;
}
```

## Does it use an LLM?

**Indirectly.** It calls `activeService.generateResponse()` which uses the configured LLM (Gemini, GPT, etc.). The orchestrator itself is pure JavaScript logic.

## Logging Philosophy

This service uses extensive logging with emoji prefixes:

| Emoji | Meaning |
|-------|---------|
| `🎯` | Orchestrator entry/routing decisions |
| `📅` | Calendar operations |
| `⚡` | Performance/live fetches |
| `✅` | Success/completion |
| `❌` | Errors |
| `🧠` | Background processing (facts) |
| `🎭` | Character fact detection |
| `👁️` | Presence detection |

Example logs:
```
🎯 [Orchestrator] Processing message: "what's on my calendar"
⚡ [Orchestrator] Fetching live calendar data...
📅 [Orchestrator] Got 3 events
📅 [Orchestrator] Injected READ calendar context
🎯 [Orchestrator] Routing to calendar handler
✅ [Orchestrator] Complete: actionType=calendar, success=true
```

## Integration Points

### Inputs From
- `App.tsx` - User message and context
- `IAIChatService` - AI response generation
- `calendarService` - Live calendar data

### Outputs To
- `App.tsx` - UI updates via `OrchestratorResult`
- `taskActions` - Task creation/completion
- `calendarActions` - Calendar modifications
- `newsActions` - News fetching
- `selfieActions` - Image generation

### Background Processing (Fire-and-Forget)
- `processDetectedFacts` - User fact storage
- ~~`processAndStoreCharacterFacts`~~ - Character fact storage ❌ **Removed 2026-01-13** (now via `store_self_info` LLM tool)
- `detectKayleyPresence` - Presence state updates

## Testing

### Unit Tests
```bash
npm test -- --run -t "MessageOrchestrator"
```

### Test File Location
`src/services/__tests__/messageOrchestrator.test.ts`

### Key Test Cases
1. Calendar query detection (READ vs WRITE)
2. Action type routing
3. Error handling
4. Background processing triggers
5. Result building

## Common Patterns

### Adding a New Action Type

1. Add to `ActionType` enum in `types.ts`
2. Add handler in `handlers/messageActions/`
3. Add routing case in `messageOrchestrator.ts`
4. Add tests

### Detecting Special Queries

Use the pattern from `detectCalendarQuery`:
```typescript
export function detectCalendarQuery(message: string): CalendarQueryType {
  const lower = message.toLowerCase();
  const hasKeyword = KEYWORDS.some(kw => lower.includes(kw));
  if (!hasKeyword) return CalendarQueryType.NONE;
  // ... more logic
}
```

## Related Documentation

- [Message_Orchestrator_Refactor.md](../../../docs/features/Message_Orchestrator_Refactor.md) - Implementation plan
- [types.ts](../../handlers/messageActions/types.ts) - Type definitions
- [App.tsx](../../App.tsx) - Consumer of this service
