# Service Documentation Hub

This folder contains detailed explanations of the services that power Kayley's brain, memory, and personality.

## The Architecture Map

The system follows a "Perception -> processing -> Action" pipeline:

1.  **Perception**: `intentService.ts` analyzes what the user said (Tone, Intent, Genuine Moments).
2.  **State Processing**:
    *   **The Soul**: `moodKnobs.ts` & `relationshipService.ts` update her internal vibe.
    *   **The Memory**: `memoryService.ts` & `presenceDirector.ts` store facts and topics.
    *   **The Background**: `messageAnalyzer.ts` orchestrates all of the above silently.
3.  **Action**: `BaseAIService.ts` gathers all this context and generates the final response.

## Detailed Service Docs

### 🧠 The Brain & Logic
*   [AI Services / Providers](./AI_Services.md): Multi-model support (Gemini, ChatGPT) and JSON schemas.
*   [Intent Service](./IntentService.md): Front-line semantic analysis (Tone, Sarcasm).
*   [Message Analyzer](./MessageAnalyzer.md): Background processing and "magic" systems integration.
*   [State Service](./StateService.md): Central database interaction layers (Supabase).
*   [Performance & Assets](./Performance_and_Assets.md): Caching, pre-fetching, and high-performance video delivery.

### ❤️ Personality & The Soul
*   [Mood Knobs](./MoodKnobs.md): Energy, social battery, and emotional momentum math.
*   [Relationship Service](./RelationshipService.md): Trust, warmth, and long-term bond progression.
*   [Ongoing Threads](./OngoingThreads.md): Her internal "mental weather" and hobby projects.
*   [User Patterns](./UserPatterns.md): Cross-session behavioral trend detection.
*   [Soul & Utility](./Soul_and_Utility.md): Broad overview of secondary utility services.

### 📅 Proactive & Memory
*   [Presence Director](./PresenceDirector.md): Decides what's most important to mention *now*.
*   [Memory & Callbacks](./Memory_and_Callbacks.md): Long-term RAG memory and session "inside jokes".
*   [Kayley Presence](./KayleyPresence.md): Real-time tracking of what she's wearing/doing/feeling.
*   [Proactive Systems](./Proactive_Systems.md): Overview of Calendar and News systems.
*   [Loop Cleanup](./LoopCleanup.md): The "janitor" that keeps her memory from getting cluttered.

### 🎮 Features & Interaction
*   [Interactive Features](./Interactive_Features.md): Whiteboard, games, drawing, and "Almost Moments".

---

## Common Questions

### 1. Which services use an LLM and which don't?
This is the most common point of confusion. A simple rule of thumb:

*   **LLM Services ("Thinking")**: These use `Gemini` or `OpenAI` because they need to understand language.
    *   *Examples*: `intentService`, `BaseAIService`, `messageAnalyzer` (for deep loop detection).
*   **Non-LLM Services ("Data/Logic")**: These use `Typescript` logic and `Supabase` queries. They handle math, data storage, and timing.
    *   *Examples*: `stateService`, `presenceDirector`, `moodKnobs`, `calendarService`.

### 2. Is there overlap between these services?
Yes, by design. Some services are "Managers" and some are "Workers":

*   **Overlap in "Mood"**: `moodKnobs.ts` handles the math of mood levels, while `messageAnalyzer.ts` is what *decides* when to call the math functions.
*   **Overlap in "Intent"**: `intentService.ts` is a specialized fast-pass for intent. You might see similar logic in `messageAnalyzer`, but `intentService` is optimized for **latency** (getting a result in <1s) while `messageAnalyzer` is optimized for **depth**.

### 3. How do the non-LLM services work without an "Action"?
They are "Reactive." They wait for an LLM to tell them what to do.
*   *Example*: The LLM thinks: "The user said they are sad."
*   *The Action*: The LLM calls the `stateService` (via `moodKnobs`) to lower Kayley's `energy` and updates the DB.
*   *The Result*: The next time Kayley speaks, she sees her "Energy" is low in her prompt and talks more softly.

## ASCII Workflow Overview

```text
[ USER MESSAGE ]
      |
      V
[ intentService ] (LLM: "They are sad!")
      |
      +------------------------------------------+
      | (Background - Non Blocking)               | (Real-time - Blocking)
      V                                          V
[ messageAnalyzer ] (LLM: "Job interview loop") [ BaseAIService ] 
      |                                          |
      V                                          V
[ stateService ] (DB: Update mood/loops)        [ AI Providers ] (LLM: "I'm so sorry...")
      |                                          |
      +------------------------------------------+
      |
      V
[ UI / AUDIO RESPONSE ]
```
