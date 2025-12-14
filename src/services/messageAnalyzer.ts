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
  type ToneIntent,
  type PrimaryEmotion
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
}

// Re-export types for consumers
export type { ToneIntent, PrimaryEmotion, ConversationContext };

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
// Main Analysis Function
// ============================================

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

  // Run ALL async tasks in parallel for efficiency
  // This includes LLM-based intent detection for genuine moments AND tone (Phases 1-2)
  const [
    genuineMomentResult,
    toneResult,
    createdLoops, 
    detectedPatterns, 
    recordedMilestone
  ] = await Promise.all([
    // LLM-based genuine moment detection (Phase 1)
    detectGenuineMomentWithLLM(message, conversationContext),
    
    // LLM-based tone & sentiment detection (Phase 2)
    detectToneWithLLM(message, conversationContext),
    
    // Detect open loops (things to follow up on)
    detectOpenLoops(userId, message, llmCall),
    
    // Analyze for cross-session patterns
    analyzeMessageForPatterns(userId, message),
    
    // Check for milestone moments
    detectMilestoneInMessage(userId, message, interactionCount),
  ]);
  
  // Use LLM sentiment for message tone (fallback is already in toneResult)
  const messageTone = toneResult.sentiment;
  
  // Record interaction for emotional momentum (sync, uses LLM tone result)
  recordInteraction(messageTone, message);

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

  return {
    createdLoops,
    detectedPatterns,
    recordedMilestone,
    wasGenuineMoment: genuineMomentResult.isGenuine,
    messageTone,
    toneResult,
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
};
