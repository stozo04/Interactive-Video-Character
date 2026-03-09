# Calendar Heartbeat + On-Demand Lookup (2026-03-06)

## What Changed

### Calendar Heartbeat (`server/services/calendarHeartbeat.ts`)
- Server-side `setInterval` every 15 minutes, time-gated 8am-7pm CST
- Checks Google Calendar for events starting in next ~20 min (upcoming alerts) and events ended in last ~20 min (follow-up check-ins)
- Generates contextual messages via Gemini (tone-matched: playful for restaurants, supportive for medical, etc.)
- Follow-ups use SKIP logic: Gemini decides if the event warrants a check-in (skips trivial events like reminders/standups)
- Delivers to Telegram + WhatsApp; persists to `conversation_history` so Kayley remembers what she announced
- Dedup via in-memory Set keyed on `eventId:type`, resets daily
- Uses `getValidGoogleToken()` from `googleTokenService.ts` — no browser required
- Wired into `server/index.ts` startup/shutdown lifecycle

### Calendar Events Removed from System Prompt
- `buildGoogleCalendarEventsPrompt()` deleted from `systemPromptBuilder.ts`
- Per-message calendar context injection removed from `messageOrchestrator.ts`
- `detectCalendarQuery()`, `formatEventsForContext()`, keyword arrays — all dead code, all deleted
- **Why:** Every user message triggered a Calendar API call from the browser. Back-to-back messages caused excessive API usage. Now calendar data is fetched only on-demand via the tool or proactively via the heartbeat.

### `calendar_action` with `action='list'` Enhanced
- Added `location` field to output
- Server token is now PRIMARY (via `getValidGoogleToken()`), browser token is fallback
- Prompt guidance in `toolsAndCapabilities.ts` tells Kayley to use `calendar_action` with `action='list'` and `days=1/2/7`

### `CalendarEvent` Interface Fixed
- Added `location?: string` to `CalendarEvent` in `calendarService.ts` — Google Calendar API returns this field but it was never typed
- Location now surfaces in all formatting: orchestrator, system prompt, check-in prompts

## Key Decisions

- **No new `check_calendar` tool.** `calendar_action` with `action='list'` already existed and did the job. Reusing > creating.
- **Server token > browser token.** The browser token expires when the tab is closed or the user is away. The server token auto-refreshes via `googleTokenService.ts` using the stored refresh token in Supabase. Always prefer it.
- **Heartbeat is NOT an idle action.** Idle actions only fire when the user is NOT messaging. A calendar reminder must fire regardless of activity. That's why it's a standalone `setInterval` in the server, not part of `idleThinkingService.ts`.
- **`calendarCheckinService.ts` still exists** but is outdated/unused. It only ran during active conversations. Could be deleted in a future cleanup.

## Gotchas

- The heartbeat's first tick runs 15 seconds after server start (delay lets Telegram/WhatsApp connect). If they haven't connected yet, delivery silently fails (logged, not fatal).
- `upcomingEvents` param still exists in `buildSystemPromptForNonGreeting()` with default `= []`. It's unused but harmless — removing it would require updating all callers across 18+ files.
- The `20-minute` window (not 15) intentionally overlaps to account for interval drift. Events won't double-alert due to the dedup Set.

## Prompt Guidance Added
- `toolsAndCapabilities.ts`: "Calendar Lookups" rule tells Kayley to call `calendar_action` with `action='list'`
- "Calendar Location Lookups" rule: when no location on event, recall user address from `user_facts`, then `web_search` nearby
