# Proactive Systems

These services manage how Kayley takes initiative without the user prompting her.

## Calendar Check-in Service (`calendarCheckinService.ts`)

Manages smart, time-aware reminders for your Google Calendar events.

*   **Logic**:
    *   **Day Before**: "You have that presentation tomorrow, right?"
    *   **Approaching**: "Heads up, your meeting is in 2 hours."
    *   **Post-Event**: "How did the meeting go?"
*   **Tables**: None (stored in `localStorage` to track which check-ins have already fired).
*   **LLM?**: No. It uses simple time logic to decide which **System Prompt Injection** to use. The LLM then uses those instructions to craft the actual message.

## Loop Cleanup Service (`loopCleanupService.ts`)

The "Janitor" for Kayley's mind. Prevents her from getting obsessed with old topics.

*   **Responsibilities**:
    *   **Expiration**: Deletes "Open Loops" (topics) that are older than 7 days.
    *   **Deduplication**: If you mention "gym" twice, it merges them so she doesn't ask you twice.
    *   **Capping**: Ensures she only tracks a maximum of 10-15 things at once to keep her "brain" fast.
*   **Tables**: `character_actions`
*   **LLM?**: No. It's pure database maintenance logic.

## Presence Director (`presenceDirector.ts`)

(Documented in detail in its own file). It's the "Brain" that decides which of these proactive events (loops, news, or calendar) is the most important to talk about *right now*.
