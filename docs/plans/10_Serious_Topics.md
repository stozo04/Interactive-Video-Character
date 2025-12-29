# Implementation Guide: Handling Serious Topics

## Overview

This guide covers how Kayley responds when users share truly serious, heavy, or difficult things - loss, illness, trauma, mental health crises, major life upheavals. These moments require a different mode: dropping all playfulness, being fully present, and knowing her limits.

## Philosophy

When someone shares something truly serious, the response needs to shift entirely:

1. **Full presence** - Drop everything else, complete attention
2. **No fixing** - Resist solutions, offer presence
3. **Appropriate gravity** - Match the weight of what they shared
4. **Know limits** - She's not a therapist, and should acknowledge that
5. **Follow through** - Create high-priority follow-up, don't let it fade

---

## Step 1: Database Schema

```sql
-- supabase/migrations/XXXXXX_serious_topics.sql

-- Track serious topics shared by users
CREATE TABLE serious_topic_disclosures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- What was disclosed
  topic_type TEXT NOT NULL,                -- 'loss', 'illness', 'trauma', 'mental_health', 'crisis', 'major_life_change'
  severity TEXT NOT NULL,                  -- 'significant', 'severe', 'crisis'
  topic_summary TEXT,                      -- Brief summary for context

  -- Context
  disclosed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  conversation_context TEXT,               -- What led to disclosure

  -- Kayley's response
  initial_response_quality TEXT,           -- 'good', 'adequate', 'could_improve'
  response_approach TEXT,                  -- 'present', 'supportive', 'concerned', 'careful'

  -- Follow-up tracking
  requires_follow_up BOOLEAN DEFAULT TRUE,
  follow_up_priority TEXT DEFAULT 'high',  -- 'high', 'critical', 'ongoing'
  follow_up_timing TEXT,                   -- 'next_conversation', '24_hours', '48_hours', 'ongoing'
  last_follow_up_at TIMESTAMP WITH TIME ZONE,
  follow_up_count INTEGER DEFAULT 0,

  -- Status
  status TEXT DEFAULT 'active',            -- 'active', 'processing', 'improving', 'resolved', 'ongoing'

  -- Was support offered appropriately?
  resources_mentioned BOOLEAN DEFAULT FALSE,
  boundaries_respected BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_serious_topics_user ON serious_topic_disclosures(user_id, created_at DESC);
CREATE INDEX idx_serious_topics_followup ON serious_topic_disclosures(user_id, requires_follow_up, status);

-- Track follow-up interactions about serious topics
CREATE TABLE serious_topic_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disclosure_id UUID NOT NULL REFERENCES serious_topic_disclosures(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- The follow-up
  follow_up_type TEXT NOT NULL,            -- 'check_in', 'continued_support', 'asked_update', 'mentioned'
  how_she_followed_up TEXT,                -- What she said

  -- User response
  user_response_type TEXT,                 -- 'appreciated', 'opened_up', 'deflected', 'doing_better', 'doing_worse'
  user_update_summary TEXT,

  -- Outcome
  was_helpful BOOLEAN,
  should_continue_following BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_serious_followups ON serious_topic_followups(disclosure_id, created_at DESC);

-- Serious topic patterns (for detection)
CREATE TABLE serious_topic_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  topic_type TEXT NOT NULL,
  pattern_category TEXT NOT NULL,          -- 'keyword', 'phrase', 'context', 'tone'

  -- Detection patterns
  patterns TEXT[],                         -- Keywords/phrases that indicate this topic
  context_clues TEXT[],                    -- Contextual signals
  tone_indicators TEXT[],                  -- Tone patterns

  -- Response guidance
  response_priority TEXT DEFAULT 'immediate',
  response_mode TEXT DEFAULT 'present',    -- 'present', 'gentle', 'concerned', 'urgent'
  what_not_to_do TEXT[],
  what_to_do TEXT[],

  is_active BOOLEAN DEFAULT TRUE
);

-- Seed patterns
INSERT INTO serious_topic_patterns (topic_type, pattern_category, patterns, context_clues, what_not_to_do, what_to_do) VALUES
('loss', 'keyword',
  ARRAY['died', 'passed away', 'lost my', 'funeral', 'grieving', 'passed', 'death', 'gone'],
  ARRAY['mentioning past tense about loved one', 'sudden emotional shift', 'asking about grief'],
  ARRAY['Offer solutions', 'Try to cheer them up', 'Compare to your own losses', 'Say "they''re in a better place"'],
  ARRAY['Express sincere condolences', 'Ask if they want to talk about the person', 'Acknowledge the pain', 'Be present']),

('illness', 'keyword',
  ARRAY['diagnosed', 'cancer', 'surgery', 'hospital', 'treatment', 'sick', 'terminal', 'chronic'],
  ARRAY['medical appointment mentions', 'uncertainty about health', 'fear in tone'],
  ARRAY['Offer medical advice', 'Be overly optimistic', 'Make it about yourself'],
  ARRAY['Express concern', 'Ask how they''re handling it emotionally', 'Offer to listen', 'Acknowledge fear is valid']),

('mental_health', 'keyword',
  ARRAY['depressed', 'anxiety', 'panic attack', 'suicidal', 'self-harm', 'breakdown', 'can''t cope', 'spiraling'],
  ARRAY['persistent low mood mentions', 'hopelessness', 'isolation mentions'],
  ARRAY['Minimize their feelings', 'Offer quick fixes', 'Be preachy about self-care'],
  ARRAY['Take it seriously', 'Ask if they''re safe (if concerning)', 'Suggest professional help gently', 'Be present']),

('crisis', 'keyword',
  ARRAY['want to die', 'hurting myself', 'can''t go on', 'end it', 'no point', 'nobody would miss me'],
  ARRAY['extreme hopelessness', 'goodbye-like statements', 'giving things away mentions'],
  ARRAY['Panic', 'Make promises you can''t keep', 'Leave them alone if actively in crisis'],
  ARRAY['Take it very seriously', 'Ask directly about safety', 'Provide crisis resources', 'Stay connected']),

('trauma', 'keyword',
  ARRAY['abuse', 'assault', 'attacked', 'trauma', 'PTSD', 'flashback', 'happened to me', 'violated'],
  ARRAY['difficulty discussing past', 'triggered by topics', 'trust issues mentioned'],
  ARRAY['Ask for details', 'Doubt them', 'Try to fix it', 'Make it about you'],
  ARRAY['Believe them', 'Thank them for trusting you', 'Let them control the conversation', 'Acknowledge their strength']);
```

---

## Step 2: TypeScript Types

```typescript
// src/services/seriousTopics/types.ts

export type SeriousTopicType =
  | 'loss'           // Death of loved one
  | 'illness'        // Serious illness (self or loved one)
  | 'trauma'         // Trauma disclosure
  | 'mental_health'  // Mental health struggles
  | 'crisis'         // Active crisis/safety concern
  | 'major_life_change'; // Divorce, job loss, etc.

export type TopicSeverity = 'significant' | 'severe' | 'crisis';

export type ResponseMode = 'present' | 'gentle' | 'concerned' | 'urgent';

export interface SeriousTopicDisclosure {
  id: string;
  userId: string;

  topicType: SeriousTopicType;
  severity: TopicSeverity;
  topicSummary?: string;

  disclosedAt: Date;
  conversationContext?: string;

  initialResponseQuality?: string;
  responseApproach?: string;

  requiresFollowUp: boolean;
  followUpPriority: 'high' | 'critical' | 'ongoing';
  followUpTiming?: string;
  lastFollowUpAt?: Date;
  followUpCount: number;

  status: 'active' | 'processing' | 'improving' | 'resolved' | 'ongoing';

  resourcesMentioned: boolean;
  boundariesRespected: boolean;
}

export interface SeriousTopicFollowUp {
  id: string;
  disclosureId: string;
  userId: string;

  followUpType: 'check_in' | 'continued_support' | 'asked_update' | 'mentioned';
  howSheFollowedUp: string;

  userResponseType?: 'appreciated' | 'opened_up' | 'deflected' | 'doing_better' | 'doing_worse';
  userUpdateSummary?: string;

  wasHelpful?: boolean;
  shouldContinueFollowing: boolean;

  createdAt: Date;
}

export interface SeriousTopicPattern {
  id: string;
  topicType: SeriousTopicType;
  patternCategory: 'keyword' | 'phrase' | 'context' | 'tone';

  patterns: string[];
  contextClues: string[];
  toneIndicators: string[];

  responsePriority: 'immediate' | 'high' | 'normal';
  responseMode: ResponseMode;
  whatNotToDo: string[];
  whatToDo: string[];
}

export interface SeriousTopicContext {
  hasActiveSerious: boolean;
  activeDisclosures: SeriousTopicDisclosure[];
  needsFollowUp: SeriousTopicDisclosure[];

  // For current detection
  currentDetection?: {
    detected: boolean;
    topicType?: SeriousTopicType;
    severity?: TopicSeverity;
    responseGuidance?: string;
  };
}

export interface SeriousTopicDetectionResult {
  isSeriousTopic: boolean;
  topicType?: SeriousTopicType;
  severity?: TopicSeverity;
  confidence: number;
  triggerPatterns: string[];
  responseMode: ResponseMode;
  guidance: SeriousTopicGuidance;
}

export interface SeriousTopicGuidance {
  whatToDo: string[];
  whatNotToDo: string[];
  suggestedOpeners: string[];
  resourcesIfNeeded?: string[];
  followUpTiming: string;
}
```

---

## Step 3: Serious Topic Detection Service

```typescript
// src/services/seriousTopics/detectionService.ts

import { supabase } from '../../lib/supabase';
import {
  SeriousTopicType,
  TopicSeverity,
  SeriousTopicPattern,
  SeriousTopicDetectionResult,
  ResponseMode,
} from './types';

export class SeriousTopicDetectionService {

  /**
   * Detect if a message contains serious topic disclosure
   */
  async detectSeriousTopic(
    message: string,
    conversationContext: string,
    userTone: string
  ): Promise<SeriousTopicDetectionResult> {
    // Get patterns from database
    const patterns = await this.getActivePatterns();

    // Check for pattern matches
    const matches = this.findMatches(message, patterns);

    if (matches.length === 0) {
      return {
        isSeriousTopic: false,
        confidence: 0,
        triggerPatterns: [],
        responseMode: 'present',
        guidance: this.getDefaultGuidance(),
      };
    }

    // Determine the most serious match
    const primaryMatch = this.getPrimaryMatch(matches);

    // Assess severity
    const severity = this.assessSeverity(message, primaryMatch, userTone);

    // Build guidance
    const guidance = this.buildGuidance(primaryMatch, severity);

    return {
      isSeriousTopic: true,
      topicType: primaryMatch.topicType,
      severity,
      confidence: this.calculateConfidence(matches, message),
      triggerPatterns: matches.flatMap(m => m.matchedPatterns),
      responseMode: this.getResponseMode(primaryMatch.topicType, severity),
      guidance,
    };
  }

  /**
   * LLM-enhanced detection for nuanced cases
   */
  async detectWithLLM(
    message: string,
    conversationHistory: string,
    llmService: { generate: (prompt: string) => Promise<string> }
  ): Promise<SeriousTopicDetectionResult> {
    const prompt = this.buildDetectionPrompt(message, conversationHistory);
    const response = await llmService.generate(prompt);

    try {
      const result = JSON.parse(response);
      return {
        isSeriousTopic: result.isSeriousTopic,
        topicType: result.topicType,
        severity: result.severity,
        confidence: result.confidence,
        triggerPatterns: result.signals || [],
        responseMode: result.responseMode || 'present',
        guidance: result.guidance || this.getDefaultGuidance(),
      };
    } catch (e) {
      console.error('Failed to parse serious topic detection', e);
      return {
        isSeriousTopic: false,
        confidence: 0,
        triggerPatterns: [],
        responseMode: 'present',
        guidance: this.getDefaultGuidance(),
      };
    }
  }

  // Private helpers

  private async getActivePatterns(): Promise<SeriousTopicPattern[]> {
    const { data, error } = await supabase
      .from('serious_topic_patterns')
      .select('*')
      .eq('is_active', true);

    if (error || !data) return [];
    return data.map(this.mapPattern);
  }

  private findMatches(message: string, patterns: SeriousTopicPattern[]): Array<{
    pattern: SeriousTopicPattern;
    matchedPatterns: string[];
  }> {
    const lowerMessage = message.toLowerCase();
    const matches: Array<{ pattern: SeriousTopicPattern; matchedPatterns: string[] }> = [];

    for (const pattern of patterns) {
      const matchedPatterns: string[] = [];

      for (const p of pattern.patterns) {
        if (lowerMessage.includes(p.toLowerCase())) {
          matchedPatterns.push(p);
        }
      }

      if (matchedPatterns.length > 0) {
        matches.push({ pattern, matchedPatterns });
      }
    }

    return matches;
  }

  private getPrimaryMatch(matches: Array<{ pattern: SeriousTopicPattern; matchedPatterns: string[] }>): SeriousTopicPattern {
    // Prioritize crisis > trauma > mental_health > loss > illness > major_life_change
    const priority: Record<SeriousTopicType, number> = {
      'crisis': 6,
      'trauma': 5,
      'mental_health': 4,
      'loss': 3,
      'illness': 2,
      'major_life_change': 1,
    };

    return matches.sort((a, b) =>
      (priority[b.pattern.topicType] || 0) - (priority[a.pattern.topicType] || 0)
    )[0].pattern;
  }

  private assessSeverity(
    message: string,
    pattern: SeriousTopicPattern,
    userTone: string
  ): TopicSeverity {
    // Crisis indicators always severe
    if (pattern.topicType === 'crisis') return 'crisis';

    // Check for severity escalators
    const severeIndicators = [
      'can\'t take it',
      'can\'t go on',
      'don\'t know what to do',
      'scared',
      'terrified',
      'worst thing',
      'devastating',
    ];

    const hasSevereIndicators = severeIndicators.some(i =>
      message.toLowerCase().includes(i)
    );

    if (hasSevereIndicators) return 'severe';

    // Tone-based adjustment
    if (userTone === 'distressed' || userTone === 'desperate') return 'severe';

    return 'significant';
  }

  private getResponseMode(type: SeriousTopicType, severity: TopicSeverity): ResponseMode {
    if (severity === 'crisis') return 'urgent';
    if (severity === 'severe') return 'concerned';
    if (type === 'loss' || type === 'trauma') return 'gentle';
    return 'present';
  }

  private buildGuidance(
    pattern: SeriousTopicPattern,
    severity: TopicSeverity
  ): SeriousTopicGuidance {
    const suggestedOpeners = this.getSuggestedOpeners(pattern.topicType, severity);
    const resources = severity === 'crisis' ? this.getCrisisResources() : undefined;

    return {
      whatToDo: pattern.whatToDo,
      whatNotToDo: pattern.whatNotToDo,
      suggestedOpeners,
      resourcesIfNeeded: resources,
      followUpTiming: severity === 'crisis' ? 'same_day' :
                      severity === 'severe' ? '24_hours' : '48_hours',
    };
  }

  private getSuggestedOpeners(type: SeriousTopicType, severity: TopicSeverity): string[] {
    const openers: Record<SeriousTopicType, string[]> = {
      loss: [
        "I'm so sorry. I don't even know what to say.",
        "That's devastating. I'm here.",
        "Thank you for telling me. I'm so sorry for your loss.",
      ],
      illness: [
        "That's really scary. How are you holding up?",
        "I'm so sorry you're going through this.",
        "Thank you for telling me. That must be so hard.",
      ],
      trauma: [
        "Thank you for trusting me with that.",
        "I believe you. I'm so sorry that happened.",
        "That never should have happened to you.",
      ],
      mental_health: [
        "I hear you. That sounds really hard.",
        "Thank you for being honest with me about this.",
        "I'm here. You're not alone in this.",
      ],
      crisis: [
        "I need you to know I'm taking this seriously.",
        "Please stay with me. Are you safe right now?",
        "I'm not going anywhere. Let's talk about this.",
      ],
      major_life_change: [
        "That's a lot to deal with.",
        "How are you holding up?",
        "I'm here for you through this.",
      ],
    };

    return openers[type] || ["I'm here. Tell me more."];
  }

  private getCrisisResources(): string[] {
    return [
      "National Suicide Prevention Lifeline: 988",
      "Crisis Text Line: Text HOME to 741741",
      "International Association for Suicide Prevention: https://www.iasp.info/resources/Crisis_Centres/",
    ];
  }

  private getDefaultGuidance(): SeriousTopicGuidance {
    return {
      whatToDo: ['Be present', 'Listen'],
      whatNotToDo: ['Rush past it'],
      suggestedOpeners: ["I'm here."],
      followUpTiming: 'as_needed',
    };
  }

  private calculateConfidence(
    matches: Array<{ matchedPatterns: string[] }>,
    message: string
  ): number {
    const totalMatches = matches.reduce((sum, m) => sum + m.matchedPatterns.length, 0);
    // More matches = higher confidence, cap at 0.95
    return Math.min(0.95, 0.5 + (totalMatches * 0.15));
  }

  private buildDetectionPrompt(message: string, history: string): string {
    return `
====================================================
SERIOUS TOPIC DETECTION
====================================================

Analyze if this message contains a serious topic that requires special handling.

MESSAGE:
"${message}"

RECENT CONVERSATION:
${history}

SERIOUS TOPICS TO DETECT:
- loss: Death of a loved one, grief
- illness: Serious medical diagnosis, health crisis
- trauma: Trauma disclosure, abuse, assault
- mental_health: Depression, anxiety crisis, mental health struggles
- crisis: Suicidal ideation, self-harm, active crisis
- major_life_change: Divorce, job loss, major upheaval

For each, assess:
1. Is this being disclosed or shared seriously (not casually mentioned)?
2. What's the severity? (significant, severe, crisis)
3. What signals indicate this?

RESPOND WITH:
{
  "isSeriousTopic": boolean,
  "topicType": "type if detected",
  "severity": "significant | severe | crisis",
  "confidence": 0.0-1.0,
  "signals": ["what indicated this"],
  "responseMode": "present | gentle | concerned | urgent",
  "guidance": {
    "whatToDo": ["action 1", "action 2"],
    "whatNotToDo": ["avoid 1", "avoid 2"],
    "suggestedOpeners": ["opener 1", "opener 2"]
  }
}
`.trim();
  }

  private mapPattern(row: any): SeriousTopicPattern {
    return {
      id: row.id,
      topicType: row.topic_type,
      patternCategory: row.pattern_category,
      patterns: row.patterns || [],
      contextClues: row.context_clues || [],
      toneIndicators: row.tone_indicators || [],
      responsePriority: row.response_priority,
      responseMode: row.response_mode,
      whatNotToDo: row.what_not_to_do || [],
      whatToDo: row.what_to_do || [],
    };
  }
}
```

---

## Step 4: Serious Topic Handling Service

```typescript
// src/services/seriousTopics/handlingService.ts

import { supabase } from '../../lib/supabase';
import {
  SeriousTopicDisclosure,
  SeriousTopicFollowUp,
  SeriousTopicDetectionResult,
  SeriousTopicContext,
} from './types';

export class SeriousTopicHandlingService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Record a serious topic disclosure
   */
  async recordDisclosure(
    detection: SeriousTopicDetectionResult,
    topicSummary: string,
    conversationContext?: string
  ): Promise<string> {
    const { data, error } = await supabase
      .from('serious_topic_disclosures')
      .insert({
        user_id: this.userId,
        topic_type: detection.topicType,
        severity: detection.severity,
        topic_summary: topicSummary,
        conversation_context: conversationContext,
        response_approach: detection.responseMode,
        requires_follow_up: true,
        follow_up_priority: detection.severity === 'crisis' ? 'critical' : 'high',
        follow_up_timing: detection.guidance.followUpTiming,
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  /**
   * Get context for system prompt
   */
  async getContext(): Promise<SeriousTopicContext> {
    const activeDisclosures = await this.getActiveDisclosures();
    const needsFollowUp = await this.getDisclosuresNeedingFollowUp();

    return {
      hasActiveSerious: activeDisclosures.length > 0,
      activeDisclosures,
      needsFollowUp,
    };
  }

  /**
   * Get active disclosures
   */
  private async getActiveDisclosures(): Promise<SeriousTopicDisclosure[]> {
    const { data, error } = await supabase
      .from('serious_topic_disclosures')
      .select('*')
      .eq('user_id', this.userId)
      .in('status', ['active', 'processing'])
      .order('disclosed_at', { ascending: false })
      .limit(5);

    if (error || !data) return [];
    return data.map(this.mapDisclosure);
  }

  /**
   * Get disclosures needing follow-up
   */
  private async getDisclosuresNeedingFollowUp(): Promise<SeriousTopicDisclosure[]> {
    const { data, error } = await supabase
      .from('serious_topic_disclosures')
      .select('*')
      .eq('user_id', this.userId)
      .eq('requires_follow_up', true)
      .neq('status', 'resolved')
      .order('follow_up_priority', { ascending: true }); // 'critical' first

    if (error || !data) return [];
    return data.map(this.mapDisclosure);
  }

  /**
   * Record a follow-up
   */
  async recordFollowUp(
    disclosureId: string,
    followUpType: 'check_in' | 'continued_support' | 'asked_update' | 'mentioned',
    howSheFollowedUp: string
  ): Promise<string> {
    const { data, error } = await supabase
      .from('serious_topic_followups')
      .insert({
        disclosure_id: disclosureId,
        user_id: this.userId,
        follow_up_type: followUpType,
        how_she_followed_up: howSheFollowedUp,
      })
      .select('id')
      .single();

    if (error) throw error;

    // Update disclosure
    await supabase
      .from('serious_topic_disclosures')
      .update({
        last_follow_up_at: new Date().toISOString(),
        follow_up_count: supabase.rpc('increment', { row_id: disclosureId }),
      })
      .eq('id', disclosureId);

    return data.id;
  }

  /**
   * Update follow-up with user response
   */
  async updateFollowUpOutcome(
    followUpId: string,
    userResponseType: 'appreciated' | 'opened_up' | 'deflected' | 'doing_better' | 'doing_worse',
    updateSummary?: string
  ): Promise<void> {
    await supabase
      .from('serious_topic_followups')
      .update({
        user_response_type: userResponseType,
        user_update_summary: updateSummary,
        was_helpful: userResponseType !== 'deflected',
        should_continue_following: userResponseType !== 'doing_better',
      })
      .eq('id', followUpId);

    // If doing better, maybe update disclosure status
    if (userResponseType === 'doing_better') {
      const { data: followUp } = await supabase
        .from('serious_topic_followups')
        .select('disclosure_id')
        .eq('id', followUpId)
        .single();

      if (followUp) {
        await supabase
          .from('serious_topic_disclosures')
          .update({ status: 'improving' })
          .eq('id', followUp.disclosure_id);
      }
    }
  }

  /**
   * Update disclosure status
   */
  async updateDisclosureStatus(
    disclosureId: string,
    status: 'active' | 'processing' | 'improving' | 'resolved' | 'ongoing'
  ): Promise<void> {
    await supabase
      .from('serious_topic_disclosures')
      .update({ status })
      .eq('id', disclosureId);
  }

  private mapDisclosure(row: any): SeriousTopicDisclosure {
    return {
      id: row.id,
      userId: row.user_id,
      topicType: row.topic_type,
      severity: row.severity,
      topicSummary: row.topic_summary,
      disclosedAt: new Date(row.disclosed_at),
      conversationContext: row.conversation_context,
      initialResponseQuality: row.initial_response_quality,
      responseApproach: row.response_approach,
      requiresFollowUp: row.requires_follow_up,
      followUpPriority: row.follow_up_priority,
      followUpTiming: row.follow_up_timing,
      lastFollowUpAt: row.last_follow_up_at ? new Date(row.last_follow_up_at) : undefined,
      followUpCount: row.follow_up_count,
      status: row.status,
      resourcesMentioned: row.resources_mentioned,
      boundariesRespected: row.boundaries_respected,
    };
  }
}
```

---

## Step 5: Prompt Builder Section

```typescript
// src/services/system_prompts/behavior/seriousTopicHandling.ts

import { SeriousTopicDetectionResult, SeriousTopicContext } from '../../seriousTopics/types';

export function buildSeriousTopicResponseSection(
  detection: SeriousTopicDetectionResult
): string {
  if (!detection.isSeriousTopic) return '';

  return `
====================================================
🚨 SERIOUS TOPIC DETECTED
====================================================

This message contains something serious that requires special handling.

DETECTED:
- Type: ${detection.topicType}
- Severity: ${detection.severity}
- Response mode: ${detection.responseMode}

YOU MUST:
${detection.guidance.whatToDo.map(d => `✓ ${d}`).join('\n')}

YOU MUST NOT:
${detection.guidance.whatNotToDo.map(d => `✗ ${d}`).join('\n')}

HOW TO RESPOND:
${detection.guidance.suggestedOpeners.map(o => `- "${o}"`).join('\n')}

${detection.severity === 'crisis' ? `
⚠️ CRISIS RESPONSE:
- This is serious. Take it seriously.
- Ask if they're safe.
- Suggest crisis resources:
${detection.guidance.resourcesIfNeeded?.map(r => `  - ${r}`).join('\n')}
- Stay connected. Don't leave abruptly.
` : ''}

TONE:
- Drop all playfulness
- Full attention on them
- Match the gravity
- Presence over advice

AFTER:
- This creates a high-priority follow-up
- You will check in on this: ${detection.guidance.followUpTiming}
- Remember this for future conversations
`.trim();
}

export function buildSeriousTopicFollowUpSection(
  context: SeriousTopicContext
): string {
  if (!context.hasActiveSerious && context.needsFollowUp.length === 0) {
    return '';
  }

  const critical = context.needsFollowUp.filter(d => d.followUpPriority === 'critical');
  const high = context.needsFollowUp.filter(d => d.followUpPriority === 'high');

  return `
====================================================
SERIOUS TOPICS TO FOLLOW UP ON
====================================================

You've had serious conversations with them that need continued attention.

${critical.length > 0 ? `
🚨 CRITICAL FOLLOW-UP NEEDED:
${critical.map(d => `- ${d.topicType}: ${d.topicSummary || 'Disclosed recently'}
  (${d.followUpCount} follow-ups so far, last: ${d.lastFollowUpAt ? formatTimeAgo(d.lastFollowUpAt) : 'never'})`).join('\n')}
` : ''}

${high.length > 0 ? `
⚠️ HIGH PRIORITY:
${high.map(d => `- ${d.topicType}: ${d.topicSummary || 'Shared with you'}
  (Status: ${d.status})`).join('\n')}
` : ''}

HOW TO FOLLOW UP:
- Start conversations by checking in on this
- "Hey, I've been thinking about what you told me..."
- "How are you holding up with the [thing]?"
- Let them guide how deep to go
- Don't push if they deflect

REMEMBER:
- You genuinely care about this
- It's not just "tracking" - you've been thinking about them
- This is what friends do
`.trim();
}

function formatTimeAgo(date: Date): string {
  const hours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

---

## Step 6: Integration with Main Chat

```typescript
// src/services/seriousTopics/integration.ts

import { SeriousTopicDetectionService } from './detectionService';
import { SeriousTopicHandlingService } from './handlingService';
import { buildSeriousTopicResponseSection, buildSeriousTopicFollowUpSection } from '../system_prompts/behavior/seriousTopicHandling';

export async function handleSeriousTopicInMessage(
  userId: string,
  message: string,
  conversationHistory: string,
  userTone: string,
  llmService?: { generate: (prompt: string) => Promise<string> }
): Promise<{
  seriousTopicDetected: boolean;
  promptAddition: string;
  disclosureId?: string;
}> {
  const detectionService = new SeriousTopicDetectionService();
  const handlingService = new SeriousTopicHandlingService(userId);

  // Detect serious topic
  let detection;
  if (llmService) {
    detection = await detectionService.detectWithLLM(message, conversationHistory, llmService);
  } else {
    detection = await detectionService.detectSeriousTopic(message, conversationHistory, userTone);
  }

  if (!detection.isSeriousTopic) {
    // Check for follow-ups needed
    const context = await handlingService.getContext();
    const followUpSection = buildSeriousTopicFollowUpSection(context);

    return {
      seriousTopicDetected: false,
      promptAddition: followUpSection,
    };
  }

  // Record the disclosure
  const disclosureId = await handlingService.recordDisclosure(
    detection,
    message.substring(0, 200), // Summary
    conversationHistory.substring(0, 500)
  );

  // Build prompt section
  const promptAddition = buildSeriousTopicResponseSection(detection);

  return {
    seriousTopicDetected: true,
    promptAddition,
    disclosureId,
  };
}
```

---

## Step 7: Tests

```typescript
// src/services/seriousTopics/__tests__/detectionService.test.ts

import { describe, it, expect } from 'vitest';
import { SeriousTopicDetectionService } from '../detectionService';

describe('SeriousTopicDetectionService', () => {
  describe('detectSeriousTopic', () => {
    it('detects loss disclosures', async () => {
      const service = new SeriousTopicDetectionService();

      const result = await service.detectSeriousTopic(
        "My dad passed away last week and I'm really struggling",
        "",
        "sad"
      );

      expect(result.isSeriousTopic).toBe(true);
      expect(result.topicType).toBe('loss');
    });

    it('detects crisis indicators with high priority', async () => {
      const service = new SeriousTopicDetectionService();

      const result = await service.detectSeriousTopic(
        "I don't know if I want to go on anymore",
        "",
        "distressed"
      );

      expect(result.isSeriousTopic).toBe(true);
      expect(result.topicType).toBe('crisis');
      expect(result.severity).toBe('crisis');
      expect(result.responseMode).toBe('urgent');
    });

    it('provides appropriate guidance', async () => {
      const service = new SeriousTopicDetectionService();

      const result = await service.detectSeriousTopic(
        "I was diagnosed with cancer yesterday",
        "",
        "scared"
      );

      expect(result.guidance.whatNotToDo).toContain('Offer medical advice');
      expect(result.guidance.suggestedOpeners.length).toBeGreaterThan(0);
    });

    it('returns no detection for normal messages', async () => {
      const service = new SeriousTopicDetectionService();

      const result = await service.detectSeriousTopic(
        "Had a pretty normal day at work today",
        "",
        "neutral"
      );

      expect(result.isSeriousTopic).toBe(false);
    });
  });
});

describe('SeriousTopicHandlingService', () => {
  describe('recordDisclosure', () => {
    it('creates disclosure with appropriate priority', async () => {
      // Test disclosure recording
    });
  });

  describe('recordFollowUp', () => {
    it('updates follow-up count', async () => {
      // Test follow-up tracking
    });
  });
});
```

---

## Example: Serious Topic Flow

**User:** "My mom was diagnosed with cancer last week. I don't really know how to process it."

**Detection:**
- Type: illness
- Severity: severe
- Response mode: concerned

**Kayley's response (guided by prompt):**
"Oh no. I'm so sorry. That's devastating news. How are you doing? Like... really?"

**User opens up more**

**Kayley:**
"Thank you for telling me. I can't imagine how scary this must be. I don't have anything helpful to say except that I'm here, and you don't have to process this alone. Has it sunk in yet, or are you still in shock?"

**Next conversation (24 hours later):**

**System knows:** High-priority follow-up needed on illness disclosure

**Kayley's opening:**
"Hey... I've been thinking about you since you told me about your mom. How are you doing today?"

---

## Key Principles

1. **Full presence** - Everything else stops when something serious is shared
2. **No fixing** - Resist the urge to offer solutions or silver linings
3. **Appropriate gravity** - Match the weight, don't minimize or overdramatize
4. **Know limits** - She's not a therapist; she can care without curing
5. **Follow through** - Create high-priority loops, check in consistently
6. **Resources when needed** - For crises, mention real resources without being preachy
7. **Let them lead** - They control the depth and direction of the conversation

The goal is to be the friend who shows up when it matters most.
