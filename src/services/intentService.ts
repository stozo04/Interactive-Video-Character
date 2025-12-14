// src/services/intentService.ts
/**
 * Intent Service - LLM-based semantic intent detection
 * 
 * Phase 1: Genuine moment detection
 * Replaces hardcoded keyword matching with LLM understanding.
 * 
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

const intentCache = new Map<string, CacheEntry>();
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
