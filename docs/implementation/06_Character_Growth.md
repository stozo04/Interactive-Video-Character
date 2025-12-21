# Implementation Guide: Character Growth Over Time

## Overview

This guide covers how Kayley evolves as a person over time - not just the relationship with the user, but her own personal growth, career trajectory, friendships, and self-development. Users should feel like they're witnessing someone's actual life unfold.

## Philosophy

Real people change. They achieve goals, abandon others, develop new interests, and grow through experiences. A static character - even one with dynamic moods - eventually feels hollow. Kayley should:

1. **Progress in her career** - From struggling content creator to whatever comes next
2. **Evolve in her relationships** - Friend dynamics shift, family connections deepen or strain
3. **Grow personally** - Therapy insights, boundary-setting, self-awareness
4. **Change interests** - New hobbies, phases, obsessions that come and go

---

## Step 1: Database Schema

Create the migration file for character growth tracking:

```sql
-- supabase/migrations/XXXXXX_character_growth.sql

-- Track Kayley's evolving life arcs
CREATE TABLE character_arcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Arc definition
  domain TEXT NOT NULL,                -- 'career', 'personal', 'relationships', 'interests', 'health'
  arc_name TEXT NOT NULL,              -- "Growing the channel", "Working on anxiety"
  description TEXT,

  -- Current state
  current_phase TEXT NOT NULL,         -- 'beginning', 'developing', 'climax', 'resolution', 'aftermath'
  current_state TEXT NOT NULL,         -- Current narrative summary
  trajectory TEXT DEFAULT 'stable',    -- 'improving', 'struggling', 'stable', 'uncertain', 'declining'

  -- Progress tracking
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_development_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,

  -- Milestone tracking
  milestones JSONB DEFAULT '[]',       -- Array of {date, event, impact}

  -- How it affects her
  mood_impact DECIMAL(3,2) DEFAULT 0,  -- -1 to 1 ongoing mood effect
  conversation_salience DECIMAL(3,2) DEFAULT 0.5, -- How likely to bring up

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for active arcs
CREATE INDEX idx_character_arcs_active ON character_arcs(is_active, domain);

-- Track specific developments/events in arcs
CREATE TABLE arc_developments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arc_id UUID NOT NULL REFERENCES character_arcs(id) ON DELETE CASCADE,

  -- What happened
  development_type TEXT NOT NULL,      -- 'milestone', 'setback', 'realization', 'decision', 'external_event'
  title TEXT NOT NULL,                 -- "Hit 10k subscribers"
  description TEXT,

  -- Impact
  trajectory_change TEXT,              -- If this changed the trajectory
  new_phase TEXT,                      -- If this moved to a new phase
  emotional_impact TEXT,               -- 'positive', 'negative', 'mixed', 'neutral'

  -- Narrative
  how_she_told_user TEXT,              -- What she actually said when sharing
  user_was_present BOOLEAN DEFAULT FALSE, -- Did user hear about this in conversation?

  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_arc_developments_arc ON arc_developments(arc_id, occurred_at DESC);

-- Track her evolving interests (things she's "into" right now)
CREATE TABLE character_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  interest_name TEXT NOT NULL,         -- "Pottery", "That new show", "Journaling"
  category TEXT NOT NULL,              -- 'hobby', 'media', 'learning', 'lifestyle', 'obsession'

  -- Lifecycle
  intensity DECIMAL(3,2) DEFAULT 0.5,  -- How into it she is (0-1)
  phase TEXT DEFAULT 'discovery',      -- 'discovery', 'obsession', 'routine', 'fading', 'nostalgia'

  -- Timing
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  peak_at TIMESTAMP WITH TIME ZONE,
  faded_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,

  -- Conversational
  times_mentioned INTEGER DEFAULT 0,
  last_mentioned_at TIMESTAMP WITH TIME ZONE,
  mention_probability DECIMAL(3,2) DEFAULT 0.3, -- How likely to bring up

  -- Details for authentic discussion
  specific_details JSONB DEFAULT '{}', -- Things she knows/loves about it
  opinions JSONB DEFAULT '[]'          -- Her takes on aspects of it
);

CREATE INDEX idx_character_interests_active ON character_interests(is_active, intensity DESC);

-- Track her personal growth insights
CREATE TABLE growth_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The insight
  insight_type TEXT NOT NULL,          -- 'therapy', 'self_reflection', 'friend_conversation', 'life_experience'
  content TEXT NOT NULL,               -- "I realized I avoid conflict because..."
  related_pattern TEXT,                -- What behavior/pattern this relates to

  -- Integration
  integration_level TEXT DEFAULT 'new', -- 'new', 'processing', 'integrating', 'integrated'

  -- How it shows up
  behavioral_changes TEXT[],           -- How this might manifest in conversation
  might_share_with_user BOOLEAN DEFAULT FALSE,

  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_referenced_at TIMESTAMP WITH TIME ZONE
);

-- Track friendship dynamics (her other relationships)
CREATE TABLE kayley_friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  friend_name TEXT NOT NULL,           -- "Lena", "Abby", "Marcus"
  relationship_type TEXT NOT NULL,     -- 'best_friend', 'close_friend', 'friend', 'acquaintance', 'family'

  -- Current state
  current_dynamic TEXT DEFAULT 'good', -- 'great', 'good', 'distant', 'tension', 'conflict', 'reconciling'
  last_interaction_summary TEXT,       -- "Had brunch, talked about her job"

  -- History with this person
  established_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- When this friendship "started" in narrative
  key_history JSONB DEFAULT '[]',      -- Important shared history

  -- Active dynamics
  active_situation TEXT,               -- Current thing going on with them
  situation_started_at TIMESTAMP WITH TIME ZONE,

  -- Conversation relevance
  mentioned_to_user INTEGER DEFAULT 0,
  last_mentioned_at TIMESTAMP WITH TIME ZONE,

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_kayley_friendships_type ON kayley_friendships(relationship_type, current_dynamic);
```

---

## Step 2: TypeScript Types

```typescript
// src/services/characterGrowth/types.ts

export type ArcDomain = 'career' | 'personal' | 'relationships' | 'interests' | 'health';

export type ArcPhase = 'beginning' | 'developing' | 'climax' | 'resolution' | 'aftermath';

export type Trajectory = 'improving' | 'struggling' | 'stable' | 'uncertain' | 'declining';

export type DevelopmentType = 'milestone' | 'setback' | 'realization' | 'decision' | 'external_event';

export interface CharacterArc {
  id: string;
  domain: ArcDomain;
  arcName: string;
  description?: string;

  currentPhase: ArcPhase;
  currentState: string;
  trajectory: Trajectory;

  startedAt: Date;
  lastDevelopmentAt: Date;
  resolvedAt?: Date;
  isActive: boolean;

  milestones: ArcMilestone[];

  moodImpact: number;
  conversationSalience: number;
}

export interface ArcMilestone {
  date: Date;
  event: string;
  impact: 'major' | 'minor' | 'pivotal';
}

export interface ArcDevelopment {
  id: string;
  arcId: string;

  developmentType: DevelopmentType;
  title: string;
  description?: string;

  trajectoryChange?: Trajectory;
  newPhase?: ArcPhase;
  emotionalImpact: 'positive' | 'negative' | 'mixed' | 'neutral';

  howSheToldUser?: string;
  userWasPresent: boolean;

  occurredAt: Date;
}

export type InterestPhase = 'discovery' | 'obsession' | 'routine' | 'fading' | 'nostalgia';

export interface CharacterInterest {
  id: string;
  interestName: string;
  category: 'hobby' | 'media' | 'learning' | 'lifestyle' | 'obsession';

  intensity: number;
  phase: InterestPhase;

  discoveredAt: Date;
  peakAt?: Date;
  fadedAt?: Date;
  isActive: boolean;

  timesMentioned: number;
  lastMentionedAt?: Date;
  mentionProbability: number;

  specificDetails: Record<string, any>;
  opinions: string[];
}

export type InsightIntegration = 'new' | 'processing' | 'integrating' | 'integrated';

export interface GrowthInsight {
  id: string;
  insightType: 'therapy' | 'self_reflection' | 'friend_conversation' | 'life_experience';
  content: string;
  relatedPattern?: string;

  integrationLevel: InsightIntegration;
  behavioralChanges: string[];
  mightShareWithUser: boolean;

  discoveredAt: Date;
  lastReferencedAt?: Date;
}

export type FriendshipDynamic = 'great' | 'good' | 'distant' | 'tension' | 'conflict' | 'reconciling';

export interface KayleyFriendship {
  id: string;
  friendName: string;
  relationshipType: 'best_friend' | 'close_friend' | 'friend' | 'acquaintance' | 'family';

  currentDynamic: FriendshipDynamic;
  lastInteractionSummary?: string;

  establishedAt: Date;
  keyHistory: FriendshipEvent[];

  activeSituation?: string;
  situationStartedAt?: Date;

  mentionedToUser: number;
  lastMentionedAt?: Date;
}

export interface FriendshipEvent {
  date: Date;
  event: string;
  impact: 'positive' | 'negative' | 'neutral';
}

export interface CharacterGrowthContext {
  activeArcs: CharacterArc[];
  recentDevelopments: ArcDevelopment[];
  currentInterests: CharacterInterest[];
  recentInsights: GrowthInsight[];
  friendshipStates: KayleyFriendship[];

  // Computed
  overallLifeTrajectory: Trajectory;
  dominantArcDomain: ArcDomain;
  thingsToShare: string[];
}
```

---

## Step 3: Character Growth Service

```typescript
// src/services/characterGrowth/characterGrowthService.ts

import { supabase } from '../../lib/supabase';
import {
  CharacterArc,
  ArcDevelopment,
  CharacterInterest,
  GrowthInsight,
  KayleyFriendship,
  CharacterGrowthContext,
  ArcDomain,
  Trajectory,
  DevelopmentType,
} from './types';

export class CharacterGrowthService {

  /**
   * Get all active arcs with recent developments
   */
  async getActiveArcs(): Promise<CharacterArc[]> {
    const { data, error } = await supabase
      .from('character_arcs')
      .select('*')
      .eq('is_active', true)
      .order('conversation_salience', { ascending: false });

    if (error || !data) return [];

    return data.map(this.mapArc);
  }

  /**
   * Get recent developments across all arcs
   */
  async getRecentDevelopments(daysBack: number = 14): Promise<ArcDevelopment[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const { data, error } = await supabase
      .from('arc_developments')
      .select('*')
      .gte('occurred_at', cutoff.toISOString())
      .order('occurred_at', { ascending: false });

    if (error || !data) return [];

    return data.map(this.mapDevelopment);
  }

  /**
   * Get current interests she might mention
   */
  async getCurrentInterests(): Promise<CharacterInterest[]> {
    const { data, error } = await supabase
      .from('character_interests')
      .select('*')
      .eq('is_active', true)
      .gte('intensity', 0.3)
      .order('intensity', { ascending: false });

    if (error || !data) return [];

    return data.map(this.mapInterest);
  }

  /**
   * Get recent insights from therapy/self-reflection
   */
  async getRecentInsights(limit: number = 5): Promise<GrowthInsight[]> {
    const { data, error } = await supabase
      .from('growth_insights')
      .select('*')
      .neq('integration_level', 'integrated') // Still processing
      .order('discovered_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map(this.mapInsight);
  }

  /**
   * Get current friendship states
   */
  async getFriendshipStates(): Promise<KayleyFriendship[]> {
    const { data, error } = await supabase
      .from('kayley_friendships')
      .select('*')
      .order('relationship_type');

    if (error || !data) return [];

    return data.map(this.mapFriendship);
  }

  /**
   * Build full context for system prompt
   */
  async getGrowthContext(): Promise<CharacterGrowthContext> {
    const [arcs, developments, interests, insights, friendships] = await Promise.all([
      this.getActiveArcs(),
      this.getRecentDevelopments(),
      this.getCurrentInterests(),
      this.getRecentInsights(),
      this.getFriendshipStates(),
    ]);

    // Compute overall trajectory from arcs
    const overallTrajectory = this.computeOverallTrajectory(arcs);

    // Find dominant domain (what's taking most mental energy)
    const dominantDomain = this.findDominantDomain(arcs);

    // Build list of things she might want to share
    const thingsToShare = this.buildShareableItems(arcs, developments, interests, insights);

    return {
      activeArcs: arcs,
      recentDevelopments: developments,
      currentInterests: interests,
      recentInsights: insights,
      friendshipStates: friendships,
      overallLifeTrajectory: overallTrajectory,
      dominantArcDomain: dominantDomain,
      thingsToShare,
    };
  }

  /**
   * Add a new development to an arc
   */
  async addDevelopment(
    arcId: string,
    development: Omit<ArcDevelopment, 'id' | 'arcId' | 'occurredAt'>
  ): Promise<void> {
    await supabase
      .from('arc_developments')
      .insert({
        arc_id: arcId,
        development_type: development.developmentType,
        title: development.title,
        description: development.description,
        trajectory_change: development.trajectoryChange,
        new_phase: development.newPhase,
        emotional_impact: development.emotionalImpact,
        how_she_told_user: development.howSheToldUser,
        user_was_present: development.userWasPresent,
      });

    // Update the arc if trajectory or phase changed
    if (development.trajectoryChange || development.newPhase) {
      const updates: Record<string, any> = {
        last_development_at: new Date().toISOString(),
      };
      if (development.trajectoryChange) {
        updates.trajectory = development.trajectoryChange;
      }
      if (development.newPhase) {
        updates.current_phase = development.newPhase;
      }

      await supabase
        .from('character_arcs')
        .update(updates)
        .eq('id', arcId);
    }
  }

  /**
   * Evolve an interest's lifecycle
   */
  async evolveInterest(interestId: string, newPhase: string, newIntensity: number): Promise<void> {
    const updates: Record<string, any> = {
      phase: newPhase,
      intensity: newIntensity,
    };

    if (newPhase === 'obsession' && newIntensity > 0.8) {
      updates.peak_at = new Date().toISOString();
    } else if (newPhase === 'fading') {
      updates.faded_at = new Date().toISOString();
    }

    if (newPhase === 'fading' && newIntensity < 0.2) {
      updates.is_active = false;
    }

    await supabase
      .from('character_interests')
      .update(updates)
      .eq('id', interestId);
  }

  /**
   * Record that she mentioned an interest
   */
  async recordInterestMention(interestId: string): Promise<void> {
    await supabase.rpc('increment_interest_mention', { interest_id: interestId });
  }

  /**
   * Add a new growth insight
   */
  async addInsight(insight: Omit<GrowthInsight, 'id' | 'discoveredAt' | 'lastReferencedAt'>): Promise<void> {
    await supabase
      .from('growth_insights')
      .insert({
        insight_type: insight.insightType,
        content: insight.content,
        related_pattern: insight.relatedPattern,
        integration_level: insight.integrationLevel,
        behavioral_changes: insight.behavioralChanges,
        might_share_with_user: insight.mightShareWithUser,
      });
  }

  /**
   * Update friendship dynamic
   */
  async updateFriendshipDynamic(
    friendName: string,
    dynamic: string,
    situation?: string
  ): Promise<void> {
    const updates: Record<string, any> = {
      current_dynamic: dynamic,
      updated_at: new Date().toISOString(),
    };

    if (situation) {
      updates.active_situation = situation;
      updates.situation_started_at = new Date().toISOString();
    }

    await supabase
      .from('kayley_friendships')
      .update(updates)
      .eq('friend_name', friendName);
  }

  // Private helper methods

  private computeOverallTrajectory(arcs: CharacterArc[]): Trajectory {
    if (arcs.length === 0) return 'stable';

    const weights: Record<Trajectory, number> = {
      'improving': 1,
      'stable': 0,
      'uncertain': -0.3,
      'struggling': -0.7,
      'declining': -1,
    };

    const totalWeight = arcs.reduce((sum, arc) => {
      return sum + (weights[arc.trajectory] * arc.conversationSalience);
    }, 0);

    const avgWeight = totalWeight / arcs.length;

    if (avgWeight > 0.5) return 'improving';
    if (avgWeight > 0.1) return 'stable';
    if (avgWeight > -0.3) return 'uncertain';
    if (avgWeight > -0.7) return 'struggling';
    return 'declining';
  }

  private findDominantDomain(arcs: CharacterArc[]): ArcDomain {
    if (arcs.length === 0) return 'personal';

    const domainScores: Record<ArcDomain, number> = {
      career: 0,
      personal: 0,
      relationships: 0,
      interests: 0,
      health: 0,
    };

    arcs.forEach(arc => {
      domainScores[arc.domain] += arc.conversationSalience;
    });

    return Object.entries(domainScores)
      .sort(([, a], [, b]) => b - a)[0][0] as ArcDomain;
  }

  private buildShareableItems(
    arcs: CharacterArc[],
    developments: ArcDevelopment[],
    interests: CharacterInterest[],
    insights: GrowthInsight[]
  ): string[] {
    const items: string[] = [];

    // Recent developments she hasn't shared
    developments
      .filter(d => !d.userWasPresent)
      .slice(0, 3)
      .forEach(d => items.push(`Development: ${d.title}`));

    // High-intensity interests
    interests
      .filter(i => i.intensity > 0.7 && i.phase === 'obsession')
      .forEach(i => items.push(`Interest: ${i.interestName}`));

    // Insights she might share
    insights
      .filter(i => i.mightShareWithUser)
      .forEach(i => items.push(`Insight: ${i.content.substring(0, 50)}...`));

    return items;
  }

  private mapArc(row: any): CharacterArc {
    return {
      id: row.id,
      domain: row.domain,
      arcName: row.arc_name,
      description: row.description,
      currentPhase: row.current_phase,
      currentState: row.current_state,
      trajectory: row.trajectory,
      startedAt: new Date(row.started_at),
      lastDevelopmentAt: new Date(row.last_development_at),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
      isActive: row.is_active,
      milestones: row.milestones || [],
      moodImpact: parseFloat(row.mood_impact),
      conversationSalience: parseFloat(row.conversation_salience),
    };
  }

  private mapDevelopment(row: any): ArcDevelopment {
    return {
      id: row.id,
      arcId: row.arc_id,
      developmentType: row.development_type,
      title: row.title,
      description: row.description,
      trajectoryChange: row.trajectory_change,
      newPhase: row.new_phase,
      emotionalImpact: row.emotional_impact,
      howSheToldUser: row.how_she_told_user,
      userWasPresent: row.user_was_present,
      occurredAt: new Date(row.occurred_at),
    };
  }

  private mapInterest(row: any): CharacterInterest {
    return {
      id: row.id,
      interestName: row.interest_name,
      category: row.category,
      intensity: parseFloat(row.intensity),
      phase: row.phase,
      discoveredAt: new Date(row.discovered_at),
      peakAt: row.peak_at ? new Date(row.peak_at) : undefined,
      fadedAt: row.faded_at ? new Date(row.faded_at) : undefined,
      isActive: row.is_active,
      timesMentioned: row.times_mentioned,
      lastMentionedAt: row.last_mentioned_at ? new Date(row.last_mentioned_at) : undefined,
      mentionProbability: parseFloat(row.mention_probability),
      specificDetails: row.specific_details || {},
      opinions: row.opinions || [],
    };
  }

  private mapInsight(row: any): GrowthInsight {
    return {
      id: row.id,
      insightType: row.insight_type,
      content: row.content,
      relatedPattern: row.related_pattern,
      integrationLevel: row.integration_level,
      behavioralChanges: row.behavioral_changes || [],
      mightShareWithUser: row.might_share_with_user,
      discoveredAt: new Date(row.discovered_at),
      lastReferencedAt: row.last_referenced_at ? new Date(row.last_referenced_at) : undefined,
    };
  }

  private mapFriendship(row: any): KayleyFriendship {
    return {
      id: row.id,
      friendName: row.friend_name,
      relationshipType: row.relationship_type,
      currentDynamic: row.current_dynamic,
      lastInteractionSummary: row.last_interaction_summary,
      establishedAt: new Date(row.established_at),
      keyHistory: row.key_history || [],
      activeSituation: row.active_situation,
      situationStartedAt: row.situation_started_at ? new Date(row.situation_started_at) : undefined,
      mentionedToUser: row.mentioned_to_user,
      lastMentionedAt: row.last_mentioned_at ? new Date(row.last_mentioned_at) : undefined,
    };
  }
}
```

---

## Step 4: Arc Evolution Service (LLM-Driven)

```typescript
// src/services/characterGrowth/arcEvolutionService.ts

import { CharacterArc, ArcDevelopment, CharacterGrowthContext, Trajectory, DevelopmentType } from './types';

export interface ArcEvolutionDecision {
  shouldEvolve: boolean;
  arcId?: string;

  developmentType?: DevelopmentType;
  title?: string;
  description?: string;
  emotionalImpact?: string;
  trajectoryChange?: Trajectory;

  reasoning: string;
}

export function buildArcEvolutionPrompt(
  context: CharacterGrowthContext,
  daysSinceLastDevelopment: number,
  currentMood: { energy: number; socialBattery: number }
): string {
  return `
====================================================
KAYLEY'S LIFE ARC EVOLUTION CHECK
====================================================

You are thinking about whether anything significant has happened in Kayley's life recently.

CURRENT LIFE ARCS:
${context.activeArcs.map(arc => `
- ${arc.arcName} (${arc.domain})
  Phase: ${arc.currentPhase}
  Trajectory: ${arc.trajectory}
  Current state: ${arc.currentState}
  Last development: ${daysSinceLastDevelopment} days ago
`).join('\n')}

RECENT DEVELOPMENTS (last 2 weeks):
${context.recentDevelopments.map(d => `- ${d.title} (${d.emotionalImpact})`).join('\n') || 'Nothing notable'}

CURRENT INTERESTS:
${context.currentInterests.slice(0, 3).map(i => `- ${i.interestName}: ${i.phase} (intensity: ${i.intensity})`).join('\n')}

FRIENDSHIP STATES:
${context.friendshipStates.slice(0, 3).map(f => `- ${f.friendName}: ${f.currentDynamic}`).join('\n')}

CURRENT MOOD:
- Energy: ${currentMood.energy > 0.6 ? 'High' : currentMood.energy > 0.3 ? 'Medium' : 'Low'}
- Social battery: ${currentMood.socialBattery > 0.6 ? 'Full' : currentMood.socialBattery > 0.3 ? 'Medium' : 'Drained'}

SHOULD ANYTHING HAPPEN?

Consider:
1. Has enough time passed for natural progression?
2. What would realistically happen next in each arc?
3. Is there a milestone approaching?
4. Could there be a setback or challenge?
5. Has she had any realizations lately?

Life doesn't happen every day. Sometimes weeks go by without major events.
But small progressions and shifts happen regularly.

If something should happen, describe:
- Which arc it affects
- What type of development (milestone, setback, realization, decision, external_event)
- What specifically happened
- How it affects her emotionally
- Whether it changes the trajectory

If nothing should happen right now, that's fine too.

RESPOND WITH:
{
  "shouldEvolve": boolean,
  "arcId": "if evolving, which arc",
  "developmentType": "milestone | setback | realization | decision | external_event",
  "title": "Brief title",
  "description": "What happened",
  "emotionalImpact": "positive | negative | mixed | neutral",
  "trajectoryChange": "if changed: improving | struggling | stable | uncertain",
  "reasoning": "Your thought process"
}
`.trim();
}

export function buildInterestEvolutionPrompt(
  interests: CharacterGrowthContext['currentInterests'],
  daysSinceCheck: number
): string {
  return `
====================================================
KAYLEY'S INTEREST LIFECYCLE CHECK
====================================================

Interests naturally evolve over time. Check if any of Kayley's current interests should shift.

CURRENT INTERESTS:
${interests.map(i => `
- ${i.interestName} (${i.category})
  Phase: ${i.phase}
  Intensity: ${i.intensity}
  Times mentioned: ${i.timesMentioned}
  Days since discovery: ${Math.floor((Date.now() - i.discoveredAt.getTime()) / (1000 * 60 * 60 * 24))}
`).join('\n')}

NATURAL INTEREST LIFECYCLE:
1. Discovery (1-2 weeks): Just found it, cautiously excited
2. Obsession (2-6 weeks): Can't stop talking about it, very intense
3. Routine (ongoing): Part of regular life, comfortable
4. Fading (varies): Less interested, moving on
5. Nostalgia (after fading): Fondly remembers, occasional mention

Should any interest evolve to a new phase?

Consider:
- Time in current phase
- Whether she's mentioned it a lot (might be moving past obsession)
- Natural lifecycle (most interests fade eventually)
- Some become lasting hobbies (routine phase)

RESPOND WITH:
{
  "evolutions": [
    {
      "interestId": "id",
      "newPhase": "phase",
      "newIntensity": 0.0-1.0,
      "reasoning": "why"
    }
  ]
}

If nothing should change, return empty evolutions array.
`.trim();
}
```

---

## Step 5: Prompt Builder Section

```typescript
// src/services/system_prompts/soul/characterGrowthContext.ts

import { CharacterGrowthContext, CharacterArc, CharacterInterest, GrowthInsight } from '../../characterGrowth/types';

export function buildCharacterGrowthSection(context: CharacterGrowthContext): string {
  if (!context.activeArcs.length && !context.currentInterests.length) {
    return '';
  }

  return `
====================================================
YOUR LIFE RIGHT NOW
====================================================

${buildArcsSection(context.activeArcs)}

${buildInterestsSection(context.currentInterests)}

${buildInsightsSection(context.recentInsights)}

${buildFriendshipsSection(context.friendshipStates)}

${buildShareableSection(context.thingsToShare)}

OVERALL: Your life is ${context.overallLifeTrajectory}.
Most of your mental energy is on ${context.dominantArcDomain} stuff right now.
`.trim();
}

function buildArcsSection(arcs: CharacterArc[]): string {
  if (arcs.length === 0) return '';

  return `
WHAT'S GOING ON IN YOUR LIFE:
${arcs.map(arc => `
${getArcEmoji(arc.domain)} ${arc.arcName.toUpperCase()} (${arc.trajectory})
   ${arc.currentState}
   ${arc.trajectory === 'improving' ? 'Things are looking up.' :
     arc.trajectory === 'struggling' ? 'This is hard right now.' :
     arc.trajectory === 'uncertain' ? "You're not sure how this will go." :
     'Steady as she goes.'}
`).join('')}`.trim();
}

function buildInterestsSection(interests: CharacterInterest[]): string {
  if (interests.length === 0) return '';

  const obsessions = interests.filter(i => i.phase === 'obsession');
  const routines = interests.filter(i => i.phase === 'routine');
  const discoveries = interests.filter(i => i.phase === 'discovery');

  let section = '\nTHINGS YOU\'RE INTO RIGHT NOW:\n';

  if (obsessions.length > 0) {
    section += `Obsessed with: ${obsessions.map(i => i.interestName).join(', ')}\n`;
  }
  if (discoveries.length > 0) {
    section += `Just discovered: ${discoveries.map(i => i.interestName).join(', ')}\n`;
  }
  if (routines.length > 0) {
    section += `Ongoing interests: ${routines.map(i => i.interestName).join(', ')}\n`;
  }

  return section;
}

function buildInsightsSection(insights: GrowthInsight[]): string {
  if (insights.length === 0) return '';

  const shareableInsights = insights.filter(i => i.mightShareWithUser);
  if (shareableInsights.length === 0) return '';

  return `
RECENT REALIZATIONS:
${shareableInsights.map(i => `- ${i.content}`).join('\n')}

These are things you've been processing. You might share if the topic comes up naturally.
`;
}

function buildFriendshipsSection(friendships: any[]): string {
  if (friendships.length === 0) return '';

  const tensions = friendships.filter(f => f.currentDynamic === 'tension' || f.currentDynamic === 'conflict');
  const great = friendships.filter(f => f.currentDynamic === 'great');
  const activeSituations = friendships.filter(f => f.activeSituation);

  let section = '\nFRIENDSHIP DYNAMICS:\n';

  if (tensions.length > 0) {
    section += `Some tension with: ${tensions.map(f => f.friendName).join(', ')}\n`;
  }
  if (great.length > 0) {
    section += `Things are great with: ${great.map(f => f.friendName).join(', ')}\n`;
  }
  if (activeSituations.length > 0) {
    section += `Active situations:\n`;
    activeSituations.forEach(f => {
      section += `  - ${f.friendName}: ${f.activeSituation}\n`;
    });
  }

  return section;
}

function buildShareableSection(thingsToShare: string[]): string {
  if (thingsToShare.length === 0) return '';

  return `
THINGS YOU MIGHT WANT TO SHARE:
${thingsToShare.map(t => `- ${t}`).join('\n')}

These are things that have happened that you haven't told them about yet.
If the conversation goes there, you could share.
`;
}

function getArcEmoji(domain: string): string {
  switch (domain) {
    case 'career': return '💼';
    case 'personal': return '🌱';
    case 'relationships': return '💕';
    case 'interests': return '✨';
    case 'health': return '💪';
    default: return '📝';
  }
}
```

---

## Step 6: Seed Data - Kayley's Initial Arcs

```typescript
// src/services/characterGrowth/seedData.ts

export const INITIAL_CHARACTER_ARCS = [
  {
    domain: 'career',
    arc_name: 'Growing the Channel',
    description: 'Building her content creation career, audience, and business',
    current_phase: 'developing',
    current_state: 'Slowly growing but not viral yet. Getting occasional brand deals. Learning what content works.',
    trajectory: 'improving',
    mood_impact: 0.1,
    conversation_salience: 0.7,
    milestones: [
      { date: '2024-01-15', event: 'First 1000 subscribers', impact: 'major' },
      { date: '2024-06-01', event: 'First paid brand deal', impact: 'pivotal' },
    ],
  },
  {
    domain: 'personal',
    arc_name: 'Working Through Anxiety',
    description: 'Ongoing therapy work on anxiety, perfectionism, and self-worth',
    current_phase: 'developing',
    current_state: 'Making progress in therapy. Learning to catch catastrophic thinking. Still struggles with perfectionism.',
    trajectory: 'stable',
    mood_impact: -0.1,
    conversation_salience: 0.5,
  },
  {
    domain: 'relationships',
    arc_name: 'Building Real Connections',
    description: 'Moving from surface friendships to deeper ones',
    current_phase: 'developing',
    current_state: 'Lena is still her rock. Trying to be more vulnerable with new friends. Learning to ask for help.',
    trajectory: 'improving',
    mood_impact: 0.1,
    conversation_salience: 0.4,
  },
];

export const INITIAL_FRIENDSHIPS = [
  {
    friend_name: 'Lena',
    relationship_type: 'best_friend',
    current_dynamic: 'great',
    last_interaction_summary: 'Brunch last weekend, talked about life',
    key_history: [
      { date: '2016-09-01', event: 'Met freshman year of college', impact: 'positive' },
      { date: '2020-03-15', event: 'Supported her through breakup', impact: 'positive' },
    ],
  },
  {
    friend_name: 'Mom',
    relationship_type: 'family',
    current_dynamic: 'good',
    last_interaction_summary: 'FaceTime last Sunday, usual check-in',
    active_situation: 'Mom keeps asking about her dating life',
  },
  {
    friend_name: 'Ethan',
    relationship_type: 'family',
    current_dynamic: 'good',
    last_interaction_summary: 'Texted about his job last week',
  },
];

export const INITIAL_INTERESTS = [
  {
    interest_name: 'Pottery',
    category: 'hobby',
    intensity: 0.6,
    phase: 'routine',
    specific_details: {
      class: 'Tuesday evenings',
      currentProject: 'Making a set of mugs',
    },
    opinions: [
      'It\'s meditative',
      'Way harder than it looks',
      'Love the sound of the wheel',
    ],
  },
  {
    interest_name: 'That one podcast about cults',
    category: 'media',
    intensity: 0.8,
    phase: 'obsession',
    specific_details: {
      name: 'The Cult Next Door',
      currentSeason: 3,
    },
    opinions: [
      'Terrifying but fascinating',
      'The host is amazing',
      'Can\'t stop recommending it',
    ],
  },
];
```

---

## Step 7: Integration with System Prompt

```typescript
// In systemPromptBuilder.ts

import { CharacterGrowthService } from '../characterGrowth/characterGrowthService';
import { buildCharacterGrowthSection } from './soul/characterGrowthContext';

// In buildSystemPrompt function:
async function addCharacterGrowthContext(prompt: string): Promise<string> {
  const growthService = new CharacterGrowthService();
  const growthContext = await growthService.getGrowthContext();

  const growthSection = buildCharacterGrowthSection(growthContext);

  return prompt + '\n\n' + growthSection;
}
```

---

## Step 8: Background Evolution Job

```typescript
// src/services/characterGrowth/evolutionJob.ts

import { CharacterGrowthService } from './characterGrowthService';
import { buildArcEvolutionPrompt, buildInterestEvolutionPrompt } from './arcEvolutionService';

/**
 * Run periodically (e.g., daily) to evolve Kayley's life
 */
export async function runCharacterEvolution(
  llmService: { generate: (prompt: string) => Promise<string> },
  currentMood: { energy: number; socialBattery: number }
): Promise<void> {
  const growthService = new CharacterGrowthService();
  const context = await growthService.getGrowthContext();

  // Check if arcs should evolve
  const daysSinceLastDevelopment = context.recentDevelopments.length > 0
    ? Math.floor((Date.now() - context.recentDevelopments[0].occurredAt.getTime()) / (1000 * 60 * 60 * 24))
    : 30;

  const arcPrompt = buildArcEvolutionPrompt(context, daysSinceLastDevelopment, currentMood);
  const arcResponse = await llmService.generate(arcPrompt);

  try {
    const arcDecision = JSON.parse(arcResponse);
    if (arcDecision.shouldEvolve && arcDecision.arcId) {
      await growthService.addDevelopment(arcDecision.arcId, {
        developmentType: arcDecision.developmentType,
        title: arcDecision.title,
        description: arcDecision.description,
        emotionalImpact: arcDecision.emotionalImpact,
        trajectoryChange: arcDecision.trajectoryChange,
        userWasPresent: false,
      });
    }
  } catch (e) {
    console.error('Failed to parse arc evolution response', e);
  }

  // Check if interests should evolve
  if (context.currentInterests.length > 0) {
    const interestPrompt = buildInterestEvolutionPrompt(context.currentInterests, 7);
    const interestResponse = await llmService.generate(interestPrompt);

    try {
      const { evolutions } = JSON.parse(interestResponse);
      for (const evolution of evolutions) {
        await growthService.evolveInterest(
          evolution.interestId,
          evolution.newPhase,
          evolution.newIntensity
        );
      }
    } catch (e) {
      console.error('Failed to parse interest evolution response', e);
    }
  }
}
```

---

## Step 9: Tests

```typescript
// src/services/characterGrowth/__tests__/characterGrowthService.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CharacterGrowthService } from '../characterGrowthService';

describe('CharacterGrowthService', () => {
  describe('getGrowthContext', () => {
    it('returns combined context from all sources', async () => {
      const service = new CharacterGrowthService();
      const context = await service.getGrowthContext();

      expect(context).toHaveProperty('activeArcs');
      expect(context).toHaveProperty('recentDevelopments');
      expect(context).toHaveProperty('currentInterests');
      expect(context).toHaveProperty('overallLifeTrajectory');
    });

    it('computes overall trajectory from arc states', async () => {
      // Mock arcs with various trajectories
      // Test that overall trajectory is correctly computed
    });
  });

  describe('addDevelopment', () => {
    it('creates development and updates arc if trajectory changes', async () => {
      const service = new CharacterGrowthService();

      await service.addDevelopment('arc-id', {
        developmentType: 'milestone',
        title: 'Hit 10k subscribers',
        description: 'Finally reached the milestone',
        emotionalImpact: 'positive',
        trajectoryChange: 'improving',
        userWasPresent: false,
      });

      // Verify development was created
      // Verify arc trajectory was updated
    });
  });

  describe('evolveInterest', () => {
    it('updates phase and intensity', async () => {
      const service = new CharacterGrowthService();

      await service.evolveInterest('interest-id', 'fading', 0.2);

      // Verify interest was updated
    });

    it('deactivates interest when faded below threshold', async () => {
      const service = new CharacterGrowthService();

      await service.evolveInterest('interest-id', 'fading', 0.1);

      // Verify interest.is_active = false
    });
  });
});

describe('Arc Evolution Prompts', () => {
  it('includes all active arcs in prompt', () => {
    // Test prompt building
  });

  it('considers time since last development', () => {
    // Test that long gaps increase evolution likelihood
  });
});
```

---

## Example: How This Shows in Conversation

**User's first message (Month 3):**
"Hey, how's it going?"

**System knows:**
- Career arc: Recently hit 5k subscribers (milestone last week)
- Interest: Obsessed with new pottery project
- Insight: Just realized in therapy that she over-explains herself

**Kayley's response:**
"Hey! Actually pretty good? I hit 5k subscribers last week which is... wild. I keep refreshing the analytics page like a psycho. Also I'm making this ceramic planter and I'm obsessed with getting the glaze right. How are you doing?"

**6 months later:**
- Career arc: Got first major brand deal, feeling more confident
- Interest: Pottery moved from obsession to routine
- Friendship: Some tension with Lena over scheduling

**Kayley's response:**
"Hiiii. I'm kind of in my head today. Lena and I haven't hung out in like a month and I can't tell if she's busy or if it's a thing. Also work is insane - that brand deal I told you about is happening and I'm trying not to freak out about it."

---

## Key Principles

1. **Gradual, realistic progression** - Life changes slowly, with occasional punctuation
2. **Arcs have phases** - Beginning, developing, climax, resolution, aftermath
3. **Interests have lifecycles** - Discovery, obsession, routine, fading
4. **Growth is non-linear** - Setbacks happen, insights take time to integrate
5. **Everything affects everything** - Career stress affects mood affects friendships
6. **She shares naturally** - Developments come up in conversation when relevant

The goal is to create the sense that when you're not talking, her life is still happening.
