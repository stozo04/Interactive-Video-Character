# BUG-2026-02-25: Network Loss Causes Infinite Error Spam (No Backoff / Circuit Breaker)

**Date:** 2026-02-25
**Severity:** High
**Sources:** `server/agent/opey-dev/main.ts`, `server/agent/opey-dev/ticketStore.ts`, `server/scheduler/cronScheduler.ts`, `server/runtimeLogger.ts`
**Status:** Open

---

## Summary

When the machine loses internet connectivity (e.g., Wi-Fi drop, Windows network adapter sleep, PC hibernate), two polling loops — Opey's 30-second ticket poll and the CronScheduler's 60-second tick — both start throwing `TypeError: fetch failed` on every iteration. There is no backoff, circuit breaker, or graceful degradation. This produced hundreds of errors over several hours in the overnight logs.

Additionally, the `RuntimeLogger` itself attempts to write errors to Supabase. When Supabase is unreachable, each log write also fails, creating a second cascading error per original error event.

---

## Log Evidence

Network failure began at approximately **06:34 UTC (1:34 AM CST)**:

```
[RuntimeLogger] Error {
  severity: 'error',
  message: 'Error fetching next ticket',
  details: { source: 'ticketStore.ts', error: 'TypeError: fetch failed', code: '' },
  occurredAt: '2026-02-25T06:34:57.364Z'
}
[RuntimeLogger] Failed to write log { message: 'TypeError: fetch failed' }
[CronScheduler] Failed to fetch due jobs {
  error: { message: 'TypeError: fetch failed', ... }
}
```

This pattern repeats every ~30 seconds for the duration of the outage. The log file contains over 200 instances of this error pair.

---

## Root Cause

### Issue A — Opey polls Supabase every 30 seconds unconditionally

`server/agent/opey-dev/main.ts` creates an interval at startup:

```ts
const interval = setInterval(() => {
  void processNextTicket(store, manager);
}, POLL_INTERVAL_MS); // 30_000ms
```

`processNextTicket()` calls `store.getNextTicket()`, which issues a Supabase HTTP request. If the network is down, this throws `TypeError: fetch failed`. There is no retry logic, no backoff, no circuit breaker. The error fires on every tick indefinitely.

**Note:** The polling itself is expected behavior — Opey watches for new tickets with `status='created'`. The problem is the lack of resilience when the network is gone.

### Issue B — CronScheduler ticks every 60 seconds unconditionally

`server/scheduler/cronScheduler.ts` calls `this.fetchDueJobs()` (a Supabase query) every 60 seconds:

```ts
private async tick(): Promise<void> {
  const dueJobs = await this.fetchDueJobs(); // throws on network loss
  ...
}
```

Same pattern — no backoff, no circuit breaker.

### Issue C — RuntimeLogger cascades a secondary error per failure

`runtimeLogger.ts` writes every `log.error()` to Supabase. When Supabase is unreachable, the write itself fails:

```ts
const { error } = await client.from(TABLE_NAME).insert(payload);
if (error) {
  console.warn(`${LOG_PREFIX} Failed to write log`, { message: error.message });
}
```

This means every network failure generates **two console entries**: one for the original error and one for the failed log write. Over a multi-hour outage this becomes severe noise.

---

## Impact

- ~200+ error log lines from a single overnight network outage
- Console becomes unusable for diagnosing real errors — everything drowns in retry noise
- Log writes to Supabase also fail, so the errors are not persisted for later review
- No indication in the logs of when connectivity was restored (no "reconnected" event)

---

## Resolution Steps

### Option 1 (Minimal — Recommended): Suppress network-error log level on polling loops

Change the `ticketStore.getNextTicket()` error handling to treat `TypeError: fetch failed` (a transient network error) as a `warning` instead of an `error`, and reduce verbosity:

In `ticketStore.ts`, add a check:
```ts
const isNetworkError = message.includes('fetch failed') || message.includes('ECONNREFUSED');
if (isNetworkError) {
  // Don't spam — emit at most once per N minutes
  return null; // treat as "no ticket available"
}
```

For CronScheduler, silently skip the tick when the network is down rather than logging a full error object.

### Option 2 (Proper): Add exponential backoff + circuit breaker

Both Opey and CronScheduler should implement a circuit breaker pattern:

1. Track consecutive network failures
2. After N consecutive failures, enter a "degraded" state
3. In degraded state, increase poll interval (e.g., 30s → 60s → 120s → 300s cap)
4. On success, reset to normal interval and log "connectivity restored"

### Option 3 (Quick Win): Prevent Windows network adapter sleep

This is likely the root cause of the overnight disconnect. Windows power management can suspend network adapters during idle periods.

**Fix:**
1. Open Device Manager → Network Adapters → Right-click your adapter → Properties
2. Power Management tab → **Uncheck** "Allow the computer to turn off this device to save power"

Or set via PowerShell:
```powershell
Get-NetAdapter | ForEach-Object {
  $settings = Get-NetAdapterPowerManagement -Name $_.Name -ErrorAction SilentlyContinue
  if ($settings) { Set-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket Disabled }
}
```

---

## Recommended Fix Priority

| Fix | Effort | Impact |
|-----|--------|--------|
| Option 3: Disable NIC sleep in Windows | 2 min | Prevents overnight disconnects entirely |
| Option 1: Treat network errors as warnings, skip tick silently | 30 min | Eliminates log spam when it does happen |
| Option 2: Full circuit breaker | 2-4 hours | Correct long-term solution |

**Start with Option 3 first** — it addresses the root cause. Then do Option 1 to make the server resilient to any future network interruption.

---

## Files to Modify

| File | Change |
|------|--------|
| `server/agent/opey-dev/ticketStore.ts` | Distinguish transient network errors; return null instead of calling `log.error()` |
| `server/scheduler/cronScheduler.ts` | Silently skip tick on `TypeError: fetch failed`; optionally add backoff |
| `server/runtimeLogger.ts` | Already handles write failures gracefully with `console.warn` — no change needed, but consider suppressing repeat failures |
| Windows System Settings | Disable NIC power management sleep |
