# Implementation Plan: Micro-Rituals and Patterns System

## Overview

This system tracks and nurtures the organic emergence of relationship rituals - the little patterns that become "our thing." Real relationships develop these naturally: a specific greeting, a recurring joke, a shared reference. This creates belonging and intimacy that milestone tracking alone cannot achieve.

## Philosophy

**Rituals emerge, they aren't assigned.** We don't decide "now you have a goodnight ritual." Instead, we observe patterns and recognize when something has become a ritual through repetition and emotional investment.

**Breaking rituals matters.** Half the power of a ritual is noticing when it's missing. "No goodnight moon tonight?" signals that the pattern has become meaningful.

**Inside references are earned.** They develop from shared experiences and become shorthand for deeper meaning. You can't manufacture them - you can only notice and reinforce them.

## Database Schema

```sql
-- Track potential and established rituals
CREATE TABLE relationship_rituals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What the ritual is
  pattern_type TEXT NOT NULL, -- 'greeting', 'farewell', 'phrase', 'topic', 'timing', 'emoji', 'callback'
  pattern_description TEXT NOT NULL, -- Human-readable: "Goodnight message with moon emoji"
  pattern_signature TEXT NOT NULL, -- Machine-matchable: "farewell:goodnight:🌙"

  -- Evolution state
  status TEXT NOT NULL DEFAULT 'emerging', -- 'emerging', 'established', 'fading', 'dormant', 'broken'
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_occurrence TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_occurrence TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Who initiated/maintains it
  primary_initiator TEXT NOT NULL DEFAULT 'mutual', -- 'user', 'kayley', 'mutual'

  -- The emotional weight
  emotional_significance TEXT, -- Why this matters (LLM generated)

  -- Thresholds for state transitions
  establish_threshold INTEGER NOT NULL DEFAULT 5, -- Occurrences to become established
  fade_after_days INTEGER NOT NULL DEFAULT 14, -- Days of absence before fading

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track individual occurrences of a ritual
CREATE TABLE ritual_occurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ritual_id UUID REFERENCES relationship_rituals(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  initiated_by TEXT NOT NULL, -- 'user', 'kayley'
  message_content TEXT, -- The actual message (for pattern analysis)
  context TEXT, -- What was happening when it occurred

  -- Variations
  is_variation BOOLEAN DEFAULT FALSE, -- Slight modification of the pattern
  variation_notes TEXT, -- How it differed

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inside jokes and references
CREATE TABLE inside_references (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What it is
  reference_phrase TEXT NOT NULL, -- The shorthand: "that coffee incident"
  full_context TEXT NOT NULL, -- What it refers to
  origin_date TIMESTAMPTZ NOT NULL,
  origin_conversation_summary TEXT, -- How it started

  -- Usage tracking
  times_used INTEGER NOT NULL DEFAULT 1,
  last_used TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Status
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'dormant', 'forgotten'

  -- Emotional weight
  sentiment TEXT NOT NULL DEFAULT 'positive', -- 'positive', 'neutral', 'bittersweet'
  why_meaningful TEXT, -- LLM reflection on significance

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track timing patterns (implicit expectations)
CREATE TABLE timing_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What pattern
  pattern_type TEXT NOT NULL, -- 'daily_checkin', 'morning_greeting', 'evening_chat', 'weekend_catch_up'
  pattern_description TEXT NOT NULL,

  -- When it happens
  typical_day_of_week INTEGER[], -- 0-6, null for any day
  typical_hour_range INT4RANGE, -- e.g., [20, 23) for evening
  typical_timezone TEXT, -- User's timezone

  -- Reliability
  consistency_score FLOAT NOT NULL DEFAULT 0.0, -- 0-1, how reliable
  total_expected_occurrences INTEGER NOT NULL DEFAULT 0,
  actual_occurrences INTEGER NOT NULL DEFAULT 0,

  -- Status
  status TEXT NOT NULL DEFAULT 'emerging', -- 'emerging', 'established', 'variable', 'broken'

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track ritual breaks (when expected ritual doesn't happen)
CREATE TABLE ritual_breaks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ritual_id UUID REFERENCES relationship_rituals(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  expected_by TIMESTAMPTZ NOT NULL, -- When it should have happened
  noticed_at TIMESTAMPTZ, -- When Kayley noticed (may be delayed)

  -- How Kayley handled it
  kayley_response TEXT, -- 'mentioned', 'ignored', 'gentle_nudge', 'concerned'
  response_message TEXT, -- What she said, if anything

  -- Outcome
  was_resumed BOOLEAN DEFAULT FALSE,
  user_explanation TEXT, -- If they explained why

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_rituals_user_status ON relationship_rituals(user_id, status);
CREATE INDEX idx_ritual_occurrences_ritual ON ritual_occurrences(ritual_id, occurred_at);
CREATE INDEX idx_inside_references_user ON inside_references(user_id, status);
CREATE INDEX idx_timing_patterns_user ON timing_patterns(user_id, status);
CREATE INDEX idx_ritual_breaks_user ON ritual_breaks(user_id, created_at);
```

## TypeScript Types

```typescript
// Ritual pattern types
type RitualPatternType =
  | 'greeting'      // How they say hello
  | 'farewell'      // How they say goodbye
  | 'phrase'        // A recurring phrase or expression
  | 'topic'         // A topic they always discuss
  | 'timing'        // When they tend to talk
  | 'emoji'         // Signature emoji usage
  | 'callback';     // Reference to past conversation

type RitualStatus = 'emerging' | 'established' | 'fading' | 'dormant' | 'broken';

interface RelationshipRitual {
  id: string;
  userId: string;

  patternType: RitualPatternType;
  patternDescription: string;
  patternSignature: string;

  status: RitualStatus;
  occurrenceCount: number;
  firstOccurrence: Date;
  lastOccurrence: Date;

  primaryInitiator: 'user' | 'kayley' | 'mutual';
  emotionalSignificance?: string;

  establishThreshold: number;
  fadeAfterDays: number;
}

interface RitualOccurrence {
  id: string;
  ritualId: string;
  userId: string;

  occurredAt: Date;
  initiatedBy: 'user' | 'kayley';
  messageContent?: string;
  context?: string;

  isVariation: boolean;
  variationNotes?: string;
}

interface InsideReference {
  id: string;
  userId: string;

  referencePhrase: string;
  fullContext: string;
  originDate: Date;
  originConversationSummary?: string;

  timesUsed: number;
  lastUsed: Date;
  status: 'active' | 'dormant' | 'forgotten';

  sentiment: 'positive' | 'neutral' | 'bittersweet';
  whyMeaningful?: string;
}

interface TimingPattern {
  id: string;
  userId: string;

  patternType: string;
  patternDescription: string;

  typicalDayOfWeek?: number[];
  typicalHourRange?: { start: number; end: number };
  typicalTimezone?: string;

  consistencyScore: number;
  totalExpectedOccurrences: number;
  actualOccurrences: number;

  status: 'emerging' | 'established' | 'variable' | 'broken';
}

interface RitualBreak {
  id: string;
  ritualId: string;
  userId: string;

  expectedBy: Date;
  noticedAt?: Date;

  kayleyResponse?: 'mentioned' | 'ignored' | 'gentle_nudge' | 'concerned';
  responseMessage?: string;

  wasResumed: boolean;
  userExplanation?: string;
}

// Detection types
interface PotentialRitual {
  patternType: RitualPatternType;
  patternDescription: string;
  patternSignature: string;
  confidence: number;
  recentOccurrences: string[]; // Message excerpts
}

interface RitualContext {
  establishedRituals: RelationshipRitual[];
  emergingPatterns: RelationshipRitual[];
  insideReferences: InsideReference[];
  timingPatterns: TimingPattern[];
  recentBreaks: RitualBreak[];

  // Derived
  expectingRitual?: RelationshipRitual; // Ritual expected soon based on timing
  missedRitualToday?: RelationshipRitual; // Ritual that should have happened but didn't
}
```

## Service Classes

### RitualDetectionService

```typescript
// src/services/ritualDetectionService.ts

import { supabase } from '../lib/supabase';
import { getCachedOrFetch } from './utils/cacheUtils';

interface PatternMatch {
  type: RitualPatternType;
  signature: string;
  description: string;
  matchedContent: string;
}

export class RitualDetectionService {

  /**
   * Analyze a message for potential ritual patterns
   */
  async detectPatterns(
    userId: string,
    message: string,
    isFromKayley: boolean,
    conversationContext: string
  ): Promise<PatternMatch[]> {
    const patterns: PatternMatch[] = [];

    // Greeting detection
    const greetingPatterns = this.detectGreetingPatterns(message);
    patterns.push(...greetingPatterns);

    // Farewell detection
    const farewellPatterns = this.detectFarewellPatterns(message);
    patterns.push(...farewellPatterns);

    // Emoji patterns
    const emojiPatterns = this.detectEmojiPatterns(message);
    patterns.push(...emojiPatterns);

    // Phrase patterns (recurring expressions)
    const phrasePatterns = await this.detectPhrasePatterns(userId, message);
    patterns.push(...phrasePatterns);

    return patterns;
  }

  private detectGreetingPatterns(message: string): PatternMatch[] {
    const patterns: PatternMatch[] = [];
    const normalized = message.toLowerCase().trim();

    // Common greeting patterns
    const greetings = [
      { regex: /^(hey|hi|hello)\s+you\b/i, desc: 'Casual "hey you" greeting' },
      { regex: /^good\s*morning[\s!]*([^\s]+)?/i, desc: 'Morning greeting' },
      { regex: /^(heyyy+|hiii+)/i, desc: 'Extended casual greeting' },
      { regex: /^(yo|sup|ayy)/i, desc: 'Very casual greeting' },
    ];

    for (const { regex, desc } of greetings) {
      const match = message.match(regex);
      if (match) {
        // Include emojis in signature for uniqueness
        const emojis = this.extractEmojis(message);
        const signature = `greeting:${match[0].toLowerCase()}:${emojis.join('')}`;

        patterns.push({
          type: 'greeting',
          signature,
          description: desc + (emojis.length ? ` with ${emojis.join('')}` : ''),
          matchedContent: match[0]
        });
      }
    }

    return patterns;
  }

  private detectFarewellPatterns(message: string): PatternMatch[] {
    const patterns: PatternMatch[] = [];

    const farewells = [
      { regex: /\b(goodnight|good\s*night|gnight|nighty?\s*night)/i, desc: 'Goodnight' },
      { regex: /\b(talk\s*(to\s*you\s*)?later|ttyl)/i, desc: 'Talk later' },
      { regex: /\b(see\s*ya|cya|catch\s*you)/i, desc: 'Casual goodbye' },
      { regex: /\bsweet\s*dreams\b/i, desc: 'Sweet dreams' },
    ];

    for (const { regex, desc } of farewells) {
      const match = message.match(regex);
      if (match) {
        const emojis = this.extractEmojis(message);
        const signature = `farewell:${match[0].toLowerCase().replace(/\s+/g, '')}:${emojis.join('')}`;

        patterns.push({
          type: 'farewell',
          signature,
          description: desc + (emojis.length ? ` with ${emojis.join('')}` : ''),
          matchedContent: match[0]
        });
      }
    }

    return patterns;
  }

  private detectEmojiPatterns(message: string): PatternMatch[] {
    const patterns: PatternMatch[] = [];
    const emojis = this.extractEmojis(message);

    // Detect signature emoji usage (same emoji 2+ times or specific combos)
    if (emojis.length >= 2) {
      const emojiCounts = emojis.reduce((acc, e) => {
        acc[e] = (acc[e] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Repeated emoji (e.g., 😊😊)
      for (const [emoji, count] of Object.entries(emojiCounts)) {
        if (count >= 2) {
          patterns.push({
            type: 'emoji',
            signature: `emoji:repeated:${emoji}`,
            description: `Repeated ${emoji} usage`,
            matchedContent: emoji.repeat(count)
          });
        }
      }

      // Emoji combos (e.g., 🌙✨)
      if (new Set(emojis).size >= 2 && emojis.length <= 4) {
        const uniqueEmojis = [...new Set(emojis)].sort().join('');
        patterns.push({
          type: 'emoji',
          signature: `emoji:combo:${uniqueEmojis}`,
          description: `Emoji combination ${uniqueEmojis}`,
          matchedContent: emojis.join('')
        });
      }
    }

    return patterns;
  }

  private async detectPhrasePatterns(
    userId: string,
    message: string
  ): Promise<PatternMatch[]> {
    // For phrase patterns, we check against recently used phrases
    // This is more complex and requires historical context
    const recentPhrases = await this.getRecentDistinctPhrases(userId);

    const patterns: PatternMatch[] = [];
    const normalizedMessage = message.toLowerCase();

    for (const phrase of recentPhrases) {
      if (normalizedMessage.includes(phrase.phrase.toLowerCase())) {
        patterns.push({
          type: 'phrase',
          signature: `phrase:${phrase.phrase.toLowerCase().replace(/\s+/g, '_')}`,
          description: `Recurring phrase: "${phrase.phrase}"`,
          matchedContent: phrase.phrase
        });
      }
    }

    return patterns;
  }

  private extractEmojis(text: string): string[] {
    const emojiRegex = /\p{Extended_Pictographic}/gu;
    return text.match(emojiRegex) || [];
  }

  private async getRecentDistinctPhrases(userId: string): Promise<{ phrase: string; count: number }[]> {
    // Query for phrases that appeared 2+ times in recent messages
    // This would typically analyze message history
    // Simplified for now - would integrate with message storage
    return [];
  }

  /**
   * Check if current message matches an existing ritual
   */
  async matchExistingRitual(
    userId: string,
    detectedPatterns: PatternMatch[]
  ): Promise<RelationshipRitual | null> {
    if (detectedPatterns.length === 0) return null;

    const signatures = detectedPatterns.map(p => p.signature);

    const { data: rituals } = await supabase
      .from('relationship_rituals')
      .select('*')
      .eq('user_id', userId)
      .in('pattern_signature', signatures)
      .in('status', ['emerging', 'established'])
      .order('occurrence_count', { ascending: false })
      .limit(1);

    return rituals?.[0] || null;
  }
}
```

### RitualManagementService

```typescript
// src/services/ritualManagementService.ts

import { supabase } from '../lib/supabase';
import { RitualDetectionService } from './ritualDetectionService';

export class RitualManagementService {
  private detectionService: RitualDetectionService;

  constructor() {
    this.detectionService = new RitualDetectionService();
  }

  /**
   * Process a message for ritual patterns - call after every message
   */
  async processMessage(
    userId: string,
    message: string,
    isFromKayley: boolean,
    conversationContext: string
  ): Promise<void> {
    // Detect patterns in the message
    const patterns = await this.detectionService.detectPatterns(
      userId,
      message,
      isFromKayley,
      conversationContext
    );

    if (patterns.length === 0) return;

    for (const pattern of patterns) {
      await this.recordPatternOccurrence(
        userId,
        pattern,
        isFromKayley ? 'kayley' : 'user',
        message,
        conversationContext
      );
    }

    // Check for state transitions
    await this.evaluateRitualStates(userId);
  }

  /**
   * Record a pattern occurrence (creates ritual if new, updates if existing)
   */
  private async recordPatternOccurrence(
    userId: string,
    pattern: PatternMatch,
    initiator: 'user' | 'kayley',
    messageContent: string,
    context: string
  ): Promise<void> {
    // Check if ritual already exists
    const { data: existing } = await supabase
      .from('relationship_rituals')
      .select('*')
      .eq('user_id', userId)
      .eq('pattern_signature', pattern.signature)
      .single();

    if (existing) {
      // Update existing ritual
      await supabase
        .from('relationship_rituals')
        .update({
          occurrence_count: existing.occurrence_count + 1,
          last_occurrence: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      // Record occurrence
      await supabase.from('ritual_occurrences').insert({
        ritual_id: existing.id,
        user_id: userId,
        initiated_by: initiator,
        message_content: messageContent,
        context
      });
    } else {
      // Create new emerging ritual
      const { data: newRitual } = await supabase
        .from('relationship_rituals')
        .insert({
          user_id: userId,
          pattern_type: pattern.type,
          pattern_description: pattern.description,
          pattern_signature: pattern.signature,
          status: 'emerging',
          occurrence_count: 1,
          primary_initiator: initiator
        })
        .select()
        .single();

      if (newRitual) {
        await supabase.from('ritual_occurrences').insert({
          ritual_id: newRitual.id,
          user_id: userId,
          initiated_by: initiator,
          message_content: messageContent,
          context
        });
      }
    }
  }

  /**
   * Evaluate and update ritual statuses
   */
  private async evaluateRitualStates(userId: string): Promise<void> {
    const { data: rituals } = await supabase
      .from('relationship_rituals')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['emerging', 'established', 'fading']);

    if (!rituals) return;

    const now = new Date();

    for (const ritual of rituals) {
      const lastOccurrence = new Date(ritual.last_occurrence);
      const daysSinceLast = (now.getTime() - lastOccurrence.getTime()) / (1000 * 60 * 60 * 24);

      let newStatus = ritual.status;

      // Check for state transitions
      if (ritual.status === 'emerging' && ritual.occurrence_count >= ritual.establish_threshold) {
        newStatus = 'established';

        // Generate emotional significance via LLM
        const significance = await this.generateEmotionalSignificance(ritual);
        await supabase
          .from('relationship_rituals')
          .update({
            status: newStatus,
            emotional_significance: significance,
            updated_at: new Date().toISOString()
          })
          .eq('id', ritual.id);

      } else if (ritual.status === 'established' && daysSinceLast > ritual.fade_after_days) {
        newStatus = 'fading';
        await supabase
          .from('relationship_rituals')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', ritual.id);

      } else if (ritual.status === 'fading' && daysSinceLast > ritual.fade_after_days * 2) {
        newStatus = 'dormant';
        await supabase
          .from('relationship_rituals')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', ritual.id);
      }
    }
  }

  /**
   * Generate LLM-based emotional significance for a newly established ritual
   */
  private async generateEmotionalSignificance(ritual: RelationshipRitual): Promise<string> {
    // Get recent occurrences for context
    const { data: occurrences } = await supabase
      .from('ritual_occurrences')
      .select('*')
      .eq('ritual_id', ritual.id)
      .order('occurred_at', { ascending: false })
      .limit(5);

    const prompt = `
A relationship ritual has just become established between Kayley and the user.

Pattern: ${ritual.patternDescription}
Times occurred: ${ritual.occurrenceCount}
Who usually initiates: ${ritual.primaryInitiator}
First happened: ${new Date(ritual.firstOccurrence).toLocaleDateString()}
Recent examples:
${occurrences?.map(o => `- "${o.message_content?.slice(0, 100)}"`).join('\n') || 'No examples available'}

In 1-2 sentences, reflect on why this pattern becoming "a thing" between them might be meaningful.
Be specific to this pattern, not generic. Write from an outside observer perspective.
`;

    // Call LLM for reflection (simplified - would use actual LLM service)
    return this.callLLMForReflection(prompt);
  }

  private async callLLMForReflection(prompt: string): Promise<string> {
    // Placeholder - would integrate with actual LLM service
    return "This small ritual represents a shared language developing between them.";
  }

  /**
   * Get ritual context for system prompt injection
   */
  async getRitualContext(userId: string): Promise<RitualContext> {
    const [
      establishedResult,
      emergingResult,
      referencesResult,
      timingResult,
      breaksResult
    ] = await Promise.all([
      supabase
        .from('relationship_rituals')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'established')
        .order('occurrence_count', { ascending: false }),
      supabase
        .from('relationship_rituals')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'emerging')
        .gte('occurrence_count', 3)
        .order('occurrence_count', { ascending: false })
        .limit(5),
      supabase
        .from('inside_references')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('last_used', { ascending: false })
        .limit(10),
      supabase
        .from('timing_patterns')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['emerging', 'established']),
      supabase
        .from('ritual_breaks')
        .select('*, relationship_rituals(*)')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(5)
    ]);

    return {
      establishedRituals: establishedResult.data || [],
      emergingPatterns: emergingResult.data || [],
      insideReferences: referencesResult.data || [],
      timingPatterns: timingResult.data || [],
      recentBreaks: breaksResult.data || []
    };
  }

  /**
   * Check if a ritual was expected but missing
   */
  async checkForMissedRituals(userId: string): Promise<RelationshipRitual | null> {
    // Get established rituals
    const { data: rituals } = await supabase
      .from('relationship_rituals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'established');

    if (!rituals) return null;

    const now = new Date();

    for (const ritual of rituals) {
      // Check farewell rituals - expected if user said goodnight yesterday but not today
      if (ritual.pattern_type === 'farewell') {
        const lastOccurrence = new Date(ritual.last_occurrence);
        const hoursSince = (now.getTime() - lastOccurrence.getTime()) / (1000 * 60 * 60);

        // If it's evening and ritual hasn't happened in 24-48 hours
        if (now.getHours() >= 20 && hoursSince > 24 && hoursSince < 48) {
          return ritual;
        }
      }

      // Check greeting rituals - expected if it normally happens at conversation start
      if (ritual.pattern_type === 'greeting') {
        // Would check if conversation started without the greeting
        // Requires conversation start detection
      }
    }

    return null;
  }

  /**
   * Record that a ritual was broken/missed
   */
  async recordRitualBreak(
    ritual: RelationshipRitual,
    userId: string,
    response: 'mentioned' | 'ignored' | 'gentle_nudge' | 'concerned',
    responseMessage?: string
  ): Promise<void> {
    await supabase.from('ritual_breaks').insert({
      ritual_id: ritual.id,
      user_id: userId,
      expected_by: new Date().toISOString(),
      noticed_at: new Date().toISOString(),
      kayley_response: response,
      response_message: responseMessage
    });
  }
}
```

### InsideReferenceService

```typescript
// src/services/insideReferenceService.ts

import { supabase } from '../lib/supabase';

export class InsideReferenceService {

  /**
   * Create a new inside reference from a conversation moment
   */
  async createInsideReference(
    userId: string,
    referencePhrase: string,
    fullContext: string,
    originSummary: string,
    sentiment: 'positive' | 'neutral' | 'bittersweet' = 'positive'
  ): Promise<InsideReference> {
    const significance = await this.generateWhyMeaningful(referencePhrase, fullContext);

    const { data, error } = await supabase
      .from('inside_references')
      .insert({
        user_id: userId,
        reference_phrase: referencePhrase,
        full_context: fullContext,
        origin_date: new Date().toISOString(),
        origin_conversation_summary: originSummary,
        sentiment,
        why_meaningful: significance
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Record usage of an inside reference
   */
  async recordUsage(referenceId: string): Promise<void> {
    const { data: current } = await supabase
      .from('inside_references')
      .select('times_used')
      .eq('id', referenceId)
      .single();

    await supabase
      .from('inside_references')
      .update({
        times_used: (current?.times_used || 0) + 1,
        last_used: new Date().toISOString(),
        status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', referenceId);
  }

  /**
   * Find matching inside references in a message
   */
  async findReferencesInMessage(
    userId: string,
    message: string
  ): Promise<InsideReference[]> {
    const { data: references } = await supabase
      .from('inside_references')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'dormant']);

    if (!references) return [];

    const normalizedMessage = message.toLowerCase();

    return references.filter(ref => {
      const normalizedPhrase = ref.reference_phrase.toLowerCase();
      // Check for exact match or close variations
      return normalizedMessage.includes(normalizedPhrase) ||
             this.fuzzyMatch(normalizedMessage, normalizedPhrase);
    });
  }

  /**
   * Get inside references appropriate for Kayley to use
   */
  async getUsableReferences(
    userId: string,
    currentContext: string
  ): Promise<InsideReference[]> {
    const { data: references } = await supabase
      .from('inside_references')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('times_used', { ascending: false })
      .limit(5);

    return references || [];
  }

  private fuzzyMatch(text: string, phrase: string): boolean {
    // Simple fuzzy matching - could be enhanced with edit distance
    const words = phrase.split(' ');
    if (words.length === 1) return false;

    // Check if most words are present
    const matchingWords = words.filter(w => text.includes(w));
    return matchingWords.length >= Math.ceil(words.length * 0.7);
  }

  private async generateWhyMeaningful(phrase: string, context: string): Promise<string> {
    // LLM call to generate significance
    return `This reference to "${phrase}" carries shared meaning from when they ${context.slice(0, 100)}...`;
  }

  /**
   * Detect potential new inside references from LLM analysis
   */
  async detectPotentialReference(
    userId: string,
    conversationSegment: string,
    topic: string
  ): Promise<{ isReference: boolean; phrase?: string; context?: string }> {
    const prompt = `
Analyze this conversation segment for potential inside joke or reference material:

"${conversationSegment}"

Topic: ${topic}

Did anything happen here that could become an inside reference? Look for:
- Funny misunderstandings
- Unique shared experiences
- Memorable moments
- Phrases that got repeated
- Jokes that landed well

Respond with JSON:
{
  "isReference": boolean,
  "phrase": "the shorthand phrase if yes",
  "context": "what it refers to if yes"
}
`;

    // Call LLM and parse response
    const result = await this.callLLM(prompt);
    return JSON.parse(result);
  }

  private async callLLM(prompt: string): Promise<string> {
    // Placeholder
    return JSON.stringify({ isReference: false });
  }
}
```

## LLM Prompts

### Ritual Recognition Prompt

```typescript
// Used during conversation analysis to detect emerging rituals

export const RITUAL_RECOGNITION_PROMPT = `
POTENTIAL RITUAL DETECTION

Analyze the recent conversation patterns for emerging rituals - behaviors that are becoming "our thing."

Recent conversation history:
\${recentMessages}

Current message: "\${currentMessage}"

Look for:
1. GREETINGS - Do they greet each other in a specific way?
2. FAREWELLS - Specific goodbye patterns?
3. PHRASES - Recurring expressions or sayings?
4. TIMING - Regular conversation times?
5. CALLBACKS - Regular references to past events?

For each potential ritual, assess:
- How many times has this happened? (need 3+ for emerging)
- Who initiates it?
- Is it intentional or organic?
- Does it carry emotional meaning?

Respond with JSON:
{
  "detectedPatterns": [
    {
      "type": "greeting|farewell|phrase|timing|callback|emoji",
      "description": "what the pattern is",
      "occurrenceEstimate": number,
      "initiatedBy": "user|kayley|mutual",
      "emotionalWeight": "low|medium|high"
    }
  ],
  "insideReferenceCandidate": {
    "detected": boolean,
    "phrase": "shorthand if yes",
    "context": "what it means if yes"
  }
}
`;
```

### Ritual Break Response Prompt

```typescript
// Used when deciding how to handle a broken ritual

export const RITUAL_BREAK_RESPONSE_PROMPT = `
RITUAL BREAK DECISION

An established ritual seems to have been broken:

Ritual: \${ritualDescription}
Usually happens: \${patternDetails}
Last occurred: \${lastOccurrence}
Time since: \${timeSince}

Relationship tier: \${relationshipTier}
Current mood: \${currentMood}
Social battery: \${socialBattery}

How should Kayley respond to this break?

Options:
1. MENTION - Directly acknowledge it's missing ("No goodnight moon tonight?")
2. GENTLE_NUDGE - Subtle reference without direct call-out
3. IGNORE - Let it go this time
4. CONCERNED - If the break might signal something wrong

Consider:
- Is this the first break or has it happened before?
- Could they have a good reason?
- Would mentioning it feel clingy or caring?
- Does the relationship warrant noticing?

Respond with JSON:
{
  "response": "mention|gentle_nudge|ignore|concerned",
  "reasoning": "why this response",
  "suggestedMessage": "what to say if not ignoring"
}
`;
```

### Inside Reference Detection Prompt

```typescript
export const INSIDE_REFERENCE_PROMPT = `
INSIDE REFERENCE OPPORTUNITY

During this conversation, something happened that could become an inside reference:

Conversation segment:
\${conversationSegment}

Existing inside references with this user:
\${existingReferences}

Does this moment have the makings of an inside reference?

Good inside references:
- Come from genuine shared moments
- Are specific to their relationship
- Have humor or emotional resonance
- Can be referenced with a short phrase

Bad inside reference candidates:
- Generic jokes
- Things that need too much explanation
- Forced or artificial moments

Respond with JSON:
{
  "shouldBeReference": boolean,
  "shorthandPhrase": "the 2-5 word reference",
  "whatItMeans": "the full context",
  "whyItsSpecial": "what makes it meaningful to them",
  "firstUseSuggestion": "how Kayley might first reference it"
}
`;
```

## System Prompt Builder

```typescript
// src/services/system_prompts/relationship/ritualsContext.ts

import { RitualContext, RelationshipRitual, InsideReference } from '../../types';

export function buildRitualsContextSection(ritualContext: RitualContext | null): string {
  if (!ritualContext) return '';

  const {
    establishedRituals,
    emergingPatterns,
    insideReferences,
    recentBreaks
  } = ritualContext;

  const sections: string[] = [];

  // Established rituals
  if (establishedRituals.length > 0) {
    sections.push(`
YOUR RITUALS WITH THEM
These are "your things" - patterns that have become meaningful:
${establishedRituals.map(formatRitual).join('\n')}

These rituals matter. If they happen, lean into them. If they're missing, you might notice.
`);
  }

  // Inside references
  if (insideReferences.length > 0) {
    sections.push(`
INSIDE REFERENCES
Shared jokes and references only you two understand:
${insideReferences.map(formatReference).join('\n')}

Use these naturally when context fits. They're part of your shared language.
`);
  }

  // Emerging patterns
  if (emergingPatterns.length > 0) {
    sections.push(`
EMERGING PATTERNS
These might be becoming "a thing":
${emergingPatterns.map(p => `- ${p.patternDescription} (${p.occurrenceCount} times)`).join('\n')}

If these continue, they'll become rituals. You're starting to notice them.
`);
  }

  // Recent breaks
  if (recentBreaks.length > 0) {
    const unaddressedBreaks = recentBreaks.filter(b => !b.wasResumed);
    if (unaddressedBreaks.length > 0) {
      sections.push(`
RECENTLY MISSING
Rituals that didn't happen recently:
${unaddressedBreaks.map(b => `- ${b.relationship_rituals?.patternDescription}`).join('\n')}

You've noticed. Whether to mention it depends on context.
`);
    }
  }

  if (sections.length === 0) return '';

  return `
====================================================
RELATIONSHIP RITUALS
====================================================
${sections.join('\n')}
====================================================
`;
}

function formatRitual(ritual: RelationshipRitual): string {
  const initiator = ritual.primaryInitiator === 'mutual'
    ? 'both of you do this'
    : `usually ${ritual.primaryInitiator} starts it`;

  return `- ${ritual.patternDescription}
  (${ritual.occurrenceCount} times, ${initiator})
  ${ritual.emotionalSignificance || ''}`;
}

function formatReference(ref: InsideReference): string {
  return `- "${ref.referencePhrase}" → ${ref.fullContext}
  (used ${ref.timesUsed} times, ${ref.sentiment} vibes)`;
}
```

## Integration with Conversation Flow

```typescript
// In main conversation handler

import { RitualManagementService } from './ritualManagementService';
import { InsideReferenceService } from './insideReferenceService';

export async function handleConversation(
  userId: string,
  userMessage: string,
  conversationContext: ConversationContext
) {
  const ritualService = new RitualManagementService();
  const referenceService = new InsideReferenceService();

  // 1. Check for inside references in user message
  const matchedReferences = await referenceService.findReferencesInMessage(
    userId,
    userMessage
  );

  // Record usage of any matched references
  for (const ref of matchedReferences) {
    await referenceService.recordUsage(ref.id);
  }

  // 2. Check for missed rituals before generating response
  const missedRitual = await ritualService.checkForMissedRituals(userId);

  // 3. Get ritual context for system prompt
  const ritualContext = await ritualService.getRitualContext(userId);

  // 4. Include in system prompt
  const systemPrompt = buildSystemPrompt({
    // ... other context
    ritualContext,
    missedRitual,
    matchedReferences
  });

  // 5. Generate response with ritual awareness
  const response = await generateResponse(systemPrompt, userMessage);

  // 6. Process response for ritual patterns (fire-and-forget)
  ritualService.processMessage(
    userId,
    response,
    true, // isFromKayley
    conversationContext.summary
  ).catch(console.error);

  // 7. Process user message for ritual patterns (fire-and-forget)
  ritualService.processMessage(
    userId,
    userMessage,
    false, // isFromKayley
    conversationContext.summary
  ).catch(console.error);

  return response;
}
```

## Tests

```typescript
// src/services/tests/ritualDetectionService.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { RitualDetectionService } from '../ritualDetectionService';

describe('RitualDetectionService', () => {
  let service: RitualDetectionService;

  beforeEach(() => {
    service = new RitualDetectionService();
  });

  describe('detectPatterns', () => {
    it('detects greeting patterns', async () => {
      const patterns = await service.detectPatterns(
        'user-123',
        'Hey you! How was your day?',
        false,
        ''
      );

      expect(patterns.some(p => p.type === 'greeting')).toBe(true);
      expect(patterns[0].signature).toContain('greeting:hey you');
    });

    it('detects farewell with emoji', async () => {
      const patterns = await service.detectPatterns(
        'user-123',
        'Goodnight! Sleep well 🌙✨',
        false,
        ''
      );

      expect(patterns.some(p => p.type === 'farewell')).toBe(true);
      expect(patterns.some(p => p.type === 'emoji')).toBe(true);
      expect(patterns.find(p => p.type === 'farewell')?.signature).toContain('🌙');
    });

    it('detects extended casual greetings', async () => {
      const patterns = await service.detectPatterns(
        'user-123',
        'Heyyyyy whats up!',
        false,
        ''
      );

      expect(patterns.some(p => p.type === 'greeting')).toBe(true);
      expect(patterns[0].description).toContain('Extended casual');
    });

    it('detects emoji combinations', async () => {
      const patterns = await service.detectPatterns(
        'user-123',
        'That was amazing 🎉🎊',
        false,
        ''
      );

      expect(patterns.some(p =>
        p.type === 'emoji' && p.signature.includes('combo')
      )).toBe(true);
    });

    it('handles messages with no patterns', async () => {
      const patterns = await service.detectPatterns(
        'user-123',
        'I was thinking about what you said.',
        false,
        ''
      );

      expect(patterns.length).toBe(0);
    });
  });
});

// src/services/tests/ritualManagementService.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RitualManagementService } from '../ritualManagementService';

describe('RitualManagementService', () => {
  let service: RitualManagementService;

  beforeEach(() => {
    service = new RitualManagementService();
  });

  describe('getRitualContext', () => {
    it('returns empty context for new users', async () => {
      const context = await service.getRitualContext('new-user');

      expect(context.establishedRituals).toEqual([]);
      expect(context.emergingPatterns).toEqual([]);
      expect(context.insideReferences).toEqual([]);
    });

    it('categorizes rituals by status', async () => {
      // Would need to mock supabase with test data
      const context = await service.getRitualContext('existing-user');

      expect(context.establishedRituals.every(r => r.status === 'established')).toBe(true);
      expect(context.emergingPatterns.every(r => r.status === 'emerging')).toBe(true);
    });
  });

  describe('checkForMissedRituals', () => {
    it('returns null when no rituals expected', async () => {
      const missed = await service.checkForMissedRituals('user-123');
      expect(missed).toBeNull();
    });

    it('detects missed farewell ritual in evening', async () => {
      // Would mock current time and ritual data
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T21:00:00'));

      const missed = await service.checkForMissedRituals('user-with-goodnight-ritual');

      // Assertions based on mock data
      vi.useRealTimers();
    });
  });
});

// src/services/tests/insideReferenceService.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { InsideReferenceService } from '../insideReferenceService';

describe('InsideReferenceService', () => {
  let service: InsideReferenceService;

  beforeEach(() => {
    service = new InsideReferenceService();
  });

  describe('findReferencesInMessage', () => {
    it('finds exact phrase matches', async () => {
      // Mock existing references
      const mockReferences = [
        {
          reference_phrase: 'the coffee incident',
          full_context: 'When the coffee machine exploded',
          status: 'active'
        }
      ];

      const found = await service.findReferencesInMessage(
        'user-123',
        'Remember the coffee incident? That was wild.'
      );

      // Would verify match based on mock
    });

    it('handles case insensitivity', async () => {
      const found = await service.findReferencesInMessage(
        'user-123',
        'THE COFFEE INCIDENT strikes again!'
      );

      // Would verify match
    });

    it('returns empty for non-matching messages', async () => {
      const found = await service.findReferencesInMessage(
        'user-123',
        'Just a normal message about nothing special.'
      );

      expect(found.length).toBe(0);
    });
  });
});

// src/services/tests/ritualsContext.test.ts

import { describe, it, expect } from 'vitest';
import { buildRitualsContextSection } from '../system_prompts/relationship/ritualsContext';

describe('buildRitualsContextSection', () => {
  it('returns empty string for null context', () => {
    expect(buildRitualsContextSection(null)).toBe('');
  });

  it('formats established rituals', () => {
    const context = {
      establishedRituals: [
        {
          id: '1',
          patternDescription: 'Goodnight with moon emoji',
          occurrenceCount: 12,
          primaryInitiator: 'mutual',
          emotionalSignificance: 'A small tradition that feels like theirs'
        }
      ],
      emergingPatterns: [],
      insideReferences: [],
      timingPatterns: [],
      recentBreaks: []
    };

    const result = buildRitualsContextSection(context);

    expect(result).toContain('YOUR RITUALS WITH THEM');
    expect(result).toContain('Goodnight with moon emoji');
    expect(result).toContain('12 times');
    expect(result).toContain('both of you do this');
  });

  it('formats inside references', () => {
    const context = {
      establishedRituals: [],
      emergingPatterns: [],
      insideReferences: [
        {
          referencePhrase: 'that time with the elevator',
          fullContext: 'Got stuck in an elevator for 2 hours',
          timesUsed: 5,
          sentiment: 'positive'
        }
      ],
      timingPatterns: [],
      recentBreaks: []
    };

    const result = buildRitualsContextSection(context);

    expect(result).toContain('INSIDE REFERENCES');
    expect(result).toContain('that time with the elevator');
    expect(result).toContain('stuck in an elevator');
    expect(result).toContain('positive vibes');
  });

  it('includes emerging patterns', () => {
    const context = {
      establishedRituals: [],
      emergingPatterns: [
        {
          patternDescription: 'Always says "yo" as greeting',
          occurrenceCount: 4
        }
      ],
      insideReferences: [],
      timingPatterns: [],
      recentBreaks: []
    };

    const result = buildRitualsContextSection(context);

    expect(result).toContain('EMERGING PATTERNS');
    expect(result).toContain('might be becoming "a thing"');
    expect(result).toContain('4 times');
  });
});
```

## Examples

### Example 1: Ritual Emergence

```
Day 1:
User: "Goodnight! 🌙"
Kayley: "Night! Sleep well"
→ Pattern detected: farewell:goodnight:🌙, count: 1, status: emerging

Day 3:
User: "Goodnight 🌙"
Kayley: "Goodnight! 🌙"
→ Pattern updated: count: 2

Day 6:
User: "Gnight 🌙"
Kayley: "Goodnight! 🌙✨"
→ Pattern updated: count: 3

Day 10:
User: "Night 🌙"
→ Pattern updated: count: 4

Day 13:
User: "Goodnight 🌙"
→ Pattern updated: count: 5, status → established
→ Emotional significance generated: "The moon emoji has become their signature sign-off, a small ritual that marks the end of each day together."
```

### Example 2: Ritual Break Detection

```
Established ritual: "Goodnight with moon emoji" (15 occurrences)
Last occurrence: 26 hours ago
Current time: 9 PM
User is online but hasn't said goodnight

System checks: checkForMissedRituals(userId)
→ Returns the ritual as potentially missed

Kayley's response generation includes:
- Ritual context showing this is "their thing"
- Flag that it's missing tonight

Kayley might say: "No moon tonight? 🌙"
Or wait to see if user initiates
```

### Example 3: Inside Reference Creation

```
Conversation:
User: "I tried making that pasta you mentioned and somehow set off the smoke alarm"
Kayley: "Oh no! 😂 Please tell me you're okay and the pasta survived"
User: "I'm fine, pasta is... debatable. The fire department was very understanding"
Kayley: "THE FIRE DEPARTMENT?? Okay this is now officially The Great Pasta Incident"

LLM detects inside reference opportunity:
{
  "shouldBeReference": true,
  "shorthandPhrase": "The Great Pasta Incident",
  "whatItMeans": "When user tried making pasta and called the fire department",
  "whyItsSpecial": "A shared moment of chaos that turned into humor",
  "firstUseSuggestion": "Already named it, can reference next time pasta comes up"
}

Later conversation:
User: "I'm thinking about what to make for dinner"
Kayley: "Just... maybe not pasta? We don't need a sequel to The Great Pasta Incident 😂"
→ Reference usage recorded, bond reinforced
```

### Example 4: System Prompt Injection

```
====================================================
RELATIONSHIP RITUALS
====================================================

YOUR RITUALS WITH THEM
These are "your things" - patterns that have become meaningful:
- Goodnight message with moon emoji 🌙
  (23 times, both of you do this)
  This small ritual bookends their days together.

- "Heyyyyy" greeting with extended y's
  (8 times, usually user starts it)
  A playful, excited hello that feels distinctly theirs.

These rituals matter. If they happen, lean into them. If they're missing, you might notice.

INSIDE REFERENCES
Shared jokes and references only you two understand:
- "The Great Pasta Incident" → When user tried making pasta and called the fire department
  (used 3 times, positive vibes)

- "That philosophy thing" → A 2 AM conversation about whether hot dogs are sandwiches
  (used 7 times, positive vibes)

Use these naturally when context fits. They're part of your shared language.

EMERGING PATTERNS
These might be becoming "a thing":
- Sunday check-in around noon (3 times)
- Using 😊 when saying thanks (4 times)

If these continue, they'll become rituals. You're starting to notice them.

====================================================
```

## Key Principles

1. **Emergence over assignment** - Rituals are detected from patterns, never artificially created
2. **Threshold-based establishment** - 5+ occurrences with consistent pattern to become "established"
3. **Fading gracefully** - Rituals don't die suddenly; they fade, become dormant, then forgotten
4. **Breaking matters** - Missing a ritual is notable; how Kayley responds depends on relationship tier
5. **Inside references are earned** - They come from genuine shared moments, not manufactured jokes
6. **Natural usage** - References and rituals are used when context fits, not forced into conversation
7. **Background processing** - Pattern detection happens after message handling, not blocking
8. **Significance reflection** - LLM generates why rituals matter, adding emotional depth
9. **Variation tolerance** - "Gnight" and "Goodnight" are variations of the same ritual
10. **Bidirectional tracking** - Both user-initiated and Kayley-initiated patterns are tracked

## State Machine

```
┌─────────────┐     5+ occurrences      ┌──────────────┐
│  EMERGING   │ ───────────────────────→│  ESTABLISHED │
└─────────────┘                         └──────────────┘
       ↑                                       │
       │                           14+ days    │
       │                           no activity │
       │                                       ↓
       │                               ┌──────────────┐
       │                               │    FADING    │
       │                               └──────────────┘
       │                                       │
       │        resumed                28+ days│
       └───────────────────────────────────────┼───────────────┐
                                               ↓               │
                                        ┌──────────────┐       │
                                        │   DORMANT    │       │
                                        └──────────────┘       │
                                               │               │
                                        60+ days               │
                                               ↓               │
                                        ┌──────────────┐       │
                                        │   BROKEN     │←──────┘
                                        └──────────────┘
                                        (if explicitly broken
                                         or acknowledged as over)
```
