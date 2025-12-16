import { GoogleGenAI } from "@google/genai";
import { ChatMessage, UploadedImage } from '../types';
import { IAIChatService, AIChatOptions, AIChatSession, UserContent } from './aiService';
import { buildSystemPrompt, buildGreetingPrompt } from './promptUtils';
import { AIActionResponse, GeminiMemoryToolDeclarations } from './aiSchema';
import { generateSpeech } from './elevenLabsService';
import { BaseAIService } from './BaseAIService';
import { executeMemoryTool, MemoryToolName } from './memoryService';
import { getTopLoopToSurface, markLoopSurfaced } from './presenceDirector';
import { resolveActionKey } from '../utils/actionKeyMapper';

// 1. LOAD BOTH MODELS FROM ENV
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL; // The Brain (e.g. gemini-2.0-flash-exp)

const USER_ID = import.meta.env.VITE_USER_ID;
const GEMINI_VIDEO_MODEL = import.meta.env.VITE_GEMINI_VIDEO_MODEL;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Feature flag for memory tools (can be disabled if issues arise)
const ENABLE_MEMORY_TOOLS = true;

// Feature flag for Interactions API (beta) - enables stateful conversations
// Set VITE_USE_GEMINI_INTERACTIONS_API=true in .env to enable
const USE_INTERACTIONS_API = import.meta.env.VITE_USE_GEMINI_INTERACTIONS_API === 'true';

// Vite proxy for development (bypasses CORS)
// Vite's proxy only works in development mode
const USE_VITE_PROXY = import.meta.env.DEV; // true in development, false in production
const VITE_PROXY_BASE = '/api/google'; // Matches vite.config.ts proxy path

// Optional: Use external server-side proxy (for production or if Vite proxy doesn't work)
// Set VITE_GEMINI_PROXY_URL=http://localhost:3001/api/gemini/interactions if you have a proxy
const GEMINI_PROXY_URL = import.meta.env.VITE_GEMINI_PROXY_URL;

if (!GEMINI_MODEL || !USER_ID || !GEMINI_VIDEO_MODEL || !GEMINI_API_KEY) {
    console.error("Missing env vars. Ensure VITE_GEMINI_MODEL is set.");
    // throw new Error("Missing environment variables for Gemini chat service.");
}

const getAiClient = () => {
    return new GoogleGenAI({ 
        apiKey: GEMINI_API_KEY,
        // Note: CORS is expected - Google blocks browser calls for security
        // Use VITE_GEMINI_PROXY_URL to set up a server proxy if needed
    });
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

/**
 * Convert user message to Interactions API input format
 * Supports text, audio, and image_text types
 */
function formatInteractionInput(userMessage: UserContent): any[] {
  if (userMessage.type === 'text') {
    return [{ type: 'text', text: userMessage.text }];
  } else if (userMessage.type === 'audio') {
    return [{
      type: 'audio',
      data: userMessage.data,
      mime_type: userMessage.mimeType
    }];
  } else if (userMessage.type === 'image_text') {
    return [
      { type: 'text', text: userMessage.text },
      {
        type: 'image',
        data: userMessage.imageData,
        mime_type: userMessage.mimeType
      }
    ];
  }
  return [];
}

// Phase 1 Optimization: LLM returns action keys, we resolve to UUIDs
function normalizeAiResponse(rawJson: any, rawText: string): AIActionResponse {
  let wbAction = rawJson.whiteboard_action || null;

  // Support for top-level draw_shapes (as requested in prompt)
  if (!wbAction && rawJson.draw_shapes) {
      wbAction = {
          type: 'draw',  // Must be valid WhiteboardAction type: 'none'|'mark_cell'|'guess'|'describe'|'draw'
          draw_shapes: rawJson.draw_shapes
      };
  }

  // Resolve action key to UUID (handles fuzzy matching and fallback)
  const actionId = resolveActionKey(rawJson.action_id);

  return {
      text_response: rawJson.text_response || rawJson.response || rawText,
      action_id: actionId,
      user_transcription: rawJson.user_transcription || null,
      task_action: rawJson.task_action || null,
      open_app: rawJson.open_app || null,
      calendar_action: rawJson.calendar_action || null,
      news_action: rawJson.news_action || null,
      // Pass through whiteboard fields
      whiteboard_action: wbAction,
      game_move: rawJson.game_move, // 0 is valid, so check undefined
      // Selfie/image generation action
      selfie_action: rawJson.selfie_action || null,
      // Store new character facts
      store_self_info: rawJson.store_self_info || null,
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
    const userId = session?.userId || USER_ID;
    
    // Check if this is a calendar query (marked by injected calendar data)
    const isCalendarQuery = userMessage.type === 'text' && 
      userMessage.text.includes('[LIVE CALENDAR DATA');
    
    // Check if we should use new Interactions API
    if (USE_INTERACTIONS_API) {
      return await this.callProviderWithInteractions(
        systemPrompt,
        userMessage,
        history,
        session,
        isCalendarQuery
      );
    }
    
    // Fallback to old API (existing implementation)
    return await this.callProviderOld(systemPrompt, userMessage, history, session, isCalendarQuery);
  }

  /**
   * Old implementation using Chat API (stateless)
   * This is the original implementation that sends system prompt on every message
   */
  private async callProviderOld(
    systemPrompt: string, 
    userMessage: UserContent, 
    history: any[],
    session?: AIChatSession,
    isCalendarQuery: boolean = false
  ): Promise<{ response: AIActionResponse, session: AIChatSession }> {
    const ai = getAiClient();
    const userId = session?.userId || USER_ID;
    
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
      // When tools are enabled, plain text responses are expected (tools require text, not JSON)
      // Only log warning if tools are disabled (unexpected plain text)
      if (!ENABLE_MEMORY_TOOLS) {
        console.warn("Failed to parse Gemini JSON (tools disabled but got plain text):", responseText);
      }
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

  /**
   * New implementation using Interactions API for stateful conversations
   * This method is called when USE_INTERACTIONS_API flag is enabled
   * 
   * Key difference: System prompt is only sent on first message.
   * Subsequent messages use previous_interaction_id to maintain context.
   */
  private async callProviderWithInteractions(
    systemPrompt: string,
    userMessage: UserContent,
    history: any[],
    session?: AIChatSession,
    isCalendarQuery: boolean = false
  ): Promise<{ response: AIActionResponse, session: AIChatSession }> {
    const ai = getAiClient();
    const userId = session?.userId || USER_ID;
    
    // Check if Interactions API is available (requires @google/genai v1.33.0+)
    if (!ai.interactions || typeof ai.interactions.create !== 'function') {
      console.warn('⚠️ [Gemini Interactions] Interactions API not available. SDK version may be too old (requires v1.33.0+). Falling back to old API.');
      console.warn('⚠️ [Gemini Interactions] Please run: npm install @google/genai@latest');
      // Fallback to old implementation
      return await this.callProviderOld(systemPrompt, userMessage, history, session, isCalendarQuery);
    }
    
    // Format user message for Interactions API
    const input = formatInteractionInput(userMessage);
    
    // Determine if this is first message (no previous interaction)
    const isFirstMessage = !session?.interactionId;
    
    // Build interaction config
    const interactionConfig: any = {
      model: this.model,
      input: input,
    };
    
    // CRITICAL: Always send system prompt - Interactions API doesn't persist it reliably
    // Send it on every message to ensure character identity is maintained
    interactionConfig.system_instruction = systemPrompt;
    
    if (isFirstMessage) {
      console.log('🆕 [Gemini Interactions] First message - sending full system prompt');
    } else {
      console.log('🔄 [Gemini Interactions] Continuing conversation - using previous_interaction_id + system prompt');
      interactionConfig.previous_interaction_id = session.interactionId;
      // NOTE: We send system prompt on every message because Interactions API doesn't reliably persist it
    }
    
    // Add memory tools if enabled
    // Interactions API requires each function to have type: 'function' directly in tools array
    if (ENABLE_MEMORY_TOOLS) {
      interactionConfig.tools = GeminiMemoryToolDeclarations.map(func => ({
        type: 'function', // Required by Interactions API
        name: func.name,
        description: func.description,
        parameters: func.parameters
      }));
      console.log('🧠 [Gemini Interactions] Memory tools enabled');
    }
    
    // Create interaction
    let interaction;
    try {
      // Priority: Vite proxy (dev) > External proxy > Direct call (will fail CORS)
      if (USE_VITE_PROXY) {
        // Use Vite's built-in proxy (development only)
        console.log('🔄 [Gemini Interactions] Using Vite proxy (development)');
        const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
        const response = await fetch(proxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(interactionConfig),
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Proxy error: ${response.statusText} - ${errorText}`);
        }
        
        interaction = await response.json();
      } else if (GEMINI_PROXY_URL) {
        // Use external server proxy (if configured)
        console.log('🔄 [Gemini Interactions] Using external server proxy:', GEMINI_PROXY_URL);
        const response = await fetch(GEMINI_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(interactionConfig),
        });
        
        if (!response.ok) {
          throw new Error(`Proxy error: ${response.statusText}`);
        }
        
        interaction = await response.json();
      } else {
        // Direct call (will fail with CORS - this is expected)
        // CORS is by design: Google blocks browser calls for security
        // Fallback will handle it automatically
        interaction = await ai.interactions.create(interactionConfig);
      }
    } catch (error: any) {
      // Check for CORS or connection errors
      // CORS is expected - Google intentionally blocks browser calls for security
      const errorMessage = String(error?.message || '');
      const errorName = String(error?.name || error?.constructor?.name || '');
      const errorCode = String(error?.code || '');
      const errorString = String(error || '');
      
      // Check for various CORS/connection error indicators
      const isConnectionError = 
        errorMessage.includes('CORS') || 
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('Connection error') ||
        errorMessage.includes('APIConnectionError') ||
        errorCode === 'APIConnectionError' ||
        errorName === 'APIConnectionError' ||
        errorString.includes('CORS') ||
        errorString.includes('Failed to fetch');
      
      if (isConnectionError) {
        console.warn('⚠️ [Gemini Interactions] CORS error detected (expected).');
        console.warn('⚠️ [Gemini Interactions] Google blocks browser calls for security.');
        console.warn('⚠️ [Gemini Interactions] Solutions:');
        console.warn('   1. Set VITE_GEMINI_PROXY_URL to use a server proxy');
        console.warn('   2. Keep VITE_USE_GEMINI_INTERACTIONS_API=false (use old API)');
        console.warn('⚠️ [Gemini Interactions] Falling back to old Chat API (works reliably from browser).');
        // Fallback to old implementation
        return await this.callProviderOld(systemPrompt, userMessage, history, session, isCalendarQuery);
      }
      // Re-throw other errors
      throw error;
    }
    
    // Handle tool calling loop (similar to old code but with Interactions API)
    const MAX_TOOL_ITERATIONS = 3;
    let iterations = 0;
    
    while (interaction.outputs && iterations < MAX_TOOL_ITERATIONS) {
      // Find function calls in outputs
      const functionCalls = interaction.outputs.filter(
        (output: any) => output.type === 'function_call'
      );
      
      if (functionCalls.length === 0) break;
      
      iterations++;
      console.log(`🔧 [Gemini Interactions] Tool call iteration ${iterations}:`, 
        functionCalls.map((fc: any) => fc.name)
      );
      
      // Execute all tool calls
      const toolResults = await Promise.all(
        functionCalls.map(async (functionCall: any) => {
          const toolName = functionCall.name as MemoryToolName;
          const toolArgs = functionCall.arguments || {};
          
          console.log(`🔧 [Gemini Interactions] Executing tool: ${toolName}`, toolArgs);
          
          const toolResult = await executeMemoryTool(toolName, toolArgs, userId);
          
          return {
            type: 'function_result',
            name: toolName,
            call_id: functionCall.id,
            result: toolResult
          };
        })
      );
      
          // Continue interaction with tool results
          const toolInteractionConfig = {
            model: this.model,
            previous_interaction_id: interaction.id,
            input: toolResults,
          };
          
          if (USE_VITE_PROXY) {
            // Use Vite's built-in proxy (development only)
            const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
            const response = await fetch(proxyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(toolInteractionConfig),
            });
            interaction = await response.json();
          } else if (GEMINI_PROXY_URL) {
            // Use external server proxy (if configured)
            const response = await fetch(GEMINI_PROXY_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(toolInteractionConfig),
            });
            interaction = await response.json();
          } else {
            interaction = await ai.interactions.create(toolInteractionConfig);
          }
    }
    
    if (iterations >= MAX_TOOL_ITERATIONS) {
      console.warn('⚠️ [Gemini Interactions] Max tool iterations reached');
    }
    
    // Extract text response from outputs
    const textOutput = interaction.outputs?.find(
      (output: any) => output.type === 'text'
    );
    
    const responseText = textOutput?.text || "{}";
    
    // Parse response (same as old code)
    // Note: When tools are enabled, responses are plain text, not JSON
    let structuredResponse: AIActionResponse;
    try {
      const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
      // Try to parse as JSON
      const parsed = JSON.parse(cleanedText);
      structuredResponse = normalizeAiResponse(parsed, cleanedText);
    } catch (e) {
      // If parsing fails, it's likely plain text (expected when tools are used)
      // This is normal behavior - tools require text responses, not JSON
      if (ENABLE_MEMORY_TOOLS) {
        // Tools were used, plain text is expected
        structuredResponse = { 
          text_response: responseText, 
          action_id: null 
        };
      } else {
        // Tools not used but still got plain text - log warning
        console.warn("Failed to parse Gemini JSON (tools disabled but got plain text):", responseText);
        structuredResponse = { 
          text_response: responseText, 
          action_id: null 
        };
      }
    }
    
    // Update session with interaction ID (critical for stateful conversations!)
    const updatedSession: AIChatSession = {
      userId: userId,
      model: this.model,
      interactionId: interaction.id,  // Store for next message!
    };
    
    return {
      response: structuredResponse,
      session: updatedSession
    };
  }

  async generateGreeting(character: any, session: any, relationship: any, characterContext?: string) {
    // Use Interactions API if enabled
    if (USE_INTERACTIONS_API) {
      return await this.generateGreetingWithInteractions(
        character,
        session,
        relationship,
        characterContext
      );
    }
    
    // Fallback to old implementation
    return await this.generateGreetingOld(character, session, relationship, characterContext);
  }

  /**
   * Old greeting implementation using Chat API
   */
  private async generateGreetingOld(character: any, session: any, relationship: any, characterContext?: string) {
    const ai = getAiClient();
    const userId = session?.userId || USER_ID;
    const systemPrompt = await buildSystemPrompt(character, relationship, [], characterContext, undefined, undefined, undefined, undefined, userId, undefined);

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
        // First, fetch any open loops to ask about proactively
        let topOpenLoop = null;
        try {
          topOpenLoop = await getTopLoopToSurface(userId);
          if (topOpenLoop) {
            console.log(`🔄 [Gemini] Found open loop to surface: "${topOpenLoop.topic}"`);
          }
        } catch (e) {
          console.log('[Gemini] Could not fetch open loop for greeting');
        }

        // Fetch proactive thread (Priority Router: only use if open loop is low/none)
        let proactiveThread = null;
        try {
          const { getOngoingThreadsAsync, selectProactiveThread } = await import('./ongoingThreads');
          const threads = await getOngoingThreadsAsync(userId);
          const activeThread = selectProactiveThread(threads);
          
          // Only use thread if no high-priority open loop (Priority Router logic)
          if (activeThread && (!topOpenLoop || (topOpenLoop && topOpenLoop.salience <= 0.7))) {
            proactiveThread = activeThread;
            console.log(`🧵 [Gemini] Found proactive thread for greeting: "${activeThread.currentState}"`);
          }
        } catch (e) {
          console.log('[Gemini] Could not fetch proactive thread for greeting');
        }

        const greetingPrompt = buildGreetingPrompt(relationship, hasUserFacts, userName, topOpenLoop, proactiveThread);
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

        // Mark the open loop as surfaced (we asked about it)
        if (topOpenLoop) {
          await markLoopSurfaced(topOpenLoop.id);
          console.log(`✅ [Gemini] Marked loop as surfaced: "${topOpenLoop.topic}"`);
        }

        // Mark thread as mentioned if we used it
        if (proactiveThread) {
          const { markThreadMentionedAsync } = await import('./ongoingThreads');
          markThreadMentionedAsync(userId, proactiveThread.id).catch(console.error);
        }

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

  /**
   * Generate greeting using Interactions API
   * Greeting is always a first message, so we send the full system prompt
   */
  private async generateGreetingWithInteractions(
    character: any,
    session: any,
    relationship: any,
    characterContext?: string
  ): Promise<any> {
    const ai = getAiClient();
    const userId = session?.userId || USER_ID;
    
    // Check if Interactions API is available (requires @google/genai v1.33.0+)
    if (!ai.interactions || typeof ai.interactions.create !== 'function') {
      console.warn('⚠️ [Gemini Interactions] Interactions API not available for greeting. Falling back to old API.');
      // Fallback to old implementation
      return await this.generateGreetingOld(character, session, relationship, characterContext);
    }
    
    const systemPrompt = await buildSystemPrompt(character, relationship, [], characterContext, undefined, undefined, undefined, undefined, session?.userId, undefined);

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
            console.log(`🤖 [Gemini Interactions] Found user name: ${userName}`);
          }
        } catch (e) {
          console.log('🤖 [Gemini Interactions] Could not fetch user facts for greeting');
        }

        // Build relationship-aware greeting prompt
        // First, fetch any open loops to ask about proactively
        let topOpenLoop = null;
        try {
          topOpenLoop = await getTopLoopToSurface(userId);
          if (topOpenLoop) {
            console.log(`🔄 [Gemini Interactions] Found open loop to surface: "${topOpenLoop.topic}"`);
          }
        } catch (e) {
          console.log('[Gemini Interactions] Could not fetch open loop for greeting');
        }

        const greetingPrompt = buildGreetingPrompt(relationship, hasUserFacts, userName, topOpenLoop);
        console.log(`🤖 [Gemini Interactions] Greeting tier: ${relationship?.relationshipTier || 'new'}, interactions: ${relationship?.totalInteractions || 0}`);

        // Build interaction config - greeting is always first message, so send system prompt
        const interactionConfig: any = {
          model: this.model,
          input: [{ type: 'text', text: greetingPrompt }],
          // Interactions API REST endpoint expects system_instruction as a plain string
          system_instruction: systemPrompt,
        };

        // Add memory tools to personalize greeting (e.g., look up user's name)
        // Interactions API requires each function to have type: 'function' directly in tools array
        if (ENABLE_MEMORY_TOOLS) {
          interactionConfig.tools = GeminiMemoryToolDeclarations.map(func => ({
            type: 'function', // Required by Interactions API
            name: func.name,
            description: func.description,
            parameters: func.parameters
          }));
          console.log('🧠 [Gemini Interactions Greeting] Memory tools enabled for personalization');
        }

        // Create interaction
        let interaction;
        try {
          // Priority: Vite proxy (dev) > External proxy > Direct call (will fail CORS)
          if (USE_VITE_PROXY) {
            // Use Vite's built-in proxy (development only)
            console.log('🔄 [Gemini Interactions Greeting] Using Vite proxy (development)');
            const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
            const response = await fetch(proxyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(interactionConfig),
            });
            
            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Proxy error: ${response.statusText} - ${errorText}`);
            }
            
            interaction = await response.json();
          } else if (GEMINI_PROXY_URL) {
            // Use external server proxy (if configured)
            console.log('🔄 [Gemini Interactions Greeting] Using external server proxy');
            const response = await fetch(GEMINI_PROXY_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(interactionConfig),
            });
            
            if (!response.ok) {
              throw new Error(`Proxy error: ${response.statusText}`);
            }
            
            interaction = await response.json();
          } else {
            // Direct call (will fail with CORS - this is expected)
            // CORS is by design: Google blocks browser calls for security
            // Fallback will handle it automatically
            interaction = await ai.interactions.create(interactionConfig);
          }
        } catch (error: any) {
          // Check for CORS or connection errors (Interactions API may not support browser calls)
          // The Interactions API endpoint may not support direct browser calls due to CORS
          const errorMessage = String(error?.message || '');
          const errorName = String(error?.name || error?.constructor?.name || '');
          const errorCode = String(error?.code || '');
          const errorString = String(error || '');
          
          // Check for various CORS/connection error indicators
          const isConnectionError = 
            errorMessage.includes('CORS') || 
            errorMessage.includes('Failed to fetch') ||
            errorMessage.includes('Connection error') ||
            errorMessage.includes('APIConnectionError') ||
            errorCode === 'APIConnectionError' ||
            errorName === 'APIConnectionError' ||
            errorString.includes('CORS') ||
            errorString.includes('Failed to fetch');
          
          if (isConnectionError) {
            console.warn('⚠️ [Gemini Interactions] CORS/Connection error in greeting.');
            console.warn('⚠️ [Gemini Interactions] Falling back to old Chat API.');
            // Fallback to old implementation
            return await this.generateGreetingOld(character, session, relationship, characterContext);
          }
          // Re-throw other errors
          throw error;
        }

        // Handle tool calls for greeting (e.g., looking up user's name)
        const MAX_TOOL_ITERATIONS = 2;
        let iterations = 0;

        while (interaction.outputs && iterations < MAX_TOOL_ITERATIONS) {
          const functionCalls = interaction.outputs.filter(
            (output: any) => output.type === 'function_call'
          );

          if (functionCalls.length === 0) break;

          iterations++;
          console.log(`🔧 [Gemini Interactions Greeting] Tool call iteration ${iterations}`);

          const toolResults = await Promise.all(
            functionCalls.map(async (functionCall: any) => {
              const toolName = functionCall.name as MemoryToolName;
              const toolArgs = functionCall.arguments || {};
              
              console.log(`🔧 [Gemini Interactions Greeting] Executing tool: ${toolName}`, toolArgs);
              const toolResult = await executeMemoryTool(toolName, toolArgs, userId);
              
              return {
                type: 'function_result',
                name: toolName,
                call_id: functionCall.id,
                result: toolResult
              };
            })
          );

          // Continue interaction with tool results
          const toolInteractionConfig = {
            model: this.model,
            previous_interaction_id: interaction.id,
            input: toolResults,
          };
          
          if (USE_VITE_PROXY) {
            // Use Vite's built-in proxy (development only)
            const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
            const response = await fetch(proxyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(toolInteractionConfig),
            });
            interaction = await response.json();
          } else if (GEMINI_PROXY_URL) {
            // Use external server proxy (if configured)
            const response = await fetch(GEMINI_PROXY_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(toolInteractionConfig),
            });
            interaction = await response.json();
          } else {
            interaction = await ai.interactions.create(toolInteractionConfig);
          }
        }

        // Extract text response from outputs
        const textOutput = interaction.outputs?.find(
          (output: any) => output.type === 'text'
        );

        const responseText = textOutput?.text || "{}";
        let structuredResponse: AIActionResponse;

        try {
          const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
          const parsed = JSON.parse(cleanedText);
          structuredResponse = normalizeAiResponse(parsed, cleanedText);
        } catch (e) {
          // When tools are enabled, plain text responses are expected (tools require text, not JSON)
          // Only log warning if tools are disabled (unexpected plain text)
          if (!ENABLE_MEMORY_TOOLS) {
            console.warn("Failed to parse Gemini JSON (tools disabled but got plain text):", responseText);
          }
          structuredResponse = { text_response: responseText, action_id: null };
        }

        // Generate audio for greeting
        const audioData = await generateSpeech(structuredResponse.text_response);

        // Mark the open loop as surfaced (we asked about it)
        if (topOpenLoop) {
          await markLoopSurfaced(topOpenLoop.id);
          console.log(`✅ [Gemini Interactions] Marked loop as surfaced: "${topOpenLoop.topic}"`);
        }

        return { 
            greeting: structuredResponse, 
            session: { 
                userId: session?.userId || USER_ID, 
                model: this.model,
                interactionId: interaction.id,  // Store for first real message
            },
            audioData
        }; 
    } catch (error) {
        console.error('Gemini Interactions Greeting Error:', error);
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
