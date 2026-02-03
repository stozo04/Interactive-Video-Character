# Service Documentation Hub

This folder contains detailed explanations of the services that power Kayley's brain, memory, and personality.

## The Architecture Map

The system follows a "Perception -> processing -> Action" pipeline:

1.  **Perception**: The user message is processed to extract context and intent.
2.  **State Processing**:
    *   **The Soul**: `relationshipService.ts` tracks her emotional state and relationship tier.
    *   **The Memory**: `memoryService.ts` & `presenceDirector.ts` store facts and topics.
    *   **The Orchestration**: `messageOrchestrator.ts` coordinates message processing.
3.  **Action**: The AI service gathers all this context and generates the final response.

## Detailed Service Docs

### 🧠 The Brain & Logic
*   [AI Services / Providers](./AI_Services.md): Multi-model support (Gemini, ChatGPT) and JSON schemas.
*   [AI Schema Workflow](./aiSchema_Workflow.md): Response fields vs tools - when to use which mechanism.
*   [Message Orchestrator](./MessageOrchestrator.md): Central coordinator for user message processing.
*   [Performance & Assets](./Performance_and_Assets.md): Caching, pre-fetching, and high-performance video delivery.

### ❤️ Personality & The Soul
*   [Relationship Service](./RelationshipService.md): Trust, warmth, and long-term bond progression.
*   [Life Event Service](./LifeEventService.md): Tracks recent events in Kayley's life for thought context.
*   [Storyline Service](./StorylineService.md): Life events as living storylines with emotional arcs and closure. *(Phase 1 Complete)*
*   [Storyline Creation Service](./StorylineCreationService.md): Conversation-driven storyline creation with safety controls (Phase 1).
*   [User Patterns](./UserPatterns.md): Cross-session behavioral trend detection.

### 📅 Proactive & Memory
*   [Presence Director](./PresenceDirector.md): Decides what's most important to mention *now*.
*   [Memory & Callbacks](./Memory_and_Callbacks.md): Long-term RAG memory and session "inside jokes".
*   [Character Facts Service](./CharacterFactsService.md): Kayley's emergent self-knowledge and memories.
*   [Proactive Systems](./Proactive_Systems.md): Overview of Calendar and News systems.
*   [Loop Cleanup](./LoopCleanup.md): The "janitor" that keeps her memory from getting cluttered.
*   [Promise Service](./promiseService.md): Temporal awareness and future commitment tracking.

### 🎮 Features & Interaction
*   [Interactive Features](./Interactive_Features.md): Whiteboard, games, drawing, and "Almost Moments".

---

## Common Questions

### 1. Which services use an LLM and which don't?
This is the most common point of confusion. A simple rule of thumb:

*   **LLM Services ("Thinking")**: These use `Gemini` or `OpenAI` because they need to understand language or generate content.
    *   *Examples*: `geminiChatService`, `imageGenerationService`, `grokVideoGenerationService`.
*   **Non-LLM Services ("Data/Logic")**: These use `Typescript` logic and `Supabase` queries. They handle math, data storage, and timing.
    *   *Examples*: `presenceDirector`, `calendarService`, `lifeEventService`, `relationshipService`.

### 2. Is there overlap between these services?
Yes, by design. Some services are "Managers" and some are "Workers":

*   **Overlap in "Personality"**: `relationshipService.ts` tracks relationship metrics and warmth, while various prompt builders use this data to shape Kayley's responses.
*   **Overlap in "Memory"**: `memoryService.ts` provides memory tools and context retrieval, while `presenceDirector.ts` decides what's most important to mention.

### 3. How do the non-LLM services work without an "Action"?
They are "Reactive." They wait for an LLM to tell them what to do.
*   *Example*: The LLM generates a response that acknowledges the user's emotion.
*   *The Action*: The system updates relationship metrics and stores context for future interactions.
*   *The Result*: The next time Kayley speaks, she has richer context about the user's emotional state and can respond more thoughtfully.

## Workflow Overview

```text
[ USER MESSAGE ]
      |
      V
[ messageOrchestrator ] (Coordinates processing)
      |
      +----------------------------------+
      |                                  |
      V                                  V
[ Context Fetch ]              [ geminiChatService ] (LLM: Generate response)
(relationship, memory, etc.)          |
      |                               V
      +----> [ AI Response ]
              (text, actions, etc.)
              |
              V
         [ Response Handler ]
         (execute actions, store facts)
              |
              V
        [ UI / AUDIO ]
```
