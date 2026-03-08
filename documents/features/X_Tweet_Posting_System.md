# X Tweet System Reference

**File purpose:** junior-friendly, current-state reference for the entire X/Twitter workflow
**Status:** Current implementation reference + known risks
**Last reviewed against code:** 2026-03-08

---

## Executive Summary

This project has one X system, but it really contains **four different workflows** that share the same tables and helper service:

1. **X account auth and connection**
   - connect/disconnect the X account from the Settings UI
2. **Tweet drafting and posting**
   - idle/autonomous tweets
   - chat-triggered tweets
3. **Mention polling and replies**
   - poll X for new mentions, save them, draft replies, approve/send replies
4. **Tweet metrics refresh**
   - refresh likes/reposts/replies/impressions for recently posted tweets

The central service is `src/services/xTwitterService.ts`.

Important architecture fact:
- `src/services/xTwitterService.ts` is currently the shared home for auth, posting, draft CRUD, mention CRUD, and metrics
- it is **browser-oriented**, not a clean server-only service
- future agent/server work must be careful not to assume there is already a server-safe X service

---

## Why This Doc Exists

Future developers and agents need one place that answers:
- what happens when Kayley posts a tweet
- where tweet drafts live
- how approval works today
- how idle tweets differ from chat tweets
- how mentions are polled and replied to
- what tables are involved
- what the main risks and extension points are

This doc is intentionally practical. It is meant to help someone debug a bug or add a feature without needing to rediscover the whole system.

---

## Core Files

### Main implementation files

| File | What it does |
|---|---|
| `src/services/xTwitterService.ts` | X auth, token refresh, tweet posting, media upload, draft CRUD, mention CRUD, metrics refresh |
| `src/services/xTweetGenerationService.ts` | Builds tweet-generation context and uses Gemini to create tweet drafts |
| `src/services/idleThinkingService.ts` | Runs idle tweet generation and idle mention polling |
| `src/services/xMentionService.ts` | Polls mentions, stores them, drafts replies, builds mention prompt sections |
| `src/services/memoryService.ts` | Gemini tool handlers for `post_x_tweet`, `resolve_x_tweet`, and `resolve_x_mention` |
| `src/services/aiSchema.ts` | Declares the Gemini function tools for X actions |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Tells Kayley when to use X tools |
| `src/components/SettingsPanel.tsx` | Connect/disconnect X account and toggle posting mode |
| `src/App.tsx` | Handles X OAuth callback and schedules metrics refresh + mention polling |

### Related docs/specs

| File | Why it matters |
|---|---|
| `documents/features/X_Tweet_Posting_System.md` | This reference doc |
| `server/agent/opey-dev/features/tweet-approval-card.md` | Current bug/spec for replacing conversational approval with a mechanical UI gate |
| `documents/features/Idle_Thinking_System.md` | Background on the idle action framework |

### Database migrations

| File | What it added |
|---|---|
| `supabase/migrations/20260210_x_tweet_system.sql` | `x_auth_tokens`, `x_tweet_drafts`, idle action support for `x_post` |
| `supabase/migrations/20260211_x_tweet_selfie_columns.sql` | `include_selfie`, `selfie_scene`, `media_id` |
| `supabase/migrations/20260211_x_tweet_metrics_columns.sql` | engagement metric columns |
| `supabase/migrations/20260211_x_mentions.sql` | `x_mentions` table |

---

## High-Level Architecture

```text
Settings UI
  -> connect/disconnect X account
  -> store posting mode preference

Idle Thinking System
  -> may generate tweet drafts
  -> may auto-post or wait for approval
  -> may poll mentions

Chat / Gemini Tool System
  -> may create tweet draft via post_x_tweet
  -> may approve/reject draft via resolve_x_tweet
  -> may approve/reply/skip mentions via resolve_x_mention

X Service Layer
  -> auth tokens
  -> post tweet / post with media / post reply
  -> create/update/read drafts
  -> create/update/read mentions
  -> refresh metrics

Supabase Tables
  -> x_auth_tokens
  -> x_tweet_drafts
  -> x_mentions
  -> user_facts (posting mode, known usernames)

X API
  -> OAuth 2.0 token endpoints
  -> tweets endpoint
  -> media upload endpoint
  -> mentions endpoint
  -> users/me endpoint
```

---

## Database Model

## `x_auth_tokens`

Purpose:
- stores the one connected X account's access token and refresh token

Important columns:
- `access_token`
- `refresh_token`
- `expires_at`
- `scope`
- `created_at`
- `updated_at`

How it is used:
- `xTwitterService.ts` reads this table before every X API call
- if the access token is near expiry, it refreshes and updates this row

Assumption:
- this app is single-user, so the service expects effectively one token row

## `x_tweet_drafts`

Purpose:
- stores every draft and posted tweet record

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
- `pending_approval` = waiting for a human or LLM approval path
- `queued` = intended for autonomous/auto-post style flow
- `posted` = successfully posted to X
- `rejected` = intentionally not posted
- `failed` = posting was attempted and failed

## `x_mentions`

Purpose:
- stores mentions from X and tracks the reply pipeline

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
- `created_at`
- `replied_at`

Allowed statuses:
- `pending`
- `reply_drafted`
- `replied`
- `ignored`
- `skipped`

## `user_facts` entries used by X

The X system also depends on some rows in `user_facts`:

- `category='preference', fact_key='x_posting_mode'`
  - `approval`/`approval_required` behavior conceptually means do not auto-post
  - `autonomous` means idle tweets can post immediately
- `category='preference', fact_key='x_known_users'`
  - comma-separated usernames used to classify mentions as known vs unknown

Note:
- the Settings UI writes `autonomous` or `approval`
- idle code checks for `autonomous` and otherwise treats it as approval-required behavior
- that is good enough today, but it is a small naming inconsistency worth keeping in mind

---

## Service Responsibilities

## `src/services/xTwitterService.ts`

This is the core X utility service.

Responsibilities:
- PKCE OAuth flow
- token refresh and revocation
- posting plain tweets
- posting tweets with media
- uploading image media
- draft CRUD for `x_tweet_drafts`
- mention fetch/store/update for `x_mentions`
- engagement metrics refresh

Key public functions:

```ts
initXAuth()
handleXAuthCallback(code, state)
revokeXAuth()
isXConnected()
hasXScope(scope)

postTweet(text)
postTweetWithMedia(text, mediaIds)
uploadMedia(imageBase64, mimeType)

createDraft(tweetText, intent, reasoning, generationContext, status)
getDrafts(status?)
getDraftById(id)
updateDraftStatus(id, status, extra?)
getRecentPostedTweets(limit?)
refreshRecentTweetMetrics()

fetchMentions(sinceId?)
storeMentions(mentions, knownUsernames)
getMentions(status?, limit?)
updateMentionStatus(id, status, extra?)
postReply(text, inReplyToTweetId)
getLatestMentionTweetId()
getKnownXUsernames()
```

Important warning:
- despite its name, this is not a cleanly isolated backend service
- it uses browser-style environment variables and `/api/x/...` proxy endpoints
- future server routes should not assume this file is safe to call unchanged on the server

## `src/services/xTweetGenerationService.ts`

Responsibilities:
- gather tweet-generation context
- ask Gemini for a tweet draft
- validate tweet text
- store the draft

Inputs it gathers:
- `KAYLEY_FULL_PROFILE`
- character facts from `characterFactsService`
- recent posted tweets
- active storylines
- recent browse notes
- time of day / day of week

Outputs:
- one `x_tweet_drafts` row via `createDraft(...)`

## `src/services/idleThinkingService.ts`

Responsibilities in the X system:
- schedules or triggers idle `x_post`
- schedules or triggers idle `x_mention_poll`
- builds prompt sections about pending/recent tweets

Important X functions inside it:
- `runXPostAction()`
- `runXMentionPollAction()`
- `buildXTweetPromptSection()`

## `src/services/xMentionService.ts`

Responsibilities:
- poll X for new mentions
- store them in `x_mentions`
- auto-draft replies for known users
- build a prompt section so Kayley can approve/reply/skip mentions

---

## End-to-End Flow 1: Connect X Account

This is the auth flow a junior dev should understand first.

### Step-by-step

1. User opens settings
2. `SettingsPanel.tsx` checks `isXConnected()`
3. User clicks `Connect X Account`
4. `initXAuth()` generates PKCE values and stores them in `sessionStorage`
5. Browser redirects to the X OAuth consent screen
6. X redirects back to `/auth/x/callback`
7. `App.tsx` detects that callback route
8. `handleXAuthCallback(code, state)` exchanges the code for tokens
9. Tokens are written into `x_auth_tokens`
10. App returns to `/`

### ASCII flow

```text
SettingsPanel
  -> initXAuth()
  -> sessionStorage saves PKCE verifier + state
  -> redirect to X
  -> X redirects back to /auth/x/callback
  -> App.tsx sees callback route
  -> handleXAuthCallback(code, state)
  -> store tokens in x_auth_tokens
  -> X is now connected
```

### Important implementation notes

- auth state is not stored in Supabase Auth; it is custom token storage
- `handleXAuthCallback(...)` uses the Vite proxy path `/api/x/2/oauth2/token`
- media uploads require `media.write`; Settings UI checks for this and warns if missing

---

## End-to-End Flow 2: Idle Tweet Generation

This is the background, non-chat posting flow.

### What starts it

`App.tsx` drives idle behavior through the idle system. The idle system may choose `x_post` as one of its actions.

### Step-by-step

1. Idle tick runs in `idleThinkingService.ts`
2. It chooses action `x_post`
3. `runXPostAction()` checks `isXConnected()`
4. `generateTweet('pending_approval')` is called
5. `xTweetGenerationService.ts` gathers context and asks Gemini for a tweet
6. `createDraft(...)` inserts a row into `x_tweet_drafts`
7. Idle flow checks posting mode from `user_facts`
8. If mode is `autonomous`:
   - optionally generate selfie media
   - post tweet immediately
   - update draft row to `posted`
9. If mode is not `autonomous`:
   - leave draft as `pending_approval`
   - later expose it conversationally through prompt context

### ASCII flow

```text
Idle tick
  -> runXPostAction()
    -> isXConnected()?
    -> generateTweet('pending_approval')
      -> gather context
      -> Gemini generates tweet JSON
      -> validate tweet
      -> createDraft(...)
    -> read x_posting_mode from user_facts
    -> if autonomous
         -> maybe generate selfie
         -> postTweet / postTweetWithMedia
         -> updateDraftStatus(..., 'posted')
       else
         -> leave draft pending_approval
```

### Key design idea

Idle posting is the cleanest path in the current system because it already thinks in terms of:
- draft first
- maybe post later
- store all outcomes in `x_tweet_drafts`

### Current caveat

Even approval-required idle tweets are still surfaced conversationally, not through a hard UI gate.
That is the same family of problem behind the current tweet approval bug.

---

## End-to-End Flow 3: Chat-Created Tweet via Gemini Tool

This is the most important flow for current bugs.

### Tool declarations involved

Declared in `src/services/aiSchema.ts`:
- `post_x_tweet`
- `resolve_x_tweet`

### What the model is told today

Prompt guidance currently tells Kayley:
- use `post_x_tweet` when the user approves a tweet in conversation
- use `resolve_x_tweet` when the user approves or rejects a pending draft

That means the model is part of the approval gate.

### Current live behavior of `post_x_tweet`

In `src/services/memoryService.ts`:

1. validate tweet text length
2. create a draft in `x_tweet_drafts`
3. immediately try to post it
4. if `include_selfie` is set:
   - generate a selfie
   - upload media
   - post with media
5. update the draft row to `posted` or `failed`

### ASCII flow

```text
User + Kayley collaborate on tweet text
  -> Gemini decides user approved it
  -> tool call: post_x_tweet
    -> createDraft(...)
    -> postTweet() or postTweetWithMedia()
    -> updateDraftStatus(..., 'posted')
    -> Kayley says tweet posted
```

### Why this is risky

This is not just "create a draft".
It is actually:
- draft creation
- final post execution
- status update
- success message

all inside one tool call based on LLM interpretation.

That is the direct cause of the false-approval incident.

---

## End-to-End Flow 4: Conversational Draft Approval via `resolve_x_tweet`

This is the second risky path.

### Current live behavior

`resolve_x_tweet` in `src/services/memoryService.ts` does this:

- if `status === 'approved'`
  - load draft by id
  - post it immediately via `postTweet(...)`
  - update row to `posted`
- if `status === 'rejected'`
  - update row to `rejected`

### ASCII flow

```text
Pending draft exists
  -> Gemini sees user says something like "yes" or "post it"
  -> tool call: resolve_x_tweet(id, approved)
    -> getDraftById(id)
    -> postTweet(draft.tweetText)
    -> updateDraftStatus(..., 'posted')
```

### Important conclusion

There are currently **two** LLM-controlled posting paths:

1. `post_x_tweet`
2. `resolve_x_tweet` with `approved`

Any future approval-gate fix must remove or block both if the goal is true mechanical approval.

---

## End-to-End Flow 5: Mention Polling and Replies

This is a separate X pipeline from tweet posting.

### What starts it

`App.tsx` schedules `pollAndProcessMentions()` every 5 minutes.

### Step-by-step

1. `pollAndProcessMentions()` checks `isXConnected()`
2. reads latest mention tweet id from `x_mentions`
3. calls X mentions API for newer mentions
4. classifies mentions using `x_known_users` from `user_facts`
5. stores them in `x_mentions`
6. for known users, auto-generates a draft reply with Gemini
7. updates those mentions to `reply_drafted`
8. prompt section later exposes drafted/pending mentions to Kayley
9. Gemini may call `resolve_x_mention`
10. reply is posted or skipped

### Status progression

Common status path:
- `pending`
- `reply_drafted`
- `replied`

Alternative path:
- `pending`
- `skipped`

### `resolve_x_mention` behavior

Tool statuses:
- `approve` = send the auto-drafted reply
- `reply` = send a custom `reply_text`
- `skip` = do not reply

This mention pipeline is generally cleaner than tweet approval because it has a clear stored-item lifecycle.

---

## End-to-End Flow 6: Metrics Refresh

### What starts it

`App.tsx` schedules `refreshRecentTweetMetrics()` every 30 minutes.

### Step-by-step

1. find `x_tweet_drafts` rows where:
   - `status = 'posted'`
   - `tweet_id is not null`
   - `posted_at` is within the last 7 days
2. call X API for each tweet's public metrics
3. update:
   - `like_count`
   - `repost_count`
   - `reply_count`
   - `impression_count`
   - `metrics_updated_at`

### Why this matters

This allows Kayley or future features to reference how tweets are performing.

---

## Current Prompt Wiring

X behavior is also shaped by prompt sections, not just code.

Main prompt file:
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`

Current X prompt rules say things like:
- use `post_x_tweet` for approved tweet posting
- use `resolve_x_tweet` for approval/rejection of drafts
- use `resolve_x_mention` for mention replies

This means that prompt changes can materially change X behavior even when the service code is untouched.

Rule of thumb:
- if X behavior changes, inspect both code and prompt docs
- many X bugs are partly prompt bugs and partly orchestration bugs

---

## Current Settings UI Behavior

`SettingsPanel.tsx` exposes two X controls:

1. **Connect / Disconnect X account**
2. **Auto-post toggle**

The toggle writes the posting mode into `user_facts`.

Mental model:
- `autonomous` = idle tweets may post without later approval
- non-autonomous = tweets should wait for approval

Important nuance:
- this toggle mainly affects the idle posting path today
- chat-triggered `post_x_tweet` still posts immediately because the tool handler does not honor a mechanical approval gate yet

---

## Current Known Risks and Bugs

## 1. Conversational approval is not mechanical

This is the biggest current risk.

Problem:
- the LLM decides whether the user approved posting
- irreversible external action depends on natural-language interpretation

Affected paths:
- `post_x_tweet`
- `resolve_x_tweet`

Related spec:
- `server/agent/opey-dev/features/tweet-approval-card.md`

## 2. Browser/service boundary is blurry

Problem:
- `xTwitterService.ts` is used as if it were a universal X service
- but it is implemented around browser assumptions and `/api/x/...` proxy calls

Why it matters:
- future server routes for safe posting need a real server-safe X service, or a careful extraction

## 3. The old X doc drifted from the code

The earlier version of this doc described a cleaner planned system than the one actually running.
That is why this rewrite exists.

## 4. Prompt-driven behavior can bypass product intent

Even if the DB and services look fine, prompt rules can still tell Gemini to approve/post drafts conversationally.
Always inspect:
- tool declarations
- prompt instructions
- actual tool handlers

---

## How to Debug X Bugs

When something is wrong, follow this order.

## A. "Why did a tweet post?"

Check:
1. `src/services/memoryService.ts`
   - `post_x_tweet`
   - `resolve_x_tweet`
2. `src/services/system_prompts/tools/toolsAndCapabilities.ts`
3. `x_tweet_drafts` row
   - `status`
   - `generation_context`
   - `reasoning`
   - `posted_at`
4. whether the action came from idle or chat

Key question:
- was this posted by idle/autonomous flow, direct `post_x_tweet`, or `resolve_x_tweet approved`?

## B. "Why was a draft never shown?"

Check:
1. did `createDraft(...)` succeed?
2. what `status` is stored?
3. where is the prompt or UI supposed to surface it?
4. is this idle prompt surfacing or web agent response surfacing?

## C. "Why did selfie tweeting fail?"

Check:
1. `include_selfie`
2. `selfie_scene`
3. `hasXScope('media.write')`
4. `uploadMedia(...)`
5. image generation result
6. whether fallback-to-text-only behavior happened

## D. "Why aren't mentions showing up?"

Check:
1. `isXConnected()`
2. `pollAndProcessMentions()` schedule in `App.tsx`
3. `getLatestMentionTweetId()`
4. rows in `x_mentions`
5. whether the X token still has required scopes

## E. "Why did metrics stop updating?"

Check:
1. `refreshRecentTweetMetrics()` is still being scheduled in `App.tsx`
2. `tweet_id` exists on posted rows
3. `posted_at` is recent enough
4. X API responses for public metrics

---

## Recommended Mental Model for Future Add-ons

If you add a feature, first ask which lane it belongs to:

### Lane 1: Auth / account management
Examples:
- reconnect flow
- scope warnings
- multiple-account support

### Lane 2: Tweet generation
Examples:
- better prompts
- storyline-aware posting
- duplicate prevention
- content moderation

### Lane 3: Posting orchestration
Examples:
- mechanical approval card
- queueing
- scheduling tweets for later
- server-safe posting service

### Lane 4: Mentions and replies
Examples:
- better reply drafting
- trust scoring for unknown users
- mention inbox UI

### Lane 5: Analytics and continuity
Examples:
- engagement summaries
- surfacing best-performing tweets
- tying storyline progress to tweet performance

This separation helps avoid mixing a UI approval bug with a prompt issue or a low-level X API bug.

---

## Safe Extension Points

Good places to extend without rewriting everything:

- `xTweetGenerationService.ts`
  - better tweet prompts
  - smarter dedupe
  - better storyline continuity
- `xMentionService.ts`
  - improved reply policy
  - mention triage logic
- `SettingsPanel.tsx`
  - account status UX
  - posting mode UX
- `xTwitterService.ts`
  - draft query helpers
  - metrics helpers

Areas that need extra care:
- `memoryService.ts` X tool handlers
- anything that moves posting into server routes
- prompt rules that change approval semantics

---

## What the Tweet Approval Card Bug Is Actually Fixing

The approval-card work is not creating X support from scratch.
It is specifically fixing the unsafe part of the chat workflow.

The bug fix should:
- keep `x_tweet_drafts`
- keep the draft concept
- stop `post_x_tweet` from posting immediately
- stop `resolve_x_tweet approved` from acting as a hidden LLM bypass
- make the final post happen only from an explicit human UI action

Reference spec:
- `server/agent/opey-dev/features/tweet-approval-card.md`

---

## Junior Dev Cheat Sheet

If you only remember one thing from this doc, remember this:

```text
Drafts live in x_tweet_drafts.
Mentions live in x_mentions.
Tokens live in x_auth_tokens.

Idle tweets are generated by idleThinkingService + xTweetGenerationService.
Chat tweets are triggered by Gemini tools in memoryService.
Mentions are polled by xMentionService.
Metrics are refreshed on a timer from App.tsx.

The main current risk is that tweet approval is still conversational, not mechanical.
```

---

## File Map

```text
src/
  components/
    SettingsPanel.tsx                 # connect/disconnect X + posting mode toggle
  services/
    xTwitterService.ts                # auth, posting, drafts, mentions, metrics
    xTweetGenerationService.ts        # LLM tweet generation
    xMentionService.ts                # mention polling + reply drafting
    idleThinkingService.ts            # idle x_post + x_mention_poll
    memoryService.ts                  # Gemini tool handlers for tweet/mention actions
    aiSchema.ts                       # Gemini tool declarations
    system_prompts/tools/
      toolsAndCapabilities.ts         # prompt policy for X tools
  App.tsx                             # OAuth callback + polling timers

supabase/migrations/
  20260210_x_tweet_system.sql
  20260211_x_tweet_selfie_columns.sql
  20260211_x_tweet_metrics_columns.sql
  20260211_x_mentions.sql

server/agent/opey-dev/features/
  tweet-approval-card.md              # mechanical gate bug/spec
```

---

## Final Notes

This X system is already fairly capable, but it is not perfectly layered.
That is normal for a fast-moving single-user app.

For future work:
- treat `x_tweet_drafts` as the center of truth for tweets
- treat `x_mentions` as the center of truth for mentions
- treat prompt instructions as part of the behavior, not just documentation
- be very careful with any code path that can cause a real post to happen

If you are debugging or adding features, start by identifying which exact workflow you are in:
- auth
- idle tweet
- chat tweet
- mention reply
- metrics refresh

That one decision usually cuts the search space down fast.
