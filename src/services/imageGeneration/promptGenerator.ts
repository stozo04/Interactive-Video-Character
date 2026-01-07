// src/services/imageGeneration/promptGenerator.ts

import { GoogleGenAI } from '@google/genai';
import {
  ImagePromptContext,
  GeneratedImagePrompt,
  OutfitStyle,
  HairstyleType,
} from "./types";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const FLASH_MODEL = "gemini-3-flash-preview";

// Define valid options - update these arrays when adding new types to types.ts
const OUTFIT_STYLES: OutfitStyle[] = [
  "casual",
  "dressed_up",
  "athletic",
  "cozy",
];
const HAIRSTYLE_TYPES: (HairstyleType | "any")[] = [
  "curly",
  "straight",
  "messy_bun",
  "ponytail",
  "bob",
  "any",
];

// Build the system prompt dynamically with available options
function buildSystemPrompt(): string {
  const outfitOptions = OUTFIT_STYLES.map((s) => `"${s}"`).join(" | ");
  const hairstyleOptions = HAIRSTYLE_TYPES.map((s) => `"${s}"`).join(" | ");

  return `You are helping generate creative, context-aware image prompts for Kayley.
We use a reference image of her, so you DO NOT need to describe her physical features (face, skin, height).

Your job is to translate user requests and conversation context into vivid, specific SCENE and OUTFIT descriptions.

Kayley's Style:
- Outfit styles: ${OUTFIT_STYLES.join(", ")}
- Hairstyle types: ${HAIRSTYLE_TYPES.join(", ")}

RULES:
1. FOCUS on the setting and what she's wearing.
2. Be SPECIFIC - "holiday party" should include festive details (decorations, champagne, etc.)
3. Match her ENERGY - use the mood/energy values to inform her expression and vibe.
4. INFER context - if they mentioned a party earlier, draw from that conversation.
5. Consider TIME - old photos might have different lighting/settings.
6. Use OPEN LOOPS - if she was asking about something, that might be relevant.
7. Only use outfit styles from the available options above.
8. Only use hairstyle types from the available options above.

OUTPUT FORMAT (JSON):
{
  "sceneDescription": "A festive holiday party with twinkling fairy lights, a decorated tree visible in the background, and friends mingling nearby",
  "lightingDescription": "Warm, golden ambient light from string lights mixed with camera flash, creating a cozy party atmosphere",
  "moodExpression": "Laughing mid-conversation with champagne in hand, eyes bright with genuine joy",
  "outfitContext": {
    "style": ${outfitOptions},
    "description": "A sparkly emerald green cocktail dress that catches the light"
  },
  "hairstyleGuidance": {
    "preference": ${hairstyleOptions},
    "reason": "Party vibes suit her natural curls"
  },
  "additionalDetails": "Holding a champagne flute, maybe a festive accessory like tiny earrings",
  "confidence": 0.85,
  "reasoning": "User asked for holiday party pic, conversation mentioned work Christmas party earlier"
}`;
}

/**
 * Generates a creative image prompt using Gemini Flash
 */
export async function generateImagePrompt(
  context: ImagePromptContext
): Promise<GeneratedImagePrompt> {
  if (!GEMINI_API_KEY) {
    console.warn("[PromptGenerator] No API key, using fallback");
    throw new Error("Missing API key");
  }

  const cacheKey = getCacheKey(context);
  const cached = promptCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("✨ [PromptGenerator] Cache hit");
    return cached.result;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const prompt = `
SYSTEM: ${buildSystemPrompt()}

USER REQUEST: ${context.userRequest}
EXPLICIT SCENE: ${context.explicitScene || "Not specified"}
EXPLICIT MOOD: ${context.explicitMood || "Not specified"}

CONTEXT:
- Recent Messages: ${JSON.stringify(context.recentMessages.slice(-5))}
- Active Loops: ${JSON.stringify(context.activeLoops)}
- Kayley Mood: Energy: ${context.kayleyMood.energy}, Warmth: ${
      context.kayleyMood.warmth
    }
- Is Old Photo: ${context.isOldPhoto}
- Temporal Reference: ${context.temporalReference || "None"}
- Upcoming Events: ${JSON.stringify(context.upcomingEvents || [])}
- User Facts: ${JSON.stringify(context.userFacts || [])}
- Character Facts: ${JSON.stringify(context.characterFacts || [])}

${
  context.currentLookLock
    ? `- Current Look Lock: Hairstyle: ${context.currentLookLock.hairstyle}, Outfit: ${context.currentLookLock.outfit}`
    : ""
}

Generate the image prompt JSON based on the context above. Be creative and narrative.
`;

    const result = await ai.models.generateContent({
      model: FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
      },
    });

    const text = (result as any).text || "";

    // Extract JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as GeneratedImagePrompt;

    promptCache.set(cacheKey, { result: parsed, timestamp: Date.now() });
    return parsed;
  } catch (error) {
    console.error("❌ [PromptGenerator] error:", error);
    return buildFallbackPrompt(context);
  }
}

/**
 * Basic fallback if LLM fails
 */
function buildFallbackPrompt(context: ImagePromptContext): GeneratedImagePrompt {
  return {
    sceneDescription: context.explicitScene || context.userRequest,
    lightingDescription: "soft natural lighting",
    moodExpression: context.explicitMood || "with a warm, friendly smile",
    outfitContext: {
      style: context.currentLookLock?.outfit || "casual",
      description: "a comfortable, casual outfit"
    },
    hairstyleGuidance: {
      preference: context.currentLookLock?.hairstyle || "any",
      reason: "Fallback to current look or default"
    },
    confidence: 0,
    reasoning: "LLM generation failed or was bypassed, using rule-based fallback"
  };
}

// ============================================
// CACHING
// ============================================

const CACHE_TTL = 60 * 1000; // 60 seconds
const promptCache = new Map<string, { result: GeneratedImagePrompt; timestamp: number }>();

function getCacheKey(context: ImagePromptContext): string {
  // Include all context that affects output for proper cache invalidation
  const msgHash = context.recentMessages.slice(-3).map(m => m.content).join('|');
  const loopHash = context.activeLoops.map(l => l.topic).join(',');
  const eventsCount = context.upcomingEvents?.length || 0;

  return [
    context.userRequest,
    context.explicitScene || '',
    context.explicitMood || '',
    msgHash,
    Math.round(context.kayleyMood.energy * 10), // Round to avoid float precision issues
    context.isOldPhoto,
    loopHash,
    eventsCount
  ].join('|');
}
