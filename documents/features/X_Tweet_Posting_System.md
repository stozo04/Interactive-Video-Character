# X Tweet System Reference

**File purpose:** junior-friendly, current-state reference for the X workflow
**Status:** Current implementation reference
**Last reviewed against code:** 2026-03-08

---

## Executive Summary

The X system is now primarily **server-owned**.

There are five main workflows:

1. **X auth and connection**
   - connect/disconnect the X account from the Settings UI
2. **Tweet draft creation**
   - chat-created tweets and idle-generated tweets both create `x_tweet_drafts` rows
3. **Tweet approval and final posting**
   - Web uses a Tweet Approval Card
   - Telegram/WhatsApp use mechanical approval commands
4. **Mention polling, drafting, and proactive delivery**
   - the main server polls mentions on a timer and stores them in `x_mentions`
   - Telegram is delivered directly from the main server
   - WhatsApp is delivered through a Supabase-backed bridge queue
5. **Metrics refresh**
   - the App refreshes engagement for recent posted tweets on a timer

The core backend services are:
- `server/services/xTwitterServerService.ts`
- `server/services/xMentionService.ts`
- `server/services/xMentionHeartbeat.ts`
- `server/services/xTweetGenerationService.ts`

The browser now uses a thin client:
- `src/services/xClient.ts`

Important architecture facts:
- the old client-side X services are no longer the source of truth
- X auth, posting, mentions, and metrics now go through server-owned code paths
- tweet posting is no longer supposed to happen directly from LLM tool approval
- the Web app is no longer the X mention scheduler

---

## Why This Doc Exists

Future developers and agents need one place that answers:
- how X auth works now
- where tweet drafts live
- how approval works across Web, Telegram, and WhatsApp
- how mentions are polled, queued, and surfaced into Kayley's prompt
- which process owns polling vs delivery
- what the current known tradeoffs are

This doc is meant to be practical. It should let someone debug or extend the X system without rediscovering the architecture.

---

## Core Files

### Main implementation files

| File | What it does |
|---|---|
| `server/services/xTwitterServerService.ts` | Server-owned X auth, token refresh, tweet posting, media upload, draft CRUD, mention CRUD, metrics refresh |
| `server/services/xMentionService.ts` | Polls mentions, stores them, drafts mention replies, builds mention prompt section |
| `server/services/xMentionHeartbeat.ts` | Main server scheduler for X mention polling + proactive announcement queueing |
| `server/services/xTweetGenerationService.ts` | Generates idle tweet drafts on the server |
| `server/routes/agentRoutes.ts` | Exposes `/agent/x/*` endpoints and `/agent/tweet-drafts/:id/resolve` |
| `src/services/xClient.ts` | Thin browser client for `/agent/x/*` |
| `src/services/messageOrchestrator.ts` | Attaches `pendingTweetDraft` to Web responses |
| `src/services/memoryService.ts` | Gemini tool handlers for `post_x_tweet`, blocked `resolve_x_tweet`, and `resolve_x_mention` |
| `src/services/aiSchema.ts` | Gemini tool declarations for X actions |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Tells Kayley when to use X tools |
| `src/services/system_prompts/builders/systemPromptBuilder.ts` | Injects tweet and mention prompt sections into main prompt |
| `src/services/idleThinkingService.ts` | Builds prompt section for pending/recent tweets and contains idle X hooks |
| `src/components/SettingsPanel.tsx` | Connect/disconnect X account and toggle posting mode |
| `src/components/TweetApprovalCard.tsx` | Web approval UI for pending tweet drafts |
| `src/App.tsx` | Handles X OAuth callback and schedules metrics refresh |
| `server/telegram/telegramHandler.ts` | Telegram-side tweet approval command handling |
| `server/whatsapp/whatsappHandler.ts` | WhatsApp-side tweet approval command handling |
| `server/whatsapp/xMentionBridge.ts` | WhatsApp bridge that delivers queued X mention announcements from Supabase |

### Related docs/specs

| File | Why it matters |
|---|---|
| `documents/features/X_Tweet_Posting_System.md` | This reference doc |
| `server/agent/opey-dev/features/tweet-approval-card.md` | Current feature/spec for the mechanical approval flow |
| `documents/features/Idle_Thinking_System.md` | Background on idle action behavior |

### Database migrations

| File | What it added |
|---|---|
| `supabase/migrations/20260210_x_tweet_system.sql` | `x_auth_tokens`, `x_tweet_drafts`, idle X support |
| `supabase/migrations/20260211_x_tweet_selfie_columns.sql` | `include_selfie`, `selfie_scene`, `media_id` |
| `supabase/migrations/20260211_x_tweet_metrics_columns.sql` | tweet metric columns |
| `supabase/migrations/20260211_x_mentions.sql` | `x_mentions` table |
| `supabase/migrations/20260308_x_mention_delivery_queue.sql` | mention announcement queue + Telegram/WhatsApp delivery tracking |

---

## High-Level Architecture

```text
Settings UI / App
  -> /agent/x/status
  -> /agent/x/auth/start
  -> /agent/x/auth/callback
  -> /agent/x/auth/revoke
  -> /agent/x/metrics/refresh

Chat / Gemini Tool System
  -> post_x_tweet creates pending draft only
  -> resolve_x_tweet is blocked from posting directly
  -> resolve_x_mention can approve/reply/skip mentions

Human Approval Layer
  -> Web: Tweet Approval Card
  -> Telegram: POST TWEET / REJECT TWEET
  -> WhatsApp: POST TWEET / REJECT TWEET

Server X Services
  -> auth tokens
  -> tweet posting / media upload / replies
  -> draft CRUD
  -> mention fetch/store/update
  -> mention polling heartbeat
  -> proactive mention announcement queueing
  -> metrics refresh

Channel Delivery
  -> Telegram: main server sends directly
  -> WhatsApp: bridge process reads queued mention announcements from Supabase

Supabase Tables
  -> x_auth_tokens
  -> x_tweet_drafts
  -> x_mentions
  -> user_facts

X API
  -> OAuth token endpoints
  -> tweets endpoint
  -> media upload endpoint
  -> mentions endpoint
  -> users/me endpoint
```

---

## Database Model

## `x_auth_tokens`

Purpose:
- stores the connected X account's access token and refresh token

Important columns:
- `access_token`
- `refresh_token`
- `expires_at`
- `scope`
- `created_at`
- `updated_at`

How it is used:
- `server/services/xTwitterServerService.ts` reads this table before X API calls
- if the access token is close to expiry, the server refreshes it and updates this row

Assumption:
- this app currently assumes one connected X account

## `x_tweet_drafts`

Purpose:
- stores pending drafts, posted tweets, rejected drafts, and failed posts

Important columns:
- `tweet_text`
- `status`
- `intent`
- `reasoning`
- `tweet_id`
- `tweet_url`
- `generation_context`
- `rejection_reason`
- `error_message`
- `posted_at`
- `include_selfie`
- `selfie_scene`
- `media_id`
- `like_count`
- `repost_count`
- `reply_count`
- `impression_count`
- `metrics_updated_at`

Allowed statuses:
- `pending_approval`
- `queued`
- `posted`
- `rejected`
- `failed`

Mental model:
- `pending_approval` = waiting for human approval
- `queued` = reserved for queue/autonomous-style behavior
- `posted` = successfully posted to X
- `rejected` = intentionally not posted
- `failed` = a post attempt happened and failed

Important current field usage:
- `generation_context.conversationScopeId` tracks which channel/conversation created the draft
- examples:
  - `web-<uuid>`
  - `telegram-<chatId>`
  - `whatsapp-<jid>`

## `x_mentions`

Purpose:
- stores mentions from X and tracks both the reply lifecycle and proactive delivery lifecycle

Important columns:
- `tweet_id`
- `author_id`
- `author_username`
- `text`
- `conversation_id`
- `in_reply_to_tweet_id`
- `status`
- `reply_text`
- `reply_tweet_id`
- `is_known_user`
- `announcement_text`
- `announcement_created_at`
- `telegram_sent_at`
- `whatsapp_sent_at`
- `history_logged_at`
- `created_at`
- `replied_at`

Common statuses:
- `pending`
- `reply_drafted`
- `replied`
- `ignored`
- `skipped`

Delivery tracking mental model:
- a mention can be stored before it is announced
- `announcement_text` means the main server has queued a proactive notification
- `telegram_sent_at` and `whatsapp_sent_at` track which channel processes actually delivered it
- `history_logged_at` prevents the same proactive announcement from being written to conversation history multiple times

## `user_facts` entries used by X

The X system also depends on some rows in `user_facts`:

- `category='preference', fact_key='x_posting_mode'`
  - `autonomous` means idle tweets may post automatically
  - anything else is treated as approval-required
- `category='preference', fact_key='x_known_users'`
  - comma-separated usernames used to classify mentions as known vs unknown

---

## Service Responsibilities

## `server/services/xTwitterServerService.ts`

This is the current core X backend service.

Responsibilities:
- OAuth start/callback/revoke support
- token refresh
- posting plain tweets
- posting tweets with media
- uploading image media
- posting replies
- draft CRUD for `x_tweet_drafts`
- mention fetch/store/update for `x_mentions`
- engagement metrics refresh
- tweet approval parsing helpers
- mention announcement queue updates and delivery markers

Representative functions:

```ts
startXAuth()
completeXAuthCallback(code, state)
disconnectXAuth()
getXAuthStatus()

postTweet(text)
postTweetWithMedia(text, mediaIds)
uploadMedia(imageBase64, mimeType)
postReply(text, inReplyToTweetId)

createDraft(...)
getDrafts(status?)
getDraftById(id)
getPendingDraftForConversationScope(scope)
getOldestPendingDraft()
resolveXTweetDraft(id, action)
updateDraftStatus(id, status, extra?)
getRecentPostedTweets(limit?)
refreshRecentTweetMetrics()

fetchMentions(sinceId?)
storeMentions(mentions, knownUsernames)
getMentions(status?, limit?)
getMentionsByTweetIds(tweetIds)
reclassifyKnownPendingMentions(knownUsernames)
updateMentionStatus(id, status, extra?)
queueMentionAnnouncement(id, message)
markMentionAnnouncementDelivered(id, channel)
markMentionAnnouncementHistoryLogged(id)
getLatestMentionTweetId()
getKnownXUsernames()

formatTweetApprovalPrompt(draft)
parseTweetApprovalAction(text)
```

## `server/services/xMentionService.ts`

Responsibilities:
- poll X for new mentions
- store them in `x_mentions`
- auto-draft replies for known users
- reclassify pending mentions when a user is now recognized as known
- build a mention prompt section for Gemini
- approve/send a drafted mention reply

Important detail:
- polling logic and storage happen here
- �Kayley knows about mentions� because `buildMentionsPromptSection()` injects stored mention state into the main system prompt

## `server/services/xMentionHeartbeat.ts`

Responsibilities:
- run the always-on server mention poll timer
- call `pollAndProcessMentionsDetailed()`
- queue proactive mention announcements onto `x_mentions`
- deliver Telegram mention notifications directly
- persist the proactive message to conversation history exactly once

Important detail:
- this is now the live scheduler for X mentions
- the Web app is no longer the scheduler

## `server/whatsapp/xMentionBridge.ts`

Responsibilities:
- poll queued X mention announcements from `x_mentions`
- deliver them through the WhatsApp bridge process
- mark `whatsapp_sent_at`
- persist the proactive message to conversation history if Telegram did not already do it

Important detail:
- the main server does not own the live WhatsApp socket
- that is why WhatsApp delivery uses a queue/bridge instead of direct send from the main server

## `src/services/xClient.ts`

Responsibilities:
- thin browser wrapper around `/agent/x/*`
- no direct browser calls to `x_auth_tokens`
- no direct browser X posting logic
- no mention polling scheduler logic

## `src/services/messageOrchestrator.ts`

Responsibilities in the X flow:
- attach `pendingTweetDraft` to Web `/agent/message` responses
- first try the exact `conversationScopeId`
- if no draft matches and the scope is a Web scope, fall back to the oldest pending draft

That fallback is why a draft created in Telegram/WhatsApp can still show up in the Web app.

Tradeoff:
- this is pragmatic and works for current testing
- if multiple unrelated pending drafts exist, oldest-pending fallback is not perfect

---

## End-to-End Flow 1: Connect X Account

### Step-by-step

1. User opens Settings
2. browser calls `GET /agent/x/status`
3. User clicks `Connect X Account`
4. browser calls `POST /agent/x/auth/start`
5. server creates OAuth state and returns an X auth URL
6. browser redirects to X OAuth consent
7. X redirects back to `/auth/x/callback`
8. `App.tsx` detects the callback route
9. browser calls `POST /agent/x/auth/callback`
10. server exchanges the code for tokens and stores them in `x_auth_tokens`
11. App returns to `/`

### Important implementation notes

- OAuth is now server-owned
- browser code goes through `src/services/xClient.ts`
- the earlier direct browser Supabase `x_auth_tokens` path is obsolete
- media uploads require `media.write`; status endpoint exposes scopes and `hasMediaWrite`

---

## End-to-End Flow 2: Chat-Created Tweet Draft

### Tool declarations involved

Declared in `src/services/aiSchema.ts`:
- `post_x_tweet`
- `resolve_x_tweet`

### Current live behavior of `post_x_tweet`

In `src/services/memoryService.ts`:

1. validate tweet text length and selfie arguments
2. create a draft in `x_tweet_drafts`
3. store `generation_context.conversationScopeId`
4. return a message like `Draft created - waiting for Steven's approval.`

Important:
- `post_x_tweet` does **not** post immediately anymore
- it creates a pending draft only

### Current live behavior of `resolve_x_tweet`

In `src/services/memoryService.ts`:
- this tool is intentionally blocked from posting directly
- it returns a message telling the model that tweet drafts must go through the human approval flow

This matters because it removes the earlier LLM posting bypass.

---

## End-to-End Flow 3: Human Approval and Final Posting

This is the current mechanical approval path.

### Web approval flow

1. pending draft exists in `x_tweet_drafts`
2. user sends a message in the Web app
3. `messageOrchestrator.ts` loads the pending draft
4. response includes `pendingTweetDraft`
5. `src/components/TweetApprovalCard.tsx` renders the card
6. user clicks `Post it` or `Reject`
7. browser calls `POST /agent/tweet-drafts/:id/resolve` with `{ action: 'post' | 'reject' }`
8. server posts the tweet or marks it rejected
9. draft row updates to `posted`, `failed`, or `rejected`

### Telegram / WhatsApp approval flow

1. pending draft exists in `x_tweet_drafts`
2. Kayley sends the formatted approval prompt into the channel
3. user replies with a recognized command or approval phrase
4. channel handler parses the approval intent
5. server resolves the draft through the same backend draft resolver
6. tweet is posted or rejected

Accepted approval/rejection phrases are intentionally broader than one exact command. Examples:
- post:
  - `POST TWEET`
  - `APPROVE`
  - `YES`
  - `LET'S DO IT`
  - `POST`
  - `SEND IT`
- reject:
  - `REJECT TWEET`
  - `REJECT`
  - `NO`
  - `CANCEL`
  - `DON'T POST`

### Important behavior detail

Cross-channel draft visibility is asymmetric on purpose:
- Telegram/WhatsApp-created drafts can surface in Web because Web falls back to the oldest pending draft
- Web-created drafts still carry their own `conversationScopeId`
- the current system does not yet have a full multi-draft, per-user approval inbox

---

## End-to-End Flow 4: Idle Tweet Generation

This is the background tweet-generation path.

### Current shape

- idle X logic still exists in `src/services/idleThinkingService.ts`
- `server/services/xTweetGenerationService.ts` generates tweet drafts on the server
- posting mode from `user_facts` still matters for autonomous behavior

### Important current caution

The idle X code still exists, but the most critical production-safe change was the chat approval rewrite.
If you are debugging a chat-created tweet, do **not** assume the idle path is involved.

---

## End-to-End Flow 5: Mention Polling and Replies

This is a separate X pipeline from tweet posting.

### What starts it today

The active mention poll is now in `server/services/xMentionHeartbeat.ts`:
- initial poll: `15` seconds after server startup
- periodic poll: every `5` minutes

Important operational detail:
- this does **not** depend on the App being open
- if the main Node server is running, mention polling is running
- Web is no longer the scheduler
- `/agent/x/mentions/poll` remains available as a manual/debug endpoint, but it is not the live production scheduler

### Step-by-step

1. `server/services/xMentionHeartbeat.ts` ticks on the main server
2. heartbeat calls `pollAndProcessMentionsDetailed()` in `server/services/xMentionService.ts`
3. `pollAndProcessMentionsDetailed()` checks `isXConnected()`
4. server reads latest stored mention tweet id from `x_mentions`
5. server fetches newer mentions from X
6. mentions are classified using `x_known_users`, optional env vars, and known historical mention activity
7. mentions are stored in `x_mentions`
8. pending mentions may be reclassified as known users on later polls
9. for known users, server auto-generates a drafted reply and marks status `reply_drafted`
10. heartbeat writes a proactive announcement onto the mention row (`announcement_text`, `announcement_created_at`)
11. Telegram is delivered directly from the main server and marked with `telegram_sent_at`
12. WhatsApp bridge reads queued announcements from Supabase and marks `whatsapp_sent_at`
13. `buildMentionsPromptSection()` later injects those stored mentions into Kayley's prompt
14. Gemini can then call `resolve_x_mention`
15. reply is posted or skipped

### How Kayley �knows� about mentions

She does not know because of a magic live socket.
She knows because:
- the server heartbeat stores new mentions in `x_mentions`
- `buildMentionsPromptSection()` includes pending/drafted mentions in the main system prompt
- that prompt section is added in `src/services/system_prompts/builders/systemPromptBuilder.ts`

Proactive delivery is separate:
- Telegram can be notified immediately by the main server
- WhatsApp can be notified by the bridge process reading queued rows from `x_mentions`
- the prompt section is still what makes Kayley reason about the mention on later turns

### Mention status progression

Common path for known users:
- `pending`
- `reply_drafted`
- `replied`

Common path for ignored/skipped mentions:
- `pending`
- `skipped`

### `resolve_x_mention` behavior

Tool statuses:
- `approve` = send the drafted reply
- `reply` = send a custom `reply_text`
- `skip` = do not reply

---

## End-to-End Flow 6: Metrics Refresh

### What starts it

`App.tsx` schedules metrics refresh on a timer.

### Step-by-step

1. browser calls `POST /agent/x/metrics/refresh`
2. server finds recent `posted` tweet rows with `tweet_id`
3. server fetches public metrics from X
4. server updates:
   - `like_count`
   - `repost_count`
   - `reply_count`
   - `impression_count`
   - `metrics_updated_at`

---

## Current Prompt Wiring

X behavior is shaped by both code and prompt sections.

Important prompt contributors:
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
- `src/services/idleThinkingService.ts`
- `server/services/xMentionService.ts`
- `src/services/aiSchema.ts`

Current important prompt rules:
- `post_x_tweet` creates a pending draft, not a live post
- Web approval is described as the Tweet Approval Card
- Telegram/WhatsApp approval is described as `POST TWEET` / `REJECT TWEET`
- mention replies are exposed through the prompt section built from `x_mentions`

Rule of thumb:
- if X behavior looks wrong, inspect both runtime code and prompt text

---

## Current Settings UI Behavior

`src/components/SettingsPanel.tsx` exposes two X controls:

1. connect / disconnect X account
2. auto-post toggle

Mental model:
- `autonomous` = idle tweets may post without later approval
- non-autonomous = tweets should wait for approval

Important nuance:
- the safety-critical chat flow now uses pending drafts plus human approval
- the Settings toggle mainly matters for idle/autonomous posting behavior

---

## Current Known Risks and Tradeoffs

## 1. Web fallback uses the oldest pending draft

This is the main current product tradeoff.

Why it exists:
- a draft created in Telegram/WhatsApp would otherwise not appear when you switch to the Web app

Why it is imperfect:
- if multiple unrelated pending drafts exist, oldest-pending fallback may not be the one you meant to approve

## 2. Mention delivery is split across processes

This is important operationally.

Current reality:
- the main server is the only X mention poller
- Telegram delivery can happen directly from the main server
- WhatsApp delivery is handled by the separate WhatsApp bridge process through a Supabase queue

That split is intentional because the main server does not own the live WhatsApp socket.

## 3. Prompt text still matters a lot

Even when the backend is correct, stale prompt wording can make Kayley describe the flow incorrectly.
Always inspect:
- tool declarations
- prompt builders
- tool handlers

## 4. Idle and chat flows are related but not identical

Do not debug them as if they are the same path.
The chat flow now has explicit human approval semantics. The idle flow still has its own behavior and posting mode logic.

---

## How to Debug X Bugs

When something is wrong, follow this order.

## A. "Why did a tweet post?"

Check:
1. `src/services/memoryService.ts`
   - `post_x_tweet`
   - `resolve_x_tweet`
2. `server/routes/agentRoutes.ts`
   - `/agent/tweet-drafts/:id/resolve`
3. `server/services/xTwitterServerService.ts`
   - draft resolver and post helpers
4. the `x_tweet_drafts` row
   - `status`
   - `generation_context`
   - `reasoning`
   - `posted_at`
5. whether the action came from:
   - Web approval card
   - Telegram/WhatsApp approval command
   - idle/autonomous flow

## B. "Why was a draft never shown in Web?"

Check:
1. did `createDraft(...)` succeed?
2. what `status` is stored?
3. what is `generation_context.conversationScopeId`?
4. did `/agent/message` include `pendingTweetDraft`?
5. if switching channels, did Web fall back to the oldest pending draft?

## C. "Why did Telegram/WhatsApp approval not trigger?"

Check:
1. whether the channel handler saw the message as an approval phrase
2. `parseTweetApprovalAction(...)` in `server/services/xTwitterServerService.ts`
3. whether there was a pending draft available to resolve
4. whether the final server draft resolver returned success/failure

## D. "Why aren't mentions showing up?"

Check:
1. X is connected
2. main server is running
3. `server/services/xMentionHeartbeat.ts` is running
4. rows are being written to `x_mentions`
5. `buildMentionsPromptSection()` is non-empty on later turns
6. X token scopes still allow mention access

## E. "Why did mention storage work but Kayley didn't talk about it yet?"

Check:
1. mention row exists in `x_mentions`
2. what its `status` is
3. whether `announcement_text` was queued
4. whether `telegram_sent_at` or `whatsapp_sent_at` was written
5. whether the next conversation turn rebuilt the prompt
6. whether the mention is known-user, unknown-user, drafted, or skipped

## F. "Why did metrics stop updating?"

Check:
1. `POST /agent/x/metrics/refresh` is still firing
2. `tweet_id` exists on posted rows
3. `posted_at` is recent enough
4. X API responses for public metrics

---

## Recommended Mental Model for Future Add-ons

Split changes into these lanes:

### Lane 1: Auth and account health
Examples:
- scope validation
- reconnect UX
- token refresh observability

### Lane 2: Tweet generation
Examples:
- better prompts
- storyline-aware posting
- duplicate prevention
- moderation

### Lane 3: Approval and posting orchestration
Examples:
- multi-draft inbox
- better cross-channel approval selection
- scheduling tweets for later
- moving all approval UX to a unified inbox

### Lane 4: Mentions and replies
Examples:
- better heartbeat observability
- trust scoring for unknown users
- mention inbox UI
- better reply policy

### Lane 5: Analytics and continuity
Examples:
- engagement summaries
- best-performing tweet surfacing
- tying storyline progress to tweet performance

---

## Safe Extension Points

Good places to extend without rewriting everything:
- `server/services/xTweetGenerationService.ts`
- `server/services/xMentionService.ts`
- `server/services/xMentionHeartbeat.ts`
- `server/services/xTwitterServerService.ts`
- `server/whatsapp/xMentionBridge.ts`
- `src/services/xClient.ts`
- `src/components/TweetApprovalCard.tsx`
- `src/components/SettingsPanel.tsx`

Areas that need extra care:
- `src/services/memoryService.ts` X tool handlers
- channel approval parsing and routing
- anything that changes whether an external post can happen
- cross-process announcement delivery and dedupe

---

## Junior Dev Cheat Sheet

If you only remember one thing from this doc, remember this:

```text
Tokens live in x_auth_tokens.
Tweet drafts and posted tweets live in x_tweet_drafts.
Mentions live in x_mentions.

Browser X calls go through /agent/x/*.
The backend source of truth is server/services/xTwitterServerService.ts.

post_x_tweet creates a pending draft.
resolve_x_tweet is blocked from direct posting.
Final tweet posting happens through human approval.

Web approves with the Tweet Approval Card.
Telegram/WhatsApp approve with POST TWEET or REJECT TWEET.

Mentions are actively polled every 5 minutes by the main server.
Telegram is delivered directly; WhatsApp is delivered through a queue bridge.
Stored mentions are injected into Kayley's prompt on later turns.
```

---

## File Map

```text
server/
  routes/
    agentRoutes.ts                      # /agent/x/* and /agent/tweet-drafts/:id/resolve
  services/
    xTwitterServerService.ts            # auth, posting, drafts, mentions, metrics
    xTweetGenerationService.ts          # idle/server tweet generation
    xMentionService.ts                  # mention polling + reply drafting + prompt section
    xMentionHeartbeat.ts                # always-on server mention poller + announcement queueing

src/
  components/
    SettingsPanel.tsx                   # connect/disconnect X + posting mode toggle
    TweetApprovalCard.tsx               # Web approval UI
  services/
    xClient.ts                          # browser client for /agent/x/*
    messageOrchestrator.ts              # attaches pendingTweetDraft to Web responses
    idleThinkingService.ts              # idle X hooks + tweet prompt section
    memoryService.ts                    # Gemini tool handlers for tweet/mention actions
    aiSchema.ts                         # Gemini tool declarations
    system_prompts/
      builders/systemPromptBuilder.ts   # injects tweet + mention prompt sections
      tools/toolsAndCapabilities.ts     # prompt policy for X tools
  App.tsx                               # OAuth callback + metrics refresh timer

server/telegram/
  telegramHandler.ts                    # Telegram approval handling

server/whatsapp/
  whatsappHandler.ts                    # WhatsApp approval handling
  xMentionBridge.ts                     # queued X mention delivery for WhatsApp

supabase/migrations/
  20260210_x_tweet_system.sql
  20260211_x_tweet_selfie_columns.sql
  20260211_x_tweet_metrics_columns.sql
  20260211_x_mentions.sql
  20260308_x_mention_delivery_queue.sql
```

---

## Final Notes

This X system is materially safer than the earlier browser-heavy implementation, but it still has clear operational tradeoffs.

For future work:
- treat `x_tweet_drafts` as the source of truth for tweet lifecycle
- treat `x_mentions` as the source of truth for mention lifecycle
- treat prompt instructions as part of runtime behavior
- be explicit about channel differences when debugging approval behavior
- preserve the single-poller model for X mentions

When debugging, first identify which exact workflow you are in:
- auth
- chat-created draft
- human approval / final post
- idle tweet generation
- mention polling / mention reply / proactive mention delivery
- metrics refresh

That one decision cuts the search space down quickly.
