# Soul & Relationship Services

These services manage Kayley's personality, her feelings towards the user, and her long-term growth.

## Mood & Emotion (`moodKnobs.ts`)

Handles the numerical side of Kayley's "Soul." It manages concepts like Energy, Social Battery, and Emotional Momentum.

*   **Tables**: `mood_states`, `emotional_momentum`
*   **LLM?**: Minimal. It uses keywords for fast response but relies on `intentService` for deep analysis.

## Relationship Service (`relationshipService.ts`)

Tracks the "vibe" between Kayley and the user. It moves them from "Acquaintance" to "Close Friend" based on sentiment and interaction history.

*   **Tables**: `character_relationships`, `intimacy_states`
*   **LLM?**: No. It's a logic engine that processes sentiment scores.

## Milestone Tracker (`relationshipMilestones.ts`)

Recognizes special moments (e.g., first vulnerability, first shared joke).

*   **Tables**: `relationship_milestones`
*   **LLM?**: **Yes.** It uses an LLM to "spot" a milestone in a message because "vulnerability" is hard to catch with keywords.

## Memory & Facts (`memoryService.ts`, `characterFactsService.ts`)

Stores what Kayley knows about the user and what she knows about herself.

*   **Tables**: `user_facts`, `character_facts`, `conversation_history`
*   **LLM?**: **Yes (MemoryService).** It uses "Vector Search" (semantic search) to recall old conversations when the user says "Do you remember when...?"
*   **ASCII Flow**:
```text
User: "What's my cat's name?"
   |
[memoryService] (LLM Query: "User's cat name")
   |
[Supabase Vector Search] -> Findings: "Whiskers"
   |
[BaseAIService] -> "Oh, you mean Whiskers!"
```

---

# Integration & Utility Services

*   **`imageGenerationService.ts`**: Connects to Flux/DALL-E to generate selfies of Kayley. (Tables: `selfie_generation_history`).
*   **`googleAuth.ts` / `calendarService.ts`**: Handles Google Login and Calendar events. (Tables: `daily_tasks`).
*   **`elevenLabsService.ts`**: Converts text to Kayley's voice.
*   **`newsService.ts`**: Fetches tech news from Hacker News so Kayley can stay updated.
*   **`kayleyPresenceService.ts`**: Tracks if Kayley "is in the room" (Presence) and what she's doing (Idle state). (Tables: `kayley_presence_state`).
