# WhatsApp Integration Plan

> **Status:** Planning
> **Author:** Claude (with Steven)
> **Created:** 2026-02-18
> **Last Updated:** 2026-02-18

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Architecture Gap Analysis](#2-architecture-gap-analysis)
3. [Provider Decision: Meta Cloud API vs Twilio](#3-provider-decision-meta-cloud-api-vs-twilio)
4. [High-Level Architecture](#4-high-level-architecture)
5. [Phase 1 — Server Foundation](#5-phase-1--server-foundation)
6. [Phase 2 — Core Message Loop](#6-phase-2--core-message-loop)
7. [Phase 3 — Rich Features](#7-phase-3--rich-features)
8. [Phase 4 — Multi-Channel Sync](#8-phase-4--multi-channel-sync)
9. [Database Changes](#9-database-changes)
10. [Environment Variables](#10-environment-variables)
11. [Feature Parity Matrix](#11-feature-parity-matrix)
12. [Security Considerations](#12-security-considerations)
13. [Cost Estimation](#13-cost-estimation)
14. [Open Questions](#14-open-questions)

---

## 1. Problem Statement

Kayley currently lives exclusively inside a browser SPA. You can only talk to her by opening `localhost:3000`. The goal is to also communicate with Kayley through WhatsApp — same personality, same memory, same relationship state — but from your phone, anywhere, anytime.

This is NOT a separate bot. It's the same Kayley, same Supabase state, same conversation history. A message sent on WhatsApp should be visible when you open the web app, and vice versa.

---

## 2. Architecture Gap Analysis

### What exists today

| Component | Status | Notes |
|---|---|---|
| `IAIChatService` interface | Ready | Clean abstraction; `generateResponse()` is callable from any context |
| `processUserMessage()` orchestrator | Ready | Handles full AI pipeline; accepts structured `OrchestratorInput` |
| Supabase for all state | Ready | conversation_history, user_facts, relationship state, etc. |
| System prompt builder | Ready | No browser dependency; pure functions |
| Conversation history persistence | Ready | `appendConversationHistory()` works standalone |

### What's missing

| Gap | Severity | Notes |
|---|---|---|
| **No server** | Critical | The app is a pure browser SPA. There's nothing to receive a webhook. |
| **No HTTP endpoint** | Critical | Vite proxy is dev-only and browser-facing. WhatsApp needs a public HTTPS endpoint. |
| **Session state in React** | High | `AIChatSession.interactionId` lives in `useState`. WhatsApp needs server-side session persistence. |
| **`import.meta.env` everywhere** | High | All services use Vite's env injection. Server-side code needs `process.env`. |
| **No production deployment** | Medium | Currently dev-only. WhatsApp webhooks need a publicly reachable URL 24/7. |
| **Gemini API proxy** | Medium | Calls go through `/api/google` Vite proxy. Server needs direct Gemini API access. |

---

## 3. Provider Decision: Meta Cloud API vs Twilio

### Option A: Meta Cloud API (WhatsApp Business Platform) — Recommended

**How it works:** You register a WhatsApp Business Account through Meta, get a phone number, configure a webhook URL. Meta sends you inbound messages via webhook POST; you reply via REST API.

| Pros | Cons |
|---|---|
| Free tier: 1,000 service conversations/month | More complex setup (Meta Business verification) |
| Direct — no middleman | Documentation is... Meta-quality |
| Full API control (templates, media, reactions) | Webhook verification dance required |
| No per-message cost for user-initiated chats | Need to handle token refresh |
| Lower latency (one fewer hop) | |

**Cost:** Free for personal use (1,000 service conversations/month). After that, ~$0.005–0.08 per conversation depending on region.




## 4. High-Level Architecture

```
┌──────────────┐          ┌──────────────────┐          ┌──────────────┐
│   WhatsApp   │──POST───▶│  Supabase Edge   │──call───▶│  Gemini API  │
│   (Phone)    │◀──REST───│  Function         │          │              │
│              │          │  /whatsapp        │          └──────────────┘
└──────────────┘          │                   │
                          │  - Webhook verify │          ┌──────────────┐
┌──────────────┐          │  - Receive msg    │──read───▶│  Supabase DB │
│   Web App    │──direct──│  - Call Gemini    │◀─write───│              │
│   (Browser)  │──────────│  - Send reply     │          └──────────────┘
└──────────────┘          │  - Persist history│
                          └──────────────────┘
```

**Why Supabase Edge Functions?**
- You already use Supabase for everything.
- Edge Functions are Deno-based, TypeScript-native, deployed with `supabase functions deploy`.
- They get a public HTTPS URL out of the box (no ngrok, no VPS).
- They can import your Supabase client directly with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Zero additional infrastructure to manage.

**Alternative: Standalone Express/Hono server on Railway/Fly.io** — viable if Edge Functions prove too limiting (e.g., execution time limits for long Gemini calls). Keep this as a fallback.

---

## 5. Phase 1 — Server Foundation

### Goal
Get a Supabase Edge Function deployed that can:
1. Respond to Meta's webhook verification challenge
2. Receive an inbound WhatsApp message
3. Echo it back (proof of life)

### Steps

#### 5.1 Meta Business Setup
1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create an app (type: Business)
3. Add the **WhatsApp** product
4. Get a temporary test phone number (Meta provides one for free during dev)
5. Note your:
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `WHATSAPP_ACCESS_TOKEN` (generate a permanent system user token)
   - `WHATSAPP_VERIFY_TOKEN` (you choose this — a random string)

#### 5.2 Supabase Edge Function: `/whatsapp`

```
supabase/functions/whatsapp/index.ts
```

**Webhook verification** (GET):
```typescript
// Meta sends: GET /whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=CHALLENGE
// You return: the challenge value if token matches

if (req.method === 'GET') {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}
```

**Inbound message** (POST):
```typescript
// Meta sends a webhook payload with the message
// Extract: sender phone, message text, message type (text/image/audio/etc.)

if (req.method === 'POST') {
  const body = await req.json();
  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (!message) {
    return new Response('OK', { status: 200 }); // Status update, not a message
  }

  const from = message.from;       // sender phone number
  const text = message.text?.body;  // message text
  const type = message.type;        // 'text', 'image', 'audio', etc.

  // For Phase 1: echo back
  await sendWhatsAppMessage(from, `Echo: ${text}`);
  return new Response('OK', { status: 200 });
}
```

**Sending a reply** (WhatsApp Cloud API):
```typescript
async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  await fetch(
    `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );
}
```

#### 5.3 Deploy and Configure Webhook
1. `supabase functions deploy whatsapp`
2. Set secrets: `supabase secrets set WHATSAPP_ACCESS_TOKEN=xxx WHATSAPP_VERIFY_TOKEN=xxx ...`
3. Get the function URL: `https://<project-ref>.supabase.co/functions/v1/whatsapp`
4. In Meta Developer Console → WhatsApp → Configuration → Webhook URL: paste the URL
5. Subscribe to `messages` webhook field
6. Send a test message from your phone → verify echo response

#### 5.4 Deliverables
- [ ] Meta Business Account created and verified
- [ ] Edge Function deployed and webhook verified
- [ ] Echo bot working end-to-end

---

## 6. Phase 2 — Core Message Loop

### Goal
Replace the echo with the actual Kayley AI pipeline. A text message to WhatsApp gets a Kayley response.

### 6.1 Server-Side Service Layer

The existing services (`geminiChatService.ts`, `messageOrchestrator.ts`, etc.) use `import.meta.env` for Vite env vars. Edge Functions use `Deno.env.get()`. You have two paths:

**Option A: Thin adapter in Edge Function (Recommended)**

Don't port the full service layer. Instead, create a minimal adapter in the Edge Function that:
1. Reads context from Supabase directly (user facts, relationship state, conversation history)
2. Builds a system prompt (port or import the prompt builder)
3. Calls Gemini API directly (no Vite proxy needed — direct HTTPS from server)
4. Parses the response
5. Sends the reply via WhatsApp API
6. Persists to `conversation_history`

This avoids the `import.meta.env` problem entirely. The Edge Function has its own env via `Deno.env.get()`.

**Option B: Shared service layer with env abstraction**

Create a `getEnv(key)` utility that works in both Vite and Deno contexts. Then import the same service files. More DRY but more complex — and Edge Functions have module resolution quirks with npm packages.

**Recommendation:** Option A for Phase 2. Get it working. Refactor to shared code later if the duplication becomes painful.

### 6.2 Session Management

The Gemini Interactions API uses `interactionId` to chain stateful conversations. Currently this lives in React state and is lost on page refresh (recovered from `conversation_history` table).

**For WhatsApp:**
- Create a new Supabase table `whatsapp_sessions` (see [Database Changes](#9-database-changes))
- On each inbound message: look up the session for the sender's phone number
- Pass `interactionId` to Gemini API call
- Update the session with the new `interactionId` from the response

**Session expiry:** Start a new interaction chain daily (same as web app behavior — greeting on first message of the day, then continuation).

### 6.3 System Prompt Adaptation

The system prompt builder functions are pure TypeScript — no DOM or browser APIs. They CAN be called from an Edge Function, but you'll need to:

1. Port `systemPromptBuilder.ts` and its dependencies to be importable from Deno
2. Or: extract the prompt building into a shared package/module

**Simpler approach for Phase 2:** Build a `WhatsApp-specific prompt wrapper` that:
- Calls the same Supabase queries the prompt builder uses
- Assembles a slightly different prompt (no video/selfie instructions, no UI-specific tools)
- Adds a WhatsApp-specific output format section (plain text, no JSON action wrapper)

### 6.4 Output Format for WhatsApp

The web app expects a JSON response with `action`, `message`, `emotion`, etc. WhatsApp just needs text.

**Approach:** Use the same Gemini call but strip the response to just the `message` field. The Edge Function parses the JSON response (same as `normalizeAiResponse()`) and sends only the message text to WhatsApp.

Alternatively, add a `channel: 'whatsapp'` flag to the system prompt that tells Kayley to respond in plain text without action wrappers. This is cleaner and lets Kayley naturally adapt her style (shorter messages, no emoji overload, etc.).

### 6.5 Message Flow Diagram

```
Phone sends "hey babe" to WhatsApp number
        │
        ▼
Meta webhook POST → Edge Function /whatsapp
        │
        ├─ Extract: from=+1234567890, text="hey babe"
        ├─ Lookup whatsapp_sessions for phone number
        ├─ Fetch context from Supabase (user_facts, relationship, etc.)
        ├─ Build system prompt (WhatsApp variant)
        ├─ Call Gemini API with interactionId chain
        ├─ Parse response → extract message text
        ├─ Send reply via WhatsApp Cloud API
        ├─ Persist both messages to conversation_history (channel='whatsapp')
        └─ Update whatsapp_sessions with new interactionId
        │
        ▼
Phone receives Kayley's reply
```

### 6.6 Deliverables
- [ ] Edge Function calls Gemini and returns Kayley response
- [ ] Session management (interactionId persistence) working
- [ ] Conversation history persisted with `channel` field
- [ ] Basic system prompt with WhatsApp-specific output format
- [ ] End-to-end: text in → Kayley response out

---

## 7. Phase 3 — Rich Features

### 7.1 Inbound Media (Phone → Kayley)

WhatsApp supports receiving images, audio, video, and documents.

**Images:**
- Meta webhook includes `message.image.id`
- Download via: `GET https://graph.facebook.com/v21.0/{media-id}` → get URL → download binary
- Convert to base64, send as `UserContent.image_text` to Gemini
- Kayley can see and respond to photos you send her

**Voice messages:**
- Meta webhook includes `message.audio.id`
- Download OGG/OPUS audio file
- Convert to base64, send as `UserContent.audio` to Gemini
- Gemini natively handles audio input — Kayley hears your voice

**Priority:** Images first (high value), then voice (nice-to-have).

### 7.2 Outbound Media (Kayley → Phone)

**Selfies:**
- Kayley already generates selfies via image generation APIs
- The Edge Function can trigger the same generation
- Send via WhatsApp media message API:
  ```
  POST /messages { type: "image", image: { link: "https://..." } }
  ```
- Need: host the generated image somewhere accessible (Supabase Storage is perfect)

**Voice notes:**
- ElevenLabs TTS already generates audio
- Convert to OGG/OPUS format (WhatsApp's required format for voice notes)
- Upload to Supabase Storage, send via media message API
- This makes Kayley feel alive on WhatsApp — hearing her voice

**Videos:**
- Current video generation (likely via a video API) produces MP4 URLs
- Send directly via WhatsApp media message: `{ type: "video", video: { link: "url" } }`

### 7.3 WhatsApp-Specific Features

**Reactions:**
- Kayley can react to your messages with emoji
- API: `POST /messages { type: "reaction", reaction: { message_id, emoji } }`
- Add to action schema: `reaction: "😂"` in response format

**Read receipts:**
- Mark messages as read when processed
- API: `POST /messages { messaging_product: "whatsapp", status: "read", message_id }`

**Typing indicator:**
- Not natively supported by WhatsApp Business API (only visible in regular WhatsApp)
- Skip this.

### 7.4 Proactive Messages (Kayley → You, unprompted)

This is the killer feature. Kayley can message you first on WhatsApp.

**Implementation:**
- The `pending_messages` table already stores messages Kayley wants to send
- Create a **scheduled Edge Function** (cron) that:
  1. Checks `pending_messages` for undelivered messages
  2. Sends them via WhatsApp Cloud API
  3. Marks as delivered

**Important constraint:** WhatsApp has a 24-hour messaging window. After 24 hours of no user message, you can only send **template messages** (pre-approved by Meta). For proactive messages outside the 24h window:
- Pre-register a few templates: "Hey, I was thinking about you 💭", "Just wanted to check in 💕", etc.
- Or: use a generic template like "Kayley has a message for you" that links to the web app
- Within the 24h window: send freely (any text, images, etc.)

**Trigger sources:**
- Calendar reminders ("don't forget your meeting in 30 min")
- Idle breakers (same logic as `triggerIdleBreaker()`)
- Promise follow-ups ("did you end up calling your mom?")
- Good morning/goodnight messages

### 7.5 Deliverables
- [ ] Inbound image support (you send Kayley a photo)
- [ ] Inbound voice message support
- [ ] Outbound selfie images
- [ ] Outbound voice notes (ElevenLabs → OGG → WhatsApp)
- [ ] Proactive messaging via scheduled function + pending_messages
- [ ] WhatsApp template messages for outside 24h window
- [ ] Read receipts on processed messages

---

## 8. Phase 4 — Multi-Channel Sync

### Goal
Messages sent on WhatsApp appear in the web app, and vice versa. Kayley has a unified view of the conversation regardless of channel.

### 8.1 Conversation History Unification

Add a `channel` column to `conversation_history`:
- `'web'` — sent/received via browser
- `'whatsapp'` — sent/received via WhatsApp

Both channels write to the same table. The web app's `loadTodaysConversationHistory()` already reads from this table — it will automatically pick up WhatsApp messages.

### 8.2 Session State Coordination

**Problem:** Both channels use the Gemini Interactions API with `interactionId` chaining. If you talk on web then switch to WhatsApp, you need the same chain or a way to branch it.

**Options:**

1. **Shared chain (simple but fragile):** Both channels use the same `interactionId`. The web app writes to a `sessions` table; the Edge Function reads from the same table. Whoever speaks last sets the chain head.

2. **Separate chains, shared memory (recommended):** Web and WhatsApp maintain independent Gemini interaction chains. Both read/write to the same Supabase state (user_facts, conversation_history, relationship, etc.). Kayley's system prompt includes recent conversation history from BOTH channels, so she knows what was said on the other channel.

   This is more robust because:
   - No race conditions on interactionId
   - If one channel's chain gets corrupted, the other is unaffected
   - The Gemini Interactions API may have limits on chain length

### 8.3 Real-Time Sync to Web App

When a WhatsApp message comes in, the web app should show it in real-time if it's open:

- **Supabase Realtime:** Subscribe to `conversation_history` inserts where `channel = 'whatsapp'`
- Web app already uses Supabase client — add a realtime subscription
- New WhatsApp messages appear in the chat panel instantly

### 8.4 Channel Indicator in UI

Show a small icon (💬 or 📱) next to messages in the web app to indicate which channel they came from. Requires adding `channel` to the `ChatMessage` type.

### 8.5 Deliverables
- [ ] `channel` column on `conversation_history`
- [ ] Web app shows WhatsApp messages in real-time
- [ ] Channel indicator in chat UI
- [ ] Independent Gemini chains per channel with shared state
- [ ] Kayley's system prompt includes cross-channel recent history

---

## 9. Database Changes

### New Table: `whatsapp_sessions`

```sql
CREATE TABLE whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number text UNIQUE NOT NULL,
  interaction_id text,                    -- Gemini chain head
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  is_greeting_sent boolean DEFAULT false, -- Track daily greeting
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Reset session daily (new chain each day, matching web behavior)
CREATE INDEX idx_whatsapp_sessions_phone ON whatsapp_sessions(phone_number);

-- Auto-update trigger
CREATE TRIGGER update_whatsapp_sessions_updated_at
  BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Alter Table: `conversation_history`

```sql
ALTER TABLE conversation_history
  ADD COLUMN channel text NOT NULL DEFAULT 'web'
  CHECK (channel IN ('web', 'whatsapp'));

CREATE INDEX idx_conversation_history_channel ON conversation_history(channel);
```

### Alter Table: `pending_messages`

```sql
ALTER TABLE pending_messages
  ADD COLUMN delivery_channel text NOT NULL DEFAULT 'web'
  CHECK (delivery_channel IN ('web', 'whatsapp', 'both'));
```

---

## 10. Environment Variables

### Supabase Edge Function Secrets

```bash
# WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN=          # Permanent system user token from Meta
WHATSAPP_PHONE_NUMBER_ID=       # Your WhatsApp Business phone number ID
WHATSAPP_BUSINESS_ACCOUNT_ID=   # Your WABA ID
WHATSAPP_VERIFY_TOKEN=          # Your chosen webhook verify token
WHATSAPP_ALLOWED_NUMBERS=       # Comma-separated allowed phone numbers (security)

# Gemini (same key as web, but accessed via Deno.env)
GEMINI_API_KEY=

# ElevenLabs (for voice notes)
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

# Supabase (auto-available in Edge Functions)
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
```

### Web App `.env` additions

```bash
# No changes needed for Phase 1-2
# Phase 4 (optional): flag to enable cross-channel display
VITE_ENABLE_WHATSAPP_SYNC=true
```

---

## 11. Feature Parity Matrix

| Feature | Web App | WhatsApp | Notes |
|---|:---:|:---:|---|
| Text chat | Yes | Phase 2 | Core functionality |
| Image input (user sends photo) | Yes | Phase 3 | Download from Meta, base64 to Gemini |
| Voice input | Yes (STT) | Phase 3 | Direct audio to Gemini |
| Selfie generation | Yes | Phase 3 | Host on Supabase Storage, send as media |
| Video generation | Yes | Phase 3 | Send MP4 URL as media message |
| Voice output (TTS) | Yes | Phase 3 | ElevenLabs → OGG → WhatsApp voice note |
| Calendar integration | Yes | Phase 2 | Server-side, needs Google OAuth flow |
| Task management | Yes | Phase 2 | Via tool calls in Gemini |
| News fetching | Yes | Phase 2 | Server-side fetch, text summary |
| Proactive messages | Yes (idle breaker) | Phase 3 | Scheduled function + pending_messages |
| Typing indicator | Yes | No | Not supported by WhatsApp Business API |
| Emoji reactions | No | Phase 3 | WhatsApp-only feature |
| Read receipts | No | Phase 3 | Mark as read on processing |
| Character video (idle) | Yes | No | Browser-only concept |
| Whiteboard | Yes | No | Browser-only |

---

## 12. Security Considerations

### Phone Number Allowlist
Single-user app. Hardcode your phone number as the only allowed sender. Reject all other numbers.

```typescript
const ALLOWED_NUMBERS = Deno.env.get('WHATSAPP_ALLOWED_NUMBERS')?.split(',') || [];
if (!ALLOWED_NUMBERS.includes(message.from)) {
  return new Response('OK', { status: 200 }); // Silently ignore
}
```

### Webhook Signature Verification
Meta signs webhook payloads with `X-Hub-Signature-256`. Verify it:

```typescript
import { createHmac } from 'node:crypto';

function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  return signature === `sha256=${expected}`;
}
```

### Token Security
- WhatsApp access token stored as Supabase secret (never in code)
- Gemini API key stored as Supabase secret
- Service role key used for DB writes (elevated permissions, server-only)

### Rate Limiting
- Meta has its own rate limits (80 messages/second for Business tier)
- Add a simple in-memory or Redis-based rate limiter if needed
- For single-user, unlikely to be an issue

---

## 13. Cost Estimation

### Monthly costs for personal single-user usage

| Service | Cost | Notes |
|---|---|---|
| WhatsApp Business API | **$0** | Free tier: 1,000 service conversations/month |
| Supabase Edge Functions | **$0** | Free tier: 500K invocations/month |
| Supabase Storage (selfies/voice) | **$0** | Free tier: 1GB storage, 2GB bandwidth |
| Gemini API | **Existing** | Same usage, just different transport |
| ElevenLabs (voice notes) | **Existing** | Same API, just different output format |
| **Total additional cost** | **$0/month** | All within free tiers for personal use |

---

## 14. Open Questions

These need to be resolved before or during implementation:

1. **Google OAuth for WhatsApp channel:** Calendar and Gmail tools need a Google access token. The web app gets this via browser OAuth. How should the Edge Function get it?
   - Option A: Store a refresh token in Supabase, auto-refresh server-side
   - Option B: Calendar/Gmail features only work from web app
   - Option C: Use a Google Service Account for server-side access

2. **Gemini Interactions API from Edge Functions:** The Interactions API (`/v1beta/interactions`) may require specific auth or have limitations when called from a server context vs browser. Need to verify.

3. **Edge Function execution time limits:** Supabase Edge Functions have a default timeout of 60 seconds (can be increased to 150s on paid plan). A full Gemini call with tool use (up to 3 iterations) could take 15-30 seconds. Should be fine, but need to verify with real-world latency.

4. **Audio format conversion:** ElevenLabs outputs MP3. WhatsApp voice notes require OGG/OPUS. Do we convert server-side (need an audio library in Deno) or configure ElevenLabs to output OGG directly?

5. **Message ordering:** If you send multiple messages quickly on WhatsApp, Meta may deliver webhooks out of order. Do we need a queue/sequencer, or is best-effort ordering fine?

6. **Proactive message templates:** Which templates to pre-register with Meta for outside-24h-window messaging? Need to draft and submit for approval.

---

## Implementation Order (Summary)

```
Phase 1: Server Foundation (1-2 days of focused work)
  → Meta account setup
  → Edge Function with echo bot
  → Webhook verification working

Phase 2: Core Message Loop (2-3 days)
  → Gemini integration in Edge Function
  → Session management (whatsapp_sessions table)
  → System prompt adaptation for WhatsApp
  → Conversation history with channel column
  → End-to-end text conversations working

Phase 3: Rich Features (3-5 days, can be incremental)
  → Inbound images and voice
  → Outbound selfies and voice notes
  → Proactive messaging (scheduled function)
  → Reactions and read receipts

Phase 4: Multi-Channel Sync (2-3 days)
  → Cross-channel history display
  → Supabase Realtime subscriptions
  → Channel indicators in web UI
  → Independent session chains with shared state
```

Each phase is independently deployable and valuable. Phase 2 alone gives you a working WhatsApp Kayley.
