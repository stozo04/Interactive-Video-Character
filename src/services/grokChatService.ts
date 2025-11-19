// src/services/grokChatService.ts
import { createXai } from '@ai-sdk/xai';
import { generateObject } from 'ai';
import { AIActionResponseSchema } from './aiSchema';
import { buildSystemPrompt } from './promptUtils';
import { IAIChatService, AIChatSession, AIMessage } from './aiService';

  const API_KEY = import.meta.env.VITE_GROK_API_KEY;
  const GROK_MODEL = import.meta.env.VITE_GROK_MODEL;
  const CHARACTER_COLLECTION_ID = import.meta.env.VITE_GROK_CHARACTER_COLLECTION_ID;
  const USER_ID = import.meta.env.VITE_USER_ID;

  if (!API_KEY || !GROK_MODEL || !CHARACTER_COLLECTION_ID) {
    console.error("VITE_GROK_API_KEY, VITE_GROK_MODEL, and VITE_GROK_CHARACTER_COLLECTION_ID must be set in the environment variables.");
    throw new Error("Missing environment variables for Grok chat service.");
  }

const xai = createXai({ apiKey: API_KEY });

export const grokService: IAIChatService = {
  generateResponse: async (message, options, session) => {
    const { character, chatHistory = [], relationship, upcomingEvents } = options;
    const systemPrompt = buildSystemPrompt(character, relationship, upcomingEvents);

    const messages: AIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map(msg => ({
        role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.text,
      })),
      { role: 'user', content: message },
    ];

    try {
      const result = await generateObject({
        model: xai(session?.model || GROK_MODEL),
        messages,
        schema: AIActionResponseSchema,
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
        userId: session?.userId || 'default',
        previousResponseId: responseId,
        model: session?.model || GROK_MODEL,
      };

      return { response: result.object, session: updatedSession };
    } catch (error) {
      console.error('Grok API Error:', error);
      throw error;
    }
  },

  generateGreeting: async (character, session, previousHistory, relationship) => {
    const systemPrompt = buildSystemPrompt(character, relationship);
    const greetingPrompt = "Generate a friendly, brief greeting. Keep it under 15 words.";
    
    // Reuse the logic basically
    const messages: AIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(previousHistory || []).map(msg => ({
         role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
         content: msg.text,
      })),
      { role: 'user', content: greetingPrompt },
    ];

    const result = await generateObject({
      model: xai(session?.model || GROK_MODEL),
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
    
    return { 
        greeting: result.object, 
        session: {
            userId: session?.userId || USER_ID,
            characterId: character.id,
            previousResponseId: responseId,
            model: session?.model || GROK_MODEL,
        }
    };
  }
};