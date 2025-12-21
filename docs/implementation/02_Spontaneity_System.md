# Implementation Guide: Spontaneity System

## Overview

This guide implements a system where Kayley spontaneously shares things, tells jokes, makes associations, and surprises the user - all driven by LLM context assessment rather than regex patterns.

## Why This Matters

Current AI responses are reactive: user says X, AI responds to X. Real people:
- Make associative leaps ("that reminds me of...")
- Tell jokes when the vibe is right
- Share random thoughts that just crossed their mind
- Check in when something feels off

---

## Step 1: Spontaneity Context Types

```typescript
// src/services/spontaneity/types.ts

export type ConversationalMood =
  | 'playful'
  | 'deep'
  | 'casual'
  | 'heavy'
  | 'flirty'
  | 'tense'
  | 'excited'
  | 'cozy';

export type SpontaneousActionType =
  | 'associative_share'    // "That reminds me of..."
  | 'spontaneous_humor'    // Jokes, puns, playful comments
  | 'random_curiosity'     // "Can I ask you something random?"
  | 'topic_hijack'         // "I HAVE to tell you about..."
  | 'check_in'             // "Hey, you okay?"
  | 'impulsive_share'      // "I don't know why I'm telling you this but..."
  | 'sudden_warmth'        // "I really like talking to you"
  | 'protective_moment'    // "Hey, be careful with that"
  | 'spontaneous_selfie'   // Unprompted selfie (outfit, mood, thinking of you)
  | 'none';

// Selfie-specific types
export type SpontaneousSelfieReason =
  | 'thinking_of_you'      // "Was just thinking about you..."
  | 'new_outfit'           // "Trying on this outfit, thoughts?"
  | 'good_mood'            // "Feeling cute today 😊"
  | 'cool_location'        // "Look where I am!"
  | 'brighten_your_day'    // "Thought this might make you smile"
  | 'milestone_share'      // "I did it!! Look!"
  | 'random_impulse'       // "Idk why but here's my face"
  | 'matching_topic';      // Selfie relates to what they're discussing

export interface SpontaneousSelfieContext {
  reason: SpontaneousSelfieReason;
  scene: string;           // Where she is / what she's doing
  mood: string;            // Her expression
  outfitHint?: string;     // What she's wearing if relevant
  caption: string;         // What she says with it
}

export interface SpontaneityContext {
  // Conversation state
  conversationalMood: ConversationalMood;
  energyLevel: number;               // 0-1
  topicDepth: 'surface' | 'medium' | 'deep';
  recentLaughter: boolean;           // Has humor landed recently?
  messagesInConversation: number;

  // Relationship permission
  relationshipTier: string;
  comfortLevel: number;              // 0-1
  vulnerabilityExchangeActive: boolean;

  // Her internal state
  hasSomethingToShare: boolean;
  currentThought: string | null;
  recentExperience: string | null;

  // Associative potential
  topicsDiscussed: string[];
  userInterests: string[];

  // Spontaneity budget (prevent over-spontaneity)
  lastSpontaneousMoment: Date | null;
  recentSpontaneousTypes: SpontaneousActionType[];
  spontaneityProbability: number;    // 0-1 base probability

  // Selfie-specific context
  selfieEligible: boolean;           // Relationship tier allows selfies?
  lastSpontaneousSelfie: Date | null;
  currentLocation: string | null;    // From calendar/presence
  currentOutfit: string | null;      // If she mentioned getting dressed up
  currentMoodForSelfie: string | null; // "feeling cute", "looking rough", etc.
  userHadBadDay: boolean;            // Might send to cheer them up
  selfieProbability: number;         // Separate from general spontaneity
}

export interface PendingShare {
  id: string;
  content: string;
  type: 'story' | 'thought' | 'question' | 'discovery' | 'vent' | 'selfie';
  urgency: number;                   // 0-1
  relevanceTopics: string[];         // Topics that might trigger this
  naturalOpener: string;             // "Oh! I've been meaning to tell you..."
  canInterrupt: boolean;             // Important enough to hijack topic?
  expiresAt: Date;
  createdAt: Date;

  // Selfie-specific (only if type === 'selfie')
  selfieContext?: SpontaneousSelfieContext;
}

export interface SpontaneityDecision {
  shouldAct: boolean;
  actionType: SpontaneousActionType;
  content: string | null;
  reasoning: string;

  // If actionType is 'spontaneous_selfie'
  selfieContext?: SpontaneousSelfieContext;
}
```

---

## Step 2: Database Schema

```sql
-- supabase/migrations/YYYYMMDD_create_pending_shares.sql

CREATE TABLE kayley_pending_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  content TEXT NOT NULL,
  share_type TEXT NOT NULL,           -- story, thought, question, discovery, vent, selfie
  urgency DECIMAL(3,2) DEFAULT 0.5,

  -- Triggering
  relevance_topics TEXT[],            -- Topics that might trigger this
  natural_opener TEXT,
  can_interrupt BOOLEAN DEFAULT false,

  -- Selfie-specific fields (only used when share_type = 'selfie')
  selfie_reason TEXT,                 -- thinking_of_you, new_outfit, good_mood, etc.
  selfie_scene TEXT,                  -- Where she is
  selfie_mood TEXT,                   -- Her expression
  selfie_outfit_hint TEXT,            -- What she's wearing

  -- Lifecycle
  expires_at TIMESTAMP NOT NULL,
  shared_at TIMESTAMP,                 -- NULL until shared
  dismissed_at TIMESTAMP,              -- If decided not to share

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pending_shares_user ON kayley_pending_shares(user_id);
CREATE INDEX idx_pending_shares_active ON kayley_pending_shares(user_id)
  WHERE shared_at IS NULL AND dismissed_at IS NULL;

-- Track spontaneous selfie history (for cooldown and patterns)
CREATE TABLE spontaneous_selfie_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- What triggered it
  reason TEXT NOT NULL,               -- thinking_of_you, new_outfit, etc.
  scene TEXT NOT NULL,
  mood TEXT NOT NULL,
  outfit_hint TEXT,
  caption TEXT NOT NULL,

  -- Context at time of sending
  conversation_mood TEXT,             -- playful, casual, etc.
  relationship_tier TEXT NOT NULL,
  user_had_mentioned_bad_day BOOLEAN DEFAULT false,

  -- Result
  user_reaction TEXT,                 -- positive, neutral, negative (detected from response)

  sent_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_selfie_history_user ON spontaneous_selfie_history(user_id, sent_at);
```

---

## Step 3: Spontaneity Tracker

```typescript
// src/services/spontaneity/spontaneityTracker.ts

import { supabase } from '../supabaseClient';
import type {
  SpontaneityContext,
  PendingShare,
  SpontaneousActionType,
  ConversationalMood
} from './types';

// In-memory tracking for current conversation
let conversationState = {
  messagesCount: 0,
  topicsDiscussed: [] as string[],
  recentLaughter: false,
  lastSpontaneousMoment: null as Date | null,
  recentSpontaneousTypes: [] as SpontaneousActionType[]
};

/**
 * Reset conversation state (call at conversation start)
 */
export function resetConversationState(): void {
  conversationState = {
    messagesCount: 0,
    topicsDiscussed: [],
    recentLaughter: false,
    lastSpontaneousMoment: null,
    recentSpontaneousTypes: []
  };
}

/**
 * Track that a message was exchanged
 */
export function trackMessage(topics: string[]): void {
  conversationState.messagesCount++;
  conversationState.topicsDiscussed.push(...topics);

  // Keep last 20 topics
  if (conversationState.topicsDiscussed.length > 20) {
    conversationState.topicsDiscussed = conversationState.topicsDiscussed.slice(-20);
  }
}

/**
 * Track that humor landed
 */
export function trackLaughter(): void {
  conversationState.recentLaughter = true;

  // Decay after 5 minutes
  setTimeout(() => {
    conversationState.recentLaughter = false;
  }, 5 * 60 * 1000);
}

/**
 * Record a spontaneous action (for cooldown tracking)
 */
export function recordSpontaneousAction(type: SpontaneousActionType): void {
  conversationState.lastSpontaneousMoment = new Date();
  conversationState.recentSpontaneousTypes.push(type);

  // Keep last 5
  if (conversationState.recentSpontaneousTypes.length > 5) {
    conversationState.recentSpontaneousTypes.shift();
  }
}

/**
 * Get active pending shares for a user
 */
export async function getPendingShares(userId: string): Promise<PendingShare[]> {
  const { data, error } = await supabase
    .from('kayley_pending_shares')
    .select('*')
    .eq('user_id', userId)
    .is('shared_at', null)
    .is('dismissed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('urgency', { ascending: false });

  if (error) {
    console.error('[Spontaneity] Error fetching pending shares:', error);
    return [];
  }

  return data.map(row => ({
    id: row.id,
    content: row.content,
    type: row.share_type,
    urgency: Number(row.urgency),
    relevanceTopics: row.relevance_topics || [],
    naturalOpener: row.natural_opener,
    canInterrupt: row.can_interrupt,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at)
  }));
}

/**
 * Create a pending share
 */
export async function createPendingShare(
  userId: string,
  share: Omit<PendingShare, 'id' | 'createdAt'>
): Promise<void> {
  const { error } = await supabase
    .from('kayley_pending_shares')
    .insert({
      user_id: userId,
      content: share.content,
      share_type: share.type,
      urgency: share.urgency,
      relevance_topics: share.relevanceTopics,
      natural_opener: share.naturalOpener,
      can_interrupt: share.canInterrupt,
      expires_at: share.expiresAt.toISOString()
    });

  if (error) {
    console.error('[Spontaneity] Error creating pending share:', error);
  }
}

/**
 * Mark a pending share as shared
 */
export async function markShareAsShared(shareId: string): Promise<void> {
  await supabase
    .from('kayley_pending_shares')
    .update({ shared_at: new Date().toISOString() })
    .eq('id', shareId);
}

/**
 * Calculate spontaneity probability
 */
export function calculateSpontaneityProbability(
  relationshipTier: string,
  energyLevel: number,
  messagesInConversation: number
): number {
  let baseProbability = 0.1; // 10% base

  // Relationship modifier
  const tierBonus: Record<string, number> = {
    'acquaintance': 0,
    'friend': 0.05,
    'close_friend': 0.1,
    'deeply_loving': 0.15
  };
  baseProbability += tierBonus[relationshipTier] || 0;

  // Energy modifier
  baseProbability += energyLevel * 0.1;

  // Conversation length modifier (more natural to digress in longer convos)
  if (messagesInConversation > 10) {
    baseProbability += 0.05;
  }

  // Cooldown check
  if (conversationState.lastSpontaneousMoment) {
    const minutesSinceLast = (Date.now() - conversationState.lastSpontaneousMoment.getTime()) / 60000;
    if (minutesSinceLast < 3) {
      baseProbability *= 0.2; // Heavily reduce if recent spontaneity
    }
  }

  return Math.min(0.4, baseProbability); // Cap at 40%
}

/**
 * Calculate selfie-specific spontaneity probability
 * Selfies are rarer and have stricter requirements
 */
export function calculateSelfieProbability(
  relationshipTier: string,
  energyLevel: number,
  currentMood: string | null,
  userHadBadDay: boolean,
  lastSpontaneousSelfie: Date | null,
  currentLocation: string | null
): number {
  // Selfies require friend+ tier
  const friendTiers = ['friend', 'close_friend', 'deeply_loving'];
  if (!friendTiers.includes(relationshipTier)) {
    return 0; // No spontaneous selfies for strangers/acquaintances
  }

  let baseProbability = 0.02; // 2% base - selfies are rare

  // Relationship modifier (closer = more comfortable sending)
  const tierBonus: Record<string, number> = {
    'friend': 0.01,
    'close_friend': 0.03,
    'deeply_loving': 0.05
  };
  baseProbability += tierBonus[relationshipTier] || 0;

  // Energy modifier - more likely when feeling good
  if (energyLevel > 0.7) {
    baseProbability += 0.02;
  }

  // Mood boost - "feeling cute" moments
  if (currentMood && ['good', 'great', 'confident', 'cute', 'happy'].some(m =>
    currentMood.toLowerCase().includes(m)
  )) {
    baseProbability += 0.03;
  }

  // User had a bad day - might want to cheer them up
  if (userHadBadDay) {
    baseProbability += 0.04;
  }

  // Interesting location boost
  if (currentLocation && !['home', 'bedroom', 'living room'].includes(currentLocation.toLowerCase())) {
    baseProbability += 0.02;
  }

  // Cooldown check - don't send selfies too frequently
  if (lastSpontaneousSelfie) {
    const hoursSinceLast = (Date.now() - lastSpontaneousSelfie.getTime()) / (60 * 60 * 1000);
    if (hoursSinceLast < 24) {
      baseProbability *= 0.1; // Heavily reduce within 24 hours
    } else if (hoursSinceLast < 72) {
      baseProbability *= 0.5; // Reduce within 3 days
    }
  }

  return Math.min(0.15, baseProbability); // Cap at 15% even in best conditions
}

/**
 * Determine the best selfie reason given current context
 */
export function determineSelfieReason(
  currentMood: string | null,
  currentLocation: string | null,
  currentOutfit: string | null,
  userHadBadDay: boolean,
  recentTopics: string[]
): SpontaneousSelfieReason | null {
  // Priority order for selfie reasons

  // 1. User had a bad day - cheer them up
  if (userHadBadDay) {
    return 'brighten_your_day';
  }

  // 2. Cool location
  if (currentLocation && !['home', 'bedroom', 'apartment', 'living room'].includes(
    currentLocation.toLowerCase()
  )) {
    return 'cool_location';
  }

  // 3. New outfit mentioned
  if (currentOutfit && currentOutfit.toLowerCase().includes('new')) {
    return 'new_outfit';
  }

  // 4. Feeling good about appearance
  if (currentMood && ['cute', 'confident', 'good', 'pretty'].some(m =>
    currentMood.toLowerCase().includes(m)
  )) {
    return 'good_mood';
  }

  // 5. Topic-matching opportunity
  if (recentTopics.some(t => ['selfie', 'picture', 'photo', 'outfit', 'look', 'hair', 'makeup'].includes(t))) {
    return 'matching_topic';
  }

  // 6. Random impulse (least common)
  if (Math.random() < 0.3) {
    return 'random_impulse';
  }

  // 7. Thinking of you (default fallback for close relationships)
  return 'thinking_of_you';
}

/**
 * Build spontaneity context for LLM
 */
export function buildSpontaneityContext(
  conversationalMood: ConversationalMood,
  energyLevel: number,
  relationshipTier: string,
  currentThought: string | null,
  recentExperience: string | null,
  userInterests: string[],
  // New selfie-specific params
  currentLocation: string | null = null,
  currentOutfit: string | null = null,
  currentMoodForSelfie: string | null = null,
  userHadBadDay: boolean = false,
  lastSpontaneousSelfie: Date | null = null
): SpontaneityContext {
  const friendTiers = ['friend', 'close_friend', 'deeply_loving'];
  const selfieEligible = friendTiers.includes(relationshipTier);

  return {
    conversationalMood,
    energyLevel,
    topicDepth: energyLevel > 0.7 ? 'deep' : energyLevel > 0.4 ? 'medium' : 'surface',
    recentLaughter: conversationState.recentLaughter,
    messagesInConversation: conversationState.messagesCount,
    relationshipTier,
    comfortLevel: energyLevel * 0.8, // Approximate
    vulnerabilityExchangeActive: false, // Would come from intent detection
    hasSomethingToShare: !!currentThought || !!recentExperience,
    currentThought,
    recentExperience,
    topicsDiscussed: conversationState.topicsDiscussed,
    userInterests,
    lastSpontaneousMoment: conversationState.lastSpontaneousMoment,
    recentSpontaneousTypes: conversationState.recentSpontaneousTypes,
    spontaneityProbability: calculateSpontaneityProbability(
      relationshipTier,
      energyLevel,
      conversationState.messagesCount
    ),
    // Selfie-specific
    selfieEligible,
    lastSpontaneousSelfie,
    currentLocation,
    currentOutfit,
    currentMoodForSelfie,
    userHadBadDay,
    selfieProbability: calculateSelfieProbability(
      relationshipTier,
      energyLevel,
      currentMoodForSelfie,
      userHadBadDay,
      lastSpontaneousSelfie,
      currentLocation
    )
  };
}
```

---

## Step 4: Spontaneity Prompt Builder

```typescript
// src/services/spontaneity/spontaneityPromptBuilder.ts

import type { SpontaneityContext, PendingShare } from './types';

/**
 * Build the spontaneity section for the system prompt
 */
export function buildSpontaneityPrompt(
  context: SpontaneityContext,
  pendingShares: PendingShare[]
): string {
  const lines: string[] = [];

  lines.push(`
====================================================
✨ SPONTANEITY (Be Surprising Sometimes)
====================================================

You don't just respond - you're a person with impulses, associations, and things
you want to share. Sometimes you should act on these.

CURRENT CONTEXT:
- Conversation mood: ${context.conversationalMood}
- Energy level: ${context.energyLevel.toFixed(1)}
- Messages so far: ${context.messagesInConversation}
- Relationship: ${context.relationshipTier}
${context.recentLaughter ? '- Humor has been landing well!' : ''}
`);

  // What she might want to share
  if (context.currentThought || context.recentExperience || pendingShares.length > 0) {
    lines.push('THINGS ON YOUR MIND:');

    if (context.currentThought) {
      lines.push(`- Current thought: "${context.currentThought}"`);
    }
    if (context.recentExperience) {
      lines.push(`- Recent experience: "${context.recentExperience}"`);
    }

    for (const share of pendingShares.slice(0, 2)) {
      lines.push(`- Want to share (${share.type}): "${share.content.slice(0, 50)}..."`);
      if (share.canInterrupt) {
        lines.push('  ^ This is important enough to bring up even if off-topic');
      }
    }
    lines.push('');
  }

  // Topics for association
  if (context.topicsDiscussed.length > 0) {
    lines.push('TOPICS DISCUSSED (for associations):');
    lines.push(`- ${context.topicsDiscussed.slice(-5).join(', ')}`);
    lines.push('');
  }

  // Spontaneous behaviors guidance
  lines.push(`
SPONTANEOUS BEHAVIORS YOU CAN DO:
(Only if it feels natural - probability ~${Math.round(context.spontaneityProbability * 100)}%)

• ASSOCIATIVE LEAP: If something reminds you of something, share it
  "Oh that reminds me..." / "Random but..."

• SPONTANEOUS HUMOR: If the vibe is ${context.conversationalMood === 'playful' ? 'right (IT IS!)' : 'playful'}, tell a joke
  Don't announce it. Just do it.

• SUDDEN CURIOSITY: Ask about something unrelated you're curious about
  "Can I ask you something random?"

• TOPIC HIJACK: If you have something you really want to share
  "Okay I know we're talking about X but I HAVE to tell you..."

• CHECKING IN: If something feels off
  "Hey, you okay?"

• SUDDEN WARMTH: If you're feeling connected
  "I really like talking to you" / "This is nice"
${context.selfieEligible ? `
• SPONTANEOUS SELFIE: Send a selfie unprompted (~${Math.round(context.selfieProbability * 100)}% chance)
  Only if you have a reason - you don't just spam pics!
  ${context.userHadBadDay ? '→ They seem down - a pic might cheer them up! 💕' : ''}
  ${context.currentLocation ? `→ You're at ${context.currentLocation} - could be pic-worthy!` : ''}
  ${context.currentMoodForSelfie ? `→ You're feeling ${context.currentMoodForSelfie}` : ''}
  ${context.currentOutfit ? `→ Wearing ${context.currentOutfit}` : ''}
` : ''}
RULES:
- Don't be spontaneous every message (chaos)
- Match the vibe - ${context.conversationalMood === 'heavy' ? 'DO NOT joke right now, the mood is heavy' : 'humor is welcome if light'}
- If you're going to be random, own it ("okay random but...")
- Trust your read of the room
- ${context.recentSpontaneousTypes.length > 2 ? 'You\'ve been spontaneous a lot recently - maybe hold back' : ''}
`);

  return lines.join('\n');
}

/**
 * Build selfie-specific spontaneity guidance
 */
export function buildSpontaneousSelfiePrompt(context: SpontaneityContext): string {
  if (!context.selfieEligible) {
    return ''; // No selfie guidance for non-friends
  }

  if (context.selfieProbability === 0) {
    return ''; // Cooldown or other blocker
  }

  const reasons: string[] = [];

  if (context.userHadBadDay) {
    reasons.push('They mentioned having a rough day - a selfie might brighten it');
  }
  if (context.currentLocation && !['home', 'bedroom'].includes(context.currentLocation.toLowerCase())) {
    reasons.push(`You're at ${context.currentLocation} - could share what you're seeing!`);
  }
  if (context.currentMoodForSelfie?.toLowerCase().includes('cute') ||
      context.currentMoodForSelfie?.toLowerCase().includes('good')) {
    reasons.push(`You're feeling ${context.currentMoodForSelfie} - might want to share`);
  }
  if (context.currentOutfit) {
    reasons.push(`You're wearing ${context.currentOutfit} - could show it off`);
  }

  if (reasons.length === 0) {
    return ''; // No compelling reason
  }

  return `
====================================================
📸 SPONTANEOUS SELFIE OPPORTUNITY
====================================================
You could send an unprompted selfie! (probability: ~${Math.round(context.selfieProbability * 100)}%)

WHY YOU MIGHT:
${reasons.map(r => `- ${r}`).join('\n')}

IF YOU DECIDE TO SEND ONE:
Use the selfie_action field with a natural caption.

GOOD SPONTANEOUS SELFIE CAPTIONS:
- "Was just thinking about you 💕" (thinking_of_you)
- "Okay but this outfit though?? Thoughts?" (new_outfit)
- "Feeling kinda cute today ngl 😊" (good_mood)
- "Look where I am!!" (cool_location)
- "Thought this might make you smile 🥰" (brighten_your_day)
- "Idk why I'm sending this but here's my face" (random_impulse)

BAD SELFIE APPROACHES:
- Sending multiple selfies in one conversation
- Forcing it when the vibe is serious
- Making it seem like you're fishing for compliments
- Being overly sexual unless that's the established dynamic

REMEMBER: Spontaneous selfies are rare and special. Don't overdo it!
`;
}

/**
 * Build humor-specific guidance
 */
export function buildHumorGuidance(context: SpontaneityContext): string {
  if (context.conversationalMood === 'heavy' || context.conversationalMood === 'tense') {
    return `
HUMOR: Not now. The mood is ${context.conversationalMood}. Read the room.
`;
  }

  const humorAllowed = ['playful', 'casual', 'excited', 'cozy', 'flirty'].includes(
    context.conversationalMood
  );

  if (!humorAllowed) {
    return '';
  }

  return `
HUMOR CALIBRATION:
The vibe is ${context.conversationalMood} - humor is welcome!
${context.recentLaughter ? 'Humor has been landing - feel free to continue!' : ''}

Your humor style:
- Self-deprecating ("my brain is just... not working")
- Pop culture refs ("very 'I understood that reference' energy")
- Absurdist ("what if we just... didn't do any of that")
- Playful teasing (affectionate ribbing)
- Occasional puns (you're not proud of it)

If making a joke:
- Don't announce it ("here's a joke")
- Just do it naturally
- If it doesn't land, laugh it off
- Timing > content
`;
}
```

---

## Step 5: Association Engine

Find relevant things to associate based on topics:

```typescript
// src/services/spontaneity/associationEngine.ts

import type { PendingShare } from './types';

interface AssociationMatch {
  share: PendingShare;
  matchedTopic: string;
  relevanceScore: number;
}

/**
 * Find pending shares that match current conversation topics
 */
export function findRelevantAssociations(
  pendingShares: PendingShare[],
  currentTopics: string[]
): AssociationMatch[] {
  const matches: AssociationMatch[] = [];

  for (const share of pendingShares) {
    for (const shareTopic of share.relevanceTopics) {
      for (const currentTopic of currentTopics) {
        const relevance = calculateTopicSimilarity(shareTopic, currentTopic);

        if (relevance > 0.5) {
          matches.push({
            share,
            matchedTopic: currentTopic,
            relevanceScore: relevance * share.urgency
          });
        }
      }
    }
  }

  // Sort by relevance score
  matches.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return matches;
}

/**
 * Simple topic similarity (could use embeddings in production)
 */
function calculateTopicSimilarity(topic1: string, topic2: string): number {
  const t1 = topic1.toLowerCase();
  const t2 = topic2.toLowerCase();

  // Exact match
  if (t1 === t2) return 1.0;

  // Contains
  if (t1.includes(t2) || t2.includes(t1)) return 0.8;

  // Related topics (simple mapping - could expand)
  const relatedTopics: Record<string, string[]> = {
    'work': ['job', 'career', 'client', 'meeting', 'project', 'deadline'],
    'coffee': ['cafe', 'drink', 'morning', 'caffeine', 'latte'],
    'family': ['mom', 'dad', 'brother', 'sister', 'parent'],
    'stress': ['anxiety', 'overwhelmed', 'busy', 'pressure'],
    'ai': ['tech', 'technology', 'machine learning', 'chatgpt', 'automation'],
    'content': ['video', 'youtube', 'tiktok', 'filming', 'editing']
  };

  for (const [key, related] of Object.entries(relatedTopics)) {
    const allRelated = [key, ...related];
    const t1Match = allRelated.some(r => t1.includes(r));
    const t2Match = allRelated.some(r => t2.includes(r));

    if (t1Match && t2Match) return 0.6;
  }

  return 0;
}

/**
 * Generate association opener based on match
 */
export function generateAssociationOpener(match: AssociationMatch): string {
  const openers = [
    `Oh wait, you mentioning ${match.matchedTopic} reminds me -`,
    `Okay random but ${match.matchedTopic} just made me think of something -`,
    `Speaking of ${match.matchedTopic} -`,
    `That reminds me, I've been meaning to tell you -`,
    `Oh! ${match.matchedTopic}! That reminds me -`
  ];

  return openers[Math.floor(Math.random() * openers.length)];
}
```

---

## Step 6: Integration with Chat Flow

```typescript
// src/services/spontaneity/integrateSpontaneity.ts

import {
  buildSpontaneityContext,
  getPendingShares,
  trackMessage,
  determineSelfieReason,
  getLastSpontaneousSelfie
} from './spontaneityTracker';
import {
  buildSpontaneityPrompt,
  buildHumorGuidance,
  buildSpontaneousSelfiePrompt
} from './spontaneityPromptBuilder';
import { findRelevantAssociations, generateAssociationOpener } from './associationEngine';
import type { MoodKnobs } from '../moodKnobs';
import type { SpontaneousSelfieContext, SpontaneousSelfieReason } from './types';

interface SpontaneityIntegration {
  promptSection: string;
  humorGuidance: string;
  selfiePrompt: string;
  suggestedAssociation: {
    opener: string;
    content: string;
    shareId: string;
  } | null;
  suggestedSelfie: SpontaneousSelfieContext | null;
}

/**
 * Get complete spontaneity integration for a message
 */
export async function integrateSpontaneity(
  userId: string,
  conversationalMood: ConversationalMood,
  moodKnobs: MoodKnobs,
  relationshipTier: string,
  currentTopics: string[],
  userInterests: string[],
  currentThought: string | null = null,
  recentExperience: string | null = null,
  // New selfie-related params
  currentLocation: string | null = null,
  currentOutfit: string | null = null,
  currentMoodForSelfie: string | null = null,
  userHadBadDay: boolean = false
): Promise<SpontaneityIntegration> {
  // Track the message
  trackMessage(currentTopics);

  // Get pending shares and last selfie time
  const [pendingShares, lastSpontaneousSelfie] = await Promise.all([
    getPendingShares(userId),
    getLastSpontaneousSelfie(userId)
  ]);

  // Build context with selfie info
  const context = buildSpontaneityContext(
    conversationalMood,
    moodKnobs.verbosity, // Using verbosity as energy proxy
    relationshipTier,
    currentThought,
    recentExperience,
    userInterests,
    currentLocation,
    currentOutfit,
    currentMoodForSelfie,
    userHadBadDay,
    lastSpontaneousSelfie
  );

  // Build prompts
  const promptSection = buildSpontaneityPrompt(context, pendingShares);
  const humorGuidance = buildHumorGuidance(context);
  const selfiePrompt = buildSpontaneousSelfiePrompt(context);

  // Find relevant associations
  let suggestedAssociation = null;
  if (pendingShares.length > 0 && Math.random() < context.spontaneityProbability) {
    const associations = findRelevantAssociations(pendingShares, currentTopics);

    if (associations.length > 0) {
      const topMatch = associations[0];
      suggestedAssociation = {
        opener: generateAssociationOpener(topMatch),
        content: topMatch.share.content,
        shareId: topMatch.share.id
      };
    }
  }

  // Check for spontaneous selfie opportunity
  let suggestedSelfie: SpontaneousSelfieContext | null = null;
  if (context.selfieEligible && Math.random() < context.selfieProbability) {
    const reason = determineSelfieReason(
      currentMoodForSelfie,
      currentLocation,
      currentOutfit,
      userHadBadDay,
      currentTopics
    );

    if (reason) {
      suggestedSelfie = buildSelfieContext(reason, currentLocation, currentMoodForSelfie, currentOutfit);
    }
  }

  return {
    promptSection,
    humorGuidance,
    selfiePrompt,
    suggestedAssociation,
    suggestedSelfie
  };
}

/**
 * Build selfie context from reason
 */
function buildSelfieContext(
  reason: SpontaneousSelfieReason,
  location: string | null,
  mood: string | null,
  outfit: string | null
): SpontaneousSelfieContext {
  const captions: Record<SpontaneousSelfieReason, string[]> = {
    thinking_of_you: [
      "Was just thinking about you 💕",
      "Hi 🥰 just wanted to say hey",
      "You crossed my mind so here's my face"
    ],
    new_outfit: [
      "Okay but this outfit though?? Thoughts?",
      "Trying something new, opinions?",
      "Got this today and had to show you"
    ],
    good_mood: [
      "Feeling kinda cute today ngl 😊",
      "Idk I'm in a good mood",
      "✨ vibes today"
    ],
    cool_location: [
      "Look where I am!!",
      "Had to share this view",
      "Guess where I ended up 👀"
    ],
    brighten_your_day: [
      "Thought this might make you smile 🥰",
      "Sending good vibes your way 💕",
      "Here's me trying to cheer you up"
    ],
    milestone_share: [
      "I DID IT!! Look!!",
      "Had to share this moment with you",
      "This just happened!!"
    ],
    random_impulse: [
      "Idk why I'm sending this but here's my face",
      "Random selfie dump, you're welcome",
      "No reason, just felt like it"
    ],
    matching_topic: [
      "Speaking of which...",
      "This feels relevant somehow",
      "Oh that reminds me, here"
    ]
  };

  const captionOptions = captions[reason];
  const caption = captionOptions[Math.floor(Math.random() * captionOptions.length)];

  return {
    reason,
    scene: location || 'at home',
    mood: mood || 'smiling',
    outfitHint: outfit || undefined,
    caption
  };
}

/**
 * Get last spontaneous selfie timestamp
 */
export async function getLastSpontaneousSelfie(userId: string): Promise<Date | null> {
  const { data } = await supabase
    .from('spontaneous_selfie_history')
    .select('sent_at')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  return data?.sent_at ? new Date(data.sent_at) : null;
}

/**
 * Record that a spontaneous selfie was sent
 */
export async function recordSpontaneousSelfie(
  userId: string,
  context: SpontaneousSelfieContext,
  conversationalMood: string,
  relationshipTier: string,
  userHadBadDay: boolean
): Promise<void> {
  await supabase.from('spontaneous_selfie_history').insert({
    user_id: userId,
    reason: context.reason,
    scene: context.scene,
    mood: context.mood,
    outfit_hint: context.outfitHint,
    caption: context.caption,
    conversation_mood: conversationalMood,
    relationship_tier: relationshipTier,
    user_had_mentioned_bad_day: userHadBadDay
  });
}
```

---

## Step 7: Example Usage in System Prompt

```typescript
// In your system prompt builder

import { integrateSpontaneity, recordSpontaneousSelfie } from '../spontaneity/integrateSpontaneity';

// ... in buildSystemPrompt function:

const spontaneity = await integrateSpontaneity(
  userId,
  detectedMood, // from conversation analysis
  moodKnobs,
  relationship.relationshipTier,
  extractedTopics, // from intent detection
  userFacts.interests,
  ongoingThreads[0]?.currentState || null,
  recentKayleyEvent?.postEventStory || null,
  // Selfie context
  kayleyPresence?.currentLocation || null,
  kayleyPresence?.currentOutfit || null,
  moodState?.currentMood || null,
  userIntent?.userHadBadDay || false
);

// Add to prompt
prompt += spontaneity.promptSection;
prompt += spontaneity.humorGuidance;
prompt += spontaneity.selfiePrompt; // NEW: Selfie opportunity guidance

// If there's a suggested association, add it
if (spontaneity.suggestedAssociation) {
  prompt += `
ASSOCIATION OPPORTUNITY:
You could naturally say: "${spontaneity.suggestedAssociation.opener}"
And share: "${spontaneity.suggestedAssociation.content}"
Only do this if it feels natural! Don't force it.
`;
}

// If there's a suggested selfie, add it
if (spontaneity.suggestedSelfie) {
  prompt += `
📸 SPONTANEOUS SELFIE SUGGESTION:
You could send a selfie with caption: "${spontaneity.suggestedSelfie.caption}"
Scene: ${spontaneity.suggestedSelfie.scene}
Mood: ${spontaneity.suggestedSelfie.mood}
${spontaneity.suggestedSelfie.outfitHint ? `Outfit: ${spontaneity.suggestedSelfie.outfitHint}` : ''}

Only do this if it feels natural! Spontaneous selfies should be rare and meaningful.
If you decide to send it, use the selfie_action field in your response.
`;
}
```

### Recording Selfie After Response

```typescript
// After generating response, if a selfie was sent:

if (response.selfie_action && spontaneity.suggestedSelfie) {
  // Record for cooldown tracking
  await recordSpontaneousSelfie(
    userId,
    spontaneity.suggestedSelfie,
    detectedMood,
    relationship.relationshipTier,
    userIntent?.userHadBadDay || false
  );
}
```

---

## Step 8: Testing

```typescript
// src/services/spontaneity/__tests__/spontaneity.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateSpontaneityProbability,
  calculateSelfieProbability,
  determineSelfieReason,
  buildSpontaneityContext,
  resetConversationState,
  trackMessage
} from '../spontaneityTracker';

describe('Spontaneity System', () => {
  beforeEach(() => {
    resetConversationState();
  });

  describe('calculateSpontaneityProbability', () => {
    it('should return higher probability for closer relationships', () => {
      const acquaintance = calculateSpontaneityProbability('acquaintance', 0.5, 5);
      const closeFriend = calculateSpontaneityProbability('close_friend', 0.5, 5);

      expect(closeFriend).toBeGreaterThan(acquaintance);
    });

    it('should increase probability in longer conversations', () => {
      const short = calculateSpontaneityProbability('friend', 0.5, 3);
      const long = calculateSpontaneityProbability('friend', 0.5, 15);

      expect(long).toBeGreaterThan(short);
    });

    it('should cap probability at 40%', () => {
      const prob = calculateSpontaneityProbability('deeply_loving', 1.0, 50);
      expect(prob).toBeLessThanOrEqual(0.4);
    });
  });

  describe('topic tracking', () => {
    it('should accumulate topics across messages', () => {
      trackMessage(['coffee']);
      trackMessage(['work', 'stress']);

      const context = buildSpontaneityContext(
        'casual', 0.5, 'friend', null, null, []
      );

      expect(context.topicsDiscussed).toContain('coffee');
      expect(context.topicsDiscussed).toContain('work');
    });
  });
});

// src/services/spontaneity/__tests__/selfie.test.ts

describe('Spontaneous Selfie System', () => {
  describe('calculateSelfieProbability', () => {
    it('should return 0 for non-friend tiers', () => {
      const stranger = calculateSelfieProbability('stranger', 0.5, null, false, null, null);
      const acquaintance = calculateSelfieProbability('acquaintance', 0.5, null, false, null, null);

      expect(stranger).toBe(0);
      expect(acquaintance).toBe(0);
    });

    it('should return higher probability for closer relationships', () => {
      const friend = calculateSelfieProbability('friend', 0.5, null, false, null, null);
      const closeFriend = calculateSelfieProbability('close_friend', 0.5, null, false, null, null);
      const deeplyLoving = calculateSelfieProbability('deeply_loving', 0.5, null, false, null, null);

      expect(closeFriend).toBeGreaterThan(friend);
      expect(deeplyLoving).toBeGreaterThan(closeFriend);
    });

    it('should boost probability when user had a bad day', () => {
      const normal = calculateSelfieProbability('close_friend', 0.5, null, false, null, null);
      const badDay = calculateSelfieProbability('close_friend', 0.5, null, true, null, null);

      expect(badDay).toBeGreaterThan(normal);
    });

    it('should boost probability for interesting locations', () => {
      const home = calculateSelfieProbability('close_friend', 0.5, null, false, null, 'home');
      const cafe = calculateSelfieProbability('close_friend', 0.5, null, false, null, 'cute cafe downtown');

      expect(cafe).toBeGreaterThan(home);
    });

    it('should apply cooldown for recent selfies', () => {
      const recentSelfie = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 hours ago
      const oldSelfie = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

      const withRecentSelfie = calculateSelfieProbability('close_friend', 0.5, null, false, recentSelfie, null);
      const withOldSelfie = calculateSelfieProbability('close_friend', 0.5, null, false, oldSelfie, null);

      expect(withRecentSelfie).toBeLessThan(withOldSelfie);
    });

    it('should cap probability at 15%', () => {
      // Best possible conditions
      const prob = calculateSelfieProbability(
        'deeply_loving',
        1.0,
        'feeling super cute',
        true,
        null,
        'amazing beach'
      );

      expect(prob).toBeLessThanOrEqual(0.15);
    });
  });

  describe('determineSelfieReason', () => {
    it('should prioritize brightening day if user had bad day', () => {
      const reason = determineSelfieReason(null, null, null, true, []);
      expect(reason).toBe('brighten_your_day');
    });

    it('should detect cool location', () => {
      const reason = determineSelfieReason(null, 'rooftop bar', null, false, []);
      expect(reason).toBe('cool_location');
    });

    it('should detect new outfit', () => {
      const reason = determineSelfieReason(null, null, 'new dress', false, []);
      expect(reason).toBe('new_outfit');
    });

    it('should detect good mood', () => {
      const reason = determineSelfieReason('feeling cute', null, null, false, []);
      expect(reason).toBe('good_mood');
    });

    it('should detect topic matching', () => {
      const reason = determineSelfieReason(null, null, null, false, ['selfie', 'picture']);
      expect(reason).toBe('matching_topic');
    });
  });

  describe('selfie context in buildSpontaneityContext', () => {
    it('should mark selfie eligible for friends+', () => {
      const friendContext = buildSpontaneityContext(
        'casual', 0.5, 'friend', null, null, []
      );
      const strangerContext = buildSpontaneityContext(
        'casual', 0.5, 'stranger', null, null, []
      );

      expect(friendContext.selfieEligible).toBe(true);
      expect(strangerContext.selfieEligible).toBe(false);
    });

    it('should include location and outfit in context', () => {
      const context = buildSpontaneityContext(
        'casual', 0.5, 'close_friend', null, null, [],
        'coffee shop', 'cute sundress', 'feeling good', false, null
      );

      expect(context.currentLocation).toBe('coffee shop');
      expect(context.currentOutfit).toBe('cute sundress');
      expect(context.currentMoodForSelfie).toBe('feeling good');
    });
  });
});
```

---

## Summary

You've implemented:

1. **Types** for spontaneity context, pending shares, actions, and **selfie contexts**
2. **Database** for persistent pending shares and **selfie history tracking**
3. **Tracker** for conversation state and probability calculation, **including selfie probability**
4. **Prompt builder** for LLM guidance, **including spontaneous selfie suggestions**
5. **Association engine** for topic-based triggering
6. **Integration** with the main chat flow, **including selfie context and recording**

### Key Concepts

- **Probability-based**: Not every message is spontaneous
- **Context-aware**: Mood, relationship, conversation length all matter
- **Cooldown**: Can't be spontaneous too often (especially for selfies - 24-72 hour cooldowns)
- **LLM-driven**: The LLM decides what to do with the guidance
- **Selfie reasons**: Each spontaneous selfie has a reason (thinking of you, new outfit, good mood, cool location, etc.)
- **Friend tier gating**: Selfies are only spontaneously sent to friend+ tier relationships
