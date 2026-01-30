// src/services/imageGeneration/temporalDetection.ts

import { SelfieTemporalContext } from "./types";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

/**
 * LLM-based detection of temporal context for selfies
 * Uses Gemini Flash for fast, cheap inference
 */
export async function detectTemporalContextLLM(
  scene: string,
  userMessage: string,
  previousMessages: Array<{ role: string; content: string }>,
): Promise<SelfieTemporalContext> {
  if (!GEMINI_API_KEY) {
    console.warn("[TemporalDetection] No API key, falling back to heuristics");
    return detectTemporalContextFallback(scene, userMessage, previousMessages);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // 1. Build the Conversation History String
    const conversationContext = previousMessages
      .slice(-5)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // 2. Define Static Rules (System Instruction)
    const SYSTEM_INSTRUCTION = `
  ROLE:
  You are an advanced context analyzer for an AI character. Your specific task is to determine the TEMPORAL CONTEXT of a photo/selfie request.

  TASK:
  Analyze the conversation and current message to decide if the photo being discussed is:
  1. CURRENT PHOTO (Selfie taken right now, present moment)
  2. OLD PHOTO (Photo from yesterday, last week, "when I was at...", or specific past events)

  OUTPUT JSON FORMAT:
  {
    "isOldPhoto": boolean,
    "timeframe": "now" | "today" | "yesterday" | "last_week" | "last_month" | "vague_past",
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation",
    "temporalPhrases": ["string", "string"]
  }

  EXAMPLES:
  Input: "Send me a selfie"
  Output: {"isOldPhoto": false, "timeframe": "now", "confidence": 0.9, "reasoning": "Generic request implies current photo", "temporalPhrases": []}

  Input: "Here's a pic from last weekend at the beach"
  Output: {"isOldPhoto": true, "timeframe": "last_week", "confidence": 1.0, "reasoning": "Explicitly from last weekend", "temporalPhrases": ["last weekend"]}

  Input: User: "Show me that photo you took yesterday" -> Kayley: "Oh yeah! *sends selfie*"
  Output: {"isOldPhoto": true, "timeframe": "yesterday", "confidence": 1.0, "reasoning": "User explicitly requested yesterday's photo", "temporalPhrases": ["yesterday"]}

  Input: "I'm at the coffee shop"
  Output: {"isOldPhoto": false, "timeframe": "now", "confidence": 0.8, "reasoning": "Present tense implies current moment", "temporalPhrases": ["I'm at"]}
  `;

    // 3. Define Dynamic Input
    const userPrompt = `
  ANALYZE THIS CONTEXT:

  PREVIOUS MESSAGES:
  ${conversationContext || "No previous context."}

  CURRENT MESSAGE: "${userMessage}"
  CURRENT SCENE: "${scene || "Unknown"}"
  `;
    // 4. Initialize Model with Rules
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        temperature: 0.1, // Low temperature for consistent detection
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim() || "";

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[TemporalDetection] No JSON in response, using fallback");
      return detectTemporalContextFallback(
        scene,
        userMessage,
        previousMessages,
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);

    console.log("[TemporalDetection LLM]", {
      isOldPhoto: parsed.isOldPhoto,
      timeframe: parsed.timeframe,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    });

    return {
      isOldPhoto: parsed.isOldPhoto,
      referenceDate: parsed.isOldPhoto
        ? estimateReferenceDateFromTimeframe(parsed.timeframe)
        : undefined,
      temporalPhrases: parsed.temporalPhrases || [],
    };
  } catch (error) {
    console.error("[TemporalDetection] LLM error, falling back:", error);
    return detectTemporalContextFallback(scene, userMessage, previousMessages);
  }
}

/**
 * Fallback heuristic-based detection (used if LLM fails)
 */
function detectTemporalContextFallback(
  scene: string,
  userMessage: string,
  previousMessages: Array<{ role: string; content: string }>,
): SelfieTemporalContext {
  const combined = `${userMessage} ${scene}`.toLowerCase();

  // Simple heuristics
  const oldPhotoKeywords = [
    "from last",
    "yesterday",
    "other day",
    "when i was",
    "when we",
    "that time",
    "remember when",
    "old photo",
    "previous",
    "earlier",
  ];

  const isOldPhoto = oldPhotoKeywords.some((kw) => combined.includes(kw));

  return {
    isOldPhoto,
    referenceDate: isOldPhoto
      ? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      : undefined,
    temporalPhrases: isOldPhoto ? ["(fallback detection)"] : [],
  };
}

/**
 * Estimate reference date from LLM-detected timeframe
 */
function estimateReferenceDateFromTimeframe(
  timeframe:
    | "now"
    | "today"
    | "yesterday"
    | "last_week"
    | "last_month"
    | "vague_past",
): Date | undefined {
  const now = new Date();

  switch (timeframe) {
    case "now":
    case "today":
      return undefined; // Current photo

    case "yesterday":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);

    case "last_week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    case "last_month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    case "vague_past":
      // Default: 2-3 days ago for "the other day"
      return new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000);

    default:
      return undefined;
  }
}

/**
 * Check if a temporal context should unlock the current look
 * (allow different hairstyle)
 */
export function shouldUnlockCurrentLook(
  temporalContext: SelfieTemporalContext,
  currentLookState: { expiresAt: Date } | null,
): boolean {
  // If no current look is locked, nothing to unlock
  if (!currentLookState) return false;

  // Old photos can have different hairstyle
  if (temporalContext.isOldPhoto) return true;

  // Current look expired naturally
  if (new Date() > currentLookState.expiresAt) return true;

  return false;
}

// Cache for LLM results (30s TTL)
interface CacheEntry {
  result: SelfieTemporalContext;
  timestamp: Date;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Generate cache key from conversation context
 */
function getCacheKey(
  scene: string,
  userMessage: string,
  previousMessages: Array<{ role: string; content: string }>,
): string {
  const context = `${scene}|${userMessage}|${previousMessages
    .slice(-3)
    .map((m) => m.content)
    .join("|")}`;
  // Simple hash (truncate for key size)
  return context.substring(0, 200);
}

/**
 * Cached version of detectTemporalContextLLM
 */
export async function detectTemporalContextLLMCached(
  scene: string,
  userMessage: string,
  previousMessages: Array<{ role: string; content: string }>,
): Promise<SelfieTemporalContext> {
  const cacheKey = getCacheKey(scene, userMessage, previousMessages);

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp.getTime() < CACHE_TTL_MS) {
    console.log("[TemporalDetection] Cache hit");
    return cached.result;
  }

  // Call LLM
  const result = await detectTemporalContextLLM(
    scene,
    userMessage,
    previousMessages,
  );

  // Store in cache
  cache.set(cacheKey, { result, timestamp: new Date() });

  // Cleanup old entries
  if (cache.size > 100) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }

  return result;
}
