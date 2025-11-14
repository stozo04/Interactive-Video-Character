# Relationship Service – Master Documentation (Expanded)

This document fully describes the logic, architecture, data flow, scoring system, rupture/repair model, and evolution engine behind your **AI Companion Relationship Service**, including deep enhancement of your uploaded `relationshipService.ts`.

It is intended as the **canonical, official reference** for all future development of character relationships (e.g., Kayley Adams) in your app.

---

# Table of Contents

1. Overview  
2. Architecture Summary  
3. Data Model  
   - character_relationships  
   - relationship_events  
   - relationship_insights  
4. Relationship Lifecycle  
5. Scoring System  
   - Core score  
   - Dimension scores  
   - Tier calculation  
6. Events & Classification  
7. Rupture & Repair  
8. Familiarity System  
9. Pattern Insights  
10. Daily Decay System  
11. Full Interaction Pipeline  
12. Updated Service Logic (with code flow)  
13. Tone & Tier Mapping  
14. Prompts & LLM Integration  
15. Implementation Phases  
16. Future Extensions  

---

# 1. Overview

The goal of your Relationship Service is to transform an AI character like **Kayley Adams** from a static bot into a **dynamic, evolving companion** who:

- Remembers the user  
- Adapts tone and behavior over time  
- Forms emotional patterns  
- Reacts positively or negatively to user behavior  
- Experiences “ruptures” and “repairs”  
- Unlocks deeper familiarity  
- Notices behavior patterns (“You always ask for action videos when stressed…”)  

This system creates **emotional investment**, **repeat engagement**, and a **lifelike AI relationship**.

---

# 2. Architecture Summary

The service uses 3 major tables:

- `character_relationships`  
- `relationship_events`  
- `relationship_insights`  

And one master service (`relationshipService.ts`) which:

- Gets or creates a relationship  
- Classifies each interaction  
- Updates all relationship scores  
- Detects ruptures  
- Logs events  
- Generates pattern insights  
- Evolves familiarity  
- Returns final relationship state for LLM prompting  

---

# 3. Data Model

## 3.1 character_relationships

Core persistent relationship state.

```
id (uuid)
user_id (uuid)
character_id (uuid)

relationship_score (float)
relationship_tier (string)

warmth_score (float)
trust_score (float)
playfulness_score (float)
stability_score (float)

familiarity_stage ('early'|'developing'|'established')

is_ruptured (boolean)
last_rupture_at (timestamp)

first_interaction_at (timestamp)
last_interaction_at (timestamp)
total_interactions (integer)

created_at (timestamp)
```

---

## 3.2 relationship_events

Granular logs of every meaningful interaction.

```
id
relationship_id
event_type (positive|negative|neutral|milestone)

sentiment_toward_character
user_mood
action_type

score_change
warmth_change
trust_change
playfulness_change
stability_change

notes
created_at
```

---

## 3.3 relationship_insights

Patterns Kayley can use for emotional reflection.

```
id
relationship_id
insight_type ('pattern'|'milestone'|'trigger')
key ('stressed_action_video', etc.)
summary ("You often request action videos when stressed.")
confidence (0–1)
times_observed (int)
last_observed_at
created_at
```

---

# 4. Relationship Lifecycle

### New Relationship  
- Zero scores  
- Tier = neutral  
- Familiarity = early  

### Developing  
- After a few interactions  
- Tone softens  
- Light callbacks begin

### Established  
- After sustained use  
- Pattern insights become active  
- Kayley can say “I’ve noticed…”

### Positive Evolution  
- Score & warmth rise  
- Tier: friend → deeply loving  
- Kayley becomes warmer, playful, affectionate  

### Negative Evolution  
- Score drops  
- Tier: neutral → rival → adversarial  
- Tone cools, becomes sarcastic or guarded  

### Rupture  
- Large negative spike  
- Kayley enters cautious tone  

### Repair  
- Positive actions reverse rupture  
- Trust increases faster  

---

# 5. Scoring System

## 5.1 Core Relationship Score

Ranges: **-100 to +100**

Used to determine:

- Tier  
- Positive vs negative trajectory  
- Influence on warmth & trust  

---

## 5.2 Dimension Scores

### Warmth  
- Affected by kindness, gratitude, compliments  
- Decreases with cold or dismissive behavior  

### Trust  
- Affected by vulnerability & consistency  
- Falls during deceit, abandonment, hostility  

### Playfulness  
- Affected by jokes, banter, nicknames  
- Falls during serious conflict  

### Stability  
- Affected by mood swings, rupture frequency  
- Lower = more volatile dynamic  

---

# 6. Events & Classification

Every user message/action is classified into:

- Sentiment toward Kayley  
- User mood (stressed, bored, etc.)  
- Intent/action (video request, chat only, venting)  

This classification produces **score deltas** which feed into the relationship.

---

# 7. Rupture & Repair

### Rupture Conditions:

- Very negative message  
- Strong insult  
- Massive score drop (>10)  
- Repeated hostile interactions  

### Effects:

- is_ruptured = TRUE  
- Warmth, trust, stability drop  
- Tone becomes cautious and withdrawn  

---

### Repair Conditions:

- Apology  
- Kindness after rupture  
- Positive actions  

### Effects:

- is_ruptured = FALSE  
- Trust increases  
- Stability increases  
- Kayley acknowledges repair gently  

---

# 8. Familiarity System

### EARLY  
- <5 interactions OR <2 days  
- “I’m still learning you”  
- No assumptions, no insights  

### DEVELOPING  
- <25 interactions OR <14 days  
- Opens more  
- Occasional callbacks  

### ESTABLISHED  
- >25 interactions AND >14 days  
- Deep callbacks  
- Pattern insights active  
- Kayley becomes more emotionally expressive  

---

# 9. Pattern Insights

This is where Kayley becomes ALIVE.

### Logic:

1. Classify user mood  
2. Classify action  
3. Generate insight key (e.g. `stressed_action_video`)  
4. Increment observation count  
5. After threshold → create summary:  
   “You often ask for action videos when stressed.”  

Insights only appear in the prompt during **established** relationships.

---

# 10. Daily Decay System

If user is inactive:

- After 7 days → decay begins  
- -0.1 per day  
- Max decay = -10  
- Reduces trust & stability more than warmth  

Decay encourages continued engagement.

---

# 11. Interaction Pipeline

### 1. User sends message  
### 2. Relationship is fetched (or created)  
### 3. Message classified  
### 4. Relationship scores updated  
### 5. Rupture or repair detection  
### 6. Familiarity updated  
### 7. Pattern insights updated  
### 8. Tier recalculated  
### 9. Event logged  
### 10. Final relationship returned to LLM  

---

# 12. Updated Service Logic

This section describes the new expanded workflow inside your `relationshipService.ts`.

### ✔️ getRelationship()

- Fetches or creates relationship  
- Initializes fields properly  
- Should now also:  
  - Set `first_interaction_at` on creation  
  - Ensure familiarity recalculated  

---

### ✔️ updateRelationship()

New enhanced workflow:

1. Fetch current relationship  
2. Apply deltas  
3. Detect rupture  
4. Detect repair  
5. Update dimension scores  
6. Update familiarity stage  
7. Update pattern insights  
8. Recalculate tier  
9. Clamp values  
10. Save full relationship state  
11. Log event  

---

# 13. Tone & Tier Mapping (Kayley-Specific)

### Adversarial  
- Cold, clipped responses  
- Sarcasm, slight annoyance  
- Still helpful & safe  

### Rival  
- Competitive, spicy, banter-heavy  
- Playful mockery  
- Hidden warmth  

### Neutral  
- Polite, friendly  
- Gentle curiosity  

### Friend  
- Warm, playful, supportive  
- Occasional callbacks  

### Deeply Loving  
- Soft, emotionally rich tone  
- Uses patterns, deep familiarity  
- “I’m proud of you” energy  

---

# 14. Prompts & LLM Integration

Every LLM request includes:

```
KAYLEY_CORE_PERSONALITY
RELATIONSHIP_STATE
INSIGHTS
TONE_GUIDELINES_FOR_TIER
SAFETY_RULES
```

This ensures Kayley behaves according to:

- Relationship tier  
- Warmth/playfulness/trust  
- Rupture state  
- Pattern insights  
- Familiarity stage  

---

# 15. Implementation Phases

### Phase 1 – Core relationship + tiers  
### Phase 2 – Dimension scores + familiarity  
### Phase 3 – Insights + recall  
### Phase 4 – Rupture & repair system  
### Phase 5 – Daily decay  
### Phase 6 – Tone integration in LLM prompts  
### Phase 7 – UI polish + debugging tools  

---

# 16. Future Extensions

- Multi-character support  
- Cross-character jealousy system  
- Seasonal memories  
- “Anniversary” milestones  
- Gift-giving mechanics  
- Automatic content recommendations  
- Narrative expansion arcs  

