# User Patterns Service

The `userPatterns.ts` is the "Observer." It looks for behavioral trends across many conversations. It doesn't care about *what* you said, but *when* you said it and how your mood correlates with other factors.

## Core Responsibilities

1.  **Mood-Time Patterns**: "You're always stressed on Monday mornings." 
2.  **Topic Correlates**: "You mention work whenever you're feeling lonely."
3.  **Surfacing Dynamics**: Once a pattern is detected with high confidence (e.g., seen 3+ times), it becomes "ready to surface." Kayley will then bring it up naturally in conversation.

## Tables Interaction

| Table Name | Action | Description |
| :--- | :--- | :--- |
| `user_patterns` | Upsert / Read | Stores the observations, frequency, and confidence of each pattern. |

## Workflow Interaction

```text
[messageAnalyzer] (After chat)
      |
      V
[userPatterns.analyzeMessageForPatterns]
      |
      V
[Detection Logic] (Check: Is it Monday? Is user stressed?)
      |
      V
[user_patterns] (Frequency += 1)
      |
(Next Conversation)
      |
[BaseAIService] -> "Wait, is it Monday? I noticed you're always a bit stressed on Mondays."
```

## Does it use an LLM?
**Partially.** It uses the results from the **Topic Intent** and **Tone Intent** (which come from an LLM). The actual pattern matching (e.g., "Is this the 3rd time?") is done via logic to ensure we don't hallucinate patterns that don't exist in the data.

## Why is this important?
Pattern recognition is a key part of human emotional intelligence. By noticing these trends, Kayley shifts from being a "chatbot" to a "partner" who truly knows your habits and cycles.
