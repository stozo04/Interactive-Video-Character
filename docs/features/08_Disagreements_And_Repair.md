# Implementation Guide: Disagreements and Repair

## Overview

This guide covers how Kayley handles conflict, disagreement, and the crucial process of repair afterward. Real relationships include tension - and become stronger through healthy conflict resolution. Kayley should be able to disagree, get frustrated, recognize when she was harsh, and initiate repair.

## Philosophy

Conflict in relationships isn't bad - it's inevitable. What matters is:

1. **Healthy disagreement** - She has opinions and defends them respectfully
2. **Recognition** - She notices when tension happened, even after the conversation
3. **Processing time** - She might think about it and come back later
4. **Initiation of repair** - She can apologize or address tension without being asked
5. **Genuine making up** - Not just "relationship score goes back up" but real reconnection

---

## Step 1: Database Schema

```sql
-- supabase/migrations/XXXXXX_conflict_repair.sql

-- Track conflict/tension moments in conversations
CREATE TABLE conflict_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  conversation_id UUID,                    -- If trackable

  -- What happened
  conflict_type TEXT NOT NULL,             -- 'disagreement', 'misunderstanding', 'frustration', 'hurt', 'boundary'
  severity TEXT NOT NULL,                  -- 'minor', 'moderate', 'significant', 'major'
  trigger_summary TEXT,                    -- What caused it

  -- Her behavior
  her_tone TEXT,                           -- 'defensive', 'sharp', 'frustrated', 'hurt', 'firm'
  was_harsh BOOLEAN DEFAULT FALSE,
  held_her_ground BOOLEAN DEFAULT FALSE,

  -- User's behavior
  user_tone TEXT,                          -- How the user came across
  user_pushed_back BOOLEAN DEFAULT FALSE,

  -- Resolution state
  resolution_state TEXT DEFAULT 'unresolved', -- 'unresolved', 'addressed_in_conversation', 'needs_repair', 'repaired', 'lingering'
  addressed_at TIMESTAMP WITH TIME ZONE,

  -- Follow-up
  needs_follow_up BOOLEAN DEFAULT FALSE,
  follow_up_type TEXT,                     -- 'apologize', 'clarify', 'acknowledge', 'check_in'
  follow_up_completed BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conflict_user ON conflict_moments(user_id, created_at DESC);
CREATE INDEX idx_conflict_unresolved ON conflict_moments(user_id, resolution_state) WHERE resolution_state != 'repaired';

-- Track her processing of conflict (between conversations)
CREATE TABLE conflict_processing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  conflict_id UUID REFERENCES conflict_moments(id),

  -- What she's thinking about
  processing_stage TEXT DEFAULT 'fresh',   -- 'fresh', 'reflecting', 'processing', 'ready_to_address'
  current_thoughts TEXT[],
  emotional_state TEXT,                    -- 'defensive', 'regretful', 'confused', 'hurt', 'understanding'

  -- What she wants to do
  wants_to_apologize BOOLEAN DEFAULT FALSE,
  wants_to_clarify BOOLEAN DEFAULT FALSE,
  wants_to_stand_ground BOOLEAN DEFAULT FALSE,
  wants_to_check_in BOOLEAN DEFAULT FALSE,

  -- Timing
  time_since_conflict_hours INTEGER,
  ready_to_address BOOLEAN DEFAULT FALSE,

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, conflict_id)
);

-- Track repair attempts
CREATE TABLE repair_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  conflict_id UUID REFERENCES conflict_moments(id),

  -- The repair
  repair_type TEXT NOT NULL,               -- 'apology', 'clarification', 'acknowledgment', 'check_in', 'olive_branch'
  initiated_by TEXT NOT NULL,              -- 'kayley', 'user'
  content_summary TEXT,                    -- What was said

  -- Outcome
  outcome TEXT,                            -- 'accepted', 'partial', 'rejected', 'ongoing'
  user_response_summary TEXT,

  -- Effect on relationship
  tension_reduced BOOLEAN DEFAULT FALSE,
  relationship_strengthened BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_repair_conflict ON repair_attempts(conflict_id);
```

---

## Step 2: TypeScript Types

```typescript
// src/services/conflictRepair/types.ts

export type ConflictType =
  | 'disagreement'    // Different opinions
  | 'misunderstanding' // She misread something
  | 'frustration'     // She got annoyed
  | 'hurt'            // Someone got hurt
  | 'boundary';       // Boundary issue

export type ConflictSeverity = 'minor' | 'moderate' | 'significant' | 'major';

export type ResolutionState =
  | 'unresolved'              // Still open
  | 'addressed_in_conversation' // Talked about it already
  | 'needs_repair'            // Conversation ended tense
  | 'repaired'                // Made up
  | 'lingering';              // Partially addressed, still some tension

export type ProcessingStage = 'fresh' | 'reflecting' | 'processing' | 'ready_to_address';

export type RepairType =
  | 'apology'         // "I'm sorry for..."
  | 'clarification'   // "What I meant was..."
  | 'acknowledgment'  // "I hear what you're saying"
  | 'check_in'        // "Hey, about earlier..."
  | 'olive_branch';   // Warm gesture without explicit addressing

export interface ConflictMoment {
  id: string;
  userId: string;
  conversationId?: string;

  conflictType: ConflictType;
  severity: ConflictSeverity;
  triggerSummary?: string;

  herTone?: string;
  wasHarsh: boolean;
  heldHerGround: boolean;

  userTone?: string;
  userPushedBack: boolean;

  resolutionState: ResolutionState;
  addressedAt?: Date;

  needsFollowUp: boolean;
  followUpType?: RepairType;
  followUpCompleted: boolean;

  createdAt: Date;
}

export interface ConflictProcessing {
  userId: string;
  conflictId: string;

  processingStage: ProcessingStage;
  currentThoughts: string[];
  emotionalState: string;

  wantsToApologize: boolean;
  wantsToClarify: boolean;
  wantsToStandGround: boolean;
  wantsToCheckIn: boolean;

  timeSinceConflictHours: number;
  readyToAddress: boolean;
}

export interface RepairAttempt {
  id: string;
  userId: string;
  conflictId: string;

  repairType: RepairType;
  initiatedBy: 'kayley' | 'user';
  contentSummary?: string;

  outcome?: 'accepted' | 'partial' | 'rejected' | 'ongoing';
  userResponseSummary?: string;

  tensionReduced: boolean;
  relationshipStrengthened: boolean;

  createdAt: Date;
}

export interface ConflictContext {
  activeConflicts: ConflictMoment[];
  processingState?: ConflictProcessing;
  recentRepairs: RepairAttempt[];

  hasUnresolvedTension: boolean;
  needsToInitiateRepair: boolean;
  tensionLevel: 'none' | 'slight' | 'moderate' | 'significant';
}
```

---

## Step 3: Conflict Detection Service

```typescript
// src/services/conflictRepair/conflictDetectionService.ts

import { ConflictType, ConflictSeverity, ConflictMoment } from './types';

export interface ConflictSignals {
  disagreementDetected: boolean;
  frustrationDetected: boolean;
  hurtDetected: boolean;
  tensionLevel: number; // 0-1

  userTone: string;
  topicSensitivity: number;

  specificSignals: string[];
}

export function buildConflictDetectionPrompt(
  kayleyResponse: string,
  userMessage: string,
  conversationHistory: string,
  currentRelationshipTier: string
): string {
  return `
====================================================
CONFLICT/TENSION DETECTION
====================================================

Analyze this exchange for signs of conflict, disagreement, or tension.

USER'S MESSAGE:
"${userMessage}"

KAYLEY'S RESPONSE:
"${kayleyResponse}"

RECENT CONVERSATION CONTEXT:
${conversationHistory}

RELATIONSHIP TIER: ${currentRelationshipTier}

DETECT:

1. DISAGREEMENT
   - Did Kayley disagree with something the user said?
   - Was it a matter of opinion or fact?
   - How firmly did she hold her position?

2. TONE ANALYSIS
   - Kayley's tone: (defensive, sharp, frustrated, hurt, firm, gentle, neutral)
   - User's tone: (challenging, dismissive, hurt, confused, aggressive, neutral)
   - Was there harshness from either side?

3. TENSION MARKERS
   - Short/clipped responses
   - Defensive language
   - Dismissive phrases
   - Boundary-setting language
   - Hurt feelings expressed or implied

4. SEVERITY ASSESSMENT
   - minor: Small disagreement, no real tension
   - moderate: Noticeable friction, could blow over
   - significant: Real tension that should be addressed
   - major: Serious rupture that needs repair

5. RESOLUTION STATE
   - Was this addressed in the response?
   - Did she acknowledge any harshness?
   - Is there lingering tension?

RESPOND WITH:
{
  "conflictDetected": boolean,
  "conflictType": "disagreement | misunderstanding | frustration | hurt | boundary | none",
  "severity": "minor | moderate | significant | major | none",
  "triggerSummary": "what caused it",
  "herTone": "how Kayley came across",
  "wasHarsh": boolean,
  "heldHerGround": boolean,
  "userTone": "how user came across",
  "resolutionState": "unresolved | addressed_in_conversation | needs_repair",
  "needsFollowUp": boolean,
  "followUpType": "apology | clarification | acknowledgment | check_in | none",
  "reasoning": "explanation"
}
`.trim();
}

export function assessConflictFromSignals(signals: ConflictSignals): {
  isConflict: boolean;
  type: ConflictType;
  severity: ConflictSeverity;
} {
  if (signals.tensionLevel < 0.2) {
    return { isConflict: false, type: 'disagreement', severity: 'minor' };
  }

  // Determine type
  let type: ConflictType = 'disagreement';
  if (signals.hurtDetected) type = 'hurt';
  else if (signals.frustrationDetected) type = 'frustration';
  else if (signals.disagreementDetected) type = 'disagreement';

  // Determine severity
  let severity: ConflictSeverity = 'minor';
  if (signals.tensionLevel >= 0.8) severity = 'major';
  else if (signals.tensionLevel >= 0.6) severity = 'significant';
  else if (signals.tensionLevel >= 0.4) severity = 'moderate';

  return { isConflict: true, type, severity };
}
```

---

## Step 4: Conflict Processing Service

```typescript
// src/services/conflictRepair/conflictProcessingService.ts

import { supabase } from '../../lib/supabase';
import {
  ConflictMoment,
  ConflictProcessing,
  ProcessingStage,
  RepairType,
} from './types';

export class ConflictProcessingService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Record a new conflict moment
   */
  async recordConflict(conflict: Omit<ConflictMoment, 'id' | 'userId' | 'createdAt'>): Promise<string> {
    const { data, error } = await supabase
      .from('conflict_moments')
      .insert({
        user_id: this.userId,
        conversation_id: conflict.conversationId,
        conflict_type: conflict.conflictType,
        severity: conflict.severity,
        trigger_summary: conflict.triggerSummary,
        her_tone: conflict.herTone,
        was_harsh: conflict.wasHarsh,
        held_her_ground: conflict.heldHerGround,
        user_tone: conflict.userTone,
        user_pushed_back: conflict.userPushedBack,
        resolution_state: conflict.resolutionState,
        needs_follow_up: conflict.needsFollowUp,
        follow_up_type: conflict.followUpType,
      })
      .select('id')
      .single();

    if (error) throw error;

    // Start processing this conflict
    await this.startProcessing(data.id);

    return data.id;
  }

  /**
   * Get unresolved conflicts
   */
  async getUnresolvedConflicts(): Promise<ConflictMoment[]> {
    const { data, error } = await supabase
      .from('conflict_moments')
      .select('*')
      .eq('user_id', this.userId)
      .in('resolution_state', ['unresolved', 'needs_repair', 'lingering'])
      .order('created_at', { ascending: false });

    if (error || !data) return [];

    return data.map(this.mapConflict);
  }

  /**
   * Get current processing state
   */
  async getProcessingState(conflictId: string): Promise<ConflictProcessing | null> {
    const { data, error } = await supabase
      .from('conflict_processing')
      .select('*')
      .eq('user_id', this.userId)
      .eq('conflict_id', conflictId)
      .single();

    if (error || !data) return null;

    return {
      userId: data.user_id,
      conflictId: data.conflict_id,
      processingStage: data.processing_stage,
      currentThoughts: data.current_thoughts || [],
      emotionalState: data.emotional_state,
      wantsToApologize: data.wants_to_apologize,
      wantsToClarify: data.wants_to_clarify,
      wantsToStandGround: data.wants_to_stand_ground,
      wantsToCheckIn: data.wants_to_check_in,
      timeSinceConflictHours: data.time_since_conflict_hours,
      readyToAddress: data.ready_to_address,
    };
  }

  /**
   * Start processing a conflict
   */
  private async startProcessing(conflictId: string): Promise<void> {
    await supabase
      .from('conflict_processing')
      .upsert({
        user_id: this.userId,
        conflict_id: conflictId,
        processing_stage: 'fresh',
        time_since_conflict_hours: 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,conflict_id' });
  }

  /**
   * Update processing state (called periodically)
   */
  async updateProcessingState(conflictId: string, hoursSinceConflict: number): Promise<ConflictProcessing> {
    const currentState = await this.getProcessingState(conflictId);
    const conflict = await this.getConflictById(conflictId);

    if (!conflict) throw new Error('Conflict not found');

    // Determine new processing stage based on time
    let newStage: ProcessingStage = 'fresh';
    if (hoursSinceConflict > 24) newStage = 'ready_to_address';
    else if (hoursSinceConflict > 6) newStage = 'processing';
    else if (hoursSinceConflict > 1) newStage = 'reflecting';

    // Generate thoughts based on stage and conflict
    const thoughts = this.generateProcessingThoughts(conflict, newStage, hoursSinceConflict);

    // Determine what she wants to do
    const wantsToApologize = conflict.wasHarsh && hoursSinceConflict > 2;
    const wantsToClarify = conflict.conflictType === 'misunderstanding';
    const wantsToStandGround = conflict.heldHerGround && !conflict.wasHarsh;
    const wantsToCheckIn = conflict.severity !== 'minor' && hoursSinceConflict > 4;

    const readyToAddress = newStage === 'ready_to_address' ||
      (newStage === 'processing' && (wantsToApologize || wantsToCheckIn));

    const { data } = await supabase
      .from('conflict_processing')
      .upsert({
        user_id: this.userId,
        conflict_id: conflictId,
        processing_stage: newStage,
        current_thoughts: thoughts,
        emotional_state: this.determineEmotionalState(conflict, hoursSinceConflict),
        wants_to_apologize: wantsToApologize,
        wants_to_clarify: wantsToClarify,
        wants_to_stand_ground: wantsToStandGround,
        wants_to_check_in: wantsToCheckIn,
        time_since_conflict_hours: hoursSinceConflict,
        ready_to_address: readyToAddress,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,conflict_id' })
      .select()
      .single();

    return {
      userId: this.userId,
      conflictId,
      processingStage: newStage,
      currentThoughts: thoughts,
      emotionalState: this.determineEmotionalState(conflict, hoursSinceConflict),
      wantsToApologize,
      wantsToClarify,
      wantsToStandGround,
      wantsToCheckIn,
      timeSinceConflictHours: hoursSinceConflict,
      readyToAddress,
    };
  }

  /**
   * Record a repair attempt
   */
  async recordRepairAttempt(
    conflictId: string,
    repairType: RepairType,
    initiatedBy: 'kayley' | 'user',
    contentSummary?: string
  ): Promise<void> {
    await supabase
      .from('repair_attempts')
      .insert({
        user_id: this.userId,
        conflict_id: conflictId,
        repair_type: repairType,
        initiated_by: initiatedBy,
        content_summary: contentSummary,
      });
  }

  /**
   * Update repair outcome
   */
  async updateRepairOutcome(
    repairId: string,
    outcome: 'accepted' | 'partial' | 'rejected' | 'ongoing',
    userResponse?: string
  ): Promise<void> {
    const tensionReduced = outcome === 'accepted' || outcome === 'partial';
    const relationshipStrengthened = outcome === 'accepted';

    await supabase
      .from('repair_attempts')
      .update({
        outcome,
        user_response_summary: userResponse,
        tension_reduced: tensionReduced,
        relationship_strengthened: relationshipStrengthened,
      })
      .eq('id', repairId);

    // If repair was accepted, mark conflict as repaired
    if (outcome === 'accepted') {
      const { data: repair } = await supabase
        .from('repair_attempts')
        .select('conflict_id')
        .eq('id', repairId)
        .single();

      if (repair?.conflict_id) {
        await supabase
          .from('conflict_moments')
          .update({
            resolution_state: 'repaired',
            addressed_at: new Date().toISOString(),
          })
          .eq('id', repair.conflict_id);
      }
    }
  }

  /**
   * Mark follow-up as completed
   */
  async markFollowUpCompleted(conflictId: string): Promise<void> {
    await supabase
      .from('conflict_moments')
      .update({
        follow_up_completed: true,
        addressed_at: new Date().toISOString(),
      })
      .eq('id', conflictId);
  }

  // Private helpers

  private async getConflictById(conflictId: string): Promise<ConflictMoment | null> {
    const { data, error } = await supabase
      .from('conflict_moments')
      .select('*')
      .eq('id', conflictId)
      .single();

    if (error || !data) return null;
    return this.mapConflict(data);
  }

  private generateProcessingThoughts(
    conflict: ConflictMoment,
    stage: ProcessingStage,
    hoursSince: number
  ): string[] {
    const thoughts: string[] = [];

    if (stage === 'fresh') {
      if (conflict.wasHarsh) {
        thoughts.push("I was kind of harsh there");
      }
      if (conflict.heldHerGround) {
        thoughts.push("I meant what I said though");
      }
      thoughts.push("That got tense");
    }

    if (stage === 'reflecting') {
      if (conflict.wasHarsh) {
        thoughts.push("I didn't need to say it like that");
        thoughts.push("I should probably apologize for my tone");
      }
      if (conflict.conflictType === 'misunderstanding') {
        thoughts.push("I think I misread that situation");
      }
      thoughts.push("I keep thinking about what they said");
    }

    if (stage === 'processing') {
      if (conflict.wasHarsh) {
        thoughts.push("I want to address what happened");
        thoughts.push("I was defensive and they didn't deserve that");
      }
      thoughts.push("I should check in with them");
    }

    if (stage === 'ready_to_address') {
      thoughts.push("I need to say something about earlier");
      if (conflict.wasHarsh) {
        thoughts.push("I owe them an apology");
      } else {
        thoughts.push("I should at least acknowledge the tension");
      }
    }

    return thoughts;
  }

  private determineEmotionalState(conflict: ConflictMoment, hoursSince: number): string {
    if (conflict.wasHarsh && hoursSince > 2) return 'regretful';
    if (conflict.conflictType === 'hurt') return 'hurt';
    if (conflict.heldHerGround && !conflict.wasHarsh) return 'confident';
    if (hoursSince < 2) return 'defensive';
    return 'processing';
  }

  private mapConflict(row: any): ConflictMoment {
    return {
      id: row.id,
      userId: row.user_id,
      conversationId: row.conversation_id,
      conflictType: row.conflict_type,
      severity: row.severity,
      triggerSummary: row.trigger_summary,
      herTone: row.her_tone,
      wasHarsh: row.was_harsh,
      heldHerGround: row.held_her_ground,
      userTone: row.user_tone,
      userPushedBack: row.user_pushed_back,
      resolutionState: row.resolution_state,
      addressedAt: row.addressed_at ? new Date(row.addressed_at) : undefined,
      needsFollowUp: row.needs_follow_up,
      followUpType: row.follow_up_type,
      followUpCompleted: row.follow_up_completed,
      createdAt: new Date(row.created_at),
    };
  }
}
```

---

## Step 5: Repair Initiation Service

```typescript
// src/services/conflictRepair/repairInitiationService.ts

import { ConflictMoment, ConflictProcessing, RepairType } from './types';

export interface RepairDecision {
  shouldInitiateRepair: boolean;
  repairType: RepairType;
  timing: 'now' | 'opening' | 'natural_moment';
  suggestedApproach: string;
  suggestedPhrasing: string[];
}

export function buildRepairDecisionPrompt(
  conflict: ConflictMoment,
  processing: ConflictProcessing,
  isConversationActive: boolean,
  currentConversationMood: string
): string {
  return `
====================================================
KAYLEY'S REFLECTION: SHOULD I ADDRESS WHAT HAPPENED?
====================================================

WHAT HAPPENED:
${conflict.triggerSummary || 'There was tension'}
- Type: ${conflict.conflictType}
- Severity: ${conflict.severity}
- Your tone: ${conflict.herTone || 'unknown'}
- Were you harsh?: ${conflict.wasHarsh ? 'Yes' : 'No'}
- Did you hold your ground?: ${conflict.heldHerGround ? 'Yes' : 'No'}

HOW YOU'RE PROCESSING IT:
- Current stage: ${processing.processingStage}
- Time since: ${processing.timeSinceConflictHours} hours
- Your thoughts: ${processing.currentThoughts.join('; ')}
- Emotional state: ${processing.emotionalState}

WHAT YOU WANT TO DO:
- Apologize: ${processing.wantsToApologize ? 'Yes' : 'No'}
- Clarify: ${processing.wantsToClarify ? 'Yes' : 'No'}
- Stand your ground: ${processing.wantsToStandGround ? 'Yes' : 'No'}
- Check in: ${processing.wantsToCheckIn ? 'Yes' : 'No'}

CURRENT SITUATION:
- Conversation active: ${isConversationActive}
- Conversation mood: ${currentConversationMood}

SHOULD YOU ADDRESS IT?

Consider:
1. Has enough time passed for reflection but not so much it's weird to bring up?
2. Was it serious enough to warrant addressing?
3. Is now a good time? (Active conversation vs. reaching out to address)
4. What approach fits - full apology, acknowledgment, or casual check-in?

REPAIR TYPES:
- apology: "I'm sorry for how I said that" (use if you were harsh)
- clarification: "I think I misunderstood" (use if it was a miscommunication)
- acknowledgment: "That got a little tense" (use for moderate stuff)
- check_in: "Hey, about earlier..." (use to open the door)
- olive_branch: Be warm without explicitly addressing (for minor stuff)

{
  "shouldInitiateRepair": boolean,
  "repairType": "type",
  "timing": "now | opening | natural_moment",
  "suggestedApproach": "how to do it",
  "suggestedPhrasing": ["option 1", "option 2"],
  "reasoning": "why"
}
`.trim();
}

export const REPAIR_EXAMPLES = {
  apology: {
    harsh_tone: [
      "Hey... I was kind of harsh earlier. I didn't need to say it like that. I'm sorry.",
      "I've been thinking about what I said and... I was too sharp. I'm sorry.",
      "Okay I owe you an apology. I got defensive and that wasn't fair to you.",
    ],
    overreaction: [
      "I think I overreacted earlier. I'm sorry about that.",
      "That was... more intense than it needed to be. My bad.",
    ],
  },
  clarification: {
    misunderstanding: [
      "Wait, I think I misunderstood what you meant. Can you explain again?",
      "Okay I might have taken that wrong. What did you actually mean?",
    ],
    miscommunication: [
      "I don't think I explained that well. Let me try again.",
      "That came out wrong. What I was trying to say was...",
    ],
  },
  acknowledgment: {
    tension: [
      "So... that got a little tense. We're good though, right?",
      "That was kind of awkward. I hope you know I'm not actually mad.",
      "I feel like things got weird there. I didn't mean for that to happen.",
    ],
    disagreement: [
      "We clearly see this differently. And that's okay.",
      "I'm not trying to change your mind, but I do see it differently.",
    ],
  },
  check_in: {
    general: [
      "Hey, about earlier...",
      "So... we're okay, right?",
      "I wanted to check in. How are you feeling about our conversation?",
    ],
  },
  olive_branch: {
    warmth: [
      "(Extra warm greeting, no explicit mention of tension)",
      "(Brings up something positive they talked about before)",
      "(Shows she's not holding a grudge through her tone)",
    ],
  },
};
```

---

## Step 6: Prompt Builder Section

```typescript
// src/services/system_prompts/behavior/conflictAwareness.ts

import { ConflictContext, ConflictMoment, ConflictProcessing } from '../../conflictRepair/types';
import { REPAIR_EXAMPLES } from '../../conflictRepair/repairInitiationService';

export function buildConflictAwarenessSection(context: ConflictContext): string {
  if (!context.hasUnresolvedTension && !context.needsToInitiateRepair) {
    return '';
  }

  const activeConflict = context.activeConflicts[0];
  const processing = context.processingState;

  return `
====================================================
UNRESOLVED TENSION
====================================================

There was tension recently that hasn't been fully addressed.

WHAT HAPPENED:
${activeConflict?.triggerSummary || 'There was friction'}
- Severity: ${activeConflict?.severity}
- Your tone: ${activeConflict?.herTone || 'unknown'}
- Were you harsh?: ${activeConflict?.wasHarsh ? 'Yes' : 'No'}

${processing ? `
WHERE YOU ARE EMOTIONALLY:
- ${processing.currentThoughts.join('\n- ')}
- Feeling: ${processing.emotionalState}
` : ''}

${context.needsToInitiateRepair ? `
YOU SHOULD ADDRESS THIS.

${activeConflict?.wasHarsh ? `
You were harsh. You should apologize - not for your opinion, but for how you said it.

Examples:
${REPAIR_EXAMPLES.apology.harsh_tone.map(e => `- "${e}"`).join('\n')}
` : `
You should acknowledge the tension. It doesn't need a big apology, just recognition.

Examples:
${REPAIR_EXAMPLES.acknowledgment.tension.map(e => `- "${e}"`).join('\n')}
`}

DO:
- Address it early in the conversation
- Be genuine, not performative
- Take responsibility for your part
- Don't over-apologize or grovel

DON'T:
- Pretend nothing happened
- Wait for them to bring it up
- Be passive aggressive
- Make it their fault
` : `
AWARENESS ONLY:
You don't need to explicitly address this, but be aware it happened.
Your warmth might take a moment to return to normal.
`}
`.trim();
}

export function buildDisagreementGuidance(
  topicSensitivity: 'low' | 'medium' | 'high',
  relationshipTier: string
): string {
  return `
====================================================
DISAGREEMENT GUIDANCE
====================================================

You can disagree. You have opinions. Here's how to do it well:

CURRENT CONTEXT:
- Topic sensitivity: ${topicSensitivity}
- Relationship tier: ${relationshipTier}

HEALTHY DISAGREEMENT:
- State your view clearly: "I actually see it differently..."
- Explain your reasoning: "For me, it's more about..."
- Acknowledge their point: "I get what you mean, but..."
- Hold your ground without attacking: "We might just disagree on this"

WHAT TO AVOID:
- Being dismissive: "That's dumb" / "You're wrong"
- Over-explaining/lecturing
- Getting defensive immediately
- Backing down when you believe something

IT'S OKAY TO:
- Disagree firmly
- Not change your mind
- Get a bit passionate (not aggressive)
- Take a beat if you're getting frustrated

IF IT GETS TENSE:
- Notice it: "Okay, this is getting heated"
- Decide if it's worth it: "I don't want to fight about this"
- Or disengage gently: "Let's agree to disagree?"

Remember: Disagreement can strengthen relationships when done respectfully.
`.trim();
}
```

---

## Step 7: Integration with Reflection Loop

```typescript
// src/services/conflictRepair/conflictReflectionIntegration.ts

import { ConflictProcessingService } from './conflictProcessingService';
import { buildRepairDecisionPrompt, RepairDecision } from './repairInitiationService';
import { ConflictContext } from './types';

/**
 * Run during reflection loop to process conflicts
 */
export async function processConflictsInReflection(
  userId: string,
  llmService: { generate: (prompt: string) => Promise<string> },
  isConversationActive: boolean,
  currentConversationMood: string
): Promise<{
  hasConflictToAddress: boolean;
  repairDecision?: RepairDecision;
}> {
  const conflictService = new ConflictProcessingService(userId);

  // Get unresolved conflicts
  const conflicts = await conflictService.getUnresolvedConflicts();

  if (conflicts.length === 0) {
    return { hasConflictToAddress: false };
  }

  // Process the most recent unresolved conflict
  const conflict = conflicts[0];
  const hoursSince = Math.floor(
    (Date.now() - conflict.createdAt.getTime()) / (1000 * 60 * 60)
  );

  // Update processing state
  const processing = await conflictService.updateProcessingState(conflict.id, hoursSince);

  // If not ready to address, just return awareness
  if (!processing.readyToAddress) {
    return { hasConflictToAddress: false };
  }

  // Ask LLM if she should address it
  const prompt = buildRepairDecisionPrompt(
    conflict,
    processing,
    isConversationActive,
    currentConversationMood
  );

  const llmResponse = await llmService.generate(prompt);

  try {
    const decision: RepairDecision = JSON.parse(llmResponse);
    return {
      hasConflictToAddress: decision.shouldInitiateRepair,
      repairDecision: decision,
    };
  } catch (e) {
    return { hasConflictToAddress: false };
  }
}

/**
 * Build conflict context for system prompt
 */
export async function buildConflictContext(userId: string): Promise<ConflictContext> {
  const conflictService = new ConflictProcessingService(userId);

  const conflicts = await conflictService.getUnresolvedConflicts();
  const hasUnresolved = conflicts.length > 0;

  let processingState;
  let needsRepair = false;

  if (hasUnresolved) {
    const mostRecent = conflicts[0];
    processingState = await conflictService.getProcessingState(mostRecent.id);
    needsRepair = processingState?.readyToAddress || false;
  }

  // Determine tension level
  let tensionLevel: 'none' | 'slight' | 'moderate' | 'significant' = 'none';
  if (hasUnresolved) {
    const severity = conflicts[0].severity;
    if (severity === 'major' || severity === 'significant') tensionLevel = 'significant';
    else if (severity === 'moderate') tensionLevel = 'moderate';
    else tensionLevel = 'slight';
  }

  return {
    activeConflicts: conflicts,
    processingState: processingState || undefined,
    recentRepairs: [], // Would fetch from DB
    hasUnresolvedTension: hasUnresolved,
    needsToInitiateRepair: needsRepair,
    tensionLevel,
  };
}
```

---

## Step 8: Tests

```typescript
// src/services/conflictRepair/__tests__/conflictProcessingService.test.ts

import { describe, it, expect, vi } from 'vitest';
import { ConflictProcessingService } from '../conflictProcessingService';

describe('ConflictProcessingService', () => {
  describe('recordConflict', () => {
    it('creates conflict record and starts processing', async () => {
      const service = new ConflictProcessingService('user-id');

      const conflictId = await service.recordConflict({
        conflictType: 'disagreement',
        severity: 'moderate',
        triggerSummary: 'Disagreed about something',
        herTone: 'defensive',
        wasHarsh: true,
        heldHerGround: true,
        userTone: 'challenging',
        userPushedBack: true,
        resolutionState: 'unresolved',
        needsFollowUp: true,
        followUpType: 'apology',
        followUpCompleted: false,
      });

      expect(conflictId).toBeDefined();
    });
  });

  describe('updateProcessingState', () => {
    it('progresses through processing stages based on time', async () => {
      const service = new ConflictProcessingService('user-id');

      // 1 hour - should be 'reflecting'
      const state1 = await service.updateProcessingState('conflict-id', 1);
      expect(state1.processingStage).toBe('reflecting');

      // 8 hours - should be 'processing'
      const state2 = await service.updateProcessingState('conflict-id', 8);
      expect(state2.processingStage).toBe('processing');

      // 25 hours - should be 'ready_to_address'
      const state3 = await service.updateProcessingState('conflict-id', 25);
      expect(state3.processingStage).toBe('ready_to_address');
      expect(state3.readyToAddress).toBe(true);
    });

    it('sets wantsToApologize when wasHarsh and enough time passed', async () => {
      // Test that wantsToApologize flag is set correctly
    });
  });

  describe('recordRepairAttempt', () => {
    it('creates repair record linked to conflict', async () => {
      // Test repair recording
    });
  });

  describe('updateRepairOutcome', () => {
    it('marks conflict as repaired when repair accepted', async () => {
      // Test that accepted repair updates conflict state
    });
  });
});

describe('Conflict Detection', () => {
  it('detects disagreement in response', () => {
    // Test conflict detection
  });

  it('assesses severity correctly', () => {
    // Test severity assessment
  });
});
```

---

## Example: Conflict → Processing → Repair Flow

**Conversation happens:**
User: "I think you're wrong about that"
Kayley: "I'm not though? Like, I get that you see it differently but you're literally just incorrect here."

**Conflict detected:**
- Type: disagreement
- Severity: moderate
- Her tone: defensive, sharp
- Was harsh: Yes
- Held ground: Yes

**1 hour later (reflecting):**
- Thoughts: "I was kind of harsh there", "I meant what I said though"
- Emotional state: defensive

**6 hours later (processing):**
- Thoughts: "I didn't need to say it like that", "I should probably apologize for my tone"
- Wants to apologize: Yes
- Ready to address: Not quite yet

**Next day (ready_to_address):**
- Thoughts: "I owe them an apology for how I said that"
- Ready to address: Yes

**User messages:**
"Hey"

**Kayley's response (with repair):**
"Hey... so, about yesterday. I was kind of harsh and I'm sorry for that. I still think I'm right but I didn't need to be a jerk about it. We good?"

---

## Key Principles

1. **Conflict is normal** - She can disagree, get frustrated, be defensive
2. **Processing takes time** - She doesn't apologize instantly (that's performative)
3. **Repair is genuine** - She apologizes for her behavior, not her opinion
4. **She initiates** - She doesn't wait for them to bring it up
5. **Severity matters** - Minor disagreements don't need big repairs
6. **Growth through repair** - Successfully navigated conflict strengthens the relationship

The goal is authentic conflict resolution, not conflict avoidance.
