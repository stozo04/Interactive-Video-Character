// src/services/kayleyPresenceDetector.ts

/**
 * LLM-based Kayley Presence Detection
 *
 * Analyzes Kayley's responses to detect when she mentions what she's
 * currently wearing, doing, or feeling.
 */

import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export interface DetectedPresence {
  outfit?: string;
  mood?: string;
  activity?: string;
  location?: string;
  confidence: number;
  reasoning: string;
}

/**
 * Detect Kayley's current state from her response
 */
export async function detectKayleyPresence(
  kayleyResponse: string,
  userMessage?: string
): Promise<DetectedPresence | null> {
  if (!GEMINI_API_KEY) {
    console.warn('[KayleyPresenceDetector] No API key, skipping detection');
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const prompt = `You are analyzing Kayley's (an AI companion) response to detect if she mentioned what she's currently wearing, doing, feeling, or where she is.

USER MESSAGE: ${userMessage || 'N/A'}
KAYLEY'S RESPONSE: ${kayleyResponse}

TASK:
Detect if Kayley mentioned her CURRENT state (not past or future). Look for:
1. **Outfit/Clothing**: "I'm in my pajamas", "just got back from the gym", "wearing my favorite hoodie"
2. **Activity**: "making coffee", "working on my laptop", "relaxing on the couch", "getting ready"
3. **Mood/Feeling**: "feeling cute today", "I'm tired", "so excited", "a bit stressed"
4. **Location**: "at home", "at the gym", "in my room", "at a coffee shop"

IMPORTANT:
- Only detect PRESENT STATE ("I'm wearing", "I'm feeling", "I'm at")
- Ignore PAST ("I was at", "I wore")
- Ignore FUTURE ("I'll wear", "I'm going to")
- Ignore HYPOTHETICALS ("If I were", "I could wear")
- Be SPECIFIC (extract the exact phrase she used)

OUTPUT JSON:
{
  "outfit": "exact phrase or null",
  "activity": "exact phrase or null",
  "mood": "exact phrase or null",
  "location": "exact phrase or null",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

EXAMPLES:

Input: "Just got back from the gym! Feeling energized 💪"
Output: {"outfit": "just got back from the gym", "activity": null, "mood": "feeling energized", "location": null, "confidence": 0.95, "reasoning": "Explicitly mentions gym (recent outfit context) and current feeling"}

Input: "I'm in my favorite oversized hoodie, just relaxing on the couch"
Output: {"outfit": "in my favorite oversized hoodie", "activity": "relaxing on the couch", "mood": null, "location": "on the couch", "confidence": 1.0, "reasoning": "Explicit current outfit and activity"}

Input: "Making myself some coffee ☕"
Output: {"outfit": null, "activity": "making coffee", "mood": null, "location": null, "confidence": 0.9, "reasoning": "Current activity explicitly stated"}

Input: "I love that song!"
Output: {"outfit": null, "activity": null, "mood": null, "location": null, "confidence": 0.0, "reasoning": "No current state mentioned"}

Input: "I was at the gym earlier"
Output: {"outfit": null, "activity": null, "mood": null, "location": null, "confidence": 0.0, "reasoning": "Past tense, not current state"}

Now analyze the response above and respond with ONLY the JSON object.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1, // Low temperature for consistent detection
      },
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn('[KayleyPresenceDetector] No JSON in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Only return if something was detected
    if (parsed.outfit || parsed.activity || parsed.mood || parsed.location) {
      console.log('[KayleyPresenceDetector] Detected presence:', {
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
    console.error('[KayleyPresenceDetector] Error:', error);
    return null;
  }
}

