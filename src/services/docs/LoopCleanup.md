# Loop Cleanup Service

The `loopCleanupService.ts` is the "Janitor" for Kayley's proactive memory. Without this service, Kayley would slowly become obsessed with old topics, asking you about a gym session from 3 weeks ago on repeat.

## Core Responsibilities

1.  **Age-Based Expiration**: Automatically removes "Open Loops" (topics) that haven't been discussed for several days (default: 7 days).
2.  **Deduplication**: Uses **Fuzzy Matching** (normalization + logic) to find similar topics. 
    *   Example: "Holiday Party" and "holiday parties" are merged so she doesn't ask about them separately.
3.  **Intensity Capping**: Limits the total number of "Open Loops" per user. If the list gets too long (e.g., > 15), it removes the least important ones (lowest salience).
4.  **Scheduler**: Runs cleanup automatically on app initialization and then at regular intervals (e.g., every 30 minutes).

## Tables Interaction

| Table Name | Action | Description |
| :--- | :--- | :--- |
| `character_actions` | Update / Delete | Expires or deletes stale loops. |

## Workflow Interaction

```text
[App Start] -> [loopCleanupService.runScheduledCleanup]
                     |
         +-----------+-----------+
         |                       |
   [Expire Old]            [Deduplicate]
   (> 7 Days)              (Fuzzy Match)
         |                       |
         +-----------+-----------+
                     |
               [Cap Density]
               (Max 15 loops)
```

## Does it use an LLM?
**No.** This service is pure logic and database maintenance. It doesn't need to "understand" the content of the loops, just their metadata (created_at, salience, topic string).

## Why is this important?
AI "hallucinations" and "loops" often happen when the context window is cluttered with irrelevant information. By aggressively cleaning up old topics, we keep Kayley's focus on what is happening **now**.
