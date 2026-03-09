# Feature: Tweet Approval Card (Mechanical X Post Gate)

**Status:** Implemented on branch; current-state reference
**Priority:** High
**Estimated scope:** Medium (implemented across server + UI + channel handlers)

---

## Problem

Kayley can currently post to X through the `post_x_tweet` tool. The product intent is approval-required, but the current approval gate is conversational inference: Kayley decides from natural language whether Steven approved the tweet.

That is not safe for irreversible external actions.

Real incident:
- Steven said: "Ohhhhh that is amazing!!!!!"
- Kayley interpreted unrelated enthusiasm as tweet approval
- Kayley posted immediately

**Root cause:** there is no mechanical enforcement. The final post decision is still delegated to LLM judgment.

---

## Goal

Replace conversational inference with a **mechanical human approval gate**. A tweet may only be posted after an explicit human approval action. No LLM approval path may bypass that gate.

Current approval surfaces:
- Web: Tweet Approval Card
- Telegram: approval command / phrase
- WhatsApp: approval command / phrase

---

## Source of Truth Decisions

These decisions are locked for this ticket:

- Canonical table: `x_tweet_drafts`
- Reject/discard behavior: soft reject via `status = 'rejected'`
- Schema source of truth: the existing `x_tweet_drafts` schema already in Supabase
- Draft surfacing: conversation-aware when possible; do not blindly surface an unrelated global draft if the current conversation did not create it

Current schema:

```sql
create table public.x_tweet_drafts (
  id uuid not null default extensions.uuid_generate_v4 (),
  tweet_text text not null,
  status text not null default 'pending_approval'::text,
  intent text null,
  reasoning text null,
  tweet_id text null,
  tweet_url text null,
  generation_context jsonb null,
  rejection_reason text null,
  error_message text null,
  posted_at timestamp with time zone null,
  created_at timestamp with time zone null default now(),
  include_selfie boolean not null default false,
  selfie_scene text null,
  media_id text null,
  like_count integer null default 0,
  repost_count integer null default 0,
  reply_count integer null default 0,
  impression_count integer null default 0,
  metrics_updated_at timestamp with time zone null,
  constraint x_tweet_drafts_pkey primary key (id),
  constraint x_tweet_drafts_status_check check (
    (
      status = any (
        array[
          'pending_approval'::text,
          'queued'::text,
          'posted'::text,
          'rejected'::text,
          'failed'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_x_tweet_drafts_status on public.x_tweet_drafts using btree (status, created_at desc) TABLESPACE pg_default;
create index IF not exists idx_x_tweet_drafts_created on public.x_tweet_drafts using btree (created_at desc) TABLESPACE pg_default;
```

---

## Acceptance Criteria

- [ ] When Kayley calls `post_x_tweet`, no tweet is posted immediately; a row is created in `x_tweet_drafts` with `status = 'pending_approval'`
- [ ] `/agent/message` includes `pendingTweetDraft` when the current conversation has a pending draft
- [ ] The chat UI renders a Tweet Approval Card when `pendingTweetDraft` is present
- [ ] Clicking `Post it` calls `POST /agent/tweet-drafts/:id/resolve` with `{ action: 'post' }` and actually posts the tweet
- [ ] Clicking `Discard` calls the same endpoint with `{ action: 'reject' }` and updates the row to `status = 'rejected'`
- [ ] After resolve, the card disappears
- [ ] Kayley is never told "tweet posted" until the human actually clicks `Post it`
- [ ] No LLM tool path can directly post a pending-approval draft from the web agent conversation flow
- [ ] Only one pending draft is surfaced at a time for the current conversation (oldest first within that conversation)
- [ ] Telegram and WhatsApp can approve or reject the same pending draft without requiring the Web UI
- [ ] If a draft was created in Telegram/WhatsApp and the user later opens Web, Web can still surface one pending draft card

---

## Current Code Reality

This bug is very close to the current implementation, not a greenfield feature.

Before this fix:
- `post_x_tweet` in `src/services/memoryService.ts` already creates a draft in `x_tweet_drafts`
- but then it immediately posts the tweet in the same tool handler
- `resolve_x_tweet` in `src/services/memoryService.ts` can also post a pending draft when Gemini decides the user approved it conversationally

That meant there were **two LLM-controlled posting paths**:
1. direct post inside `post_x_tweet`
2. approval post inside `resolve_x_tweet`

This ticket removed both bypasses from the agent flow.

Current reality:
- `post_x_tweet` now creates a pending draft only
- `resolve_x_tweet` is blocked from direct posting and returns a human-approval-only message
- final posting happens through the server draft resolver, not the LLM tool

---

## Implementation Plan

### Part 1: Keep `x_tweet_drafts` as the canonical draft store

No table rename. No `pending_tweet_drafts` table.

Use the existing columns exactly as they exist today:
- `tweet_text`
- `status`
- `tweet_id`
- `tweet_url`
- `generation_context`
- `rejection_reason`
- `error_message`
- `posted_at`
- `include_selfie`
- `selfie_scene`
- `media_id`

Do not invent new fields such as:
- `resolved_at`
- `posted_tweet_id`
- `discarded`

If new metadata is needed for conversation-aware surfacing, store it inside `generation_context` unless a later migration is explicitly approved.

---

### Part 2: Change `post_x_tweet` to draft-only behavior

Current behavior:
- creates a draft
- leaves it pending approval

Implemented behavior:
- creates a row in `x_tweet_drafts`
- leaves it in `status = 'pending_approval'`
- returns a message like: `Draft created - waiting for Steven's approval.`

Required code changes:
- `src/services/memoryService.ts` -> `case 'post_x_tweet'`
- `server/services/xTwitterServerService.ts`

Draft creation requirements:
- continue storing `include_selfie` and `selfie_scene`
- write `generation_context` with enough data to reconnect the draft to the current conversation
- recommended fields in `generation_context`:
  - `source: 'agent_message'`
  - `conversationScopeId`
  - `conversationLogId` if available
  - `createdFrom: 'post_x_tweet'`

Implemented rule:
- `post_x_tweet` does not call the final X posting function

---

### Part 3: Remove the LLM approval bypass for agent chat

This is required for a true mechanical gate.

Problem:
- `resolve_x_tweet` currently lets Gemini post a pending draft after interpreting conversational approval
- that still bypasses the UI card, even if `post_x_tweet` becomes draft-only

Implemented behavior:
- human approval happens through the server draft resolver
- Web uses `POST /agent/tweet-drafts/:id/resolve`
- Telegram/WhatsApp use mechanical approval phrases that resolve through the same server-side draft resolver
- Gemini cannot post a pending draft by calling `resolve_x_tweet`

Implemented option:
- keep the tool declared, but block direct approval posting in the tool handler and force human approval

Prompt updates required:
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
- any prompt/doc text telling Kayley to approve a tweet conversationally

Current rule:
- Kayley may say the draft is waiting for approval
- Kayley may not claim it is posted until the human actually approves it

---

### Part 4: Surface the pending draft in `/agent/message`

The UI needs a typed payload to render the approval card.

Key files:
- `src/handlers/messageActions/types.ts`
- `src/services/messageOrchestrator.ts`
- `server/routes/agentRoutes.ts`
- `src/services/agentClient.ts`

Changes:
1. Add a field such as:

```ts
pendingTweetDraft?: {
  id: string;
  tweetText: string;
  includeSelfie: boolean;
  selfieScene?: string | null;
};
```

2. Attach it to `OrchestratorResult`
3. Propagate it through `/agent/message`
4. Add it to the browser response type in `src/services/agentClient.ts`

Conversation-aware surfacing:
- store a channel-scoped `conversationScopeId` with the draft when it is created
- query only drafts where:
  - `status = 'pending_approval'`
  - `generation_context->>'conversationScopeId'` matches the current channel conversation scope
- order by `created_at asc`
- return the oldest pending draft for that session only

Current implemented fallback:
- Web first tries the exact `conversationScopeId`
- if there is no Web-scoped pending draft, Web falls back to the oldest pending draft globally
- this is intentionally pragmatic so a Telegram/WhatsApp-created draft can still appear when the user switches to the App view

Implementation implication:
- `ToolExecutionContext` needs a `conversationScopeId`
- the server agent path must pass that through to the tool execution layer

---

### Part 5: Add resolve endpoint `POST /agent/tweet-drafts/:id/resolve`

New route:

```text
POST /agent/tweet-drafts/:id/resolve
Body: { action: 'post' | 'reject' }
```

Logic:
- fetch the draft by `id`
- verify `status === 'pending_approval'`
- for `action === 'post'`:
  - call the actual X posting function
  - if `include_selfie` is true, generate/upload/post-with-media using the stored `selfie_scene`
  - update row:
    - `status = 'posted'`
    - `tweet_id = <posted tweet id>`
    - `tweet_url = <posted tweet url>`
    - `posted_at = NOW()`
    - `media_id = <media id>` if applicable
- for `action === 'reject'`:
  - update row:
    - `status = 'rejected'`
    - `rejection_reason = 'Rejected from Tweet Approval Card'` (or a more specific user-facing reason)
- return `{ success: true }` plus posted metadata when relevant

Important schema alignment:
- use `tweet_id`, not `posted_tweet_id`
- use `posted_at`, not `resolved_at`
- use `status = 'rejected'`, not `discarded`

Current implementation note:
- Telegram/WhatsApp approvals ultimately resolve through the same draft resolution backend, even though the transport is different from the Web button click

---

### Part 6: Make the posting logic server-safe

Original implementation risk:
- the old posting helpers lived in `src/services/xTwitterService.ts`
- that module was browser-oriented and used client-side assumptions (`import.meta.env`, `/api/x/...` proxy usage, browser storage patterns elsewhere in the file)
- it could not be dropped into a server route unchanged

Observed concrete failure:
- a failed draft already recorded this server-incompatible path with:
  - `error_message = "Failed to parse URL from /api/x/2/tweets"`
- this matches the current implementation in `src/services/xTwitterService.ts`, where posting uses `fetch("/api/x/2/tweets", ...)`
- if the new resolve endpoint naively reuses that browser helper on the server, it will reproduce the same class of failure

Implemented outcome:
- the resolve endpoint calls a server-safe X posting path in `server/services/xTwitterServerService.ts`

Implemented result:
- server-owned X functionality now lives under `server/services/*`
- browser X calls go through `src/services/xClient.ts`

---

### Part 7: UI - Tweet Approval Card component

New component:
- `src/components/TweetApprovalCard.tsx`

Render rule:
- render when `pendingTweetDraft` exists in the latest orchestrator result
- place it below the most recent Kayley message in the chat region

Suggested data shown:
- tweet text
- optional selfie badge / note if image attachment is queued
- small X-branded preview styling

Buttons:
- `Post it` -> `POST /agent/tweet-drafts/:id/resolve` with `{ action: 'post' }`
- `Discard` -> same endpoint with `{ action: 'reject' }`

Behavior:
- loading state while request is in flight
- on success: remove the card locally
- on failure: show inline error and leave buttons usable for retry

Key files:
- `src/App.tsx`
- `src/services/agentClient.ts`
- `src/components/`

Client helper to add:

```ts
resolveTweetDraft(id: string, action: 'post' | 'reject'): Promise<{ success: boolean; tweetUrl?: string }>
```

Cross-channel note:
- the Tweet Approval Card is the Web approval surface
- Telegram/WhatsApp use mechanical reply phrases instead of a visual card

---

## Notify Kayley of Outcome

After the human resolves the draft, Kayley should be informed.

Current approach:
- after the resolve endpoint succeeds, the client sends a follow-up `/agent/message` using the same session id
- message text example:
  - `[System] Tweet draft posted: <id>`
  - `[System] Tweet draft rejected: <id>`

Why this is preferable:
- preserves conversational continuity
- lets Kayley respond naturally
- keeps the UI gate mechanical while the conversational layer stays honest

Hard rule:
- the status update in `x_tweet_drafts` must happen before this follow-up message
- otherwise the card may re-surface incorrectly

---

## Key Files to Read Before Implementation / Debugging

In priority order:

1. `src/services/memoryService.ts`
   - current `post_x_tweet` and `resolve_x_tweet` behavior
2. `server/services/xTwitterServerService.ts`
   - current draft CRUD, posting helpers, and approval phrase parsing
3. `src/handlers/messageActions/types.ts`
   - `OrchestratorResult`
4. `src/services/messageOrchestrator.ts`
   - where to attach `pendingTweetDraft`
5. `server/routes/agentRoutes.ts`
   - `/agent/message` response shape and new resolve route
6. `src/services/agentClient.ts`
   - browser-side transport/types
7. `src/App.tsx`
   - where to render the approval card
8. `src/services/aiSchema.ts`
   - `post_x_tweet` / `resolve_x_tweet` declarations
9. `src/services/system_prompts/tools/toolsAndCapabilities.ts`
   - cross-channel approval guidance
10. `server/telegram/telegramHandler.ts`
    - Telegram approval handling
11. `server/whatsapp/whatsappHandler.ts`
    - WhatsApp approval handling

---

## Constraints

- Do not rename `x_tweet_drafts`
- Do not reintroduce client-side direct posting logic
- Do not allow any bypass path; every approval-required tweet must go through explicit human approval
- Do not use `console.log()` in new code; use `log` on server and `clientLogger` on client
- Surface only one pending draft at a time
- The card must disappear after resolve
- Kayley must never say a tweet is live before the human actually approves it

---

## Out of Scope

- Editing tweet content before posting
- Scheduling tweets for later
- Multi-draft queue UI
- Undo after posting
- Always-on server-side mention polling

---

## Notes

This feature exists because irreversible posting to X cannot depend on vague conversational approval. The LLM may still draft and explain. The human must be the only entity that can authorize the final post.

Current tradeoff worth remembering:
- Web falls back to the oldest pending draft so a Telegram/WhatsApp-created draft can still appear in the App
- that is useful, but it is not a full multi-draft approval inbox
