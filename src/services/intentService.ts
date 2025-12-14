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
const INTENT_MODEL = 'gemini-2.5-flash';

// ============================================
// Types
// ============================================

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
  explanation: string; // Why this was detected (for debugging)
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
  /** Brief explanation for debugging */
  explanation: string;
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
      confidence: 1.0,
      explanation: 'Message too short for genuine moment'
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
        confidence: 0.5,
        explanation: 'Empty LLM response'
      };
    }
    
    // Parse the JSON response
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanedText);
    
    // Validate and normalize the response
    const intent: GenuineMomentIntent = {
      isGenuine: Boolean(parsed.isGenuine),
      category: validateCategory(parsed.category),
      confidence: normalizeConfidence(parsed.confidence),
      explanation: String(parsed.explanation || 'No explanation provided')
    };
    
    // Log for debugging (can be removed in production)
    if (intent.isGenuine) {
      console.log(`🌟 [IntentService] Genuine moment detected via LLM:`, {
        category: intent.category,
        confidence: intent.confidence,
        explanation: intent.explanation
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

const intentCache = new Map<string, CacheEntry>();
const toneCache = new Map<string, ToneCacheEntry>();
const topicCache = new Map<string, TopicCacheEntry>();
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
      isSarcastic: false,
      explanation: 'Empty or trivial message'
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
        isSarcastic: false,
        explanation: 'Empty LLM response'
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
      secondaryEmotion: parsed.secondaryEmotion ? validateEmotion(parsed.secondaryEmotion) : undefined,
      explanation: String(parsed.explanation || 'No explanation provided')
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
  /** Brief explanation for debugging */
  explanation: string;
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
      entities: [],
      explanation: 'Message too short for topic detection'
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
        entities: [],
        explanation: 'Empty LLM response'
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
      entities: validatedEntities,
      explanation: String(parsed.explanation || 'No explanation provided')
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
