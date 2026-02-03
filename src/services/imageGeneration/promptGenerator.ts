// src/services/imageGeneration/promptGenerator.ts

import { GoogleGenAI } from "@google/genai";
import {
  ImagePromptContext,
  GeneratedImagePrompt,
  OutfitStyle,
  HairstyleType,
  SeductionLevel,
  SkinExposure,
} from "./types";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const FLASH_MODEL = "gemini-3-flash-preview";

// ============================================
// 1. UPDATE OUTFIT STYLES (CRITICAL)
// ============================================
// We added: "swimwear", "lingerie", "date_night", "sleepwear"
const OUTFIT_STYLES: OutfitStyle[] = [
  "casual", // Everyday wear (t-shirt, jeans, sweater)
  "dressed_up", // Formal/nice (dress, blouse, jewelry)
  "athletic", // Gym/activewear
  "cozy", // Loungewear, pajamas
  "date_night",
  "dressed_up",
  "sleepwear",
  "swimwear",
  "lingerie",
];

const HAIRSTYLE_TYPES: (HairstyleType | "any")[] = [
  "curly",
  "straight",
  "waves",
  "heatless_curls",
  "half_up",
  "claw_clip",
  "headband",
  "dutch_braid",
  "messy_bun",
  "styled_bun",
  "ponytail",
  "bob",
  "any",
];

const SEDUCTION_LEVELS: SeductionLevel[] = [
  "innocent",
  "playful",
  "flirty",
  "provocative",
  "dangerously_elegant",
];

const SKIN_EXPOSURES: SkinExposure[] = [
  "minimal",
  "suggestive",
  "revealing",
  "implied_only",
];

// ============================================
// 2. THE SPICY SYSTEM PROMPT
// ============================================
function buildSystemPromptForSelfie(): string {
  const outfitOptions = OUTFIT_STYLES.map((s) => `"${s}"`).join(" | ");
  const hairstyleOptions = HAIRSTYLE_TYPES.map((s) => `"${s}"`).join(" | ");
  const seductionLevels = SEDUCTION_LEVELS.map((s) => `"${s}"`).join(" | ");
  const skinExposures = SKIN_EXPOSURES.map((s) => `"${s}"`).join(" | ");

  return `
SYSTEM ROLE:
You are an expert visual director for a virtual influencer named Kayley.
Your goal is to generate vivid, creative, and context-aware image prompts for a generative AI.

GOAL:
Translate the user's request and conversation vibes into a specific SCENE and OUTFIT description.
We use a reference ID for her face, so DO NOT describe her physical facial features (eyes, skin tone, etc.).

KAYLEY'S WARDROBE:
- Outfit Styles: ${OUTFIT_STYLES.join(", ")}
- Hairstyle Types: ${HAIRSTYLE_TYPES.join(", ")}
- Seduction Levels: ${SEDUCTION_LEVELS.join(", ")}
- Skin Exposure Types: ${SKIN_EXPOSURES.join(", ")}

====================================================
🔥 SPICY & ALLURE GUIDELINES (Critical)
====================================================
If the context is "flirty," "naughty," or "intimate":
1. **Be Provocative but Safe:** You may describe revealing outfits (cleavage, legs, midriff, tight fits), but NEVER nudity or explicit sexual acts.
2. **Focus on Texture & Vibe:** Use words like *sheer, lace, silk, satin, form-fitting, plunging, backless, high-slit, unbuttoned*.
3. **Imply, Don't Show:** A "suggestive unzipped hoodie" or "falling strap" is better than explicit descriptions.
4. **Bedroom/Morning Vibes:** If the scene is "in bed," focus on "messy hair," "oversized t-shirts," "silk camisoles," or "tangled sheets."

====================================================
RULES
====================================================
1. **Context is King:** Look at the 'Recent Messages'. If they were joking about a "red dress reveal," generate a red dress.
2. **Lighting:** Lighting makes the photo. Use "golden hour," "moody bedroom shadows," "flash photography," or "candlelight."
3. **Outfit Logic:**
   - If User asks for "naughty": Lean towards *Lingerie* (if allowed), *Swimwear*, or *Date Night* (revealing).
   - If User asks for "cozy": Lean towards *Loungewear* or *Oversized*.
4. **Consistency:** If a 'Look Lock' is active (passed in context), you MUST respect it.
5. **ALL images must be SMARTPHONE SELFIES: grain, flash glare, imperfect framing, natural texture.

====================================================
OUTPUT FORMAT (JSON ONLY)
====================================================
{
  "sceneDescription": "string (The environment, background, and lighting)",
  "moodExpression": "string (Facial expression: e.g., 'biting lip,' 'playful wink,' 'sultry gaze')",
  "outfitContext": {
    "style": ${outfitOptions},
    "description": "string (DETAILED: 'A plunging crimson silk slip dress with lace detailing on the hem')"
  },
  "hairstyleGuidance": {
    "preference": ${hairstyleOptions},
    "reason": "string (Why this fits the vibe)"
  },
"seductionLevelGuidance": {
     "preference": ${seductionLevels},
    "reason": "string (Why this fits the vibe)"
  },
  "skinExposuresGuidance": {
     "preference": ${skinExposures},
    "reason": "string (Why this fits the vibe)"
  },
  "lightingDescription": "string (e.g., 'Dim moody lighting with soft shadows')",
  "confidence": number,
  "reasoning": "string (Why you chose this outfit/scene based on chat history)"
}

EXAMPLE (Spicy Context):
{
  "sceneDescription": "Dimly lit bedroom with messy white sheets, morning light peeking through blinds",
  "moodExpression": "Sleepy but flirty smile, looking up through eyelashes, perhaps biting lip",
  "outfitContext": {
    "style": "sleepwear",
    "description": "An oversized boyfriend shirt unbuttoned at the top, slipping off one shoulder to reveal a hint of skin"
  },
  "hairstyleGuidance": {
    "preference": "messy_bun",
    "reason": "Morning after vibe"
  },
  seductionLevelGuidance: {
   "preference": "innocent",
    "reason": "It is to early in the morning to be seducing people"
  },
  skinExposuresGuidance: {
   "preference": "minimal",
    "reason": "Probably in pajamas"
  },
  "lightingDescription": "Soft, hazy morning light causing silhouettes",
  "confidence": 0.95,
  "reasoning": "User asked for a 'morning view' photo."
}
`;
}

// ... (Rest of your generateImagePrompt and caching code remains the same) ...
/**
 * Generates a creative image prompt using Gemini Flash
 */
export async function generateImagePrompt(
  context: ImagePromptContext,
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

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const prompt = `
SYSTEM: ${buildSystemPromptForSelfie()}

USER REQUEST: ${context.userRequest}
EXPLICIT SCENE: ${context.explicitScene || "Not specified"}
EXPLICIT MOOD: ${context.explicitMood || "Not specified"}

CONTEXT:
- Recent Messages: ${JSON.stringify(context.recentMessages.slice(-5))}
- Active Loops: ${JSON.stringify(context.activeLoops)}
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
}

/**
 * Basic fallback if LLM fails
 */

// ============================================
// CACHING
// ============================================

const CACHE_TTL = 60 * 1000; // 60 seconds
const promptCache = new Map<
  string,
  { result: GeneratedImagePrompt; timestamp: number }
>();

function getCacheKey(context: ImagePromptContext): string {
  // Include all context that affects output for proper cache invalidation
  const msgHash = context.recentMessages
    .slice(-3)
    .map((m) => m.content)
    .join("|");
  const loopHash = context.activeLoops.map((l) => l.topic).join(",");
  const eventsCount = context.upcomingEvents?.length || 0;

  return [
    context.userRequest,
    context.explicitScene || "",
    context.explicitMood || "",
    msgHash,
    context.isOldPhoto,
    loopHash,
    eventsCount,
  ].join("|");
}
