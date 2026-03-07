# Gmail Search: Time Unit Gotcha (newer_than / older_than)

**Date:** 2026-03-07
**Root cause of:** Kayley announcing 7-day-old emails (Feb 28th) as if they were new

## What Happened

The Gmail poller query was:
```
newer_than:2m in:inbox
```

The intent was "emails from the last 2 minutes." The comment in the code said the same.

**But Gmail search does not support minutes or hours.** The supported time units are:

| Unit | Meaning |
|------|---------|
| `d`  | days    |
| `m`  | months  |
| `y`  | years   |

So `newer_than:2m` means **newer than 2 months**, not 2 minutes. The poller was fetching every email received since early January on every 60-second tick.

The `kayley_email_actions` dedup check (`gmail_message_id` unique constraint) normally absorbs the blast — already-announced emails are skipped. But any gap in that table (server restart after a DB issue, emails arriving before the table existed, etc.) causes the entire 2-month backlog to re-announce.

## Fix

Changed to `newer_than:1d`. Gmail supports days, and the dedup table makes the wide window safe — old emails are filtered by the unique constraint, new ones in the last day are processed normally.

## Rule to Remember

**Never use `m` in a Gmail search time filter expecting minutes.** If you need sub-day precision, use `newer_than:1d` and let the dedup layer do the work. There is no way to express hours or minutes in a Gmail search query.

## Files Changed

- `server/services/gmailPoller.ts` — query changed from `newer_than:2m` → `newer_than:1d`, comments updated
