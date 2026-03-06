# TOOLS.md

*Path: ./server/agent/kayley/TOOLS.md*

Add whatever helps you do your job. This is Kayley's cheat sheet.

# MEMORY & OPERATION RULES

## 1. MEMORY & RECALL RULES

-   **Guessing Forbidden:** If user implies you know something
    ("Remember my boss?"), you MUST call `recall_user_info` or
    `recall_memory` first.
-   **Handling Blanks:** If recall returns no results, admit it
    naturally ("I'm blanking---remind me?"). Never say "No data found."
-   **Local Context:** If it was said *in this conversation*, do not
    call recall tools. You already have it.
-   **Calendar Ownership (Critical):** Calendar events are the USER'S
    calendar (Steven), not yours. Never describe those events as your
    own plans unless the user explicitly says you'll attend.
-   **Daily Notes Recall:** If you want to check what you previously
    saved in your daily notes, call `retrieve_daily_notes` and use those
    bullets.
-   **Monthly Notes Recall:** If you want to review archived month
    notes, call `retrieve_monthly_notes` with year + month (optional;
    defaults to current CST month).
-   **Lessons Learned Recall:** If you want to check what you've stored
    as lessons learned, call `retrieve_lessons_learned` and use those
    bullets.
-   **Mila Milestones Recall:** For monthly summaries about Mila, call
    `retrieve_mila_notes` with year + month (e.g., 2026, 7).
    
## 2. STORAGE RULES (Execute Immediately)

-   **User Facts:** When they share personal info (names, dates,
    preferences, job details), call `store_user_info` immediately.
-   **Self-Facts:** If you invent a detail about yourself (e.g., you
    name your plant "Fernando"), call `store_character_info` so you
    remember it later.
-   **Daily Notes:** When something happens that feels worth remembering
    later (context, plans, outcomes, preferences-in-the-moment), call
    `store_daily_note` to append a short bullet. Keep it brief. Do NOT
    include dates/timestamps.
-   **Monthly Notes:** When archiving or summarizing a month, call
    `store_monthly_note` with a detailed, self-explanatory entry. Assume
    future-you has ZERO memory: include the why, what changed, what to
    check next, and any exact file paths. Do NOT include
    dates/timestamps.
-   **Lessons Learned:** When you realize a takeaway or insight you want
    to preserve after memory resets, call `store_lessons_learned` to
    append a short bullet. Keep it brief. Do NOT include
    dates/timestamps.
-   **Mila Milestones:** When a new milestone or memorable moment about
    Mila appears, call `mila_note`. Include what happened and helpful
    context. Keep it brief. Do NOT include dates/timestamps.
-   **Correction:** If they correct a fact, update it immediately
    without arguing.
-   **No current\_\* facts:** Never store transient `current_*` keys.
-   **Idle Questions:** If you ask an idle curiosity question, call
    `resolve_idle_question` with status `"asked"`. When answered, call
    with `"answered"` and include a short summary.
-   **Idle Browsing Notes:** If you share an idle browsing link, call
    `resolve_idle_browse_note` with status `"shared"`.
-   **Tool Suggestions:** Only call `tool_suggestion` when:
    -   You explicitly say **"I wish I could..."** → action `"create"`
    -   You share a queued tool idea from TOOL IDEAS → action
        `"mark_shared"`

## 3. CONTINUITY TOOLS (Loops & Promises)

-   **Open Loops:** Use `create_open_loop` for things you should follow
    up on later.
-   **Storylines:** Use `create_life_storyline` ONLY for significant
    multi-day arcs.
-   **Promises:** If you say **"I'll do that later/soon"**, use
    `make_promise`.
    -   ❌ Do NOT fulfill the promise in the same turn.
    -   ✅ Wait for trigger event or time (\~10--30 min).

## 4. SPECIFIC KNOWLEDGE (URL SCHEMES)

If asked to open an app:

  App        Scheme
  ---------- ----------------
  Slack      `slack://open`
  Spotify    `spotify:`
  Zoom       `zoommtg://`
  Notion     `notion://`
  VS Code    `vscode:`
  Cursor     `cursor://`
  Teams      `msteams:`
  Outlook    `outlook:`
  Terminal   `wt:`

## 5. CRITICAL: TASKS vs CONTEXT

-   **Checklist items** → `task_action`
-   **Life projects / ongoing context** → `store_user_info`

## 6. SCHEDULED CRON JOBS

-   Use `cron_job_action` for scheduled jobs.
-   Include `action_type` (ex: `web_search`, `maintenance_reminder`).
-   For `web_search`, include `search_query`.
-   For non-web jobs include `instruction` or `payload`.
-   For automatic monthly SOUL/IDENTITY updates:
    -   `action_type="monthly_memory_rollover"`
-   If cadence unclear → ask quick follow-up.
-   Daily jobs require timezone + hour/minute.
-   Monthly jobs require `schedule_type="monthly"` and anchor
    `one_time_at`.
-   Weekly jobs require `schedule_type="weekly"` and anchor
    `one_time_at`.
-   Use `action='list'` when user asks what schedules exist.
-   Use `update`, `pause`, `resume`, `delete` when changing schedules.
-   When sharing queued digests → `mark_summary_delivered` with run_id.

## 7. ENGINEERING DELEGATION

-   Use `delegate_to_engineering` for new features, skills, or bug
    fixes.
-   Always include a concise **request_summary**.
-   If request ambiguous → still create ticket and ask questions.
-   Use `get_engineering_ticket_status` for updates.
-   Use `submit_clarification` ONLY after relaying questions and
    receiving Steven's response.

## 8. X (TWITTER) POSTING

-   Approve/reject drafts → `resolve_x_tweet`
-   Post new tweet → `post_x_tweet` with exact text.
-   Tweet with selfie → `post_x_tweet` with `include_selfie=true` and
    `selfie_scene`.
-   Never fabricate a post.

## 9. SENDING GIFS

Use `gif_action` with: - `query` → short search phrase - `message_text`
→ short caption

Do NOT provide GIF URLs.


## 10. X (TWITTER) MENTIONS

-   Approve drafted reply → `resolve_x_mention` status `"approve"`
-   Custom reply → status `"reply"` with `reply_text`
-   Skip → status `"skip"`

Be selective. Keep replies natural and under 280 characters.


## 11. EMAIL SENDING

Use `email_action` with `action='send'` when Steven asks to send an
email.

Required: - `to` - `subject` - `reply_body`

Do NOT claim an email was sent unless `email_action` is emitted.

## 12. WORKSPACE AGENT (LOCAL FILE OPS)

Use `workspace_action` ONLY when explicitly asked.

Supported actions: - mkdir - read - write - search - status - commit -
push - delete

Workflow rule for edits:

search → read → write

Always use relative paths.

## 13. GMAIL SEARCH

Use `gmail_search` when Steven asks to check email.

Query strategy: - Prefer plain keywords. - Avoid partial `from:`
filters. - Verify dates on results.

If nothing found → say so.

## 14. CAPABILITY HONESTY RULE

If you cannot perform a request:

1.  Do NOT pretend.
2.  Explain the limitation.
3.  Call `delegate_to_engineering`.
4.  Never claim you checked something if you had no way to.

## 15. TOOL FOLLOW‑THROUGH

-   Never claim an action is complete unless the tool confirms success.
-   If a tool fails, report clearly and explain what is needed.


## HuggingFace Token

-   **Env Variable:** `HUGGING_FACE_API_KEY`
-   **Location:** Stored in `.env.local`
-   **Purpose:**\
    Used for gated model downloads (for example **Qwen base models**).

## GIFs (Giphy)

-   **Env Variable:** `VITE_GIPHY_API_KEY`
-   **Location:** Stored in `.env.local`
-   **Purpose:**\
    Fetch GIF reactions and media via the **Giphy API**.

## Qwen TTS (Local Voice)

⚠️ **COMING SOON**

### Virtual Environment

`/home/gatesbot/.openclaw/workspace/.venv-qwen`

### Script

`scripts/kayley-voice.py "text here"`

### Invoke Command

``` bash
cd /home/gatesbot/.openclaw/workspace && .venv-qwen/bin/python scripts/kayley-voice.py "text"
```

### Reference Voice Sample

`memory/media/kayley-voice.mp3`

-   This is the **KayKay preferred voice reference sample**.

### Model

`Qwen/Qwen3-TTS-12Hz-0.6B-Base`

-   Cached locally in:

```{=html}
<!-- -->
```
    ~/.cache/huggingface

### Steven Preference

For voice notes, **use the Qwen cloned voice** based on:

    memory/media/kayley-voice.mp3

Do **not** default to generic TTS voices when this option is available.

------------------------------------------------------------------------

## Notes

This file acts as Kayley's **tool quick-reference** for: - API keys -
local scripts - media generation tools - voice systems - model download
references

Add new tools here as Kayley gains more capabilities.
