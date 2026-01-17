# Promise Tracking System: Implementation Plan

**Status:** Ready for Implementation
**Approach:** Test-Driven Development (TDD)
**Timeline:** Complete all steps before marking done

---

## Requirements Summary

Based on discussion with user:

1. **LLM-Only Detection** - No regex/guessing. LLM detects when Kayley makes a promise and calls `make_promise` tool
2. **Fixed 10-Minute Timing** - All promises trigger after 10 minutes (extensible architecture for future: mood, time-of-day, etc.)
3. **Offline Handling** - If user is offline when promise is ready, deliver it when they come back online (integrate with welcome/continue flow)
4. **Service Documentation** - Create `src/services/docs/PromiseService.md`
5. **Follow Checklists** - Adhere to Tool Integration Checklist and System Prompt Guidelines
6. **TDD Approach** - Write tests first, then implementation
7. **Update All READMEs** - Service docs hub, sub-agents, etc.

---

## Architecture Decisions

### Simplified Timing Model

```typescript
// Current: Fixed 10 minutes
const estimatedTiming = new Date(Date.now() + 10 * 60 * 1000);

// Future: Extensible with timing calculator
const estimatedTiming = calculatePromiseTiming({
  mood: soulContext.moodKnobs,
  timeOfDay: new Date().getHours(),
  eventType: promiseType,
  userContext: relationship
});
```

**For now:** Always 10 minutes. Architecture supports future complexity.

### Offline Delivery Strategy

**Two delivery paths:**

1. **Background Checker** (every 5 minutes)
   - Checks for ready promises
   - Creates pending messages if user is online

2. **On-Login Delivery** (new)
   - When user logs in / starts conversation
   - Check for any ready promises that were missed while offline
   - Integrate into greeting/welcome flow
   - Kayley acknowledges the promise: "Oh! I was going to send you..."

---

## Implementation Steps (TDD Order)

### Step 1: Write Tests First ✅ TDD

**File:** `src/services/tests/promiseService.test.ts`

Tests to write:
- `createPromise()` - Creates promise with correct fields
- `getReadyPromises()` - Returns promises past their timing
- `getPendingPromises()` - Returns all pending promises
- `fulfillPromise()` - Marks promise fulfilled, creates pending message
- `checkAndFulfillPromises()` - Finds and fulfills ready promises
- `cancelPromise()` - Cancels a promise
- `cleanupOldPromises()` - Removes old fulfilled promises
- Edge cases: no promises, already fulfilled, invalid IDs

**Run:** `npm test -- --run -t "promiseService"`
**Expected:** All tests should FAIL initially (red phase)

---

### Step 2: Create Database Migration

**File:** `supabase/migrations/YYYYMMDDHHMMSS_create_promises_table.sql`

```sql
-- Create promises table
CREATE TABLE promises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  promise_type TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  estimated_timing TIMESTAMPTZ NOT NULL,
  commitment_context TEXT,
  fulfillment_data JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pending' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  fulfilled_at TIMESTAMPTZ,

  CHECK (status IN ('pending', 'fulfilled', 'missed', 'cancelled'))
);

-- Indexes for performance
CREATE INDEX idx_promises_user_status ON promises(user_id, status);
CREATE INDEX idx_promises_timing ON promises(user_id, estimated_timing) WHERE status = 'pending';

-- RLS policies
ALTER TABLE promises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own promises"
  ON promises FOR ALL
  USING (auth.uid() = user_id);

-- Comments
COMMENT ON TABLE promises IS 'Tracks future commitments Kayley makes to the user';
COMMENT ON COLUMN promises.promise_type IS 'Type: send_selfie, share_update, follow_up, etc.';
COMMENT ON COLUMN promises.trigger_event IS 'Human-readable: "when I go on my walk"';
COMMENT ON COLUMN promises.estimated_timing IS 'When to fulfill (fixed 10min for now, extensible)';
COMMENT ON COLUMN promises.fulfillment_data IS 'Data for fulfillment: selfieParams, messageText, etc.';
```

**Note:** User will apply migration manually. Do NOT run `supabase db push`.

---

### Step 3: Implement Promise Service

**File:** `src/services/promiseService.ts`

Implement all functions to make tests pass (green phase):

```typescript
export type PromiseType =
  | "send_selfie"
  | "share_update"
  | "send_content"
  | "follow_up"
  | "reminder"
  | "send_voice_note";

export interface Promise {
  id: string;
  promiseType: PromiseType;
  description: string;
  triggerEvent: string;
  estimatedTiming: Date;
  commitmentContext: string;
  fulfillmentData?: {
    selfieParams?: object;
    messageText?: string;
    contentToShare?: string;
  };
  status: "pending" | "fulfilled" | "missed" | "cancelled";
  createdAt: Date;
  fulfilledAt?: Date;
}

// Functions:
// - createPromise()
// - getReadyPromises()
// - getPendingPromises()
// - fulfillPromise()
// - checkAndFulfillPromises()
// - cancelPromise()
// - cleanupOldPromises()
```

**Key Implementation Details:**
- Fixed 10-minute timing: `new Date(Date.now() + 10 * 60 * 1000)`
- Integration with `pendingMessageService` for fulfillment
- Proper error handling and logging

**Run tests:** `npm test -- --run -t "promiseService"`
**Expected:** All tests should PASS (green phase)

---

### Step 4: Add LLM Tool Integration

Follow **8-Step Tool Integration Checklist** exactly.

#### 4.1: memoryService.ts (Step 1)

Add to `MemoryToolName`:
```typescript
export type MemoryToolName =
  | "recall_memory"
  | "store_user_info"
  // ...existing
  | "make_promise";  // NEW
```

Add to `ToolCallArgs`:
```typescript
| {
    tool: "make_promise";
    promiseType: "send_selfie" | "share_update" | "follow_up" | "send_content" | "reminder" | "send_voice_note";
    description: string;
    triggerEvent: string;
    fulfillmentData?: {
      selfieParams?: object;
      messageText?: string;
      contentToShare?: string;
    };
  }
```

Add to `executeMemoryTool()` switch:
```typescript
case "make_promise": {
  const { promiseType, description, triggerEvent, fulfillmentData } = args as {
    promiseType: PromiseType;
    description: string;
    triggerEvent: string;
    fulfillmentData?: any;
  };

  // Fixed 10 minutes for now
  const estimatedTiming = new Date(Date.now() + 10 * 60 * 1000);

  await createPromise(
    promiseType,
    description,
    triggerEvent,
    estimatedTiming,
    userMessage, // Original user message as context
    fulfillmentData
  );

  return {
    success: true,
    message: `Promise created: ${description} (will fulfill in 10 minutes)`,
  };
}
```

#### 4.2: aiSchema.ts (Steps 2-4)

**Add to `GeminiMemoryToolDeclarations`:**
```typescript
{
  name: "make_promise",
  description: "Create a promise to do something later. Use when you commit to sending something or doing something in the FUTURE (not right now). The promise will be fulfilled in 10 minutes.",
  parameters: {
    type: "object",
    properties: {
      promiseType: {
        type: "string",
        enum: ["send_selfie", "share_update", "follow_up", "send_content", "reminder", "send_voice_note"],
        description: "Type of promise you're making",
      },
      description: {
        type: "string",
        description: "What you're promising to do (human-readable, e.g., 'Send selfie from hot girl walk')",
      },
      triggerEvent: {
        type: "string",
        description: "When this should happen (e.g., 'when I go on my walk', 'after my meeting', 'in a bit')",
      },
      fulfillmentData: {
        type: "object",
        description: "Optional data for fulfilling the promise",
        properties: {
          messageText: {
            type: "string",
            description: "Message to send when promise is fulfilled (e.g., 'Okay heading out for that walk! Here's your selfie 📸')",
          },
          selfieParams: {
            type: "object",
            description: "For send_selfie promises: parameters for image generation",
            properties: {
              scene: { type: "string" },
              mood: { type: "string" },
              location: { type: "string" },
            },
          },
          contentToShare: {
            type: "string",
            description: "For send_content promises: content to share",
          },
        },
      },
    },
    required: ["promiseType", "description", "triggerEvent"],
  },
}
```

**Add to `MemoryToolArgs` union (CRITICAL!):**
```typescript
| {
    name: "make_promise";
    args: {
      promiseType: "send_selfie" | "share_update" | "follow_up" | "send_content" | "reminder" | "send_voice_note";
      description: string;
      triggerEvent: string;
      fulfillmentData?: {
        selfieParams?: object;
        messageText?: string;
        contentToShare?: string;
      };
    };
  }
```

**Add to `PendingToolCall.name` union (CRITICAL!):**
```typescript
export interface PendingToolCall {
  name:
    | "recall_memory"
    | "store_user_info"
    // ...existing
    | "make_promise";  // NEW
  args: Record<string, any>;
}
```

**Add to `OpenAIMemoryToolDeclarations`** (same structure, OpenAI format)

#### 4.3: toolsAndCapabilities.ts (Step 6 - CRITICAL!)

Create new section for promise guidance:

```typescript
export function buildPromiseGuidance(): string {
  return `
====================================================
PROMISE TRACKING - MAKING TIME FEEL REAL
====================================================

CRITICAL CONCEPT:
When you say you'll do something LATER, don't do it NOW.
Create a promise and it will be fulfilled in 10 minutes.

WHEN TO USE make_promise:
✅ User asks for something in the FUTURE
✅ You commit to doing something later (not right now)
✅ You mention plans and they ask for updates
✅ You say "I'll send you X" or "I'll let you know"

WHEN NOT TO USE:
❌ They want something RIGHT NOW
❌ You're already doing the thing currently
❌ It's a response to what's happening this instant

EXAMPLES:

❌ BAD (Instant gratification breaks immersion):
User: "What are your plans today?"
You: "Going on a walk later!"
User: "Send me a selfie when you do!"
You: [Immediately generates selfie] "Here's a live update from the trail..."

**This is WRONG** - you haven't gone on the walk yet!

✅ GOOD (Promise fulfillment feels real):
User: "What are your plans today?"
You: "Going on a walk in a bit!"
User: "Send me a selfie when you do!"
You: "Will do! I'll send one when I head out 💕"
[Calls make_promise with:
  promiseType: "send_selfie",
  description: "Send selfie from hot girl walk",
  triggerEvent: "when I go on my walk",
  fulfillmentData: {
    messageText: "Okay heading out for that walk! Here's your selfie 📸",
    selfieParams: { scene: "outdoor trail selfie", mood: "energetic smile" }
  }
]

[10 minutes later - promise system proactively sends the message + selfie]

✅ GOOD (Share update later):
User: "How did your audition go?"
You: "It's actually later today! I'll let you know how it goes"
[Calls make_promise with:
  promiseType: "share_update",
  description: "Tell them about audition results",
  triggerEvent: "after my audition",
  fulfillmentData: {
    messageText: "Just got out of the audition! Okay so it was intense but I think it went well..."
  }
]

FULFILLMENT TIMING:
All promises fulfill in 10 minutes (fixed for now).
The system will:
1. Wait 10 minutes
2. Proactively send your message/selfie
3. Make it feel like YOU initiated (not a response)

NATURAL LANGUAGE:
- "in a bit" / "later" → Promise
- "when I..." → Promise
- "I'll send you..." → Promise
- "I'll let you know..." → Promise

DON'T:
- Make promises for things happening RIGHT NOW
- Promise and then immediately deliver
- Use this for instant responses

DO:
- Create promises for future commitments
- Include natural message text for when fulfilled
- Trust the system to deliver at the right time
`;
}
```

Add to `buildToolsAndCapabilitiesSection()`:
```typescript
prompt += buildPromiseGuidance();
```

---

### Step 5: Background Promise Fulfillment

#### 5.1: Create Background Job

**File:** `src/services/backgroundJobs.ts` (or add to existing)

```typescript
import { checkAndFulfillPromises } from './promiseService';

export function startPromiseChecker() {
  console.log("[Background] Starting promise checker");

  // Check immediately on start
  checkAndFulfillPromises();

  // Check every 5 minutes
  setInterval(async () => {
    const fulfilledCount = await checkAndFulfillPromises();
    if (fulfilledCount > 0) {
      console.log(`[Background] Fulfilled ${fulfilledCount} promise(s)`);
    }
  }, 5 * 60 * 1000);
}
```

#### 5.2: Add to App.tsx

```typescript
import { startPromiseChecker } from './services/backgroundJobs';

useEffect(() => {
  startPromiseChecker();
}, []);
```

#### 5.3: On-Login Promise Delivery (NEW!)

**Integration Point:** When user logs in or starts conversation, check for ready promises.

**File:** Modify greeting flow (likely in chat handler or App.tsx)

```typescript
// Before generating greeting, check for ready promises
const readyPromises = await getReadyPromises();
if (readyPromises.length > 0) {
  // Fulfill them and let greeting acknowledge them
  await checkAndFulfillPromises();

  // Optional: Add to greeting context
  // "Oh! I was going to send you [X]... here it is!"
}
```

This ensures offline users receive promises when they return.

---

### Step 6: System Prompt Integration

**File:** `src/services/system_prompts/builders/systemPromptBuilder.ts`

Add to imports:
```typescript
import { buildPromiseGuidance } from '../tools/toolsAndCapabilities';
```

Already integrated via `buildToolsAndCapabilitiesSection()` (Step 4.3).

---

### Step 7: Create Service Documentation

**File:** `src/services/docs/PromiseService.md`

Structure:
```markdown
# Promise Service

**File:** `src/services/promiseService.ts`
**Table:** `promises`
**Purpose:** Track and fulfill Kayley's future commitments

## Overview
## Table Schema
## Service Functions
## LLM Tool: make_promise
## System Prompt Integration
## Offline Handling
## Use Cases
## Design Decisions
## Testing
## Future Extensibility
## Troubleshooting
```

---

### Step 8: Update All READMEs

#### 8.1: Service Docs Hub

**File:** `src/services/docs/README.md`

Add under "Character & Personality":
```markdown
- **[PromiseService](./PromiseService.md)** - Promise tracking and fulfillment
```

#### 8.2: Sub-Agent Updates

**File:** `.claude/agents/presence-proactivity.md`

Add to "Files It Owns":
```markdown
- `src/services/promiseService.ts` - Promise tracking (future commitments)
```

Add to "Capabilities":
```markdown
- Promise fulfillment and timing
```

#### 8.3: Sub-Agent Usage Guide

**File:** `docs/Sub_Agent_Usage_Guide.md`

Update `presence-proactivity` section:
```markdown
**Files It Knows:**
- `src/services/promiseService.ts` (promise tracking)

**Related Documents:**
- `src/services/docs/PromiseService.md`
```

#### 8.4: Tool Integration Checklist

**File:** `docs/Tool_Integration_Checklist.md`

Add `make_promise` to examples (if not already there).

#### 8.5: CLAUDE.md (Project Instructions)

No changes needed - checklists already referenced.

---

## Verification Checklist

Before marking complete:

- [ ] All tests pass: `npm test -- --run -t "promiseService"`
- [ ] All snapshot tests pass: `npm test -- --run -t "snapshot"`
- [ ] Build succeeds: `npm run build`
- [ ] Migration file created (user will apply)
- [ ] Service documentation created
- [ ] All READMEs updated
- [ ] Manual test: Promise created via chat
- [ ] Manual test: Promise fulfilled after 10 minutes
- [ ] Manual test: Offline user receives promise on login

---

## Testing Strategy

### Unit Tests (TDD)

**File:** `src/services/tests/promiseService.test.ts`

Mock Supabase and test:
- CRUD operations
- Ready promise detection
- Fulfillment logic
- Edge cases

### Integration Tests

Manual testing flow:
1. Start conversation
2. Make Kayley promise something: "I'll send you a selfie in a bit"
3. Verify promise created in DB
4. Wait 10 minutes
5. Verify promise fulfilled (pending message created)
6. Verify Kayley sends proactive message with selfie

### Offline Test

1. Make Kayley promise something
2. Close app/log out
3. Wait 10 minutes
4. Log back in
5. Verify promise delivered in greeting/welcome

---

## Future Extensibility

### Dynamic Timing (Phase 2)

```typescript
interface PromiseTiming {
  baseMinutes: number;
  moodModifier?: (mood: KayleyMood) => number;
  timeOfDayModifier?: (hour: number) => number;
  relationshipModifier?: (tier: number) => number;
}

function calculatePromiseTiming(params: PromiseTiming): Date {
  let minutes = params.baseMinutes;

  if (params.moodModifier) {
    minutes *= params.moodModifier(mood);
  }

  // etc.

  return new Date(Date.now() + minutes * 60 * 1000);
}
```

### Promise Types (Phase 2)

New types:
- `scheduled_event` - Specific date/time
- `conditional_trigger` - Based on external event
- `recurring_reminder` - Daily/weekly

---

## Implementation Order Summary

1. ✅ Write tests (TDD - red phase)
2. ✅ Create migration
3. ✅ Implement service (TDD - green phase)
4. ✅ Add tool to memoryService
5. ✅ Add tool to aiSchema (3 places!)
6. ✅ Add system prompt guidance (CRITICAL for LLM usage)
7. ✅ Add background checker
8. ✅ Add on-login delivery
9. ✅ Create service documentation
10. ✅ Update all READMEs
11. ✅ Verify all tests pass
12. ✅ Manual testing

---

## Notes

- **Fixed 10-minute timing** - Extensible architecture, but simple for Phase 1
- **Offline handling** - Promise fulfillment on login/welcome flow
- **LLM-only detection** - No regex, trust the model to detect promises
- **TDD approach** - Tests written BEFORE implementation
- **Documentation complete** - Service docs, READMEs, sub-agents all updated

Ready to implement!
