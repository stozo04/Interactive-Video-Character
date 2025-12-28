# State Service

The `stateService.ts` is the central hub for all persistent data in the application. It abstracts all interactions with Supabase, replacing what used to be stored in the browser's `localStorage`.

## Tables Interaction

This service interacts with the following Supabase tables:

| Table Name | Description |
|------------|-------------|
| `mood_states` | Stores Kayley's current mood levels (energy, social battery, seed). |
| `emotional_momentum` | Tracks recent interaction tones and streaks to determine emotional swings. |
| `ongoing_threads` | Stores "mental threads" or active topics Kayley is thinking about. |
| `intimacy_states` | Tracks the level of vulnerability and quality of interactions. |

## Major Functions

- `getMoodState(userId)`: Fetches the current mood levels.
- `saveMoodState(userId, state)`: Persists mood updates.
- `getFullCharacterContext(userId)`: **Optimization.** Fetches mood, momentum, threads, and intimacy in a single database call to reduce latency.
- `warmContextCache(userId)`: Pre-fetches state data into a memory cache for instant access during response generation.

## Workflow Interaction

```text
Service/Component -> [stateService] <-> [Supabase DB]
                          |
                   [Local Cache (1m)]
```

## Does it use an LLM?
**No.** This is a pure data access layer. It handles logic for default values and caching, but doesn't "think."
