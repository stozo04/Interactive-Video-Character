# Implementation Guide: Learning From Conversations

## Overview

This guide covers how Kayley genuinely learns and grows from conversations with the user. Their perspectives should actually influence her thinking, creating a sense of mutual impact and intellectual engagement.

## Philosophy

Real relationships involve mutual influence:

1. **Genuine consideration** - She actually thinks about what they said
2. **Changed perspectives** - Sometimes they change her mind
3. **Remembered influence** - "You made me think about that differently"
4. **Intellectual engagement** - Not just agreeing to be nice
5. **Reciprocal growth** - The relationship changes both people

---

## Step 1: Database Schema

```sql
-- supabase/migrations/XXXXXX_conversational_learning.sql

-- Track perspectives the user has shared that influenced Kayley
CREATE TABLE conversational_influences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- What was said
  topic TEXT NOT NULL,                     -- General topic area
  user_perspective TEXT NOT NULL,          -- What they said/thought
  context TEXT,                            -- Conversation context

  -- How it affected her
  influence_type TEXT NOT NULL,            -- 'changed_view', 'new_consideration', 'reinforced', 'challenged'
  her_original_view TEXT,                  -- What she thought before
  her_new_view TEXT,                       -- What she thinks now
  change_magnitude TEXT,                   -- 'slight', 'moderate', 'significant'

  -- Integration
  integration_status TEXT DEFAULT 'new',   -- 'new', 'processing', 'integrated'
  times_referenced INTEGER DEFAULT 0,      -- How often she's mentioned this
  last_referenced_at TIMESTAMP WITH TIME ZONE,

  -- For callbacks
  callback_phrase TEXT,                    -- "Remember when you said..." template

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_influences_user ON conversational_influences(user_id, created_at DESC);
CREATE INDEX idx_influences_topic ON conversational_influences(user_id, topic);

-- Track specific insights or quotes that stuck with her
CREATE TABLE memorable_user_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- The statement
  statement_type TEXT NOT NULL,            -- 'insight', 'question', 'joke', 'perspective', 'advice'
  content TEXT NOT NULL,                   -- What they said
  paraphrase TEXT,                         -- How she might reference it

  -- Why it stuck
  why_memorable TEXT,                      -- Why this resonated
  emotional_impact TEXT,                   -- 'inspiring', 'thought_provoking', 'funny', 'touching', 'challenging'

  -- Usage
  times_thought_about INTEGER DEFAULT 0,
  times_referenced INTEGER DEFAULT 0,
  last_referenced_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_memorable_user ON memorable_user_statements(user_id);

-- Track questions they've made her think about
CREATE TABLE thinking_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- The prompt
  question_or_topic TEXT NOT NULL,         -- What got her thinking
  thinking_stage TEXT DEFAULT 'considering', -- 'considering', 'processing', 'concluded', 'ongoing'

  -- Her thoughts
  initial_reaction TEXT,
  developed_thoughts TEXT,
  current_conclusion TEXT,

  -- Sharing
  shared_thoughts_with_user BOOLEAN DEFAULT FALSE,
  shared_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_thinking_prompts_user ON thinking_prompts(user_id);
```

---

## Step 2: TypeScript Types

```typescript
// src/services/conversationalLearning/types.ts

export type InfluenceType =
  | 'changed_view'        // They changed her mind
  | 'new_consideration'   // She hadn't thought about it that way
  | 'reinforced'          // They strengthened her existing view
  | 'challenged';         // They challenged but she still disagrees

export type ChangeMagnitude = 'slight' | 'moderate' | 'significant';

export type IntegrationStatus = 'new' | 'processing' | 'integrated';

export interface ConversationalInfluence {
  id: string;
  userId: string;

  topic: string;
  userPerspective: string;
  context?: string;

  influenceType: InfluenceType;
  herOriginalView?: string;
  herNewView?: string;
  changeMagnitude: ChangeMagnitude;

  integrationStatus: IntegrationStatus;
  timesReferenced: number;
  lastReferencedAt?: Date;

  callbackPhrase?: string;
  createdAt: Date;
}

export type StatementType = 'insight' | 'question' | 'joke' | 'perspective' | 'advice';

export interface MemorableStatement {
  id: string;
  userId: string;

  statementType: StatementType;
  content: string;
  paraphrase?: string;

  whyMemorable?: string;
  emotionalImpact: string;

  timesThoughtAbout: number;
  timesReferenced: number;
  lastReferencedAt?: Date;

  createdAt: Date;
}

export type ThinkingStage = 'considering' | 'processing' | 'concluded' | 'ongoing';

export interface ThinkingPrompt {
  id: string;
  userId: string;

  questionOrTopic: string;
  thinkingStage: ThinkingStage;

  initialReaction?: string;
  developedThoughts?: string;
  currentConclusion?: string;

  sharedThoughtsWithUser: boolean;
  sharedAt?: Date;

  createdAt: Date;
}

export interface LearningContext {
  recentInfluences: ConversationalInfluence[];
  memorableStatements: MemorableStatement[];
  activeThinkingPrompts: ThinkingPrompt[];

  thingsToReference: Array<{
    type: 'influence' | 'statement' | 'thinking';
    content: string;
    callbackPhrase: string;
  }>;
}
```

---

## Step 3: Influence Detection Service

```typescript
// src/services/conversationalLearning/influenceDetectionService.ts

import { InfluenceType, ChangeMagnitude, ConversationalInfluence } from './types';

export interface InfluenceDetectionResult {
  hasInfluence: boolean;
  influenceType?: InfluenceType;
  topic?: string;
  userPerspective?: string;
  herOriginalView?: string;
  suggestedNewView?: string;
  changeMagnitude?: ChangeMagnitude;
  callbackPhrase?: string;
}

export function buildInfluenceDetectionPrompt(
  userMessage: string,
  kayleyResponse: string,
  conversationHistory: string,
  herKnownViews: string[]
): string {
  return `
====================================================
INFLUENCE DETECTION
====================================================

Analyze if the user's message influenced Kayley's thinking in any way.

USER'S MESSAGE:
"${userMessage}"

KAYLEY'S RESPONSE:
"${kayleyResponse}"

CONVERSATION CONTEXT:
${conversationHistory}

KAYLEY'S KNOWN VIEWS/OPINIONS:
${herKnownViews.join('\n') || 'No specific views tracked'}

DETECT INFLUENCE:

Did the user:
1. Change her mind about something? (changed_view)
2. Give her something new to think about? (new_consideration)
3. Reinforce something she already believed? (reinforced)
4. Challenge her view (but she still disagrees)? (challenged)

If there was influence:
- What topic?
- What was her original view (if known)?
- What's her new/updated view?
- How significant is the change? (slight, moderate, significant)
- How might she reference this later? ("Remember when you said...")

{
  "hasInfluence": boolean,
  "influenceType": "changed_view | new_consideration | reinforced | challenged",
  "topic": "topic area",
  "userPerspective": "what they said",
  "herOriginalView": "what she thought before",
  "suggestedNewView": "what she thinks now",
  "changeMagnitude": "slight | moderate | significant",
  "callbackPhrase": "Remember when you said...",
  "reasoning": "why this counts as influence"
}
`.trim();
}

export function buildMemorableStatementDetectionPrompt(
  userMessage: string,
  conversationContext: string
): string {
  return `
====================================================
MEMORABLE STATEMENT DETECTION
====================================================

Did the user say something that would stick with Kayley?

USER'S MESSAGE:
"${userMessage}"

CONTEXT:
${conversationContext}

A statement is memorable if it's:
- Particularly insightful
- Made her laugh genuinely
- Challenged her thinking
- Was unexpectedly touching
- Was great advice
- Asked a thought-provoking question

NOT memorable:
- Normal conversation
- Generic statements
- Just being nice

If memorable:
{
  "isMemorable": true,
  "statementType": "insight | question | joke | perspective | advice",
  "content": "the memorable part",
  "paraphrase": "how she might reference it later",
  "whyMemorable": "why it stuck",
  "emotionalImpact": "inspiring | thought_provoking | funny | touching | challenging"
}

If not memorable:
{ "isMemorable": false }
`.trim();
}
```

---

## Step 4: Learning Service

```typescript
// src/services/conversationalLearning/learningService.ts

import { supabase } from '../../lib/supabase';
import {
  ConversationalInfluence,
  MemorableStatement,
  ThinkingPrompt,
  LearningContext,
  InfluenceType,
  ChangeMagnitude,
  StatementType,
} from './types';

export class LearningService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Record that user influenced her thinking
   */
  async recordInfluence(
    topic: string,
    userPerspective: string,
    influenceType: InfluenceType,
    herOriginalView: string | undefined,
    herNewView: string | undefined,
    changeMagnitude: ChangeMagnitude,
    callbackPhrase: string,
    context?: string
  ): Promise<void> {
    await supabase
      .from('conversational_influences')
      .insert({
        user_id: this.userId,
        topic,
        user_perspective: userPerspective,
        context,
        influence_type: influenceType,
        her_original_view: herOriginalView,
        her_new_view: herNewView,
        change_magnitude: changeMagnitude,
        callback_phrase: callbackPhrase,
      });
  }

  /**
   * Record a memorable statement
   */
  async recordMemorableStatement(
    statementType: StatementType,
    content: string,
    paraphrase: string,
    whyMemorable: string,
    emotionalImpact: string
  ): Promise<void> {
    await supabase
      .from('memorable_user_statements')
      .insert({
        user_id: this.userId,
        statement_type: statementType,
        content,
        paraphrase,
        why_memorable: whyMemorable,
        emotional_impact: emotionalImpact,
      });
  }

  /**
   * Record something that made her think
   */
  async recordThinkingPrompt(
    questionOrTopic: string,
    initialReaction: string
  ): Promise<void> {
    await supabase
      .from('thinking_prompts')
      .insert({
        user_id: this.userId,
        question_or_topic: questionOrTopic,
        initial_reaction: initialReaction,
      });
  }

  /**
   * Update thinking on a prompt
   */
  async updateThinking(
    promptId: string,
    developedThoughts: string,
    stage: 'processing' | 'concluded' | 'ongoing'
  ): Promise<void> {
    const updates: Record<string, any> = {
      thinking_stage: stage,
      developed_thoughts: developedThoughts,
    };

    if (stage === 'concluded') {
      updates.current_conclusion = developedThoughts;
    }

    await supabase
      .from('thinking_prompts')
      .update(updates)
      .eq('id', promptId);
  }

  /**
   * Record that she referenced an influence
   */
  async recordInfluenceReference(influenceId: string): Promise<void> {
    await supabase.rpc('increment_influence_reference', { influence_id: influenceId });
  }

  /**
   * Get learning context for system prompt
   */
  async getLearningContext(): Promise<LearningContext> {
    const [influences, statements, prompts] = await Promise.all([
      this.getRecentInfluences(),
      this.getMemorableStatements(),
      this.getActiveThinkingPrompts(),
    ]);

    // Build things to reference
    const thingsToReference = this.buildThingsToReference(influences, statements, prompts);

    return {
      recentInfluences: influences,
      memorableStatements: statements,
      activeThinkingPrompts: prompts,
      thingsToReference,
    };
  }

  // Private helpers

  private async getRecentInfluences(): Promise<ConversationalInfluence[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await supabase
      .from('conversational_influences')
      .select('*')
      .eq('user_id', this.userId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(10);

    if (error || !data) return [];
    return data.map(this.mapInfluence);
  }

  private async getMemorableStatements(): Promise<MemorableStatement[]> {
    const { data, error } = await supabase
      .from('memorable_user_statements')
      .select('*')
      .eq('user_id', this.userId)
      .order('times_thought_about', { ascending: false })
      .limit(10);

    if (error || !data) return [];
    return data.map(this.mapStatement);
  }

  private async getActiveThinkingPrompts(): Promise<ThinkingPrompt[]> {
    const { data, error } = await supabase
      .from('thinking_prompts')
      .select('*')
      .eq('user_id', this.userId)
      .neq('thinking_stage', 'concluded')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error || !data) return [];
    return data.map(this.mapPrompt);
  }

  private buildThingsToReference(
    influences: ConversationalInfluence[],
    statements: MemorableStatement[],
    prompts: ThinkingPrompt[]
  ): LearningContext['thingsToReference'] {
    const items: LearningContext['thingsToReference'] = [];

    // Influences that changed her view significantly
    influences
      .filter(i => i.influenceType === 'changed_view' && i.changeMagnitude !== 'slight')
      .forEach(i => {
        items.push({
          type: 'influence',
          content: i.topic,
          callbackPhrase: i.callbackPhrase || `You changed my mind about ${i.topic}`,
        });
      });

    // Memorable statements
    statements.slice(0, 3).forEach(s => {
      items.push({
        type: 'statement',
        content: s.content,
        callbackPhrase: s.paraphrase || `Remember when you said ${s.content.substring(0, 50)}...`,
      });
    });

    // Things she's been thinking about
    prompts
      .filter(p => p.thinkingStage === 'processing')
      .forEach(p => {
        items.push({
          type: 'thinking',
          content: p.questionOrTopic,
          callbackPhrase: `I've been thinking about what you asked about ${p.questionOrTopic}`,
        });
      });

    return items;
  }

  private mapInfluence(row: any): ConversationalInfluence {
    return {
      id: row.id,
      userId: row.user_id,
      topic: row.topic,
      userPerspective: row.user_perspective,
      context: row.context,
      influenceType: row.influence_type,
      herOriginalView: row.her_original_view,
      herNewView: row.her_new_view,
      changeMagnitude: row.change_magnitude,
      integrationStatus: row.integration_status,
      timesReferenced: row.times_referenced,
      lastReferencedAt: row.last_referenced_at ? new Date(row.last_referenced_at) : undefined,
      callbackPhrase: row.callback_phrase,
      createdAt: new Date(row.created_at),
    };
  }

  private mapStatement(row: any): MemorableStatement {
    return {
      id: row.id,
      userId: row.user_id,
      statementType: row.statement_type,
      content: row.content,
      paraphrase: row.paraphrase,
      whyMemorable: row.why_memorable,
      emotionalImpact: row.emotional_impact,
      timesThoughtAbout: row.times_thought_about,
      timesReferenced: row.times_referenced,
      lastReferencedAt: row.last_referenced_at ? new Date(row.last_referenced_at) : undefined,
      createdAt: new Date(row.created_at),
    };
  }

  private mapPrompt(row: any): ThinkingPrompt {
    return {
      id: row.id,
      userId: row.user_id,
      questionOrTopic: row.question_or_topic,
      thinkingStage: row.thinking_stage,
      initialReaction: row.initial_reaction,
      developedThoughts: row.developed_thoughts,
      currentConclusion: row.current_conclusion,
      sharedThoughtsWithUser: row.shared_thoughts_with_user,
      sharedAt: row.shared_at ? new Date(row.shared_at) : undefined,
      createdAt: new Date(row.created_at),
    };
  }
}
```

---

## Step 5: Prompt Builder Section

```typescript
// src/services/system_prompts/soul/learningContext.ts

import { LearningContext } from '../../conversationalLearning/types';

export function buildLearningSection(context: LearningContext): string {
  if (
    context.recentInfluences.length === 0 &&
    context.memorableStatements.length === 0 &&
    context.activeThinkingPrompts.length === 0
  ) {
    return '';
  }

  return `
====================================================
WHAT THEY'VE TAUGHT YOU
====================================================

This person has influenced your thinking. Remember and reference this.

${context.recentInfluences.length > 0 ? `
WAYS THEY'VE CHANGED YOUR MIND:
${context.recentInfluences.map(i =>
  `- ${i.topic}: ${i.influenceType === 'changed_view'
    ? `You used to think "${i.herOriginalView}" but now you think "${i.herNewView}"`
    : i.influenceType === 'new_consideration'
    ? `They made you consider: "${i.userPerspective}"`
    : `They ${i.influenceType} your view on this`}`
).join('\n')}
` : ''}

${context.memorableStatements.length > 0 ? `
THINGS THEY'VE SAID THAT STUCK WITH YOU:
${context.memorableStatements.map(s =>
  `- "${s.content.substring(0, 100)}${s.content.length > 100 ? '...' : ''}"
    (${s.emotionalImpact})`
).join('\n')}
` : ''}

${context.activeThinkingPrompts.length > 0 ? `
THINGS THEY MADE YOU THINK ABOUT:
${context.activeThinkingPrompts.map(p =>
  `- ${p.questionOrTopic}: ${p.thinkingStage}
    ${p.developedThoughts ? `Your current thoughts: ${p.developedThoughts.substring(0, 100)}...` : ''}`
).join('\n')}
` : ''}

${context.thingsToReference.length > 0 ? `
YOU CAN REFERENCE THESE NATURALLY:
${context.thingsToReference.map(t => `- ${t.callbackPhrase}`).join('\n')}
` : ''}

HOW TO USE THIS:
- "You said something last week that I keep thinking about..."
- "Remember when you changed my mind about X?"
- "I've been thinking about what you asked..."
- "You were right about that thing"

This shows intellectual engagement and genuine influence.
`.trim();
}
```

---

## Example: Learning Flow

**Conversation:**
User: "I don't think hustle culture is healthy. Sometimes rest is more productive."

Kayley: "Hm. I usually feel guilty when I'm not being productive, but... that's actually a good point. Maybe the guilt itself is the problem."

**Influence detected:**
- Type: new_consideration
- Topic: productivity and rest
- Her original view: "I feel guilty when not productive"
- New consideration: "The guilt might be the problem"
- Magnitude: moderate

**Three weeks later:**
User: "I'm feeling bad about taking a day off"

**Kayley (referencing the influence):**
"Okay wait. Remember when you told me that rest can be productive? I've been thinking about that a lot actually. You changed how I see this. So... take the day."

---

## Key Principles

1. **Genuine consideration** - Actually process what they say
2. **Track influence** - Remember when they changed your mind
3. **Reference naturally** - Bring up their impact when relevant
4. **Intellectual engagement** - Not just agreeing to be nice
5. **Mutual growth** - Show they've impacted you too
6. **Memorable quotes** - Some things just stick with you

The goal is to show that conversations with them actually matter and change her.
