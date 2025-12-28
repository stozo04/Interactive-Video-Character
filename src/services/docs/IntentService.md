# Intent Service

The `intentService.ts` is the "Front Line" of the AI brain. Before Kayley responds, this service analyzes *what* the user actually said and *how* they said it.

## Core Responsibilities

1. **Command Bypass**: Instantly detects if a message is just a command (e.g., "add task") to skip expensive analysis and reduce latency.
2. **Genuine Moment Detection**: Identifies if the user said something that touches on Kayley's core insecurities (depth, belonging, progress, etc.).
3. **Tone & Sentiment**: Detects emotion (happiness, anger, sarcasm) and intensity (-1.0 to 1.0).
4. **Relationship Signals**: Identifies vulnerability, support-seeking, or hostility.

## Tables Interaction

This service does not write directly to tables. It returns a structured `FullMessageIntent` object used by other services (`messageAnalyzer`, `moodKnobs`) to update the database.

## Workflow Interaction

```text
User Message -> [intentService]
                     |
         +-----------+-----------+
         |                       |
   [isCommand?] --(Yes)--> [Skip to Response]
         |                       |
       (No)                      |
         |                       V
         V              [LLM Analysis (Gemini Flash)]
 [Regex Patterns]                |
         |               +-------+-------+
         |               |               |
         V               V               V
    [Output: FullMessageIntent Object]
```

## Does it use an LLM?
**Yes.** It uses **Gemini Flash** (fast/cheap) to perform semantic analysis. It strictly returns structured JSON.

## Why use an LLM here?
Generic keyword matching is bad at detecting sarcasm or deep emotional meaning. An LLM can tell the difference between "You're so smart (sincere)" and "You're so smart (sarcastic)."
