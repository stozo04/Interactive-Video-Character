// src/services/userPatterns.ts
/**
 * User Patterns Service
 * 
 * Detects and tracks cross-session behavioral patterns:
 * - mood_time: "You always seem stressed on Mondays"
 * - topic_correlation: "You mention mom when you're frustrated about work"
 * - behavior: "You check in more when you're anxious"
 * 
 * Surfaces with soft language: "I've noticed..." or "It seems like..."
 * 
 * Key principles:
 * - Patterns require multiple observations (min 3) to build confidence
 * - Confidence increases with each observation
 * - Patterns are surfaced gently and rarely (max 2 times, 7+ days apart)
 * - Never feel like surveillance - feel like attentiveness
 */

import { supabase } from './supabaseClient';
import type { ToneIntent, PrimaryEmotion } from './intentService';

// ============================================
// Types
// ============================================

export type PatternType = 
  | 'mood_time'          // Mood correlations with time
  | 'topic_correlation'  // Topics that appear together
  | 'behavior';          // Behavioral patterns

export interface UserPattern {
  id: string;
  userId: string;
  patternType: PatternType;
  observation: string;
  patternData?: Record<string, unknown>;
  frequency: number;
  confidence: number;
  firstObserved: Date;
  lastObserved: Date;
  hasBeenSurfaced: boolean;
  surfaceCount: number;
  lastSurfacedAt?: Date;
}

interface PatternRow {
  id: string;
  user_id: string;
  pattern_type: PatternType;
  observation: string;
  pattern_data?: Record<string, unknown>;
  frequency: number;
  confidence: number;
  first_observed: string;
  last_observed: string;
  created_at: string;
  has_been_surfaced: boolean;
  surface_count: number;
  last_surfaced_at?: string;
}

// ============================================
// Constants
// ============================================

const PATTERNS_TABLE = 'user_patterns';

// Minimum observations before a pattern can be surfaced
const MIN_OBSERVATIONS_TO_SURFACE = 3;

// Minimum confidence to surface a pattern
const MIN_CONFIDENCE_TO_SURFACE = 0.60;

// Maximum times a pattern can be surfaced
const MAX_SURFACE_COUNT = 2;

// Minimum days between surfacing the same pattern
const MIN_DAYS_BETWEEN_SURFACING = 7;

// Confidence increase per observation
const CONFIDENCE_INCREMENT = 0.12;

// Initial confidence for new patterns
const INITIAL_CONFIDENCE = 0.30;

// Day of week names for mood_time patterns
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Time of day categories
const TIME_OF_DAY: Record<string, { start: number; end: number }> = {
  'morning': { start: 5, end: 12 },
  'afternoon': { start: 12, end: 17 },
  'evening': { start: 17, end: 21 },
  'night': { start: 21, end: 5 },
};

// Mood descriptors for detection
const MOOD_INDICATORS = {
  stressed: ['stressed', 'anxious', 'overwhelmed', 'busy', 'crazy', 'hectic', 'swamped', 'exhausted'],
  sad: ['sad', 'down', 'depressed', 'lonely', 'miss', 'crying', 'upset', 'hurt'],
  happy: ['happy', 'great', 'amazing', 'wonderful', 'excited', 'pumped', 'good mood', 'feeling good'],
  frustrated: ['frustrated', 'annoyed', 'irritated', 'angry', 'mad', 'pissed', 'ugh'],
  anxious: ['anxious', 'worried', 'nervous', 'scared', 'freaking out', 'panicking'],
  tired: ['tired', 'exhausted', 'drained', 'sleepy', 'burnt out', 'wiped'],
};

// Topic categories for correlation detection
const TOPIC_CATEGORIES: Record<string, string[]> = {
  work: ['work', 'job', 'boss', 'coworker', 'meeting', 'project', 'deadline', 'office', 'career'],
  family: ['mom', 'dad', 'parent', 'brother', 'sister', 'family', 'grandma', 'grandpa', 'uncle', 'aunt'],
  relationships: ['boyfriend', 'girlfriend', 'partner', 'dating', 'relationship', 'ex', 'crush', 'love'],
  health: ['sick', 'doctor', 'health', 'exercise', 'gym', 'sleep', 'therapy', 'medication'],
  money: ['money', 'bills', 'debt', 'rent', 'broke', 'expensive', 'budget', 'paycheck'],
  school: ['school', 'class', 'homework', 'exam', 'test', 'professor', 'college', 'study'],
};

// ============================================
// Pattern Detection Functions
// ============================================

/**
 * Detect mood in a message.
 */
export function detectMood(message: string): string | null {
  const lowerMessage = message.toLowerCase();
  
  for (const [mood, indicators] of Object.entries(MOOD_INDICATORS)) {
    if (indicators.some(indicator => lowerMessage.includes(indicator))) {
      return mood;
    }
  }
  
  return null;
}

/**
 * Detect topics in a message.
 */
export function detectTopics(message: string): string[] {
  const lowerMessage = message.toLowerCase();
  const foundTopics: string[] = [];
  
  for (const [topic, keywords] of Object.entries(TOPIC_CATEGORIES)) {
    if (keywords.some(keyword => lowerMessage.includes(keyword))) {
      foundTopics.push(topic);
    }
  }
  
  return foundTopics;
}

/**
 * Get current time of day category.
 */
export function getTimeOfDay(date: Date = new Date()): string {
  const hour = date.getHours();
  
  // Handle night crossing midnight
  if (hour >= 21 || hour < 5) return 'night';
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * Get day of week.
 */
export function getDayOfWeek(date: Date = new Date()): { dayNumber: number; dayName: string } {
  const dayNumber = date.getDay();
  return { dayNumber, dayName: DAY_NAMES[dayNumber] };
}

// ============================================
// Pattern Recording Functions
// ============================================

/**
 * Record or update a mood-time pattern.
 * Called when we detect a mood and want to track if it correlates with time.
 */
export async function recordMoodTimePattern(
  userId: string,
  mood: string,
  date: Date = new Date()
): Promise<UserPattern | null> {
  const { dayName } = getDayOfWeek(date);
  const timeOfDay = getTimeOfDay(date);
  
  // Create observation string
  const observation = `${mood} on ${dayName}s`;
  
  // Pattern data for analysis
  const patternData = {
    mood,
    dayOfWeek: date.getDay(),
    dayName,
    timeOfDay,
    hour: date.getHours(),
  };
  
  return await recordPattern(userId, 'mood_time', observation, patternData);
}

/**
 * Record or update a topic correlation pattern.
 * Called when we detect multiple topics together with a mood.
 */
export async function recordTopicCorrelationPattern(
  userId: string,
  primaryTopic: string,
  correlatedMood: string,
  secondaryTopic?: string
): Promise<UserPattern | null> {
  // Create observation string
  let observation: string;
  if (secondaryTopic) {
    observation = `mentions ${primaryTopic} when ${correlatedMood} about ${secondaryTopic}`;
  } else {
    observation = `feels ${correlatedMood} when discussing ${primaryTopic}`;
  }
  
  const patternData = {
    primaryTopic,
    correlatedMood,
    secondaryTopic,
  };
  
  return await recordPattern(userId, 'topic_correlation', observation, patternData);
}

/**
 * Record or update a behavioral pattern.
 * Called when we notice behavioral trends.
 */
export async function recordBehaviorPattern(
  userId: string,
  behavior: string,
  context: string
): Promise<UserPattern | null> {
  // Create observation string
  const observation = `${behavior} when ${context}`;
  
  const patternData = {
    behavior,
    context,
  };
  
  return await recordPattern(userId, 'behavior', observation, patternData);
}

/**
 * Core function to record or update a pattern.
 */
async function recordPattern(
  userId: string,
  patternType: PatternType,
  observation: string,
  patternData: Record<string, unknown>
): Promise<UserPattern | null> {
  try {
    // Check if pattern already exists
    const { data: existing, error: checkError } = await supabase
      .from(PATTERNS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .eq('pattern_type', patternType)
      .eq('observation', observation)
      .maybeSingle();
    
    if (checkError) {
      console.error('[UserPatterns] Error checking existing pattern:', checkError);
      return null;
    }
    
    if (existing) {
      // Update existing pattern
      const newFrequency = (existing as PatternRow).frequency + 1;
      const newConfidence = Math.min(1.0, (existing as PatternRow).confidence + CONFIDENCE_INCREMENT);
      
      const { data: updated, error: updateError } = await supabase
        .from(PATTERNS_TABLE)
        .update({
          frequency: newFrequency,
          confidence: newConfidence,
          last_observed: new Date().toISOString(),
          pattern_data: patternData,
        })
        .eq('id', (existing as PatternRow).id)
        .select()
        .single();
      
      if (updateError) {
        console.error('[UserPatterns] Error updating pattern:', updateError);
        return null;
      }
      
      console.log(`📊 [UserPatterns] Pattern strengthened: "${observation}" (freq: ${newFrequency}, conf: ${newConfidence.toFixed(2)})`);
      return mapPatternRowToDomain(updated as PatternRow);
    }
    
    // Create new pattern
    const { data: inserted, error: insertError } = await supabase
      .from(PATTERNS_TABLE)
      .insert({
        user_id: userId,
        pattern_type: patternType,
        observation,
        pattern_data: patternData,
        frequency: 1,
        confidence: INITIAL_CONFIDENCE,
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('[UserPatterns] Error inserting pattern:', insertError);
      return null;
    }
    
    console.log(`📊 [UserPatterns] New pattern detected: "${observation}"`);
    return mapPatternRowToDomain(inserted as PatternRow);
    
  } catch (error) {
    console.error('[UserPatterns] Unexpected error recording pattern:', error);
    return null;
  }
}

// ============================================
// Pattern Analysis Functions
// ============================================

/**
 * Analyze a message for patterns.
 * This is the main entry point - call after each user message.
 * 
 * Phase 3 Enhancement: Now accepts optional ToneIntent from Phase 2.
 * If provided, uses LLM-detected primaryEmotion for mood patterns,
 * falling back to keyword detection if emotion doesn't map to a mood.
 * 
 * @param userId - The user's ID  
 * @param message - The user's message text
 * @param date - Date for time-based pattern tracking (defaults to now)
 * @param toneResult - Optional ToneIntent from Phase 2 LLM detection
 */
export async function analyzeMessageForPatterns(
  userId: string,
  message: string,
  date: Date = new Date(),
  toneResult?: ToneIntent
): Promise<UserPattern[]> {
  const detectedPatterns: UserPattern[] = [];
  
  // Phase 3: Try to get mood from LLM-detected emotion first
  let mood: string | null = null;
  
  if (toneResult?.primaryEmotion) {
    // Map LLM emotion to mood pattern category
    mood = mapEmotionToMoodPattern(toneResult.primaryEmotion);
    
    if (mood) {
      console.log(`🧠 [UserPatterns] Using LLM emotion for mood: ${toneResult.primaryEmotion} → ${mood}`);
    }
  }
  
  // Fallback to keyword detection if LLM didn't provide a mappable mood
  if (!mood) {
    mood = detectMood(message);
  }
  
  const topics = detectTopics(message);
  
  // Record mood-time pattern if mood detected
  if (mood) {
    const pattern = await recordMoodTimePattern(userId, mood, date);
    if (pattern) {
      detectedPatterns.push(pattern);
    }
    
    // Record topic-mood correlations
    for (const topic of topics) {
      const pattern = await recordTopicCorrelationPattern(userId, topic, mood);
      if (pattern) {
        detectedPatterns.push(pattern);
      }
    }
    
    // If multiple topics, record correlation between them
    if (topics.length >= 2) {
      const pattern = await recordTopicCorrelationPattern(userId, topics[0], mood, topics[1]);
      if (pattern) {
        detectedPatterns.push(pattern);
      }
    }
  }
  
  return detectedPatterns;
}

/**
 * Maps PrimaryEmotion from ToneIntent to mood pattern categories.
 * Returns null for emotions that don't map to trackable mood patterns.
 * 
 * This is the Phase 3 bridge between tone detection and mood patterns.
 */
function mapEmotionToMoodPattern(emotion: PrimaryEmotion): string | null {
  const emotionToMoodMap: Record<PrimaryEmotion, string | null> = {
    'happy': 'happy',
    'sad': 'sad',
    'frustrated': 'frustrated',
    'anxious': 'anxious',
    'excited': 'happy',  // Excited maps to happy for pattern purposes
    'angry': 'frustrated',  // Angry maps to frustrated
    'playful': null,  // Playful is a tone, not a mood pattern
    'dismissive': null,  // Dismissive is a tone, not a mood pattern
    'neutral': null,  // Neutral doesn't indicate a mood pattern
    'mixed': null,  // Mixed is too ambiguous for patterns
  };
  return emotionToMoodMap[emotion] ?? null;
}

// ============================================
// Pattern Surfacing Functions
// ============================================

/**
 * Get a pattern that's ready to be surfaced to the user.
 * Only returns patterns with sufficient confidence that haven't been over-surfaced.
 */
export async function getPatternToSurface(userId: string): Promise<UserPattern | null> {
  try {
    const minSurfaceDate = new Date(Date.now() - MIN_DAYS_BETWEEN_SURFACING * 24 * 60 * 60 * 1000);
    
    const { data, error } = await supabase
      .from(PATTERNS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .gte('confidence', MIN_CONFIDENCE_TO_SURFACE)
      .gte('frequency', MIN_OBSERVATIONS_TO_SURFACE)
      .lt('surface_count', MAX_SURFACE_COUNT)
      .order('confidence', { ascending: false })
      .order('frequency', { ascending: false })
      .limit(5);
    
    if (error) {
      console.error('[UserPatterns] Error fetching patterns to surface:', error);
      return null;
    }
    
    if (!data || data.length === 0) {
      return null;
    }
    
    // Filter by last surfaced date (can't do complex date comparison in Supabase easily)
    const eligiblePatterns = (data as PatternRow[]).filter(row => {
      if (!row.last_surfaced_at) return true;
      const lastSurfaced = new Date(row.last_surfaced_at);
      return lastSurfaced < minSurfaceDate;
    });
    
    if (eligiblePatterns.length === 0) {
      return null;
    }
    
    // Return the highest confidence eligible pattern
    return mapPatternRowToDomain(eligiblePatterns[0]);
    
  } catch (error) {
    console.error('[UserPatterns] Unexpected error getting pattern to surface:', error);
    return null;
  }
}

/**
 * Mark a pattern as surfaced.
 * Call this after the AI has mentioned the pattern to the user.
 */
export async function markPatternSurfaced(patternId: string): Promise<void> {
  try {
    // First, get current surface count
    const { data: current, error: fetchError } = await supabase
      .from(PATTERNS_TABLE)
      .select('surface_count')
      .eq('id', patternId)
      .single();
    
    if (fetchError) {
      console.error('[UserPatterns] Error fetching pattern for surfacing:', fetchError);
      return;
    }
    
    // Update with incremented count in a single operation
    const { error: updateError } = await supabase
      .from(PATTERNS_TABLE)
      .update({
        has_been_surfaced: true,
        surface_count: (current?.surface_count || 0) + 1,
        last_surfaced_at: new Date().toISOString(),
      })
      .eq('id', patternId);
    
    if (updateError) {
      console.error('[UserPatterns] Error marking pattern surfaced:', updateError);
      return;
    }
    
    console.log(`✅ [UserPatterns] Pattern surfaced: ${patternId}`);
  } catch (error) {
    console.error('[UserPatterns] Unexpected error marking pattern surfaced:', error);
  }
}

/**
 * Generate a soft, natural prompt for surfacing a pattern.
 * Uses gentle language like "I've noticed..." rather than direct statements.
 */
export function generatePatternSurfacePrompt(pattern: UserPattern): string {
  const softStarters = [
    "I've noticed",
    "It seems like",
    "I might be imagining this, but",
    "Not to be weird, but I've noticed",
    "I could be off, but it feels like",
  ];
  
  const starter = softStarters[Math.floor(Math.random() * softStarters.length)];
  
  // Format based on pattern type
  let patternDescription: string;
  
  switch (pattern.patternType) {
    case 'mood_time': {
      const data = pattern.patternData as { mood?: string; dayName?: string; timeOfDay?: string };
      patternDescription = `you ${data?.mood || 'get stressed'} on ${data?.dayName || pattern.observation}s`;
      break;
    }
    
    case 'topic_correlation': {
      patternDescription = pattern.observation;
      break;
    }
    
    case 'behavior': {
      patternDescription = pattern.observation;
      break;
    }
    
    default:
      patternDescription = pattern.observation;
  }
  
  // Build the prompt section
  return `
=== PATTERN INSIGHT (use sparingly, only if it feels natural) ===

OBSERVATION: "${starter} ${patternDescription}."

HOW TO SURFACE THIS:
- Only mention if it's genuinely relevant to the current conversation
- Use SOFT language: "I've noticed..." or "It seems like..." 
- Frame as curiosity, not diagnosis: "Is that a thing for you?" or "Am I imagining that?"
- Be ready to be wrong gracefully: "Maybe I'm off base..."
- Don't make it heavy or clinical

EXAMPLE PHRASES:
- "${starter} ${patternDescription}. Is that a thing, or am I making it up?"
- "This might be random, but... ${patternDescription}? Just curious."
- "Hey, do you find that ${patternDescription}? I feel like I've noticed that."

CRITICAL:
- Do NOT say "I've detected a pattern" or anything clinical
- Do NOT frame this as analysis or observation from conversations
- Make it feel like natural attentiveness, like a friend who pays attention
- If it doesn't fit the current vibe, SKIP IT entirely

PATTERN_ID: ${pattern.id}
`;
}

// ============================================
// Pattern Statistics
// ============================================

/**
 * Get all patterns for a user.
 */
export async function getPatterns(userId: string): Promise<UserPattern[]> {
  try {
    const { data, error } = await supabase
      .from(PATTERNS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('confidence', { ascending: false });
    
    if (error) {
      console.error('[UserPatterns] Error fetching patterns:', error);
      return [];
    }
    
    return (data as PatternRow[] || []).map(mapPatternRowToDomain);
  } catch (error) {
    console.error('[UserPatterns] Unexpected error fetching patterns:', error);
    return [];
  }
}

/**
 * Get pattern statistics for debugging.
 */
export async function getPatternStats(userId: string): Promise<{
  totalPatterns: number;
  surfacedCount: number;
  patternTypes: PatternType[];
  highConfidenceCount: number;
}> {
  const patterns = await getPatterns(userId);
  
  return {
    totalPatterns: patterns.length,
    surfacedCount: patterns.filter(p => p.hasBeenSurfaced).length,
    patternTypes: [...new Set(patterns.map(p => p.patternType))],
    highConfidenceCount: patterns.filter(p => p.confidence >= MIN_CONFIDENCE_TO_SURFACE).length,
  };
}

/**
 * Delete all patterns for a user (for testing/reset).
 */
export async function clearPatterns(userId: string): Promise<void> {
  try {
    await supabase
      .from(PATTERNS_TABLE)
      .delete()
      .eq('user_id', userId);
    
    console.log(`🗑️ [UserPatterns] Cleared patterns for user: ${userId}`);
  } catch (error) {
    console.error('[UserPatterns] Error clearing patterns:', error);
  }
}

// ============================================
// Utility Functions
// ============================================

function mapPatternRowToDomain(row: PatternRow): UserPattern {
  return {
    id: row.id,
    userId: row.user_id,
    patternType: row.pattern_type,
    observation: row.observation,
    patternData: row.pattern_data,
    frequency: row.frequency,
    confidence: typeof row.confidence === 'string' ? parseFloat(row.confidence) : row.confidence,
    firstObserved: new Date(row.first_observed),
    lastObserved: new Date(row.last_observed),
    hasBeenSurfaced: row.has_been_surfaced,
    surfaceCount: row.surface_count,
    lastSurfacedAt: row.last_surfaced_at ? new Date(row.last_surfaced_at) : undefined,
  };
}

// ============================================
// Export all public functions
// ============================================

export {
  MIN_OBSERVATIONS_TO_SURFACE,
  MIN_CONFIDENCE_TO_SURFACE,
  MAX_SURFACE_COUNT,
  MIN_DAYS_BETWEEN_SURFACING,
  CONFIDENCE_INCREMENT,
  INITIAL_CONFIDENCE,
  DAY_NAMES,
  MOOD_INDICATORS,
  TOPIC_CATEGORIES,
};
