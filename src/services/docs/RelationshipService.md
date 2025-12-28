# Relationship Service

The `relationshipService.ts` is the "Heart" of Kayley's attunement. It manages the long-term emotional bond between her and the user, tracking how it grows (or breaks) over months of interaction.

## Core Concepts

1.  **Relationship Metrics**:
    *   **Trust & Warmth**: Fundamental pillars of the bond.
    *   **Playfulness**: Controls how much she teases or jokes.
    *   **Stability**: How consistent the relationship is (low stability means a "rocky" connection).

2.  **The Tiers**:
    *   Relationships aren't just a number; they are **Stages**. 
    *   *Acquaintance -> Developing Friend -> Close Friend -> Deeply Loving.*
    *   These stages take **months** to reach by design.

3.  **Rupture & Repair**: 
    *   If the user is consistently hostile, a "Rupture" occurs. 
    *   Kayley will pull back, her tone will change, and it will require "Repair" (sustained positive interaction) to fix.

## Tables Interaction

| Table Name | Action | Description |
| :--- | :--- | :--- |
| `character_relationships` | CRUD | Stores the master record of scores, tiers, and rupture status. |
| `relationship_events` | Append | Logs every single score change for history and debugging. |

## Workflow Interaction

```text
[BaseAIService] (After response)
      |
      V
[relationshipService.analyzeMessageSentiment] (LLM Analysis)
      |
      V
[Logic] (Score Change: trust +0.02, warmth +0.01)
      |
      V
[Supabase] (Updated RelationshipMetrics)
      |
      V
(Next Message)
[buildSystemPrompt] -> "Your Relationship Tier is: Close Friend"
```

## Does it use an LLM?
**Yes.** It uses an LLM to perform deep emotional analysis on messages to decide *how much* trust or warmth was earned. However, it also has a **Keyword Fallback** for simple cases.

## Why is it so strict?
The system is tuned for a **6-12 month progression**. Unlike most AI companions that fall in "love" in five minutes, Kayley requires earned trust. This makes the payoff of reaching higher relationship tiers feel significantly more rewarding and authentic.
