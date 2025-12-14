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
 */

import { detectOpenLoops } from './presenceDirector';
import { analyzeMessageForPatterns } from './userPatterns';
import { detectMilestoneInMessage } from './relationshipMilestones';
import { 
  recordInteraction, 
  detectGenuineMomentWithLLM,
  type ConversationContext
} from './moodKnobs';
import {
  detectToneLLMCached,
  detectTopicsLLMCached,
  detectOpenLoopsLLMCached,
  type ToneIntent,
  type PrimaryEmotion,
  type TopicIntent,
  type TopicCategory,
  type OpenLoopIntent,
  type LoopTypeIntent,
  type FollowUpTimeframe
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
  FollowUpTimeframe
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
      isSarcastic: false, // Keyword detection can't detect sarcasm
      explanation: 'Fallback to keyword-based detection'
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
      entities: [], // Keyword detection can't extract entities
      explanation: 'Fallback to keyword-based topic detection'
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
      salience: 0,
      explanation: 'Fallback - LLM detection failed'
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
  conversationContext?: ConversationContext
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

  // Run LLM-based detection tasks in parallel for efficiency
  // Phase 1: Genuine moment, Phase 2: Tone, Phase 4: Topics, Phase 5: Open Loops
  const [
    genuineMomentResult,
    toneResult,
    topicResult,
    openLoopResult,
    createdLoops,
    recordedMilestone
  ] = await Promise.all([
    // LLM-based genuine moment detection (Phase 1)
    detectGenuineMomentWithLLM(message, conversationContext),
    
    // LLM-based tone & sentiment detection (Phase 2)
    detectToneWithLLM(message, conversationContext),
    
    // LLM-based topic detection (Phase 4)
    detectTopicsWithLLM(message, conversationContext),
    
    // LLM-based open loop detection (Phase 5) - for direct access
    detectOpenLoopsWithLLM(message, conversationContext),
    
    // Detect open loops and create them in Supabase (Phase 5 uses LLM internally)
    detectOpenLoops(userId, message, llmCall, conversationContext),
    
    // Check for milestone moments
    detectMilestoneInMessage(userId, message, interactionCount),
  ]);
  
  // Phase 3: Analyze for cross-session patterns WITH toneResult AND topicResult
  // This enables LLM-based mood detection via primaryEmotion and topic detection
  // Runs after tone/topic detection so we can pass the results
  const detectedPatterns = await analyzeMessageForPatterns(userId, message, new Date(), toneResult, topicResult);
  
  // Use LLM sentiment for message tone (fallback is already in toneResult)
  const messageTone = toneResult.sentiment;
  
  // Record interaction for emotional momentum (sync, uses full ToneIntent for Phase 3)
  // Passing full toneResult enables:
  // - primaryEmotion for mood pattern tracking
  // - intensity for modulating mood shift speed
  recordInteraction(toneResult, message);

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
    console.log(`🎭 [MessageAnalyzer] Sarcasm detected: ${toneResult.explanation}`);
  }
  if (topicResult.topics.length > 0) {
    console.log(`📋 [MessageAnalyzer] Topics detected: ${topicResult.topics.join(', ')}`);
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
export function analyzeUserMessageBackground(
  userId: string,
  message: string,
  interactionCount: number = 0,
  conversationContext?: ConversationContext
): void {
  // Fire and forget - don't block the response
  analyzeUserMessage(userId, message, interactionCount, undefined, conversationContext)
    .catch(error => {
      console.warn('[MessageAnalyzer] Background analysis failed:', error);
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
};
