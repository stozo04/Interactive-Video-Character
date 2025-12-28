# Presence Director

The `presenceDirector.ts` is the "Attunement Layer." It's what makes Kayley feel like an active participant in your life rather than just a chatbot. It manages "Open Loops"—topics or events that Kayley should remember to follow up on.

## Core Responsibilities

1. **Loop Management**: Creates, updates, and dismisses "Open Loops" (e.g., "Ask how the workout went").
2. **Salience Calculation**: Decides which topic is most important to bring up based on how recently you mentioned it and how significant it is.
3. **Opinion Layer**: Parsers Kayley's personality to find relevant "hot takes" or opinions on topics the user mentions.
4. **Time Awareness**: Ensures she doesn't ask "How was your interview?" *before* the interview actually happens.

## Tables Interaction

This service interacts primarily with:

| Table Name | Action | Description |
|------------|--------|-------------|
| `character_actions` | CRUD | Stores the "Open Loops" (topics to follow up on). |
| `presence_contexts` | Read/Write | Stores the priority of loops for the current user session. |

## Major Functions

- `getTopLoopToSurface(userId)`: Finds the #1 most relevant thing Kayley should ask about right now.
- `createOpenLoop(userId, openLoopIntent)`: Saves a new topic to the database (called by `messageAnalyzer`).
- `boostSalienceForMentionedTopics(userId, topics)`: If you mention a topic she's already tracking, she "leans in" and makes it more likely she'll ask about it later.
- `dismissLoopsByTopic(userId, topic)`: If the topic has been discussed enough, it's marked as `dismissed`.

## Workflow Interaction

```text
Message Analyzer -> [Presence Director] -> (DB: character_actions)
                          |
             +------------+------------+
             |                         |
      [Top Loop Finder]        [Opinion Matcher]
             |                         |
   (Used in System Prompt)   (Used in System Prompt)
```

## Does it use an LLM?
**No.** This service is pure logic and database management. It uses the results *from* an LLM (via `intentService` or `messageAnalyzer`) but doesn't call one itself. Content generation happens later in `BaseAIService`.
