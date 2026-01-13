// src/services/messageAnalyzer.ts
/**
 * Message Analyzer Service
 * 
 * Central integration point for analyzing user messages after each interaction.
 * This service wires together all the "magic" systems:
 * - Presence Director (open loops)
 * - User Patterns (cross-session behavior tracking)
 * - Relationship Milestones (key moment detection)
 * - Mood Knobs (emotional momentum)
 * 
 * Key principle: Call this AFTER each user message to enable
 * proactive behaviors and pattern recognition.
 * 
 * Semantic Intent Detection:
 * Now uses LLM-based genuine moment detection with conversation context.
 * 
 * Semantic Intent Detection:
 * Now uses LLM-based tone & sentiment detection with sarcasm handling.
 * 
 * Semantic Intent Detection:
 * Now uses LLM-based open loop detection with timeframe inference.
 * 
 * Semantic Intent Detection:
 * Now uses LLM-based relationship signal detection (milestones, ruptures).
 */

import { 
  detectOpenLoops, 
  dismissLoopsByTopic,
  boostSalienceForMentionedTopics
} from './presenceDirector';
import * as relationshipService from './relationshipService';
import { analyzeMessageForPatterns, detectTopics } from './userPatterns';
import { detectMilestoneInMessage } from './relationshipMilestones';
import { maybeGenerateNewFeeling } from './almostMomentsService';
import { 
  recordInteractionAsync,
  type ConversationContext
} from './moodKnobs';
import {
  detectFullIntentLLMCached,
  type ToneIntent,
  type PrimaryEmotion,
  type TopicIntent,
  type TopicCategory,
  type OpenLoopIntent,
  type LoopTypeIntent,
  type FollowUpTimeframe,
  type RelationshipSignalIntent,
  type FullMessageIntent,
  type GenuineMomentCategory,
} from "./intentService";
import type { OpenLoop } from './presenceDirector';
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
  PrimaryEmotion, 
  ConversationContext, 
  TopicIntent, 
  TopicCategory, 
  OpenLoopIntent, 
  LoopTypeIntent, 
  FollowUpTimeframe,
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
 * Analyze a user message for patterns, loops, and milestones.
 * 
 * Call this after each user message to enable the proactive memory systems.
 * This is the main integration point that wires together all Phase 1-5 features.
 * 
 * Phase 1 Semantic Intent Detection:
 * Now uses LLM-based detection with conversation context for accurate tone
 * interpretation (e.g., "You suck!!" after good news is playful, not hostile).
 * 
 * @param message - The user's message text
 * @param interactionCount - Total number of interactions with this user
 * @param llmCall - Optional LLM function for advanced loop detection
 * @param conversationContext - Optional recent chat history for LLM context
 * @returns Analysis results including any detected patterns/loops/milestones
 */
export async function analyzeUserMessage(
  message: string,
  interactionCount: number = 0,
  llmCall?: (prompt: string) => Promise<string>,
  conversationContext?: ConversationContext,
  preCalculatedIntent?: FullMessageIntent
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
  // PERF: Unified Intent Detection (Phase 7)
  // ============================================
  // Replaces 5 separate LLM calls with 1 master call.
  // Falls back to keyword detection ONLY if the master call fails.
  
  // Initialize with null/empty defaults
  let genuineMomentResult: { isGenuine: boolean; category: GenuineMomentCategory | null; matchedKeywords: string[] } = { 
    isGenuine: false, 
    category: null, 
    matchedKeywords: [] 
  };
  let toneResult: ToneIntent | null = null;
  let topicResult: TopicIntent | null = null;
  let openLoopResult: OpenLoopIntent | null = null;
  let relationshipSignalResult: RelationshipSignalIntent | null = null;
  
  let fullIntent: FullMessageIntent | null = null;
  
  try {
    // 1. The Single Source of Truth
    // Use pre-calculated intent if provided (optimization from GeminiChatService)
    fullIntent = preCalculatedIntent || await detectFullIntentLLMCached(message, conversationContext);
    
    // 2. Distribute results
    // Map Genuine Moment from Intent (minimal) to Result (richer)
    if (fullIntent.genuineMoment.isGenuine) {
       genuineMomentResult = {
        isGenuine: true,
        category: fullIntent.genuineMoment.category,
        matchedKeywords: ['LLM Unified Detection']
      };
    }
    
    toneResult = fullIntent.tone;
    topicResult = fullIntent.topics;
    openLoopResult = fullIntent.openLoops;
    relationshipSignalResult = fullIntent.relationshipSignals;
    
  } catch (error) {
    console.warn('⚠️ [MessageAnalyzer] Unified intent detection failed, falling back to keyword detection (no LLM calls):', error);
    
    // 3. FALLBACK: Use keyword/regex functions directly (per DetectFullIntent.md design)
    // CRITICAL: Do NOT fallback to individual LLM calls - that would cause 2s+ latency spikes.
    // Instead, use fast keyword/regex detection to keep the chat responsive.
    
    // Run keyword detection synchronously (fast, no network calls)
    const keywordTone = analyzeMessageToneKeywords(message);
    const keywordTopics = detectTopics(message);
    
    // Convert keyword results to intent format
    genuineMomentResult = {
      isGenuine: false,
      category: null,
      matchedKeywords: []
    };
    
    toneResult = {
      sentiment: keywordTone,
      primaryEmotion: keywordTone > 0.3 ? 'happy' 
                  : keywordTone < -0.3 ? 'sad' 
                  : 'neutral',
      intensity: Math.abs(keywordTone),
      isSarcastic: false // Keyword detection can't detect sarcasm
    };
    
    topicResult = {
      topics: keywordTopics as TopicCategory[],
      primaryTopic: keywordTopics[0] as TopicCategory || null,
      emotionalContext: {}, // Keywords can't detect emotional context
      entities: []
    };
    
    // Open loops and relationship signals: return safe defaults
    // (Regex patterns are internal to presenceDirector/relationshipMilestones)
    openLoopResult = {
      hasFollowUp: false,
      loopType: null,
      topic: null,
      suggestedFollowUp: null,
      timeframe: null,
      salience: 0
    };
    
    relationshipSignalResult = {
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
  }
  
  // Ensure we have valid objects (TypeScript safety)
  // Note: These should never be null given our fallback logic above, but TypeScript requires checks.
  // If somehow they are null, we use keyword fallback (no LLM calls) to maintain responsiveness.
  if (!toneResult) {
    console.warn('⚠️ [MessageAnalyzer] toneResult was null, using keyword fallback');
    const keywordTone = analyzeMessageToneKeywords(message);
    toneResult = {
      sentiment: keywordTone,
      primaryEmotion: keywordTone > 0.3 ? 'happy' : keywordTone < -0.3 ? 'sad' : 'neutral',
      intensity: Math.abs(keywordTone),
      isSarcastic: false
    };
  }
  if (!topicResult) {
    console.warn('⚠️ [MessageAnalyzer] topicResult was null, using keyword fallback');
    const keywordTopics = detectTopics(message);
    topicResult = {
      topics: keywordTopics as TopicCategory[],
      primaryTopic: keywordTopics[0] as TopicCategory || null,
      emotionalContext: {},
      entities: []
    };
  }
  if (!openLoopResult) {
    console.warn('⚠️ [MessageAnalyzer] openLoopResult was null, using safe default');
    openLoopResult = {
      hasFollowUp: false,
      loopType: null,
      topic: null,
      suggestedFollowUp: null,
      timeframe: null,
      salience: 0
    };
  }
  if (!relationshipSignalResult) {
    console.warn('⚠️ [MessageAnalyzer] relationshipSignalResult was null, using safe default');
    relationshipSignalResult = {
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
  }

  // ============================================
  // FIX #2: Handle Contradictions BEFORE creating new loops
  // ============================================
  // If user is contradicting something, dismiss related loops first
  // Use fullIntent if available (from either pre-calculated or just calculated)
  const intentToCheck = fullIntent || preCalculatedIntent;
  if (intentToCheck?.contradiction?.isContradicting && 
      intentToCheck.contradiction.topic &&
      intentToCheck.contradiction.confidence > 0.6) {
    
    const dismissedCount = await dismissLoopsByTopic(
      intentToCheck.contradiction.topic
    );
    
    if (dismissedCount > 0) {
      console.log(`🚫 [MessageAnalyzer] User contradicted "${intentToCheck.contradiction.topic}" - dismissed ${dismissedCount} loop(s)`);
    }
  }

  // ============================================
  // FIX #4: Boost salience for mentioned topics
  // ============================================
  // If user mentions topics related to existing loops, boost their salience
  // This helps recent mentions compete with older high-salience items
  if (topicResult.topics.length > 0) {
    // Extract topic strings and entities for matching
    const mentionedTopics = [
      ...topicResult.topics,
      ...(topicResult.entities || [])
    ];
    
    // Also extract key nouns from the message for better matching
    const messageWords = message.toLowerCase().split(/\s+/);
    const contextualTopics = messageWords.filter(word => 
      word.length > 3 && !['just', 'back', 'from', 'have', 'been', 'this', 'that', 'with'].includes(word)
    );
    
    const allTopics = [...new Set([...mentionedTopics, ...contextualTopics])];
    
    const boostedCount = await boostSalienceForMentionedTopics(
      message,
      allTopics
    );
    
    if (boostedCount > 0) {
      console.log(`📈 [MessageAnalyzer] Boosted salience for ${boostedCount} loop(s) based on message topics`);
    }
  }

  // ============================================
  // Execution & Side Effects (🚀 Parallelized)
  // ============================================

  const relationship = await relationshipService
    .getRelationship()
    .catch(() => null);

  // Run all background updates in parallel to maximize performance
  const [createdLoops, recordedMilestone, detectedPatterns] = await Promise.all([
    // Create open loops
    detectOpenLoops(
      message, 
      llmCall, 
      conversationContext,
      openLoopResult
    ),
    
    // Milestone detection
    detectMilestoneInMessage(message, interactionCount, relationshipSignalResult),
    
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
  ]) as [OpenLoop[], RelationshipMilestone | null, UserPattern[], void, void, void];
  
  // Use LLM sentiment for message tone
  const messageTone = toneResult.sentiment;
  
  // Log what was detected
  if (createdLoops.length > 0) {
    console.log(`🔄 [MessageAnalyzer] Created ${createdLoops.length} open loop(s)`);
  }
  if (detectedPatterns.length > 0) {
    console.log(`📊 [MessageAnalyzer] Detected ${detectedPatterns.length} pattern(s)`);
  }
  if (recordedMilestone) {
    console.log(`🏆 [MessageAnalyzer] Recorded milestone: ${recordedMilestone.milestoneType}`);
  }
  if (genuineMomentResult.isGenuine) {
    console.log(`💝 [MessageAnalyzer] Genuine moment detected via LLM (${genuineMomentResult.category})`);
  }
  if (toneResult.isSarcastic) {
    console.log(`🎭 [MessageAnalyzer] Sarcasm detected in message`);
  }
  if (topicResult.topics.length > 0) {
    console.log(`📋 [MessageAnalyzer] Topics detected: ${topicResult.topics.join(', ')}`);
  }
  if (relationshipSignalResult.milestone) {
    console.log(`🏆 [MessageAnalyzer] Milestone signal detected: ${relationshipSignalResult.milestone}`);
  }
  if (relationshipSignalResult.isHostile) {
    console.log(`⚠️ [MessageAnalyzer] Hostility detected: ${relationshipSignalResult.hostilityReason}`);
  }

  return {
    createdLoops,
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
 * @param conversationContext - Optional recent chat history for LLM context
 */
export async function analyzeUserMessageBackground(
  message: string,
  interactionCount: number,
  conversationContext?: ConversationContext,
  preCalculatedIntent?: FullMessageIntent
): Promise<void> {
  // Fire and forget - don't await this in the main thread
  analyzeUserMessage(
    message, 
    interactionCount, 
    undefined, 
    conversationContext,
    preCalculatedIntent
  ).catch(err => {
    console.error('❌ [MessageAnalyzer] Background analysis failed:', err);
  });
}

export default {
  analyzeUserMessage,
  analyzeUserMessageBackground,
  analyzeMessageTone,
  analyzeMessageToneKeywords
};
