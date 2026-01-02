# LLM Consolidation Plan: Remove ChatGPT/Grok, Standalone Gemini

**Status:** Planning
**Created:** 2026-01-02
**Scope:** Major architectural refactoring

---

## Executive Summary

This plan removes the ChatGPT and Grok AI services, eliminates the `BaseAIService` abstract class, and refactors `GeminiChatService` to be standalone and self-sufficient. The key architectural change is moving context gathering (character, relationship, events, tasks, etc.) **from App.tsx into the service itself**.

---

## Current Architecture Problems

1. **Unnecessary Abstraction**: `BaseAIService` exists to support multiple providers, but we only use Gemini
2. **Wrong Responsibility**: `App.tsx` builds context to pass to the service - this should be the service's job
3. **Dead Code**: ChatGPT and Grok services are maintained but unused
4. **Complexity**: Provider switching logic adds cognitive overhead

---

## Files to Delete (3 files, ~1,300 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `src/services/chatGPTService.ts` | ~410 | ChatGPT provider (unused) |
| `src/services/grokChatService.ts` | ~215 | Grok provider (unused) |
| `src/services/BaseAIService.ts` | ~687 | Abstract base class (will merge into Gemini) |

---

## Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `src/services/geminiChatService.ts` | **MAJOR** | Absorb BaseAIService logic, add internal context fetching |
| `src/services/aiService.ts` | Moderate | Simplify `AIChatOptions` interface |
| `src/contexts/AIServiceContext.tsx` | Simplify | Remove multi-provider switching |
| `src/App.tsx` | Moderate | Remove context building, pass minimal options |
| `src/components/SettingsPanel.tsx` | Minor | Remove AI provider dropdown |
| `src/services/tests/duplicateIntentCalls.test.ts` | Update | Remove BaseAIService references |
| `src/services/tests/latencyOptimizations.test.ts` | Update | Update test targets |

---

## Phase 1: Refactor GeminiChatService (No Deletions Yet)

### Step 1.1: Update Interface Definitions

**File:** `src/services/aiService.ts`

**Current `AIChatOptions`:**
```typescript
export interface AIChatOptions {
  character?: CharacterProfile;
  chatHistory?: ChatMessage[];
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[];
  characterContext?: string;
  tasks?: Task[];
  googleAccessToken?: string;
  audioMode?: 'sync' | 'async' | 'none';
  onAudioData?: (audioData: string) => void;
}
```

**New `AIChatOptions`:**
```typescript
export interface AIChatOptions {
  userId: string;                           // REQUIRED: Service fetches context based on this
  chatHistory?: ChatMessage[];              // Session messages (App.tsx manages UI state)
  googleAccessToken?: string;               // For calendar/email tool calls
  audioMode?: 'sync' | 'async' | 'none';    // TTS mode
  onAudioData?: (audioData: string) => void; // Async audio callback
}
```

**Why keep `chatHistory` in options?**
- App.tsx manages the UI state of the conversation
- The session history is what gets displayed in the chat panel
- Service needs it for context but shouldn't be the source of truth for UI

### Step 1.2: Move BaseAIService Logic into GeminiChatService

Copy these from `BaseAIService.ts` into `GeminiChatService.ts`:

1. **Helper functions:**
   - `isValidTextForTTS(text)` - Validates text for TTS
   - `logAlmostMomentIfUsed(userId, aiResponse)` - Logs almost moments

2. **Context prefetching:**
   - `prefetchContext(userId)` - Parallel fetch of soul context and character facts

3. **Main response logic from `generateResponse()`:**
   - Intent detection and pre-calculation
   - Parallel context prefetch
   - Command bypass fast path
   - Genuine moment instant reaction
   - Background message analysis
   - Store self info handling
   - Idle thoughts detection
   - All audio modes (sync/async/none)
   - Post-response prefetch trigger

4. **Idle breaker logic:**
   - `triggerIdleBreaker()` - Full implementation from BaseAIService

### Step 1.3: Add Internal Context Fetching

**New method in GeminiChatService:**

```typescript
private async fetchUserContext(userId: string, googleAccessToken?: string): Promise<{
  character: CharacterProfile;
  relationship: RelationshipMetrics | null;
  upcomingEvents: CalendarEvent[];
  tasks: Task[];
  characterContext: string;
}> {
  // Parallel fetch for performance
  const [character, relationship, tasks] = await Promise.all([
    this.getCharacterProfile(),
    relationshipService.getRelationship(userId),
    taskService.fetchTasks(userId),
  ]);

  // Calendar events only if we have a token
  let upcomingEvents: CalendarEvent[] = [];
  if (googleAccessToken) {
    try {
      upcomingEvents = await calendarService.getUpcomingEvents(googleAccessToken);
    } catch (e) {
      console.warn('[GeminiService] Calendar fetch failed:', e);
    }
  }

  return {
    character,
    relationship,
    upcomingEvents,
    tasks,
    characterContext: this.getRandomVibe(),
  };
}

private getCharacterProfile(): CharacterProfile {
  // Return hardcoded Kayley profile or load from db
  return KAYLEY_PROFILE; // From domain/characters
}

private getRandomVibe(): string {
  const vibes = [
    "Sipping a matcha latte and people-watching.",
    "Trying to organize my digital photo album.",
    // ... rest of vibes (move from App.tsx)
  ];
  return vibes[Math.floor(Math.random() * vibes.length)];
}
```

### Step 1.4: Refactor generateResponse()

**New signature:**
```typescript
async generateResponse(
  input: UserContent,
  options: AIChatOptions,  // Now simplified
  session?: AIChatSession
): Promise<{
  response: AIActionResponse;
  session: AIChatSession;
  audioData?: string;
  intent?: FullMessageIntent;
}>
```

**New implementation outline:**
```typescript
async generateResponse(input: UserContent, options: AIChatOptions, session?: AIChatSession) {
  try {
    const effectiveUserId = session?.userId || options.userId;

    // 1. Start context prefetch IMMEDIATELY (parallel with intent)
    const contextPromise = this.fetchUserContext(effectiveUserId, options.googleAccessToken);

    // 2. Intent detection (parallel)
    const userMessageText = 'text' in input ? input.text : '';
    let intentPromise = this.detectIntent(userMessageText, options.chatHistory);

    // 3. Wait for both
    const [context, intent] = await Promise.all([contextPromise, intentPromise]);

    // 4. Build system prompt (now has all context)
    const systemPrompt = await buildSystemPrompt(
      context.character,
      context.relationship,
      context.upcomingEvents,
      context.characterContext,
      context.tasks,
      intent?.relationshipSignals,
      intent?.tone,
      intent,
      effectiveUserId
    );

    // 5. Call Gemini API
    const { response, session: updatedSession } = await this.callGemini(
      systemPrompt,
      input,
      options.chatHistory || [],
      session
    );

    // 6. Handle TTS based on audioMode
    // ... (existing logic from BaseAIService)

    // 7. Background processing (fire-and-forget)
    // ... (existing logic from BaseAIService)

    return { response, session: updatedSession, audioData, intent };
  } catch (error) {
    console.error("Gemini Service Error:", error);
    throw error;
  }
}
```

---

## Phase 2: Simplify AIServiceContext

**File:** `src/contexts/AIServiceContext.tsx`

**Before (multi-provider):**
```typescript
const services = {
  gemini: geminiChatService,
  grok: grokService,
  chatgpt: chatGPTService,
};

// Provider switching logic, localStorage persistence, etc.
```

**After (single provider):**
```typescript
import { geminiChatService } from '../services/geminiChatService';

const AIServiceContext = createContext<{
  service: typeof geminiChatService;
}>({ service: geminiChatService });

export function AIServiceProvider({ children }: { children: React.ReactNode }) {
  return (
    <AIServiceContext.Provider value={{ service: geminiChatService }}>
      {children}
    </AIServiceContext.Provider>
  );
}

export function useAIService() {
  return useContext(AIServiceContext).service;
}
```

Or even simpler - just export the service directly:
```typescript
export { geminiChatService as aiService } from '../services/geminiChatService';
```

---

## Phase 3: Simplify App.tsx

### Step 3.1: Remove Context Building

**Before (App.tsx builds context):**
```typescript
const { response, session: updatedSession, audioData } = await activeService.generateResponse(
  { type: 'text', text: message },
  {
    character: selectedCharacter,
    chatHistory: chatHistory,
    relationship: relationship,
    upcomingEvents: upcomingEvents,
    characterContext: kayleyContext,
    tasks: tasks,
    googleAccessToken: session.accessToken,
    audioMode: 'async',
    onAudioData: (data) => media.enqueueAudio(data),
  },
  sessionToUse
);
```

**After (minimal options):**
```typescript
const { response, session: updatedSession, audioData } = await aiService.generateResponse(
  { type: 'text', text: message },
  {
    userId: getUserId(),
    chatHistory: chatHistory,
    googleAccessToken: session?.accessToken,
    audioMode: 'async',
    onAudioData: (data) => media.enqueueAudio(data),
  },
  sessionToUse
);
```

### Step 3.2: Remove State That Service Now Owns

**State to potentially remove from App.tsx:**
- `kayleyContext` (random vibe) - Service generates this
- `upcomingEvents` - Service fetches this (but App might still need for UI display)
- `relationship` - Service fetches this (but App might still need for UI display)
- `tasks` - Service fetches this (but TaskPanel still needs it)

**State to keep in App.tsx:**
- `chatHistory` - UI state for the chat panel
- `selectedCharacter` - UI state for character selection flow
- `tasks` - UI state for TaskPanel (service fetches its own copy)

### Step 3.3: Update triggerIdleBreaker Calls

**Before:**
```typescript
await activeService.triggerIdleBreaker(
  userId,
  {
    character: selectedCharacter,
    relationship,
    tasks,
    chatHistory,
    characterContext: kayleyContext,
    upcomingEvents,
    proactiveSettings,
  },
  aiSession
);
```

**After:**
```typescript
await aiService.triggerIdleBreaker(
  userId,
  {
    chatHistory,
    googleAccessToken: session?.accessToken,
    proactiveSettings,
  },
  aiSession
);
```

---

## Phase 4: Delete Old Files

Only after Phase 1-3 are complete and tested:

```bash
git rm src/services/chatGPTService.ts
git rm src/services/grokChatService.ts
git rm src/services/BaseAIService.ts
```

---

## Phase 5: Update Tests

### Files to Update:

1. **`src/services/tests/duplicateIntentCalls.test.ts`**
   - Remove `BaseAIService` import
   - Test `GeminiChatService` directly
   - Update mock setup for new interface

2. **`src/services/tests/latencyOptimizations.test.ts`**
   - Replace class hierarchy tests
   - Test `GeminiChatService` standalone

3. **Snapshot tests**
   ```bash
   npm test -- --run -t "snapshot" -u
   ```

---

## Phase 6: Update Documentation

1. **CLAUDE.md** - Update architecture diagram
2. **docs/PresenceDirector.md** - Update references
3. **Service docs** - Update any BaseAIService references

---

## Migration Checklist

### Pre-Migration
- [ ] All tests pass currently
- [ ] Create backup branch

### Phase 1: Standalone Gemini
- [ ] Update `AIChatOptions` interface in `aiService.ts`
- [ ] Copy helper functions from BaseAIService to GeminiChatService
- [ ] Add `fetchUserContext()` method
- [ ] Refactor `generateResponse()` to use internal context
- [ ] Refactor `triggerIdleBreaker()` to use internal context
- [ ] Move vibes array from App.tsx to GeminiChatService
- [ ] Test GeminiChatService works standalone

### Phase 2: Simplify Context
- [ ] Simplify `AIServiceContext.tsx`
- [ ] Remove provider switching logic
- [ ] Update `useAIService` hook

### Phase 3: Simplify App.tsx
- [ ] Update `handleSendMessage()` calls
- [ ] Update `handleSendImage()` calls
- [ ] Update `triggerIdleBreaker()` calls
- [ ] Update `triggerSystemMessage()` calls
- [ ] Remove unused state (if safe)

### Phase 4: Delete Files
- [ ] Delete `chatGPTService.ts`
- [ ] Delete `grokChatService.ts`
- [ ] Delete `BaseAIService.ts`

### Phase 5: Tests
- [ ] Update `duplicateIntentCalls.test.ts`
- [ ] Update `latencyOptimizations.test.ts`
- [ ] Update snapshot tests
- [ ] All tests pass

### Phase 6: Documentation
- [ ] Update CLAUDE.md
- [ ] Update service docs
- [ ] Update any other references

### Post-Migration
- [ ] Full test suite passes
- [ ] Manual testing of chat functionality
- [ ] Manual testing of idle breaker
- [ ] Manual testing of image upload
- [ ] Commit and push

---

## Risk Mitigation

1. **Incremental Approach**: Complete each phase fully before moving to the next
2. **No Deletions Until Tested**: Keep old files until new implementation is verified
3. **Feature Parity Check**: Ensure all BaseAIService features work in GeminiChatService
4. **Test Coverage**: Run full test suite after each phase

---

## Estimated Scope

| Phase | Effort | Files Changed |
|-------|--------|---------------|
| Phase 1 | Large | 2 files (geminiChatService, aiService) |
| Phase 2 | Small | 1 file (AIServiceContext) |
| Phase 3 | Medium | 1 file (App.tsx) |
| Phase 4 | Trivial | 3 file deletions |
| Phase 5 | Medium | 2-3 test files |
| Phase 6 | Small | Documentation |

**Total: ~8-10 files modified, 3 deleted**
