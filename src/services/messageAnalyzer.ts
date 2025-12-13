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
 */

import { detectOpenLoops } from './presenceDirector';
import { analyzeMessageForPatterns } from './userPatterns';
import { detectMilestoneInMessage } from './relationshipMilestones';
import { recordInteraction, detectGenuineMoment } from './moodKnobs';
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
}

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
 * Simple tone analysis for a message.
 * Returns a value from -1 (very negative) to 1 (very positive).
 */
function analyzeMessageTone(message: string): number {
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

// ============================================
// Main Analysis Function
// ============================================

/**
 * Analyze a user message for patterns, loops, and milestones.
 * 
 * Call this after each user message to enable the proactive memory systems.
 * This is the main integration point that wires together all Phase 1-5 features.
 * 
 * @param userId - The user's ID
 * @param message - The user's message text
 * @param interactionCount - Total number of interactions with this user
 * @param llmCall - Optional LLM function for advanced loop detection
 * @returns Analysis results including any detected patterns/loops/milestones
 */
export async function analyzeUserMessage(
  userId: string,
  message: string,
  interactionCount: number = 0,
  llmCall?: (prompt: string) => Promise<string>
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

  // Analyze message tone
  const messageTone = analyzeMessageTone(message);
  
  // Check for genuine moment (addresses insecurities)
  const genuineMomentResult = detectGenuineMoment(message);
  
  // Record interaction for emotional momentum
  recordInteraction(messageTone, message);

  // Run pattern detection tasks in parallel
  const [createdLoops, detectedPatterns, recordedMilestone] = await Promise.all([
    // Detect open loops (things to follow up on)
    detectOpenLoops(userId, message, llmCall),
    
    // Analyze for cross-session patterns
    analyzeMessageForPatterns(userId, message),
    
    // Check for milestone moments
    detectMilestoneInMessage(userId, message, interactionCount),
  ]);

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
    console.log(`💝 [MessageAnalyzer] Genuine moment detected (${genuineMomentResult.category})`);
  }

  return {
    createdLoops,
    detectedPatterns,
    recordedMilestone,
    wasGenuineMoment: genuineMomentResult.isGenuine,
    messageTone,
  };
}

/**
 * Lightweight version for quick integration - doesn't wait for results.
 * Use this in the chat flow to avoid adding latency.
 */
export function analyzeUserMessageBackground(
  userId: string,
  message: string,
  interactionCount: number = 0
): void {
  // Fire and forget - don't block the response
  analyzeUserMessage(userId, message, interactionCount)
    .catch(error => {
      console.warn('[MessageAnalyzer] Background analysis failed:', error);
    });
}

export default {
  analyzeUserMessage,
  analyzeUserMessageBackground,
  analyzeMessageTone,
};
