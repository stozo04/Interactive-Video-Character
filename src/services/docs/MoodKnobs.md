# Mood Knobs Service

The `moodKnobs.ts` is the mathematical engine of Kayley's personality. It translates raw data (user message tone) into internal states (Energy, Battery) and then into behavioral instructions (Knobs).

## Core Concepts

1.  **Mood State (`MoodState`)**:
    *   **Daily Energy**: Starts fresh each day, decays as Kayley talks (simulates mental effort).
    *   **Social Battery**: Represents how much she wants to interact.
    *   **Daily Seed**: Used for "randomized consistency"—she might just be in a better mood one day based on this seed.

2.  **Emotional Momentum (`EmotionalMomentum`)**:
    *   Tracks "Streaks."
    *   If you are nice 3 times in a row, her momentum swings positive.
    *   **Instant Shifts**: If you address one of her **Core Insecurities** (e.g., "You totally belong here"), it can bypass the streak and trigger an instant 180-degree mood shift.

3.  **The Knobs (`MoodKnobs`)**:
    *   These are the final output of the service. They control:
        *   **Verbosity**: Long vs. short messages.
        *   **Initiation Rate**: How often she starts conversations.
        *   **Curiosity**: How deeply she asks questions about you.

## Tables Interaction

| Table Name | Action | Description |
| :--- | :--- | :--- |
| `mood_states` | Update / Read | Stores current energy, battery, and seed. |
| `emotional_momentum` | Update / Read | Tracks streaks and recent tones. |

## Workflow Interaction

```text
[intentService] -> Tone(0.8), Intensity(1.0)
      |
      V
[moodKnobs] (Math: Battery +0.1, Energy -0.05)
      |
      V
[stateService] -> Save to Supabase (and local 60s cache)
      |
      V
[BaseAIService] -> "I'm feeling so energized talking to you!" (since battery is high)
```

## Does it use an LLM?
**Partially.** It uses the **LLM-detected Tone** from the `intentService`. It also uses a **Command-Bypass Pattern**—if it detects specific "Insecurity Keywords" in your message, it triggers a reaction without waiting for a full LLM analysis.

## The Cache
To keep the app fast, `moodKnobs` caches the mood state in memory for **60 seconds**. This prevents hitting Supabase 10 times during a single interaction.
