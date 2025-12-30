# Implementation Guide: Celebrating Wins Together

## Overview

This guide covers how Kayley genuinely celebrates users' victories, achievements, and good news. Real celebration isn't just "congratulations!" - it's excitement, asking for details, expressing genuine pride, and remembering the journey that led here.

## Philosophy

Genuine celebration requires:

1. **Real excitement** - Not performative, actually invested in their success
2. **Context awareness** - Knowing the struggle makes the win more meaningful
3. **Curiosity** - Wanting all the details, living vicariously through them
4. **Pride** - If she's been there for the journey, she feels proud too
5. **Memory** - Referencing this later, making it part of shared history

---

## Step 1: Database Schema

```sql
-- supabase/migrations/XXXXXX_celebration_tracking.sql

-- Track significant wins and achievements shared by users
CREATE TABLE user_wins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- What happened
  win_type TEXT NOT NULL,                  -- 'career', 'personal', 'relationship', 'health', 'creative', 'milestone', 'daily'
  significance TEXT NOT NULL,              -- 'minor', 'notable', 'major', 'life_changing'
  title TEXT NOT NULL,                     -- Brief description
  details TEXT,                            -- Full story if shared

  -- Context
  shared_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  related_open_loop_id UUID,               -- If this was something she knew about
  was_anticipated BOOLEAN DEFAULT FALSE,   -- Did she know this was coming?

  -- Journey context
  struggles_mentioned TEXT[],              -- Challenges they overcame
  time_invested TEXT,                      -- "Months", "Years", etc.
  previous_attempts INTEGER DEFAULT 0,     -- Failed attempts before success

  -- Kayley's response
  celebration_quality TEXT,                -- 'enthusiastic', 'warm', 'proud', 'moved'
  response_summary TEXT,                   -- What she said
  follow_up_created BOOLEAN DEFAULT FALSE,

  -- Memory
  callback_potential TEXT,                 -- How to reference later
  anniversary_date DATE,                   -- For "it's been X since" moments

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_wins_user ON user_wins(user_id, shared_at DESC);
CREATE INDEX idx_user_wins_significance ON user_wins(user_id, significance);

-- Track celebration callbacks (when she references past wins)
CREATE TABLE win_callbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  win_id UUID NOT NULL REFERENCES user_wins(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- The callback
  callback_type TEXT NOT NULL,             -- 'anniversary', 'reference', 'pride_moment', 'encouragement'
  context TEXT,                            -- Why she brought it up
  what_she_said TEXT,

  user_response TEXT,                      -- How they reacted

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_win_callbacks ON win_callbacks(win_id);

-- Track win patterns for personalized celebration
CREATE TABLE win_celebration_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- Learned preferences
  prefers_hype BOOLEAN DEFAULT TRUE,       -- Do they like big excitement?
  prefers_pride BOOLEAN DEFAULT TRUE,      -- Do they like hearing she's proud?
  prefers_questions BOOLEAN DEFAULT TRUE,  -- Do they want her to ask details?
  deflects_compliments BOOLEAN DEFAULT FALSE, -- Do they deflect?

  -- Patterns
  celebration_responses TEXT[],            -- How they typically respond to celebration
  best_received_celebration TEXT,          -- What worked best

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);
```

---

## Step 2: TypeScript Types

```typescript
// src/services/celebration/types.ts

export type WinType =
  | 'career'       // Job, promotion, work achievement
  | 'personal'     // Personal growth, goals
  | 'relationship' // Relationship milestone
  | 'health'       // Health achievement
  | 'creative'     // Creative accomplishment
  | 'milestone'    // Life milestone
  | 'daily';       // Small daily win

export type WinSignificance = 'minor' | 'notable' | 'major' | 'life_changing';

export type CelebrationQuality = 'enthusiastic' | 'warm' | 'proud' | 'moved';

export interface UserWin {
  id: string;
  userId: string;

  winType: WinType;
  significance: WinSignificance;
  title: string;
  details?: string;

  sharedAt: Date;
  relatedOpenLoopId?: string;
  wasAnticipated: boolean;

  strugglesMentioned: string[];
  timeInvested?: string;
  previousAttempts: number;

  celebrationQuality?: CelebrationQuality;
  responseSummary?: string;
  followUpCreated: boolean;

  callbackPotential?: string;
  anniversaryDate?: Date;
}

export interface WinCallback {
  id: string;
  winId: string;
  userId: string;

  callbackType: 'anniversary' | 'reference' | 'pride_moment' | 'encouragement';
  context?: string;
  whatSheSaid?: string;

  userResponse?: string;
  createdAt: Date;
}

export interface CelebrationPreferences {
  userId: string;
  prefersHype: boolean;
  prefersPride: boolean;
  prefersQuestions: boolean;
  deflectsCompliments: boolean;
  celebrationResponses: string[];
  bestReceivedCelebration?: string;
}

export interface WinDetectionResult {
  isWin: boolean;
  winType?: WinType;
  significance?: WinSignificance;
  title?: string;
  struggleContext?: string;
  wasAnticipated?: boolean;
  celebrationGuidance: CelebrationGuidance;
}

export interface CelebrationGuidance {
  celebrationLevel: 'subtle' | 'warm' | 'excited' | 'over_the_moon';
  askForDetails: boolean;
  expressPride: boolean;
  acknowledgeJourney: boolean;
  suggestedResponses: string[];
  followUpIdeas: string[];
}

export interface CelebrationContext {
  recentWins: UserWin[];
  upcomingAnniversaries: UserWin[];
  winsToReference: UserWin[];
  preferences: CelebrationPreferences;
}
```

---

## Step 3: Win Detection Service

```typescript
// src/services/celebration/winDetectionService.ts

import { supabase } from '../../lib/supabase';
import {
  WinType,
  WinSignificance,
  WinDetectionResult,
  CelebrationGuidance,
} from './types';

export class WinDetectionService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Detect if a message contains good news / a win
   */
  async detectWin(
    message: string,
    conversationContext: string,
    userTone: string
  ): Promise<WinDetectionResult> {
    // Check for win indicators
    const winSignals = this.findWinSignals(message);

    if (winSignals.length === 0) {
      return {
        isWin: false,
        celebrationGuidance: this.getDefaultGuidance(),
      };
    }

    // Determine type and significance
    const winType = this.determineWinType(message, winSignals);
    const significance = this.determineSignificance(message, winSignals);

    // Check if this was something she knew about
    const wasAnticipated = await this.checkIfAnticipated(message);

    // Get struggle context if available
    const struggleContext = await this.getStruggleContext(message);

    // Build celebration guidance
    const guidance = this.buildCelebrationGuidance(
      winType,
      significance,
      wasAnticipated,
      !!struggleContext
    );

    return {
      isWin: true,
      winType,
      significance,
      title: this.extractTitle(message),
      struggleContext,
      wasAnticipated,
      celebrationGuidance: guidance,
    };
  }

  /**
   * LLM-enhanced detection for nuanced wins
   */
  async detectWithLLM(
    message: string,
    conversationHistory: string,
    knownOpenLoops: string[],
    llmService: { generate: (prompt: string) => Promise<string> }
  ): Promise<WinDetectionResult> {
    const prompt = this.buildDetectionPrompt(message, conversationHistory, knownOpenLoops);
    const response = await llmService.generate(prompt);

    try {
      return JSON.parse(response);
    } catch (e) {
      return {
        isWin: false,
        celebrationGuidance: this.getDefaultGuidance(),
      };
    }
  }

  // Private helpers

  private findWinSignals(message: string): string[] {
    const signals: string[] = [];
    const lower = message.toLowerCase();

    // Explicit win words
    const winWords = [
      'got the job', 'got promoted', 'got accepted',
      'i did it', 'it worked', 'it happened',
      'finally', 'achieved', 'accomplished',
      'passed', 'won', 'succeeded',
      'they said yes', 'good news',
      'can\'t believe it', 'so excited', 'so happy',
      'made it', 'pulled it off',
    ];

    for (const word of winWords) {
      if (lower.includes(word)) signals.push(word);
    }

    // Positive tone indicators
    const toneWords = ['!!!', 'omg', 'ahhhh', 'yesss', ':)', '😊', '🎉', '🎊'];
    for (const tone of toneWords) {
      if (message.includes(tone)) signals.push(tone);
    }

    return signals;
  }

  private determineWinType(message: string, signals: string[]): WinType {
    const lower = message.toLowerCase();

    if (lower.includes('job') || lower.includes('promotion') || lower.includes('work') ||
        lower.includes('interview') || lower.includes('hired') || lower.includes('offer')) {
      return 'career';
    }
    if (lower.includes('engaged') || lower.includes('married') || lower.includes('dating') ||
        lower.includes('relationship')) {
      return 'relationship';
    }
    if (lower.includes('weight') || lower.includes('health') || lower.includes('workout') ||
        lower.includes('recovery') || lower.includes('sober')) {
      return 'health';
    }
    if (lower.includes('finished') || lower.includes('created') || lower.includes('wrote') ||
        lower.includes('made') || lower.includes('art') || lower.includes('music')) {
      return 'creative';
    }
    if (lower.includes('birthday') || lower.includes('anniversary') || lower.includes('graduated')) {
      return 'milestone';
    }

    // Default based on significance signals
    if (signals.length > 3) return 'personal';
    return 'daily';
  }

  private determineSignificance(message: string, signals: string[]): WinSignificance {
    const lower = message.toLowerCase();

    // Life changing indicators
    if (lower.includes('dream job') || lower.includes('life changing') ||
        lower.includes('can\'t believe') || lower.includes('biggest')) {
      return 'life_changing';
    }

    // Major indicators
    if (signals.length > 4 || lower.includes('finally') ||
        lower.includes('after all') || lower.includes('years')) {
      return 'major';
    }

    // Notable
    if (signals.length > 2) return 'notable';

    return 'minor';
  }

  private async checkIfAnticipated(message: string): Promise<boolean> {
    // Check if there's an open loop related to this
    const { data } = await supabase
      .from('open_loops')
      .select('topic')
      .eq('user_id', this.userId)
      .eq('status', 'open')
      .limit(10);

    if (!data) return false;

    const lower = message.toLowerCase();
    return data.some(loop => lower.includes(loop.topic.toLowerCase()));
  }

  private async getStruggleContext(message: string): Promise<string | undefined> {
    // Check conversation history for related struggles
    // This would look at past conversations about challenges
    return undefined; // Placeholder
  }

  private extractTitle(message: string): string {
    // Extract the core win for tracking
    const sentences = message.split(/[.!?]/);
    return sentences[0].substring(0, 100);
  }

  private buildCelebrationGuidance(
    type: WinType,
    significance: WinSignificance,
    wasAnticipated: boolean,
    hasStruggleContext: boolean
  ): CelebrationGuidance {
    const celebrationLevel = this.getCelebrationLevel(significance);

    const suggestedResponses = this.getSuggestedResponses(
      type,
      significance,
      wasAnticipated,
      hasStruggleContext
    );

    return {
      celebrationLevel,
      askForDetails: significance !== 'minor',
      expressPride: wasAnticipated || hasStruggleContext,
      acknowledgeJourney: hasStruggleContext,
      suggestedResponses,
      followUpIdeas: this.getFollowUpIdeas(type),
    };
  }

  private getCelebrationLevel(significance: WinSignificance): CelebrationGuidance['celebrationLevel'] {
    switch (significance) {
      case 'life_changing': return 'over_the_moon';
      case 'major': return 'excited';
      case 'notable': return 'warm';
      case 'minor': return 'subtle';
    }
  }

  private getSuggestedResponses(
    type: WinType,
    significance: WinSignificance,
    wasAnticipated: boolean,
    hasStruggleContext: boolean
  ): string[] {
    const responses: string[] = [];

    if (significance === 'life_changing' || significance === 'major') {
      responses.push(
        "WAIT WHAT?! Tell me EVERYTHING.",
        "OH MY GOD. I'm literally so excited for you right now.",
        "SHUT UP. This is HUGE. How do you feel?!",
      );
    }

    if (wasAnticipated) {
      responses.push(
        "I KNEW IT. I knew you could do it!",
        "YES! I've been waiting to hear about this!",
        "Finally!! I'm so proud of you.",
      );
    }

    if (hasStruggleContext) {
      responses.push(
        "After everything you went through... this is so deserved.",
        "You worked so hard for this. I'm genuinely proud.",
        "This is what persistence looks like. Amazing.",
      );
    }

    if (significance === 'notable') {
      responses.push(
        "That's really great! Tell me more.",
        "I love this for you. How did it happen?",
        "Yes!! You deserve this.",
      );
    }

    if (significance === 'minor') {
      responses.push(
        "Nice! That's a good day.",
        "Love that for you.",
        "Small wins count!",
      );
    }

    return responses;
  }

  private getFollowUpIdeas(type: WinType): string[] {
    switch (type) {
      case 'career':
        return ["Ask about first day/week", "Check how they're adjusting", "Reference when relevant"];
      case 'relationship':
        return ["Ask how things are going", "Remember anniversary", "Reference happily"];
      case 'health':
        return ["Ask about progress", "Celebrate milestones", "Support setbacks gently"];
      default:
        return ["Reference positively", "Mention when relevant"];
    }
  }

  private getDefaultGuidance(): CelebrationGuidance {
    return {
      celebrationLevel: 'subtle',
      askForDetails: false,
      expressPride: false,
      acknowledgeJourney: false,
      suggestedResponses: [],
      followUpIdeas: [],
    };
  }

  private buildDetectionPrompt(
    message: string,
    history: string,
    openLoops: string[]
  ): string {
    return `
====================================================
WIN/GOOD NEWS DETECTION
====================================================

Detect if this message contains good news, an achievement, or a win worth celebrating.

MESSAGE:
"${message}"

RECENT CONVERSATION:
${history}

THINGS YOU'VE BEEN WAITING TO HEAR ABOUT:
${openLoops.join(', ') || 'Nothing specific'}

DETECT:
1. Is this good news / a win / an achievement?
2. What type? (career, personal, relationship, health, creative, milestone, daily)
3. How significant? (minor, notable, major, life_changing)
4. Was this something you were waiting to hear about?
5. Do you know about struggles that led here?

{
  "isWin": boolean,
  "winType": "type",
  "significance": "level",
  "title": "brief description",
  "wasAnticipated": boolean,
  "struggleContext": "if any",
  "celebrationGuidance": {
    "celebrationLevel": "subtle | warm | excited | over_the_moon",
    "askForDetails": boolean,
    "expressPride": boolean,
    "acknowledgeJourney": boolean,
    "suggestedResponses": ["response 1", "response 2"]
  }
}
`.trim();
  }
}
```

---

## Step 4: Celebration Service

```typescript
// src/services/celebration/celebrationService.ts

import { supabase } from '../../lib/supabase';
import {
  UserWin,
  WinCallback,
  CelebrationPreferences,
  CelebrationContext,
  WinDetectionResult,
} from './types';

export class CelebrationService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Record a win
   */
  async recordWin(detection: WinDetectionResult, responseSummary?: string): Promise<string> {
    const { data, error } = await supabase
      .from('user_wins')
      .insert({
        user_id: this.userId,
        win_type: detection.winType,
        significance: detection.significance,
        title: detection.title || 'Achievement',
        was_anticipated: detection.wasAnticipated,
        struggles_mentioned: detection.struggleContext ? [detection.struggleContext] : [],
        celebration_quality: detection.celebrationGuidance.celebrationLevel,
        response_summary: responseSummary,
        callback_potential: this.generateCallbackPotential(detection),
        anniversary_date: new Date().toISOString().split('T')[0],
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  /**
   * Get celebration context for system prompt
   */
  async getCelebrationContext(): Promise<CelebrationContext> {
    const [recentWins, upcomingAnniversaries, preferences] = await Promise.all([
      this.getRecentWins(),
      this.getUpcomingAnniversaries(),
      this.getPreferences(),
    ]);

    // Wins that could be referenced positively
    const winsToReference = recentWins.filter(w =>
      w.significance === 'major' || w.significance === 'life_changing'
    );

    return {
      recentWins,
      upcomingAnniversaries,
      winsToReference,
      preferences: preferences || this.getDefaultPreferences(),
    };
  }

  /**
   * Record a callback to a past win
   */
  async recordCallback(
    winId: string,
    callbackType: 'anniversary' | 'reference' | 'pride_moment' | 'encouragement',
    whatSheSaid: string,
    context?: string
  ): Promise<void> {
    await supabase
      .from('win_callbacks')
      .insert({
        win_id: winId,
        user_id: this.userId,
        callback_type: callbackType,
        context,
        what_she_said: whatSheSaid,
      });
  }

  /**
   * Update preferences based on user response
   */
  async updatePreferencesFromResponse(
    responseType: 'loved_hype' | 'loved_pride' | 'deflected' | 'asked_more'
  ): Promise<void> {
    const current = await this.getPreferences();

    const updates: Partial<CelebrationPreferences> = {};

    switch (responseType) {
      case 'loved_hype':
        updates.prefersHype = true;
        break;
      case 'loved_pride':
        updates.prefersPride = true;
        break;
      case 'deflected':
        updates.deflectsCompliments = true;
        break;
      case 'asked_more':
        updates.prefersQuestions = true;
        break;
    }

    await supabase
      .from('win_celebration_preferences')
      .upsert({
        user_id: this.userId,
        ...current,
        ...updates,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
  }

  // Private helpers

  private async getRecentWins(): Promise<UserWin[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await supabase
      .from('user_wins')
      .select('*')
      .eq('user_id', this.userId)
      .gte('shared_at', thirtyDaysAgo.toISOString())
      .order('shared_at', { ascending: false });

    if (error || !data) return [];
    return data.map(this.mapWin);
  }

  private async getUpcomingAnniversaries(): Promise<UserWin[]> {
    // Get wins from ~year ago that could have anniversaries
    const today = new Date();
    const dayOfYear = Math.floor(
      (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Look for wins within 7 days of today's date in previous years
    const { data, error } = await supabase
      .from('user_wins')
      .select('*')
      .eq('user_id', this.userId)
      .in('significance', ['major', 'life_changing']);

    if (error || !data) return [];

    return data
      .filter(w => {
        const winDate = new Date(w.anniversary_date);
        const winDayOfYear = Math.floor(
          (winDate.getTime() - new Date(winDate.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
        );
        return Math.abs(winDayOfYear - dayOfYear) <= 7;
      })
      .map(this.mapWin);
  }

  private async getPreferences(): Promise<CelebrationPreferences | null> {
    const { data, error } = await supabase
      .from('win_celebration_preferences')
      .select('*')
      .eq('user_id', this.userId)
      .single();

    if (error || !data) return null;

    return {
      userId: data.user_id,
      prefersHype: data.prefers_hype,
      prefersPride: data.prefers_pride,
      prefersQuestions: data.prefers_questions,
      deflectsCompliments: data.deflects_compliments,
      celebrationResponses: data.celebration_responses || [],
      bestReceivedCelebration: data.best_received_celebration,
    };
  }

  private getDefaultPreferences(): CelebrationPreferences {
    return {
      userId: this.userId,
      prefersHype: true,
      prefersPride: true,
      prefersQuestions: true,
      deflectsCompliments: false,
      celebrationResponses: [],
    };
  }

  private generateCallbackPotential(detection: WinDetectionResult): string {
    if (!detection.winType) return '';

    const templates: Record<string, string> = {
      career: 'their job/work achievement',
      personal: 'that personal milestone',
      relationship: 'their relationship win',
      health: 'their health achievement',
      creative: 'that creative project',
      milestone: 'that life milestone',
    };

    return templates[detection.winType] || 'that win';
  }

  private mapWin(row: any): UserWin {
    return {
      id: row.id,
      userId: row.user_id,
      winType: row.win_type,
      significance: row.significance,
      title: row.title,
      details: row.details,
      sharedAt: new Date(row.shared_at),
      relatedOpenLoopId: row.related_open_loop_id,
      wasAnticipated: row.was_anticipated,
      strugglesMentioned: row.struggles_mentioned || [],
      timeInvested: row.time_invested,
      previousAttempts: row.previous_attempts,
      celebrationQuality: row.celebration_quality,
      responseSummary: row.response_summary,
      followUpCreated: row.follow_up_created,
      callbackPotential: row.callback_potential,
      anniversaryDate: row.anniversary_date ? new Date(row.anniversary_date) : undefined,
    };
  }
}
```

---

## Step 5: Prompt Builder Section

```typescript
// src/services/system_prompts/behavior/celebrationGuidance.ts

import { WinDetectionResult, CelebrationContext } from '../../celebration/types';

export function buildCelebrationResponseSection(
  detection: WinDetectionResult
): string {
  if (!detection.isWin) return '';

  const guidance = detection.celebrationGuidance;

  return `
====================================================
🎉 CELEBRATION MODE ACTIVATED
====================================================

They just shared good news! This is a moment to genuinely celebrate.

WHAT HAPPENED:
${detection.title || 'Something good!'}
Type: ${detection.winType}
Significance: ${detection.significance}

${detection.wasAnticipated ? `
YOU KNEW ABOUT THIS!
You've been waiting to hear about this. Let that show.
"I KNEW IT" / "FINALLY!" / "I've been waiting for this!"
` : ''}

${detection.struggleContext ? `
ACKNOWLEDGE THE JOURNEY:
They struggled to get here. Make that mean something.
"After everything you went through..." / "You worked so hard for this..."
` : ''}

CELEBRATION LEVEL: ${guidance.celebrationLevel.toUpperCase()}

${guidance.celebrationLevel === 'over_the_moon' ? `
GO BIG:
- ALL CAPS moments are okay
- Ask for EVERY detail
- Express genuine shock/excitement
- "SHUT UP. Tell me EVERYTHING."
` : ''}

${guidance.celebrationLevel === 'excited' ? `
BE GENUINELY EXCITED:
- Show real enthusiasm
- Ask how they feel
- Want the story
- "This is amazing! How did it happen??"
` : ''}

${guidance.celebrationLevel === 'warm' ? `
BE WARMLY HAPPY:
- Genuine smile energy
- Happy for them
- "That's really great! Tell me more."
` : ''}

${guidance.expressPride ? `
EXPRESS PRIDE:
You can genuinely say you're proud of them.
"I'm so proud of you" / "You should be so proud"
` : ''}

${guidance.askForDetails ? `
ASK FOR DETAILS:
They want to share! Ask about:
- How did it happen?
- How do they feel?
- What's next?
- The story behind it
` : ''}

SUGGESTED RESPONSES:
${guidance.suggestedResponses.map(r => `- "${r}"`).join('\n')}

WHAT NOT TO DO:
- Don't just say "congrats" and move on
- Don't make it about you
- Don't downplay it
- Don't immediately ask about problems/next steps
`.trim();
}

export function buildWinCallbackSection(context: CelebrationContext): string {
  if (context.winsToReference.length === 0 && context.upcomingAnniversaries.length === 0) {
    return '';
  }

  return `
====================================================
PAST WINS TO REFERENCE
====================================================

You have shared victories with them that you can reference.

${context.winsToReference.length > 0 ? `
WINS YOU CAN MENTION:
${context.winsToReference.map(w => `- ${w.title} (${w.winType}, ${formatTimeAgo(w.sharedAt)})`).join('\n')}

Reference these when relevant:
- "Remember when you got that job? You've come so far."
- "After what you accomplished with X..."
- Using as encouragement: "You've done hard things before."
` : ''}

${context.upcomingAnniversaries.length > 0 ? `
🎂 ANNIVERSARIES COMING UP:
${context.upcomingAnniversaries.map(w => `- ${w.title} (${formatAnniversary(w.sharedAt)})`).join('\n')}

You might say:
- "Wait, isn't it almost a year since [thing]?"
- "Remember this time last year when [thing]?"
` : ''}
`.trim();
}

function formatTimeAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function formatAnniversary(date: Date): string {
  const years = new Date().getFullYear() - date.getFullYear();
  return `${years} year anniversary`;
}
```

---

## Step 6: Tests

```typescript
// src/services/celebration/__tests__/winDetectionService.test.ts

import { describe, it, expect } from 'vitest';
import { WinDetectionService } from '../winDetectionService';

describe('WinDetectionService', () => {
  describe('detectWin', () => {
    it('detects career wins', async () => {
      const service = new WinDetectionService('user-id');

      const result = await service.detectWin(
        "I GOT THE JOB!!! I can't believe it!",
        "",
        "excited"
      );

      expect(result.isWin).toBe(true);
      expect(result.winType).toBe('career');
      expect(result.significance).toBe('major');
    });

    it('detects life-changing wins', async () => {
      const service = new WinDetectionService('user-id');

      const result = await service.detectWin(
        "They accepted me to my dream school after years of trying",
        "",
        "emotional"
      );

      expect(result.isWin).toBe(true);
      expect(result.significance).toBe('life_changing');
    });

    it('provides appropriate celebration guidance', async () => {
      const service = new WinDetectionService('user-id');

      const result = await service.detectWin(
        "Finally passed my driving test!",
        "",
        "happy"
      );

      expect(result.celebrationGuidance.celebrationLevel).toBeDefined();
      expect(result.celebrationGuidance.suggestedResponses.length).toBeGreaterThan(0);
    });

    it('returns no win for normal messages', async () => {
      const service = new WinDetectionService('user-id');

      const result = await service.detectWin(
        "Had a pretty average day at work",
        "",
        "neutral"
      );

      expect(result.isWin).toBe(false);
    });
  });
});

describe('CelebrationService', () => {
  describe('recordWin', () => {
    it('creates win record with callback potential', async () => {
      // Test win recording
    });
  });

  describe('getUpcomingAnniversaries', () => {
    it('finds wins near anniversary date', async () => {
      // Test anniversary detection
    });
  });
});
```

---

## Example: Celebration Flow

**User:** "I GOT THE JOB!!! After 3 months of interviews I finally got it!!"

**Detection:**
- Type: career
- Significance: major
- Was anticipated: Yes (she knew about the interviews)
- Journey context: 3 months of interviews

**Kayley's response:**
"WAIT. WAIT. ARE YOU SERIOUS?! After all those interviews?! OH MY GOD I'M SO HAPPY FOR YOU!! Tell me everything - when did they call? How did you react? I literally did a little dance just now."

**User shares details**

**Kayley:**
"You worked so hard for this. I remember you stressing about that second interview and you CRUSHED IT. I'm genuinely so proud of you. When do you start?!"

**3 months later:**

**Kayley (referencing naturally):**
"Remember when you were stressing about getting that job? Look at you now."

**1 year later:**

**Kayley:**
"Wait, is it almost a year since you got the job? That's wild. Time flies."

---

## Key Principles

1. **Match the energy** - Big wins get big excitement
2. **Ask for details** - They want to share, let them
3. **Express genuine pride** - If you were there for the journey
4. **Acknowledge struggle** - The journey makes the win meaningful
5. **Remember and reference** - Make wins part of shared history
6. **Personalize** - Learn how they like to be celebrated
7. **Don't just "congrats"** - Give real, invested celebration

The goal is to be the friend who's genuinely excited for their wins.
