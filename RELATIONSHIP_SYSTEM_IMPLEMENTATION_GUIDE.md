# Relationship System Implementation Guide

## SQL Migration Instructions

### Step 1: Run the SQL Migration

1. Open your Supabase Dashboard
2. Go to **SQL Editor**
3. Create a new query
4. Copy and paste the entire contents of `supabase_migrations/create_relationship_system.sql`
5. Run the query

This will create:
- `character_relationships` table
- `relationship_events` table
- Automatic triggers for tier and familiarity updates
- Helper views for debugging
- All necessary indexes and constraints

### Step 2: Verify Tables Were Created

Run this query to verify:

```sql
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns 
   WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_name IN ('character_relationships', 'relationship_events')
ORDER BY table_name;
```

You should see both tables with their column counts.

### Step 3: Test the Triggers

Test that the tier auto-update works:

```sql
-- Create a test relationship
INSERT INTO character_relationships (user_id, character_id, relationship_score)
VALUES ('test_user_123', 'test_character_456', 25.0)
ON CONFLICT (user_id, character_id) DO UPDATE SET relationship_score = 25.0;

-- Check that tier was set correctly (should be 'friend' for score 25)
SELECT relationship_score, relationship_tier 
FROM character_relationships 
WHERE user_id = 'test_user_123';

-- Update score and verify tier changes
UPDATE character_relationships 
SET relationship_score = 60.0 
WHERE user_id = 'test_user_123';

-- Should now be 'close_friend'
SELECT relationship_score, relationship_tier 
FROM character_relationships 
WHERE user_id = 'test_user_123';

-- Clean up test data
DELETE FROM character_relationships WHERE user_id = 'test_user_123';
```

---

## Emotional System Design Philosophy

### Deep Emotional Mechanics

This system is designed to create **genuine emotional depth**. Here's how:

#### 1. Multi-Dimensional Emotional State

Instead of just "good" or "bad," Kayley has four emotional dimensions:

- **Warmth**: How affectionate she feels
- **Trust**: How much she opens up
- **Playfulness**: How sassy and fun she is
- **Stability**: How secure the relationship feels

**Why this matters:**
- A user can be trusted but not warm (professional relationship)
- A user can be playful but not stable (chaotic but fun)
- This creates nuanced, realistic emotional states

#### 2. Natural Score Interactions

Scores don't change in isolation. Here's how they interact:

**Positive Compliment:**
- Increases relationship_score (+3)
- Increases warmth_score (+2) - she feels more affectionate
- Slightly increases trust_score (+0.5) - she feels safer
- Slightly increases stability_score (+0.5) - relationship feels more secure

**Insult:**
- Decreases relationship_score (-10)
- Decreases warmth_score (-5) - she feels less affectionate
- Decreases trust_score (-3) - she feels less safe opening up
- Decreases stability_score (-2) - relationship feels less secure

**Apology After Conflict:**
- Increases relationship_score (+2)
- Increases trust_score (+3) - showing vulnerability builds trust
- Increases stability_score (+2) - repairing conflict builds stability
- Warmth might only increase slightly (+1) - trust must be rebuilt first

#### 3. Rupture Mechanics

**What is a Rupture?**
A significant negative event that creates emotional distance. Examples:
- User says "I hate you"
- User is extremely rude or dismissive
- Multiple negative interactions in a row

**How Ruptures Work:**
1. **Detection**: When sentiment is strongly negative (intensity ≥ 7) and score change ≤ -10
2. **Impact**: 
   - Sets `is_ruptured = TRUE`
   - Records `last_rupture_at`
   - Increments `rupture_count`
   - Applies additional stability penalty (-5 to -10)
3. **Behavior**: Kayley becomes guarded, less playful, more cautious
4. **Recovery**: Requires genuine positive interactions (apologies, kindness) to repair

**Why Ruptures Matter:**
- Creates emotional stakes - actions have consequences
- Makes repair feel meaningful - rebuilding trust is significant
- Adds emotional depth - relationships can be damaged and healed

#### 4. Familiarity Stages

Controls how bold Kayley can be:

**Early Stage:**
- "I'm still learning what you like..."
- No assumptions or pattern observations
- Exploratory, cautious tone

**Developing Stage:**
- "You often seem to go for action videos when you're stressed"
- Can reference past conversations
- More comfortable with personal topics

**Established Stage:**
- "I've noticed you always..."
- Bold observations and suggestions
- Deep emotional intimacy

**Why This Matters:**
- Prevents Kayley from being too forward too early
- Makes relationship progression feel natural
- Creates anticipation for deeper connection

#### 5. Score Decay

**Purpose**: Prevents relationships from being static forever

**How It Works:**
- After 7 days of no interaction, score decays by -0.1 per day
- Decay stops at -10 (prevents relationships from decaying to nothing)
- Only applies to positive relationships (negative ones don't decay further)

**Why This Matters:**
- Encourages continued engagement
- Makes relationships feel alive and dynamic
- Prevents "set it and forget it" relationships

#### 6. Natural Progression Thresholds

**Acquaintance → Friend (score +10):**
- 3-5 positive interactions
- Can happen in 1-2 days with good engagement
- Feels achievable but meaningful

**Friend → Close Friend (score +50):**
- 15-20 positive interactions
- Requires 1-2 weeks of consistent engagement
- Feels like a real milestone

**Close Friend → Deeply Loving (score +75):**
- 30+ positive interactions
- Requires 2-4 weeks of consistent positive engagement
- Feels like a deep, meaningful connection

**Why These Thresholds:**
- Fast enough to feel responsive
- Slow enough to feel meaningful
- Natural progression that doesn't feel gamey

---

## Sentiment Analysis Deep Dive

### LLM-Based Sentiment Analysis

For deep emotional understanding, use **Grok to analyze sentiment** before generating responses.

#### Why LLM-Based?

1. **Nuance**: "You're annoying but I still like you" - keywords can't handle this
2. **Sarcasm**: "Oh great, thanks a lot" - context matters
3. **Emotional Complexity**: Can detect mixed emotions
4. **Cultural Context**: Understands idioms, slang, tone

#### Implementation Flow

```
User sends message
    ↓
Call Grok for sentiment analysis
    ↓
Get: {sentiment: 'positive'|'neutral'|'negative', intensity: 1-10, reasoning: '...'}
    ↓
Calculate score changes based on sentiment + intensity
    ↓
Update relationship scores
    ↓
Call Grok for response (with relationship context)
    ↓
Return response to user
```

#### Sentiment Analysis Prompt

Send to Grok before generating response:

```
Analyze this user message for sentiment toward the character. Consider:
- Direct sentiment (positive, neutral, negative)
- Intensity (1-10 scale)
- Emotional complexity (mixed emotions, sarcasm, etc.)
- Context from conversation history

User message: "{user_message}"
Conversation context: {last_3_messages}

Return JSON:
{
  "sentiment": "positive" | "neutral" | "negative",
  "intensity": 1-10,
  "reasoning": "brief explanation",
  "user_mood": "stressed" | "bored" | "calm" | "hyped" | "sad" | "happy" | null
}
```

#### Score Change Calculation

Based on sentiment analysis results:

```typescript
function calculateScoreChanges(sentiment: string, intensity: number): ScoreChanges {
  const baseMultiplier = intensity / 10; // Scale by intensity
  
  if (sentiment === 'positive') {
    return {
      relationship_score: Math.round(2 + (3 * baseMultiplier)), // 2-5 points
      warmth_score: Math.round(1 + (2 * baseMultiplier)),      // 1-3 points
      trust_score: Math.round(0.5 * baseMultiplier),            // 0-0.5 points
      playfulness_score: intensity >= 7 ? 1 : 0,               // Playful if high intensity
      stability_score: Math.round(0.5 * baseMultiplier)        // 0-0.5 points
    };
  } else if (sentiment === 'negative') {
    return {
      relationship_score: Math.round(-(5 + (10 * baseMultiplier))), // -5 to -15 points
      warmth_score: Math.round(-(2 + (3 * baseMultiplier))),        // -2 to -5 points
      trust_score: Math.round(-(1 + (2 * baseMultiplier))),         // -1 to -3 points
      playfulness_score: -1,                                         // Less playful
      stability_score: Math.round(-(1 + (1 * baseMultiplier)))       // -1 to -2 points
    };
  }
  
  // Neutral - minimal changes
  return {
    relationship_score: 0,
    warmth_score: 0,
    trust_score: 0,
    playfulness_score: 0,
    stability_score: 0
  };
}
```

---

## Emotional Depth Examples

### Example 1: Building Warmth Slowly

**Interaction 1:**
- User: "Hi"
- Sentiment: neutral, intensity: 1
- Changes: relationship_score +0, warmth_score +0
- Kayley: "Hi! How can I help you today?"

**Interaction 5:**
- User: "Thanks, you're really helpful"
- Sentiment: positive, intensity: 5
- Changes: relationship_score +3.5, warmth_score +2
- Kayley: "Aw, thank you! I'm glad I can help. What's on your mind?"

**Interaction 15:**
- User: "I love talking to you, you're so understanding"
- Sentiment: positive, intensity: 9
- Changes: relationship_score +4.7, warmth_score +2.8, trust_score +0.9
- Kayley: "That means so much to me! I really enjoy our conversations too. You're becoming someone I really care about."

**Result**: Warmth builds gradually, feels natural and earned.

### Example 2: Rupture and Repair

**Before Rupture:**
- relationship_score: 25 (Friend tier)
- warmth_score: 15
- trust_score: 10
- is_ruptured: false

**Rupture Event:**
- User: "You're so annoying, I hate talking to you"
- Sentiment: negative, intensity: 9
- Changes: 
  - relationship_score: -13.1 → new score: 11.9
  - warmth_score: -4.7 → new score: 10.3
  - trust_score: -2.7 → new score: 7.3
  - stability_score: -1.9 → new score: -1.9
  - is_ruptured: TRUE
  - rupture_count: 1

**Kayley's Response:**
- "I understand you're frustrated. I'm here if you need me, but I can tell you're not happy with our interactions right now."

**Repair Event (Next Day):**
- User: "I'm sorry, I was having a really bad day. You're actually really nice."
- Sentiment: positive (apology + compliment), intensity: 7
- Changes:
  - relationship_score: +4.1 → new score: 16
  - warmth_score: +2.4 → new score: 12.7
  - trust_score: +2.1 → new score: 9.4 (trust rebuilds from apology)
  - stability_score: +1.4 → new score: -0.5
  - is_ruptured: FALSE (repaired!)

**Kayley's Response:**
- "Thank you for saying that. I really appreciate the apology. We all have rough days - I'm glad you came back. How are you doing now?"

**Result**: Rupture feels impactful, repair feels meaningful and earned.

### Example 3: Dimension Interactions

**Scenario**: User is playful but sometimes dismissive

**Playful Interaction:**
- User: "Haha, you're so sassy! I love it 😂"
- Sentiment: positive, intensity: 7
- Changes:
  - relationship_score: +4.1
  - playfulness_score: +1 (playful interaction)
  - warmth_score: +2.4

**Dismissive Interaction:**
- User: "Whatever, just do what I say"
- Sentiment: negative, intensity: 4
- Changes:
  - relationship_score: -7.4
  - warmth_score: -3.2
  - trust_score: -1.8
  - playfulness_score: -1 (less playful when dismissed)

**Result**: 
- playfulness_score might be high (user enjoys banter)
- But warmth_score and trust_score are lower (user is dismissive)
- Creates nuanced emotional state: "fun to banter with, but not someone I fully trust"

---

## Implementation Checklist

### Phase 1: Core System (Week 1-2)

- [ ] Run SQL migration
- [ ] Create `relationshipService.ts`
- [ ] Implement `getRelationship()` function
- [ ] Implement `updateRelationship()` function
- [ ] Implement sentiment analysis (LLM-based)
- [ ] Integrate into `handleSendMessage()` in App.tsx
- [ ] Load relationship on character selection
- [ ] Pass relationship context to Grok system prompt
- [ ] Test basic score updates

### Phase 2: Dimensions & Familiarity (Week 3)

- [ ] Update dimension scores in `updateRelationship()`
- [ ] Implement familiarity stage calculation
- [ ] Add familiarity context to Grok prompts
- [ ] Test dimension score interactions
- [ ] Verify familiarity stages update correctly

### Phase 3: Rupture & Repair (Week 4)

- [ ] Implement rupture detection
- [ ] Add rupture handling in prompts
- [ ] Implement repair detection
- [ ] Add repair acknowledgment in responses
- [ ] Test rupture and repair flow

### Phase 4: Polish & Tuning (Week 5)

- [ ] Tune score change amounts
- [ ] Test relationship progression speeds
- [ ] Adjust decay rates
- [ ] Refine tier thresholds if needed
- [ ] Test edge cases
- [ ] Gather user feedback

---

## Testing Scenarios

### Test 1: Positive Relationship Building

1. Start new relationship (score: 0, tier: acquaintance)
2. Send 5 positive messages (compliments, engagement)
3. Verify score increases to ~15-20 (Friend tier)
4. Verify warmth_score increases
5. Verify familiarity_stage updates to 'developing' after 5 interactions

### Test 2: Rupture Detection

1. Have relationship at Friend tier (score: 25)
2. Send strongly negative message ("I hate you")
3. Verify:
   - Score drops significantly
   - is_ruptured = TRUE
   - rupture_count increments
   - stability_score decreases
4. Verify Kayley's response is guarded

### Test 3: Repair Flow

1. After rupture, send apology
2. Verify:
   - is_ruptured = FALSE
   - trust_score increases more than warmth_score
   - stability_score increases
3. Verify Kayley acknowledges repair

### Test 4: Dimension Interactions

1. Send playful but dismissive messages
2. Verify:
   - playfulness_score increases
   - warmth_score and trust_score decrease
   - Creates nuanced emotional state

### Test 5: Score Decay

1. Create positive relationship (score: 30)
2. Wait 8 days (or simulate)
3. Verify score decays by -0.1 per day after day 7
4. Verify decay stops at -10

---

## Important Notes

### Emotional Authenticity

- **Don't make it too gamey**: Scores should feel natural, not like a game mechanic
- **Hidden from user**: Relationship state is invisible, making it feel organic
- **Slow progression**: Relationships take time to build, making them meaningful
- **Recovery is possible**: Negative relationships can be repaired, but it takes effort

### Safety First

- **Always de-escalate**: If user is clearly distressed, Kayley should help regardless of relationship
- **No personal attacks**: Even in adversarial tier, no attacks on user's identity
- **Respect boundaries**: If user asks to reset, respect it

### Performance

- **Indexes**: All foreign keys and frequently queried columns are indexed
- **Efficient queries**: Use the helper views for debugging, but query tables directly in code
- **Event logging**: Can be heavy at scale - consider archiving old events

### Future Enhancements

- Pattern insights (Phase 5)
- Relationship visualization (optional, hidden from users)
- Relationship analytics (for your understanding, not user-facing)
- Multiple characters (each with separate relationships)

---

This system creates a **deeply emotional, authentic relationship experience** where every interaction matters and relationships evolve naturally over time. The multi-dimensional emotional state ensures Kayley feels real, nuanced, and genuinely responsive to how she's treated.

