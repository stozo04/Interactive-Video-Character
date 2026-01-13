# Promise Tracking System: Making Time Feel Real

**Problem:** Kayley instantly fulfills future commitments instead of waiting for realistic timing
**Example:** Says "I'm going on a walk later" → instantly sends selfie "from the trail"
**Solution:** Track promises and fulfill them proactively when they naturally would happen

---

## The Core Issue

**Current Behavior (Broken):**
```
User: "What are your plans today?"
Kayley: "Going on a hot girl walk later! ☀️"
User: "Send me a selfie when you do!"
Kayley: "Here's a live update from the trail..." [INSTANT SELFIE] ❌
```

**Problem:** No temporal awareness between "future plan" and "current action"

**Desired Behavior:**
```
User: "What are your plans today?"
Kayley: "Going on a hot girl walk later! ☀️"
User: "Send me a selfie when you do!"
Kayley: "Will do! I'll send one when I head out 💕"

[30-90 minutes pass - user does other things]

Kayley: [Proactive message] "Okay heading out for that walk now! Here's your selfie 📸"
[Selfie arrives showing her in walking outfit, outdoors]
```

**Why This Feels Real:**
- ✅ Acknowledges it's a future event
- ✅ Makes a promise ("will do")
- ✅ Time passes realistically
- ✅ She initiates when the time comes
- ✅ Fulfills the promise

---

## System Architecture

### 1. Promise Types

```typescript
export type PromiseType =
  | "send_selfie"        // "I'll send you a selfie when..."
  | "share_update"       // "I'll tell you how it goes"
  | "send_content"       // "I'll find that article for you"
  | "follow_up"          // "I'll check in on you later"
  | "reminder"           // "I'll remind you about..."
  | "send_voice_note";   // "I'll send you a voice message"
```

### 2. Promise Object

```typescript
export interface Promise {
  id: string;
  promiseType: PromiseType;
  description: string;           // "Send selfie from hot girl walk"
  triggerEvent: string;          // "When I go on my walk"
  estimatedTiming: Date;         // When it should happen
  commitmentContext: string;     // User request that triggered this
  fulfillmentData?: {            // What to send when fulfilled
    selfieParams?: object;
    messageText?: string;
    contentToShare?: string;
  };
  status: "pending" | "fulfilled" | "missed" | "cancelled";
  createdAt: Date;
  fulfilledAt?: Date;
}
```

### 3. Database Table

```sql
CREATE TABLE promises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  promise_type TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  estimated_timing TIMESTAMPTZ NOT NULL,
  commitment_context TEXT,
  fulfillment_data JSONB,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ,

  CHECK (status IN ('pending', 'fulfilled', 'missed', 'cancelled'))
);

CREATE INDEX idx_promises_status ON promises(user_id, status);
CREATE INDEX idx_promises_timing ON promises(user_id, estimated_timing);
```

---

## Implementation Steps

### Step 1: Create Promise Service

**File:** `src/services/promiseService.ts`

```typescript
import { supabase } from './supabaseClient';
import { createPendingMessage } from './idleLife/pendingMessageService';

const PROMISES_TABLE = "promises";
const USER_ID = import.meta.env.VITE_USER_ID;

export type PromiseType =
  | "send_selfie"
  | "share_update"
  | "send_content"
  | "follow_up"
  | "reminder"
  | "send_voice_note";

export type PromiseStatus = "pending" | "fulfilled" | "missed" | "cancelled";

export interface Promise {
  id: string;
  promiseType: PromiseType;
  description: string;
  triggerEvent: string;
  estimatedTiming: Date;
  commitmentContext: string;
  fulfillmentData?: {
    selfieParams?: {
      scene: string;
      mood: string;
      location?: string;
    };
    messageText?: string;
    contentToShare?: string;
  };
  status: PromiseStatus;
  createdAt: Date;
  fulfilledAt?: Date;
}

/**
 * Create a promise for something Kayley committed to do later.
 *
 * @param promiseType - Type of promise
 * @param description - What she promised (human-readable)
 * @param triggerEvent - When it should happen
 * @param estimatedTiming - When to fulfill (Date object)
 * @param commitmentContext - User's original request
 * @param fulfillmentData - Data needed to fulfill the promise
 */
export async function createPromise(
  promiseType: PromiseType,
  description: string,
  triggerEvent: string,
  estimatedTiming: Date,
  commitmentContext: string,
  fulfillmentData?: Promise["fulfillmentData"]
): Promise<Promise | null> {
  try {
    const promise: Partial<Promise> = {
      id: crypto.randomUUID(),
      promiseType,
      description,
      triggerEvent,
      estimatedTiming,
      commitmentContext,
      fulfillmentData,
      status: "pending",
      createdAt: new Date(),
    };

    const { data, error } = await supabase
      .from(PROMISES_TABLE)
      .insert({
        id: promise.id,
        promise_type: promise.promiseType,
        description: promise.description,
        trigger_event: promise.triggerEvent,
        estimated_timing: promise.estimatedTiming!.toISOString(),
        commitment_context: promise.commitmentContext,
        fulfillment_data: promise.fulfillmentData || {},
        status: promise.status,
        created_at: promise.createdAt!.toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[Promises] Error creating promise:", error);
      return null;
    }

    console.log(
      `[Promises] Created: ${promiseType} - "${description}" at ${estimatedTiming.toLocaleTimeString()}`
    );

    return mapRowToPromise(data);
  } catch (error) {
    console.error("[Promises] Error in createPromise:", error);
    return null;
  }
}

/**
 * Get pending promises that are ready to be fulfilled (time has arrived).
 */
export async function getReadyPromises(): Promise<Promise[]> {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from(PROMISES_TABLE)
      .select("*")
      .eq("status", "pending")
      .lte("estimated_timing", now)
      .order("estimated_timing", { ascending: true });

    if (error) {
      console.error("[Promises] Error fetching ready promises:", error);
      return [];
    }

    return (data || []).map(mapRowToPromise);
  } catch (error) {
    console.error("[Promises] Error in getReadyPromises:", error);
    return [];
  }
}

/**
 * Fulfill a promise - deliver what was promised.
 */
export async function fulfillPromise(promiseId: string): Promise<boolean> {
  try {
    // Get the promise
    const { data: promiseData, error: fetchError } = await supabase
      .from(PROMISES_TABLE)
      .select("*")
      .eq("id", promiseId)
      .single();

    if (fetchError || !promiseData) {
      console.error("[Promises] Promise not found:", promiseId);
      return false;
    }

    const promise = mapRowToPromise(promiseData);

    // Create the pending message based on promise type
    let messageText = "";
    let messageType: "text" | "photo" = "text";
    let metadata: any = {};

    switch (promise.promiseType) {
      case "send_selfie":
        messageText =
          promise.fulfillmentData?.messageText ||
          "Okay heading out now! Here's your selfie 📸";
        messageType = "photo";
        metadata = {
          promiseId: promise.id,
          selfieParams: promise.fulfillmentData?.selfieParams || {
            scene: "casual outdoor selfie",
            mood: "happy smile",
          },
        };
        break;

      case "share_update":
        messageText =
          promise.fulfillmentData?.messageText ||
          `Update on ${promise.triggerEvent}: ${promise.description}`;
        break;

      case "follow_up":
        messageText =
          promise.fulfillmentData?.messageText ||
          `Hey! Checking in like I said I would 💕`;
        break;

      default:
        messageText = promise.description;
    }

    // Create pending message
    await createPendingMessage({
      messageText,
      messageType,
      trigger: "promise_fulfillment",
      priority: "medium",
      metadata,
    });

    // Mark promise as fulfilled
    const { error: updateError } = await supabase
      .from(PROMISES_TABLE)
      .update({
        status: "fulfilled",
        fulfilled_at: new Date().toISOString(),
      })
      .eq("id", promiseId);

    if (updateError) {
      console.error("[Promises] Error marking promise fulfilled:", updateError);
      return false;
    }

    console.log(`[Promises] ✅ Fulfilled: ${promise.description}`);
    return true;
  } catch (error) {
    console.error("[Promises] Error in fulfillPromise:", error);
    return false;
  }
}

/**
 * Check for ready promises and fulfill them.
 * This should be called periodically (e.g., every 5 minutes in background).
 */
export async function checkAndFulfillPromises(): Promise<number> {
  const readyPromises = await getReadyPromises();

  if (readyPromises.length === 0) {
    return 0;
  }

  console.log(
    `[Promises] Found ${readyPromises.length} ready promise(s) to fulfill`
  );

  let fulfilledCount = 0;

  for (const promise of readyPromises) {
    const success = await fulfillPromise(promise.id);
    if (success) fulfilledCount++;
  }

  return fulfilledCount;
}

/**
 * Cancel a promise (if user changes mind or it's no longer relevant).
 */
export async function cancelPromise(promiseId: string): Promise<void> {
  try {
    await supabase
      .from(PROMISES_TABLE)
      .update({ status: "cancelled" })
      .eq("id", promiseId);

    console.log(`[Promises] Cancelled: ${promiseId}`);
  } catch (error) {
    console.error("[Promises] Error cancelling promise:", error);
  }
}

/**
 * Get all pending promises (for debugging or display).
 */
export async function getPendingPromises(): Promise<Promise[]> {
  try {
    const { data, error } = await supabase
      .from(PROMISES_TABLE)
      .select("*")
      .eq("status", "pending")
      .order("estimated_timing", { ascending: true });

    if (error) {
      console.error("[Promises] Error fetching pending promises:", error);
      return [];
    }

    return (data || []).map(mapRowToPromise);
  } catch (error) {
    console.error("[Promises] Error in getPendingPromises:", error);
    return [];
  }
}

// Helper: Map database row to Promise object
function mapRowToPromise(row: any): Promise {
  return {
    id: row.id,
    promiseType: row.promise_type as PromiseType,
    description: row.description,
    triggerEvent: row.trigger_event,
    estimatedTiming: new Date(row.estimated_timing),
    commitmentContext: row.commitment_context,
    fulfillmentData: row.fulfillment_data,
    status: row.status as PromiseStatus,
    createdAt: new Date(row.created_at),
    fulfilledAt: row.fulfilled_at ? new Date(row.fulfilled_at) : undefined,
  };
}

// Helper: Clean up old fulfilled/cancelled promises
export async function cleanupOldPromises(): Promise<void> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    await supabase
      .from(PROMISES_TABLE)
      .delete()
      .in("status", ["fulfilled", "cancelled"])
      .lt("created_at", thirtyDaysAgo.toISOString());
  } catch (error) {
    console.error("[Promises] Error cleaning up old promises:", error);
  }
}
```

---

### Step 2: Add LLM Tool for Promise Creation

**File:** `src/services/memoryService.ts` (add to existing tools)

Add to `MemoryToolName`:
```typescript
export type MemoryToolName =
  | "recall_memory"
  | "store_user_info"
  // ... existing
  | "make_promise";  // NEW
```

Add to `ToolCallArgs`:
```typescript
| {
    tool: "make_promise";
    promiseType: "send_selfie" | "share_update" | "follow_up";
    description: string;
    triggerEvent: string;
    hoursFromNow: number;
    fulfillmentData?: object;
  }
```

Add to `executeMemoryTool`:
```typescript
case "make_promise": {
  const { promiseType, description, triggerEvent, hoursFromNow, fulfillmentData } =
    args as {
      promiseType: PromiseType;
      description: string;
      triggerEvent: string;
      hoursFromNow: number;
      fulfillmentData?: any;
    };

  const estimatedTiming = new Date();
  estimatedTiming.setHours(estimatedTiming.getHours() + hoursFromNow);

  await createPromise(
    promiseType,
    description,
    triggerEvent,
    estimatedTiming,
    userMessage, // Store the user's original request
    fulfillmentData
  );

  return {
    success: true,
    message: `Promise created: ${description} in ${hoursFromNow} hours`,
  };
}
```

---

### Step 3: Add Tool Declaration

**File:** `src/services/aiSchema.ts`

```typescript
{
  name: "make_promise",
  description: "Create a promise to do something later. Use this when you commit to sending something or doing something in the FUTURE (not right now).",
  parameters: {
    type: "object",
    properties: {
      promiseType: {
        type: "string",
        enum: ["send_selfie", "share_update", "follow_up"],
        description: "Type of promise you're making",
      },
      description: {
        type: "string",
        description: "What you're promising to do (human-readable)",
      },
      triggerEvent: {
        type: "string",
        description: "When this should happen (e.g., 'when I go on my walk', 'after my meeting', 'this evening')",
      },
      hoursFromNow: {
        type: "number",
        description: "How many hours from now to fulfill this promise (e.g., 0.5 for 30 min, 1 for 1 hour, 2 for 2 hours)",
      },
      fulfillmentData: {
        type: "object",
        description: "Optional data for fulfilling the promise (e.g., selfie parameters, message text)",
        properties: {
          messageText: { type: "string" },
          selfieParams: {
            type: "object",
            properties: {
              scene: { type: "string" },
              mood: { type: "string" },
              location: { type: "string" },
            },
          },
        },
      },
    },
    required: ["promiseType", "description", "triggerEvent", "hoursFromNow"],
  },
},
```

---

### Step 4: System Prompt Guidance

**File:** `src/services/system_prompts/tools/toolsAndCapabilities.ts`

```typescript
export function buildPromiseGuidance(): string {
  return `
PROMISE TRACKING (Making Time Feel Real):

CRITICAL CONCEPT:
When you say you'll do something LATER, don't do it NOW.
Create a promise and fulfill it when the time actually comes.

WHEN TO USE make_promise:
- User asks for something in the FUTURE
- You commit to doing something later (not right now)
- You mention plans and they ask for updates

EXAMPLES:

❌ BAD (Instant gratification):
User: "What are your plans today?"
You: "Going on a walk later!"
User: "Send me a selfie when you do!"
You: "Here's a live update from the trail..." [INSTANT SELFIE] ❌

✅ GOOD (Promise fulfillment):
User: "What are your plans today?"
You: "Going on a walk in about an hour!"
User: "Send me a selfie when you do!"
You: "Will do! I'll send one when I head out 💕"
[Calls make_promise(
  promiseType="send_selfie",
  description="Send selfie from hot girl walk",
  triggerEvent="when I go on my walk",
  hoursFromNow=1,
  fulfillmentData={
    messageText: "Okay heading out for that walk! Here's your selfie 📸",
    selfieParams: { scene: "outdoor trail selfie", mood: "energetic smile" }
  }
)]
[1 hour passes - you do other things]
[Promise system proactively sends the selfie with message]

✅ GOOD (Share update later):
User: "How did your audition go?"
You: "It's actually later today! I'll let you know how it goes"
[Calls make_promise(
  promiseType="share_update",
  description="Tell them about audition results",
  triggerEvent="after my audition",
  hoursFromNow=3,
  fulfillmentData={ messageText: "Just got out of the audition! It went..." }
)]

TIMING GUIDELINES:
- "in a bit" / "soon" = 0.5-1 hours
- "later today" = 2-4 hours
- "this afternoon" = 3-5 hours
- "this evening" = 5-8 hours
- "tonight" = 6-10 hours

FULFILLMENT:
The promise system will:
1. Wait until the estimated time
2. Proactively send the message/selfie you specified
3. Make it feel like you're initiating, not responding

DON'T:
- Make promises for things happening RIGHT NOW
- Promise and then immediately deliver
- Use this for every single thing (only future commitments)

DO:
- Create realistic timing based on context
- Include natural message text for when fulfilled
- Remember what you promised (system tracks it)
`;
}
```

---

### Step 5: Background Promise Checker

**File:** `src/services/backgroundJobs.ts` (create if doesn't exist)

```typescript
import { checkAndFulfillPromises } from './promiseService';

/**
 * Check for ready promises every 5 minutes.
 * Run this in a background interval.
 */
export function startPromiseChecker() {
  // Check immediately on start
  checkAndFulfillPromises();

  // Then check every 5 minutes
  setInterval(async () => {
    const fulfilledCount = await checkAndFulfillPromises();
    if (fulfilledCount > 0) {
      console.log(`[Background] Fulfilled ${fulfilledCount} promise(s)`);
    }
  }, 5 * 60 * 1000); // 5 minutes
}
```

**Call in App.tsx or main entry:**
```typescript
import { startPromiseChecker } from './services/backgroundJobs';

// In useEffect on mount:
useEffect(() => {
  startPromiseChecker();
}, []);
```

---

## Testing the System

### Test 1: Hot Girl Walk Scenario

**User:** "What are your plans today?"
**Kayley:** "Going on a hot girl walk in like an hour! ☀️"
**User:** "Send me a selfie when you do!"
**Kayley:** "Will do! I'll send one when I head out 💕"
  - [Calls `make_promise`]
  - [Returns success without selfie]

**[60 minutes pass - user does other things]**

**Kayley:** [Proactive message] "Okay heading out for that walk! Here's your selfie 📸"
  - [Selfie displays showing outdoor trail scene]

### Test 2: Evening Plans

**User:** "What are you doing tonight?"
**Kayley:** "Working on some music stuff later!"
**User:** "Let me know how it goes"
**Kayley:** "For sure! I'll send you an update this evening"
  - [Calls `make_promise` with hoursFromNow=5]

**[5 hours later]**

**Kayley:** "Just finished that music session! Actually got some solid work done 🎵"

### Test 3: Future Event Update

**User:** "Do you have that callback tomorrow?"
**Kayley:** "Yeah, it's at 2pm tomorrow!"
**User:** "Good luck! Tell me how it goes"
**Kayley:** "Thanks! I'll definitely let you know 💕"
  - [Calls `make_promise` with hoursFromNow=26 (tomorrow afternoon)]

**[Next day, after callback]**

**Kayley:** "Just got out of the callback! Okay so it was intense but I think it went well..."

---

## Integration with Existing Systems

### Works With:
- ✅ **Pending Messages** - Promises create pending messages on fulfillment
- ✅ **Selfie Generation** - Can include selfie params for photo promises
- ✅ **Mood/Relationship** - Timing can be adjusted based on mood
- ✅ **Open Loops** - Complements (not replaces) callback questions

### Doesn't Conflict With:
- Gift messages (those are unprompted surprises)
- Idle thoughts (those are about her internal state)
- Life experiences (those are her own events)

---

## Migration Path

1. **Create database table** (Supabase migration)
2. **Add promise service** (`promiseService.ts`)
3. **Add tool declaration** (in `aiSchema.ts`)
4. **Add tool execution** (in `memoryService.ts`)
5. **Add system prompt guidance**
6. **Start background checker** (in `App.tsx`)
7. **Test with hot girl walk scenario**

---

## Expected Impact

### Before:
- Plans mentioned → instant fulfillment
- No sense of time passing
- Feels like magic trick, not real person

### After:
- Plans mentioned → acknowledged as future
- Realistic time passes
- Proactive fulfillment when time comes
- Feels like she remembered and followed through

---

## Next Steps

Want me to:
1. Create the complete migration SQL?
2. Write all the service code files?
3. Show integration with existing tool system?
4. All of the above?

This is a great observation - it's these small temporal details that make interactions feel real.
