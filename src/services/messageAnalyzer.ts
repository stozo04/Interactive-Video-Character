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
 * Phase 1 Semantic Intent Detection:
 * Now uses LLM-based genuine moment detection with conversation context.
 * 
 * Phase 2 Semantic Intent Detection:
 * Now uses LLM-based tone & sentiment detection with sarcasm handling.
 * 
 * Phase 5 Semantic Intent Detection:
 * Now uses LLM-based open loop detection with timeframe inference.
 * 
 * Phase 6 Semantic Intent Detection:
 * Now uses LLM-based relationship signal detection (milestones, ruptures).
 */

import { detectOpenLoops } from './presenceDirector';
import * as relationshipService from './relationshipService';
import { analyzeMessageForPatterns, detectTopics } from './userPatterns';
import { detectMilestoneInMessage } from './relationshipMilestones';
import { 
  recordInteractionAsync,
  detectGenuineMomentWithLLM,
  detectGenuineMoment, // Keyword fallback function
  type ConversationContext,
  type GenuineMomentResult
} from './moodKnobs';
import {
  detectToneLLMCached,
  detectTopicsLLMCached,
  detectOpenLoopsLLMCached,
  detectRelationshipSignalsLLMCached,
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
  type GenuineMomentIntent,
  type GenuineMomentCategory
} from './intentService';
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

// ============================================
// LLM-based Tone Detection with Fallback (Phase 2)
// ============================================

/**
 * Detect tone using LLM with fallback to keyword-based analysis.
 * This is the Phase 2 implementation that handles:
 * - Sarcasm detection ("Great, just great" = negative)
 * - Mixed emotions ("excited but also nervous")
 * - Context-dependent tone ("You suck!!" after good news = playful)
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 * @returns Promise resolving to ToneIntent
 */
export async function detectToneWithLLM(
  message: string,
  context?: ConversationContext
): Promise<ToneIntent> {
  try {
    const result = await detectToneLLMCached(message, context);
    return result;
  } catch (error) {
    // LLM failed - fall back to keyword detection
    console.warn('⚠️ [MessageAnalyzer] LLM tone detection failed, falling back to keywords:', error);
    
    const keywordTone = analyzeMessageToneKeywords(message);
    
    // Convert keyword result to ToneIntent format
    return {
      sentiment: keywordTone,
      primaryEmotion: keywordTone > 0.3 ? 'happy' 
                    : keywordTone < -0.3 ? 'sad' 
                    : 'neutral',
      intensity: Math.abs(keywordTone),
      isSarcastic: false // Keyword detection can't detect sarcasm
    };
  }
}

// ============================================
// LLM-based Topic Detection with Fallback (Phase 4)
// ============================================

/**
 * Simple keyword-based topic detection for fallback.
 * Uses the same patterns as TOPIC_CATEGORIES in userPatterns.ts.
 */
const TOPIC_KEYWORDS: Record<TopicCategory, string[]> = {
  work: ['work', 'job', 'boss', 'coworker', 'meeting', 'project', 'deadline', 'office', 'career'],
  family: ['mom', 'dad', 'parent', 'brother', 'sister', 'family', 'grandma', 'grandpa', 'uncle', 'aunt'],
  relationships: ['boyfriend', 'girlfriend', 'partner', 'dating', 'relationship', 'ex', 'crush'],
  health: ['sick', 'doctor', 'health', 'exercise', 'gym', 'sleep', 'therapy', 'medication'],
  money: ['money', 'bills', 'debt', 'rent', 'broke', 'expensive', 'budget', 'paycheck'],
  school: ['school', 'class', 'homework', 'exam', 'test', 'professor', 'college', 'study'],
  hobbies: ['hobby', 'game', 'sport', 'music', 'art', 'book', 'movie', 'show'],
  personal_growth: ['goal', 'habit', 'improve', 'learn', 'grow', 'change', 'better'],
  other: [], // Catch-all, not matched by keywords
};

/**
 * Keyword-based topic detection for fallback.
 * Returns topics found based on keyword matching.
 */
function detectTopicsKeywords(message: string): TopicCategory[] {
  const lowerMessage = message.toLowerCase();
  const foundTopics: TopicCategory[] = [];
  
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(keyword => lowerMessage.includes(keyword))) {
      foundTopics.push(topic as TopicCategory);
    }
  }
  
  return foundTopics;
}

/**
 * Detect topics using LLM with fallback to keyword-based analysis.
 * This is the Phase 4 implementation that handles:
 * - Multiple topics per message ("My boss is stressing about money" = work + money)
 * - Emotional context per topic ("work: frustrated")
 * - Entity extraction ("boss", "deadline")
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 * @returns Promise resolving to TopicIntent
 */
export async function detectTopicsWithLLM(
  message: string,
  context?: ConversationContext
): Promise<TopicIntent> {
  try {
    const result = await detectTopicsLLMCached(message, context);
    return result;
  } catch (error) {
    // LLM failed - fall back to keyword detection
    console.warn('⚠️ [MessageAnalyzer] LLM topic detection failed, falling back to keywords:', error);
    
    const keywordTopics = detectTopicsKeywords(message);
    
    // Convert keyword result to TopicIntent format
    return {
      topics: keywordTopics,
      primaryTopic: keywordTopics.length > 0 ? keywordTopics[0] : null,
      emotionalContext: {}, // Keyword detection can't extract emotional context
      entities: [] // Keyword detection can't extract entities
    };
  }
}

// ============================================
// LLM-based Open Loop Detection with Fallback (Phase 5)
// ============================================

/**
 * Detect open loops using LLM with fallback when LLM fails.
 * This is the Phase 5 implementation that handles:
 * - Explicit events ("I have an interview tomorrow")
 * - Emotional states ("I'm really stressed about the move")
 * - Soft commitments ("Maybe I'll try that new gym")
 * - Timeframe inference ("tomorrow", "this_week", "soon")
 * 
 * Note: This wrapper is primarily for direct access. The actual 
 * integration with presenceDirector already uses detectOpenLoopsLLMCached
 * internally in detectOpenLoops(), which handles creating loops in Supabase.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 * @returns Promise resolving to OpenLoopIntent
 */
export async function detectOpenLoopsWithLLM(
  message: string,
  context?: ConversationContext
): Promise<OpenLoopIntent> {
  try {
    const result = await detectOpenLoopsLLMCached(message, context);
    return result;
  } catch (error) {
    // LLM failed - return no follow-up (regex fallback happens in presenceDirector)
    console.warn('⚠️ [MessageAnalyzer] LLM open loop detection failed:', error);
    
    // Return a safe default - no follow-up detected
    return {
      hasFollowUp: false,
      loopType: null,
      topic: null,
      suggestedFollowUp: null,
      timeframe: null,
      salience: 0
    };
  }
}

// ============================================
// LLM-based Relationship Signal Detection (Phase 6)
// ============================================

/**
 * Detect relationship signals (milestones, ruptures) using LLM.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 * @returns Promise resolving to RelationshipSignalIntent
 */
export async function detectRelationshipSignalsWithLLM(
  message: string,
  context?: ConversationContext
): Promise<RelationshipSignalIntent> {
  try {
    return await detectRelationshipSignalsLLMCached(message, context);
  } catch (error) {
    console.warn('⚠️ [MessageAnalyzer] LLM relationship signal detection failed:', error);
    
    // Return safe default - no signal detected
    return {
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
 * @param userId - The user's ID
 * @param message - The user's message text
 * @param interactionCount - Total number of interactions with this user
 * @param llmCall - Optional LLM function for advanced loop detection
 * @param conversationContext - Optional recent chat history for LLM context
 * @returns Analysis results including any detected patterns/loops/milestones
 */
export async function analyzeUserMessage(
  userId: string,
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
  
  try {
    // 1. The Single Source of Truth
    // Use pre-calculated intent if provided (optimization from BaseAIService)
    const fullIntent = preCalculatedIntent || await detectFullIntentLLMCached(message, conversationContext);
    
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
    const keywordGenuine = detectGenuineMoment(message);
    const keywordTone = analyzeMessageToneKeywords(message);
    const keywordTopics = detectTopics(message);
    
    // Convert keyword results to intent format
    genuineMomentResult = {
      isGenuine: keywordGenuine.isGenuine,
      category: keywordGenuine.category as GenuineMomentCategory | null,
      matchedKeywords: keywordGenuine.matchedKeywords
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
  // Execution & Side Effects (🚀 Parallelized)
  // ============================================

  // Run all background updates in parallel to maximize performance
  const [createdLoops, recordedMilestone, detectedPatterns] = await Promise.all([
    // Phase 5: Create open loops
    detectOpenLoops(
      userId, 
      message, 
      llmCall, 
      conversationContext,
      openLoopResult
    ),
    
    // Phase 6: Milestone detection
    detectMilestoneInMessage(userId, message, interactionCount, relationshipSignalResult),
    
    // Phase 3: Cross-session patterns
    analyzeMessageForPatterns(userId, message, new Date(), toneResult, topicResult),
    
    // Phase 7: Emotional momentum update
    recordInteractionAsync(
      userId,
      toneResult, 
      message,
      {
        isGenuine: genuineMomentResult.isGenuine,
        category: genuineMomentResult.category as any,
        matchedKeywords: genuineMomentResult.matchedKeywords,
        isPositiveAffirmation: true
      }
    ),

    // Phase 7: Probabilistic intimacy / stats
    relationshipService.recordMessageQualityAsync(userId, message)
  ]) as [OpenLoop[], RelationshipMilestone | null, UserPattern[], void, void];
  
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
 * @param userId - The user's ID
 * @param message - The user's message text
 * @param interactionCount - Total number of interactions with this user
 * @param conversationContext - Optional recent chat history for LLM context
 */
export async function analyzeUserMessageBackground(
  userId: string,
  message: string,
  interactionCount: number,
  conversationContext?: ConversationContext,
  preCalculatedIntent?: FullMessageIntent
): Promise<void> {
  // Fire and forget - don't await this in the main thread
  analyzeUserMessage(
    userId, 
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
  analyzeMessageToneKeywords,
  detectToneWithLLM,
  detectTopicsWithLLM,
  detectOpenLoopsWithLLM,
  detectRelationshipSignalsWithLLM
};
