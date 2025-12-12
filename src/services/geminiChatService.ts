import { GoogleGenAI } from "@google/genai";
import { ChatMessage, UploadedImage } from '../types';
import { IAIChatService, AIChatOptions, AIChatSession, UserContent } from './aiService';
import { buildSystemPrompt, buildGreetingPrompt } from './promptUtils';
import { AIActionResponse, GeminiMemoryToolDeclarations } from './aiSchema';
import { generateSpeech } from './elevenLabsService';
import { BaseAIService } from './BaseAIService';
import { executeMemoryTool, MemoryToolName } from './memoryService';

// 1. LOAD BOTH MODELS FROM ENV
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL; // The Brain (e.g. gemini-2.0-flash-exp)

const USER_ID = import.meta.env.VITE_USER_ID;
const GEMINI_VIDEO_MODEL = import.meta.env.VITE_GEMINI_VIDEO_MODEL;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Feature flag for memory tools (can be disabled if issues arise)
const ENABLE_MEMORY_TOOLS = true;

if (!GEMINI_MODEL || !USER_ID || !GEMINI_VIDEO_MODEL || !GEMINI_API_KEY) {
    console.error("Missing env vars. Ensure VITE_GEMINI_MODEL is set.");
    // throw new Error("Missing environment variables for Gemini chat service.");
}

const getAiClient = () => {
    return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
};

// Helper to format history - NOW ONLY USED FOR CURRENT SESSION
function convertToGeminiHistory(history: ChatMessage[]) {
  // For fresh sessions, we only pass the current session's messages
  // Memory from past sessions is retrieved via tools
  const filtered = history
    .filter(msg => {
        const text = msg.text?.trim();
        return text && text.length > 0 && text !== "🎤 [Audio Message]" && text !== "📷 [Sent an Image]";
    }) 
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));
  
  console.log(`📜 [Gemini] Passing ${filtered.length} session messages to chat history`);
  return filtered;
}

function normalizeAiResponse(rawJson: any, rawText: string): AIActionResponse {
  let wbAction = rawJson.whiteboard_action || null;

  // Support for top-level draw_shapes (as requested in prompt)
  if (!wbAction && rawJson.draw_shapes) {
      wbAction = {
          type: 'draw',  // Must be valid WhiteboardAction type: 'none'|'mark_cell'|'guess'|'describe'|'draw'
          draw_shapes: rawJson.draw_shapes
      };
  }

  return {
      text_response: rawJson.text_response || rawJson.response || rawText,
      action_id: rawJson.action_id || null,
      user_transcription: rawJson.user_transcription || null,
      task_action: rawJson.task_action || null,
      open_app: rawJson.open_app || null,
      calendar_action: rawJson.calendar_action || null,
      // Pass through whiteboard fields
      whiteboard_action: wbAction,
      game_move: rawJson.game_move // 0 is valid, so check undefined
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
    const userId = session?.userId || USER_ID;
    
    // Check if this is a calendar query (marked by injected calendar data)
    const isCalendarQuery = userMessage.type === 'text' && 
      userMessage.text.includes('[LIVE CALENDAR DATA');
    
    // For calendar queries, use NO history to prevent stale context pollution
    // Otherwise, use only CURRENT SESSION history (not loaded from DB)
    const historyToUse = isCalendarQuery ? [] : convertToGeminiHistory(history);
    
    if (isCalendarQuery) {
      console.log('📅 [Gemini] Calendar query detected - using FRESH context only (no history)');
    }
    
    // Build chat configuration with optional memory tools
    // NOTE: Gemini doesn't support responseMimeType with function calling
    // So we use JSON format only when tools are disabled
    const chatConfig: any = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    };

    // Add memory tools if enabled
    if (ENABLE_MEMORY_TOOLS) {
      chatConfig.tools = [{
        functionDeclarations: GeminiMemoryToolDeclarations
      }];
      console.log('🧠 [Gemini] Memory tools enabled (no JSON mode - will parse text)');
    } else {
      // Only use JSON response format when tools are NOT enabled
      chatConfig.responseMimeType = "application/json";
    }

    // INITIALIZE CHAT WITH THE BRAIN (GEMINI_MODEL)
    const chat = ai.chats.create({
      model: this.model,
      config: chatConfig,
      history: historyToUse,
    });

    // Build message parts based on input type
    let messageParts: any[] = [];
    if (userMessage.type === 'text') {
      messageParts = [{ text: userMessage.text }];
    } else if (userMessage.type === 'audio') {
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

    // Send initial message
    let result = await chat.sendMessage({
      message: messageParts,
    });

    // ============================================
    // TOOL CALLING LOOP
    // If the AI requests tool calls, execute them and continue
    // ============================================
    const MAX_TOOL_ITERATIONS = 3; // Prevent infinite loops
    let iterations = 0;

    while (result.functionCalls && result.functionCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      console.log(`🔧 [Gemini] Tool call iteration ${iterations}:`, 
        result.functionCalls.map((fc: any) => fc.name)
      );

      // Execute all requested tool calls
      const toolResults = await Promise.all(
        result.functionCalls.map(async (functionCall: any) => {
          const toolName = functionCall.name as MemoryToolName;
          const toolArgs = functionCall.args || {};
          
          console.log(`🔧 [Gemini] Executing tool: ${toolName}`, toolArgs);
          
          // Execute the memory tool
          const toolResult = await executeMemoryTool(toolName, toolArgs, userId);
          
          return {
            functionResponse: {
              name: toolName,
              response: { result: toolResult }
            }
          };
        })
      );

      // Send tool results back to the AI
      result = await chat.sendMessage({
        message: toolResults
      });
    }

    if (iterations >= MAX_TOOL_ITERATIONS) {
      console.warn('⚠️ [Gemini] Max tool iterations reached, returning current response');
    }

    // Parse the final response
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
            userId: userId,
            model: this.model,
        }
    };
  }

  async generateGreeting(character: any, session: any, relationship: any, characterContext?: string) {
    const ai = getAiClient();
    const userId = session?.userId || USER_ID;
    const systemPrompt = buildSystemPrompt(character, relationship, [], characterContext);

    try {
        // First, try to get user's name from stored facts
        let userName: string | null = null;
        let hasUserFacts = false;
        
        try {
          const userFacts = await executeMemoryTool('recall_user_info', { category: 'identity' }, userId);
          hasUserFacts = userFacts && !userFacts.includes('No stored information');
          
          // Extract name if present
          const nameMatch = userFacts.match(/name:\s*(\w+)/i);
          if (nameMatch) {
            userName = nameMatch[1];
            console.log(`🤖 [Gemini] Found user name: ${userName}`);
          }
        } catch (e) {
          console.log('🤖 [Gemini] Could not fetch user facts for greeting');
        }

        // Build relationship-aware greeting prompt
        const greetingPrompt = buildGreetingPrompt(relationship, hasUserFacts, userName);
        console.log(`🤖 [Gemini] Greeting tier: ${relationship?.relationshipTier || 'new'}, interactions: ${relationship?.totalInteractions || 0}`);

        // Build config - add memory tools for personalized greetings
        const chatConfig: any = {
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
        };

        // Add memory tools to personalize greeting (e.g., look up user's name)
        if (ENABLE_MEMORY_TOOLS) {
          chatConfig.tools = [{
            functionDeclarations: GeminiMemoryToolDeclarations
          }];
          console.log('🧠 [Gemini Greeting] Memory tools enabled for personalization');
        } else {
          chatConfig.responseMimeType = "application/json";
        }

        const chat = ai.chats.create({
            model: this.model,
            config: chatConfig,
            history: [], // Fresh session - no history
        });

        let result = await chat.sendMessage({
            message: greetingPrompt
        });

        // Handle tool calls for greeting (e.g., looking up user's name)
        const MAX_TOOL_ITERATIONS = 2;
        let iterations = 0;

        while (result.functionCalls && result.functionCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
          iterations++;
          console.log(`🔧 [Gemini Greeting] Tool call iteration ${iterations}`);

          const toolResults = await Promise.all(
            result.functionCalls.map(async (functionCall: any) => {
              const toolName = functionCall.name as MemoryToolName;
              const toolArgs = functionCall.args || {};
              
              console.log(`🔧 [Gemini Greeting] Executing tool: ${toolName}`, toolArgs);
              const toolResult = await executeMemoryTool(toolName, toolArgs, userId);
              
              return {
                functionResponse: {
                  name: toolName,
                  response: { result: toolResult }
                }
              };
            })
          );

          result = await chat.sendMessage({
            message: toolResults
          });
        }

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
