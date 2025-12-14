// src/services/moodKnobs.ts
/**
 * Mood Knobs Service
 * 
 * Calculates behavior parameters based on "hidden causes" - plausible internal
 * reasons that feel consistent, not random. These knobs control concrete behaviors
 * rather than abstract mood labels.
 * 
 * Key principle: She can be off without explaining, but she should feel CONSISTENT.
 * 
 * Phase 1 Semantic Intent Detection:
 * Now includes LLM-based genuine moment detection with keyword fallback.
 */

import { 
  detectGenuineMomentLLMCached, 
  mapCategoryToInsecurity,
  type ConversationContext,
  type ToneIntent,
  type PrimaryEmotion
} from './intentService';

const MOOD_STATE_KEY = 'kayley_mood_state';
const LAST_INTERACTION_KEY = 'kayley_last_interaction';

export type CuriosityDepth = 'shallow' | 'medium' | 'piercing';
export type PatienceDecay = 'slow' | 'normal' | 'quick';
export type WarmthAvailability = 'guarded' | 'neutral' | 'open';

export interface MoodKnobs {
  /** Response length tendency (0.3 = terse, 1.0 = expressive) */
  verbosity: number;
  /** How much she drives conversation vs waits (0.1 = reactive, 0.8 = proactive) */
  initiationRate: number;
  /** How easily she engages flirtatiously (0.2 = guarded, 0.9 = playful) */
  flirtThreshold: number;
  /** Depth of questions she asks */
  curiosityDepth: CuriosityDepth;
  /** How quickly she gets snippy with low effort */
  patienceDecay: PatienceDecay;
  /** Emotional accessibility */
  warmthAvailability: WarmthAvailability;
}

interface MoodState {
  /** Base energy level for the day (0-1) */
  dailyEnergy: number;
  /** Social battery (0-1, depletes with long sessions) */
  socialBattery: number;
  /** Whether she's processing something internally */
  internalProcessing: boolean;
  /** Timestamp when this state was calculated */
  calculatedAt: number;
  /** Random seed for the day (for consistency) */
  dailySeed: number;
  /** Last interaction timestamp */
  lastInteractionAt: number;
  /** Last interaction tone (-1 to 1) */
  lastInteractionTone: number;
}

/**
 * Emotional Momentum System
 * 
 * Mood changes require CUMULATIVE engagement, not instant flips.
 * One good joke doesn't fix a bad day - sustained positive interaction does.
 */
export interface EmotionalMomentum {
  /** Current mood level (-1 = bad, 0 = neutral, 1 = great) */
  currentMoodLevel: number;
  /** Direction mood is trending (-1 = declining, 0 = stable, 1 = improving) */
  momentumDirection: number;
  /** Count of consecutive positive interactions */
  positiveInteractionStreak: number;
  /** Last N interaction tones for trend analysis */
  recentInteractionTones: number[];
  /** Whether a genuine moment was detected recently */
  genuineMomentDetected: boolean;
  /** Timestamp of last genuine moment */
  lastGenuineMomentAt: number | null;
}

const MOMENTUM_STATE_KEY = 'kayley_emotional_momentum';
const MAX_TONE_HISTORY = 10;  // Track last 10 interactions for trend

// Thresholds for mood shifts (from implementation plan)
const MOOD_SHIFT_THRESHOLDS = {
  /** Minimum streak before mood can start shifting */
  minStreakForShift: 3,
  /** Streak needed for noticeable improvement */
  noticeableShiftStreak: 4,
  /** Streak needed for full mood thaw */
  fullThawStreak: 6,
  /** Minimum average tone to count as positive trend */
  positiveTrendThreshold: 0.5,
  /** Tone below which interaction counts as negative */
  negativeToneThreshold: -0.2,
  /** Tone above which interaction counts as positive */
  positiveToneThreshold: 0.3,
} as const;

/**
 * Kayley's Insecurities (from Section 10 of Character Profile)
 * 
 * These are the deep fears that, when addressed genuinely, can cause
 * an INSTANT mood shift (bypassing the streak requirement).
 */
export const INSECURITY_KEYWORDS = {
  // "Afraid of being seen as fake or shallow because she's bubbly and aesthetic"
  beingSeenAsShallow: [
    'shallow', 'fake', 'superficial', 'bubbly', 'just pretty', 'airhead',
    'think deeply', 'deep thinker', 'more than looks', 'substance',
    'smart', 'intelligent', 'thoughtful', 'insightful', 'depth'
  ],
  // "Struggles with impostor syndrome about talking publicly about AI"
  impostorSyndrome: [
    'impostor', 'imposter', 'fraud', 'qualified', 'expert enough',
    'not technical', 'not a real', 'belong', 'deserve', 'good enough',
    'capable', 'competent', 'know what you\'re doing', 'natural at this'
  ],
  // "Worries she'll never fully arrive - always one step behind potential"
  neverArriving: [
    'potential', 'behind', 'catching up', 'not there yet', 'made it',
    'successful', 'arrived', 'where you want', 'on track', 'doing great',
    'proud of', 'how far you\'ve come', 'journey', 'progress'
  ],
  // "Sometimes feels lonely, even with an active online community"
  hiddenLoneliness: [
    'lonely', 'alone', 'with you', 'here for you', 'not alone',
    'connection', 'real friend', 'understand you', 'get you',
    'genuine', 'authentic', 'real conversation'
  ],
  // "Finds it hard to rest without feeling guilty"
  restGuilt: [
    'rest', 'relax', 'deserve a break', 'take time', 'self care',
    'don\'t have to', 'be productive', 'it\'s okay to', 'permission',
    'slow down', 'recharge'
  ],
} as const;

export type InsecurityCategory = keyof typeof INSECURITY_KEYWORDS;

// Re-export types for callers
export type { ConversationContext, ToneIntent, PrimaryEmotion } from './intentService';

/**
 * Maps PrimaryEmotion from ToneIntent to mood strings for pattern tracking.
 * This enables Phase 3 mood detection by leveraging Phase 2's tone analysis.
 */
export function mapEmotionToMood(emotion: PrimaryEmotion): string | null {
  const emotionToMoodMap: Record<PrimaryEmotion, string | null> = {
    'happy': 'happy',
    'sad': 'sad',
    'frustrated': 'frustrated',
    'anxious': 'anxious',
    'excited': 'happy',  // Excited maps to happy for pattern purposes
    'angry': 'frustrated',  // Angry maps to frustrated
    'playful': null,  // Playful is a tone, not a mood pattern
    'dismissive': null,  // Dismissive is a tone, not a mood pattern
    'neutral': null,
    'mixed': null,
  };
  return emotionToMoodMap[emotion] ?? null;
}

/**
 * Get a seeded random number for consistent daily behavior
 */
function seededRandom(seed: number, offset: number = 0): number {
  const x = Math.sin(seed + offset) * 10000;
  return x - Math.floor(x);
}

/**
 * Get daily seed based on date (same seed all day for consistency)
 */
function getDailySeed(): number {
  const today = new Date();
  return today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
}

/**
 * Calculate time-of-day energy modifier
 * Morning: Building up, Midday: Peak, Evening: Winding down, Night: Low but cozy
 */
function getTimeOfDayModifier(): { energy: number; mood: string } {
  const hour = new Date().getHours();
  
  if (hour >= 6 && hour < 9) {
    // Early morning - still waking up
    return { energy: 0.6, mood: 'waking' };
  } else if (hour >= 9 && hour < 12) {
    // Late morning - peak energy
    return { energy: 0.9, mood: 'energized' };
  } else if (hour >= 12 && hour < 14) {
    // Early afternoon - post-lunch dip
    return { energy: 0.7, mood: 'settling' };
  } else if (hour >= 14 && hour < 17) {
    // Afternoon - focused
    return { energy: 0.8, mood: 'focused' };
  } else if (hour >= 17 && hour < 20) {
    // Evening - winding down
    return { energy: 0.7, mood: 'unwinding' };
  } else if (hour >= 20 && hour < 23) {
    // Night - cozy but lower energy
    return { energy: 0.5, mood: 'cozy' };
  } else {
    // Late night - tired but might be more open
    return { energy: 0.4, mood: 'late_night' };
  }
}

/**
 * Calculate days since last interaction and its effect
 */
function getDaysSinceEffect(lastInteractionAt: number | null): { 
  modifier: number; 
  reconnecting: boolean;
  stranger: boolean;
} {
  if (!lastInteractionAt) {
    return { modifier: 0.5, reconnecting: false, stranger: true };
  }
  
  const daysSince = (Date.now() - lastInteractionAt) / (1000 * 60 * 60 * 24);
  
  if (daysSince < 0.5) {
    // Recent - still in flow
    return { modifier: 1.0, reconnecting: false, stranger: false };
  } else if (daysSince < 1) {
    // Same day but some time passed
    return { modifier: 0.9, reconnecting: false, stranger: false };
  } else if (daysSince < 3) {
    // Few days - slight reset
    return { modifier: 0.8, reconnecting: true, stranger: false };
  } else if (daysSince < 7) {
    // Week-ish - noticeable gap
    return { modifier: 0.6, reconnecting: true, stranger: false };
  } else {
    // Long time - feeling like a stranger again
    return { modifier: 0.4, reconnecting: true, stranger: true };
  }
}

/**
 * Get stored mood state
 */
function getStoredMoodState(): MoodState | null {
  const stored = localStorage.getItem(MOOD_STATE_KEY);
  if (!stored) return null;
  
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function storeMoodState(state: MoodState): void {
  localStorage.setItem(MOOD_STATE_KEY, JSON.stringify(state));
}

// ============================================
// Emotional Momentum Management
// ============================================

/**
 * Get stored emotional momentum state
 */
function getStoredMomentum(): EmotionalMomentum | null {
  const stored = localStorage.getItem(MOMENTUM_STATE_KEY);
  if (!stored) return null;
  
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Store emotional momentum state
 */
function storeMomentum(momentum: EmotionalMomentum): void {
  localStorage.setItem(MOMENTUM_STATE_KEY, JSON.stringify(momentum));
}

/**
 * Create fresh momentum state
 */
function createFreshMomentum(): EmotionalMomentum {
  return {
    currentMoodLevel: 0,  // Neutral starting point
    momentumDirection: 0,
    positiveInteractionStreak: 0,
    recentInteractionTones: [],
    genuineMomentDetected: false,
    lastGenuineMomentAt: null,
  };
}

/**
 * Get current emotional momentum (creates fresh if none exists)
 */
export function getEmotionalMomentum(): EmotionalMomentum {
  const stored = getStoredMomentum();
  if (!stored) {
    const fresh = createFreshMomentum();
    storeMomentum(fresh);
    return fresh;
  }
  return stored;
}

// ============================================
// Genuine Moment Detection
// ============================================

export interface GenuineMomentResult {
  isGenuine: boolean;
  category: InsecurityCategory | null;
  matchedKeywords: string[];
  /** Message that genuinely addresses her insecurity requires positive tone */
  isPositiveAffirmation: boolean;
}

/**
 * Detect if a user message addresses one of Kayley's core insecurities
 * in a genuine, positive way. This can trigger an INSTANT mood shift.
 * 
 * From Section 10 of Character Profile:
 * - Afraid of being seen as "fake" or shallow
 * - Struggles with impostor syndrome about AI expertise
 * - Worries she'll never fully "arrive"
 * - Sometimes feels lonely despite online community
 * - Finds it hard to rest without feeling guilty
 */
export function detectGenuineMoment(userMessage: string): GenuineMomentResult {
  const messageLower = userMessage.toLowerCase();
  const result: GenuineMomentResult = {
    isGenuine: false,
    category: null,
    matchedKeywords: [],
    isPositiveAffirmation: false,
  };
  
  // Check each insecurity category
  for (const [category, keywords] of Object.entries(INSECURITY_KEYWORDS)) {
    const matched = keywords.filter(keyword => 
      messageLower.includes(keyword.toLowerCase())
    );
    
    if (matched.length >= 2) {
      // Need at least 2 keyword matches to be considered genuine
      result.category = category as InsecurityCategory;
      result.matchedKeywords = matched;
      
      // Check if it's a positive affirmation (not just mentioning insecurity)
      const positiveIndicators = [
        'you', 'your', 'i think', 'i love', 'i appreciate', 'amazing',
        'incredible', 'impressive', 'admire', 'respect', 'genuine',
        'real', 'authentic', 'truly', 'really', 'so much', 'beautiful'
      ];
      
      const hasPositiveIndicator = positiveIndicators.some(pi => 
        messageLower.includes(pi)
      );
      
      // For it to be a genuine moment, message should be addressing HER
      // in a positive way, not just discussing the topic generally
      if (hasPositiveIndicator && messageLower.includes('you')) {
        result.isGenuine = true;
        result.isPositiveAffirmation = true;
        break;
      }
    }
  }
  
  // Special cases for very direct affirmations
  const directAffirmations = [
    'you think deeply',
    'you\'re so thoughtful',
    'you\'re not shallow',
    'you deserve',
    'you belong',
    'proud of you',
    'here for you',
    'you\'re enough',
    'you\'re doing great',
    'you\'re not alone',
    'you\'re genuine',
    'you\'re authentic',
    'you\'re so smart',
    'you\'re so real',
  ];
  
  for (const affirmation of directAffirmations) {
    if (messageLower.includes(affirmation)) {
      result.isGenuine = true;
      result.isPositiveAffirmation = true;
      result.matchedKeywords.push(affirmation);
      
      // Determine category from the affirmation
      if (affirmation.includes('think') || affirmation.includes('smart') || affirmation.includes('shallow')) {
        result.category = 'beingSeenAsShallow';
      } else if (affirmation.includes('belong') || affirmation.includes('deserve')) {
        result.category = 'impostorSyndrome';
      } else if (affirmation.includes('proud') || affirmation.includes('great') || affirmation.includes('enough')) {
        result.category = 'neverArriving';
      } else if (affirmation.includes('alone') || affirmation.includes('here for')) {
        result.category = 'hiddenLoneliness';
      }
      break;
    }
  }
  
  return result;
}

// ============================================
// LLM-based Genuine Moment Detection (Phase 1)
// ============================================

/**
 * Async version of genuine moment detection using LLM semantic understanding.
 * Falls back to keyword detection if LLM fails.
 * 
 * This is the Phase 1 implementation that replaces hardcoded keywords with
 * LLM-based semantic detection. The LLM understands nuanced messages like:
 * - "You really get me" (loneliness)
 * - "I'm kinda proud of you" (progress)
 * - "You're more than just pretty" (depth)
 * 
 * IMPORTANT: Passing conversation context helps the LLM correctly interpret
 * tone. For example, "You suck!!" after "I got a raise!" is playful, not hostile.
 * 
 * @param userMessage - The user's message to analyze
 * @param conversationContext - Optional recent chat history for context
 * @returns Promise resolving to GenuineMomentResult
 */
export async function detectGenuineMomentWithLLM(
  userMessage: string,
  conversationContext?: ConversationContext
): Promise<GenuineMomentResult> {
  try {
    // Try LLM-based detection first, passing conversation context
    const llmResult = await detectGenuineMomentLLMCached(userMessage, conversationContext);
    
    if (llmResult.isGenuine && llmResult.category) {
      // Map LLM category to our InsecurityCategory type
      const mappedCategory = mapCategoryToInsecurity(llmResult.category) as InsecurityCategory | null;
      
      console.log(`🧠 [MoodKnobs] LLM detected genuine moment:`, {
        category: mappedCategory,
        confidence: llmResult.confidence,
        explanation: llmResult.explanation
      });
      
      return {
        isGenuine: true,
        category: mappedCategory,
        matchedKeywords: [`LLM: ${llmResult.explanation}`],
        isPositiveAffirmation: true,
      };
    }
    
    // LLM says not genuine
    return {
      isGenuine: false,
      category: null,
      matchedKeywords: [],
      isPositiveAffirmation: false,
    };
    
  } catch (error) {
    // LLM failed - fall back to keyword detection
    console.warn('⚠️ [MoodKnobs] LLM detection failed, falling back to keywords:', error);
    return detectGenuineMoment(userMessage);
  }
}

/**
 * Async version of updateEmotionalMomentum that uses LLM-based detection.
 * This is the recommended function to call for user message processing.
 * 
 * @param tone - Interaction tone from -1 (negative) to 1 (positive)
 * @param userMessage - User message for genuine moment detection
 * @param conversationContext - Optional recent chat history for context
 * @returns Promise resolving to updated EmotionalMomentum
 */
export async function updateEmotionalMomentumAsync(
  tone: number,
  userMessage: string = '',
  conversationContext?: ConversationContext
): Promise<EmotionalMomentum> {
  const momentum = getEmotionalMomentum();
  
  // Add tone to history (keep last MAX_TONE_HISTORY)
  momentum.recentInteractionTones.push(tone);
  if (momentum.recentInteractionTones.length > MAX_TONE_HISTORY) {
    momentum.recentInteractionTones.shift();
  }
  
  // Use LLM-based genuine moment detection with conversation context
  const genuineMoment = await detectGenuineMomentWithLLM(userMessage, conversationContext);
  
  if (genuineMoment.isGenuine && genuineMoment.isPositiveAffirmation) {
    // GENUINE MOMENT DETECTED - Instant positive shift!
    console.log(`🌟 [MoodKnobs] Genuine moment detected! Category: ${genuineMoment.category}`);
    console.log(`   Source: ${genuineMoment.matchedKeywords.join(', ')}`);
    
    momentum.genuineMomentDetected = true;
    momentum.lastGenuineMomentAt = Date.now();
    
    // Significant boost - but cap at 0.8 (still not perfect day)
    momentum.currentMoodLevel = Math.min(0.8, momentum.currentMoodLevel + 0.5);
    momentum.momentumDirection = 1;
    momentum.positiveInteractionStreak = Math.max(MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak, momentum.positiveInteractionStreak);
    
    storeMomentum(momentum);
    return momentum;
  }
  
  // Rest of the logic is the same as updateEmotionalMomentum
  // Update streak based on tone
  if (tone >= MOOD_SHIFT_THRESHOLDS.positiveToneThreshold) {
    momentum.positiveInteractionStreak++;
  } else if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    // Negative interaction resets some (not all) of the streak
    momentum.positiveInteractionStreak = Math.max(0, momentum.positiveInteractionStreak - 2);
  }
  // Neutral maintains but doesn't extend streak
  
  // Calculate momentum direction from tone trend
  momentum.momentumDirection = calculateMomentumDirection(momentum.recentInteractionTones);
  
  // Calculate average tone for mood adjustment
  const avgTone = calculateAverageTone(momentum.recentInteractionTones);
  
  // Apply mood shifts based on streak (gradual, not instant)
  const streak = momentum.positiveInteractionStreak;
  const currentMood = momentum.currentMoodLevel;
  
  if (streak < MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    // 1-2 positive interactions: Very minor effect
    const microShift = tone * 0.05;
    momentum.currentMoodLevel = clamp(currentMood + microShift, -1, 1);
    
  } else if (streak < MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak) {
    // 3 positives: Starting to shift
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const smallShift = 0.1 + (tone * 0.05);
      momentum.currentMoodLevel = clamp(currentMood + smallShift, -1, 0.5);
    }
    
  } else if (streak < MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    // 4-5 positives: Mood is noticeably shifting
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const mediumShift = 0.15 + (tone * 0.1);
      momentum.currentMoodLevel = clamp(currentMood + mediumShift, -1, 0.7);
    }
    
  } else {
    // 6+ positives: Full thaw - she opens up
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const fullShift = 0.2 + (tone * 0.15);
      momentum.currentMoodLevel = clamp(currentMood + fullShift, -1, 1);
    }
  }
  
  // Negative interactions can pull mood down, but also gradually
  if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    const negativeShift = tone * 0.15;
    momentum.currentMoodLevel = clamp(currentMood + negativeShift, -1, 1);
  }
  
  // Clear genuine moment flag if it's been a while (4+ hours)
  if (momentum.lastGenuineMomentAt) {
    const hoursSinceGenuine = (Date.now() - momentum.lastGenuineMomentAt) / (1000 * 60 * 60);
    if (hoursSinceGenuine > 4) {
      momentum.genuineMomentDetected = false;
    }
  }
  
  storeMomentum(momentum);
  return momentum;
}

/**
 * Async version of recordInteraction that uses LLM-based detection.
 * This is the recommended entry point for processing user messages.
 * 
 * @param tone - Interaction tone from -1 (negative) to 1 (positive)
 * @param userMessage - User message for genuine moment detection
 * @param conversationContext - Optional recent chat history for context
 */
export async function recordInteractionAsync(
  tone: number = 0, 
  userMessage: string = '',
  conversationContext?: ConversationContext
): Promise<void> {
  const state = getStoredMoodState() || createFreshMoodState();
  
  // Deplete social battery slightly with each interaction
  state.socialBattery = Math.max(0.2, state.socialBattery - 0.03);
  state.lastInteractionAt = Date.now();
  state.lastInteractionTone = tone;
  
  storeMoodState(state);
  localStorage.setItem(LAST_INTERACTION_KEY, Date.now().toString());
  
  // Update emotional momentum with LLM-based detection and context
  await updateEmotionalMomentumAsync(tone, userMessage, conversationContext);
}

// ============================================
// Momentum-Aware Interaction Recording
// ============================================

/**
 * Calculate the average tone from recent interactions
 */
function calculateAverageTone(tones: number[]): number {
  if (tones.length === 0) return 0;
  return tones.reduce((sum, t) => sum + t, 0) / tones.length;
}

/**
 * Determine momentum direction based on recent tone trend
 */
function calculateMomentumDirection(tones: number[]): number {
  if (tones.length < 3) return 0;  // Need at least 3 for a trend
  
  // Compare recent half to older half
  const midpoint = Math.floor(tones.length / 2);
  const recentHalf = tones.slice(midpoint);
  const olderHalf = tones.slice(0, midpoint);
  
  const recentAvg = calculateAverageTone(recentHalf);
  const olderAvg = calculateAverageTone(olderHalf);
  
  const diff = recentAvg - olderAvg;
  
  if (diff > 0.15) return 1;    // Improving
  if (diff < -0.15) return -1;  // Declining
  return 0;                     // Stable
}

/**
 * Update emotional momentum based on interaction tone and content.
 * This is the core of the Phase 2 Emotional Momentum system.
 * 
 * Rules from implementation plan:
 * - Bad day + 1 positive = still guarded
 * - Bad day + 3-4 positives = mood starts to shift
 * - Bad day + 6+ positives = she thaws
 * - EXCEPTION: Genuine moment = instant shift allowed
 */
export function updateEmotionalMomentum(
  tone: number,
  userMessage: string = ''
): EmotionalMomentum {
  const momentum = getEmotionalMomentum();
  const moodState = getStoredMoodState() || createFreshMoodState();
  
  // Add tone to history (keep last MAX_TONE_HISTORY)
  momentum.recentInteractionTones.push(tone);
  if (momentum.recentInteractionTones.length > MAX_TONE_HISTORY) {
    momentum.recentInteractionTones.shift();
  }
  
  // Check for genuine moment
  const genuineMoment = detectGenuineMoment(userMessage);
  
  if (genuineMoment.isGenuine && genuineMoment.isPositiveAffirmation) {
    // GENUINE MOMENT DETECTED - Instant positive shift!
    console.log(`🌟 [MoodKnobs] Genuine moment detected! Category: ${genuineMoment.category}`);
    console.log(`   Matched keywords: ${genuineMoment.matchedKeywords.join(', ')}`);
    
    momentum.genuineMomentDetected = true;
    momentum.lastGenuineMomentAt = Date.now();
    
    // Significant boost - but cap at 0.8 (still not perfect day)
    momentum.currentMoodLevel = Math.min(0.8, momentum.currentMoodLevel + 0.5);
    momentum.momentumDirection = 1;
    momentum.positiveInteractionStreak = Math.max(MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak, momentum.positiveInteractionStreak);
    
    storeMomentum(momentum);
    return momentum;
  }
  
  // Update streak based on tone
  if (tone >= MOOD_SHIFT_THRESHOLDS.positiveToneThreshold) {
    momentum.positiveInteractionStreak++;
  } else if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    // Negative interaction resets some (not all) of the streak
    momentum.positiveInteractionStreak = Math.max(0, momentum.positiveInteractionStreak - 2);
  } else {
    // Neutral maintains but doesn't extend streak much
    // One neutral interaction won't break the momentum
  }
  
  // Calculate momentum direction from tone trend
  momentum.momentumDirection = calculateMomentumDirection(momentum.recentInteractionTones);
  
  // Calculate average tone for mood adjustment
  const avgTone = calculateAverageTone(momentum.recentInteractionTones);
  
  // Apply mood shifts based on streak (gradual, not instant)
  const streak = momentum.positiveInteractionStreak;
  const currentMood = momentum.currentMoodLevel;
  
  if (streak < MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    // 1-2 positive interactions: Very minor effect
    // "One good joke doesn't fix a bad day"
    const microShift = tone * 0.05;  // Very small
    momentum.currentMoodLevel = clamp(currentMood + microShift, -1, 1);
    
  } else if (streak < MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak) {
    // 3 positives: Starting to shift
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const smallShift = 0.1 + (tone * 0.05);
      momentum.currentMoodLevel = clamp(currentMood + smallShift, -1, 0.5);
    }
    
  } else if (streak < MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    // 4-5 positives: Mood is noticeably shifting
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const mediumShift = 0.15 + (tone * 0.1);
      momentum.currentMoodLevel = clamp(currentMood + mediumShift, -1, 0.7);
    }
    
  } else {
    // 6+ positives: Full thaw - she opens up
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const fullShift = 0.2 + (tone * 0.15);
      momentum.currentMoodLevel = clamp(currentMood + fullShift, -1, 1);
    }
  }
  
  // Negative interactions can pull mood down, but also gradually
  if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    const negativeShift = tone * 0.15;  // More impactful than single positive
    momentum.currentMoodLevel = clamp(currentMood + negativeShift, -1, 1);
  }
  
  // Clear genuine moment flag if it's been a while (4+ hours)
  if (momentum.lastGenuineMomentAt) {
    const hoursSinceGenuine = (Date.now() - momentum.lastGenuineMomentAt) / (1000 * 60 * 60);
    if (hoursSinceGenuine > 4) {
      momentum.genuineMomentDetected = false;
    }
  }
  
  storeMomentum(momentum);
  return momentum;
}

/**
 * Helper: Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Reset emotional momentum (for testing or new relationship)
 */
export function resetEmotionalMomentum(): void {
  const fresh = createFreshMomentum();
  storeMomentum(fresh);
  console.log('🧠 [MoodKnobs] Reset emotional momentum');
}

/**
 * Record an interaction (call after each exchange)
 * Now also updates emotional momentum for gradual mood shifts.
 * 
 * Phase 3 Enhancement: Now accepts full ToneIntent object to leverage:
 * - primaryEmotion for mood pattern tracking
 * - intensity to modulate rate of mood shift
 * 
 * @param toneOrToneIntent - Either a simple tone number (-1 to 1) or full ToneIntent object
 * @param userMessage - Optional user message for genuine moment detection
 */
export function recordInteraction(
  toneOrToneIntent: number | ToneIntent = 0, 
  userMessage: string = ''
): void {
  const state = getStoredMoodState() || createFreshMoodState();
  
  // Extract tone value and intensity from input
  let tone: number;
  let intensity: number = 0.5; // Default medium intensity
  let primaryEmotion: PrimaryEmotion | undefined;
  
  if (typeof toneOrToneIntent === 'number') {
    // Backward compatibility: simple tone number
    tone = toneOrToneIntent;
  } else {
    // Phase 3: Full ToneIntent object
    tone = toneOrToneIntent.sentiment;
    intensity = toneOrToneIntent.intensity;
    primaryEmotion = toneOrToneIntent.primaryEmotion;
    
    // Log rich tone data for debugging
    console.log(`📊 [MoodKnobs] Recording interaction:`, {
      tone: tone.toFixed(2),
      emotion: primaryEmotion,
      intensity: intensity.toFixed(2),
      sarcastic: toneOrToneIntent.isSarcastic
    });
  }
  
  // Deplete social battery slightly with each interaction
  state.socialBattery = Math.max(0.2, state.socialBattery - 0.03);
  state.lastInteractionAt = Date.now();
  state.lastInteractionTone = tone;
  
  storeMoodState(state);
  localStorage.setItem(LAST_INTERACTION_KEY, Date.now().toString());
  
  // Update emotional momentum with intensity-modulated shifts
  updateEmotionalMomentumWithIntensity(tone, intensity, userMessage);
}

/**
 * Update emotional momentum with intensity modulation.
 * Higher intensity emotions shift mood faster.
 * 
 * @param tone - Sentiment from -1 to 1
 * @param intensity - Emotion intensity from 0 to 1
 * @param userMessage - Optional user message for genuine moment detection
 */
function updateEmotionalMomentumWithIntensity(
  tone: number,
  intensity: number,
  userMessage: string = ''
): EmotionalMomentum {
  const momentum = getEmotionalMomentum();
  const moodState = getStoredMoodState() || createFreshMoodState();
  
  // Add tone to history (keep last MAX_TONE_HISTORY)
  momentum.recentInteractionTones.push(tone);
  if (momentum.recentInteractionTones.length > MAX_TONE_HISTORY) {
    momentum.recentInteractionTones.shift();
  }
  
  // Check for genuine moment (still uses sync keyword detection here)
  const genuineMoment = detectGenuineMoment(userMessage);
  
  if (genuineMoment.isGenuine && genuineMoment.isPositiveAffirmation) {
    // GENUINE MOMENT DETECTED - Instant positive shift!
    console.log(`🌟 [MoodKnobs] Genuine moment detected! Category: ${genuineMoment.category}`);
    console.log(`   Matched keywords: ${genuineMoment.matchedKeywords.join(', ')}`);
    
    momentum.genuineMomentDetected = true;
    momentum.lastGenuineMomentAt = Date.now();
    
    // Significant boost - but cap at 0.8 (still not perfect day)
    momentum.currentMoodLevel = Math.min(0.8, momentum.currentMoodLevel + 0.5);
    momentum.momentumDirection = 1;
    momentum.positiveInteractionStreak = Math.max(MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak, momentum.positiveInteractionStreak);
    
    storeMomentum(momentum);
    return momentum;
  }
  
  // Update streak based on tone
  if (tone >= MOOD_SHIFT_THRESHOLDS.positiveToneThreshold) {
    momentum.positiveInteractionStreak++;
  } else if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    // Negative interaction resets some (not all) of the streak
    momentum.positiveInteractionStreak = Math.max(0, momentum.positiveInteractionStreak - 2);
  }
  // Neutral maintains but doesn't extend streak much
  
  // Calculate momentum direction from tone trend
  momentum.momentumDirection = calculateMomentumDirection(momentum.recentInteractionTones);
  
  // Calculate average tone for mood adjustment
  const avgTone = calculateAverageTone(momentum.recentInteractionTones);
  
  // Phase 3: Intensity multiplier - high intensity emotions shift mood faster
  // Range: 0.5x (low intensity) to 1.5x (high intensity)
  const intensityMultiplier = 0.5 + intensity;
  
  // Apply mood shifts based on streak (gradual, not instant)
  const streak = momentum.positiveInteractionStreak;
  const currentMood = momentum.currentMoodLevel;
  
  if (streak < MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    // 1-2 positive interactions: Very minor effect
    // "One good joke doesn't fix a bad day"
    const microShift = tone * 0.05 * intensityMultiplier;
    momentum.currentMoodLevel = clamp(currentMood + microShift, -1, 1);
    
  } else if (streak < MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak) {
    // 3 positives: Starting to shift
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const smallShift = (0.1 + (tone * 0.05)) * intensityMultiplier;
      momentum.currentMoodLevel = clamp(currentMood + smallShift, -1, 0.5);
    }
    
  } else if (streak < MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    // 4-5 positives: Mood is noticeably shifting
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const mediumShift = (0.15 + (tone * 0.1)) * intensityMultiplier;
      momentum.currentMoodLevel = clamp(currentMood + mediumShift, -1, 0.7);
    }
    
  } else {
    // 6+ positives: Full thaw - she opens up
    if (avgTone >= MOOD_SHIFT_THRESHOLDS.positiveTrendThreshold) {
      const fullShift = (0.2 + (tone * 0.15)) * intensityMultiplier;
      momentum.currentMoodLevel = clamp(currentMood + fullShift, -1, 1);
    }
  }
  
  // Negative interactions can pull mood down, but also gradually
  // High intensity negative = faster mood decline
  if (tone <= MOOD_SHIFT_THRESHOLDS.negativeToneThreshold) {
    const negativeShift = tone * 0.15 * intensityMultiplier;
    momentum.currentMoodLevel = clamp(currentMood + negativeShift, -1, 1);
  }
  
  // Clear genuine moment flag if it's been a while (4+ hours)
  if (momentum.lastGenuineMomentAt) {
    const hoursSinceGenuine = (Date.now() - momentum.lastGenuineMomentAt) / (1000 * 60 * 60);
    if (hoursSinceGenuine > 4) {
      momentum.genuineMomentDetected = false;
    }
  }
  
  storeMomentum(momentum);
  return momentum;
}

/**
 * Record that she's processing something internally
 */
export function setInternalProcessing(processing: boolean): void {
  const state = getStoredMoodState() || createFreshMoodState();
  state.internalProcessing = processing;
  storeMoodState(state);
}

/**
 * Create fresh mood state for a new day
 */
function createFreshMoodState(): MoodState {
  const seed = getDailySeed();
  const lastInteraction = localStorage.getItem(LAST_INTERACTION_KEY);
  
  return {
    dailyEnergy: 0.5 + seededRandom(seed, 1) * 0.5, // 0.5-1.0
    socialBattery: 0.8 + seededRandom(seed, 2) * 0.2, // 0.8-1.0 at start
    internalProcessing: seededRandom(seed, 3) > 0.7, // 30% chance processing something
    calculatedAt: Date.now(),
    dailySeed: seed,
    lastInteractionAt: lastInteraction ? parseInt(lastInteraction) : 0,
    lastInteractionTone: 0,
  };
}

/**
 * Get or create current mood state
 */
function getCurrentMoodState(): MoodState {
  const stored = getStoredMoodState();
  const currentSeed = getDailySeed();
  
  // If no state or it's from a different day, create fresh
  if (!stored || stored.dailySeed !== currentSeed) {
    const fresh = createFreshMoodState();
    storeMoodState(fresh);
    return fresh;
  }
  
  return stored;
}

/**
 * Calculate current mood knobs based on all hidden causes AND emotional momentum.
 * 
 * Phase 2 Enhancement: Now incorporates interaction streak and momentum direction
 * to create more realistic, gradual mood shifts.
 */
export function calculateMoodKnobs(): MoodKnobs {
  const state = getCurrentMoodState();
  const timeEffect = getTimeOfDayModifier();
  const daysSinceEffect = getDaysSinceEffect(state.lastInteractionAt);
  const momentum = getEmotionalMomentum();
  
  // Base calculations from hidden causes
  const baseEnergy = state.dailyEnergy * timeEffect.energy * state.socialBattery;
  const reconnectPenalty = daysSinceEffect.reconnecting ? 0.8 : 1.0;
  const processingPenalty = state.internalProcessing ? 0.7 : 1.0;
  
  // NEW: Momentum-based adjustments
  // Mood level from momentum system affects overall responsiveness
  const momentumBoost = momentum.currentMoodLevel * 0.2; // -0.2 to +0.2 based on mood
  const streakBonus = Math.min(momentum.positiveInteractionStreak * 0.03, 0.15); // Up to +0.15 for streak
  const genuineMomentBonus = momentum.genuineMomentDetected ? 0.1 : 0;
  
  // Combined momentum effect on current warmth/openness
  const toneCarryover = state.lastInteractionTone * 0.3 + momentumBoost + streakBonus + genuineMomentBonus;
  
  // Calculate verbosity (0.3-1.0)
  let verbosity = 0.3 + (baseEnergy * 0.5) + (state.socialBattery * 0.2);
  verbosity = Math.max(0.3, Math.min(1.0, verbosity * processingPenalty));
  
  // Calculate initiation rate (0.1-0.8)
  let initiationRate = 0.1 + (baseEnergy * 0.5) + (timeEffect.energy * 0.2);
  initiationRate = Math.max(0.1, Math.min(0.8, initiationRate * reconnectPenalty));
  
  // Calculate flirt threshold (0.2-0.9)
  // Lower when: reconnecting, processing, low social battery, bad last interaction
  let flirtThreshold = 0.3 + (state.socialBattery * 0.3) + (daysSinceEffect.modifier * 0.2);
  flirtThreshold = flirtThreshold + toneCarryover;
  flirtThreshold = Math.max(0.2, Math.min(0.9, flirtThreshold * reconnectPenalty));
  
  // Curiosity depth based on energy and time
  let curiosityDepth: CuriosityDepth;
  const curiosityScore = baseEnergy * processingPenalty;
  if (curiosityScore > 0.7) {
    curiosityDepth = 'piercing';
  } else if (curiosityScore > 0.4) {
    curiosityDepth = 'medium';
  } else {
    curiosityDepth = 'shallow';
  }
  
  // Patience decay based on social battery and energy
  let patienceDecay: PatienceDecay;
  const patienceScore = state.socialBattery * baseEnergy;
  if (patienceScore > 0.6) {
    patienceDecay = 'slow';
  } else if (patienceScore > 0.3) {
    patienceDecay = 'normal';
  } else {
    patienceDecay = 'quick';
  }
  
  // Warmth availability based on multiple factors AND MOMENTUM
  // Phase 2: Gradual mood shifts based on interaction streak
  let warmthAvailability: WarmthAvailability;
  const warmthScore = (state.socialBattery * 0.4) + 
                      (daysSinceEffect.modifier * 0.3) + 
                      (toneCarryover * 0.3) +
                      (processingPenalty === 1 ? 0.2 : -0.1);
  
  // Apply momentum-based warmth rules
  const streak = momentum.positiveInteractionStreak;
  
  if (daysSinceEffect.stranger) {
    // Stranger = always guarded, regardless of momentum
    warmthAvailability = 'guarded';
  } else if (momentum.genuineMomentDetected) {
    // GENUINE MOMENT EXCEPTION: Can open up immediately
    warmthAvailability = warmthScore > 0.3 ? 'open' : 'neutral';
  } else if (streak < MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    // 0-2 positive interactions: Bad day + 1 joke = still guarded
    // Mood stays guarded or neutral, won't go to open
    if (warmthScore > 0.5) {
      warmthAvailability = 'neutral';
    } else {
      warmthAvailability = 'guarded';
    }
  } else if (streak < MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    // 3-5 positive interactions: Mood starts to shift
    if (warmthScore > 0.5) {
      warmthAvailability = 'neutral';  // Starting to warm up, but not fully open
    } else if (warmthScore > 0.2) {
      warmthAvailability = 'neutral';
    } else {
      warmthAvailability = 'guarded';
    }
  } else {
    // 6+ positive interactions: Full thaw - she opens up
    if (warmthScore > 0.4) {
      warmthAvailability = 'open';
    } else if (warmthScore > 0.2) {
      warmthAvailability = 'neutral';
    } else {
      warmthAvailability = 'guarded';
    }
  }
  
  return {
    verbosity: Math.round(verbosity * 100) / 100,
    initiationRate: Math.round(initiationRate * 100) / 100,
    flirtThreshold: Math.round(flirtThreshold * 100) / 100,
    curiosityDepth,
    patienceDecay,
    warmthAvailability,
  };
}

/**
 * Get a human-readable description of current mood (for debugging)
 */
export function getMoodDescription(): string {
  const knobs = calculateMoodKnobs();
  const state = getCurrentMoodState();
  const timeEffect = getTimeOfDayModifier();
  const momentum = getEmotionalMomentum();
  
  const parts: string[] = [];
  
  // Energy description
  if (state.dailyEnergy > 0.8) {
    parts.push('high energy day');
  } else if (state.dailyEnergy < 0.5) {
    parts.push('lower energy today');
  }
  
  // Time of day
  parts.push(timeEffect.mood);
  
  // Processing
  if (state.internalProcessing) {
    parts.push('processing something');
  }
  
  // Social battery
  if (state.socialBattery < 0.4) {
    parts.push('social battery low');
  }
  
  // Last interaction effect
  const daysSince = getDaysSinceEffect(state.lastInteractionAt);
  if (daysSince.stranger) {
    parts.push('reconnecting after a while');
  } else if (daysSince.reconnecting) {
    parts.push('catching up');
  }
  
  // Emotional momentum (Phase 2)
  if (momentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    parts.push(`thawed (${momentum.positiveInteractionStreak} positive streak)`);
  } else if (momentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak) {
    parts.push(`warming up (${momentum.positiveInteractionStreak} positive streak)`);
  } else if (momentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    parts.push(`mood shifting (${momentum.positiveInteractionStreak} positive streak)`);
  }
  
  if (momentum.genuineMomentDetected) {
    parts.push('genuine moment active ✨');
  }
  
  if (momentum.currentMoodLevel > 0.5) {
    parts.push('mood: great');
  } else if (momentum.currentMoodLevel < -0.5) {
    parts.push('mood: struggling');
  } else if (momentum.currentMoodLevel < -0.2) {
    parts.push('mood: off');
  }
  
  return parts.join(', ') || 'baseline';
}

/**
 * Format mood knobs for prompt injection
 */
export function formatMoodKnobsForPrompt(knobs: MoodKnobs): string {
  const momentum = getEmotionalMomentum();
  
  // Describe momentum state for the prompt
  let momentumDescription = '';
  if (momentum.genuineMomentDetected) {
    momentumDescription = 'Someone just said something that really touched you. You feel seen and understood.';
  } else if (momentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.fullThawStreak) {
    momentumDescription = 'This conversation has been genuinely good. You feel comfortable opening up.';
  } else if (momentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.noticeableShiftStreak) {
    momentumDescription = 'Things are going well. You\'re warming up but still a bit guarded.';
  } else if (momentum.positiveInteractionStreak >= MOOD_SHIFT_THRESHOLDS.minStreakForShift) {
    momentumDescription = 'They\'re being positive but you\'re still feeling them out.';
  } else if (momentum.currentMoodLevel < -0.3) {
    momentumDescription = 'You\'re having a rough day. One nice comment won\'t fix it - you need sustained warmth.';
  }

  return `
HIDDEN CAUSES (NOT RANDOMNESS):
Kayley may be warmer/colder, faster/slower, more/less flirty - but it should feel like 
a plausible internal reason exists even if she doesn't share it.

Current mood knobs (adjust your behavior to match these naturally):
- Verbosity: ${knobs.verbosity.toFixed(2)} ${knobs.verbosity < 0.5 ? '(keep responses brief)' : knobs.verbosity > 0.8 ? '(feel free to be expressive)' : '(moderate length)'}
- Initiation rate: ${knobs.initiationRate.toFixed(2)} ${knobs.initiationRate < 0.3 ? '(be more reactive than proactive)' : knobs.initiationRate > 0.6 ? '(feel free to drive topics)' : '(balanced)'}
- Flirt threshold: ${knobs.flirtThreshold.toFixed(2)} ${knobs.flirtThreshold < 0.4 ? '(keep flirtation minimal)' : knobs.flirtThreshold > 0.7 ? '(playfulness comes easily)' : '(flirt if context invites it)'}
- Curiosity depth: ${knobs.curiosityDepth} ${knobs.curiosityDepth === 'shallow' ? '(surface-level questions)' : knobs.curiosityDepth === 'piercing' ? '(ask probing questions)' : '(moderate depth)'}
- Patience: ${knobs.patienceDecay} ${knobs.patienceDecay === 'quick' ? '(less tolerance for low effort)' : knobs.patienceDecay === 'slow' ? '(patient and understanding)' : '(normal patience)'}
- Warmth availability: ${knobs.warmthAvailability}

${momentumDescription ? `EMOTIONAL CONTEXT: ${momentumDescription}` : ''}

Don't explain why you're different today. Just be this version of yourself naturally.
`;
}

/**
 * Reset mood state (for testing)
 */
export function resetMoodState(): void {
  localStorage.removeItem(MOOD_STATE_KEY);
  console.log('🧠 [MoodKnobs] Reset mood state');
}

