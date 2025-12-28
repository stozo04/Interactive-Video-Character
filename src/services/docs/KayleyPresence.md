# Kayley Presence Service

The `kayleyPresenceService.ts` and `kayleyPresenceDetector.ts` work together to track what Kayley is doing, wearing, and feeling in "real-time." This system ensures her visual state (selfies, descriptions) stays consistent with what she says in chat.

## Core Responsibilities

1.  **Detection (`kayleyPresenceDetector.ts`)**:
    *   Uses **Gemini Flash** to analyze Kayley's responses.
    *   Identifies mentions of:
        *   **Outfit**: "pajamas", "gym clothes", "a hoodie".
        *   **Activity**: "making coffee", "working", "relaxing".
        *   **Mood**: "feeling cute", "tired", "energized".
        *   **Location**: "at home", "at the gym", "on the couch".
    *   **Heuristic Fallback**: Includes a regex-based fallback if the LLM is unavailable.

2.  **State Management (`kayleyPresenceService.ts`)**:
    *   Saves detected presence to the database.
    *   **Expiration Logic**: Activities have "lifepans." 
        *   "Making coffee" expires in 15 minutes.
        *   "Working" expires in 2 hours.
        *   "Gym outfit" expires in 2 hours.
    *   This prevents the "forever stuck" bug where she claims to be making coffee 6 hours later.

## Tables Interaction

| Table Name | Action | Description |
| :--- | :--- | :--- |
| `kayley_presence_state` | Upsert / Read | Stores the active presence state per user. |

## Workflow Interaction

```text
[BaseAIService] -> Kayley responds: "Just made some coffee ☕"
      |
      V
[kayleyPresenceDetector] (LLM: "Activity: making coffee")
      |
      V
[kayleyPresenceService] (Save to DB with 15-min expiration)
      |
      V
(User asks for a selfie)
      |
      V
[imageGenerationService] -> Reads presence -> Prompt: "Kayley... making coffee... at home..."
```

## Does it use an LLM?
**Yes.** The `detector` uses **Gemini Flash** to understand the natural language of her responses and pull out specific attributes.

## Why separate Service and Detector?
The `Detector` is the "eyes" (understanding the text), while the `Service` is the "memory" (storing and expiring the data). This separation makes the system easier to test and allows us to swap the LLM for a better model (like Gemini Pro) without changing the database logic.
