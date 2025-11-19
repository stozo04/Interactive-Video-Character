import { GoogleGenAI } from "@google/genai";
import { ChatMessage, UploadedImage } from '../types';
import { IAIChatService, AIChatOptions, AIChatSession } from './aiService';
import { buildSystemPrompt } from './promptUtils';
import { AIActionResponse } from './aiSchema';

const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;
const USER_ID = import.meta.env.VITE_USER_ID;
const GEMINI_VIDEO_MODEL = import.meta.env.VITE_GEMINI_VIDEO_MODEL;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!GEMINI_MODEL || !USER_ID || !GEMINI_VIDEO_MODEL || !GEMINI_API_KEY) {
    console.error("VITE_GEMINI_MODEL, VITE_USER_ID, VITE_GEMINI_VIDEO_MODEL, and VITE_GEMINI_API_KEY must be set in the environment variables.");
    throw new Error("Missing environment variables for Gemini chat service.");
}

const getAiClient = () => {
    return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
};

// Helper to map chat history safely
function convertToGeminiHistory(history: ChatMessage[]) {
  return history
    .filter(msg => msg.text && msg.text.trim().length > 0) // Remove empty messages to prevent API 400 errors
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));
}

// Helper to handle model inconsistency (e.g., returning "response" instead of "text_response")
function normalizeAiResponse(rawJson: any, rawText: string): AIActionResponse {
  return {
      text_response: rawJson.text_response || rawJson.response || rawText, // Fallback chain
      action_id: rawJson.action_id || null
  };
}

export const geminiChatService: IAIChatService = {
  generateResponse: async (message, options, session) => {
    const ai = getAiClient();
    const { character, chatHistory = [], relationship, upcomingEvents } = options;

    // 1. Use the SHARED brain logic for the system prompt
    const systemPrompt = buildSystemPrompt(character, relationship, upcomingEvents);

    try {
      // 2. Initialize Chat using the pattern from your documentation
      const chat = ai.chats.create({
        model: GEMINI_MODEL,
        config: {
          responseMimeType: "application/json",
          systemInstruction: {
            parts: [{ text: systemPrompt }],
            role: "user" // System instructions are often passed as 'user' or specialized role depending on model version, but SDK handles this via config usually.
          },
        },
        history: convertToGeminiHistory(chatHistory),
      });


     // --- NEW: Handle Text vs Audio Input ---
     let messageParts: any[] = [];
     if (message.type === 'text') {
       messageParts = [{ text: message.text }];
     } else if (message.type === 'audio') {
       // Send Audio to Gemini
       messageParts = [{
           inlineData: {
               mimeType: message.mimeType,
               data: message.data // Base64 string
           }
       }];
     }
      // 3. Send Message
      const result = await chat.sendMessage({
        message: messageParts,
      });

      // 4. Parse the text result into your JSON schema
      // The Google SDK returns the raw JSON string, so we must parse it.
      const responseText = result.text || "{}";
      let structuredResponse: AIActionResponse;
      
      try {
        // Handle Markdown code blocks if the model adds them (common Gemini quirk)
        const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(cleanedText);
        
        // NORMALIZE the response to fix the bug
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
            // Gemini manages its own history in the 'chat' object during a session,
            // but since we recreate 'chat' every turn (stateless), we don't need to persist a session token.
            model: GEMINI_MODEL,
        }
      };

    } catch (error) {
      console.error('Gemini API Error:', error);
      throw error;
    }
  },

  generateGreeting: async (character, session, previousHistory, relationship) => {
    const ai = getAiClient();
    const systemPrompt = buildSystemPrompt(character, relationship);
    const greetingPrompt = "Generate a friendly, brief greeting. Keep it under 15 words.";

    try {
        const chat = ai.chats.create({
            model: GEMINI_MODEL,
            config: {
              responseMimeType: "application/json",
              systemInstruction: {
                parts: [{ text: systemPrompt }],
                role: "user"
              },
            },
            history: convertToGeminiHistory(previousHistory || []),
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
          console.warn("Failed to parse Gemini JSON, attempting cleanup or fallback:", responseText);
          structuredResponse = { text_response: responseText, action_id: null };
      }

        return { 
            greeting: structuredResponse, 
            session: { 
                userId: session?.userId || USER_ID, 
                model: GEMINI_MODEL, 
            } 
        }; 
    } catch (error) {
        console.error('Gemini Greeting Error:', error);
        throw error;
    }
  }
};

// --- Keep existing video generation logic below ---
// (PollVideoOperation, GenerateSingleVideo, etc. remain unchanged)
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