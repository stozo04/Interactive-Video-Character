# 2026-03-05 — Telegram Email Action Bugs & Fixes

## Context
Steven observed Kayley claiming to send an email reply 3 times in a row but nothing ever
landed in the sent folder. Also noticed that email announcements sent from the Telegram
bridge were causing Kayley to confuse email context on the next user turn.

---

## Bug 1: DB row burned regardless of send success (false positive loop)

**File:** `server/telegram/telegramHandler.ts` — `executeTelegramEmailAction()`

**What happened:**
The `supabase.update({ action_taken: 'reply' })` call ran unconditionally after the
try/catch block, regardless of whether `gmailService.sendReply()` returned `false` or
threw. So:
- Attempt 1: `sendReply` fails silently → row marked `action_taken: 'reply'`
- Attempt 2+: `loadPendingEmailFromDB()` queries `action_taken = 'pending'` → returns
  null → `executeTelegramEmailAction` is never called → but Kayley's LLM response still
  says "I sent it!" because `result.detectedEmailAction` was set by the orchestrator

**Fix:** Gate the DB update on `success === true`. On failure, leave row as `pending` and
send Steven a "didn't go through" message so he can retry.

**Lesson:** `void asyncFn()` + no await on DB update = silent failure with full confidence
in the response text. Always check success before marking work done.

---

## Bug 2: Silent Supabase update failure (no error handling)

**File:** `server/telegram/telegramHandler.ts`

**What happened:**
Even with the `success` gate, the `.update()` call had zero error handling. If Supabase
rejected it (RLS, network, schema mismatch), the row would stay `pending` forever with no
log entry.

**Fix:** Destructure `{ error: updateError }` and log via `runtimeLog.error` with
`rowId`, `action`, and `error.message`. Also added a success log so the full lifecycle
is traceable.

---

## Bug 3: Bridge announcements not persisted to conversation_history

**File:** `server/telegram/telegramEmailBridge.ts`

**What happened:**
`pollPendingEmails()` calls `bot.api.sendMessage()` directly — completely bypassing
`processUserMessage` → `appendConversationHistory`. Kayley's email announcements are
invisible to the LLM on the next turn.

**Consequence observed:** Steven replied "yes let's do dinner / reply and tell him
restaurant looks good at 6:30" but Kayley had:
1. No memory of announcing the dinner email (bridge bypassed history)
2. Today's `conversation_history` loaded the early-morning NDA conversation (same UTC day)
3. `pendingEmail` injected with dinner subject, but LLM had conflicting NDA context and
   no mental anchor from its own announcement

**Fix:** After each successful `bot.api.sendMessage`, call `appendConversationHistory`
with the announcement as a model turn (fire-and-forget, errors logged but not blocking).
Also fetch `getTodaysInteractionId()` to link it to the active session.

**Key insight:** ANY Telegram message Kayley sends outside the orchestrator (bridge, token
health checks, email failure alerts) is "dark" to the LLM. If the content matters for
the next conversation turn, it must be persisted.

---

## Bug 4: `conversationLogId` and `tokenUsage` not surfaced from OrchestratorResult

**Files:** `src/handlers/messageActions/types.ts`, `src/services/messageOrchestrator.ts`,
`server/telegram/telegramHandler.ts`

**What happened:**
`geminiChatService.generateResponse()` already returns `conversationLogId` (UUID) and
`tokenUsage`, and the orchestrator passes them to `appendConversationHistory` — but never
put them on `OrchestratorResult`. The Telegram handler had no way to correlate its logs
with the Gemini lifecycle logs.

**Fix:** Added both fields to `OrchestratorResult`, set them in the orchestrator, and
included them in the "Message processing completed" and "Executing email action" log
entries in `telegramHandler.ts`.

**Debug query for a specific turn:**
```sql
SELECT occurred_at, severity, source, message, details
FROM server_runtime_logs
WHERE details->>'conversationLogId' = '<uuid>'
ORDER BY occurred_at ASC;
```

---

## Bug 5: Gmail batch fetch errors completely silent

**File:** `src/services/gmailService.ts` — `fetchMessageHeaders()`

**What happened:**
When Gmail's batch API returns an error JSON for a message (e.g. `{"error": {"code": 404,
"message": "Not Found"}}`), the code correctly detected `!headers` but only logged
`messageId: null, hasPayload: false` — never the actual error code or message.

**Fix:** Log `data?.error?.code` and `data?.error?.message` in the warning.

**Root cause of 404s:** Gmail's History API fires `messageAdded` events before the message
is fully indexed for direct fetch (timing race). Also affects mailing-list emails whose
headers arrive via a bounce address. These 404s are transient — a retry after a few
seconds would likely succeed, but that's a future improvement.

---

## Bug 6: Label filter silent bypass for empty labelIds

**File:** `src/services/gmailService.ts` — `pollForNewMail()`

**What happened:**
The label filter has `if (!labels.length) return true` to handle History API responses
with empty `labelIds`. This is intentional but was completely silent — promotional emails
with empty labels would pass through, reach `fetchMessageHeaders`, get a 404 error, and
be dropped there instead of being cleanly filtered.

**Fix:** Added `log.info` when a message passes through with empty labels, so it's
visible in logs that this specific path was taken.

---

## Architecture reminder: whatsappHandler.ts has the same bugs

The WhatsApp handler (`server/whatsapp/whatsappHandler.ts`) is a copy of the Telegram
handler with the same `executeTelegramEmailAction` pattern. Bugs 1 and 2 above exist
there too. Not fixed in this session — flag for next session.
