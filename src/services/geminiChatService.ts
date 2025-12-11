import { GoogleGenAI } from "@google/genai";
import { ChatMessage, UploadedImage } from '../types';
import { IAIChatService, AIChatOptions, AIChatSession, UserContent } from './aiService';
import { buildSystemPrompt } from './promptUtils';
import { AIActionResponse } from './aiSchema';
import { generateSpeech } from './elevenLabsService';
import { BaseAIService } from './BaseAIService';

// 1. LOAD BOTH MODELS FROM ENV
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL; // The Brain (e.g. gemini-2.0-flash-exp)

const USER_ID = import.meta.env.VITE_USER_ID;
const GEMINI_VIDEO_MODEL = import.meta.env.VITE_GEMINI_VIDEO_MODEL;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!GEMINI_MODEL || !USER_ID || !GEMINI_VIDEO_MODEL || !GEMINI_API_KEY) {
    console.error("Missing env vars. Ensure VITE_GEMINI_MODEL is set.");
    // throw new Error("Missing environment variables for Gemini chat service.");
}

const getAiClient = () => {
    return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
};

// Helper to format history
function convertToGeminiHistory(history: ChatMessage[]) {
  // Limit history to last 10 messages to prevent stale context from polluting responses
  const recentHistory = history.slice(-10);
  
  const filtered = recentHistory
    .filter(msg => {
        const text = msg.text?.trim();
        return text && text.length > 0 && text !== "🎤 [Audio Message]" && text !== "📷 [Sent an Image]";
    }) 
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));
  
  console.log(`📜 [Gemini] Passing ${filtered.length} messages to chat history (from ${history.length} total)`);
  return filtered;
}

function normalizeAiResponse(rawJson: any, rawText: string): AIActionResponse {
  return {
      text_response: rawJson.text_response || rawJson.response || rawText,
      action_id: rawJson.action_id || null,
      user_transcription: rawJson.user_transcription || null,
      task_action: rawJson.task_action || null,
      open_app: rawJson.open_app || null,
      calendar_action: rawJson.calendar_action || null
  };
}

export class GeminiService extends BaseAIService {
  model = GEMINI_MODEL;

  protected async callProvider(
    systemPrompt: string, 
    userMessage: UserContent, 
    history: any[],
    session?: AIChatSession
  ) {
    const ai = getAiClient();
    
    // Check if this is a calendar query (marked by injected calendar data)
    const isCalendarQuery = userMessage.type === 'text' && 
      userMessage.text.includes('[LIVE CALENDAR DATA');
    
    // For calendar queries, use NO history to prevent stale context pollution
    const historyToUse = isCalendarQuery ? [] : convertToGeminiHistory(history);
    
    if (isCalendarQuery) {
      console.log('📅 [Gemini] Calendar query detected - using FRESH context only (no history)');
    }
    
    // 2. INITIALIZE CHAT WITH THE BRAIN (GEMINI_MODEL)
    const chat = ai.chats.create({
      model: this.model, // <--- MUST USE CHAT BRAIN MODEL (2.0 Flash Exp)
      config: {
        responseMimeType: "application/json",
        systemInstruction: {
          parts: [{ text: systemPrompt }],
          role: "user" 
        },
      },
      history: historyToUse,
    });

   let messageParts: any[] = [];
   if (userMessage.type === 'text') {
     messageParts = [{ text: userMessage.text }];
   } else if (userMessage.type === 'audio') {
     // The Brain (2.0 Flash) can listen to audio!
     messageParts = [{
         inlineData: {
             mimeType: userMessage.mimeType,
             data: userMessage.data 
         }
     }];
   } else if (userMessage.type === 'image_text') {
     messageParts = [
       { text: userMessage.text },
       {
          inlineData: {
            mimeType: userMessage.mimeType,
            data: userMessage.imageData
          }
       }
     ];
   }

    const result = await chat.sendMessage({
      message: messageParts,
    });

    const responseText = result.text || "{}";
    let structuredResponse: AIActionResponse;
    
    try {
      const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanedText);
      structuredResponse = normalizeAiResponse(parsed, cleanedText);
    } catch (e) {
      console.warn("Failed to parse Gemini JSON, attempting cleanup or fallback:", responseText);
      structuredResponse = { 
          text_response: responseText, 
          action_id: null 
      };
    }

    return {
        response: structuredResponse,
        session: {
            userId: session?.userId || USER_ID,
            model: this.model,
        }
    };
  }

  async generateGreeting(character: any, session: any, chatHistory: any, relationship: any, characterContext?: string) {
    const ai = getAiClient();
    const systemPrompt = buildSystemPrompt(character, relationship, [], characterContext);
    const greetingPrompt = "Generate a friendly, brief greeting. Keep it under 15 words.";

    try {
        // 4. INITIALIZE GREETING CHAT WITH THE BRAIN
        const chat = ai.chats.create({
            model: this.model, // <--- MUST USE CHAT BRAIN MODEL
            config: {
              responseMimeType: "application/json",
              systemInstruction: {
                parts: [{ text: systemPrompt }],
                role: "user"
              },
            },
            history: convertToGeminiHistory(chatHistory || []),
        });

        const result = await chat.sendMessage({
            message: greetingPrompt
        });

        const responseText = result.text || "{}";
        let structuredResponse: AIActionResponse;

        try {
          const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
          const parsed = JSON.parse(cleanedText);
          structuredResponse = normalizeAiResponse(parsed, cleanedText);
      } catch (e) {
          console.warn("Failed to parse Gemini JSON:", responseText);
          structuredResponse = { text_response: responseText, action_id: null };
      }

        // 5. GENERATE AUDIO FOR GREETING USING THE VOICE
        const audioData = await generateSpeech(structuredResponse.text_response);

        return { 
            greeting: structuredResponse, 
            session: { 
                userId: session?.userId || USER_ID, 
                model: this.model, 
            },
            audioData
        }; 
    } catch (error) {
        console.error('Gemini Greeting Error:', error);
        throw error;
    }
  }
}

export const geminiChatService = new GeminiService();

// ... (Video generation helpers remain unchanged)
const pollVideoOperation = async (operation: any): Promise<Blob> => {
    const ai = getAiClient();
    let currentOperation = operation;
    while (!currentOperation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        try {
            currentOperation = await ai.operations.getVideosOperation({ operation: currentOperation });
        } catch(e) {
            console.error("Polling failed", e);
            throw new Error("Failed while polling for video generation status.");
        }
    }
    
    if (currentOperation.error) {
        console.error("Video generation failed:", currentOperation.error);
        throw new Error(`Video generation failed: ${currentOperation.error.message}`);
    }

    const downloadLink = currentOperation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("Video generation completed without a download link.");
    
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    const response = await fetch(`${downloadLink}&key=${key}`);
    if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);
    return await response.blob();
};

const generateSingleVideo = (image: UploadedImage, prompt: string) => {
    const ai = getAiClient();
    return ai.models.generateVideos({
        model: GEMINI_VIDEO_MODEL, 
        prompt,
        image: { imageBytes: image.base64, mimeType: image.mimeType },
        config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '9:16' }
    });
};

export const generateInitialVideo = async (image: UploadedImage): Promise<Blob> => {
    console.log("Generating new initial video.");
    const prompt = `Animate the character from this image to create a short, seamlessly looping video. The character should be sitting at a desk, looking forward with a pleasant, neutral expression.`;
    const operation = await generateSingleVideo(image, prompt);
    return await pollVideoOperation(operation);
};

export const generateActionVideo = async (image: UploadedImage, command: string): Promise<string> => {
    const prompt = `Animate the character from this image to perform the following action: "${command}".`;
    const operation = await generateSingleVideo(image, prompt);
    const blob = await pollVideoOperation(operation);
    return URL.createObjectURL(blob);
};
