# X (Twitter) Refactor — Code Review

**Branch:** `opey-dev/aeec3654-7bf7-4b51-ad74-ef721b6c3ca3`
**Commit:** `ee43991 feat: implement tweet approval card flow`
**Reviewed:** 2026-03-08
**Scope:** 38 files, ~3,355 lines added, ~3,003 lines removed

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Bugs — Must Fix](#bugs--must-fix)
3. [High Priority](#high-priority)
4. [Medium Priority](#medium-priority)
5. [Low Priority / Nits](#low-priority--nits)
6. [Things Done Right](#things-done-right)
7. [Test Coverage Gap](#test-coverage-gap)
8. [File-by-File Index](#file-by-file-index)

---

## Executive Summary

The refactor successfully moves X/Twitter functionality from the browser to the server, adds a mechanical approval gate for tweets, supports edge devices (Telegram/WhatsApp), and implements server-side mention polling. The architecture is sound and the documentation is excellent.

There are **4 real bugs** that need fixing, **~8 high-priority issues** (security, dead code policy violations, convention violations), and **~15 medium/low items** worth addressing. The biggest structural gap is **near-zero test coverage** on the safety-critical approval flow.

---

## Bugs — Must Fix

### BUG-1: TweetApprovalCard crashes on network error (card becomes permanently disabled)
**File:** `src/components/TweetApprovalCard.tsx` ~line 17
**What:** `onResolve` is awaited with no try/catch. If the server is unreachable, the promise rejects, `setIsSubmitting(false)` never runs, and both buttons stay permanently disabled. The user can't approve OR discard.
**Fix:** Wrap in try/catch, reset `isSubmitting` in a finally block, show an error state.

### BUG-2: `storeTokens` falls through on DB read error, creating duplicate token rows
**File:** `server/services/xTwitterServerService.ts` ~line 217-219
**What:** When `selectError` occurs reading existing tokens, the code logs but does NOT return. It falls through to the INSERT path (line 240), potentially creating a duplicate row instead of updating the existing one.
**Fix:** Return early (or throw) when `selectError` is truthy.

### BUG-3: Media upload endpoint is likely wrong (v2 vs v1.1)
**File:** `server/services/xTwitterServerService.ts` ~line 538
**What:** `uploadMedia` uses `${X_API_BASE}/media/upload` which resolves to `api.x.com/2/media/upload`. The X media upload endpoint is actually `https://upload.twitter.com/1.1/media/upload.json` (v1.1). This would cause all media uploads to 404.
**Fix:** Use the correct v1.1 upload endpoint, or verify X has migrated this to v2 (unlikely as of this writing).

### BUG-4: `Buffer` type in browser-side interface
**File:** `src/handlers/messageActions/types.ts` ~line 205
**What:** `stickerBuffer?: Buffer` — `Buffer` is a Node.js type, not available in browsers. Will cause TypeScript errors in strict browser-only compilation.
**Fix:** Use `Uint8Array` or make the type conditional.

---

## High Priority

### HIGH-1: `VITE_X_CLIENT_SECRET` may leak to browser bundle
**File:** `server/services/xTwitterServerService.ts` lines 19-20
**What:** `VITE_X_CLIENT_ID` and `VITE_X_CLIENT_SECRET` use the `VITE_` prefix. Vite bundles ALL `VITE_*` env vars into client-side JavaScript. If these are set in `.env`, the OAuth client secret ships to every browser.
**Fix:** Rename to `X_CLIENT_ID` / `X_CLIENT_SECRET` (no VITE prefix). Access via `process.env` on the server.

### HIGH-2: Massive commented-out dead code in idleThinkingService
**File:** `src/services/idleThinkingService.ts`
**What:** Hundreds of lines of commented-out browse/storyline/question/tool_discovery code. Also: dead parameters (`allowStoryline`, `allowBrowse`, etc.), unused imports (`checkForStorylineSuggestion`, `toolCatalog`, etc.), and unused constants (`DAILY_CAP`, `TOOL_DISCOVERY_DAILY_CAP`, etc.).
**Why it matters:** Violates the project's dead code policy. Every dead line is a lie about what the codebase does.
**Fix:** Delete all commented-out code, unused imports, unused constants, and dead parameters.

### HIGH-3: `xTweetGenerationService` has zero structured logging
**File:** `server/services/xTweetGenerationService.ts`
**What:** Every log statement uses bare `console.warn` / `console.error`. None of these events reach `server_runtime_logs`. This is a `server/` file — it must use `runtimeLogger`.
**Fix:** Import `runtimeLog` from `server/runtimeLogger.ts`, replace all `console.*` calls.

### HIGH-4: Scaffold/TODO comments left in production code
**File:** `src/handlers/messageActions/types.ts`
**What:**
- Line 201: `// --- ADD THESE NEW PROPERTIES ---`
- Line 206: `rawGeneratedStickerBase64?: string; // Add this if you went with Scenario A from earlier!`
These read like AI-generated paste artifacts.
**Fix:** Remove the comments.

### HIGH-5: `xAuthStatus` state is set but never rendered (no user feedback)
**File:** `src/App.tsx` ~line 167
**What:** `xAuthStatus` is set to `'processing'`, `'success'`, `'error'` during OAuth callback, but is never read in any render logic. The user gets zero visual feedback during OAuth flow.
**Fix:** Either render the status (toast, banner, etc.) or remove the dead state.

### HIGH-6: Missing conversation_history persistence for tweet resolution confirmations
**Files:** `server/telegram/telegramHandler.ts` ~lines 548/550, `server/whatsapp/whatsappHandler.ts` ~lines 1393-1397
**What:** When a tweet is approved/rejected via Telegram or WhatsApp, the confirmation message ("Posted it: URL" / "Rejected that draft") is sent to the user but NOT persisted to `conversation_history`. This is the documented gotcha — bridge announcements MUST be persisted or Kayley loses context.
**Fix:** Call `appendConversationHistory` after sending the confirmation.

### HIGH-7: Duplicate `GoogleGenAI` client instantiation
**Files:** `server/services/xMentionService.ts` line 29, `server/services/xTweetGenerationService.ts` line 24
**What:** Both create standalone `new GoogleGenAI(...)` instead of using the shared singleton in `server/services/ai/geminiClient.ts`. Per project convention, there should be one Gemini client.
**Fix:** Import from `geminiClient.ts`.

### HIGH-8: Bare `console.log` / `console.warn` throughout server code
**Files:**
- `server/services/xMentionHeartbeat.ts` lines 104, 123
- `server/telegram/telegramHandler.ts` lines 347, 368, 389, 420, 482, 803
- `server/whatsapp/xMentionBridge.ts` lines 16, 21
- `src/services/memoryService.ts` line 3002
- `src/components/SettingsPanel.tsx` lines 145, 156, 173
**What:** Server code must use `runtimeLogger`, client code must use `clientLogger`. Bare console calls bypass `server_runtime_logs`.
**Fix:** Replace with proper logger calls in each file.

---

## Medium Priority

### MED-1: `approveMentionReply` fetches 50 rows to find one by ID
**Files:** `server/services/xMentionService.ts` ~lines 258-259, `src/services/memoryService.ts` ~lines 3011, 3036
**What:** `getMentions(undefined, 50)` then `.find(item => item.id === id)`. If the mention is older than 50 rows back, it silently won't be found.
**Fix:** Add a `getMentionById(id)` function that does a direct DB query.

### MED-2: Metrics refresh fires even when X is disconnected
**File:** `src/App.tsx` ~lines 408-429
**What:** `refreshRecentTweetMetrics()` runs on a 30-minute interval unconditionally. When X is disconnected, this fires failing HTTP requests forever.
**Fix:** Gate on X connection status, or skip silently when disconnected.

### MED-3: `getTimeOfDay` uses server local time, not CST
**File:** `server/services/xTweetGenerationService.ts` lines 47-54
**What:** `new Date().getHours()` returns server-local hours. If the server is in UTC, "morning" for Steven at 9am CST would be detected as "afternoon" (3pm UTC). `getDayOfWeek` has the same issue.
**Fix:** Use `date-fns-tz` with `America/Chicago` (already a dependency in the project).

### MED-4: `JSON.parse` without try/catch in multiple files
**Files:** `server/services/xMentionService.ts` ~line 140, `server/services/xTweetGenerationService.ts` ~line 258
**What:** If regex matches but JSON is malformed, unhandled exception propagates.
**Fix:** Wrap in try/catch.

### MED-5: `refreshXToken` doesn't validate response shape
**File:** `server/services/xTwitterServerService.ts` ~line 292
**What:** After `response.json()`, `tokens` is passed directly to `storeTokens()` with no check that `access_token`, `refresh_token`, or `expires_in` exist. A malformed response stores garbage.
**Fix:** Validate required fields before storing.

### MED-6: WhatsApp bridge has no shutdown cleanup
**File:** `server/whatsapp/xMentionBridge.ts`
**What:** The `setInterval` handle is created inside `setTimeout` and never captured. On server shutdown, the interval keeps running. The heartbeat (`xMentionHeartbeat.ts`) properly returns `{ stop }` and is wired into shutdown — the bridge should match.
**Fix:** Return a `stop` function and wire it into WhatsApp shutdown.

### MED-7: Both TweetApprovalCard buttons show loading state simultaneously
**File:** `src/components/TweetApprovalCard.tsx` ~lines 57, 65
**What:** Both buttons show "Posting..." or "Working..." when `isSubmitting` is true, regardless of which was clicked. Confusing UX.
**Fix:** Track which action was clicked and only show loading on that button.

### MED-8: Double-fetch of auth status in SettingsPanel
**File:** `src/components/SettingsPanel.tsx` ~lines 59-72
**What:** `checkXConnection` calls `isXConnected()` then `hasXScope('media.write')` — each makes a separate HTTP call to the same `/auth/status` endpoint.
**Fix:** Fetch once, extract both values.

### MED-9: `storeMentions` count includes no-op upserts
**File:** `server/services/xTwitterServerService.ts` ~lines 1023-1048
**What:** With `ignoreDuplicates: true`, the upsert count includes rows that already existed. The `mentionCount` passed to the heartbeat is inflated.
**Fix:** Compare before/after counts or use a different counting strategy.

### MED-10: No rate limiting on `refreshRecentTweetMetrics`
**File:** `server/services/xTwitterServerService.ts` ~line 912
**What:** Fetches metrics one tweet at a time in a loop. With 20+ recent tweets, this could burst 20 API calls. The X API has a 300 requests/15min rate limit on tweet lookups.
**Fix:** Use the batch `GET /2/tweets?ids=` endpoint (up to 100 IDs per call).

### MED-11: `as any` type escape hatches in determineActionType
**File:** `src/handlers/messageActions/types.ts` ~lines 340-341
**What:** `(response as any).video_action` and `(response as any).gif_action` bypass the type system.
**Fix:** Add these fields to `AIActionResponse` or use a type guard.

---

## Low Priority / Nits

### LOW-1: `inReplyToTweetId` is always null in `fetchMentions`
**File:** `server/services/xTwitterServerService.ts` ~line 974
The `referenced_tweets` expansion is never requested, so this field is always null. Either request the expansion or remove the field.

### LOW-2: `getAuthenticatedUsername` returns `"i"` as fallback
**File:** `server/services/xTwitterServerService.ts` ~line 326
Makes tweet URLs like `https://x.com/i/status/123` — which works (X redirects) but is misleading. Document this.

### LOW-3: In-memory `oauthStateStore` not documented
**File:** `server/services/xTwitterServerService.ts` ~line 29
Server restart loses all pending OAuth states. Worth a comment.

### LOW-4: Hardcoded `max_results: "10"` in `fetchMentions`
**File:** `server/services/xTwitterServerService.ts` ~line 946
Should be a named constant.

### LOW-5: 5MB media limit doesn't clarify it's image-only
**File:** `server/services/xTwitterServerService.ts` ~line 524
X allows 15MB for GIFs, 512MB for video. The constant name should reflect it's image-specific.

### LOW-6: Race condition on `cachedUsername`/`cachedUserId`
**File:** `server/services/xTwitterServerService.ts` ~lines 312-313
Concurrent calls can both see null and make duplicate API calls. Not harmful, just wasteful.

### LOW-7: WhatsApp bridge polls every 10 seconds (aggressive)
**File:** `server/whatsapp/xMentionBridge.ts` line 11
The Telegram heartbeat polls every 5 minutes. The WhatsApp bridge is 30x more frequent for the same purpose. Consider a longer interval.

### LOW-8: `parseMediaUploadResponse` exported but only called internally
**File:** `server/services/xTwitterServerService.ts` ~line 195
If nothing external imports it, drop the export.

### LOW-9: Cross-boundary server imports from client code
**Files:** `src/services/idleThinkingService.ts` ~line 644, `src/services/system_prompts/builders/systemPromptBuilder.ts` ~line 61
Dynamic and static imports from `server/` in `src/` code. Works in dev but is an architectural smell.

### LOW-10: `resolve_x_tweet` tool is dead code
**File:** `src/services/memoryService.ts` ~lines 2941-2949
Not declared in `GeminiMemoryToolDeclarations`, so Gemini can never call it. The case handler blocks it as a safety net. Either add a comment explaining the defensive purpose or remove it per dead code policy.

### LOW-11: No `aria-live` or accessibility roles on TweetApprovalCard
**File:** `src/components/TweetApprovalCard.tsx`
The card appears dynamically but screen readers won't announce it.

### LOW-12: Unused `upcomingEvents` parameter in systemPromptBuilder
**File:** `src/services/system_prompts/builders/systemPromptBuilder.ts` ~line 103
`upcomingEvents: any[] = []` is declared but never used. Dead parameter.

### LOW-13: Section numbering skips 15 in toolsAndCapabilities
**File:** `src/services/system_prompts/tools/toolsAndCapabilities.ts`
Sections go: ...14, 16, 17... Minor but could confuse the LLM.

### LOW-14: Stale "out of scope" in tweet-approval-card.md
**File:** `server/agent/opey-dev/features/tweet-approval-card.md` ~line 424
"Always-on server-side mention polling" listed as out of scope, but this branch implements it.

### LOW-15: Mojibake characters in X_Tweet_Posting_System.md
**File:** `documents/features/X_Tweet_Posting_System.md` lines 341, 547
Garbled unicode replacement characters instead of proper quotes.

---

## Things Done Right

1. **Tweet approval gate is mechanically enforced** — `post_x_tweet` creates a draft, not a live tweet. Approval is explicit and channel-aware (card for web, text commands for Telegram/WhatsApp). This is the right architecture.

2. **WhatsApp mention bridge uses queue-based delivery** — correctly handles the separate-process constraint by polling DB instead of in-process callbacks.

3. **`agentClient.resolveTweetDraft` has defensive JSON parsing** — `.catch(() => ({ success: false, error: 'Invalid server response.' }))` is exactly right.

4. **`xMentionHeartbeat` properly wired into shutdown** — `stop()` called during graceful shutdown, unlike many intervals in the codebase.

5. **Orchestrator draft loading is correctly timed** — runs after AI call completes, so drafts created during the turn are already in DB.

6. **Deleted files are fully clean** — no orphaned imports to `xTwitterService.ts`, `xAuthTestHelper.ts`, or the old client-side mention service.

7. **Documentation is excellent** — `X_Tweet_Posting_System.md` is thorough, junior-friendly, and accurately reflects the new architecture. The debugging guide is particularly useful.

8. **WhatsApp integration doc deletion was correct** — it described an architecture (Meta Cloud API, Edge Functions) that was never built. Keeping it would mislead.

9. **Migration is clean and targeted** — partial index for WhatsApp queue is well-designed.

10. **`post_x_tweet` validation is thorough** — empty text, character limit, selfie scene requirement all checked.

---

## Test Coverage Gap

This is the single biggest concern. The entire test file has **2 test cases** covering **1 leaf utility function** (`parseMediaUploadResponse`). For a refactor whose core purpose is safety (preventing accidental tweet posting), the critical paths have zero coverage:

- Tweet draft creation flow (`post_x_tweet` tool handler)
- Tweet approval/rejection (`resolve_x_tweet` route + `resolveTweetDraft`)
- Approval phrase parsing for Telegram/WhatsApp (`parseTweetApprovalAction`)
- Mention polling, storage, and announcement queueing
- WhatsApp bridge queue polling
- Pending draft surfacing in the orchestrator
- `formatTweetApprovalPrompt`

Not blocking the merge if you've manually tested, but worth building out over time — especially around the approval gate.

---

## File-by-File Index

| File | Findings |
|------|----------|
| `server/services/xTwitterServerService.ts` | BUG-2, BUG-3, HIGH-1, MED-5, MED-9, MED-10, LOW-1 thru LOW-8 |
| `server/services/xMentionService.ts` | HIGH-7, MED-1, MED-4 |
| `server/services/xMentionHeartbeat.ts` | HIGH-8 |
| `server/services/xTweetGenerationService.ts` | HIGH-3, HIGH-7, MED-3, MED-4 |
| `server/whatsapp/xMentionBridge.ts` | HIGH-8, MED-6, LOW-7 |
| `server/routes/agentRoutes.ts` | (clean) |
| `server/telegram/telegramHandler.ts` | HIGH-6, HIGH-8 |
| `server/whatsapp/whatsappHandler.ts` | HIGH-6 |
| `server/index.ts` | (clean) |
| `src/App.tsx` | HIGH-5, MED-2 |
| `src/components/TweetApprovalCard.tsx` | BUG-1, MED-7, LOW-11 |
| `src/components/ChatPanel.tsx` | (minor nits only) |
| `src/components/SettingsPanel.tsx` | HIGH-8, MED-8 |
| `src/services/xClient.ts` | (clean) |
| `src/services/agentClient.ts` | (clean) |
| `src/services/aiSchema.ts` | (clean) |
| `src/services/memoryService.ts` | HIGH-8, MED-1, LOW-10 |
| `src/services/messageOrchestrator.ts` | (clean) |
| `src/services/idleThinkingService.ts` | HIGH-2 |
| `src/handlers/messageActions/types.ts` | BUG-4, HIGH-4, MED-11 |
| `src/services/system_prompts/builders/systemPromptBuilder.ts` | LOW-9, LOW-12 |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | LOW-13 |
| `supabase/migrations/20260308_x_mention_delivery_queue.sql` | (clean) |
| `src/services/__tests__/xTwitterService.test.ts` | See Test Coverage section |
| `documents/features/X_Tweet_Posting_System.md` | LOW-15 |
| `server/agent/opey-dev/features/tweet-approval-card.md` | LOW-14 |
