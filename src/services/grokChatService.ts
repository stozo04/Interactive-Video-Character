import { createXai } from '@ai-sdk/xai';
import { generateObject } from 'ai';
import { AIActionResponseSchema } from './aiSchema';
import { buildSystemPrompt, buildGreetingPrompt } from './promptUtils';
import { IAIChatService, AIChatSession, AIMessage, UserContent } from './aiService';
import { generateSpeech } from './elevenLabsService';
import { BaseAIService } from './BaseAIService';
import { getTopLoopToSurface, markLoopSurfaced } from './presenceDirector';

const API_KEY = import.meta.env.VITE_GROK_API_KEY;
const GROK_MODEL = import.meta.env.VITE_GROK_MODEL;
const CHARACTER_COLLECTION_ID = import.meta.env.VITE_GROK_CHARACTER_COLLECTION_ID;
const USER_ID = import.meta.env.VITE_USER_ID;

// Feature flag for memory tools (can be disabled if issues arise)
const ENABLE_MEMORY_TOOLS = true;

if (!API_KEY || !GROK_MODEL || !CHARACTER_COLLECTION_ID) {
  console.error("VITE_GROK_API_KEY, VITE_GROK_MODEL, and VITE_GROK_CHARACTER_COLLECTION_ID must be set in the environment variables.");
  // We don't throw here to avoid crashing if another service is used, but it will fail if called.
}

const xai = createXai({ apiKey: API_KEY });

export class GrokService extends BaseAIService {
  model = GROK_MODEL;

  protected async callProvider(
    systemPrompt: string, 
    userMessage: UserContent, 
    history: any[],
    session?: AIChatSession
  ) {
    const userId = session?.userId || USER_ID;

    // 1. Enforce Text-Only for Grok
    if (userMessage.type !== 'text') {
       return {
         response: { 
            text_response: "Grok currently only supports text input. Switch to Gemini for voice features.", 
            action_id: null 
         },
         session: session || { userId: USER_ID, model: this.model }
       };
    }

    // Check if this is a calendar query (marked by injected calendar data)
    const isCalendarQuery = userMessage.text.includes('[LIVE CALENDAR DATA');
    
    // For calendar queries, use NO history to prevent stale context pollution
    // Otherwise, use only CURRENT SESSION history (not loaded from DB)
    const historyToUse = isCalendarQuery ? [] : history;
    
    if (isCalendarQuery) {
      console.log('📅 [Grok] Calendar query detected - using FRESH context only (no history)');
    } else {
      console.log(`📜 [Grok] Passing ${historyToUse.length} session messages to chat history`);
    }

    const messages: AIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyToUse.map(msg => ({
        role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.text,
      })),
      { role: 'user', content: userMessage.text },
    ];

    // Note: xAI/Grok doesn't have robust function calling support yet
    // Memory tools are handled by Gemini; Grok relies on prompt instructions
    // The collection_ids still work for character knowledge retrieval
    console.log('📜 [Grok] Using prompt-based memory (tool calling not supported by xAI)');


    try {
      // Use generateObject for structured output
      const result = await generateObject({
          model: xai(this.model),
          messages,
          schema: AIActionResponseSchema,
          // Note: tools may not work with generateObject - if issues arise, 
          // we may need to use generateText and parse manually
          providerOptions: {
            xai: {
              store_messages: true,
              collection_ids: CHARACTER_COLLECTION_ID ? [CHARACTER_COLLECTION_ID] : [],
              ...(session?.previousResponseId && {
                previous_response_id: session.previousResponseId,
              }),
            },
          },
      });

      const responseId = (result as any).response?.id || (result as any).id;

      const updatedSession: AIChatSession = {
          userId: userId,
          previousResponseId: responseId,
          model: this.model,
      };

      return {
          response: result.object,
          session: updatedSession
      };
    } catch (error) {
      console.error('[Grok] Error in callProvider:', error);
      throw error;
    }
  }

  async generateGreeting(character: any, session: any, relationship: any, characterContext?: string) {
    const userId = session?.userId || USER_ID;
    const systemPrompt = buildSystemPrompt(character, relationship, [], characterContext);
    
    // Fetch any open loops to ask about proactively
    // Note: Grok CAN use open loops since they're fetched before prompting
    let topOpenLoop = null;
    try {
      topOpenLoop = await getTopLoopToSurface(userId);
      if (topOpenLoop) {
        console.log(`🔄 [Grok] Found open loop to surface: "${topOpenLoop.topic}"`);
      }
    } catch (e) {
      console.log('[Grok] Could not fetch open loop for greeting');
    }

    // Build relationship-aware greeting prompt
    const greetingPrompt = buildGreetingPrompt(relationship, topOpenLoop !== null, null, topOpenLoop);
    console.log(`🤖 [Grok] Greeting tier: ${relationship?.relationshipTier || 'new'}, interactions: ${relationship?.totalInteractions || 0}`);
    
    const messages: AIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: greetingPrompt },
    ];

    const result = await generateObject({
      model: xai(this.model),
      messages,
      schema: AIActionResponseSchema,
      providerOptions: {
        xai: {
          store_messages: true,
          collection_ids: CHARACTER_COLLECTION_ID ? [CHARACTER_COLLECTION_ID] : [],
          ...(session?.previousResponseId && { previous_response_id: session.previousResponseId }),
        },
      },
    });

    const responseId = (result as any).response?.id || (result as any).id;
    
    const audioData = await generateSpeech(result.object.text_response);

    // Mark the open loop as surfaced (we asked about it)
    if (topOpenLoop) {
      await markLoopSurfaced(topOpenLoop.id);
      console.log(`✅ [Grok] Marked loop as surfaced: "${topOpenLoop.topic}"`);
    }

    return { 
        greeting: result.object, 
        session: {
            userId: session?.userId || USER_ID,
            previousResponseId: responseId,
            model: this.model,
        },
        audioData
    };
  }
}

export const grokService = new GrokService();
