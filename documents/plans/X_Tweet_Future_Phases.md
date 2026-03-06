# X Tweet System — Future Phases

## What's Already Built (Phases 1-4)

| Component | Status | File |
|-----------|--------|------|
| Database (x_auth_tokens, x_tweet_drafts) | Done | `supabase/migrations/20260210_x_tweet_system.sql` |
| X API service (OAuth, posting, drafts) | Done | `src/services/xTwitterService.ts` |
| Tweet generation (LLM pipeline) | Done | `src/services/xTweetGenerationService.ts` |
| Idle integration (x_post action) | Done | `src/services/idleThinkingService.ts` |
| System prompt injection | Done | `src/services/system_prompts/builders/systemPromptBuilder.ts` |
| Memory tool (resolve_x_tweet) | Done | `src/services/memoryService.ts` |
| Tool catalog entry | Done | `src/services/toolCatalog.ts` |
| Vite proxy (/api/x) | Done | `vite.config.ts` |
| Console test helper | Done | `src/services/xAuthTestHelper.ts` |

---

## Phase 5: Settings UI + Auth Callback

### 5A. Auth Callback Route

**Goal:** Automatically handle the X OAuth redirect instead of manual console paste.

**Current state:** OAuth works via `xAuth.start()` / `xAuth.callback()` in the browser console.

**Implementation:**

1. **Add a route check in `App.tsx`** — detect when the URL is `/auth/x/callback`:

```typescript
// In App.tsx, early in the component (before render)
useEffect(() => {
  const url = new URL(window.location.href);
  if (url.pathname === '/auth/x/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (code && state) {
      handleXAuthCallback(code, state)
        .then(() => {
          // Redirect back to main app
          window.history.replaceState({}, '', '/');
          // Show success toast
        })
        .catch((error) => {
          console.error('X OAuth callback failed:', error);
          window.history.replaceState({}, '', '/');
          // Show error toast
        });
    }
  }
}, []);
```

2. **Files to modify:**
   - `src/App.tsx` — Add the `useEffect` above
   - No new files needed

---

### 5B. Settings UI — "Connect X Account"

**Goal:** Button in settings panel to connect/disconnect X account + toggle posting mode.

**Implementation:**

1. **Add X section to SettingsPanel** (`src/components/SettingsPanel.tsx`):

```
┌─────────────────────────────────────┐
│  X (Twitter) Integration            │
│                                     │
│  Status: ✅ Connected as @KayleyRAdams │
│  [Disconnect]                       │
│                                     │
│  Posting Mode:                      │
│  ○ Ask me first (approval required) │
│  ● Post automatically (autonomous)  │
│                                     │
│  Daily Limit: [1] tweet/day         │
└─────────────────────────────────────┘
```

2. **Key functions to call:**
   - `isXConnected()` — check connection status
   - `initXAuth()` — start OAuth flow (returns auth URL, open in new window)
   - `revokeXAuth()` — disconnect
   - Posting mode — read/write `user_facts` table (`category: "preference"`, `fact_key: "x_posting_mode"`)

3. **Files to modify:**
   - `src/components/SettingsPanel.tsx` — Add X integration section

---

### 5C. Tweet Card in Chat UI

**Goal:** When Kayley mentions a posted tweet, show a styled tweet card in the chat.

**Implementation:**

1. **Detect tweet URLs in AI responses** — regex for `https://x.com/.../status/...`
2. **Render a tweet card component** with the tweet text, timestamp, and link
3. **For pending drafts** — show an approve/reject button inline

**Files:**
- `src/components/TweetCard.tsx` — **New file** — Styled tweet preview component
- `src/components/ChatPanel.tsx` — Detect tweet URLs in messages and render TweetCard

---

## Phase 6: Testing

### 6A. Unit Tests

**File:** `src/services/__tests__/xTweetGenerationService.test.ts` (new)

| Test | What to verify |
|------|---------------|
| `buildTweetSystemPrompt()` | Returns non-empty string with character rules |
| `buildTweetUserPrompt()` | Includes character facts, storylines, past tweets |
| `validateTweetText()` | Rejects empty, >280 chars, and duplicates |
| `validateTweetText()` | Accepts valid tweets under 280 chars |
| `generateTweet()` | Returns null when no API key |
| `generateTweet()` | Calls Gemini and returns draft with correct fields |

**File:** `src/services/__tests__/xTwitterService.test.ts` (new)

| Test | What to verify |
|------|---------------|
| `createDraft()` | Inserts into x_tweet_drafts, returns mapped draft |
| `getDrafts()` | Filters by status |
| `updateDraftStatus()` | Updates status and extra fields |
| `getRecentPostedTweets()` | Returns only posted tweets, ordered by posted_at |
| `isXConnected()` | Returns false when no env vars |
| `isXConnected()` | Returns false when no tokens |
| `getValidAccessToken()` | Returns token when not expired |
| `getValidAccessToken()` | Refreshes when within buffer window |

**File:** `src/services/__tests__/idleThinkingService.x_post.test.ts` (new)

| Test | What to verify |
|------|---------------|
| `getDailyCap("x_post")` | Returns 1 |
| `runIdleThinkingTick()` | Includes `x_post` in candidates |
| `runXPostAction()` | Returns false when X not connected |
| `runXPostAction()` | Generates draft in approval mode |
| `runXPostAction()` | Posts immediately in autonomous mode |
| `buildXTweetPromptSection()` | Returns empty when no drafts |
| `buildXTweetPromptSection()` | Includes pending draft text and id |

### 6B. Integration Tests

| Flow | Steps to verify |
|------|----------------|
| Full idle → post | Idle tick selects x_post → generates tweet → stores draft → approve in chat → posted to X |
| Rejection flow | Draft created → user rejects → status set to "rejected" → not posted |
| Daily cap | After 1 tweet posted, x_post action is blocked for the day |
| Token refresh | Expired token auto-refreshes before posting |

---

## Phase 7: Selfie Attachments on Tweets

### Overview

Attach AI-generated selfies to tweets. The selfie system already returns `imageBase64` — we just need the X media upload step.

### X Media Upload Flow

```
1. Generate selfie via imageGenerationService
   → Returns: { imageBase64: string, mimeType: "image/jpeg" }

2. Upload to X media endpoint
   POST https://upload.twitter.com/1.1/media/upload.json
   Content-Type: multipart/form-data
   Body: { media_data: base64_image }
   → Returns: { media_id_string: "12345" }

3. Post tweet with media
   POST https://api.x.com/2/tweets
   Body: { text: "...", media: { media_ids: ["12345"] } }
```

### Important: Media Upload Uses v1.1 API

The X media upload endpoint is **NOT** on the v2 API. It uses the legacy v1.1 endpoint at `upload.twitter.com`. This requires a **separate Vite proxy**:

```typescript
// vite.config.ts — add new proxy
'/api/x-upload': {
  target: 'https://upload.twitter.com',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/x-upload/, ''),
},
```

### Implementation Steps

1. **Add Vite proxy** for `upload.twitter.com`

2. **Add `uploadMedia()` to `xTwitterService.ts`:**

```typescript
export async function uploadMedia(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<string> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("X account not connected");

  const formData = new FormData();
  formData.append("media_data", imageBase64);

  const response = await fetch("/api/x-upload/1.1/media/upload.json", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) throw new Error(`Media upload failed: ${response.status}`);

  const result = await response.json();
  return result.media_id_string;
}
```

3. **Add `postTweetWithMedia()` to `xTwitterService.ts`:**

```typescript
export async function postTweetWithMedia(
  text: string,
  mediaIds: string[]
): Promise<{ tweetId: string; tweetUrl: string }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("X account not connected");

  const response = await fetch("/api/x/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      media: { media_ids: mediaIds },
    }),
  });

  if (!response.ok) throw new Error(`Tweet posting failed: ${response.status}`);

  const result = await response.json();
  const tweetId = result.data.id;
  const username = await getAuthenticatedUsername(accessToken);
  return { tweetId, tweetUrl: `https://x.com/${username}/status/${tweetId}` };
}
```

4. **Update tweet generation to optionally include a selfie:**

```typescript
// In xTweetGenerationService.ts — add to LLM output schema:
{
  "tweet_text": "...",
  "intent": "...",
  "reasoning": "...",
  "include_selfie": true | false,
  "selfie_scene": "cozy home desk with laptop" // only if include_selfie
}
```

5. **Update `runXPostAction()` in idleThinkingService:**

```typescript
if (draft.includeSelfie && draft.selfieScene) {
  const selfie = await generateCompanionSelfie({
    scene: draft.selfieScene,
    mood: draft.intent === "humor" ? "playful" : "casual",
  });
  if (selfie.success && selfie.imageBase64) {
    const mediaId = await uploadMedia(selfie.imageBase64, selfie.mimeType);
    const result = await postTweetWithMedia(draft.tweetText, [mediaId]);
    // ... update draft status
  }
}
```

6. **Database:** Add columns to `x_tweet_drafts`:

```sql
alter table public.x_tweet_drafts
  add column include_selfie boolean not null default false,
  add column selfie_scene text null,
  add column media_id text null;
```

### OAuth Scope

Media upload may require additional OAuth scope: `tweet.write` should cover it, but verify with the X API docs. The `media.write` scope might be needed.

---

## Phase 8: Tweet Threads

### Overview

Allow Kayley to post multi-tweet threads for longer thoughts or stories.

### Implementation

1. **LLM output schema change:**

```typescript
// Single tweet OR thread
{
  "tweets": [
    { "text": "First tweet (1/3)...", "intent": "..." },
    { "text": "Second tweet (2/3)...", "intent": "..." },
    { "text": "Third tweet (3/3)...", "intent": "..." }
  ],
  "is_thread": true,
  "reasoning": "..."
}
```

2. **Thread posting logic** — post tweets sequentially, each replying to the previous:

```typescript
export async function postThread(
  tweets: string[]
): Promise<{ tweetIds: string[]; threadUrl: string }> {
  const tweetIds: string[] = [];

  for (let i = 0; i < tweets.length; i++) {
    const body: Record<string, unknown> = { text: tweets[i] };

    // Reply to previous tweet in thread
    if (i > 0 && tweetIds[i - 1]) {
      body.reply = { in_reply_to_tweet_id: tweetIds[i - 1] };
    }

    const response = await fetch("/api/x/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getValidAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    tweetIds.push(result.data.id);
  }

  const username = await getAuthenticatedUsername(await getValidAccessToken()!);
  return {
    tweetIds,
    threadUrl: `https://x.com/${username}/status/${tweetIds[0]}`,
  };
}
```

3. **Database:** Add `thread_id` column linking related drafts:

```sql
alter table public.x_tweet_drafts
  add column thread_id uuid null,
  add column thread_position integer null;
```

4. **Daily cap:** A thread counts as 1 tweet toward the daily cap.

---

## Phase 9: Engagement Tracking

### Overview

Fetch likes, reposts, and reply counts for Kayley's posted tweets. She can reference them in conversation ("my tweet about packing got 12 likes!").

### Implementation

1. **Add `fetchTweetMetrics()` to `xTwitterService.ts`:**

```typescript
export async function fetchTweetMetrics(tweetId: string): Promise<{
  likes: number;
  reposts: number;
  replies: number;
  impressions: number;
}> {
  const accessToken = await getValidAccessToken();
  const response = await fetch(
    `/api/x/2/tweets/${tweetId}?tweet.fields=public_metrics`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const result = await response.json();
  const metrics = result.data.public_metrics;
  return {
    likes: metrics.like_count,
    reposts: metrics.retweet_count,
    replies: metrics.reply_count,
    impressions: metrics.impression_count,
  };
}
```

2. **Background refresh** — periodically fetch metrics for recent tweets (last 7 days)

3. **Database:** Add metrics columns to `x_tweet_drafts`:

```sql
alter table public.x_tweet_drafts
  add column like_count integer null default 0,
  add column repost_count integer null default 0,
  add column reply_count integer null default 0,
  add column impression_count integer null default 0,
  add column metrics_updated_at timestamp with time zone null;
```

4. **System prompt injection** — include metrics for recent tweets so Kayley can reference them naturally

---

## Phase 10: Reply to Mentions

### Overview

Kayley can detect and respond to @ mentions on X.

### Implementation

1. **Poll for mentions** — periodic check (every 5 min):

```typescript
export async function fetchMentions(sinceId?: string): Promise<Tweet[]> {
  const accessToken = await getValidAccessToken();
  const userId = await getAuthenticatedUserId(accessToken);

  let url = `/api/x/2/users/${userId}/mentions?tweet.fields=created_at,author_id`;
  if (sinceId) url += `&since_id=${sinceId}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return (await response.json()).data || [];
}
```

2. **LLM-generated reply** — send the mention text + Kayley's context to Gemini, get a reply

3. **Post reply:**

```typescript
await fetch("/api/x/2/tweets", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    text: replyText,
    reply: { in_reply_to_tweet_id: mentionTweetId },
  }),
});
```

4. **Database:** New `x_mentions` table:

```sql
create table public.x_mentions (
  id uuid not null default extensions.uuid_generate_v4 (),
  tweet_id text not null unique,
  author_username text not null,
  text text not null,
  replied boolean not null default false,
  reply_tweet_id text null,
  created_at timestamp with time zone null default now(),
  constraint x_mentions_pkey primary key (id)
) TABLESPACE pg_default;
```

5. **Safety:** Only reply to mentions from users Kayley "knows" (whitelist), or require approval for unknown users.

---

## Phase 11: Project Continuity Arcs

### Overview

Feed active storylines into tweet generation for ongoing narrative arcs that span multiple days/weeks ("day 3 of learning guitar...").

### Implementation

This is mostly a **prompt engineering** change — the infrastructure already exists:

1. **Already done:** `xTweetGenerationService.ts` already sends `activeStorylines` to Gemini.

2. **Enhancement — Add tweet history per storyline:**

```typescript
// In TweetGenerationContext, add:
storylineTweetHistory: Record<string, string[]>;
// Maps storyline title → past tweets about that storyline
```

3. **Query:** When gathering context, join `x_tweet_drafts.generation_context` with `life_storylines` to find past tweets that referenced each storyline.

4. **Prompt addition:**

```
STORYLINE CONTINUITY:
For each active storyline, here are tweets you've already posted about it.
Build on these — show progression, don't repeat.

[work] Sony Tour:
  - Day 1: "Currently staring at my suitcase..."
  - Day 3: (you're here — what happened since?)
```

5. **LLM will naturally build on the arc** — e.g., "survived Dallas. next stop: Austin. my suitcase learned nothing."

---

## Priority Order

| Phase | Effort | Impact | Recommendation |
|-------|--------|--------|----------------|
| 5A. Auth callback route | Small | High | Do first — eliminates manual console step |
| 5B. Settings UI | Medium | Medium | Nice to have, console works fine |
| 6. Testing | Medium | High | Do before adding more features |
| 7. Selfie attachments | Medium | High | Big visual impact on the X feed |
| 11. Project continuity | Small | High | Mostly prompt changes, builds on existing infra |
| 8. Tweet threads | Medium | Medium | Nice for longer thoughts |
| 9. Engagement tracking | Medium | Medium | Adds personality depth |
| 10. Reply to mentions | Large | Medium | Most complex, biggest safety surface |
| 5C. Tweet card UI | Small | Low | Polish, not critical |
