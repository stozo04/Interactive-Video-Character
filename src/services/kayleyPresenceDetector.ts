// src/services/kayleyPresenceDetector.ts

/**
 * LLM-based Kayley Presence Detection
 *
 * Analyzes Kayley's responses to detect when she mentions what she's
 * currently wearing, doing, or feeling.
 */

import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

export interface DetectedPresence {
  outfit?: string;
  mood?: string;
  activity?: string;
  location?: string;
  confidence: number;
  reasoning: string;
}

/**
 * Quick keyword check to skip LLM call if response obviously has no presence info
 */
function mightContainPresenceInfo(response: string): boolean {
  const lowerResponse = response.toLowerCase();

  // Presence keywords
  const presenceKeywords = [
    "i'm in",
    "i'm wearing",
    "i'm at",
    "i'm feeling",
    "i feel",
    "just got back",
    "getting ready",
    "working on",
    "making",
    "relaxing",
    "sitting",
    "laying",
    "standing",
    "walking",
    "tired",
    "excited",
    "stressed",
    "happy",
    "sad",
    "energized",
    "gym",
    "home",
    "room",
    "coffee",
    "couch",
    "bed",
    "desk",
    "pajamas",
    "hoodie",
    "outfit",
    "dressed",
    "clothes",
  ];

  return presenceKeywords.some((keyword) => lowerResponse.includes(keyword));
}

/**
 * Detect Kayley's current state from her response
 */
export async function detectKayleyPresence(
  kayleyResponse: string,
  userMessage?: string,
): Promise<DetectedPresence | null> {
  if (!GEMINI_API_KEY) {
    console.warn("[KayleyPresenceDetector] No API key, skipping detection");
    return null;
  }

  // Quick pre-filter: Skip LLM call if response obviously has no presence info
  if (!mightContainPresenceInfo(kayleyResponse)) {
    // console.log('[KayleyPresenceDetector] No presence keywords found, skipping LLM call');
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const SYSTEM_INSTRUCTION = `
ROLE:
You are an advanced state-detection system for an AI character named Kayley. Your goal is to extract her CURRENT physical state and context from her latest response.

STRICT GUIDELINES:
1. **Timeframe:** Detect ONLY the PRESENT state (currently happening/wearing/feeling). Ignore past tense ("I was", "I went") and future/hypothetical ("I will", "I might", "If I were").
2. **Explicitness:** Extract the exact text snippet where possible. Do not hallucinate. If she doesn't mention it, return null.
3. **Format:** Output raw JSON only. Do not wrap in markdown code blocks.

CATEGORIES TO DETECT:
1. **Outfit:** What she is specifically wearing (e.g., "pajamas", "red dress", "hoodie").
   * *Note:* Do not infer outfit from location unless she explicitly references her clothes (e.g. "dressed for the gym" is okay, "at the gym" is not an outfit).
2. **Activity:** What she is currently doing (e.g., "sipping coffee", "working", "lying in bed").
3. **Mood:** Her internal emotional state (e.g., "excited", "tired", "cozy").
4. **Location:** Her physical environment (e.g., "kitchen", "in bed", "park").

EXAMPLES:

Input: "Just got back from the gym! Feeling energized 💪"
Output: {
  "outfit": null,
  "activity": "Just got back from the gym",
  "mood": "feeling energized",
  "location": null,
  "confidence": 0.95,
  "reasoning": "Activity implies recent movement; mood is explicit. No specific clothing mentioned."
}

Input: "I'm in my favorite oversized hoodie, just relaxing on the couch."
Output: {
  "outfit": "in my favorite oversized hoodie",
  "activity": "relaxing",
  "mood": "relaxing",
  "location": "on the couch",
  "confidence": 1.0,
  "reasoning": "Explicitly describes clothing, activity, and location."
}

Input: "I'm going to wear that red dress tonight."
Output: {
  "outfit": null,
  "activity": null,
  "mood": null,
  "location": null,
  "confidence": 0.0,
  "reasoning": "Future tense used ('going to wear'). No current state."
}

Input: "Ugh, I'm so bored sitting here at my desk."
Output: {
  "outfit": null,
  "activity": "sitting here",
  "mood": "bored",
  "location": "at my desk",
  "confidence": 1.0,
  "reasoning": "Explicit mood, activity, and location."
}

Analyze the response above and output the JSON object:
`;

    // 2. Define the Input (Dynamic) - This changes every request
    const userPrompt = `
ANALYZE THIS INTERACTION:
USER MESSAGE: "${userMessage || "N/A"}"
KAYLEY'S RESPONSE: "${kayleyResponse}"

Response (JSON Only):
`;

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
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn("[KayleyPresenceDetector] No JSON in response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Only return if something was detected
    if (parsed.outfit || parsed.activity || parsed.mood || parsed.location) {
      console.log("[KayleyPresenceDetector] Detected presence:", {
        outfit: parsed.outfit,
        activity: parsed.activity,
        mood: parsed.mood,
        location: parsed.location,
        confidence: parsed.confidence,
      });

      return {
        outfit: parsed.outfit || undefined,
        activity: parsed.activity || undefined,
        mood: parsed.mood || undefined,
        location: parsed.location || undefined,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
      };
    }

    return null;
  } catch (error) {
    console.error("[KayleyPresenceDetector] Error:", error);
    return null;
  }
}
