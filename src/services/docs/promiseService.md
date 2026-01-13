# Promise Service

The **Promise Service** is designed to make Kayley's commitments feel real by introducing temporal awareness. Instead of instantly fulfilling a future request (like sending a selfie "later"), the system tracks the promise and delivers it proactively after a realistic delay.

## Problem Solved
Previously, Kayley would suffer from "instant gratification" bugs:
- **User:** "Send me a selfie when you go on your walk later!"
- **Kayley:** "Sure! Here's a photo from the trail right now!" (Incorrectly sends instantly)

The Promise Service ensures that "later" actually means "later".

## Core Workflow

1. **Detection**: During conversation, the LLM identifies a future commitment (e.g., "I'll send you an update tonight").
2. **Creation**: The LLM calls the `make_promise` tool.
3. **Storage**: The promise is saved to the `promises` table in Supabase with a `pending` status and an `estimated_timing`.
4. **Monitoring**: A background job (`startPromiseChecker`) runs every 5 minutes to check for promises whose `estimated_timing` has passed.
5. **Fulfillment**: When ready, the service:
   - Creates a **Pending Message** in the `idleLife` system.
   - Marks the promise as `fulfilled`.
6. **Delivery**: The `pendingMessageService` delivers the message to the user at the next appropriate moment (e.g., when they are online or as a proactive notification).

## Tool: `make_promise`

The LLM uses this tool to register a new commitment.

**Parameters:**
- `promiseType`: The category of fulfillment (`send_selfie`, `share_update`, `follow_up`, etc.)
- `description`: Human-readable summary of the commitment.
- `triggerEvent`: The natural event that triggers fulfillment (e.g., "after my workout").
- `fulfillmentData`: (Optional) Payload for the eventual message, such as specific `selfieParams` or `messageText`.

## Database Schema (Supabase)

Table: `promises`
- `id`: UUID (Primary Key)
- `user_id`: UUID (REFERENCES auth.users)
- `promise_type`: TEXT
- `description`: TEXT
- `trigger_event`: TEXT
- `estimated_timing`: TIMESTAMPTZ
- `commitment_context`: TEXT (The user message that triggered this)
- `fulfillment_data`: JSONB
- `status`: TEXT (`pending`, `fulfilled`, `missed`, `cancelled`)
- `created_at`: TIMESTAMPTZ
- `fulfilled_at`: TIMESTAMPTZ

## Implementation Details

- **Phase 1 Timing**: In the initial implementation, all promises are set to fulfill in **10 minutes** to provide immediate proof of concept while still feeling "delayed".
- **Background Job**: The checker is initialized in `App.tsx` and persists for the duration of the session.
- **Offline Safety**: If the user closes the app, the background job on their next login will catch any "overdue" promises and deliver them immediately.
