// src/services/messageAnalyzer.ts
/**
 * Message Analyzer Service
 *
 * Central integration point for analyzing user messages after each interaction.
 * This service wires together all the "magic" systems:
 * - User Patterns (cross-session behavior tracking)
 * - Relationship Milestones (key moment detection)
 * - Mood Knobs (emotional momentum)
 *
 * Move 37: Simplified to keyword-only detection.
 * - LLM-based intent detection removed (saves ~10K tokens/message)
 * - Open loop creation now handled by create_open_loop tool
 * - Contradiction handling now in prompt guidance
 * - Main LLM reads messages directly
 */

import { boostSalienceForMentionedTopics, type OpenLoop } from './presenceDirector';
import * as relationshipService from './relationshipService';
import { analyzeMessageForPatterns, detectTopics } from './userPatterns';
import { detectMilestoneInMessage } from './relationshipMilestones';
import { maybeGenerateNewFeeling } from './almostMomentsService';
import { recordInteractionAsync } from './moodKnobs';
import type {
  ToneIntent,
  TopicIntent,
  TopicCategory,
  OpenLoopIntent,
  RelationshipSignalIntent,
  GenuineMomentCategory,
} from "./intentService";
import type { UserPattern } from './userPatterns';
import type { RelationshipMilestone } from './relationshipMilestones';

// ============================================
// Types
// ============================================

export interface MessageAnalysisResult {
  /** Open loops created from this message */
  createdLoops: OpenLoop[];
  /** Patterns detected/updated from this message */
  detectedPatterns: UserPattern[];
  /** Milestone recorded from this message (if any) */
  recordedMilestone: RelationshipMilestone | null;
  /** Whether a genuine moment was detected */
  wasGenuineMoment: boolean;
  /** Sentiment/tone of the message (-1 to 1) */
  messageTone: number;
  /** Full tone analysis result from LLM (Phase 2) */
  toneResult?: ToneIntent;
  /** Full topic analysis result from LLM (Phase 4) */
  topicResult?: TopicIntent;
  /** Full open loop analysis result from LLM (Phase 5) */
  openLoopResult?: OpenLoopIntent;
  /** Full relationship signal analysis (Phase 6) */
  relationshipSignalResult?: RelationshipSignalIntent;
}

// Re-export types for consumers
export type {
  ToneIntent,
  TopicIntent,
  TopicCategory,
  OpenLoopIntent,
  RelationshipSignalIntent
};

// ============================================
// Simple Tone Analysis
// ============================================

const POSITIVE_INDICATORS = [
  'happy', 'great', 'amazing', 'wonderful', 'love', 'excited', 'good',
  'awesome', 'fantastic', 'thanks', 'thank you', 'appreciate', 'nice',
  'haha', 'lol', 'lmao', '😊', '😄', '❤️', '🥰', '😂', '🤗'
];

const NEGATIVE_INDICATORS = [
  'sad', 'upset', 'angry', 'frustrated', 'stressed', 'anxious', 'worried',
  'hate', 'terrible', 'awful', 'horrible', 'bad', 'depressed', 'lonely',
  'ugh', 'sigh', '😢', '😭', '😤', '😡', '😞', '💔'
];

/**
 * Simple keyword-based tone analysis for a message.
 * Returns a value from -1 (very negative) to 1 (very positive).
 * This is the fallback function when LLM detection fails.
 */
function analyzeMessageToneKeywords(message: string): number {
  const lowerMessage = message.toLowerCase();
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  for (const indicator of POSITIVE_INDICATORS) {
    if (lowerMessage.includes(indicator)) {
      positiveCount++;
    }
  }
  
  for (const indicator of NEGATIVE_INDICATORS) {
    if (lowerMessage.includes(indicator)) {
      negativeCount++;
    }
  }
  
  const total = positiveCount + negativeCount;
  if (total === 0) return 0; // Neutral
  
  // Calculate tone: positive pulls toward 1, negative toward -1
  const tone = (positiveCount - negativeCount) / total;
  
  // Clamp and scale for reasonable range
  return Math.max(-1, Math.min(1, tone));
}

/**
 * Legacy function name for backward compatibility.
 * Calls the keyword-based tone analysis.
 */
function analyzeMessageTone(message: string): number {
  return analyzeMessageToneKeywords(message);
}



/**
 * Analyze a user message for patterns and milestones.
 *
 * Move 37: Simplified to keyword-only detection.
 * - No LLM calls - uses fast keyword/regex detection
 * - Open loop creation now handled by create_open_loop tool
 * - Contradiction handling now in prompt guidance
 *
 * @param message - The user's message text
 * @param interactionCount - Total number of interactions with this user
 * @returns Analysis results including detected patterns and milestones
 */
export async function analyzeUserMessage(
  message: string,
  interactionCount: number = 0
): Promise<MessageAnalysisResult> {
  // Skip very short messages
  if (message.length < 5) {
    return {
      createdLoops: [],
      detectedPatterns: [],
      recordedMilestone: null,
      wasGenuineMoment: false,
      messageTone: 0,
    };
  }

  // ============================================
  // Move 37: Keyword-Only Detection (Fast Path)
  // ============================================
  // No LLM calls - just fast keyword/regex detection.
  // Main LLM now reads messages directly and decides on follow-ups.

  // Run keyword detection (fast, no network calls)
  const keywordTone = analyzeMessageToneKeywords(message);
  const keywordTopics = detectTopics(message);

  // Build intent results from keywords
  const toneResult: ToneIntent = {
    sentiment: keywordTone,
    primaryEmotion: keywordTone > 0.3 ? 'happy'
      : keywordTone < -0.3 ? 'sad'
      : 'neutral',
    intensity: Math.abs(keywordTone),
    isSarcastic: false // Keyword detection can't detect sarcasm
  };

  const topicResult: TopicIntent = {
    topics: keywordTopics as TopicCategory[],
    primaryTopic: keywordTopics[0] as TopicCategory || null,
    emotionalContext: {},
    entities: []
  };

  // Open loops: No automatic creation - handled by create_open_loop tool
  const openLoopResult: OpenLoopIntent = {
    hasFollowUp: false,
    loopType: null,
    topic: null,
    suggestedFollowUp: null,
    timeframe: null,
    salience: 0
  };

  // Relationship signals: Basic keyword detection
  const relationshipSignalResult: RelationshipSignalIntent = {
    isVulnerable: false,
    isSeekingSupport: false,
    isAcknowledgingSupport: false,
    isJoking: false,
    isDeepTalk: false,
    milestone: null,
    milestoneConfidence: 0,
    isHostile: false,
    hostilityReason: null,
    isInappropriate: false,
    inappropriatenessReason: null
  };

  // Genuine moment: Basic keyword detection (rare events)
  const genuineMomentResult = {
    isGenuine: false,
    category: null as GenuineMomentCategory | null,
    matchedKeywords: [] as string[]
  };

  // ============================================
  // Boost salience for mentioned topics
  // ============================================
  if (topicResult.topics.length > 0) {
    const mentionedTopics = [
      ...topicResult.topics,
      ...(topicResult.entities || [])
    ];

    // Extract key nouns from message for better matching
    const messageWords = message.toLowerCase().split(/\s+/);
    const contextualTopics = messageWords.filter(word =>
      word.length > 3 && !['just', 'back', 'from', 'have', 'been', 'this', 'that', 'with'].includes(word)
    );

    const allTopics = [...new Set([...mentionedTopics, ...contextualTopics])];

    const boostedCount = await boostSalienceForMentionedTopics(message, allTopics);
    if (boostedCount > 0) {
      console.log(`📈 [MessageAnalyzer] Boosted salience for ${boostedCount} loop(s) based on message topics`);
    }
  }

  // ============================================
  // Background Updates (Parallelized)
  // ============================================
  const relationship = await relationshipService
    .getRelationship()
    .catch(() => null);

  // Move 37: detectOpenLoops removed - now handled by create_open_loop tool
  const [recordedMilestone, detectedPatterns] = await Promise.all([
    // Milestone detection (keyword-based)
    detectMilestoneInMessage(message, interactionCount),

    // Cross-session patterns
    analyzeMessageForPatterns(message, new Date(), toneResult, topicResult),

    // Emotional momentum update
    recordInteractionAsync(
      toneResult,
      message,
      {
        isGenuine: genuineMomentResult.isGenuine,
        category: genuineMomentResult.category as any,
        matchedKeywords: genuineMomentResult.matchedKeywords,
        isPositiveAffirmation: true
      }
    ),

    // Probabilistic intimacy / stats
    relationshipService.recordMessageQualityAsync(message),

    // Almost Moments: Generate new unsaid feelings (rare)
    relationship
      ? maybeGenerateNewFeeling(
        relationship.warmthScore,
        relationship.trustScore,
        relationship.relationshipTier
      )
      : Promise.resolve()
  ]) as [RelationshipMilestone | null, UserPattern[], void, void, void];

  // Use keyword sentiment for message tone
  const messageTone = toneResult.sentiment;

  // Log what was detected
  if (detectedPatterns.length > 0) {
    console.log(`📊 [MessageAnalyzer] Detected ${detectedPatterns.length} pattern(s)`);
  }
  if (recordedMilestone) {
    console.log(`🏆 [MessageAnalyzer] Recorded milestone: ${recordedMilestone.milestoneType}`);
  }
  if (topicResult.topics.length > 0) {
    console.log(`📋 [MessageAnalyzer] Topics detected: ${topicResult.topics.join(', ')}`);
  }

  return {
    createdLoops: [], // Move 37: No automatic loop creation - handled by tool
    detectedPatterns,
    recordedMilestone,
    wasGenuineMoment: genuineMomentResult.isGenuine,
    messageTone,
    toneResult,
    topicResult,
    openLoopResult,
    relationshipSignalResult
  };
}

/**
 * Lightweight version for quick integration - doesn't wait for results.
 * Use this in the chat flow to avoid adding latency.
 *
 * @param message - The user's message text
 * @param interactionCount - Total number of interactions with this user
 */
export function analyzeUserMessageBackground(
  message: string,
  interactionCount: number
): void {
  // Fire and forget - don't await this in the main thread
  analyzeUserMessage(message, interactionCount).catch(err => {
    console.error('❌ [MessageAnalyzer] Background analysis failed:', err);
  });
}

export default {
  analyzeUserMessage,
  analyzeUserMessageBackground,
  analyzeMessageTone,
  analyzeMessageToneKeywords
};
