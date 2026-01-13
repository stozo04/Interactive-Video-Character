# Bug Report: Promise Pending Message Not Delivered on Non-Greeting Load

## Description
A fulfilled promise creates a pending message, but when the user returns the same day the app uses the non-greeting flow and the pending promise message is never shown. The user only sees the short non-greeting response ("Hey again! Miss me?") instead of the promised message/selfie.

## Evidence
- Background checker finds the promise ready and fulfills it, creating a pending message.
- The app detects prior chat activity and uses the non-greeting prompt (short "welcome back" response).
- The system prompt includes generic pending message context, but the non-greeting prompt enforces a <=10-word response and does not include delivery instructions.

Relevant files:
- `src/services/backgroundJobs.ts`
- `src/services/promiseService.ts`
- `src/services/idleLife/pendingMessageService.ts`
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
- `src/services/system_prompts/builders/greetingPromptBuilders/index.ts`
- `src/services/geminiChatService.ts`
- `src/App.tsx`

## Root Cause
1. Pending messages are only explicitly delivered in the greeting flow. The non-greeting flow does not fetch or instruct delivery of pending messages, and it enforces a very short "welcome back" response.
2. The system prompt adds a generic pending-message section, but it defers to greeting prompts for delivery instructions. The non-greeting prompt provides no such instructions, so the model follows the short-response rule instead of delivering the pending message.
3. For photo-type pending messages (e.g., send_selfie promises), the pending message metadata (selfieParams) is not included in the prompt, so even if a text delivery happened, a selfie would not be generated.

## Impact
- Promise fulfillment messages are not shown when a session resumes on the same day.
- Pending messages remain undelivered (and may block future pending messages).
- Photo promises do not trigger selfie generation, even if text is delivered.

## Fix Plan
1. Update `generateNonGreeting` to detect pending messages and switch to a delivery-capable prompt when one exists. Options:
   - Reuse `buildGreetingPrompt` when a pending message exists.
   - Create a new "non-greeting with pending message" prompt that allows normal-length output and includes the pending message instructions.
2. Include pending message metadata in the prompt (messageType, selfieParams) and add explicit instructions to call `selfie_action` when `messageType === "photo"`.
   - Alternative: bypass the LLM for photo delivery by directly generating the selfie from `metadata.selfieParams` and inserting the message into chat.
3. Ensure `markMessageDelivered` is called after pending message delivery in both greeting and non-greeting flows.
4. Add tests:
   - Non-greeting with pending message delivers the pending message and marks it delivered.
   - Photo pending message triggers selfie generation or the intended photo delivery path.

## Verification
- Create a pending promise with `messageType: "photo"` and confirm that the next app load (same-day) delivers the message and selfie.
- Confirm `pending_messages.delivered_at` is set after delivery.
- Confirm the non-greeting response is not limited to <=10 words when delivering a pending message.
