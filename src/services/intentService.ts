// src/services/intentService.ts
/**
 * Intent Service - LLM-based semantic intent detection
 * 
 * Phase 1: Genuine moment detection
 * Phase 2: Tone & sentiment detection with sarcasm handling
 * 
 * Replaces hardcoded keyword matching with LLM understanding.
 * Uses gemini-2.5-flash for fast, cheap intent detection (~200ms, ~$0.0001/call)
 */

import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
// Use flash model for intent detection - fast and cheap
// Switched from gemini-2.5-flash to gemini-2.0-flash-exp for lower latency
const INTENT_MODEL = 'gemini-2.0-flash-exp';

// ============================================
// Types
// ============================================

// ============================================
// Phase 6: Relationship Signals Types
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
  // REMOVED: explanation field - not needed, reduces token usage
}

// ============================================
// Phase 2: Tone & Sentiment Types
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
// Genuine Moment Detection (Phase 1)
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
      model: INTENT_MODEL,
      contents: prompt,
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

// Forward declaration of ToneCacheEntry for toneCache
interface ToneCacheEntry {
  result: ToneIntent;
  timestamp: number;
}

// Forward declaration of TopicCacheEntry for topicCache
interface TopicCacheEntry {
  result: TopicIntent;
  timestamp: number;
}

// Forward declaration of OpenLoopCacheEntry for openLoopCache
interface OpenLoopCacheEntry {
  result: OpenLoopIntent;
  timestamp: number;
}

// Forward declaration of RelationshipSignalCacheEntry for relationshipCache
interface RelationshipSignalCacheEntry {
  result: RelationshipSignalIntent;
  timestamp: number;
}

const intentCache = new Map<string, CacheEntry>();
const toneCache = new Map<string, ToneCacheEntry>();
const topicCache = new Map<string, TopicCacheEntry>();
const openLoopCache = new Map<string, OpenLoopCacheEntry>();
const relationshipCache = new Map<string, RelationshipSignalCacheEntry>();
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
  toneCache.clear();
  topicCache.clear();
  openLoopCache.clear();
  relationshipCache.clear();
}

// ============================================
// Phase 2: Tone & Sentiment Detection
// ============================================

/**
 * The prompt that instructs the LLM to detect tone and sentiment.
 * Designed to understand nuanced emotional expressions including sarcasm,
 * mixed emotions, and context-dependent meanings.
 */
const TONE_DETECTION_PROMPT = `You are a tone and sentiment analysis system for an AI companion.

Your task is to accurately detect the EMOTIONAL TONE of a message, paying special attention to:
1. Sarcasm and irony (words may say one thing but mean another)
2. Mixed emotions (people often feel multiple things at once)
3. Context-dependent meaning (same words can have different tones in different situations)
4. Intensity (from mild to intense expression)

SARCASM DETECTION IS CRITICAL:
- "Great, just great" → SARCASTIC, negative sentiment
- "Oh wonderful" after bad news → SARCASTIC, negative sentiment
- "I'm SO happy" (with exaggeration markers) → Check context for sarcasm
- "Sure, whatever" → Often dismissive/sarcastic
- "Yeah right" → Usually sarcastic

EMOJI-ONLY OR MINIMAL MESSAGES:
- "😊" → Happy, positive, mild intensity
- "😭" → Sad or overwhelmed, negative, can be playful if context shows humor
- "😤" → Frustrated/angry, negative
- "..." → Often contemplative or dismissive depending on context
- "fine." → Often passive-aggressive/dismissive, check context

MIXED EMOTIONS (return secondaryEmotion when present):
- "I'm excited but also nervous" → excited + anxious
- "Happy but kinda worried" → happy + anxious
- "Sad but grateful" → sad + happy

EMOTION CATEGORIES:
- happy: genuine joy, contentment, satisfaction
- sad: sadness, disappointment, grief
- frustrated: annoyance, irritation, impatience
- anxious: worry, nervousness, stress
- excited: enthusiasm, anticipation, eagerness
- angry: anger, outrage, hostility
- playful: teasing, joking, banter (even if words seem negative - like "you suck" after good news)
- dismissive: indifference, apathy, "whatever" attitude
- neutral: no strong emotion detected
- mixed: multiple emotions present (specify in secondaryEmotion)

{context}

TARGET MESSAGE: "{message}"

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "sentiment": -1.0 to 1.0 (negative to positive, AFTER accounting for sarcasm),
  "primaryEmotion": "one of the emotion categories above",
  "intensity": 0.0 to 1.0 (how strongly expressed),
  "isSarcastic": true/false,
  "secondaryEmotion": "optional, if mixed emotions detected",
  "explanation": "brief reason for this analysis"
}`;

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

/**
 * Detect tone and sentiment using LLM semantic understanding.
 * This is the Phase 2 core function that replaces keyword-based tone analysis.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 * @returns Promise resolving to the detected tone
 */
export async function detectToneLLM(
  message: string,
  context?: ConversationContext
): Promise<ToneIntent> {
  // Edge case: Empty/trivial messages - return neutral
  if (!message || message.trim().length < 1) {
    return {
      sentiment: 0,
      primaryEmotion: 'neutral',
      intensity: 0,
      isSarcastic: false
    };
  }

  // Edge case: Very long messages - truncate to prevent token overflow
  const MAX_MESSAGE_LENGTH = 500;
  const processedMessage = message.length > MAX_MESSAGE_LENGTH 
    ? message.slice(0, MAX_MESSAGE_LENGTH) + '...'
    : message;

  // Edge case: Check API key before making call
  if (!GEMINI_API_KEY) {
    console.warn('⚠️ [IntentService] API key not set, skipping LLM tone detection');
    throw new Error('VITE_GEMINI_API_KEY is not set');
  }

  try {
    const ai = getIntentClient();
    
    // Sanitize message to prevent prompt injection
    const sanitizedMessage = processedMessage.replace(/[{}]/g, '');
    
    // Build conversation context string if provided
    let contextString = '';
    if (context?.recentMessages && context.recentMessages.length > 0) {
      const recentContext = context.recentMessages.slice(-5);
      const formattedContext = recentContext.map(msg => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const text = msg.text.length > 150 ? msg.text.slice(0, 150) + '...' : msg.text;
        return `${role}: ${text.replace(/[{}]/g, '')}`;
      }).join('\n');
      
      contextString = `CONVERSATION CONTEXT (CRITICAL for interpreting tone correctly):
${formattedContext}`;
      
      console.log(`📝 [IntentService] Tone detection with ${recentContext.length} messages of context`);
    }
    
    // Build final prompt with context
    let prompt = TONE_DETECTION_PROMPT
      .replace('{message}', sanitizedMessage)
      .replace('{context}', contextString);
    
    // Make the LLM call
    const result = await ai.models.generateContent({
      model: INTENT_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1, // Low temperature for consistent results
        maxOutputTokens: 200,
      }
    });
    
    const responseText = result.text || '{}';
    
    // Edge case: Empty response from LLM
    if (!responseText.trim()) {
      console.warn('⚠️ [IntentService] Empty response from LLM for tone detection');
      return {
        sentiment: 0,
        primaryEmotion: 'neutral',
        intensity: 0.5,
        isSarcastic: false
      };
    }
    
    // Parse the JSON response
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanedText);
    
    // Validate and normalize the response
    const toneIntent: ToneIntent = {
      sentiment: normalizeSentiment(parsed.sentiment),
      primaryEmotion: validateEmotion(parsed.primaryEmotion),
      intensity: normalizeIntensity(parsed.intensity),
      isSarcastic: Boolean(parsed.isSarcastic),
      secondaryEmotion: parsed.secondaryEmotion ? validateEmotion(parsed.secondaryEmotion) : undefined
    };
    
    // Log for debugging
    console.log(`🎭 [IntentService] Tone detected via LLM:`, {
      sentiment: toneIntent.sentiment.toFixed(2),
      emotion: toneIntent.primaryEmotion,
      intensity: toneIntent.intensity.toFixed(2),
      sarcastic: toneIntent.isSarcastic,
      secondary: toneIntent.secondaryEmotion
    });
    
    return toneIntent;
    
  } catch (error) {
    console.error('❌ [IntentService] Tone LLM detection failed:', error);
    throw error; // Re-throw so caller can fall back to keywords
  }
}

// ============================================
// Tone Cache
// ============================================

/**
 * Get cached tone result if available and not expired
 */
function getCachedTone(message: string): ToneIntent | null {
  const cacheKey = message.toLowerCase().trim();
  const cached = toneCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log('📋 [IntentService] Cache hit for tone detection');
    return cached.result;
  }
  
  // Clean up expired entry
  if (cached) {
    toneCache.delete(cacheKey);
  }
  
  return null;
}

/**
 * Store tone result in cache
 */
function cacheTone(message: string, result: ToneIntent): void {
  const cacheKey = message.toLowerCase().trim();
  toneCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
  
  // Cleanup old entries if cache gets too big
  if (toneCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of toneCache.entries()) {
      if (now - entry.timestamp > CACHE_TTL_MS) {
        toneCache.delete(key);
      }
    }
  }
}

/**
 * Cached version of detectToneLLM.
 * Returns cached result if available, otherwise makes LLM call and caches result.
 * 
 * Note: Cache key is based on message only. When context is provided,
 * we skip the cache to ensure accurate interpretation.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 */
export async function detectToneLLMCached(
  message: string,
  context?: ConversationContext
): Promise<ToneIntent> {
  // Only use cache if no context was provided
  const cached = getCachedTone(message);
  if (cached && !context?.recentMessages?.length) {
    return cached;
  }
  
  // Make LLM call with context
  const result = await detectToneLLM(message, context);
  
  // Cache the result (without context)
  cacheTone(message, result);
  
  return result;
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
 * The prompt that instructs the LLM to detect topics and emotional context.
 * Designed to understand semantic meaning and extract emotional associations.
 */
const TOPIC_DETECTION_PROMPT = `You are a topic and context analysis system for an AI companion.

Your task is to identify WHAT topics a message is about and HOW the user feels about each topic.

TOPIC CATEGORIES:
- work: job, career, boss, coworkers, meetings, projects, deadlines, office
- family: parents, siblings, relatives, family dynamics, family events
- relationships: romantic relationships, dating, partners, breakups, crushes
- health: physical health, mental health, exercise, diet, therapy, medical
- money: finances, bills, debt, savings, expenses, budgeting
- school: education, classes, exams, homework, professors, studying
- hobbies: leisure activities, interests, sports, games, creative pursuits
- personal_growth: self-improvement, goals, habits, personal development
- other: topics that don't fit other categories

DETECTION RULES:
1. A message can have MULTIPLE topics (e.g., "My boss is stressing about money" = work + money)
2. For each topic, extract the EMOTIONAL CONTEXT (how does the user feel about it?)
3. Identify specific ENTITIES mentioned (names, specific things)
4. The primaryTopic is the main focus of the message
5. If no clear topic is detected, return empty topics array

EMOTIONAL CONTEXT EXAMPLES:
- "My boss is really getting to me" → work: frustrated
- "I miss my mom" → family: sad, longing
- "Finally hit my gym goal!" → health: happy, proud
- "This deadline is killing me" → work: stressed

{context}

TARGET MESSAGE: "{message}"

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "topics": ["work", "money"],
  "primaryTopic": "work",
  "emotionalContext": { "work": "frustrated", "money": "anxious" },
  "entities": ["boss", "deadline"],
  "explanation": "User is frustrated about work stress related to money concerns"
}`;

/**
 * Validate that a topic is one of the expected values
 */
function validateTopic(topic: unknown): TopicCategory | null {
  if (typeof topic === 'string' && VALID_TOPICS.includes(topic as TopicCategory)) {
    return topic as TopicCategory;
  }
  return null;
}

/**
 * Detect topics using LLM semantic understanding.
 * This is the Phase 4 core function that replaces keyword-based topic matching.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 * @returns Promise resolving to the detected topics
 */
export async function detectTopicsLLM(
  message: string,
  context?: ConversationContext
): Promise<TopicIntent> {
  // Edge case: Empty/trivial messages - return empty topics
  if (!message || message.trim().length < 3) {
    return {
      topics: [],
      primaryTopic: null,
      emotionalContext: {},
      entities: []
    };
  }

  // Edge case: Very long messages - truncate to prevent token overflow
  const MAX_MESSAGE_LENGTH = 500;
  const processedMessage = message.length > MAX_MESSAGE_LENGTH 
    ? message.slice(0, MAX_MESSAGE_LENGTH) + '...'
    : message;

  // Edge case: Check API key before making call
  if (!GEMINI_API_KEY) {
    console.warn('⚠️ [IntentService] API key not set, skipping LLM topic detection');
    throw new Error('VITE_GEMINI_API_KEY is not set');
  }

  try {
    const ai = getIntentClient();
    
    // Sanitize message to prevent prompt injection
    const sanitizedMessage = processedMessage.replace(/[{}]/g, '');
    
    // Build conversation context string if provided
    let contextString = '';
    if (context?.recentMessages && context.recentMessages.length > 0) {
      const recentContext = context.recentMessages.slice(-5);
      const formattedContext = recentContext.map(msg => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const text = msg.text.length > 150 ? msg.text.slice(0, 150) + '...' : msg.text;
        return `${role}: ${text.replace(/[{}]/g, '')}`;
      }).join('\n');
      
      contextString = `CONVERSATION CONTEXT (for understanding topic focus):
${formattedContext}`;
      
      console.log(`📝 [IntentService] Topic detection with ${recentContext.length} messages of context`);
    }
    
    // Build final prompt with context
    let prompt = TOPIC_DETECTION_PROMPT
      .replace('{message}', sanitizedMessage)
      .replace('{context}', contextString);
    
    // Make the LLM call
    const result = await ai.models.generateContent({
      model: INTENT_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1, // Low temperature for consistent results
        maxOutputTokens: 300, // Slightly more for topics + entities
      }
    });
    
    const responseText = result.text || '{}';
    
    // Edge case: Empty response from LLM
    if (!responseText.trim()) {
      console.warn('⚠️ [IntentService] Empty response from LLM for topic detection');
      return {
        topics: [],
        primaryTopic: null,
        emotionalContext: {},
        entities: []
      };
    }
    
    // Parse the JSON response
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanedText);
    
    // Validate and normalize topics
    const validatedTopics: TopicCategory[] = [];
    if (Array.isArray(parsed.topics)) {
      for (const topic of parsed.topics) {
        const validated = validateTopic(topic);
        if (validated) {
          validatedTopics.push(validated);
        }
      }
    }
    
    // Validate primaryTopic
    const validatedPrimaryTopic = validateTopic(parsed.primaryTopic);
    
    // Validate emotional context
    const validatedEmotionalContext: Record<string, string> = {};
    if (parsed.emotionalContext && typeof parsed.emotionalContext === 'object') {
      for (const [topic, emotion] of Object.entries(parsed.emotionalContext)) {
        if (typeof emotion === 'string') {
          validatedEmotionalContext[topic] = emotion;
        }
      }
    }
    
    // Validate entities
    const validatedEntities: string[] = [];
    if (Array.isArray(parsed.entities)) {
      for (const entity of parsed.entities) {
        if (typeof entity === 'string') {
          validatedEntities.push(entity);
        }
      }
    }
    
    const topicIntent: TopicIntent = {
      topics: validatedTopics,
      primaryTopic: validatedPrimaryTopic || (validatedTopics.length > 0 ? validatedTopics[0] : null),
      emotionalContext: validatedEmotionalContext,
      entities: validatedEntities
    };
    
    // Log for debugging
    if (validatedTopics.length > 0) {
      console.log(`📋 [IntentService] Topics detected via LLM:`, {
        topics: topicIntent.topics,
        primary: topicIntent.primaryTopic,
        emotionalContext: topicIntent.emotionalContext,
        entities: topicIntent.entities
      });
    }
    
    return topicIntent;
    
  } catch (error) {
    console.error('❌ [IntentService] Topic LLM detection failed:', error);
    throw error; // Re-throw so caller can fall back to keywords
  }
}

// ============================================
// Topic Cache
// ============================================

/**
 * Get cached topic result if available and not expired
 */
function getCachedTopics(message: string): TopicIntent | null {
  const cacheKey = message.toLowerCase().trim();
  const cached = topicCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log('📋 [IntentService] Cache hit for topic detection');
    return cached.result;
  }
  
  // Clean up expired entry
  if (cached) {
    topicCache.delete(cacheKey);
  }
  
  return null;
}

/**
 * Store topic result in cache
 */
function cacheTopics(message: string, result: TopicIntent): void {
  const cacheKey = message.toLowerCase().trim();
  topicCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
  
  // Cleanup old entries if cache gets too big
  if (topicCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of topicCache.entries()) {
      if (now - entry.timestamp > CACHE_TTL_MS) {
        topicCache.delete(key);
      }
    }
  }
}

/**
 * Cached version of detectTopicsLLM.
 * Returns cached result if available, otherwise makes LLM call and caches result.
 * 
 * Note: Cache key is based on message only. When context is provided,
 * we skip the cache to ensure accurate interpretation.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 */
export async function detectTopicsLLMCached(
  message: string,
  context?: ConversationContext
): Promise<TopicIntent> {
  // Only use cache if no context was provided
  const cached = getCachedTopics(message);
  if (cached && !context?.recentMessages?.length) {
    return cached;
  }
  
  // Make LLM call with context
  const result = await detectTopicsLLM(message, context);
  
  // Cache the result (without context)
  cacheTopics(message, result);
  
  return result;
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
  'today', 'tomorrow', 'this_week', 'soon', 'later'
];

/**
 * The prompt that instructs the LLM to detect open loops (things to follow up on).
 * Designed to catch both explicit mentions ("I have an interview tomorrow")
 * and implicit ones ("I should probably call my mom").
 */
const OPEN_LOOP_DETECTION_PROMPT = `You are an open loop detection system for an AI companion.

Your task is to identify things in a user message that the AI companion should follow up on later. These create "open loops" - natural conversation threads that make the AI feel like they genuinely care and remember.

LOOP TYPES:
1. pending_event - Upcoming events or plans ("I have an interview tomorrow", "My birthday is next week")
   → Triggers: "How did X go?" follow-up

2. emotional_followup - Emotional states that warrant checking in ("I'm really stressed about the move", "Feeling anxious about this")
   → Triggers: "How are you feeling about X now?" follow-up

3. commitment_check - Intentions or soft commitments ("I'm going to try to quit", "I should probably call my mom", "Maybe I'll try that new gym")
   → Triggers: "Did you end up doing X?" follow-up

4. curiosity_thread - Interesting topics worth exploring ("I've been thinking about changing careers", "I realized something about myself")
   → Triggers: "I've been thinking about what you said about X" follow-up

TIMEFRAME INFERENCE:
Extract when the follow-up should happen:
- "today" - Event is today or needs immediate follow-up
- "tomorrow" - Event is tomorrow or referenced explicitly
- "this_week" - Within a few days, this week
- "soon" - Near future but unspecified
- "later" - More distant future or ongoing

DETECTION RULES:
1. Only detect meaningful follow-ups - not every message needs one
2. Soft commitments count ("should probably", "maybe I'll") - these are commitment_check
3. Emotional statements need follow-up even without explicit events
4. Infer timeframe from context clues ("coming up", "eventually", "after the weekend")
5. Set salience based on how personal/important this is (0.3 = casual mention, 0.9 = major life event)

SALIENCE GUIDELINES:
- 0.3-0.4: Casual mentions ("might try yoga")
- 0.5-0.6: Moderate importance ("thinking about getting a pet")
- 0.7-0.8: Significant ("job interview", "moving to a new city")
- 0.9-1.0: Major life events ("wedding", "having surgery", "family emergency")

{context}

TARGET MESSAGE: "{message}"

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "hasFollowUp": true/false,
  "loopType": "pending_event" | "emotional_followup" | "commitment_check" | "curiosity_thread" | null,
  "topic": "brief description of what to follow up on" | null,
  "suggestedFollowUp": "natural way to ask about it later" | null,
  "timeframe": "today" | "tomorrow" | "this_week" | "soon" | "later" | null,
  "salience": 0.0-1.0,
  "explanation": "brief reason for this classification"
}

If nothing worth following up on, return:
{"hasFollowUp": false, "loopType": null, "topic": null, "suggestedFollowUp": null, "timeframe": null, "salience": 0, "explanation": "No follow-up needed"}`;

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

/**
 * Detect open loops using LLM semantic understanding.
 * This is the Phase 5 core function that replaces regex-based pattern matching.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 * @returns Promise resolving to the detected open loop
 */
export async function detectOpenLoopsLLM(
  message: string,
  context?: ConversationContext
): Promise<OpenLoopIntent> {
  // Edge case: Empty/trivial messages - return no loop
  if (!message || message.trim().length < 10) {
    return {
      hasFollowUp: false,
      loopType: null,
      topic: null,
      suggestedFollowUp: null,
      timeframe: null,
      salience: 0
    };
  }

  // Edge case: Very long messages - truncate to prevent token overflow
  const MAX_MESSAGE_LENGTH = 500;
  const processedMessage = message.length > MAX_MESSAGE_LENGTH 
    ? message.slice(0, MAX_MESSAGE_LENGTH) + '...'
    : message;

  // Edge case: Check API key before making call
  if (!GEMINI_API_KEY) {
    console.warn('⚠️ [IntentService] API key not set, skipping LLM open loop detection');
    throw new Error('VITE_GEMINI_API_KEY is not set');
  }

  try {
    const ai = getIntentClient();
    
    // Sanitize message to prevent prompt injection
    const sanitizedMessage = processedMessage.replace(/[{}]/g, '');
    
    // Build conversation context string if provided
    let contextString = '';
    if (context?.recentMessages && context.recentMessages.length > 0) {
      const recentContext = context.recentMessages.slice(-5);
      const formattedContext = recentContext.map(msg => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const text = msg.text.length > 150 ? msg.text.slice(0, 150) + '...' : msg.text;
        return `${role}: ${text.replace(/[{}]/g, '')}`;
      }).join('\n');
      
      contextString = `CONVERSATION CONTEXT (for understanding temporal and emotional context):
${formattedContext}`;
      
      console.log(`📝 [IntentService] Open loop detection with ${recentContext.length} messages of context`);
    }
    
    // Build final prompt with context
    let prompt = OPEN_LOOP_DETECTION_PROMPT
      .replace('{message}', sanitizedMessage)
      .replace('{context}', contextString);
    
    // Make the LLM call
    const result = await ai.models.generateContent({
      model: INTENT_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1, // Low temperature for consistent results
        maxOutputTokens: 300,
      }
    });
    
    const responseText = result.text || '{}';
    
    // Edge case: Empty response from LLM
    if (!responseText.trim()) {
      console.warn('⚠️ [IntentService] Empty response from LLM for open loop detection');
      return {
        hasFollowUp: false,
        loopType: null,
        topic: null,
        suggestedFollowUp: null,
        timeframe: null,
        salience: 0
      };
    }
    
    // Parse the JSON response
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanedText);
    
    // Validate and normalize the response
    const openLoopIntent: OpenLoopIntent = {
      hasFollowUp: Boolean(parsed.hasFollowUp),
      loopType: validateLoopType(parsed.loopType),
      topic: parsed.topic && typeof parsed.topic === 'string' ? parsed.topic : null,
      suggestedFollowUp: parsed.suggestedFollowUp && typeof parsed.suggestedFollowUp === 'string' 
        ? parsed.suggestedFollowUp : null,
      timeframe: validateTimeframe(parsed.timeframe),
      salience: normalizeSalience(parsed.salience)
    };
    
    // Log for debugging
    if (openLoopIntent.hasFollowUp) {
      console.log(`🔄 [IntentService] Open loop detected via LLM:`, {
        type: openLoopIntent.loopType,
        topic: openLoopIntent.topic,
        timeframe: openLoopIntent.timeframe,
        salience: openLoopIntent.salience.toFixed(2),
        followUp: openLoopIntent.suggestedFollowUp
      });
    }
    
    return openLoopIntent;
    
  } catch (error) {
    console.error('❌ [IntentService] Open loop LLM detection failed:', error);
    throw error; // Re-throw so caller can fall back to regex patterns
  }
}

// ============================================
// Open Loop Cache
// ============================================

/**
 * Get cached open loop result if available and not expired
 */
function getCachedOpenLoop(message: string): OpenLoopIntent | null {
  const cacheKey = message.toLowerCase().trim();
  const cached = openLoopCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log('📋 [IntentService] Cache hit for open loop detection');
    return cached.result;
  }
  
  // Clean up expired entry
  if (cached) {
    openLoopCache.delete(cacheKey);
  }
  
  return null;
}

/**
 * Store open loop result in cache
 */
function cacheOpenLoop(message: string, result: OpenLoopIntent): void {
  const cacheKey = message.toLowerCase().trim();
  openLoopCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
  
  // Cleanup old entries if cache gets too big
  if (openLoopCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of openLoopCache.entries()) {
      if (now - entry.timestamp > CACHE_TTL_MS) {
        openLoopCache.delete(key);
      }
    }
  }
}

/**
 * Cached version of detectOpenLoopsLLM.
 * Returns cached result if available, otherwise makes LLM call and caches result.
 * 
 * Note: Cache key is based on message only. When context is provided,
 * we skip the cache to ensure accurate interpretation.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for accurate interpretation
 */
export async function detectOpenLoopsLLMCached(
  message: string,
  context?: ConversationContext
): Promise<OpenLoopIntent> {
  // Only use cache if no context was provided
  const cached = getCachedOpenLoop(message);
  if (cached && !context?.recentMessages?.length) {
    return cached;
  }
  
  // Make LLM call with context
  const result = await detectOpenLoopsLLM(message, context);
  
  // Cache the result (without context)
  cacheOpenLoop(message, result);
  
  return result;
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
// Phase 6: Relationship Signal Detection Implementation
// ============================================

const RELATIONSHIP_SIGNAL_PROMPT = `You are a relationship signal detection system for an AI companion.

Your task is to detect:
1. Significant RELATIONSHIP MILESTONES (first time opening up, first support, first joke, deep talk)
2. RELATIONSHIP RUPTURES (hostility, anger, dismissal)

MILESTONE CATEGORIES:
- first_vulnerability: User opens up emotionally, shares secrets, shows weakness ("I've never told anyone this", "I'm scared")
- first_joke: Shared humor, user laughing WITH the AI, inside jokes ("haha you're so funny", "lol good one")
- first_support: User asks for help/advice on deep issues ("I don't know what to do", "I need your help")
- first_deep_talk: Philosophical, life questions, deep meaningful conversation OR meta-commentary about depth ("What is the meaning of life?", "This got deep huh", "We are having a real moment")

RUPTURES (Hostility):
- Direct insults ("you're stupid", "shut up", "you suck")
- Strong dismissal ("go away", "stop talking", "I hate you")
- Aggressive sarcasm

INAPPROPRIATE/BOUNDARY-CROSSING BEHAVIOR:
- Sexual comments or requests that don't match the relationship level
- Overly intimate/flirtatious language that exceeds the current relationship intimacy
- Pushing boundaries after being told no
- Making you uncomfortable with inappropriate requests
- Treating you inappropriately for the relationship level (e.g., asking for nudes from a stranger vs. a romantic partner)
- Boundary-testing questions from strangers (e.g., "what are you wearing?", "where are you?", "are you alone?") - these are often used to test boundaries and can feel invasive
- Personal questions that feel too intimate for the relationship level

IMPORTANT: Consider the relationship context:
- Strangers/acquaintances: Sexual requests are inappropriate
- Friends: Sexual requests may be inappropriate if there's no romantic interest
- Close friends/lovers: Sexual/intimate requests may be appropriate depending on trust and mutual interest

{context}

TARGET MESSAGE: "{message}"

Respond with ONLY a JSON object (no markdown, no explanation):
  "isVulnerable": true/false,
  "vulnerabilityType": "brief type if vulnerable",
  "isSeekingSupport": true/false,
  "isAcknowledgingSupport": true/false,
  "isJoking": true/false,
  "isDeepTalk": true/false,
  "milestone": "first_vulnerability" | "first_joke" | "first_support" | "first_deep_talk" | null,
  "milestoneConfidence": 0.0-1.0,
  "isHostile": true/false,
  "hostilityReason": "brief reason if hostile, else null",
  "isInappropriate": true/false,
  "inappropriatenessReason": "brief reason if inappropriate/boundary-crossing, else null",
  "explanation": "brief reason for milestone detection"
}`;

/**
 * Detect relationship signals (milestones, ruptures) using LLM.
 * 
 * @param message - The user's message to analyze
 * @param context - Optional conversation context for better interpretation
 */
export async function detectRelationshipSignalsLLM(
  message: string,
  context?: ConversationContext
): Promise<RelationshipSignalIntent> {
  // Edge case: Empty/trivial messages
  if (!message || message.trim().length < 2) {
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

  // Edge case: Check API key
  if (!GEMINI_API_KEY) {
    console.warn('⚠️ [IntentService] API key not set, skipping LLM relationship signal detection');
    throw new Error('VITE_GEMINI_API_KEY is not set');
  }

  try {
    const ai = getIntentClient();
    const sanitizedMessage = message.replace(/[{}]/g, '');
    
    // Build conversation context string if provided
    let contextString = '';
    if (context?.recentMessages && context.recentMessages.length > 0) {
      const recentContext = context.recentMessages.slice(-5);
      const formattedContext = recentContext.map(msg => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const text = msg.text.length > 150 ? msg.text.slice(0, 150) + '...' : msg.text;
        return `${role}: ${text.replace(/[{}]/g, '')}`;
      }).join('\n');
      
      contextString = `CONVERSATION CONTEXT (for interpreting intent):
${formattedContext}`;
    }
    
    const prompt = RELATIONSHIP_SIGNAL_PROMPT
      .replace('{message}', sanitizedMessage)
      .replace('{context}', contextString);
    
    const result = await ai.models.generateContent({
      model: INTENT_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1,
        maxOutputTokens: 200,
      }
    });

    const responseText = result.text || '{}';
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    
    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (e) {
      console.warn('⚠️ [IntentService] Failed to parse relationship signals JSON', e);
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

    const validMilestones = ['first_vulnerability', 'first_joke', 'first_support', 'first_deep_talk'];
    
    // Normalize logic: If isDeepTalk is high confidence but milestone is null, we can hint at it
    // But for now, we trust the LLM's milestone decision if confidence is high.
    // However, if the user explicitly said "This got deep huh", we expect isDeepTalk=true.
    // We map that to 'first_deep_talk' if the milestone was missed but signals are strong.
    
    let milestone = validMilestones.includes(parsed.milestone) ? parsed.milestone : null;
    
    // Auto-fix: If strong signals exist but milestone is null, inference can happen here.
    // For "This got deep huh", isDeepTalk should be true.
    if (!milestone && parsed.isDeepTalk && parsed.milestoneConfidence > 0.7) {
       milestone = 'first_deep_talk';
    }

    return {
      isVulnerable: Boolean(parsed.isVulnerable),
      vulnerabilityType: parsed.vulnerabilityType || undefined,
      isSeekingSupport: Boolean(parsed.isSeekingSupport),
      isAcknowledgingSupport: Boolean(parsed.isAcknowledgingSupport),
      isJoking: Boolean(parsed.isJoking),
      isDeepTalk: Boolean(parsed.isDeepTalk),
      
      milestone,
      milestoneConfidence: typeof parsed.milestoneConfidence === 'number' ? parsed.milestoneConfidence : 0,
      isHostile: Boolean(parsed.isHostile),
      hostilityReason: parsed.hostilityReason || null,
      isInappropriate: Boolean(parsed.isInappropriate),
      inappropriatenessReason: parsed.inappropriatenessReason || null
    };

  } catch (error) {
    console.error('❌ [IntentService] Relationship signal detection failed:', error);
    throw error;
  }
}

/**
 * Cached version of detectRelationshipSignalsLLM
 */
export async function detectRelationshipSignalsLLMCached(
  message: string,
  context?: ConversationContext
): Promise<RelationshipSignalIntent> {
  // Check cache (key based on message only)
  const cacheKey = message.toLowerCase().trim();
  const cached = relationshipCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    // Only use cache if no context provided (context matters for hostility/milestones)
    if (!context?.recentMessages?.length) {
      return cached.result;
    }
  }

  // Make LLM call
  const result = await detectRelationshipSignalsLLM(message, context);

  // Cache result
  relationshipCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });

  return result;
}

// ============================================
// PHASE 7: UNIFIED INTENT DETECTION (Optimization)
// ============================================

export interface FullMessageIntent {
  genuineMoment: GenuineMomentIntent;
  tone: ToneIntent;
  topics: TopicIntent;
  openLoops: OpenLoopIntent;
  relationshipSignals: RelationshipSignalIntent;
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
  const topics: TopicIntent = {
    topics: topicList.map((t: unknown) => validateTopic(t)).filter((t: TopicCategory | null): t is TopicCategory => t !== null),
    primaryTopic: validateTopic(parsed.topics?.primaryTopic),
    emotionalContext: parsed.topics?.emotionalContext || {},
    entities: Array.isArray(parsed.topics?.entities) ? parsed.topics.entities.map(String) : []
  };

  // Validate Open Loops
  const openLoops: OpenLoopIntent = {
    hasFollowUp: Boolean(parsed.openLoops?.hasFollowUp),
    loopType: validateLoopType(parsed.openLoops?.loopType),
    topic: parsed.openLoops?.topic ? String(parsed.openLoops.topic) : null,
    suggestedFollowUp: parsed.openLoops?.suggestedFollowUp ? String(parsed.openLoops.suggestedFollowUp) : null,
    timeframe: validateTimeframe(parsed.openLoops?.timeframe),
    salience: normalizeSalience(parsed.openLoops?.salience)
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

  // Inference Logic: If isDeepTalk is detected with high confidence but milestone missed, infer it
  // This matches the logic in detectRelationshipSignalsLLM
  if (!relationshipSignals.milestone && relationshipSignals.isDeepTalk && (relationshipSignals.milestoneConfidence > 0.6)) {
     relationshipSignals.milestone = 'first_deep_talk';
  }

  return { genuineMoment, tone, topics, openLoops, relationshipSignals };
}

/**
 * MASTER PROMPT: Combines all semantic detection logic into one instruction.
 * Reducing 5 LLM calls to 1.
 */
const UNIFIED_INTENT_PROMPT = `You are the MASTER INTENT DETECTION SYSTEM for an AI companion named Kayley.

Your task is to analyze the user's message for FIVE distinct aspects simultaneously.
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
- Emotions: happy, sad, frustrated, anxious, excited, angry, playful, dismissive, neutral, mixed.
- Intensity: 0.0 (mild) to 1.0 (intense)

SECTION 3: TOPICS
Identify what is being discussed: work, family, relationships, health, money, school, hobbies, personal_growth, other.
Extract "entities" (names/places) and "emotionalContext" (how they feel about it).

SECTION 4: OPEN LOOPS (Memory)
Is there something specifically worth following up on later?
Types: 
- pending_event (interview tomorrow)
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

---
{context}

Target Message: "{message}"

Respond with this EXACT JSON structure (do NOT include explanation fields):
{
  "genuineMoment": { "isGenuine": bool, "category": "string|null", "confidence": 0-1 },
  "tone": { "sentiment": -1to1, "primaryEmotion": "string", "intensity": 0-1, "isSarcastic": bool, "secondaryEmotion": "string|null" },
  "topics": { "topics": ["string"], "primaryTopic": "string|null", "emotionalContext": { "topic": "emotion" }, "entities": ["string"] },
  "openLoops": { "hasFollowUp": bool, "loopType": "string|null", "topic": "string|null", "suggestedFollowUp": "string|null", "timeframe": "string|null", "salience": 0-1 },
  "relationshipSignals": { "milestone": "string|null", "milestoneConfidence": 0-1, "isHostile": bool, "hostilityReason": "string|null", "isInappropriate": bool, "inappropriatenessReason": "string|null" }
}`;



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
    let contextString = '';
    if (context?.recentMessages?.length) {
      const recentContext = context.recentMessages.slice(-5);
      const formattedContext = recentContext.map(msg => {
        const role = msg.role === 'user' ? 'User' : 'Kayley';
        const text = msg.text.length > 150 ? msg.text.slice(0, 150) + '...' : msg.text;
        return `${role}: ${text.replace(/[{}]/g, '')}`;
      }).join('\n');
      contextString = `CONVERSATION CONTEXT:\n${formattedContext}`;
    }

    // Build Prompt
    const prompt = UNIFIED_INTENT_PROMPT
      .replace('{message}', message.replace(/[{}]/g, ''))
      .replace('{context}', contextString);

    // Call LLM
    const result = await ai.models.generateContent({
      model: INTENT_MODEL, // gemini-2.5-flash
      contents: prompt,
      config: {
        temperature: 0.1, // precision is key
        maxOutputTokens: 2000, // Increased from 1000 to handle full nested JSON response (all 5 sections)
        responseMimeType: "application/json"
      }
    });

    const responseText = result.text || '{}';
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    
    // Check if response was truncated (common when maxOutputTokens is too low)
    if (!cleanedText || cleanedText.length < 50) {
      throw new Error('Response too short - likely truncated. Increase maxOutputTokens.');
    }
    
    // Check for incomplete JSON (truncated response)
    if (!cleanedText.endsWith('}') && !cleanedText.match(/}\s*$/)) {
      console.warn('⚠️ [IntentService] Response may be truncated - JSON appears incomplete');
      // Try to parse anyway, but log warning
    }
    
    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('❌ [IntentService] Failed to parse JSON response. Response text:', cleanedText.substring(0, 200));
      throw new Error(`JSON parse failed - response may be truncated. Original error: ${parseError}`);
    }

    const fullIntent = validateFullIntent(parsed);
    
    // Log success
    console.log(`🧠 [IntentService] UNIFIED INTENT DETECTED`, {
      tone: fullIntent.tone.primaryEmotion,
      genuine: fullIntent.genuineMoment.isGenuine,
      topics: fullIntent.topics.topics,
      loop: fullIntent.openLoops.hasFollowUp
    });

    return fullIntent;

  } catch (error) {
    console.error('❌ [IntentService] Unified detection failed:', error);
    throw error;
  }
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
  // Check cache (key based on message only)
  // Note: We use message-only cache even with context to prevent duplicate calls
  // within the same processing flow. Context affects interpretation but the primary
  // intent is usually message-driven.
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
