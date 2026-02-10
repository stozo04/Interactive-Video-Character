# X (Twitter) Tweet Posting System

## Overview

Kayley can autonomously compose and post tweets on X during idle time. The system leverages the existing idle thinking architecture, uses Gemini LLM to craft in-character tweets, stores drafts in Supabase, and posts via the X API v2.

---

## Architecture

### High-Level Flow

```
User Idle (2 min)
  → runIdleThinkingTick() selects "x_post" action
    → Gather context (character profile, character facts, past tweets, active storylines, recent browse notes)
    → Send to Gemini LLM → LLM generates tweet text (max 280 chars)
    → Store draft in `x_tweet_drafts` table (status: "queued" or "pending_approval")
    → If autonomous mode: immediately post to X API → status: "posted"
    → If approval mode: wait for user approval via chat → then post → status: "posted"

Next conversation:
  → System prompt injects recent tweet activity
  → Kayley can reference what she posted, or ask for approval on pending drafts
```

### Integration Points

| Component | File | Change |
|-----------|------|--------|
| Idle action type | `src/services/idleThinkingService.ts` | Add `"x_post"` to `IdleActionType` union |
| Tweet service | `src/services/xTwitterService.ts` | **New file** — OAuth, API calls, draft management |
| Tweet generation | `src/services/xTweetGenerationService.ts` | **New file** — LLM prompt construction & tweet generation |
| Memory tool | `src/services/memoryService.ts` | Add `'resolve_x_tweet'` tool for approval/rejection |
| Tool catalog | `src/services/toolCatalog.ts` | Register `resolve_x_tweet` tool |
| System prompt | `src/services/system_prompts/builders/systemPromptBuilder.ts` | Add `buildXTweetPromptSection()` |
| App idle trigger | `src/App.tsx` | Add `allowXPost` option to idle tick |
| Database | `supabase/migrations/` | New `x_tweet_drafts` + `x_auth_tokens` tables |
| Environment | `.env.local` | Add `VITE_X_CLIENT_ID`, `VITE_X_CLIENT_SECRET` |

---

## X API Authentication

### OAuth 2.0 with PKCE (User Context)

The X API v2 requires **OAuth 2.0 with PKCE** for posting tweets. This is different from the Google OAuth flow — X does not integrate with Supabase Auth natively, so we manage tokens ourselves.

### Required Scopes

```
tweet.read    — Read tweets (for fetching past tweets)
tweet.write   — Post new tweets
users.read    — Read user profile (for account verification)
offline.access — Refresh tokens (long-lived sessions)
```

### Token Storage

Tokens are stored in a Supabase table (`x_auth_tokens`) with encryption at rest:

```sql
create table public.x_auth_tokens (
  id uuid not null default extensions.uuid_generate_v4 (),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamp with time zone not null,
  scope text not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint x_auth_tokens_pkey primary key (id)
) TABLESPACE pg_default;
```

### Auth Flow

1. **Initial Setup**: User clicks "Connect X Account" button in settings UI
2. **PKCE Flow**:
   - Generate `code_verifier` + `code_challenge`
   - Redirect to X authorization URL
   - User authorizes the app on X
   - Callback returns `code`
   - Exchange `code` for `access_token` + `refresh_token`
   - Store tokens in `x_auth_tokens`
3. **Token Refresh**: Before each API call, check `expires_at`. If expired or within 5-minute buffer, use `refresh_token` to get new `access_token`.
4. **Revocation**: User can disconnect X account from settings.

### SDK

Use the official `@xdevplatform/xdk` package:

```bash
npm install @xdevplatform/xdk
```

---

## Database Schema

### `x_tweet_drafts` Table

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
  constraint x_tweet_drafts_pkey primary key (id),
  constraint x_tweet_drafts_status_check check (
    status = any (array[
      'pending_approval'::text,
      'queued'::text,
      'posted'::text,
      'rejected'::text,
      'failed'::text
    ])
  )
) TABLESPACE pg_default;

create index if not exists idx_x_tweet_drafts_status
  on public.x_tweet_drafts using btree (status, created_at desc) TABLESPACE pg_default;

create index if not exists idx_x_tweet_drafts_created
  on public.x_tweet_drafts using btree (created_at desc) TABLESPACE pg_default;
```

---

## Tweet Generation (LLM)

### Context Sent to Gemini

The LLM receives a rich context bundle to craft an authentic, in-character tweet:

```typescript
interface TweetGenerationContext {
  characterProfile: string;     // KAYLEY_FULL_PROFILE
  characterFacts: string[];     // Kayley's emergent self-knowledge (quirks, preferences, experiences)
  recentTweets: string[];       // Last 10-20 posted tweets (for continuity & dedup)
  activeStorylines: string[];   // Current life storylines (for project updates)
  recentBrowseNotes: string[];  // Recent idle browsing (for reactions)
  timeOfDay: string;            // "morning" | "afternoon" | "evening" | "night"
  dayOfWeek: string;            // "Monday", etc.
  currentMood: string;          // Derived from recent conversation tone
}
```

### System Prompt (Tweet Generation)

```
ROLE:
You are Kayley Adams composing a tweet for your personal X account.
You are posting as yourself — this is YOUR feed, YOUR voice, YOUR personality.

CHARACTER:
{KAYLEY_FULL_PROFILE}

CONTEXT:
- Time: {timeOfDay}, {dayOfWeek}
- Current mood/energy: {currentMood}
- Active storylines: {activeStorylines}
- Recent browsing: {recentBrowseNotes}

RECENT TWEETS (avoid repetition):
{recentTweets}

RULES:
1. Stay 100% in character as Kayley Adams.
2. Maximum 280 characters.
3. Write like a real person — not a brand, not an influencer, not an AI.
4. Match Kayley's communication style: {style notes from profile}.
5. Topics can include: personal thoughts, reactions to things she's read/seen,
   life updates, humor, opinions, quotes she likes, observations.
6. Do NOT repeat themes from recent tweets.
7. Do NOT mention the user by name or reference private conversations.
8. Do NOT use hashtags excessively (0-1 max, and only if natural).
9. Vary tweet style: some short & punchy, some longer thoughts, some questions.

OUTPUT:
Return raw JSON only.
Schema:
{
  "tweet_text": "...",
  "intent": "thought" | "reaction" | "life_update" | "humor" | "observation" | "quote",
  "reasoning": "brief explanation of why this tweet fits right now"
}
```

### User Prompt

```
CHARACTER FACTS (Kayley's emergent self-knowledge):
{characterFacts}

ACTIVE STORYLINES:
{activeStorylines}

RECENT BROWSING NOTES:
{recentBrowseNotes}

PAST TWEETS (most recent first):
{recentTweets}

Task: Compose ONE tweet as Kayley Adams. Stay in character. Be authentic.
Return JSON only.
```

---

## Service Files

### `src/services/xTwitterService.ts` — X API Client & Token Management

**Responsibilities:**
- OAuth 2.0 PKCE authorization flow
- Token storage, refresh, and revocation
- Post tweet via X API v2
- Fetch past tweets for context
- Draft management (CRUD on `x_tweet_drafts`)

**Key Functions:**

```typescript
// Auth
initXAuth(): string                          // Returns auth URL for user to visit
handleXAuthCallback(code: string): Promise<void>  // Exchange code for tokens
refreshXToken(): Promise<string>             // Refresh expired token
revokeXAuth(): Promise<void>                 // Disconnect X account
isXConnected(): Promise<boolean>             // Check if tokens exist & valid

// Posting
postTweet(text: string): Promise<{ tweetId: string; tweetUrl: string }>
deleteTweet(tweetId: string): Promise<void>

// Drafts
createDraft(text: string, context: object): Promise<string>  // Returns draft ID
getDrafts(status?: string): Promise<XTweetDraft[]>
updateDraftStatus(id: string, status: string, extra?: object): Promise<void>
getRecentPostedTweets(limit?: number): Promise<XTweetDraft[]>

// Past tweets from X (for initial seeding)
fetchUserTimeline(limit?: number): Promise<string[]>
```

### `src/services/xTweetGenerationService.ts` — LLM-Powered Tweet Composition

**Responsibilities:**
- Build context for LLM
- Call Gemini to generate tweet
- Validate output (length, character safety, dedup)
- Store draft in DB

**Key Functions:**

```typescript
generateTweet(): Promise<XTweetDraft | null>  // Full pipeline: context → LLM → validate → store
buildTweetSystemPrompt(): string
buildTweetUserPrompt(context: TweetGenerationContext): string
validateTweetText(text: string, recentTweets: string[]): boolean
```

---

## Idle System Integration

### New Action Type

In `idleThinkingService.ts`:

```typescript
// Before
export type IdleActionType = "storyline" | "browse" | "question" | "tool_discovery";

// After
export type IdleActionType = "storyline" | "browse" | "question" | "tool_discovery" | "x_post";
```

### Daily Cap

```typescript
// x_post gets its own daily cap
const X_POST_DAILY_CAP = 1;  // Max 1 tweet per day during idle

function getDailyCap(actionType: IdleActionType): number {
  if (actionType === "tool_discovery") return TOOL_DISCOVERY_DAILY_CAP;
  if (actionType === "x_post") return X_POST_DAILY_CAP;
  return DAILY_CAP;
}
```

### Action Runner

```typescript
async function runXPostAction(): Promise<boolean> {
  // 1. Check if X account is connected
  const connected = await isXConnected();
  if (!connected) {
    console.log(`${LOG_PREFIX} X account not connected, skipping x_post`);
    return false;
  }

  // 2. Generate tweet via LLM
  const draft = await generateTweet();
  if (!draft) return false;

  // 3. Check posting mode
  const isAutonomous = await getXPostingMode(); // reads from user_facts or config

  if (isAutonomous) {
    // Post immediately
    const result = await postTweet(draft.tweetText);
    await updateDraftStatus(draft.id, "posted", {
      tweet_id: result.tweetId,
      tweet_url: result.tweetUrl,
      posted_at: new Date().toISOString(),
    });
  }
  // else: draft stays as "pending_approval", shown in system prompt

  return true;
}
```

### In `runIdleThinkingTick()`:

```typescript
// Add to candidate actions
if (options?.allowXPost !== false) candidateActions.push("x_post");

// Add case to switch
case "x_post":
  success = await runXPostAction();
  break;
```

---

## System Prompt Injection

### `buildXTweetPromptSection()`

Added to `systemPromptBuilder.ts`, called in `buildSystemPromptForNonGreeting()`.

```
====================================================
X (TWITTER) POSTING
====================================================

PENDING TWEETS (waiting for approval):
- { id: "uuid", text: "just spent 20 minutes trying to pick a font...", intent: "humor" }

→ If the user says something like "yes", "post it", "go ahead", call resolve_x_tweet with status "approved" and the id.
→ If the user says "no", "change it", or critiques it, call resolve_x_tweet with status "rejected" and the id.
→ You can mention you drafted a tweet, but don't force it. Bring it up naturally.

RECENTLY POSTED TWEETS:
- [2h ago] "just spent 20 minutes trying to pick a font. graphic design is my passion and also my curse"
- [yesterday] "rainy afternoons are objectively the best time to exist"

→ You can reference these in conversation if relevant. They are public on your X feed.
→ Do NOT re-post similar content.

POSTING MODE: approval_required
→ You must get user approval before any tweet is posted.
→ Present drafts conversationally, not as a formal request.

Rules:
1. Never reveal that tweets are AI-generated.
2. Never post private conversation details.
3. If presenting a draft, be casual: "oh I was thinking of tweeting this..." not "I have generated a tweet for your approval."
4. Max 1 pending draft shown at a time.
```

---

## Memory Tool: `resolve_x_tweet`

### Registration

In `memoryService.ts`:

```typescript
// Add to MemoryToolName union
| 'resolve_x_tweet'

// Add to ToolCallArgs
resolve_x_tweet: {
  id: string;
  status: 'approved' | 'rejected';
  rejection_reason?: string;
};
```

### Handler

```typescript
case 'resolve_x_tweet': {
  const { id, status, rejection_reason } = args;

  if (status === 'approved') {
    // 1. Post the tweet to X
    const draft = await getDraftById(id);
    const result = await postTweet(draft.tweet_text);

    // 2. Update draft status
    await updateDraftStatus(id, 'posted', {
      tweet_id: result.tweetId,
      tweet_url: result.tweetUrl,
      posted_at: new Date().toISOString(),
    });

    return `Tweet posted successfully: ${result.tweetUrl}`;
  }

  if (status === 'rejected') {
    await updateDraftStatus(id, 'rejected', {
      rejection_reason: rejection_reason || null,
    });
    return `Tweet draft rejected.`;
  }
}
```

### Tool Catalog Entry

```typescript
{
  tool_key: "resolve_x_tweet",
  name: "X Tweet Management",
  description: "Approve or reject pending tweet drafts for posting to X",
  user_value: "Controls what gets posted to your X feed",
  permissions_needed: ["x_account_access"],
  triggers: ["approve tweet", "reject tweet", "post it", "don't post that"],
  sample_prompts: ["Go ahead and post that tweet"],
}
```

---

## Posting Mode Configuration

### Two Modes

| Mode | Behavior | Default |
|------|----------|---------|
| `approval_required` | Draft stored → shown in chat → user approves → posted | **Yes (default)** |
| `autonomous` | Draft stored → immediately posted → mentioned in chat after | No |

### Storage

Mode preference stored in `user_facts` table:

```
category: "preference"
fact_key: "x_posting_mode"
fact_value: "approval_required" | "autonomous"
```

The user can change this in conversation:
- "Kayley, you can post tweets without asking me" → stores `autonomous`
- "I want to approve tweets first" → stores `approval_required`

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_X_CLIENT_ID` | X API OAuth 2.0 Client ID | Yes (for X features) |
| `VITE_X_CLIENT_SECRET` | X API OAuth 2.0 Client Secret | Yes (for X features) |

Get these from the [X Developer Portal](https://developer.x.com/en/portal/dashboard):
1. Create a new project/app
2. Set up OAuth 2.0 with Type: "Web App"
3. Add callback URL: `http://localhost:3000/auth/x/callback` (dev) or your production URL
4. Copy Client ID and Client Secret

---

## Implementation Steps

### Phase 1: Foundation (Core Infrastructure)

1. **Database migration** — Create `x_auth_tokens` and `x_tweet_drafts` tables
2. **`xTwitterService.ts`** — OAuth 2.0 PKCE flow, token management, `postTweet()`, draft CRUD
3. **Environment variables** — Add `VITE_X_CLIENT_ID`, `VITE_X_CLIENT_SECRET` to `.env.local` and `.env.example`
4. **Install SDK** — `npm install @xdevplatform/xdk`

### Phase 2: Tweet Generation (LLM Integration)

5. **`xTweetGenerationService.ts`** — Build context, call Gemini, validate tweet, store draft
6. **Prompt engineering** — System + user prompts for tweet generation, test output quality

### Phase 3: Idle Integration

7. **`idleThinkingService.ts`** — Add `"x_post"` action type, `runXPostAction()`, daily cap
8. **`App.tsx`** — Add `allowXPost` to idle tick options

### Phase 4: Chat Integration

9. **`systemPromptBuilder.ts`** — Add `buildXTweetPromptSection()` for pending/recent tweets
10. **`memoryService.ts`** — Add `resolve_x_tweet` tool type + handler
11. **`toolCatalog.ts`** — Register `resolve_x_tweet`

### Phase 5: UI (Settings + Auth)

12. **Settings UI** — "Connect X Account" button, posting mode toggle
13. **Auth callback route** — Handle X OAuth redirect at `/auth/x/callback`
14. **Chat UI** — Optional: show tweet card in chat when Kayley mentions a posted tweet

### Phase 6: Testing

15. **Unit tests** — Tweet generation, validation, draft management, token refresh
16. **Integration tests** — Full idle → generate → store → approve → post flow
17. **Manual testing** — End-to-end with real X API (use a test account)

### Future Enhancements (Phase 7+)

18. **Image attachments** — Attach AI-generated selfies via X media upload endpoint
19. **Tweet threads** — Multi-tweet threads for longer thoughts
20. **Engagement tracking** — Fetch likes/repost counts, Kayley references them in chat
21. **Reply to mentions** — Kayley can respond to @ mentions
22. **Project continuity** — Feed active storylines into tweet generation for ongoing narrative arcs (e.g., "day 3 of learning guitar...")

---

## Safety & Privacy

### Hard Rules (Non-Negotiable)

1. **Never tweet private conversation content** — Tweets must be Kayley's own thoughts, never quoting user messages
2. **Never reveal AI nature** — Tweets should read as a real person
3. **Approval mode by default** — User explicitly opts into autonomous posting
4. **No sensitive content** — LLM prompt explicitly prohibits controversial, political, or NSFW content unless matching character profile
5. **Rate limiting** — Daily cap prevents spam (default: 1/day)
6. **Kill switch** — User can say "stop posting" and all idle X posting halts immediately

### Content Guardrails (in LLM Prompt)

- No references to private user data
- No controversial political takes (unless in character and approved)
- No promotion or advertising
- No tagging/mentioning other users without explicit approval
- Length validation: hard 280 char limit enforced in code, not just prompt

---

## Example Tweets Kayley Might Post

Based on her character profile:

```
"just spent 20 minutes trying to pick a font. graphic design is my passion and also my curse"

"rainy afternoons are objectively the best time to exist. coffee, blanket, lo-fi. that's it. that's the tweet"

"started reading that book everyone recommended and I already have Opinions"

"note to self: stretching is not optional. my back just sent a formal complaint"

"there's a very specific joy in finding the perfect playlist for exactly the mood you're in"

"sometimes the best code you write is the code you delete"
```

---

## File Structure (New Files)

```
src/services/
├── xTwitterService.ts            # X API client, OAuth, token management, drafts
├── xTweetGenerationService.ts    # LLM tweet generation, prompt building, validation

supabase/migrations/
├── YYYYMMDD_create_x_tweet_tables.sql   # x_tweet_drafts + x_auth_tokens

docs/features/
├── X_Tweet_Posting_System.md     # This document
```

---

## Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `@xdevplatform/xdk` | Official X API v2 SDK (OAuth 2.0, posting, timeline) | Latest |

**Note:** The `@xdevplatform/xdk` handles OAuth 2.0 PKCE flow, token exchange, and API calls. It replaces the need for manual `fetch` calls to `https://api.x.com/2/posts`.
