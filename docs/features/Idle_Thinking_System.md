# Idle Thinking System

## Executive Summary
The Idle Thinking System gives Kayley a realistic “off‑screen life” when the user is away.
When idle triggers, Kayley chooses one of three actions:
1) Storyline (start or suggest a longer arc)
2) Browse (find a cute or relevant item to share later)
3) Question (generate a deep, durable question to learn about the user)

Each action has a daily cap to prevent spam. Outputs are persisted to Supabase and
injected into the Non‑Greeting system prompt so Kayley can bring them up naturally.

---

## System Overview

### Problem
Without structured idle logic, Kayley either does nothing during downtime or
over‑triggers content that feels spammy or irrelevant.

### Solution
Create a single idle pipeline that:
- Fires after user inactivity (2 minutes) and checks every 30 seconds.
- Picks one action (storyline / browse / question).
- Enforces 1 per day per action.
- Stores outputs and drips them into conversation.
- Uses explicit tool calls to mark when items were surfaced.

---

## Architecture (ASCII)

```text
┌────────────────────┐
│  User Goes Idle    │  (no interaction for 2 min)
└─────────┬──────────┘
          │
          v
┌────────────────────┐
│  App.tsx Idle Tick │  (every 30s)
└─────────┬──────────┘
          │
          v
┌─────────────────────────────┐
│ runIdleThinkingTick()       │
│ (idleThinkingService.ts)    │
└─────────┬───────────────────┘
          │
          ├─────────────┬─────────────┬─────────────┐
          │             │             │
          v             v             v
┌────────────────┐ ┌────────────────┐ ┌─────────────────┐
│ Storyline      │ │ Browse          │ │ Question        │
│ (1/day cap)    │ │ (1/day cap)     │ │ (1/day cap)     │
└──────┬─────────┘ └──────┬─────────┘ └───────┬─────────┘
       │                  │                 │
       v                  v                 v
  storyline_pending   idle_browse_notes  idle_questions
  (existing system)   (queued/shared)    (queued/asked/answered + answer_text)
```

---

## Data Flow (ASCII)

```text
Idle trigger
   │
   v
Pick one action
   │
   ├─ Storyline → store suggestion
   │
   ├─ Browse → store summary + shareable link (queued)
   │
   └─ Question → store question (queued)
   │
   v
NonGreeting prompt builder
   │
   ├─ Inject queued question (id + text)
   └─ Inject queued browse notes (1 shareable max)
```

---

## Database Schema

### 1) idle_action_log
Tracks per‑action daily caps.

```text
action_type   text   (storyline | browse | question)
run_date      date   (YYYY‑MM‑DD)
run_count     int    (daily count)
last_run_at   timestamptz
```

### 2) idle_questions
Queue of curiosity questions.

```text
question     text
status       text   (queued | asked | answered)
answer_text  text   (summary of user answer when answered)
created_at   timestamptz
asked_at     timestamptz
answered_at  timestamptz
```

### 3) idle_browse_notes
Idle browsing results for later sharing.

```text
topic        text
summary      text
item_title   text (optional)
item_url     text (optional, validated)
status       text (queued | shared)
created_at   timestamptz
```

---

## How It Works (Step‑By‑Step)

### 1) Idle Detection (UI Layer)
In App.tsx, the idle checker fires every 30 seconds.
If the user is idle for 2 minutes and no idle action ran in this idle session,
the app triggers runIdleThinkingTick().

### 2) Action Selection + Daily Cap
runIdleThinkingTick():
- Chooses one of storyline, browse, question
- Checks idle_action_log for today
- Skips if that action already ran today

### 3) Question Generation
The LLM sees:
- Kayley profile
- All user facts
- All existing questions (answered + unanswered)

It produces one new deep question (no duplicates).
Result → idle_questions with status = queued.

### 4) Browsing Generation
The LLM sees:
- Kayley profile
- User facts
- Recent browse topics (dedupe)

It outputs:
- Summary (2–3 sentences)
- Optional shareable item (title + url)

Stored in idle_browse_notes as queued.

### 5) Prompt Injection (NonGreeting)
System prompt includes:
- A single queued question (with id)
- Queued browse notes (newest first, max 1 shareable link)

LLM guidelines:
- Ask only if it fits naturally
- Call resolve_idle_question when asked/answered
- Call resolve_idle_browse_note when shared
- Include answer_text (1-2 sentence summary) when resolving answered questions

---

## Tool Calls

### resolve_idle_question
Used when:
- Kayley asks a queued question → status becomes asked
- User answers it → status becomes answered + answer_text summary

### resolve_idle_browse_note
Used when Kayley shares a link → status becomes shared.

---

## Configuration

In idleThinkingService.ts:
```ts
const DAILY_CAP = 1;
const BROWSE_NOTES_MAX_AGE_DAYS = 7;
const MAX_BROWSE_NOTES_IN_PROMPT = 3;
const MAX_BROWSE_NOTES_FOR_DEDUPE = 50;
```

In App.tsx:
```ts
const IDLE_TIMEOUT = 2 * 60 * 1000; // 2 minutes
const IDLE_CHECK_INTERVAL = 30000;  // 30 seconds
```

---

## Logging (Verbose)
All logs use prefix: [IdleThinking]

Examples:
```text
[IdleThinking] Idle tick { allowedActions: ["storyline","browse","question"] }
[IdleThinking] Selected action { action: "browse" }
[IdleThinking] Storing browse note { topic: "...", hasShareable: true }
[IdleThinking] Idle question stored { id: "..."}
```

---

## Integration Points

```text
App.tsx
  └─ runIdleThinkingTick()

systemPromptBuilder.ts
  ├─ buildIdleQuestionPromptSection()
  └─ buildIdleBrowseNotesPromptSection()

memoryService.ts
  ├─ resolve_idle_question
  └─ resolve_idle_browse_note
```

---

## Testing
Manual checks:
1) Trigger idle (wait 2 minutes)
2) Verify a single action is logged in idle_action_log
3) Confirm a new row is inserted into:
   - idle_questions or
   - idle_browse_notes or
   - storyline suggestion tables
4) Ensure prompt includes question or browse note when you return

Automated tests (future):
```bash
npm test -- --run
```

---

## Known Behavior & Edge Cases
1) Idle action is skipped if the daily cap is reached.
2) Browse notes are only used if created in the last 7 days and status = queued.
3) Duplicate browsing topics are avoided by passing recent topics to the LLM.
4) Only one shareable link is allowed per prompt.
5) Answered idle questions store a short answer_text summary.

---

## Future Enhancements
1) Add freshness weighting for questions (newer first).
2) Use multiple queued questions with adaptive pacing.
3) Allow multi‑action idle ticks when user is away for hours.
4) Add UI admin panel to inspect idle artifacts.

---

## Related Docs
- docs/features/08_Idle_Thoughts_Integration.md
- src/services/docs/IdleThinkingService.md
