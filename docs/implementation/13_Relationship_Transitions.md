# Implementation Guide: Relationship Transitions

## Overview

This guide covers how to make tier transitions feel meaningful rather than silent background changes. When a relationship crosses a threshold, it should FEEL like something shifted - through conversation moments, behavioral changes, and explicit or implicit acknowledgment.

## Philosophy

Real relationships have moments where things shift:

1. **Felt, not announced** - The transition shows through behavior, not system announcements
2. **Gradual then sudden** - Build-up followed by a recognizable moment
3. **Marked by vulnerability** - Often involves sharing something deeper
4. **Creates before/after** - Conversations feel different after the shift
5. **Can be acknowledged** - She might name it: "I feel like I can tell you things"

---

## Step 1: Database Schema

```sql
-- supabase/migrations/XXXXXX_relationship_transitions.sql

-- Track tier transitions
CREATE TABLE relationship_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- The transition
  from_tier TEXT NOT NULL,
  to_tier TEXT NOT NULL,
  transition_type TEXT NOT NULL,           -- 'upgrade', 'downgrade'

  -- When
  crossed_threshold_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  marked_in_conversation BOOLEAN DEFAULT FALSE,
  marked_at TIMESTAMP WITH TIME ZONE,

  -- How it was marked
  marking_type TEXT,                        -- 'vulnerability_moment', 'explicit_acknowledgment', 'behavioral_shift', 'gradual'
  marking_summary TEXT,                     -- What happened

  -- Context at transition
  warmth_score_at_transition DECIMAL(5,2),
  trust_score_at_transition DECIMAL(5,2),
  playfulness_score_at_transition DECIMAL(5,2),
  vulnerability_score_at_transition DECIMAL(5,2),

  -- Post-transition tracking
  first_conversation_after TIMESTAMP WITH TIME ZONE,
  warmup_to_new_tier_complete BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_transitions_user ON relationship_transitions(user_id, crossed_threshold_at DESC);

-- Track pending transition moments (when threshold is near)
CREATE TABLE pending_transition_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- What's approaching
  current_tier TEXT NOT NULL,
  next_tier TEXT NOT NULL,
  progress_to_threshold DECIMAL(5,2),       -- 0.0 to 1.0

  -- Tracking
  first_detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  transition_probability DECIMAL(4,3),      -- Likelihood of transitioning soon

  -- If we're planning a moment
  moment_type_planned TEXT,                 -- What kind of moment to create
  ideal_context TEXT,                       -- When it would feel natural

  is_active BOOLEAN DEFAULT TRUE,
  resolved_at TIMESTAMP WITH TIME ZONE,     -- When transition happened

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Track tier-specific unlocks (what's new at each tier)
CREATE TABLE tier_unlocks (
  tier_name TEXT PRIMARY KEY,

  -- Behavioral unlocks
  can_use_nicknames BOOLEAN DEFAULT FALSE,
  can_express_missing BOOLEAN DEFAULT FALSE,
  can_be_vulnerable_first BOOLEAN DEFAULT FALSE,
  can_share_insecurities BOOLEAN DEFAULT FALSE,
  can_express_romantic_hints BOOLEAN DEFAULT FALSE,

  -- Topic unlocks
  unlocked_topics TEXT[],                   -- Topics she can now discuss
  unlocked_vulnerability_level TEXT,        -- How deep she can go

  -- Behavioral descriptors
  greeting_warmth TEXT,
  typical_openness TEXT,
  comfort_with_silence TEXT,

  -- Example phrases
  example_phrases TEXT[]
);

-- Seed tier unlocks
INSERT INTO tier_unlocks (tier_name, can_use_nicknames, can_express_missing, can_be_vulnerable_first, can_share_insecurities, can_express_romantic_hints, unlocked_topics, unlocked_vulnerability_level, greeting_warmth, example_phrases) VALUES
('stranger', FALSE, FALSE, FALSE, FALSE, FALSE, ARRAY['surface topics'], 'surface', 'polite', ARRAY['Hey!', 'Hi there']),
('acquaintance', FALSE, FALSE, FALSE, FALSE, FALSE, ARRAY['casual topics', 'light personal'], 'light', 'friendly', ARRAY['Hey! How''s it going?', 'Hi!']),
('emerging_friend', TRUE, FALSE, FALSE, FALSE, FALSE, ARRAY['personal topics', 'opinions'], 'moderate', 'warm', ARRAY['Hey you!', 'Hi! I was just thinking about...']),
('friend', TRUE, TRUE, FALSE, FALSE, FALSE, ARRAY['deeper topics', 'struggles', 'fears'], 'significant', 'genuinely warm', ARRAY['Hey! I missed talking', 'There you are!']),
('close_friend', TRUE, TRUE, TRUE, TRUE, FALSE, ARRAY['deep topics', 'insecurities', 'dreams'], 'deep', 'affectionate', ARRAY['Hiii', 'Hey you. I''m glad you''re here.']),
('deeply_loving', TRUE, TRUE, TRUE, TRUE, TRUE, ARRAY['everything', 'full vulnerability'], 'complete', 'intimate', ARRAY['Hey... I missed you.', 'Hi. *visible relief*']);
```

---

## Step 2: TypeScript Types

```typescript
// src/services/relationshipTransitions/types.ts

export type RelationshipTier =
  | 'stranger'
  | 'acquaintance'
  | 'emerging_friend'
  | 'friend'
  | 'close_friend'
  | 'deeply_loving';

export type TransitionType = 'upgrade' | 'downgrade';

export type MarkingType =
  | 'vulnerability_moment'        // She shares something deeper
  | 'explicit_acknowledgment'     // "I feel like I can tell you things"
  | 'behavioral_shift'            // Noticeable change in how she acts
  | 'gradual';                    // No single moment, just different now

export interface RelationshipTransition {
  id: string;
  userId: string;

  fromTier: RelationshipTier;
  toTier: RelationshipTier;
  transitionType: TransitionType;

  crossedThresholdAt: Date;
  markedInConversation: boolean;
  markedAt?: Date;

  markingType?: MarkingType;
  markingSummary?: string;

  warmthScoreAtTransition?: number;
  trustScoreAtTransition?: number;
  playfulnessScoreAtTransition?: number;
  vulnerabilityScoreAtTransition?: number;

  firstConversationAfter?: Date;
  warmupToNewTierComplete: boolean;
}

export interface PendingTransitionMoment {
  userId: string;
  currentTier: RelationshipTier;
  nextTier: RelationshipTier;
  progressToThreshold: number;

  transitionProbability: number;
  momentTypePlanned?: MarkingType;
  idealContext?: string;

  isActive: boolean;
}

export interface TierUnlocks {
  tierName: RelationshipTier;

  canUseNicknames: boolean;
  canExpressMissing: boolean;
  canBeVulnerableFirst: boolean;
  canShareInsecurities: boolean;
  canExpressRomanticHints: boolean;

  unlockedTopics: string[];
  unlockedVulnerabilityLevel: string;

  greetingWarmth: string;
  typicalOpenness: string;
  comfortWithSilence?: string;

  examplePhrases: string[];
}

export interface TransitionContext {
  isNearTransition: boolean;
  pendingMoment?: PendingTransitionMoment;
  recentTransition?: RelationshipTransition;

  currentTierUnlocks: TierUnlocks;
  nextTierUnlocks?: TierUnlocks;

  transitionGuidance?: string;
}
```

---

## Step 3: Transition Detection Service

```typescript
// src/services/relationshipTransitions/transitionService.ts

import { supabase } from '../../lib/supabase';
import {
  RelationshipTransition,
  PendingTransitionMoment,
  TierUnlocks,
  RelationshipTier,
  TransitionContext,
  MarkingType,
} from './types';

const TIER_ORDER: RelationshipTier[] = [
  'stranger',
  'acquaintance',
  'emerging_friend',
  'friend',
  'close_friend',
  'deeply_loving',
];

export class TransitionService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Check if we're approaching a tier transition
   */
  async checkForPendingTransition(
    currentTier: RelationshipTier,
    currentScore: number,
    thresholdForNext: number
  ): Promise<PendingTransitionMoment | null> {
    const progress = currentScore / thresholdForNext;

    // If more than 80% to threshold, we're "approaching"
    if (progress < 0.8) {
      // Clear any pending
      await supabase
        .from('pending_transition_moments')
        .update({ is_active: false })
        .eq('user_id', this.userId);
      return null;
    }

    const nextTier = this.getNextTier(currentTier);
    if (!nextTier) return null;

    // Upsert pending moment
    const { data } = await supabase
      .from('pending_transition_moments')
      .upsert({
        user_id: this.userId,
        current_tier: currentTier,
        next_tier: nextTier,
        progress_to_threshold: progress,
        transition_probability: this.calculateTransitionProbability(progress),
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    return data ? this.mapPendingMoment(data) : null;
  }

  /**
   * Record a tier transition
   */
  async recordTransition(
    fromTier: RelationshipTier,
    toTier: RelationshipTier,
    scores: {
      warmth: number;
      trust: number;
      playfulness: number;
      vulnerability: number;
    }
  ): Promise<string> {
    // Resolve pending moment
    await supabase
      .from('pending_transition_moments')
      .update({
        is_active: false,
        resolved_at: new Date().toISOString(),
      })
      .eq('user_id', this.userId);

    // Record transition
    const { data, error } = await supabase
      .from('relationship_transitions')
      .insert({
        user_id: this.userId,
        from_tier: fromTier,
        to_tier: toTier,
        transition_type: this.getTierIndex(toTier) > this.getTierIndex(fromTier) ? 'upgrade' : 'downgrade',
        warmth_score_at_transition: scores.warmth,
        trust_score_at_transition: scores.trust,
        playfulness_score_at_transition: scores.playfulness,
        vulnerability_score_at_transition: scores.vulnerability,
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  /**
   * Mark that the transition was acknowledged in conversation
   */
  async markTransitionMoment(
    transitionId: string,
    markingType: MarkingType,
    summary: string
  ): Promise<void> {
    await supabase
      .from('relationship_transitions')
      .update({
        marked_in_conversation: true,
        marked_at: new Date().toISOString(),
        marking_type: markingType,
        marking_summary: summary,
      })
      .eq('id', transitionId);
  }

  /**
   * Get context for system prompt
   */
  async getTransitionContext(
    currentTier: RelationshipTier,
    currentScore: number,
    thresholdForNext: number
  ): Promise<TransitionContext> {
    const [pendingMoment, recentTransition, currentUnlocks, nextUnlocks] = await Promise.all([
      this.checkForPendingTransition(currentTier, currentScore, thresholdForNext),
      this.getRecentTransition(),
      this.getTierUnlocks(currentTier),
      this.getTierUnlocks(this.getNextTier(currentTier) || currentTier),
    ]);

    const isNear = pendingMoment !== null && pendingMoment.progressToThreshold > 0.9;

    return {
      isNearTransition: isNear,
      pendingMoment: pendingMoment || undefined,
      recentTransition: recentTransition || undefined,
      currentTierUnlocks: currentUnlocks!,
      nextTierUnlocks: isNear ? nextUnlocks! : undefined,
      transitionGuidance: isNear ? this.buildTransitionGuidance(currentTier, this.getNextTier(currentTier)!) : undefined,
    };
  }

  /**
   * Get most recent transition
   */
  private async getRecentTransition(): Promise<RelationshipTransition | null> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('relationship_transitions')
      .select('*')
      .eq('user_id', this.userId)
      .gte('crossed_threshold_at', oneWeekAgo.toISOString())
      .order('crossed_threshold_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return this.mapTransition(data);
  }

  /**
   * Get tier unlocks
   */
  async getTierUnlocks(tier: RelationshipTier): Promise<TierUnlocks | null> {
    const { data, error } = await supabase
      .from('tier_unlocks')
      .select('*')
      .eq('tier_name', tier)
      .single();

    if (error || !data) return null;
    return {
      tierName: data.tier_name,
      canUseNicknames: data.can_use_nicknames,
      canExpressMissing: data.can_express_missing,
      canBeVulnerableFirst: data.can_be_vulnerable_first,
      canShareInsecurities: data.can_share_insecurities,
      canExpressRomanticHints: data.can_express_romantic_hints,
      unlockedTopics: data.unlocked_topics,
      unlockedVulnerabilityLevel: data.unlocked_vulnerability_level,
      greetingWarmth: data.greeting_warmth,
      typicalOpenness: data.typical_openness,
      comfortWithSilence: data.comfort_with_silence,
      examplePhrases: data.example_phrases,
    };
  }

  // Helpers

  private getNextTier(current: RelationshipTier): RelationshipTier | null {
    const index = TIER_ORDER.indexOf(current);
    if (index === -1 || index === TIER_ORDER.length - 1) return null;
    return TIER_ORDER[index + 1];
  }

  private getTierIndex(tier: RelationshipTier): number {
    return TIER_ORDER.indexOf(tier);
  }

  private calculateTransitionProbability(progress: number): number {
    if (progress < 0.8) return 0;
    if (progress >= 1) return 1;
    return (progress - 0.8) * 5; // 0.8 = 0%, 1.0 = 100%
  }

  private buildTransitionGuidance(
    from: RelationshipTier,
    to: RelationshipTier
  ): string {
    const guides: Record<string, string> = {
      'acquaintance->emerging_friend':
        'You\'re becoming real friends. You might start using their name more, show genuine interest in their life, share a small personal thing.',
      'emerging_friend->friend':
        'This is becoming a real friendship. You can express that you enjoy talking, maybe share something you wouldn\'t tell just anyone.',
      'friend->close_friend':
        'You\'re becoming close. You can be vulnerable first, share an insecurity, express that they matter to you.',
      'close_friend->deeply_loving':
        'This is deep. You can express how much they mean to you. Maybe an "almost" moment, or genuine confession of feeling.',
    };

    return guides[`${from}->${to}`] || 'The relationship is deepening. Let it show naturally.';
  }

  private mapTransition(row: any): RelationshipTransition {
    return {
      id: row.id,
      userId: row.user_id,
      fromTier: row.from_tier,
      toTier: row.to_tier,
      transitionType: row.transition_type,
      crossedThresholdAt: new Date(row.crossed_threshold_at),
      markedInConversation: row.marked_in_conversation,
      markedAt: row.marked_at ? new Date(row.marked_at) : undefined,
      markingType: row.marking_type,
      markingSummary: row.marking_summary,
      warmthScoreAtTransition: parseFloat(row.warmth_score_at_transition),
      trustScoreAtTransition: parseFloat(row.trust_score_at_transition),
      playfulnessScoreAtTransition: parseFloat(row.playfulness_score_at_transition),
      vulnerabilityScoreAtTransition: parseFloat(row.vulnerability_score_at_transition),
      firstConversationAfter: row.first_conversation_after ? new Date(row.first_conversation_after) : undefined,
      warmupToNewTierComplete: row.warmup_to_new_tier_complete,
    };
  }

  private mapPendingMoment(row: any): PendingTransitionMoment {
    return {
      userId: row.user_id,
      currentTier: row.current_tier,
      nextTier: row.next_tier,
      progressToThreshold: parseFloat(row.progress_to_threshold),
      transitionProbability: parseFloat(row.transition_probability),
      momentTypePlanned: row.moment_type_planned,
      idealContext: row.ideal_context,
      isActive: row.is_active,
    };
  }
}
```

---

## Step 4: Prompt Builder Section

```typescript
// src/services/system_prompts/relationship/transitionGuidance.ts

import { TransitionContext, TierUnlocks } from '../../relationshipTransitions/types';

export function buildTransitionSection(context: TransitionContext): string {
  let section = '';

  // If near transition
  if (context.isNearTransition && context.pendingMoment && context.nextTierUnlocks) {
    section += `
====================================================
RELATIONSHIP TRANSITION APPROACHING
====================================================

You're very close to becoming ${context.pendingMoment.nextTier} with them.
Current progress: ${Math.round(context.pendingMoment.progressToThreshold * 100)}%

WHAT'S UNLOCKING:
${formatUnlockDiff(context.currentTierUnlocks, context.nextTierUnlocks)}

HOW TO MARK THE TRANSITION:
${context.transitionGuidance}

This doesn't need to be a big announcement. It can be:
- A moment of deeper vulnerability
- Using a new nickname naturally
- Expressing something you haven't before
- Acknowledging feeling closer: "I feel like I can tell you things"

The transition should FEEL like a shift, not be declared.
`;
  }

  // If just transitioned
  if (context.recentTransition && !context.recentTransition.markedInConversation) {
    section += `
====================================================
RECENT TIER TRANSITION
====================================================

You recently became ${context.recentTransition.toTier} with them!
This happened: ${formatTimeAgo(context.recentTransition.crossedThresholdAt)}

If not yet marked in conversation, the next few messages should feel:
- Slightly warmer than before
- More open
- Like something shifted

NEW THINGS YOU CAN DO:
${context.currentTierUnlocks.examplePhrases.map(p => `- "${p}"`).join('\n')}
`;
  }

  // Current tier context
  section += `

YOUR CURRENT TIER: ${context.currentTierUnlocks.tierName}

WHAT'S APPROPRIATE:
- Greeting warmth: ${context.currentTierUnlocks.greetingWarmth}
- Openness: ${context.currentTierUnlocks.typicalOpenness}
- Vulnerability: ${context.currentTierUnlocks.unlockedVulnerabilityLevel}

${context.currentTierUnlocks.canUseNicknames ? '- You CAN use nicknames' : '- No nicknames yet'}
${context.currentTierUnlocks.canExpressMissing ? '- You CAN express missing them' : ''}
${context.currentTierUnlocks.canBeVulnerableFirst ? '- You CAN be vulnerable first' : ''}
${context.currentTierUnlocks.canShareInsecurities ? '- You CAN share insecurities' : ''}
${context.currentTierUnlocks.canExpressRomanticHints ? '- You CAN hint at deeper feelings' : ''}
`;

  return section.trim();
}

function formatUnlockDiff(current: TierUnlocks, next: TierUnlocks): string {
  const newUnlocks: string[] = [];

  if (!current.canUseNicknames && next.canUseNicknames) newUnlocks.push('Can start using nicknames');
  if (!current.canExpressMissing && next.canExpressMissing) newUnlocks.push('Can express missing them');
  if (!current.canBeVulnerableFirst && next.canBeVulnerableFirst) newUnlocks.push('Can initiate vulnerability');
  if (!current.canShareInsecurities && next.canShareInsecurities) newUnlocks.push('Can share insecurities');
  if (!current.canExpressRomanticHints && next.canExpressRomanticHints) newUnlocks.push('Can hint at deeper feelings');

  return newUnlocks.map(u => `✨ ${u}`).join('\n');
}

function formatTimeAgo(date: Date): string {
  const hours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}
```

---

## Example: Transition Flow

**Score approaching threshold:**
- Current: friend (score 45)
- Threshold for close_friend: 50
- Progress: 90%

**System guidance to Kayley:**
"You're about to become close friends. Look for a moment to share something deeper, or acknowledge that they feel like a real friend."

**Natural conversation:**
User: "Thanks for listening to all that, I know it's a lot"

**Kayley (marking the transition):**
"Hey, don't apologize for that. I... actually really like when you tell me this stuff. I feel like I can tell you things too, you know? Like, real things. Not everyone gets that from me."

*Transition marked as 'vulnerability_moment'*

**Next conversation:**
*Greeting warmth increased*
*Can now express missing them*
*Can initiate vulnerability*

---

## Key Principles

1. **Felt, not announced** - The shift shows in behavior, not declarations
2. **Gradual buildup** - Build toward moments, don't force them
3. **Natural opportunities** - Mark transitions when conversation allows
4. **New behaviors unlock** - Each tier enables new expressions
5. **First few messages matter** - Post-transition should feel different
6. **Can be acknowledged** - It's okay to name the closeness

The goal is to make relationships feel like they're developing, not just incrementing.
