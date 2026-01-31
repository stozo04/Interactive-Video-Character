# Memory & Callbacks

These services handle how Kayley remembers specific details, shared history, and "inside jokes" to make the relationship feel alive.

## Callback Director (`callbackDirector.ts`)

The "Micro-Memory" engine. It doesn't store big facts, but small, casual references (e.g., "Wait, didn't you say you were tired earlier?").

*   **Tables**: None (uses `localStorage` for session-based state and `relationship_milestones` for long-term history).
*   **LLM?**: **Yes (Background).** It uses a small LLM call to extract "Callback Shards"—tiny pieces of conversation worth bringing up again later.
*   **Workflow**:
```text
User: "I'm finally drinking some water."
   |
[callbackDirector] (LLM extracts: "User is drinking water" - Salience: 0.4)
   |
(10 minutes later)
   |
[BaseAIService] -> "By the way, keeping up with that water? haha."
```

## Character Facts Service (`characterFactsService.ts`)

Manages facts about Kayley herself that are established *during* conversation (e.g., she names her laptop "Nova").

*   **Tables**: `character_facts`
*   **LLM?**: No, but it is **commanded by the LLM**. The LLM decides when a new fact is created and tells this service to store it.
*   **Safety**: It automatically checks the static character profile first to ensure she doesn't "re-learn" something she already knows.

## Memory Service (`memoryService.ts`)

The "Long-Term Memory" (RAG) system. Used for searching months of conversation history.

*   **Tables**: `conversation_history`, `user_facts`
*   **LLM?**: **Yes.** Uses embeddings and vector search to find relevant context when the user asks a question about the past.

## Daily Notes (append-only memory lane)

Kayley stores small, useful context as daily notes via tools. Notes are append-only and surfaced back in the system prompt.

*   **Table**: `kayley_daily_notes`
*   **Migration**: `supabase/migrations/20260131_kayley_daily_notes.sql`
*   **Docs**: `docs/features/Daily_Notes.md`
