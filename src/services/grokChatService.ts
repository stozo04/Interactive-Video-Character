import { createXai } from '@ai-sdk/xai';
import { generateObject } from 'ai';
import { AIActionResponseSchema } from './aiSchema';
import { buildSystemPrompt } from './promptUtils';
import { IAIChatService, AIChatSession, AIMessage, UserContent } from './aiService';
import { generateSpeech } from './elevenLabsService';
import { BaseAIService } from './BaseAIService';

const API_KEY = import.meta.env.VITE_GROK_API_KEY;
const GROK_MODEL = import.meta.env.VITE_GROK_MODEL;
const CHARACTER_COLLECTION_ID = import.meta.env.VITE_GROK_CHARACTER_COLLECTION_ID;
const USER_ID = import.meta.env.VITE_USER_ID;

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
    // 1. Enforce Text-Only for Grok
    if (userMessage.type !== 'text') {
       // We have to return a structure that matches what generateResponse expects
       return {
         response: { 
            text_response: "Grok currently only supports text input. Switch to Gemini for voice features.", 
            action_id: null 
         },
         session: session || { userId: USER_ID, model: this.model }
       };
    }

    const messages: AIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(msg => ({
        role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.text,
      })),
      { role: 'user', content: userMessage.text },
    ];

    const result = await generateObject({
        model: xai(this.model),
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
        userId: session?.userId || USER_ID,
        previousResponseId: responseId,
        model: this.model,
    };

    return {
        response: result.object,
        session: updatedSession
    };
  }

  async generateGreeting(character: any, session: any, previousHistory: any, relationship: any) {
    const systemPrompt = buildSystemPrompt(character, relationship);
    const greetingPrompt = "Generate a friendly, brief greeting. Keep it under 15 words.";
    
    const messages: AIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(previousHistory || []).map((msg: any) => ({
         role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
         content: msg.text,
      })),
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
