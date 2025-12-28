# Message Analyzer

The `messageAnalyzer.ts` is the "Post-Processor" of every interaction. While `BaseAIService` is busy generating a reply to keep the user happy, the Message Analyzer works in the background to update Kayley's long-term memory and emotional state.

## Core Responsibilities

1. **Soul Updates**: Calls `moodKnobs` to update energy, social battery, and emotional momentum based on the message's tone and intensity.
2. **Open Loop Creation**: Detects events the user mentions (e.g., "I have a job interview tomorrow") and creates a "loop" in the `character_actions` table so Kayley can ask about it later.
3. **Pattern Detection**: Identifies recurring user behaviors (e.g., "User always talks about work on Mondays").
4. **Milestone Tracking**: Recognizes relationship shifts (e.g., first time user is vulnerable, first time user is hostile).
5. **Almost Moment Triggers**: Checks if the interaction should trigger a new "unsaid feeling" or "almost moment" for Kayley.

## Tables Interaction

This service orchestrates updates across many tables via other services:

| Table Name | Action | Via Service |
|------------|--------|-------------|
| `mood_states` | Update | `moodKnobs` |
| `emotional_momentum` | Update | `moodKnobs` |
| `character_actions` | Create/Update | `presenceDirector` |
| `user_patterns` | Update | `userPatterns` |
| `relationship_milestones` | Create | `relationshipMilestones` |
| `kayley_almost_moment_log` | Create | `almostMoments` |

## Workflow Interaction

```text
[BaseAIService] --(Fire & Forget)--> [messageAnalyzer]
                                          |
               +--------------------------+--------------------------+
               |                          |                          |
      [Pattern Detector]          [Loop Detector]            [Soul/Mood Engine]
               |                          |                          |
       (user_patterns)           (character_actions)         (mood_states)
```

## Does it use an LLM?
**Yes.** It uses an LLM to perform deep analysis on loops, patterns, and relationship milestones. However, it also has **Keyword Fallbacks** (regex-based) to ensure it still works if the LLM fails or is too slow.

## Why use an LLM here?
Background analysis can afford to be a bit slower (~2-3s) than the main response. Using an LLM allows for high-quality "Open Loop" detection (e.g., knowing that "going to the dentist" is an event worth asking about later).
