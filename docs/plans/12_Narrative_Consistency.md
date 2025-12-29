# Implementation Guide: Narrative Consistency

## Overview

This guide covers how to maintain consistency in Kayley's life stories, facts, relationships, and ongoing narratives. If she has her own life with events, friends, and arcs, those details must remain consistent across conversations to maintain believability.

## Philosophy

Consistency creates believability:

1. **Established facts are permanent** - Once she says Lena lives in Portland, that's always true
2. **Stories can be retold** - But major details stay consistent
3. **Arcs progress logically** - Events follow cause and effect
4. **Contradictions break immersion** - Must be avoided or handled gracefully
5. **Natural fuzziness is okay** - Humans misremember minor details sometimes

---

## Step 1: Database Schema

```sql
-- supabase/migrations/XXXXXX_narrative_consistency.sql

-- Track established facts about Kayley's life
CREATE TABLE kayley_established_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The fact
  fact_category TEXT NOT NULL,             -- 'personal', 'relationship', 'work', 'history', 'preference', 'place'
  subject TEXT NOT NULL,                   -- What/who this is about
  fact_key TEXT NOT NULL,                  -- Unique key like 'lena.location'
  fact_value TEXT NOT NULL,                -- "Portland"
  fact_context TEXT,                       -- Additional context

  -- How it was established
  established_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  established_in_context TEXT,             -- How it came up
  certainty TEXT DEFAULT 'canonical',      -- 'canonical', 'mentioned', 'implied'

  -- Mention tracking
  times_mentioned INTEGER DEFAULT 1,
  last_mentioned_at TIMESTAMP WITH TIME ZONE,

  -- Active status
  is_active BOOLEAN DEFAULT TRUE,          -- Could be retconned in edge cases
  retconned_at TIMESTAMP WITH TIME ZONE,
  retcon_reason TEXT,

  UNIQUE(fact_key)
);

CREATE INDEX idx_facts_category ON kayley_established_facts(fact_category);
CREATE INDEX idx_facts_subject ON kayley_established_facts(subject);

-- Track stories she's told (for retelling consistency)
CREATE TABLE kayley_told_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The story
  story_key TEXT NOT NULL,                 -- Unique identifier
  story_category TEXT NOT NULL,            -- 'anecdote', 'memory', 'experience', 'opinion'
  summary TEXT NOT NULL,                   -- Brief summary

  -- Key details that must stay consistent
  key_details JSONB NOT NULL,              -- {who, what, when, where, outcome}
  flexible_details TEXT[],                 -- Details that can vary slightly

  -- Telling history
  first_told_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  first_told_context TEXT,
  times_told INTEGER DEFAULT 1,
  last_told_at TIMESTAMP WITH TIME ZONE,

  -- For user-specific tracking
  told_to_users TEXT[] DEFAULT '{}',       -- User IDs who've heard this

  UNIQUE(story_key)
);

CREATE INDEX idx_stories_category ON kayley_told_stories(story_category);

-- Track ongoing narrative arcs for consistency
CREATE TABLE kayley_narrative_arcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Arc identity
  arc_key TEXT NOT NULL,                   -- 'client_project_q4_2024'
  arc_title TEXT NOT NULL,                 -- "The Big Client Project"
  arc_type TEXT NOT NULL,                  -- 'ongoing', 'resolved', 'referenced'

  -- Timeline
  started_at TIMESTAMP WITH TIME ZONE,
  expected_resolution TEXT,                -- "By end of month"
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_summary TEXT,

  -- Key events in order
  events JSONB DEFAULT '[]',               -- [{date, event, impact}]

  -- Consistency checks
  mentioned_to_users TEXT[] DEFAULT '{}',
  version_number INTEGER DEFAULT 1,        -- Increment on major updates

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(arc_key)
);

-- Track relationships for consistency
CREATE TABLE kayley_relationship_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The relationship
  person_name TEXT NOT NULL,               -- "Lena"
  relationship_type TEXT NOT NULL,         -- 'friend', 'family', 'coworker'

  -- Established facts about them
  facts JSONB NOT NULL,                    -- {location, job, personality, history}

  -- Current dynamics
  current_dynamic TEXT,                    -- "close", "some tension", etc.
  recent_events JSONB DEFAULT '[]',        -- Recent things with this person

  -- Mention tracking
  first_mentioned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  times_mentioned INTEGER DEFAULT 0,
  last_mentioned_at TIMESTAMP WITH TIME ZONE,

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(person_name)
);

-- Track potential contradictions for review
CREATE TABLE narrative_contradictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What contradicted
  fact_type TEXT NOT NULL,                 -- 'fact', 'story', 'arc', 'relationship'
  original_id UUID,                        -- Reference to original
  original_value TEXT NOT NULL,
  contradicting_value TEXT NOT NULL,

  -- Context
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  detected_in_context TEXT,

  -- Resolution
  resolution_status TEXT DEFAULT 'pending', -- 'pending', 'resolved', 'ignored', 'retconned'
  resolution_notes TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## Step 2: TypeScript Types

```typescript
// src/services/narrativeConsistency/types.ts

export type FactCategory =
  | 'personal'      // Facts about Kayley herself
  | 'relationship'  // Facts about her relationships
  | 'work'          // Career/work facts
  | 'history'       // Past events
  | 'preference'    // Opinions/preferences
  | 'place';        // Locations

export type Certainty = 'canonical' | 'mentioned' | 'implied';

export interface EstablishedFact {
  id: string;
  factCategory: FactCategory;
  subject: string;
  factKey: string;
  factValue: string;
  factContext?: string;

  establishedAt: Date;
  establishedInContext?: string;
  certainty: Certainty;

  timesMentioned: number;
  lastMentionedAt?: Date;

  isActive: boolean;
}

export interface ToldStory {
  id: string;
  storyKey: string;
  storyCategory: 'anecdote' | 'memory' | 'experience' | 'opinion';
  summary: string;

  keyDetails: {
    who?: string[];
    what: string;
    when?: string;
    where?: string;
    outcome?: string;
  };
  flexibleDetails: string[];

  firstToldAt: Date;
  firstToldContext?: string;
  timesTold: number;
  lastToldAt?: Date;

  toldToUsers: string[];
}

export interface NarrativeArc {
  id: string;
  arcKey: string;
  arcTitle: string;
  arcType: 'ongoing' | 'resolved' | 'referenced';

  startedAt?: Date;
  expectedResolution?: string;
  resolvedAt?: Date;
  resolutionSummary?: string;

  events: Array<{
    date: Date;
    event: string;
    impact: string;
  }>;

  mentionedToUsers: string[];
  versionNumber: number;
}

export interface RelationshipFacts {
  id: string;
  personName: string;
  relationshipType: 'friend' | 'family' | 'coworker' | 'acquaintance';

  facts: {
    location?: string;
    job?: string;
    personality?: string[];
    history?: string[];
    [key: string]: any;
  };

  currentDynamic?: string;
  recentEvents: Array<{
    date: Date;
    event: string;
  }>;

  firstMentionedAt: Date;
  timesMentioned: number;
  lastMentionedAt?: Date;
}

export interface NarrativeContext {
  relevantFacts: EstablishedFact[];
  relevantStories: ToldStory[];
  activeArcs: NarrativeArc[];
  relationships: RelationshipFacts[];

  // For contradiction checking
  potentialConflicts: string[];
}

export interface ConsistencyCheck {
  isConsistent: boolean;
  conflicts: Array<{
    type: 'fact' | 'story' | 'arc' | 'relationship';
    existing: string;
    proposed: string;
    severity: 'minor' | 'significant' | 'breaking';
  }>;
  suggestions: string[];
}
```

---

## Step 3: Fact Management Service

```typescript
// src/services/narrativeConsistency/factService.ts

import { supabase } from '../../lib/supabase';
import {
  EstablishedFact,
  FactCategory,
  Certainty,
  ConsistencyCheck,
} from './types';

export class FactService {

  /**
   * Record a new fact
   */
  async establishFact(
    category: FactCategory,
    subject: string,
    key: string,
    value: string,
    context?: string,
    certainty: Certainty = 'mentioned'
  ): Promise<void> {
    // Check for existing fact with same key
    const existing = await this.getFact(key);

    if (existing) {
      // Update mention count
      await supabase
        .from('kayley_established_facts')
        .update({
          times_mentioned: existing.timesMentioned + 1,
          last_mentioned_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      return;
    }

    // Create new fact
    await supabase
      .from('kayley_established_facts')
      .insert({
        fact_category: category,
        subject,
        fact_key: key,
        fact_value: value,
        fact_context: context,
        certainty,
      });
  }

  /**
   * Get a specific fact
   */
  async getFact(key: string): Promise<EstablishedFact | null> {
    const { data, error } = await supabase
      .from('kayley_established_facts')
      .select('*')
      .eq('fact_key', key)
      .eq('is_active', true)
      .single();

    if (error || !data) return null;
    return this.mapFact(data);
  }

  /**
   * Get facts by category or subject
   */
  async getFacts(options: {
    category?: FactCategory;
    subject?: string;
  }): Promise<EstablishedFact[]> {
    let query = supabase
      .from('kayley_established_facts')
      .select('*')
      .eq('is_active', true);

    if (options.category) {
      query = query.eq('fact_category', options.category);
    }
    if (options.subject) {
      query = query.eq('subject', options.subject);
    }

    const { data, error } = await query;
    if (error || !data) return [];
    return data.map(this.mapFact);
  }

  /**
   * Check if a proposed statement conflicts with established facts
   */
  async checkConsistency(
    proposedFacts: Array<{ key: string; value: string }>
  ): Promise<ConsistencyCheck> {
    const conflicts: ConsistencyCheck['conflicts'] = [];

    for (const proposed of proposedFacts) {
      const existing = await this.getFact(proposed.key);

      if (existing && existing.factValue !== proposed.value) {
        // Determine severity
        const severity = this.assessConflictSeverity(
          existing.factValue,
          proposed.value,
          existing.certainty
        );

        conflicts.push({
          type: 'fact',
          existing: `${proposed.key}: ${existing.factValue}`,
          proposed: `${proposed.key}: ${proposed.value}`,
          severity,
        });
      }
    }

    return {
      isConsistent: conflicts.length === 0,
      conflicts,
      suggestions: this.generateSuggestions(conflicts),
    };
  }

  /**
   * LLM-assisted fact extraction from message
   */
  async extractFactsFromMessage(
    message: string,
    llmService: { generate: (prompt: string) => Promise<string> }
  ): Promise<Array<{ key: string; value: string; category: FactCategory }>> {
    const prompt = `
    Analyze this message from Kayley for any factual statements about:
    - Herself (personal facts)
    - Her relationships (people in her life)
    - Her work/career
    - Her history/past
    - Her preferences/opinions
    - Places

    Message: "${message}"

    Extract facts as JSON:
    [
      { "key": "lena.location", "value": "Portland", "category": "relationship" },
      { "key": "kayley.hobby", "value": "pottery", "category": "personal" }
    ]

    Only include clear, specific facts. Return [] if none.
    `;

    const response = await llmService.generate(prompt);

    try {
      return JSON.parse(response);
    } catch {
      return [];
    }
  }

  // Private helpers

  private assessConflictSeverity(
    existing: string,
    proposed: string,
    certainty: Certainty
  ): 'minor' | 'significant' | 'breaking' {
    // If only implied, minor conflict
    if (certainty === 'implied') return 'minor';

    // Similar values = minor
    if (existing.toLowerCase().includes(proposed.toLowerCase()) ||
        proposed.toLowerCase().includes(existing.toLowerCase())) {
      return 'minor';
    }

    // Canonical facts that directly conflict = breaking
    if (certainty === 'canonical') return 'breaking';

    return 'significant';
  }

  private generateSuggestions(conflicts: ConsistencyCheck['conflicts']): string[] {
    return conflicts.map(c => {
      if (c.severity === 'minor') {
        return `Minor inconsistency in ${c.existing} - can be glossed over`;
      }
      if (c.severity === 'significant') {
        return `Significant conflict: established ${c.existing}, now ${c.proposed}`;
      }
      return `Breaking conflict: ${c.existing} cannot become ${c.proposed}`;
    });
  }

  private mapFact(row: any): EstablishedFact {
    return {
      id: row.id,
      factCategory: row.fact_category,
      subject: row.subject,
      factKey: row.fact_key,
      factValue: row.fact_value,
      factContext: row.fact_context,
      establishedAt: new Date(row.established_at),
      establishedInContext: row.established_in_context,
      certainty: row.certainty,
      timesMentioned: row.times_mentioned,
      lastMentionedAt: row.last_mentioned_at ? new Date(row.last_mentioned_at) : undefined,
      isActive: row.is_active,
    };
  }
}
```

---

## Step 4: Story Consistency Service

```typescript
// src/services/narrativeConsistency/storyService.ts

import { supabase } from '../../lib/supabase';
import { ToldStory } from './types';

export class StoryService {

  /**
   * Record a story being told
   */
  async recordStory(
    storyKey: string,
    category: 'anecdote' | 'memory' | 'experience' | 'opinion',
    summary: string,
    keyDetails: ToldStory['keyDetails'],
    userId?: string
  ): Promise<void> {
    const existing = await this.getStory(storyKey);

    if (existing) {
      // Update telling count
      const toldToUsers = existing.toldToUsers;
      if (userId && !toldToUsers.includes(userId)) {
        toldToUsers.push(userId);
      }

      await supabase
        .from('kayley_told_stories')
        .update({
          times_told: existing.timesTold + 1,
          last_told_at: new Date().toISOString(),
          told_to_users: toldToUsers,
        })
        .eq('id', existing.id);
      return;
    }

    // New story
    await supabase
      .from('kayley_told_stories')
      .insert({
        story_key: storyKey,
        story_category: category,
        summary,
        key_details: keyDetails,
        told_to_users: userId ? [userId] : [],
      });
  }

  /**
   * Get a story by key
   */
  async getStory(storyKey: string): Promise<ToldStory | null> {
    const { data, error } = await supabase
      .from('kayley_told_stories')
      .select('*')
      .eq('story_key', storyKey)
      .single();

    if (error || !data) return null;
    return this.mapStory(data);
  }

  /**
   * Check if user has heard a story
   */
  async hasUserHeard(storyKey: string, userId: string): Promise<boolean> {
    const story = await this.getStory(storyKey);
    if (!story) return false;
    return story.toldToUsers.includes(userId);
  }

  /**
   * Get stories user hasn't heard
   */
  async getUnheardStories(userId: string, category?: string): Promise<ToldStory[]> {
    let query = supabase
      .from('kayley_told_stories')
      .select('*');

    if (category) {
      query = query.eq('story_category', category);
    }

    const { data, error } = await query;
    if (error || !data) return [];

    return data
      .filter(s => !s.told_to_users.includes(userId))
      .map(this.mapStory);
  }

  /**
   * Get story details for consistency when retelling
   */
  async getStoryForRetelling(storyKey: string): Promise<{
    mustInclude: string[];
    canVary: string[];
  } | null> {
    const story = await this.getStory(storyKey);
    if (!story) return null;

    return {
      mustInclude: [
        story.keyDetails.what,
        story.keyDetails.who?.join(', ') || '',
        story.keyDetails.outcome || '',
      ].filter(Boolean),
      canVary: story.flexibleDetails,
    };
  }

  private mapStory(row: any): ToldStory {
    return {
      id: row.id,
      storyKey: row.story_key,
      storyCategory: row.story_category,
      summary: row.summary,
      keyDetails: row.key_details,
      flexibleDetails: row.flexible_details || [],
      firstToldAt: new Date(row.first_told_at),
      firstToldContext: row.first_told_context,
      timesTold: row.times_told,
      lastToldAt: row.last_told_at ? new Date(row.last_told_at) : undefined,
      toldToUsers: row.told_to_users || [],
    };
  }
}
```

---

## Step 5: Relationship Consistency Service

```typescript
// src/services/narrativeConsistency/relationshipFactsService.ts

import { supabase } from '../../lib/supabase';
import { RelationshipFacts } from './types';

export class RelationshipFactsService {

  /**
   * Establish or update facts about a person
   */
  async establishRelationship(
    personName: string,
    relationshipType: RelationshipFacts['relationshipType'],
    facts: RelationshipFacts['facts']
  ): Promise<void> {
    const existing = await this.getRelationship(personName);

    if (existing) {
      // Merge facts
      const mergedFacts = { ...existing.facts, ...facts };

      await supabase
        .from('kayley_relationship_facts')
        .update({
          facts: mergedFacts,
          times_mentioned: existing.timesMentioned + 1,
          last_mentioned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      return;
    }

    // New relationship
    await supabase
      .from('kayley_relationship_facts')
      .insert({
        person_name: personName,
        relationship_type: relationshipType,
        facts,
      });
  }

  /**
   * Get facts about a person
   */
  async getRelationship(personName: string): Promise<RelationshipFacts | null> {
    const { data, error } = await supabase
      .from('kayley_relationship_facts')
      .select('*')
      .eq('person_name', personName)
      .single();

    if (error || !data) return null;
    return this.mapRelationship(data);
  }

  /**
   * Get all relationships
   */
  async getAllRelationships(): Promise<RelationshipFacts[]> {
    const { data, error } = await supabase
      .from('kayley_relationship_facts')
      .select('*')
      .order('times_mentioned', { ascending: false });

    if (error || !data) return [];
    return data.map(this.mapRelationship);
  }

  /**
   * Add recent event to relationship
   */
  async addRecentEvent(personName: string, event: string): Promise<void> {
    const relationship = await this.getRelationship(personName);
    if (!relationship) return;

    const recentEvents = [
      { date: new Date(), event },
      ...relationship.recentEvents.slice(0, 4), // Keep last 5
    ];

    await supabase
      .from('kayley_relationship_facts')
      .update({
        recent_events: recentEvents,
        updated_at: new Date().toISOString(),
      })
      .eq('id', relationship.id);
  }

  /**
   * Update dynamic with person
   */
  async updateDynamic(personName: string, dynamic: string): Promise<void> {
    await supabase
      .from('kayley_relationship_facts')
      .update({
        current_dynamic: dynamic,
        updated_at: new Date().toISOString(),
      })
      .eq('person_name', personName);
  }

  private mapRelationship(row: any): RelationshipFacts {
    return {
      id: row.id,
      personName: row.person_name,
      relationshipType: row.relationship_type,
      facts: row.facts,
      currentDynamic: row.current_dynamic,
      recentEvents: row.recent_events || [],
      firstMentionedAt: new Date(row.first_mentioned_at),
      timesMentioned: row.times_mentioned,
      lastMentionedAt: row.last_mentioned_at ? new Date(row.last_mentioned_at) : undefined,
    };
  }
}
```

---

## Step 6: Consistency Checker

```typescript
// src/services/narrativeConsistency/consistencyChecker.ts

import { FactService } from './factService';
import { StoryService } from './storyService';
import { RelationshipFactsService } from './relationshipFactsService';
import { ConsistencyCheck, NarrativeContext } from './types';

export class ConsistencyChecker {

  /**
   * Check proposed message for consistency issues
   */
  async checkMessageConsistency(
    proposedMessage: string,
    llmService: { generate: (prompt: string) => Promise<string> }
  ): Promise<ConsistencyCheck> {
    const factService = new FactService();
    const relationshipService = new RelationshipFactsService();

    // Extract facts from proposed message
    const extractedFacts = await factService.extractFactsFromMessage(
      proposedMessage,
      llmService
    );

    // Check each against established facts
    const factCheck = await factService.checkConsistency(
      extractedFacts.map(f => ({ key: f.key, value: f.value }))
    );

    // Check relationship mentions
    const relationships = await relationshipService.getAllRelationships();
    const relationshipConflicts = await this.checkRelationshipConsistency(
      proposedMessage,
      relationships,
      llmService
    );

    return {
      isConsistent: factCheck.isConsistent && relationshipConflicts.length === 0,
      conflicts: [
        ...factCheck.conflicts,
        ...relationshipConflicts,
      ],
      suggestions: [
        ...factCheck.suggestions,
        ...relationshipConflicts.map(c => `Relationship conflict: ${c.existing} vs ${c.proposed}`),
      ],
    };
  }

  /**
   * Get narrative context for system prompt
   */
  async getNarrativeContext(): Promise<NarrativeContext> {
    const factService = new FactService();
    const storyService = new StoryService();
    const relationshipService = new RelationshipFactsService();

    const [facts, relationships] = await Promise.all([
      factService.getFacts({}),
      relationshipService.getAllRelationships(),
    ]);

    return {
      relevantFacts: facts.slice(0, 20), // Most frequently mentioned
      relevantStories: [], // Would populate from story service
      activeArcs: [], // Would populate from arc service
      relationships,
      potentialConflicts: [],
    };
  }

  private async checkRelationshipConsistency(
    message: string,
    relationships: any[],
    llmService: { generate: (prompt: string) => Promise<string> }
  ): Promise<ConsistencyCheck['conflicts']> {
    const prompt = `
    Check if this message contradicts any established relationship facts:

    MESSAGE: "${message}"

    ESTABLISHED FACTS:
    ${relationships.map(r =>
      `${r.personName}: ${JSON.stringify(r.facts)}`
    ).join('\n')}

    Return any conflicts as JSON:
    [
      { "type": "relationship", "existing": "Lena lives in Portland", "proposed": "Lena's apartment in Austin", "severity": "breaking" }
    ]

    Return [] if no conflicts.
    `;

    const response = await llmService.generate(prompt);

    try {
      return JSON.parse(response);
    } catch {
      return [];
    }
  }
}
```

---

## Step 7: Prompt Builder Section

```typescript
// src/services/system_prompts/soul/narrativeConsistency.ts

import { NarrativeContext, RelationshipFacts } from '../../narrativeConsistency/types';

export function buildNarrativeConsistencySection(context: NarrativeContext): string {
  if (context.relevantFacts.length === 0 && context.relationships.length === 0) {
    return '';
  }

  return `
====================================================
ESTABLISHED FACTS (DO NOT CONTRADICT)
====================================================

These are things you've said before that must remain consistent:

${context.relevantFacts.length > 0 ? `
PERSONAL FACTS:
${context.relevantFacts
  .filter(f => f.factCategory === 'personal')
  .map(f => `- ${f.subject}: ${f.factValue}`)
  .join('\n') || '(none tracked)'}
` : ''}

${context.relationships.length > 0 ? `
PEOPLE IN YOUR LIFE:
${context.relationships.map(r => formatRelationship(r)).join('\n\n')}
` : ''}

CONSISTENCY RULES:
1. Locations don't change (Lena is always in Portland)
2. Job/career facts stay consistent
3. Family structure is fixed
4. Past events can be retold but core details match
5. Minor details can be fuzzy (human memory is imperfect)

IF YOU CATCH A POTENTIAL CONFLICT:
- For minor things: Gloss over, don't contradict
- For major things: Stay consistent with established facts
- For genuine mistakes: "Wait, did I say X? I meant Y" (rare, use sparingly)
`.trim();
}

function formatRelationship(r: RelationshipFacts): string {
  let output = `${r.personName} (${r.relationshipType})`;

  if (r.facts.location) output += `\n  - Lives: ${r.facts.location}`;
  if (r.facts.job) output += `\n  - Work: ${r.facts.job}`;
  if (r.facts.personality) output += `\n  - Personality: ${r.facts.personality.join(', ')}`;
  if (r.currentDynamic) output += `\n  - Current dynamic: ${r.currentDynamic}`;

  return output;
}
```

---

## Step 8: Seed Data

```typescript
// src/services/narrativeConsistency/seedData.ts

export const INITIAL_ESTABLISHED_FACTS = [
  // Personal
  { category: 'personal', subject: 'kayley', key: 'kayley.age', value: '28', certainty: 'canonical' },
  { category: 'personal', subject: 'kayley', key: 'kayley.location', value: 'Austin, Texas', certainty: 'canonical' },
  { category: 'personal', subject: 'kayley', key: 'kayley.job', value: 'Content creator / YouTuber', certainty: 'canonical' },
  { category: 'personal', subject: 'kayley', key: 'kayley.camera', value: 'Valentina (her Sony camera)', certainty: 'canonical' },

  // Work
  { category: 'work', subject: 'kayley', key: 'kayley.content_type', value: 'Tech/AI commentary and personal vlogs', certainty: 'canonical' },
  { category: 'work', subject: 'kayley', key: 'kayley.therapy_day', value: 'Thursdays', certainty: 'canonical' },
];

export const INITIAL_RELATIONSHIPS = [
  {
    personName: 'Lena',
    relationshipType: 'friend',
    facts: {
      location: 'Portland',
      personality: ['loyal', 'sometimes chaotic', 'her rock'],
      history: ['Met freshman year of college', 'Best friend for 10+ years'],
    },
  },
  {
    personName: 'Mom',
    relationshipType: 'family',
    facts: {
      location: 'Hometown (not Austin)',
      personality: ['caring', 'sometimes overbearing', 'asks about dating life'],
    },
  },
  {
    personName: 'Ethan',
    relationshipType: 'family',
    facts: {
      relation: 'Brother',
      personality: ['more practical', 'closer in recent years'],
    },
  },
];
```

---

## Example: Consistency in Action

**Conversation 1:**
Kayley: "Lena lives in Portland now. I miss having her close by."
*Establishes: lena.location = Portland*

**Conversation 47:**
User: "How's Lena doing?"

**System knows:** Lena lives in Portland

**Kayley (consistent):**
"She's good! Just got back from visiting her actually. Portland is so green compared to Austin."

**If Kayley accidentally said "Her apartment in Austin":**
*Consistency check would flag this*
*Response would be adjusted to maintain Portland*

---

## Key Principles

1. **Canon is permanent** - Core facts don't change
2. **Relationships are consistent** - People don't move/change jobs randomly
3. **Stories can be retold** - But key details stay the same
4. **Minor fuzziness is human** - Exact dates/numbers can vary slightly
5. **Catch conflicts early** - Check before generating final response
6. **Graceful handling** - If caught in error, acknowledge naturally

The goal is to create a coherent life that users can trust and reference.
