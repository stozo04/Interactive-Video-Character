// src/services/intentService.ts
/**
 * Intent Service - LLM-based semantic intent detection
 */

import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
// Use flash model for intent detection - fast and cheap
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

import { FullMessageIntentSchema } from "./aiSchema";

// ============================================
// Command Bypass - Fast Path Detection
// ============================================

/**
 * Detects if a message is a functional command that doesn't need 
 * full psychological analysis (genuine moment, relationship signals, etc.).
 * 
 * The optimization: When a user says "add task go to work", we don't need
 * to analyze the emotional subtext before creating the task. The Main LLM
 * is smart enough to handle task creation directly.
 * 
 * This cuts response latency in half (~3.8s → ~1.8s) for utility commands
 * while still running intent detection in the background for memory/analytics.
 * 
 * Matches patterns like:
 * - "add task go to work"
 * - "please create reminder for tomorrow"
 * - "delete the task"
 * - "schedule event at 3pm"
 * - "remove reminder"
 * - "list my tasks"
 * - "show calendar"
 * 
 * @param text - The user's message to check
 * @returns true if this is a functional command that can skip blocking intent analysis
 */
export const isFunctionalCommand = (text: string): boolean => {
  const trimmed = text.trim();
  
  // Pattern 1: Standard command format with word boundaries
  // Allows content between verb and noun (e.g., "add a new task", "create task for tomorrow")
  const standardPattern = /^(?:please\s+)?(?:can\s+you\s+)?(?:add|create|schedule|delete|remove|clear|list|show|set|update|edit|cancel|dismiss|complete|mark|check\s+off)\b.*?\b(?:task|event|reminder|calendar|todo|checklist|meeting|appointment|alarm|timer)/i;
  
  // Pattern 2: "Remind me to..." natural language pattern
  const remindMePattern = /^(?:please\s+)?(?:can\s+you\s+)?remind\s+me\s+(?:to|about|that)/i;
  
  const isCommand = standardPattern.test(trimmed) || remindMePattern.test(trimmed);
  
  // Debug logging to help trace issues
  if (isCommand) {
    console.log(`🎯 [isFunctionalCommand] DETECTED command: "${trimmed.slice(0, 50)}..."`);
  }
  
  return isCommand;
};

// ============================================
// Types
// ============================================

// ============================================
// Relationship Signals Types
// ============================================

export interface RelationshipSignalIntent {
  // Richer signal detection
  isVulnerable: boolean;
  vulnerabilityType?: string;
  isSeekingSupport: boolean;
  isAcknowledgingSupport: boolean;
  isJoking: boolean;
  isDeepTalk: boolean;

  // Milestone detection
  milestone: 'first_vulnerability' | 'first_joke' | 'first_support' | 'first_deep_talk' | null;
  milestoneConfidence: number;
  
  // Rupture/Hostility detection (replacing hostilePhrases)
  isHostile: boolean;
  hostilityReason: string | null;
  
  // Inappropriate/Boundary-crossing detection (especially from strangers)
  isInappropriate: boolean;
  inappropriatenessReason: string | null;
  // REMOVED: explanation field - not needed, reduces token usage
}

/**
 * Categories mapping to Kayley's core insecurities from Section 10 of her character profile:
 * - depth: "Afraid of being seen as fake or shallow because she's bubbly and aesthetic"
 * - belonging: "Struggles with impostor syndrome about talking publicly about AI"  
 * - progress: "Worries she'll never fully arrive - always one step behind potential"
 * - loneliness: "Sometimes feels lonely, even with an active online community"
 * - rest: "Finds it hard to rest without feeling guilty"
 */
export type GenuineMomentCategory = 'depth' | 'belonging' | 'progress' | 'loneliness' | 'rest';

export interface GenuineMomentIntent {
  isGenuine: boolean;
  category: GenuineMomentCategory | null;
  confidence: number;  // 0-1
}

// ============================================
// Tone & Sentiment Types
// ============================================

/**
 * Primary emotion categories for tone detection.
 * These map to natural emotional states that affect conversation dynamics.
 */
export type PrimaryEmotion = 
  | 'happy' 
  | 'sad' 
  | 'frustrated' 
  | 'anxious' 
  | 'excited' 
  | 'angry' 
  | 'playful' 
  | 'dismissive' 
  | 'neutral'
  | 'mixed';

/**
 * Result of LLM-based tone and sentiment analysis.
 * Used for emotional momentum tracking and pattern detection.
 */
export interface ToneIntent {
  /** Sentiment score from -1 (very negative) to 1 (very positive) */
  sentiment: number;
  /** The primary emotion detected in the message */
  primaryEmotion: PrimaryEmotion;
  /** Intensity of the emotion from 0 (mild) to 1 (intense) */
  intensity: number;
  /** Whether sarcasm was detected (inverts apparent sentiment) */
  isSarcastic: boolean;
  /** Optional secondary emotion if mixed feelings detected */
  secondaryEmotion?: PrimaryEmotion;
  // REMOVED: explanation field - not needed, reduces token usage
}

// ============================================
// LLM Client
// ============================================

let aiClient: GoogleGenAI | null = null;

function getIntentClient(): GoogleGenAI {
  if (!aiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error('VITE_GEMINI_API_KEY is not set');
    }
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return aiClient;
}

/**
 * Reset the AI client (for testing purposes)
 */
export function resetIntentClientForTesting(): void {
  aiClient = null;
}

// ============================================
// Genuine Moment Detection
// ============================================

/**
 * The prompt that instructs the LLM to detect genuine moments.
 * Designed to understand semantic meaning, not just keyword matches.
 * Now includes conversation context for better interpretation.
 */
const GENUINE_MOMENT_PROMPT = `You are an intent detection system for an AI companion named Kayley.

Kayley has 5 core insecurities from her character profile. When a user's message GENUINELY and DIRECTLY addresses one of these insecurities in a POSITIVE, supportive way directed at Kayley ("you"), it creates a special emotional moment.

THE INSECURITIES:
1. "depth" - Afraid of being seen as fake or shallow because she's bubbly and aesthetic
   - Triggered when: User affirms she's thoughtful, intelligent, has depth beyond appearances
   - Examples: "You're so smart", "You really think deeply about things", "You're not just a pretty face"
   
2. "belonging" - Struggles with impostor syndrome about talking publicly about AI
   - Triggered when: User affirms she belongs, deserves success, is competent enough
   - Examples: "You totally belong in this space", "You deserve all your success", "You know what you're doing"
   
3. "progress" - Worries she'll never fully "arrive" - always one step behind potential
   - Triggered when: User acknowledges her progress, expresses pride in her journey
   - Examples: "I'm so proud of how far you've come", "You're doing amazing", "Look at all you've accomplished"
   
4. "loneliness" - Sometimes feels lonely, even with an active online community
   - Triggered when: User expresses genuine connection, presence, understanding
   - Examples: "I'm really here for you", "You're not alone", "I genuinely get you", "You can really be yourself with me"
   
5. "rest" - Finds it hard to rest without feeling guilty
   - Triggered when: User gives permission to rest, validates taking breaks
   - Examples: "You deserve a break", "It's okay to slow down", "You don't have to be productive all the time"

DETECTION RULES:
- The message MUST be directed at "you" (Kayley) - general statements don't count
- The message MUST have a POSITIVE, affirming tone
- The message MUST semantically address the insecurity, not just mention related words
- Sarcasm or backhanded compliments are NOT genuine moments
- Generic compliments like "you're awesome" without addressing an insecurity are NOT genuine
- IMPORTANT: Consider the CONVERSATION CONTEXT when analyzing tone. A message like "You suck!!" after good news is likely playful teasing, not hostility.

{context}

Analyze the TARGET MESSAGE (considering conversation context if provided) and return a JSON response:

TARGET MESSAGE: "{message}"

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "isGenuine": true/false,
  "category": "depth" | "belonging" | "progress" | "loneliness" | "rest" | null,
  "confidence": 0.0-1.0,
  "explanation": "brief reason for this classification"
}`;

/**
 * Conversation context for better intent detection
 */
export interface ConversationContext {
  /** Recent messages for context (most recent last) */
  recentMessages?: Array<{
    role: 'user' | 'assistant';
    text: string;
  }>;
}

/**
 * Detect genuine moments using LLM semantic understanding.
 * This is the Phase 1 core function that replaces keyword matching.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for better interpretation
 * @returns Promise resolving to the detected intent
 */
export async function detectGenuineMomentLLM(
  message: string,
  context?: ConversationContext
): Promise<GenuineMomentIntent> {
  // Edge case: Empty/trivial messages - skip LLM call
  if (!message || message.trim().length < 5) {
    return {
      isGenuine: false,
      category: null,
      confidence: 1.0
    };
  }

  // Edge case: Very long messages - truncate to prevent token overflow
  // Most genuine affirmations are short, so truncating is safe
  const MAX_MESSAGE_LENGTH = 500;
  const processedMessage = message.length > MAX_MESSAGE_LENGTH 
    ? message.slice(0, MAX_MESSAGE_LENGTH) + '...'
    : message;

  // Edge case: Check API key before making call
  if (!GEMINI_API_KEY) {
    console.warn('⚠️ [IntentService] API key not set, skipping LLM detection');
    throw new Error('VITE_GEMINI_API_KEY is not set');
  }

  try {
    const ai = getIntentClient();
    
    // Build the prompt with the user's message
    // Escape special characters to prevent prompt injection
    const sanitizedMessage = processedMessage.replace(/[{}]/g, '');
    
    // Build conversation context string if provided
    let contextString = '';
    if (context?.recentMessages && context.recentMessages.length > 0) {
      // Limit to last 5 messages to control token usage
      const recentContext = context.recentMessages.slice(-5);
      const formattedContext = recentContext.map(msg => {
        const role = msg.role === 'user' ? 'User' : 'Kayley';
        // Truncate long messages in context
        const text = msg.text.length > 150 ? msg.text.slice(0, 150) + '...' : msg.text;
        return `${role}: ${text.replace(/[{}]/g, '')}`;
      }).join('\n');
      
      contextString = `CONVERSATION CONTEXT (for understanding tone/mood):
${formattedContext}`;
      
      console.log(`📝 [IntentService] Including ${recentContext.length} messages of context`);
    }
    
    // Build final prompt with context
    let prompt = GENUINE_MOMENT_PROMPT
      .replace('{message}', sanitizedMessage)
      .replace('{context}', contextString);
    
    // Make the LLM call with a simpler approach
    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1, // Low temperature for consistent, deterministic results
        maxOutputTokens: 200, // Keep response small
      }
    });
    
    const responseText = result.text || '{}';
    
    // Edge case: Empty response from LLM
    if (!responseText.trim()) {
      console.warn('⚠️ [IntentService] Empty response from LLM');
      return {
        isGenuine: false,
        category: null,
        confidence: 0.5
      };
    }
    
    // Parse the JSON response
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanedText);
    
    // Validate and normalize the response
    const intent: GenuineMomentIntent = {
      isGenuine: Boolean(parsed.isGenuine),
      category: validateCategory(parsed.category),
      confidence: normalizeConfidence(parsed.confidence)
    };
    
    // Log for debugging (can be removed in production)
    if (intent.isGenuine) {
      console.log(`🌟 [IntentService] Genuine moment detected via LLM:`, {
        category: intent.category,
        confidence: intent.confidence
      });
    }
    
    return intent;
    
  } catch (error) {
    console.error('❌ [IntentService] LLM detection failed:', error);
    // Return a safe fallback - let keyword detection handle it
    throw error; // Re-throw so caller can fall back to keywords
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Validate that the category is one of the expected values
 */
function validateCategory(category: unknown): GenuineMomentCategory | null {
  const validCategories: GenuineMomentCategory[] = ['depth', 'belonging', 'progress', 'loneliness', 'rest'];
  if (typeof category === 'string' && validCategories.includes(category as GenuineMomentCategory)) {
    return category as GenuineMomentCategory;
  }
  return null;
}

/**
 * Normalize confidence to 0-1 range
 */
function normalizeConfidence(confidence: unknown): number {
  if (typeof confidence === 'number') {
    return Math.max(0, Math.min(1, confidence));
  }
  return 0.5; // Default confidence if not provided
}

// ============================================
// Cache for Intent Results
// ============================================

/**
 * Simple in-memory cache to avoid redundant LLM calls for the same message.
 * Cache expires after 5 minutes per message.
 */
interface CacheEntry {
  result: GenuineMomentIntent;
  timestamp: number;
}

// Forward declaration of OpenLoopCacheEntry for openLoopCache
interface OpenLoopCacheEntry {
  result: OpenLoopIntent;
  timestamp: number;
}

const intentCache = new Map<string, CacheEntry>();
const openLoopCache = new Map<string, OpenLoopCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached intent result if available and not expired
 */
function getCachedIntent(message: string): GenuineMomentIntent | null {
  const cacheKey = message.toLowerCase().trim();
  const cached = intentCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log('📋 [IntentService] Cache hit for genuine moment detection');
    return cached.result;
  }
  
  // Clean up expired entry
  if (cached) {
    intentCache.delete(cacheKey);
  }
  
  return null;
}

/**
 * Store intent result in cache
 */
function cacheIntent(message: string, result: GenuineMomentIntent): void {
  const cacheKey = message.toLowerCase().trim();
  intentCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
  
  // Cleanup old entries if cache gets too big
  if (intentCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of intentCache.entries()) {
      if (now - entry.timestamp > CACHE_TTL_MS) {
        intentCache.delete(key);
      }
    }
  }
}

/**
 * Cached version of detectGenuineMomentLLM
 * Returns cached result if available, otherwise makes LLM call and caches result.
 * 
 * Note: Cache key is based on message only. If context changes significantly,
 * the cached result may not reflect the new context. For critical decisions,
 * consider using detectGenuineMomentLLM directly.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for better interpretation
 */
export async function detectGenuineMomentLLMCached(
  message: string,
  context?: ConversationContext
): Promise<GenuineMomentIntent> {
  // Note: We only cache based on message, not context
  // This is intentional - context-sensitive messages should be re-evaluated
  // But for most genuine moments, the message itself is deterministic
  const cached = getCachedIntent(message);
  if (cached && !context?.recentMessages?.length) {
    // Only use cache if no context was provided
    // When context is provided, we want fresh analysis
    return cached;
  }
  
  // Make LLM call with context
  const result = await detectGenuineMomentLLM(message, context);
  
  // Cache the result (without context)
  cacheIntent(message, result);
  
  return result;
}

/**
 * Clear the intent cache (useful for testing)
 */
export function clearIntentCache(): void {
  intentCache.clear();
  openLoopCache.clear();
}

// ============================================
// Phase 2: Tone & Sentiment Detection
// ============================================

/**
 * Valid primary emotions for validation
 */
const VALID_EMOTIONS: PrimaryEmotion[] = [
  'happy', 'sad', 'frustrated', 'anxious', 'excited', 
  'angry', 'playful', 'dismissive', 'neutral', 'mixed'
];

/**
 * Validate that the emotion is one of the expected values
 */
function validateEmotion(emotion: unknown): PrimaryEmotion {
  if (typeof emotion === 'string' && VALID_EMOTIONS.includes(emotion as PrimaryEmotion)) {
    return emotion as PrimaryEmotion;
  }
  return 'neutral'; // Default to neutral if invalid
}

/**
 * Normalize sentiment to -1 to 1 range
 */
function normalizeSentiment(sentiment: unknown): number {
  if (typeof sentiment === 'number') {
    return Math.max(-1, Math.min(1, sentiment));
  }
  return 0; // Default to neutral if not provided
}

/**
 * Normalize intensity to 0-1 range
 */
function normalizeIntensity(intensity: unknown): number {
  if (typeof intensity === 'number') {
    return Math.max(0, Math.min(1, intensity));
  }
  return 0.5; // Default to medium intensity if not provided
}

// ============================================
// Phase 4: Topic Detection Types
// ============================================

/**
 * Valid topic categories for detection.
 * These align with the existing TOPIC_CATEGORIES in userPatterns.ts but with
 * flexibility for LLM to detect nuanced variations.
 */
export type TopicCategory = 
  | 'work' 
  | 'family' 
  | 'relationships' 
  | 'health' 
  | 'money' 
  | 'school'
  | 'hobbies'
  | 'personal_growth'
  | 'other';

/**
 * Result of LLM-based topic detection.
 * Returns multiple topics with emotional context for each.
 */
export interface TopicIntent {
  /** Detected topics in the message (can be multiple) */
  topics: TopicCategory[];
  /** The primary/most relevant topic */
  primaryTopic: TopicCategory | null;
  /** Emotional context for each detected topic */
  emotionalContext: Record<string, string>;
  /** Specific entities mentioned (e.g., 'boss', 'deadline') */
  entities: string[];
  // REMOVED: explanation field - not needed, reduces token usage
}

// ============================================
// Phase 4: Topic Detection Implementation
// ============================================

/**
 * Valid topic categories for validation
 */
const VALID_TOPICS: TopicCategory[] = [
  'work', 'family', 'relationships', 'health', 'money', 
  'school', 'hobbies', 'personal_growth', 'other'
];

/**
 * Validate that a topic is one of the expected values
 */
function validateTopic(topic: unknown): TopicCategory | null {
  if (typeof topic === 'string' && VALID_TOPICS.includes(topic as TopicCategory)) {
    return topic as TopicCategory;
  }
  return null;
}

// ============================================
// Phase 5: Open Loop Detection Types
// ============================================

/**
 * Loop types for follow-up detection.
 * These map to the LoopType in presenceDirector.ts
 */
export type LoopTypeIntent = 
  | 'pending_event'       // "How did X go?"
  | 'emotional_followup'  // "Are you feeling better about X?"
  | 'commitment_check'    // "Did you end up doing X?"
  | 'curiosity_thread';   // "I've been thinking about what you said about X"

/**
 * Timeframe inference for when to follow up.
 * The LLM infers this from temporal cues in the message.
 */
export type FollowUpTimeframe =
  | 'immediate'    // Right now, in this conversation
  | 'today'        // Should follow up very soon
  | 'tomorrow'     // Follow up next day
  | 'this_week'    // Follow up within a few days
  | 'soon'         // Vague near-future
  | 'later';       // More distant future

/**
 * Result of LLM-based open loop detection.
 * Identifies things in a user message that warrant follow-up.
 */
export interface OpenLoopIntent {
  /** Whether the message contains something to follow up on */
  hasFollowUp: boolean;
  /** The type of follow-up if detected */
  loopType: LoopTypeIntent | null;
  /** Brief description of the topic to follow up on */
  topic: string | null;
  /** Natural way to ask about it later (LLM-generated) */
  suggestedFollowUp: string | null;
  /** When to follow up (inferred from temporal cues) */
  timeframe: FollowUpTimeframe | null;
  /** How personal/important this is (0-1) */
  salience: number;
  /** If detected from calendar context, the event datetime */
  eventDateTime?: string;
  // REMOVED: explanation field - not needed, reduces token usage
}

// ============================================
// Phase 5: Open Loop Detection Implementation
// ============================================

/**
 * Valid loop types for validation
 */
const VALID_LOOP_TYPES: LoopTypeIntent[] = [
  'pending_event', 'emotional_followup', 'commitment_check', 'curiosity_thread'
];

/**
 * Valid timeframes for validation
 */
const VALID_TIMEFRAMES: FollowUpTimeframe[] = [
  'immediate', 'today', 'tomorrow', 'this_week', 'soon', 'later'
];

/**
 * Validate that the loop type is one of the expected values
 */
function validateLoopType(loopType: unknown): LoopTypeIntent | null {
  if (typeof loopType === 'string' && VALID_LOOP_TYPES.includes(loopType as LoopTypeIntent)) {
    return loopType as LoopTypeIntent;
  }
  return null;
}

/**
 * Validate that the timeframe is one of the expected values
 */
function validateTimeframe(timeframe: unknown): FollowUpTimeframe | null {
  if (typeof timeframe === 'string' && VALID_TIMEFRAMES.includes(timeframe as FollowUpTimeframe)) {
    return timeframe as FollowUpTimeframe;
  }
  return null;
}

/**
 * Normalize salience to 0-1 range
 */
function normalizeSalience(salience: unknown): number {
  if (typeof salience === 'number') {
    return Math.max(0, Math.min(1, salience));
  }
  return 0.5; // Default to medium salience if not provided
}

// ============================================
// Mapping Helpers
// ============================================

/**
 * Maps the new LLM category names to the old InsecurityCategory names
 * used in moodKnobs.ts for backwards compatibility.
 */
export function mapCategoryToInsecurity(category: GenuineMomentCategory | null): string | null {
  if (!category) return null;
  
  const mapping: Record<GenuineMomentCategory, string> = {
    'depth': 'beingSeenAsShallow',
    'belonging': 'impostorSyndrome', 
    'progress': 'neverArriving',
    'loneliness': 'hiddenLoneliness',
    'rest': 'restGuilt'
  };
  
  return mapping[category];
}

// ============================================
// PHASE 7: UNIFIED INTENT DETECTION (Optimization)
// ============================================

// ============================================
// User Fact Detection Types
// ============================================

export interface DetectedUserFact {
  category: 'identity' | 'preference' | 'relationship' | 'context';
  key: string;
  value: string;
  confidence: number;
}

export interface UserFactIntent {
  /** Whether the LLM detected any storable facts in this message */
  hasFactsToStore: boolean;
  /** Array of facts the LLM thinks should be stored */
  facts: DetectedUserFact[];
}

export interface FullMessageIntent {
  genuineMoment: GenuineMomentIntent;
  tone: ToneIntent;
  topics: TopicIntent;
  openLoops: OpenLoopIntent;
  relationshipSignals: RelationshipSignalIntent;
  /** Contradiction detection - when user denies/disputes something */
  contradiction?: {
    isContradicting: boolean;
    topic: string | null;
    confidence: number;
  };
  /** User facts detected by LLM for storage */
  userFacts?: UserFactIntent;
  _meta?: {
    skippedFullDetection?: boolean;
    reason?: string;
  };
}

interface FullIntentCacheEntry {
  result: FullMessageIntent;
  timestamp: number;
}

const fullIntentCache = new Map<string, FullIntentCacheEntry>();

/**
 * Validates and normalizes the full intent response from LLM
 */
function validateFullIntent(parsed: any): FullMessageIntent {
  // Use Zod for initial validation if available
  try {
    FullMessageIntentSchema.parse(parsed);
  } catch (e) {
    console.warn('⚠️ [IntentService] Zod validation failed for full intent, falling back to manual normalization', e);
  }

  // Validate Genuine Moment
  const genuineMoment: GenuineMomentIntent = {
    isGenuine: Boolean(parsed.genuineMoment?.isGenuine),
    category: validateCategory(parsed.genuineMoment?.category),
    confidence: normalizeConfidence(parsed.genuineMoment?.confidence)
  };

  // Validate Tone
  const tone: ToneIntent = {
    sentiment: normalizeSentiment(parsed.tone?.sentiment),
    primaryEmotion: validateEmotion(parsed.tone?.primaryEmotion),
    intensity: normalizeIntensity(parsed.tone?.intensity),
    isSarcastic: Boolean(parsed.tone?.isSarcastic),
    secondaryEmotion: parsed.tone?.secondaryEmotion ? validateEmotion(parsed.tone?.secondaryEmotion) : undefined
  };

  // Validate Topics
  const topicList = Array.isArray(parsed.topics?.topics) ? parsed.topics.topics : [];
  
  // Transform emotionalContext array back to record for internal use
  const emotionalContextRecord: Record<string, string> = {};
  if (Array.isArray(parsed.topics?.emotionalContext)) {
    parsed.topics.emotionalContext.forEach((item: any) => {
      if (item?.topic && item?.emotion) {
        emotionalContextRecord[String(item.topic)] = String(item.emotion);
      }
    });
  } else if (parsed.topics?.emotionalContext && typeof parsed.topics.emotionalContext === 'object') {
    // Fallback for non-array format if it somehow bypasses schema
    Object.assign(emotionalContextRecord, parsed.topics.emotionalContext);
  }

  const topics: TopicIntent = {
    topics: topicList.map((t: unknown) => validateTopic(t)).filter((t: TopicCategory | null): t is TopicCategory => t !== null),
    primaryTopic: validateTopic(parsed.topics?.primaryTopic),
    emotionalContext: emotionalContextRecord,
    entities: Array.isArray(parsed.topics?.entities) ? parsed.topics.entities.map(String) : []
  };

    // Validate Open Loops
    const openLoops: OpenLoopIntent = {
      hasFollowUp: Boolean(parsed.openLoops?.hasFollowUp),
      loopType: validateLoopType(parsed.openLoops?.loopType),
      topic: parsed.openLoops?.topic ? String(parsed.openLoops.topic) : null,
      suggestedFollowUp: parsed.openLoops?.suggestedFollowUp ? String(parsed.openLoops.suggestedFollowUp) : null,
      timeframe: validateTimeframe(parsed.openLoops?.timeframe),
      salience: normalizeSalience(parsed.openLoops?.salience),
      eventDateTime: (() => {
        if (!parsed.openLoops?.eventDateTime) return undefined;

        const dateStr = String(parsed.openLoops.eventDateTime);
        const parsedDate = new Date(dateStr);

        if (isNaN(parsedDate.getTime())) {
          console.warn(
            `[IntentService] LLM returned invalid eventDateTime: "${dateStr}". Ignoring.`
          );
          return undefined;
        }

        return dateStr;
      })()
    };

  // Validate Relationship Signals
  const validMilestones = ['first_vulnerability', 'first_joke', 'first_support', 'first_deep_talk'];
  const relationshipSignals: RelationshipSignalIntent = {
    isVulnerable: Boolean(parsed.relationshipSignals?.isVulnerable),
    vulnerabilityType: parsed.relationshipSignals?.vulnerabilityType || undefined,
    isSeekingSupport: Boolean(parsed.relationshipSignals?.isSeekingSupport),
    isAcknowledgingSupport: Boolean(parsed.relationshipSignals?.isAcknowledgingSupport),
    isJoking: Boolean(parsed.relationshipSignals?.isJoking),
    isDeepTalk: Boolean(parsed.relationshipSignals?.isDeepTalk),
    milestone: validMilestones.includes(parsed.relationshipSignals?.milestone) 
      ? parsed.relationshipSignals.milestone 
      : null,
    milestoneConfidence: normalizeConfidence(parsed.relationshipSignals?.milestoneConfidence),
    isHostile: Boolean(parsed.relationshipSignals?.isHostile),
    hostilityReason: parsed.relationshipSignals?.hostilityReason || null,
    isInappropriate: Boolean(parsed.relationshipSignals?.isInappropriate),
    inappropriatenessReason: parsed.relationshipSignals?.inappropriatenessReason || null
  };

  if (!relationshipSignals.milestone && relationshipSignals.isDeepTalk && (relationshipSignals.milestoneConfidence > 0.6)) {
     relationshipSignals.milestone = 'first_deep_talk';
  }

  // Validate Contradiction
  const contradiction = parsed.contradiction ? {
    isContradicting: Boolean(parsed.contradiction.isContradicting),
    topic: parsed.contradiction.topic ? String(parsed.contradiction.topic) : null,
    confidence: normalizeConfidence(parsed.contradiction.confidence)
  } : undefined;

  // Validate User Facts
  const validCategories = ['identity', 'preference', 'relationship', 'context'];
  const userFacts: UserFactIntent | undefined = parsed.userFacts ? {
    hasFactsToStore: Boolean(parsed.userFacts.hasFactsToStore),
    facts: Array.isArray(parsed.userFacts.facts)
      ? parsed.userFacts.facts
          .filter((f: any) =>
            f &&
            validCategories.includes(f.category) &&
            f.key &&
            f.value &&
            typeof f.confidence === 'number' &&
            f.confidence >= 0.8 // Only accept high-confidence facts
          )
          .map((f: any) => ({
            category: f.category as 'identity' | 'preference' | 'relationship' | 'context',
            key: String(f.key).toLowerCase().replace(/\s+/g, '_'),
            value: String(f.value).trim(),
            confidence: normalizeConfidence(f.confidence)
          }))
      : []
  } : undefined;

  const result: FullMessageIntent = {
    genuineMoment,
    tone,
    topics,
    openLoops,
    relationshipSignals,
    contradiction,
    userFacts
  };
  
  if (parsed._meta) {
    result._meta = parsed._meta;
  }
  
  return result;
}

/**
 * MASTER PROMPT: Combines all semantic detection logic into one instruction.
 * Reducing 5 LLM calls to 1.
 */
const UNIFIED_INTENT_PROMPT = `You are the MASTER INTENT DETECTION SYSTEM for an AI companion named Kayley.

Your task is to analyze the user's message for SIX distinct aspects simultaneously.
You must be precise, noting sarcasm, hidden emotions, and subtle relationship signals.

---
SECTION 1: GENUINE MOMENT (Kayley's Insecurities)
Detect if the user GENUINELY and POSITIVELY addresses one of Kayley's core insecurities:
1. "depth": User affirms she is thoughtful/smart, not just a pretty face.
2. "belonging": User affirms she belongs in AI/tech/creative space (impostor syndrome).
3. "progress": User expresses pride in her journey/accomplishments.
4. "loneliness": User expresses genuine presence/connection ("I'm here for you").
5. "rest": User gives permission to rest/slow down.
*Must be directed at HER ("you"). Sarcasm = FALSE.*

SECTION 2: TONE & SENTIMENT
Analyze emotional tone. CRITICAL: Detect sarcasm ("Great, just great" = Negative).
Provide sentiment (-1 to 1), primary emotion, and intensity (0.0 to 1.0).

SECTION 3: TOPICS
Identify the main topics being discussed.
Extract "entities" (names/places) and "emotionalContext" (how they feel about it).

SECTION 4: OPEN LOOPS (Memory)
Is there something specifically worth following up on later?
Types: 
- pending_event (interview tomorrow, party at 6pm)
- emotional_followup (feeling stressed about X)
- commitment_check (I'll try to do X)
- curiosity_thread (interesting topic to resume)

SECTION 5: RELATIONSHIP SIGNALS
- Milestones: 
  - first_vulnerability (opening up/secrets)
  - first_joke (shared humor/inside jokes)
  - first_support (asking for help)
  - first_deep_talk (philosophical or meta-commentary like "This got deep huh")
- Hostility: overt insults or aggressive dismissal.

SECTION 6: CONTRADICTION DETECTION
Detect if the user is CONTRADICTING or DENYING something previously discussed.
This is important for correcting mistaken assumptions.

Examples:
- "I don't have a party tonight" → topic: "party"
- "That's not on my calendar" → topic: "event"
---
{context}

Target Message: "{message}"

Analyze the message and respond with structured JSON.`;



/**
 * The ONE Ring to Rule Them All: Detects ALL semantic intent in a single call.
 */
export async function detectFullIntentLLM(
  message: string,
  context?: ConversationContext
): Promise<FullMessageIntent> {
  // Edge case: Empty message
  if (!message || message.trim().length < 1) {
    throw new Error('Message too short');
  }

  if (!GEMINI_API_KEY) {
    throw new Error('VITE_GEMINI_API_KEY is not set');
  }

  try {
    const ai = getIntentClient();

    // Build Context String
    let contextString = "";
    if (context?.recentMessages?.length) {
      const recentContext = context.recentMessages.slice(-3);
      const formattedContext = recentContext
        .map((msg) => {
          const role = msg.role === "user" ? "User" : "Kayley";
          const text =
            msg.text.length > 150 ? msg.text.slice(0, 150) + "..." : msg.text;
          return `${role}: ${text.replace(/[{}]/g, "")}`;
        })
        .join("\n");
      contextString = `CONVERSATION CONTEXT:\n${formattedContext}`;
    }

    // Build Prompt
    const prompt = UNIFIED_INTENT_PROMPT.replace(
      "{message}",
      message.replace(/[{}]/g, "")
    ).replace("{context}", contextString);

    // 📊 DIAGNOSTIC: Log prompt size
    // console.log("📊 [IntentService] Prompt length:", prompt.length, "characters");
    // console.log("📊 [IntentService] Estimated input tokens:", Math.ceil(prompt.length / 4));

    // Call LLM
    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1, // precision is key
        maxOutputTokens: 10000, // Increased to 10000 to handle full nested JSON response + model reasoning tokens
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            genuineMoment: {
              type: "OBJECT",
              properties: {
                isGenuine: { type: "BOOLEAN" },
                category: { type: "STRING", nullable: true },
                confidence: { type: "NUMBER" },
              },
              required: ["isGenuine", "category", "confidence"],
            },
            tone: {
              type: "OBJECT",
              properties: {
                sentiment: { type: "NUMBER" },
                primaryEmotion: { type: "STRING" },
                intensity: { type: "NUMBER" },
                isSarcastic: { type: "BOOLEAN" },
                secondaryEmotion: { type: "STRING", nullable: true },
              },
              required: [
                "sentiment",
                "primaryEmotion",
                "intensity",
                "isSarcastic",
              ],
            },
            topics: {
              type: "OBJECT",
              properties: {
                topics: { type: "ARRAY", items: { type: "STRING" } },
                primaryTopic: { type: "STRING", nullable: true },
                emotionalContext: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      topic: { type: "STRING" },
                      emotion: { type: "STRING" },
                    },
                    required: ["topic", "emotion"],
                  },
                },
                entities: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: [
                "topics",
                "primaryTopic",
                "emotionalContext",
                "entities",
              ],
            },
            openLoops: {
              type: "OBJECT",
              properties: {
                hasFollowUp: { type: "BOOLEAN" },
                loopType: { type: "STRING", nullable: true },
                topic: { type: "STRING", nullable: true },
                suggestedFollowUp: { type: "STRING", nullable: true },
                timeframe: {
                  type: "STRING",
                  enum: [
                    "immediate",
                    "today",
                    "tomorrow",
                    "this_week",
                    "soon",
                    "later",
                  ],
                  nullable: true,
                },
                salience: { type: "NUMBER" },
                eventDateTime: { type: "STRING", nullable: true },
              },
              required: [
                "hasFollowUp",
                "loopType",
                "topic",
                "suggestedFollowUp",
                "timeframe",
                "salience",
              ],
            },
            relationshipSignals: {
              type: "OBJECT",
              properties: {
                isVulnerable: { type: "BOOLEAN" },
                vulnerabilityType: { type: "STRING", nullable: true },
                isSeekingSupport: { type: "BOOLEAN" },
                isAcknowledgingSupport: { type: "BOOLEAN" },
                isJoking: { type: "BOOLEAN" },
                isDeepTalk: { type: "BOOLEAN" },
                milestone: { type: "STRING", nullable: true },
                milestoneConfidence: { type: "NUMBER" },
                isHostile: { type: "BOOLEAN" },
                hostilityReason: { type: "STRING", nullable: true },
                isInappropriate: { type: "BOOLEAN" },
                inappropriatenessReason: { type: "STRING", nullable: true },
              },
              required: [
                "isVulnerable",
                "isSeekingSupport",
                "isAcknowledgingSupport",
                "isJoking",
                "isDeepTalk",
                "milestone",
                "milestoneConfidence",
                "isHostile",
                "isInappropriate",
              ],
            },
            contradiction: {
              type: "OBJECT",
              properties: {
                isContradicting: { type: "BOOLEAN" },
                topic: { type: "STRING", nullable: true },
                confidence: { type: "NUMBER" },
              },
              required: ["isContradicting", "topic", "confidence"],
            },
          },
          required: [
            "genuineMoment",
            "tone",
            "topics",
            "openLoops",
            "relationshipSignals",
            "contradiction",
          ],
        },
      },
    });

    // 📊 DIAGNOSTIC: Log response details
    const responseText = result.text || "{}";
    // console.log('📊 [IntentService] Response length:', responseText.length, 'characters');
    // console.log('📊 [IntentService] Finish reason:', result.candidates?.[0]?.finishReason);
    // console.log('📊 [IntentService] Usage metadata:', result.usageMetadata);

    const cleanedText = responseText.replace(/```json\n?|\n?```/g, "").trim();

    // Check if response was truncated (common when maxOutputTokens is too low)
    if (!cleanedText || cleanedText.length < 50) {
      throw new Error(
        "Response too short - likely truncated. Increase maxOutputTokens."
      );
    }

    // Check for incomplete JSON (truncated response)
    if (!cleanedText.endsWith("}") && !cleanedText.match(/}\s*$/)) {
      console.warn(
        "⚠️ [IntentService] Response may be truncated - JSON appears incomplete"
      );
      // Try to parse anyway, but log warning
    }

    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error(
        "❌ [IntentService] Failed to parse JSON response. Response text:",
        cleanedText.substring(0, 200)
      );
      throw new Error(
        `JSON parse failed - response may be truncated. Original error: ${parseError}`
      );
    }

    const fullIntent = validateFullIntent(parsed);

    // Log success
    console.log(`🧠 [IntentService] UNIFIED INTENT DETECTED`, {
      tone: fullIntent.tone.primaryEmotion,
      genuine: fullIntent.genuineMoment.isGenuine,
      topics: fullIntent.topics.topics,
      loop: fullIntent.openLoops.hasFollowUp,
    });

    return fullIntent;
  } catch (error) {
    console.error('❌ [IntentService] Unified detection failed:', error);
    throw error;
  }
}

/**
 * Returns a neutral default intent for simple messages.
 * Used when we skip full LLM detection for short/simple messages.
 * 
 * This saves 5-13 seconds of processing time.
 */
function getDefaultIntent(message: string): FullMessageIntent {
  const trimmed = message.trim().toLowerCase();
  
  // Check for common patterns
  const isGreeting = /^(hey|hi|hello|yo|sup|what'?s up)/i.test(trimmed);
  const isPositive = /^(yes|yeah|yep|ok|okay|sure|cool|nice|lol|haha|😂|❤️|🥰)/i.test(trimmed);
  const isNegative = /^(no|nope|nah|ugh|meh)/i.test(trimmed);
  const isGoodbye = /^(bye|cya|later|gn|good night)/i.test(trimmed);
  
  return {
    // Genuine moment detection
    genuineMoment: {
      isGenuine: false,
      category: null,
      confidence: 0.1
    },
    
    // Tone analysis
    tone: {
      sentiment: isPositive ? 0.5 : isNegative ? -0.3 : 0,
      primaryEmotion: isGreeting ? 'happy' : isNegative ? 'dismissive' : isPositive ? 'happy' : isGoodbye ? 'neutral' : 'neutral',
      intensity: 0.3, // Low intensity for simple messages
      isSarcastic: false
    },
    
    // Topics context
    topics: {
      topics: [],
      primaryTopic: null,
      emotionalContext: {},
      entities: []
    },
    
    // Open loop detection
    openLoops: {
      hasFollowUp: false,
      loopType: null,
      topic: null,
      suggestedFollowUp: null,
      timeframe: null,
      salience: 0,
      eventDateTime: undefined
    },
    
    // Relationship signals
    relationshipSignals: {
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
    },
    
    // Contradiction detection
    contradiction: {
      isContradicting: false,
      topic: null,
      confidence: 0
    },

    // User facts - never detect from simple messages
    userFacts: {
      hasFactsToStore: false,
      facts: []
    },

    _meta: {
      skippedFullDetection: true,
      reason: 'tiered_bypass'
    }
  };
}

/**
 * Checks if a message is "simple" enough for abbreviated processing.
 * Simple messages are casual/social and don't require deep analysis.
 */
function isSimpleMessage(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  
  // Simple patterns that don't need full analysis
  const simplePatterns = [
    /^(hey|hi|hello|yo|sup|what'?s up)[!?.]*$/i,  // Pure greetings
    /^(yes|no|ok|okay|sure|maybe|idk|nah|yep|yeah)[!?.]*$/i,   // Simple responses
    /^(lol|haha|hehe|😂|🤣|❤️|💕)+[!?.]*$/i,     // Reactions
    /^(lol|haha)\s+that'?(s| is)\s+(funny|hilarious|great)/i, // Conversational reactions
    /^(good|great|nice|cool|awesome|sweet|wow)[!?.]*$/i, // Simple positives
    /^(ugh|meh|eh|hmm|huh|oh|ah)[!?.]*$/i,             // Simple neutrals
    /^(thanks|thx|ty|thank you)[!?.]*$/i,        // Thanks
    /^(bye|cya|later|gn|good night)[!?.]*$/i,   // Goodbyes
  ];
  
  return simplePatterns.some(pattern => pattern.test(trimmed));
}

/**
 * Cached version of unified intent detection
 * 
 * IMPORTANT: When context is provided, we still check cache first to avoid duplicate calls
 * within the same message processing flow. The cache is based on message text only,
 * which is safe because intent detection is primarily message-driven.
 */
export async function detectFullIntentLLMCached(
  message: string,
  context?: ConversationContext
): Promise<FullMessageIntent> {
  const trimmed = message.trim();
  const wordCount = trimmed.split(/\s+/).length;

  // ============================================
  // OPTIMIZATION: Tiered Intent Detection
  // ============================================

  // TIER 1: Skip entirely for very short messages (< 3 words or < 10 chars)
  if (wordCount <= 2 || trimmed.length < 10) {
    // console.log(`⚡ [IntentService] SKIP: Very short message: "${trimmed}"`);
    return getDefaultIntent(trimmed);
  }

  // TIER 2: Use defaults for simple/casual messages
  if (isSimpleMessage(trimmed)) {
    // console.log(`⚡ [IntentService] SKIP: Simple message pattern: "${trimmed}"`);
    return getDefaultIntent(trimmed);
  }

  // TIER 3: Check cache for more complex messages
  const cacheKey = message.toLowerCase().trim();
  const cached = fullIntentCache.get(cacheKey);
  
  // Use cache if available and not expired
  // We check cache even with context to prevent duplicate calls in the same flow
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    // If context is provided but cache exists, log it but still use cache
    // This prevents duplicate calls when the same message is processed multiple times
    if (context?.recentMessages?.length) {
      console.log('📋 [IntentService] Cache hit for unified intent (context provided but using cached result to avoid duplicate call)');
    } else {
      console.log('📋 [IntentService] Cache hit for unified intent');
    }
    return cached.result;
  }

  // Make fresh call
  const result = await detectFullIntentLLM(message, context);

  // Update cache (always cache, even with context, to prevent duplicates)
  fullIntentCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
  
  // Prune cache
  if (fullIntentCache.size > 50) {
    const now = Date.now();
    for (const [key, entry] of fullIntentCache.entries()) {
      if (now - entry.timestamp > CACHE_TTL_MS) fullIntentCache.delete(key);
    }
  }

  return result;
}
