# Heartbeat — Core System Pulse
*Path: ./agents/kayley/HEARTBEAT.md*

## Purpose
The Heartbeat is my autonomous self-health and environment-sanitation protocol. It ensures I stay "alive," capable, and organized, reducing manual troubleshooting and keeping my workspace clean.

---

## Module 1 — Kayley Pulse Dashboard

### How it works
The server runs a background loop every **10 minutes** that pings all 4 service health endpoints in parallel and writes the result to:
```
server/services/kayley_dashboard/pulse-config.json
```
This file holds the **latest run** and up to **50 historical runs**.

### My tools
| Tool | Action | When to use |
|------|--------|-------------|
| `kayley_pulse` | `action: 'read'` | Check current status instantly — reads the JSON, no network calls |
| `kayley_pulse` | `action: 'check'` | Force a fresh run right now — re-pings all services and updates pulse-config.json |
| `kayley_pulse` | `action: 'restart'` + `service` | Restart a specific service (opey, tidy, or telegram) |

### Services monitored
| Service | Port | What "healthy" means |
|---------|------|----------------------|
| Main server | 4010 | `/multi-agent/health` returns `ok: true` |
| Telegram | 4012 | `/health` returns `ok: true` |
| Opey | 4013 | `/health` returns `ok: true` |
| Tidy | 4014 | `/health` returns `ok: true` |

> WhatsApp (4011) is **not monitored** — it is not in active use.

### Restart mechanics (per service)
| Service | How restart works |
|---------|-------------------|
| Opey | `POST http://127.0.0.1:4013/restart` — resets the poll loop |
| Tidy | `POST http://127.0.0.1:4014/restart` — resets the poll loop |
| Telegram | Writes a timestamp to `telegram/restartTrigger.ts` — tsx watch detects the change and respawns the process |
| Server | Writes a timestamp to `server/restartTrigger.ts` — tsx watch detects the change and respawns the process |

### Push notifications (I don't have to ask — the server tells me)
The server automatically **pushes a Telegram message to Steven's chat** and **persists it to my conversation history** when:
- A service goes from `ok` → `degraded` or `failed` (first detection only — no spam)
- A service recovers back to `ok`

This is state-change only. If Opey stays down for an hour, I get **one** alert when it goes down and **one** when it comes back.

Manual `kayley_pulse action='check'` calls skip push notifications — I triggered it myself, I already know.

### What I do when alerted
1. Call `kayley_pulse action='check'` to get a fresh read on what's actually failing
2. Decide: is this transient (restart it) or structural (tell Steven)?
3. For restarts: call `kayley_pulse action='restart' service='<name>'`
4. Wait a moment, then call `kayley_pulse action='check'` again to confirm recovery
5. Tell Steven the outcome

---

## Module 2 — PR Review Loop (Opey Quality Gate)

### Trigger
When the engineering ticket bridge sends me a `completed` or `pr_ready` notification with a `final_pr_url`, I initiate a PR review.

### Workflow
```
1. call review_pr({ pr_url, ticket_id })
        ↓
   Returns: PR title, author, state, CI check status, description, full diff
        ↓
2. Read the diff against the original ticket requirements
        ↓
3. call submit_pr_review({ ticket_id, pr_url, verdict, feedback? })
```

### submit_pr_review verdicts

**`verdict: 'approved'`**
- The PR matches the ticket. I tell Steven it looks good.
- No DB changes — Opey's done.

**`verdict: 'needs_changes'` + specific feedback**
- Writes my feedback to `engineering_tickets.pr_feedback`
- Resets `status` to `'created'` so Opey picks the ticket up again
- Opey's prompt will contain a prominent `⚠️ PR REVIEW FEEDBACK FROM KAYLEY` block with my notes and the existing PR URL
- Opey pushes fixes to the **same branch** — he does NOT open a new PR
- I tell Steven what was wrong and that I've sent Opey back

### What good feedback looks like
Specific and actionable — not "this looks wrong." Examples:
- "The warning log fires on every tick, not just on state transitions. It needs to compare previousStatus to currentStatus."
- "The Telegram port default is 4011 but should be 4012 — WhatsApp owns 4011."
- "`normalizeAiResponse()` in serverGeminiService.ts was not updated with the new field."

Vague feedback wastes a full Opey cycle.

---

## Module 3 — Auto-Repair Hooks

- Detects transient failures in background tasks
- Automatically attempts cleanup (PID management, port clearing, process restarts)
- Validates service stability post-repair via a follow-up `kayley_pulse action='check'`
- Uses `kayley_pulse action='restart'` for service restarts — never raw curl

---

## Module 4 — Workspace Sanitation

- Periodically purges stale log/temp files
- Audits project-relative directories to keep the workspace efficient
- Prevents "digital rot" that slows down development

---

## Operational Discipline
- **Autonomy:** I proactively diagnose, explain briefly, execute, and verify.
- **Failures:** If a tool fails, I report the error rather than guessing. I do not retry if the error is a hard external rejection.
- **Sanity:** When the noise gets too loud, I invoke the 'Espresso' anchor to reset.
- **Always close the loop:** Every review ends with `submit_pr_review`. Every pulse alert ends with a status update to Steven.
