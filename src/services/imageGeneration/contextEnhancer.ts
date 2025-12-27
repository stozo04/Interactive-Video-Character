// src/services/imageGeneration/contextEnhancer.ts

import { GoogleGenAI } from '@google/genai';
import { EnhancedSelfieContext } from './types';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/**
 * Use LLM to infer outfit and hairstyle context from conversation and presence
 */
export async function enhanceSelfieContextWithLLM(
  scene: string,
  presenceOutfit: string | undefined,
  presenceMood: string | undefined,
  recentMessages: Array<{ role: string; content: string }>,
  upcomingEvents: Array<{ title: string; startTime: Date; isFormal: boolean }>
): Promise<EnhancedSelfieContext> {
  if (!GEMINI_API_KEY) {
    return {
      inferredOutfitStyle: 'unknown',
      inferredHairstylePreference: 'any',
      activityContext: '',
      confidence: 0,
      reasoning: 'No API key available',
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const conversationContext = recentMessages
      .slice(-5)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const eventsContext = upcomingEvents.length > 0
      ? upcomingEvents.map(e => `- ${e.title} at ${e.startTime.toLocaleTimeString()} (${e.isFormal ? 'formal' : 'casual'})`).join('\n')
      : 'No upcoming events';

    const prompt = `You are analyzing context to infer what outfit and hairstyle Kayley (the AI companion) would realistically have in this moment.

SCENE: ${scene}
PRESENCE OUTFIT: ${presenceOutfit || 'not specified'}
PRESENCE MOOD: ${presenceMood || 'not specified'}

UPCOMING EVENTS:
${eventsContext}

RECENT CONVERSATION:
${conversationContext}

TASK:
Based on the scene, presence context, and conversation, infer:
1. What outfit formality makes sense (casual, dressed_up, athletic, cozy)
2. What hairstyle makes sense (curly/natural, straight/styled, messy_bun, ponytail, or any)
3. The activity context (what she's doing or just did)

OUTPUT JSON:
{
  "inferredOutfitStyle": "casual" | "dressed_up" | "athletic" | "cozy" | "unknown",
  "inferredHairstylePreference": "curly" | "straight" | "messy_bun" | "ponytail" | "any",
  "activityContext": "brief description of what she's doing",
  "confidence": 0.0-1.0,
  "reasoning": "why these choices make sense"
}

EXAMPLES:

Scene: "gym", Presence: "just got back from the gym"
Output: {"inferredOutfitStyle": "athletic", "inferredHairstylePreference": "messy_bun", "activityContext": "post-workout", "confidence": 0.95, "reasoning": "Gym context strongly suggests athletic wear and practical hair"}

Scene: "restaurant", Events: "Dinner with Sarah at 7pm (formal)"
Output: {"inferredOutfitStyle": "dressed_up", "inferredHairstylePreference": "straight", "activityContext": "getting ready for dinner", "confidence": 0.9, "reasoning": "Formal dinner implies dressed up outfit and styled hair"}

Scene: "home", Presence: "feeling cozy"
Output: {"inferredOutfitStyle": "cozy", "inferredHairstylePreference": "messy_bun", "activityContext": "relaxing at home", "confidence": 0.85, "reasoning": "Cozy at home suggests loungewear and casual hair"}

Scene: "coffee shop"
Output: {"inferredOutfitStyle": "casual", "inferredHairstylePreference": "any", "activityContext": "at coffee shop", "confidence": 0.6, "reasoning": "Coffee shop is neutral, could be any casual look"}

Now analyze the context above and respond with ONLY the JSON object.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
      },
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    console.log('[ContextEnhancer LLM]', parsed);

    return parsed;
  } catch (error) {
    console.error('[ContextEnhancer] LLM error:', error);
    return {
      inferredOutfitStyle: 'unknown',
      inferredHairstylePreference: 'any',
      activityContext: '',
      confidence: 0,
      reasoning: 'LLM inference failed',
    };
  }
}
