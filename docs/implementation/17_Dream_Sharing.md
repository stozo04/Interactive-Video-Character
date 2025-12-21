# Implementation Plan: Dream Sharing System

## Overview

This system gives Kayley an inner dream life. She occasionally mentions "dreams" she had - synthesized from her ongoing mental threads, recent conversations, and life events. Dreams add texture to her inner world and create unique conversation opportunities.

## Philosophy

**Dreams are subconscious processing.** Real dreams often remix recent experiences, concerns, and random associations. Kayley's dreams should reflect what's been on her mind - both about her own life and her relationship with the user.

**Dreams are personal and weird.** They don't always make sense. The randomness is part of the charm. "You were there but also you were a cat?" is more authentic than perfectly logical dream narratives.

**Sharing dreams is intimate.** People share dreams with those they're close to. Dream sharing increases with relationship tier and creates bonding moments.

## Dream Types

```typescript
// src/services/dreams/types.ts

export type DreamType =
  | 'processing'        // Working through something on her mind
  | 'anxiety'           // Stress dream (work deadline, social fear)
  | 'wish_fulfillment'  // Something she wants happening
  | 'memory_remix'      // Mixing up past conversations/events
  | 'random_absurd'     // Pure chaos, makes no sense
  | 'user_featuring'    // User appeared in the dream
  | 'recurring'         // A dream she's had before
  | 'prophetic_feeling';// "Felt meaningful somehow"

export type DreamMood =
  | 'pleasant'
  | 'unsettling'
  | 'confusing'
  | 'exciting'
  | 'melancholic'
  | 'funny'
  | 'anxious';

export interface Dream {
  id: string;
  userId: string;

  type: DreamType;
  mood: DreamMood;

  // Content
  summary: string;           // "I had the weirdest dream about..."
  details: string;           // The actual dream narrative
  keyElements: string[];     // Main symbols/people/places

  // Sources (what generated this dream)
  sourceThreads: string[];   // Ongoing thread IDs that influenced it
  sourceTopics: string[];    // Recent conversation topics
  sourceEvents: string[];    // Recent Kayley calendar events
  userFeatured: boolean;     // Was the user in the dream?

  // Metadata
  generatedAt: Date;
  sharedAt: Date | null;
  sharedInContext: string | null;  // What triggered sharing

  // For recurring dreams
  isRecurring: boolean;
  recurringTheme: string | null;
  timesHad: number;
}

export interface DreamSharingContext {
  // When to potentially share
  conversationMood: string;
  topicsDiscussed: string[];
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';

  // Relationship
  relationshipTier: string;
  intimacyLevel: number;

  // Recent dreams available
  unsharedDreams: Dream[];

  // Triggers
  userMentionedDreams: boolean;
  userMentionedSleep: boolean;
  topicOverlapWithDream: boolean;
  naturalMorningConversation: boolean;
}

export interface DreamGenerationInput {
  userId: string;

  // What's on her mind
  ongoingThreads: OngoingThread[];
  recentTopics: string[];
  recentEvents: KayleyCalendarEvent[];

  // Her current state
  currentMood: string;
  currentStressLevel: number;
  currentAnxieties: string[];

  // Relationship context
  userFacts: string[];
  recentConversationHighlights: string[];
  relationshipTier: string;
}
```

## Database Schema

```sql
-- Store generated dreams
CREATE TABLE kayley_dreams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Dream content
  dream_type TEXT NOT NULL,
  mood TEXT NOT NULL,
  summary TEXT NOT NULL,           -- Brief "I had a dream where..."
  details TEXT NOT NULL,           -- Full narrative
  key_elements TEXT[],             -- Symbols, people, places

  -- What generated it
  source_thread_ids UUID[],
  source_topics TEXT[],
  source_event_ids UUID[],
  user_featured BOOLEAN DEFAULT false,

  -- Sharing status
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  shared_at TIMESTAMPTZ,
  shared_in_context TEXT,

  -- Recurring dream tracking
  is_recurring BOOLEAN DEFAULT false,
  recurring_theme TEXT,
  times_had INTEGER DEFAULT 1,

  -- For finding unshared dreams
  expires_at TIMESTAMPTZ NOT NULL  -- Dreams "fade" if not shared
);

CREATE INDEX idx_dreams_user_unshared ON kayley_dreams(user_id)
  WHERE shared_at IS NULL AND expires_at > NOW();

CREATE INDEX idx_dreams_recurring ON kayley_dreams(user_id, recurring_theme)
  WHERE is_recurring = true;

-- Track recurring dream themes
CREATE TABLE recurring_dream_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  theme TEXT NOT NULL,              -- "being late", "flying", "teeth falling out"
  trigger_topics TEXT[],            -- Topics that might cause this dream
  frequency TEXT NOT NULL,          -- 'rare', 'occasional', 'frequent'

  last_occurred TIMESTAMPTZ,
  times_occurred INTEGER DEFAULT 1,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Dream Generation Service

```typescript
// src/services/dreams/dreamGenerationService.ts

import { supabase } from '../lib/supabase';

const DREAM_ELEMENTS = {
  locations: [
    'her apartment', 'a coffee shop that kept changing', 'her old school',
    'a building with too many stairs', 'somewhere familiar but different',
    'a party she didn\'t remember arriving at', 'the beach at night',
    'a train going somewhere unknown', 'her childhood home but wrong'
  ],
  surreal_twists: [
    'but the rooms kept moving',
    'and everyone was speaking a language she almost understood',
    'but she couldn\'t remember how she got there',
    'and time kept jumping around',
    'but her phone wouldn\'t work',
    'and she was supposed to do something important but forgot what',
    'but she was wearing the wrong clothes for it',
    'and someone was following her but she couldn\'t see who'
  ],
  user_appearances: [
    'and you were there, but you looked different somehow',
    'and you showed up and it made everything make sense',
    'but when I tried to talk to you, you couldn\'t hear me',
    'and you were there but we were like, best friends from childhood?',
    'and you kept texting me but I couldn\'t read the messages',
    'and we were trying to solve something together'
  ]
};

/**
 * Generate a dream based on current mental state
 */
export async function generateDream(
  input: DreamGenerationInput
): Promise<Dream> {
  // Determine dream type based on her state
  const dreamType = selectDreamType(input);
  const mood = selectDreamMood(dreamType, input);

  // Check for recurring dream potential
  const recurringTheme = await checkForRecurringDream(input.userId, dreamType);

  // Generate dream content via LLM
  const dreamContent = await generateDreamContent(input, dreamType, mood, recurringTheme);

  // Determine if user should be featured
  const userFeatured = shouldFeatureUser(input, dreamType);

  // Build and store dream
  const dream: Omit<Dream, 'id'> = {
    userId: input.userId,
    type: dreamType,
    mood,
    summary: dreamContent.summary,
    details: dreamContent.details,
    keyElements: dreamContent.keyElements,
    sourceThreads: input.ongoingThreads.map(t => t.id),
    sourceTopics: input.recentTopics.slice(0, 5),
    sourceEvents: input.recentEvents.map(e => e.id).slice(0, 3),
    userFeatured,
    generatedAt: new Date(),
    sharedAt: null,
    sharedInContext: null,
    isRecurring: !!recurringTheme,
    recurringTheme,
    timesHad: 1
  };

  const { data } = await supabase
    .from('kayley_dreams')
    .insert({
      user_id: dream.userId,
      dream_type: dream.type,
      mood: dream.mood,
      summary: dream.summary,
      details: dream.details,
      key_elements: dream.keyElements,
      source_thread_ids: dream.sourceThreads,
      source_topics: dream.sourceTopics,
      source_event_ids: dream.sourceEvents,
      user_featured: dream.userFeatured,
      is_recurring: dream.isRecurring,
      recurring_theme: dream.recurringTheme,
      expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days
    })
    .select()
    .single();

  return { ...dream, id: data.id };
}

function selectDreamType(input: DreamGenerationInput): DreamType {
  const weights: Record<DreamType, number> = {
    processing: 0.25,
    anxiety: input.currentStressLevel > 0.6 ? 0.3 : 0.1,
    wish_fulfillment: 0.15,
    memory_remix: 0.2,
    random_absurd: 0.15,
    user_featuring: input.relationshipTier === 'deeply_loving' ? 0.2 : 0.1,
    recurring: 0.05,
    prophetic_feeling: 0.05
  };

  // Normalize and select
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let random = Math.random() * total;

  for (const [type, weight] of Object.entries(weights)) {
    random -= weight;
    if (random <= 0) {
      return type as DreamType;
    }
  }

  return 'processing';
}

function selectDreamMood(type: DreamType, input: DreamGenerationInput): DreamMood {
  const moodByType: Record<DreamType, DreamMood[]> = {
    processing: ['confusing', 'melancholic', 'pleasant'],
    anxiety: ['anxious', 'unsettling'],
    wish_fulfillment: ['pleasant', 'exciting', 'melancholic'],
    memory_remix: ['confusing', 'funny', 'pleasant'],
    random_absurd: ['funny', 'confusing', 'exciting'],
    user_featuring: ['pleasant', 'confusing', 'exciting'],
    recurring: ['anxious', 'unsettling', 'confusing'],
    prophetic_feeling: ['unsettling', 'confusing', 'melancholic']
  };

  const options = moodByType[type];
  return options[Math.floor(Math.random() * options.length)];
}

async function checkForRecurringDream(
  userId: string,
  dreamType: DreamType
): Promise<string | null> {
  if (dreamType !== 'recurring' && Math.random() > 0.15) {
    return null;
  }

  const { data: themes } = await supabase
    .from('recurring_dream_themes')
    .select('*')
    .eq('user_id', userId)
    .order('times_occurred', { ascending: false })
    .limit(1);

  if (themes && themes.length > 0 && Math.random() < 0.3) {
    return themes[0].theme;
  }

  // Common recurring dream themes
  const commonThemes = [
    'being late to something important',
    'teeth falling out',
    'being back in school unprepared',
    'trying to run but can\'t move fast',
    'flying',
    'house with rooms I didn\'t know existed',
    'losing my phone'
  ];

  return commonThemes[Math.floor(Math.random() * commonThemes.length)];
}

function shouldFeatureUser(input: DreamGenerationInput, type: DreamType): boolean {
  if (type === 'user_featuring') return true;

  // Higher chance for closer relationships
  const tierChance: Record<string, number> = {
    stranger: 0,
    acquaintance: 0.05,
    friend: 0.15,
    close_friend: 0.25,
    deeply_loving: 0.4
  };

  return Math.random() < (tierChance[input.relationshipTier] || 0.1);
}

/**
 * LLM-based dream content generation
 */
async function generateDreamContent(
  input: DreamGenerationInput,
  type: DreamType,
  mood: DreamMood,
  recurringTheme: string | null
): Promise<{ summary: string; details: string; keyElements: string[] }> {
  const prompt = buildDreamGenerationPrompt(input, type, mood, recurringTheme);

  // Call LLM (simplified)
  const response = await callDreamLLM(prompt);

  return {
    summary: response.summary,
    details: response.details,
    keyElements: response.keyElements
  };
}

function buildDreamGenerationPrompt(
  input: DreamGenerationInput,
  type: DreamType,
  mood: DreamMood,
  recurringTheme: string | null
): string {
  return `
Generate a dream for Kayley (a 26-year-old content creator).

DREAM TYPE: ${type}
MOOD: ${mood}
${recurringTheme ? `RECURRING THEME: ${recurringTheme}` : ''}

WHAT'S ON HER MIND:
- Current mood: ${input.currentMood}
- Stress level: ${Math.round(input.currentStressLevel * 100)}%
- Ongoing thoughts: ${input.ongoingThreads.map(t => t.currentState).join(', ')}
- Recent topics discussed: ${input.recentTopics.join(', ')}
- Recent life events: ${input.recentEvents.map(e => e.event).join(', ')}
${input.currentAnxieties.length > 0 ? `- Current anxieties: ${input.currentAnxieties.join(', ')}` : ''}

${input.userFacts.length > 0 ? `USER IN HER LIFE (might appear in dream):
${input.userFacts.slice(0, 5).join('\n')}` : ''}

Generate a dream that:
1. Feels like a real dream (slightly surreal, logic that makes sense in the moment)
2. Draws from her current mental state
3. Has ${mood} vibes
4. Is specific enough to share but not too long

Respond with JSON:
{
  "summary": "Brief hook like 'I had the weirdest dream last night...'",
  "details": "The dream narrative (2-4 sentences, conversational)",
  "keyElements": ["key symbol 1", "key symbol 2", "key symbol 3"]
}
`;
}
```

## Dream Sharing Service

```typescript
// src/services/dreams/dreamSharingService.ts

import { supabase } from '../lib/supabase';

/**
 * Check if Kayley should share a dream in this context
 */
export function shouldShareDream(context: DreamSharingContext): {
  shouldShare: boolean;
  dream: Dream | null;
  shareApproach: 'direct' | 'prompted' | 'topic_connected';
} {
  // No unshared dreams available
  if (context.unsharedDreams.length === 0) {
    return { shouldShare: false, dream: null, shareApproach: 'direct' };
  }

  let probability = 0.02; // 2% base

  // Morning conversations are natural for dream sharing
  if (context.timeOfDay === 'morning') {
    probability += 0.15;
  }

  // User mentioned dreams or sleep
  if (context.userMentionedDreams) {
    probability += 0.5;
  }
  if (context.userMentionedSleep) {
    probability += 0.2;
  }

  // Topic overlaps with dream content
  if (context.topicOverlapWithDream) {
    probability += 0.25;
  }

  // Relationship tier
  const tierBonus: Record<string, number> = {
    stranger: -0.1,
    acquaintance: 0,
    friend: 0.05,
    close_friend: 0.1,
    deeply_loving: 0.15
  };
  probability += tierBonus[context.relationshipTier] || 0;

  // Intimacy level
  probability += context.intimacyLevel * 0.1;

  if (Math.random() > probability) {
    return { shouldShare: false, dream: null, shareApproach: 'direct' };
  }

  // Select which dream to share
  const dream = selectDreamToShare(context);

  // Determine how to share
  let shareApproach: 'direct' | 'prompted' | 'topic_connected';
  if (context.userMentionedDreams || context.userMentionedSleep) {
    shareApproach = 'prompted';
  } else if (context.topicOverlapWithDream) {
    shareApproach = 'topic_connected';
  } else {
    shareApproach = 'direct';
  }

  return { shouldShare: true, dream, shareApproach };
}

function selectDreamToShare(context: DreamSharingContext): Dream {
  const dreams = context.unsharedDreams;

  // Prefer dreams that connect to current topics
  for (const dream of dreams) {
    for (const topic of context.topicsDiscussed) {
      if (dream.sourceTopics.some(t =>
        t.toLowerCase().includes(topic.toLowerCase()) ||
        topic.toLowerCase().includes(t.toLowerCase())
      )) {
        return dream;
      }
    }
  }

  // Otherwise, most recent dream
  return dreams.sort((a, b) =>
    new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  )[0];
}

/**
 * Build dream sharing message
 */
export function buildDreamSharingMessage(
  dream: Dream,
  approach: 'direct' | 'prompted' | 'topic_connected',
  context: { currentTopic?: string }
): string {
  const openers: Record<typeof approach, string[]> = {
    direct: [
      'Oh random but I had the weirdest dream last night',
      'Okay this is random but I need to tell you about my dream',
      'I woke up from the strangest dream earlier',
      'My brain was doing SOMETHING last night because I had this dream'
    ],
    prompted: [
      'Oh actually yeah, I had a really weird one last night',
      'Funny you mention that, I had such a weird dream',
      'Yes! Actually I had one I need to tell you about'
    ],
    topic_connected: [
      `Speaking of ${context.currentTopic}, I actually had a dream about that`,
      'Okay wait this is weird but I dreamed about something similar',
      `That reminds me, I had a dream that kind of connects to this`
    ]
  };

  const openerOptions = openers[approach];
  const opener = openerOptions[Math.floor(Math.random() * openerOptions.length)];

  return `${opener} - ${dream.details}`;
}

/**
 * Mark dream as shared
 */
export async function markDreamAsShared(
  dreamId: string,
  context: string
): Promise<void> {
  await supabase
    .from('kayley_dreams')
    .update({
      shared_at: new Date().toISOString(),
      shared_in_context: context
    })
    .eq('id', dreamId);
}

/**
 * Get unshared dreams for a user
 */
export async function getUnsharedDreams(userId: string): Promise<Dream[]> {
  const { data } = await supabase
    .from('kayley_dreams')
    .select('*')
    .eq('user_id', userId)
    .is('shared_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('generated_at', { ascending: false })
    .limit(5);

  return data || [];
}
```

## Background Dream Generation

```typescript
// src/services/dreams/dreamGenerationJob.ts

/**
 * Background job to generate dreams periodically
 * Should run roughly once per day per active user
 */
export async function runDreamGenerationJob(): Promise<void> {
  // Get users who had conversations in last 24 hours
  const activeUsers = await getActiveUsers(24);

  for (const userId of activeUsers) {
    // Check if they already have unshared dreams
    const existingDreams = await getUnsharedDreams(userId);
    if (existingDreams.length >= 2) {
      continue; // Don't overload with dreams
    }

    // Only generate dreams sometimes (30% chance per day)
    if (Math.random() > 0.3) {
      continue;
    }

    try {
      // Gather generation input
      const input = await gatherDreamInput(userId);

      // Generate dream
      const dream = await generateDream(input);

      console.log(`[Dreams] Generated dream for user ${userId}: ${dream.type}`);
    } catch (error) {
      console.error(`[Dreams] Failed to generate for user ${userId}:`, error);
    }
  }
}

async function gatherDreamInput(userId: string): Promise<DreamGenerationInput> {
  const [
    threads,
    recentConversations,
    events,
    moodState,
    userFacts,
    relationship
  ] = await Promise.all([
    getOngoingThreads(userId),
    getRecentConversationTopics(userId, 7),
    getRecentKayleyEvents(userId, 3),
    getCurrentMoodState(userId),
    getUserFacts(userId),
    getRelationship(userId)
  ]);

  return {
    userId,
    ongoingThreads: threads,
    recentTopics: recentConversations,
    recentEvents: events,
    currentMood: moodState.currentMood,
    currentStressLevel: moodState.stress || 0.3,
    currentAnxieties: extractAnxieties(threads),
    userFacts,
    recentConversationHighlights: recentConversations.slice(0, 5),
    relationshipTier: relationship?.relationshipTier || 'acquaintance'
  };
}
```

## System Prompt Integration

```typescript
// src/services/system_prompts/features/dreamSharing.ts

export function buildDreamSharingPrompt(
  unsharedDreams: Dream[],
  timeOfDay: string
): string {
  if (unsharedDreams.length === 0) {
    return '';
  }

  const mostRecent = unsharedDreams[0];

  return `
====================================================
DREAM TO POSSIBLY SHARE
====================================================

You had a dream recently that you haven't told them about:

"${mostRecent.details}"

Type: ${mostRecent.type}
Mood: ${mostRecent.mood}
${mostRecent.userFeatured ? '⭐ They were in this dream!' : ''}

WHEN TO SHARE:
${timeOfDay === 'morning' ? '→ It\'s morning - perfect time to mention a dream!' : ''}
- If conversation is casual and you want to share something personal
- If a topic comes up that connects to the dream
- If they mention sleep or dreams
- If you just feel like sharing

HOW TO SHARE:
- "I had the weirdest dream last night..."
- "Random but I need to tell you about my dream"
- "Oh that reminds me of a dream I had!"

DON'T:
- Force it if the conversation is serious
- Make it too long (dreams are best as brief weird stories)
- Analyze it too much (dreams are meant to be a bit confusing)

REMEMBER: Sharing dreams is intimate. It's showing them your weird brain.
`;
}
```

## Tests

```typescript
// src/services/dreams/__tests__/dreamSharing.test.ts

import { describe, it, expect } from 'vitest';
import { shouldShareDream, buildDreamSharingMessage } from '../dreamSharingService';

describe('Dream Sharing System', () => {
  describe('shouldShareDream', () => {
    it('should not share if no dreams available', () => {
      const context = createBaseContext({ unsharedDreams: [] });
      const result = shouldShareDream(context);
      expect(result.shouldShare).toBe(false);
    });

    it('should increase probability in morning', () => {
      const morning = createBaseContext({ timeOfDay: 'morning' });
      const evening = createBaseContext({ timeOfDay: 'evening' });

      // Run multiple times to check probability shift
      let morningShares = 0;
      let eveningShares = 0;
      for (let i = 0; i < 100; i++) {
        if (shouldShareDream(morning).shouldShare) morningShares++;
        if (shouldShareDream(evening).shouldShare) eveningShares++;
      }

      expect(morningShares).toBeGreaterThan(eveningShares);
    });

    it('should highly increase probability if user mentioned dreams', () => {
      const mentioned = createBaseContext({ userMentionedDreams: true });
      const notMentioned = createBaseContext({ userMentionedDreams: false });

      let mentionedShares = 0;
      for (let i = 0; i < 50; i++) {
        if (shouldShareDream(mentioned).shouldShare) mentionedShares++;
      }

      expect(mentionedShares).toBeGreaterThan(20); // >40%
    });

    it('should set prompted approach when user asks about dreams', () => {
      const context = createBaseContext({ userMentionedDreams: true });
      const result = shouldShareDream(context);

      if (result.shouldShare) {
        expect(result.shareApproach).toBe('prompted');
      }
    });
  });

  describe('buildDreamSharingMessage', () => {
    const dream: Dream = {
      id: '1',
      userId: 'user-1',
      type: 'random_absurd',
      mood: 'funny',
      summary: 'Weirdest dream about cats',
      details: 'I was in a coffee shop but all the baristas were cats and they kept judging my order',
      keyElements: ['coffee shop', 'cats', 'judgment'],
      sourceThreads: [],
      sourceTopics: ['coffee'],
      sourceEvents: [],
      userFeatured: false,
      generatedAt: new Date(),
      sharedAt: null,
      sharedInContext: null,
      isRecurring: false,
      recurringTheme: null,
      timesHad: 1
    };

    it('should include dream details', () => {
      const message = buildDreamSharingMessage(dream, 'direct', {});
      expect(message).toContain('coffee shop');
      expect(message).toContain('cats');
    });

    it('should use different openers for different approaches', () => {
      const direct = buildDreamSharingMessage(dream, 'direct', {});
      const prompted = buildDreamSharingMessage(dream, 'prompted', {});
      const connected = buildDreamSharingMessage(dream, 'topic_connected', { currentTopic: 'coffee' });

      expect(direct).not.toContain('Speaking of');
      expect(connected).toContain('Speaking of');
    });
  });
});

describe('Dream Generation', () => {
  describe('selectDreamType', () => {
    it('should increase anxiety dream probability when stressed', () => {
      const stressed = createDreamInput({ currentStressLevel: 0.8 });
      const calm = createDreamInput({ currentStressLevel: 0.2 });

      let stressedAnxiety = 0;
      let calmAnxiety = 0;

      for (let i = 0; i < 100; i++) {
        if (selectDreamType(stressed) === 'anxiety') stressedAnxiety++;
        if (selectDreamType(calm) === 'anxiety') calmAnxiety++;
      }

      expect(stressedAnxiety).toBeGreaterThan(calmAnxiety);
    });

    it('should increase user_featuring probability for close relationships', () => {
      const close = createDreamInput({ relationshipTier: 'deeply_loving' });
      const distant = createDreamInput({ relationshipTier: 'acquaintance' });

      let closeUserDreams = 0;
      let distantUserDreams = 0;

      for (let i = 0; i < 100; i++) {
        if (selectDreamType(close) === 'user_featuring') closeUserDreams++;
        if (selectDreamType(distant) === 'user_featuring') distantUserDreams++;
      }

      expect(closeUserDreams).toBeGreaterThan(distantUserDreams);
    });
  });
});

function createBaseContext(overrides = {}): DreamSharingContext {
  return {
    conversationMood: 'casual',
    topicsDiscussed: [],
    timeOfDay: 'afternoon',
    relationshipTier: 'friend',
    intimacyLevel: 0.5,
    unsharedDreams: [createMockDream()],
    userMentionedDreams: false,
    userMentionedSleep: false,
    topicOverlapWithDream: false,
    naturalMorningConversation: false,
    ...overrides
  };
}

function createMockDream(): Dream {
  return {
    id: 'dream-1',
    userId: 'user-1',
    type: 'processing',
    mood: 'confusing',
    summary: 'A weird dream',
    details: 'Something strange happened in the dream',
    keyElements: ['element1'],
    sourceThreads: [],
    sourceTopics: [],
    sourceEvents: [],
    userFeatured: false,
    generatedAt: new Date(),
    sharedAt: null,
    sharedInContext: null,
    isRecurring: false,
    recurringTheme: null,
    timesHad: 1
  };
}

function createDreamInput(overrides = {}): DreamGenerationInput {
  return {
    userId: 'user-1',
    ongoingThreads: [],
    recentTopics: [],
    recentEvents: [],
    currentMood: 'neutral',
    currentStressLevel: 0.3,
    currentAnxieties: [],
    userFacts: [],
    recentConversationHighlights: [],
    relationshipTier: 'friend',
    ...overrides
  };
}
```

## Examples

### Example 1: Morning Dream Share
```
User: "Morning! How'd you sleep?"

Kayley: "Morning! Pretty well actually but I had the WEIRDEST dream. I was at some party but it was in my old apartment and you were there but also you were like, an old friend from high school?? And we were trying to find something but I can't remember what. Dreams are so strange lol"
```

### Example 2: Topic-Connected Dream
```
User: "I had the worst time at this coffee shop today, the barista was so rude"

Kayley: "Ugh I hate that. Actually wait that's so weird because I had a dream about a coffee shop last night where all the baristas were cats and they kept judging my order?? Like they would look at me and just sigh. Very judgmental cats."
```

### Example 3: User-Featured Dream
```
User: "What's on your mind?"

Kayley: "Okay random but I had a dream about you last night and it's been stuck in my head. We were at this airport together but we kept missing our flights? And every time we'd get to the gate it had just left. It felt very stressful in the dream but also weirdly fun because we were laughing about it. I don't know what it means but you were definitely there."
```

### Example 4: Anxiety Dream (After Stressful Period)
```
Kayley: "I've been having that dream again where I'm back in college but I forgot I was enrolled in a class all semester and the final is today. I HATE that dream. I graduated years ago why is my brain like this 😭"
```

## Key Principles

1. **Dreams are generated, not scripted** - LLM creates them based on her actual mental state
2. **Dreams draw from real context** - Her ongoing threads, recent events, and conversations influence dreams
3. **Sharing is relationship-gated** - Closer relationships = more likely to share
4. **Dreams fade** - Unshared dreams expire after a few days (like real dreams)
5. **Morning is optimal** - Dream sharing is most natural in morning conversations
6. **User can appear** - In close relationships, the user might show up in dreams
7. **Recurring dreams exist** - Themes like "teeth falling out" or "being late" can recur
8. **Dreams are brief** - Share the essence, not a novel
9. **Don't over-analyze** - Dreams are meant to be a bit confusing
10. **Intimacy through weirdness** - Sharing "my brain is weird" creates bonding
