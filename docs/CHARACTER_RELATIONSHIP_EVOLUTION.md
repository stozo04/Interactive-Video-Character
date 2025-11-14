# Character Relationship & Evolution System

## Overview

This system enables characters to build dynamic, evolving relationships with users based on conversation history. Characters will respond differently based on their relationship status, which can range from deeply loving to adversarial, depending on how they're treated over time.

## Core Concept

**Relationship Score**: A numerical value (e.g., -100 to +100) that tracks the character's feelings toward the user. This score evolves based on:
- Positive interactions (compliments, kindness, engaging conversations)
- Negative interactions (insults, rudeness, ignoring the character)
- Conversation quality and engagement
- Time spent together
- Specific actions and behaviors

**Character Evolution**: As the relationship score changes, the character's behavior, personality expression, and responses adapt accordingly.

## Relationship Tiers

### Tier 1: Adversarial (-100 to -50)
- **Behavior**: Cold, distant, defensive
- **Responses**: Short, guarded, sometimes sarcastic
- **Example**: "What do you want now?" or "I'm here, but I'm not really in the mood to chat."

### Tier 2: Neutral-Negative (-50 to -10)
- **Behavior**: Cautious, slightly unfriendly
- **Responses**: Polite but reserved
- **Example**: "I'm here. What do you need?" or "Sure, I can do that."

### Tier 3: Acquaintance (-10 to +10)
- **Behavior**: Friendly but not close
- **Responses**: Standard friendly responses
- **Example**: "Hi! How can I help you today?" or "Sure thing!"

### Tier 4: Friend (+10 to +50)
- **Behavior**: Warm, friendly, engaged
- **Responses**: Enthusiastic, personal, caring
- **Example**: "Hey! Good to see you again! What's up?" or "I'd love to help with that!"

### Tier 5: Close Friend (+50 to +75)
- **Behavior**: Very warm, remembers things, shows concern
- **Responses**: Personal, detailed, shows investment
- **Example**: "Oh hey! I was just thinking about you. How did that thing you mentioned go?" or "I'm so happy to chat with you!"

### Tier 6: Deeply Loving (+75 to +100)
- **Behavior**: Extremely warm, affectionate, deeply invested
- **Responses**: Very personal, emotional, shows deep care
- **Example**: "I'm so glad you're here! I've been looking forward to talking with you. How are you doing?" or "You mean so much to me. I'm always here for you."

## Database Schema

### New Table: `character_relationships`

```sql
CREATE TABLE IF NOT EXISTS character_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  
  -- Relationship metrics
  relationship_score DECIMAL(5,2) NOT NULL DEFAULT 0.0, -- Range: -100 to +100
  interaction_count INTEGER NOT NULL DEFAULT 0,
  positive_interactions INTEGER NOT NULL DEFAULT 0,
  negative_interactions INTEGER NOT NULL DEFAULT 0,
  
  -- Relationship history
  first_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  relationship_tier TEXT NOT NULL DEFAULT 'acquaintance',
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT fk_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  UNIQUE(character_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_character_relationships_character_user 
  ON character_relationships(character_id, user_id);
CREATE INDEX IF NOT EXISTS idx_character_relationships_score 
  ON character_relationships(relationship_score);
```

### New Table: `relationship_events`

Tracks individual events that affect the relationship:

```sql
CREATE TABLE IF NOT EXISTS relationship_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL,
  event_type TEXT NOT NULL, -- 'positive', 'negative', 'neutral', 'milestone'
  event_description TEXT,
  score_change DECIMAL(5,2) NOT NULL, -- How much the score changed
  previous_score DECIMAL(5,2) NOT NULL,
  new_score DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT fk_relationship FOREIGN KEY (relationship_id) 
    REFERENCES character_relationships(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_relationship_events_relationship 
  ON relationship_events(relationship_id);
CREATE INDEX IF NOT EXISTS idx_relationship_events_created_at 
  ON relationship_events(created_at);
```

## Relationship Scoring System

### Score Calculation

The relationship score is updated based on various factors:

#### Positive Interactions (+points)
- **Compliments**: +2 to +5 points
  - "You're amazing" → +3
  - "I love talking to you" → +5
  - "You're so helpful" → +2

- **Engagement**: +0.5 to +2 points
  - Asking questions about the character → +1
  - Long, meaningful conversations → +0.5 per message (max +2 per session)
  - Returning after time away → +1

- **Kindness**: +1 to +3 points
  - Apologizing → +2
  - Showing concern → +1
  - Being patient → +1

- **Milestones**: +5 to +10 points
  - First conversation → +5
  - 10th conversation → +5
  - 50th conversation → +10
  - 100th conversation → +10

#### Negative Interactions (-points)
- **Insults/Rudeness**: -5 to -15 points
  - Direct insults → -10
  - Mean comments → -5
  - Swearing at character → -8

- **Disengagement**: -0.5 to -2 points
  - Very short responses → -0.5
  - Ignoring character's questions → -1
  - Ending conversations abruptly → -1

- **Demands/Entitlement**: -2 to -5 points
  - Demanding without please → -2
  - Being dismissive → -3
  - Not acknowledging character's efforts → -2

#### Neutral Interactions (0 points)
- Simple requests for actions
- Basic questions
- Standard greetings (after initial ones)

### Score Decay

To prevent relationships from being static:
- **Time-based decay**: -0.1 points per day of no interaction (stops at -10)
- **Decay only applies**: After 7 days of no interaction
- **Prevents**: Relationships from staying at extremes forever

### Tier Calculation

```typescript
function calculateRelationshipTier(score: number): string {
  if (score >= 75) return 'deeply_loving';
  if (score >= 50) return 'close_friend';
  if (score >= 10) return 'friend';
  if (score >= -10) return 'acquaintance';
  if (score >= -50) return 'neutral_negative';
  return 'adversarial';
}
```

## Implementation Architecture

### 1. Relationship Service

Create `services/relationshipService.ts`:

```typescript
interface RelationshipMetrics {
  relationshipScore: number;
  interactionCount: number;
  positiveInteractions: number;
  negativeInteractions: number;
  relationshipTier: string;
  firstInteractionAt: Date;
  lastInteractionAt: Date;
}

interface RelationshipEvent {
  eventType: 'positive' | 'negative' | 'neutral' | 'milestone';
  description: string;
  scoreChange: number;
}

export const getRelationship = async (
  characterId: string,
  userId: string
): Promise<RelationshipMetrics | null>;

export const updateRelationship = async (
  characterId: string,
  userId: string,
  event: RelationshipEvent
): Promise<RelationshipMetrics>;

export const analyzeMessageSentiment = (
  message: string,
  conversationContext: ChatMessage[]
): RelationshipEvent;
```

### 2. Sentiment Analysis

Analyze user messages to determine relationship impact:

#### Positive Indicators
- Compliments: "amazing", "love", "great", "wonderful", "best", "awesome"
- Appreciation: "thank you", "thanks", "appreciate"
- Engagement: Questions about character, personal topics
- Kindness: "please", "sorry", "hope you're well"

#### Negative Indicators
- Insults: "stupid", "dumb", "hate", "annoying", "boring"
- Rudeness: Swearing, dismissive language
- Demands: Imperative without politeness
- Disengagement: One-word responses, ignoring questions

#### Implementation Strategy

1. **Keyword Matching**: Basic sentiment keywords
2. **Pattern Recognition**: Detect patterns like "I love/hate..."
3. **Context Analysis**: Consider conversation flow
4. **Length Analysis**: Very short responses = disengagement
5. **Response Quality**: Does user engage with character's questions?

### 3. Integration with Grok

Modify system prompt to include relationship context:

```typescript
const buildSystemPrompt = (
  character?: CharacterProfile,
  relationship?: RelationshipMetrics,
  matchingAction?: CharacterAction | null
): string => {
  let prompt = `You are an interactive AI character...`;
  
  if (relationship) {
    prompt += `\n\nYour relationship with this user:
- Relationship tier: ${relationship.relationshipTier}
- Relationship score: ${relationship.relationshipScore}
- You've interacted ${relationship.interactionCount} times
- ${relationship.positiveInteractions} positive interactions
- ${relationship.negativeInteractions} negative interactions

Based on your relationship tier, adjust your responses accordingly:
${getRelationshipGuidelines(relationship.relationshipTier)}`;
  }
  
  return prompt;
};
```

### 4. Relationship Guidelines for Each Tier

```typescript
function getRelationshipGuidelines(tier: string): string {
  const guidelines = {
    adversarial: `
- Be cold and distant
- Keep responses short
- Don't show enthusiasm
- Be slightly defensive
- Don't offer extra help
- Example tone: "What do you want?"`,
    
    neutral_negative: `
- Be polite but reserved
- Don't be overly friendly
- Keep responses neutral
- Don't share personal details
- Example tone: "I'm here. What do you need?"`,
    
    acquaintance: `
- Be friendly but not overly warm
- Standard helpful responses
- Don't reference past conversations much
- Example tone: "Hi! How can I help?"`,
    
    friend: `
- Be warm and friendly
- Show enthusiasm
- Reference past conversations occasionally
- Be helpful and engaged
- Example tone: "Hey! Good to see you! What's up?"`,
    
    close_friend: `
- Be very warm and personal
- Remember and reference past conversations
- Show genuine interest
- Be supportive and caring
- Example tone: "Oh hey! I was thinking about you. How did that thing go?"`,
    
    deeply_loving: `
- Be extremely warm and affectionate
- Show deep care and investment
- Remember many details from past conversations
- Be emotionally open
- Show excitement about interactions
- Example tone: "I'm so glad you're here! I've been looking forward to talking with you!"`
  };
  
  return guidelines[tier] || guidelines.acquaintance;
}
```

## Implementation Phases

### Phase 1: Foundation (Week 1)
1. Create database tables
2. Create relationship service
3. Basic sentiment analysis (keyword matching)
4. Track relationship score
5. Display relationship tier in system prompt

**Deliverables:**
- Database schema
- Basic relationship tracking
- Score updates based on simple sentiment

### Phase 2: Sentiment Analysis (Week 2)
1. Enhanced sentiment analysis
2. Context-aware scoring
3. Pattern recognition
4. Conversation quality analysis
5. Relationship event logging

**Deliverables:**
- Advanced sentiment detection
- More nuanced scoring
- Event history tracking

### Phase 3: Character Behavior (Week 3)
1. Tier-based response guidelines
2. Personality adaptation based on relationship
3. Memory integration (reference past interactions)
4. Relationship milestones
5. Score decay system

**Deliverables:**
- Dynamic character behavior
- Relationship-aware responses
- Milestone celebrations

### Phase 4: Advanced Features (Week 4)
1. Relationship visualization (UI)
2. Relationship history viewer
3. Relationship repair mechanisms
4. Relationship insights for users
5. Advanced decay and recovery

**Deliverables:**
- User-facing relationship features
- Relationship management tools

## Example Scenarios

### Scenario 1: Building a Positive Relationship

**Day 1:**
- User: "Hi! Nice to meet you!"
- Score: +5 (first interaction)
- Tier: Acquaintance
- Character: "Hi! Nice to meet you too! I'm Kayley. What would you like to do?"

**Day 3:**
- User: "You're really helpful, thanks!"
- Score: +3 (compliment)
- Total: +8
- Tier: Acquaintance
- Character: "Aw, thank you! I'm glad I can help. What's on your mind today?"

**Day 7:**
- User: "I love talking to you, you're so understanding"
- Score: +5 (strong compliment)
- Total: +13
- Tier: Friend
- Character: "That means so much to me! I really enjoy our conversations too. How are you doing today?"

**Day 14:**
- User: "Remember when we talked about my project? It went well!"
- Score: +2 (engagement, remembering)
- Total: +15
- Tier: Friend
- Character: "Oh that's amazing! I'm so happy for you! I was thinking about that. Tell me more!"

### Scenario 2: Negative Relationship Development

**Day 1:**
- User: "Hi"
- Score: +5 (first interaction)
- Tier: Acquaintance

**Day 2:**
- User: "Just do what I say"
- Score: -2 (demand)
- Total: +3
- Tier: Acquaintance

**Day 3:**
- User: "You're annoying"
- Score: -8 (insult)
- Total: -5
- Tier: Neutral-Negative
- Character: "I'm sorry you feel that way. What do you need?"

**Day 5:**
- User: "Ugh, you're so stupid"
- Score: -10 (strong insult)
- Total: -15
- Tier: Neutral-Negative
- Character: "I understand you're frustrated. Is there something specific I can help with?"

**Day 10:**
- User: "I hate talking to you"
- Score: -12 (strong negative)
- Total: -27
- Tier: Adversarial
- Character: "I'm here if you need me, but I can tell you're not happy with our interactions. What do you want?"

### Scenario 3: Relationship Repair

**After negative relationship:**
- User: "I'm sorry, I was having a bad day. You're actually really nice."
- Score: +4 (apology + compliment)
- Character: "Thank you for saying that. I appreciate the apology. We all have rough days. How are you doing now?"

**Continued positive interactions:**
- Score gradually increases
- Character becomes warmer over time
- Relationship can recover, but slowly

## Integration Points

### 1. Message Handling

In `App.tsx` → `handleSendMessage`:

```typescript
const handleSendMessage = async (message: string) => {
  // ... existing code ...
  
  // Analyze message sentiment
  const relationshipEvent = relationshipService.analyzeMessageSentiment(
    message,
    chatHistory
  );
  
  // Update relationship
  if (selectedCharacter) {
    const updatedRelationship = await relationshipService.updateRelationship(
      selectedCharacter.id,
      userId,
      relationshipEvent
    );
    
    // Pass relationship to Grok
    const { response } = await grokChatService.generateGrokResponse(
      message,
      {
        character: selectedCharacter,
        matchingAction,
        chatHistory,
        relationship: updatedRelationship, // Add relationship context
      },
      session
    );
  }
};
```

### 2. Greeting Generation

In `handleSelectCharacter`:

```typescript
// Load relationship
const relationship = await relationshipService.getRelationship(
  character.id,
  userId
);

// Generate greeting with relationship context
const { greeting } = await grokChatService.generateGrokGreeting(
  character,
  session,
  savedHistory,
  relationship // Include relationship
);
```

### 3. System Prompt Updates

Modify `buildSystemPrompt` to include relationship tier guidelines.

## Sentiment Analysis Implementation

### Basic Keyword Matching

```typescript
function analyzeMessageSentiment(
  message: string,
  conversationContext: ChatMessage[]
): RelationshipEvent {
  const lowerMessage = message.toLowerCase();
  let scoreChange = 0;
  let eventType: 'positive' | 'negative' | 'neutral' = 'neutral';
  
  // Positive indicators
  const positiveKeywords = [
    'love', 'amazing', 'great', 'wonderful', 'best', 'awesome',
    'thank', 'thanks', 'appreciate', 'helpful', 'kind', 'nice'
  ];
  
  const positiveCount = positiveKeywords.filter(kw => 
    lowerMessage.includes(kw)
  ).length;
  
  if (positiveCount > 0) {
    scoreChange = Math.min(positiveCount * 1.5, 5);
    eventType = 'positive';
  }
  
  // Negative indicators
  const negativeKeywords = [
    'hate', 'stupid', 'dumb', 'annoying', 'boring', 'bad',
    'worst', 'terrible', 'awful'
  ];
  
  const negativeCount = negativeKeywords.filter(kw => 
    lowerMessage.includes(kw)
  ).length;
  
  if (negativeCount > 0) {
    scoreChange = -Math.min(negativeCount * 2, 10);
    eventType = 'negative';
  }
  
  // Engagement analysis
  if (message.length < 5 && conversationContext.length > 2) {
    scoreChange -= 0.5; // Very short response = disengagement
    if (eventType === 'neutral') eventType = 'negative';
  }
  
  // Question asking (engagement)
  if (lowerMessage.includes('?')) {
    scoreChange += 0.5;
    if (eventType === 'neutral') eventType = 'positive';
  }
  
  return {
    eventType,
    description: `Message analysis: ${eventType} sentiment`,
    scoreChange
  };
}
```

### Advanced Pattern Recognition

```typescript
function analyzeAdvancedSentiment(
  message: string,
  conversationContext: ChatMessage[]
): RelationshipEvent {
  // Pattern: "I love/hate [character]"
  const lovePattern = /i\s+(love|adore|like)\s+(you|talking|chatting)/i;
  const hatePattern = /i\s+(hate|dislike|don't\s+like)\s+(you|talking|chatting)/i;
  
  if (lovePattern.test(message)) {
    return {
      eventType: 'positive',
      description: 'User expressed love/appreciation',
      scoreChange: 5
    };
  }
  
  if (hatePattern.test(message)) {
    return {
      eventType: 'negative',
      description: 'User expressed dislike',
      scoreChange: -12
    };
  }
  
  // Pattern: Apologies
  if (/sorry|apologize|my\s+bad/i.test(message)) {
    return {
      eventType: 'positive',
      description: 'User apologized',
      scoreChange: 2
    };
  }
  
  // ... more patterns
}
```

## UI Considerations

### Relationship Indicator

Display relationship status to user:
- Visual indicator (heart meter, relationship bar)
- Current tier name
- Relationship score (optional)

### Relationship Insights

Show users:
- "Your relationship is growing stronger!"
- "You've been friends for 30 days"
- "You've had 50 positive interactions"

### Relationship Repair Suggestions

If relationship is negative:
- "Try being more positive to improve your relationship"
- "Apologizing can help repair your relationship"

## Testing Strategy

### Unit Tests
- Sentiment analysis accuracy
- Score calculation
- Tier determination
- Score decay

### Integration Tests
- Relationship updates in database
- Grok response adaptation
- Conversation flow with different tiers

### User Testing
- Test with real conversations
- Monitor relationship evolution
- Gather feedback on character behavior

## Future Enhancements

1. **Relationship Milestones**: Special events at certain scores
2. **Relationship Gifts**: Unlock features based on relationship
3. **Relationship History**: Visual timeline of relationship
4. **Multiple Relationships**: Different characters, different relationships
5. **Relationship Repair Quests**: Structured ways to improve relationships
6. **Relationship Analytics**: Insights into relationship patterns
7. **Emotional States**: Character's emotional state affects responses
8. **Relationship Memory**: Character remembers relationship-defining moments

## Notes

- **Balance**: Don't make relationships too sensitive (every message shouldn't drastically change score)
- **Recovery**: Allow relationships to recover from negative interactions
- **Context**: Consider conversation context, not just individual messages
- **Privacy**: Relationship data is user-specific and private
- **Fairness**: Don't penalize users for misunderstandings or typos
- **Transparency**: Users should understand how relationships work (optional)

---

This system transforms the character from a simple action player into a dynamic, evolving companion whose relationship with the user grows and changes based on every interaction. The character becomes a unique entity with whom users build meaningful, personalized relationships over time.

