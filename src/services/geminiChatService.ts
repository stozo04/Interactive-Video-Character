import { GoogleGenAI } from "@google/genai";
import { ChatMessage, UploadedImage } from '../types';
import { AIChatSession, UserContent, AIChatOptions } from './aiService';
import { buildSystemPrompt, buildGreetingPrompt } from './promptUtils';
import { AIActionResponse, GeminiMemoryToolDeclarations } from './aiSchema';
import { generateSpeech } from './elevenLabsService';
import { BaseAIService } from './BaseAIService';
import { executeMemoryTool, MemoryToolName } from './memoryService';
import { getTopLoopToSurface, markLoopSurfaced } from './presenceDirector';
import { resolveActionKey } from '../utils/actionKeyMapper';

// 1. LOAD BOTH MODELS FROM ENV
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL; // The Brain (e.g. gemini-3-flash-preview)
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

const safetySettings = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
];

const getAiClient = () => {
  return new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    // Note: CORS is expected - Google blocks browser calls for security
    // Use VITE_GEMINI_PROXY_URL to set up a server proxy if needed
  });
};

/**
 * Extract JSON from a response that may have conversational text before it.
 * The AI sometimes outputs "Here's the thing! { ... }" instead of just "{ ... }"
 * This extracts the JSON portion for parsing.
 */
function extractJsonFromResponse(responseText: string): string {
  const trimmed = responseText.trim();

  // If it already starts with {, return as-is
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  // Try to find balanced JSON object
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) {
    return trimmed; // No JSON found
  }

  // Find matching closing brace (handles nested braces)
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = firstBrace; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\" && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) {
          const extracted = trimmed.slice(firstBrace, i + 1);
          console.log("🔧 [Gemini] Extracted JSON from mixed response");
          return extracted;
        }
      }
    }
  }

  // Fallback: try last brace approach
  const lastBraceIndex = trimmed.lastIndexOf("{");
  if (lastBraceIndex !== -1) {
    const potentialJson = trimmed.slice(lastBraceIndex);
    if (potentialJson.trim().endsWith("}")) {
      return potentialJson;
    }
  }

  return trimmed;
}

// Helper to format history - NOW ONLY USED FOR CURRENT SESSION
function convertToGeminiHistory(history: ChatMessage[]) {
  // For fresh sessions, we only pass the current session's messages
  // Memory from past sessions is retrieved via tools
  const filtered = history
    .filter((msg) => {
      const text = msg.text?.trim();
      return (
        text &&
        text.length > 0 &&
        text !== "🎤 [Audio Message]" &&
        text !== "📷 [Sent an Image]"
      );
    })
    .map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.text }],
    }));

  console.log(
    `📜 [Gemini] Passing ${filtered.length} session messages to chat history`
  );
  return filtered;
}

/**
 * Convert user message to Interactions API input format
 * Supports text, audio, and image_text types
 */
function formatInteractionInput(userMessage: UserContent): any[] {
  if (userMessage.type === "text") {
    return [{ type: "text", text: userMessage.text }];
  } else if (userMessage.type === "audio") {
    return [
      {
        type: "audio",
        data: userMessage.data,
        mime_type: userMessage.mimeType,
      },
    ];
  } else if (userMessage.type === "image_text") {
    return [
      { type: "text", text: userMessage.text },
      {
        type: "image",
        data: userMessage.imageData,
        mime_type: userMessage.mimeType,
      },
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
      type: "draw", // Must be valid WhiteboardAction type: 'none'|'mark_cell'|'guess'|'describe'|'draw'
      draw_shapes: rawJson.draw_shapes,
    };
  }

  // Resolve action key to UUID (handles fuzzy matching and fallback)
  const actionId = resolveActionKey(rawJson.action_id);

  return {
    text_response: rawJson.text_response || rawJson.response || rawText,
    action_id: actionId,
    user_transcription: rawJson.user_transcription || null,
    // NOTE: task_action is now a function tool, not part of JSON response
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
    session?: AIChatSession,
    options?: AIChatOptions
  ) {
    // Check if this is a calendar query (marked by injected calendar data)
    const isCalendarQuery =
      userMessage.type === "text" &&
      userMessage.text.includes("[LIVE CALENDAR DATA");

    return await this.callProviderWithInteractions(
      systemPrompt,
      userMessage,
      history,
      session,
      isCalendarQuery,
      options
    );
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
    isCalendarQuery: boolean = false,
    options?: AIChatOptions
  ): Promise<{ response: AIActionResponse; session: AIChatSession }> {
    const ai = getAiClient();
    const userId = session?.userId || USER_ID;

    // Format user message for Interactions API
    const input = formatInteractionInput(userMessage);

    // Determine if this is first message (no previous interaction)
    const isFirstMessage = !session?.interactionId;
    console.log("🔗 [Gemini Interactions] SESSION DEBUG:");
    console.log("   - isFirstMessage:", isFirstMessage);
    console.log(
      "   - Incoming session.interactionId:",
      session?.interactionId || "NONE"
    );
    // Build interaction config
    const interactionConfig: any = {
      model: this.model,
      input: input,
      system_instruction: systemPrompt,
      // safety_settings: safetySettings,
    };

    if (isFirstMessage) {
      console.log(
        "🆕 [Gemini Interactions] First message - sending system prompt"
      );
    } else {
      console.log(
        "🔄 [Gemini Interactions] Continuing conversation - using previous_interaction_id + system prompt"
      );
      // Chain to previous conversation history
      interactionConfig.previous_interaction_id = session.interactionId;
    }

    // Add memory tools if enabled
    // Interactions API requires each function to have type: 'function' directly in tools array
    interactionConfig.tools = GeminiMemoryToolDeclarations.map((func) => ({
      type: "function", // Required by Interactions API
      name: func.name,
      description: func.description,
      parameters: func.parameters,
    }));
    console.log("🧠 [Gemini Interactions] Memory tools enabled");

    // Create interaction
    let interaction;
    try {
      // Use Vite's built-in proxy (development only)
      console.log("🔄 [Gemini Interactions] Using Vite proxy (development)");
      const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(interactionConfig),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Proxy error: ${response.statusText} - ${errorText}`);
      }

      interaction = await response.json();
    } catch (error: any) {
      // Check for CORS or connection errors
      // CORS is expected - Google intentionally blocks browser calls for security
      const errorMessage = String(error?.message || "");
      const errorName = String(error?.name || error?.constructor?.name || "");
      const errorCode = String(error?.code || "");
      const errorString = String(error || "");

      // Check for various CORS/connection error indicators
      const isConnectionError =
        errorMessage.includes("CORS") ||
        errorMessage.includes("Failed to fetch") ||
        errorMessage.includes("Connection error") ||
        errorMessage.includes("APIConnectionError") ||
        errorCode === "APIConnectionError" ||
        errorName === "APIConnectionError" ||
        errorString.includes("CORS") ||
        errorString.includes("Failed to fetch");

      if (isConnectionError) {
        console.warn(
          "⚠️ [Gemini Interactions] CORS error detected (expected)."
        );
        console.warn(
          "⚠️ [Gemini Interactions] Google blocks browser calls for security."
        );
        console.warn("⚠️ [Gemini Interactions] Solutions:");
        console.warn("   1. Set VITE_GEMINI_PROXY_URL to use a server proxy");
        console.warn(
          "   2. Keep VITE_USE_GEMINI_INTERACTIONS_API=false (use old API)"
        );
        console.warn(
          "⚠️ [Gemini Interactions] Falling back to old Chat API (works reliably from browser)."
        );
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
        (output: any) => output.type === "function_call"
      );

      if (functionCalls.length === 0) break;

      iterations++;
      console.log(
        `🔧 [Gemini Interactions] Tool call iteration ${iterations}:`,
        functionCalls.map((fc: any) => fc.name)
      );

      // Execute all tool calls
      const toolResults = await Promise.all(
        functionCalls.map(async (functionCall: any) => {
          const toolName = functionCall.name as MemoryToolName;
          const toolArgs = functionCall.arguments || {};

          console.log(
            `🔧 [Gemini Interactions] Executing tool: ${toolName}`,
            toolArgs
          );

          const toolResult = await executeMemoryTool(
            toolName,
            toolArgs,
            userId,
            {
              googleAccessToken: options?.googleAccessToken,
              currentEvents: options?.upcomingEvents,
            }
          );

          return {
            type: "function_result",
            name: toolName,
            call_id: functionCall.id,
            result: toolResult,
          };
        })
      );

      // Continue interaction with tool results
      // CRITICAL: Must include system_instruction again! The API doesn't persist it.
      // Without this, the AI forgets its character identity after tool calls.
      const toolInteractionConfig = {
        model: this.model,
        previous_interaction_id: interaction.id,
        input: toolResults,
        system_instruction: systemPrompt, // Re-send character identity!
        // safety_settings: safetySettings,
        tools: interactionConfig.tools, // Re-send available tools (like selfie_action)
      };
      if (USE_VITE_PROXY) {
        // Use Vite's built-in proxy (development only)
        const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
        const response = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toolInteractionConfig),
        });
        interaction = await response.json();
      } else if (GEMINI_PROXY_URL) {
        // Use external server proxy (if configured)
        const response = await fetch(GEMINI_PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toolInteractionConfig),
        });
        interaction = await response.json();
      } else {
        console.log("GATES interactions.create 22222 ");
        interaction = await ai.interactions.create(toolInteractionConfig);
      }
    }

    if (iterations >= MAX_TOOL_ITERATIONS) {
      console.warn("⚠️ [Gemini Interactions] Max tool iterations reached");
    }

    // Extract text response from outputs
    const textOutput = interaction.outputs?.find(
      (output: any) => output.type === "text"
    );

    const responseText = textOutput?.text || "{}";

    // Parse response (same as old code)
    // Note: When tools are enabled, responses are plain text, not JSON
    let structuredResponse: AIActionResponse;
    try {
      // Clean markdown code blocks and extract JSON (handles text-before-JSON bug)
      const cleanedText = responseText.replace(/```json\n?|\n?```/g, "").trim();
      const jsonText = extractJsonFromResponse(cleanedText);
      const parsed = JSON.parse(jsonText);
      structuredResponse = normalizeAiResponse(parsed, jsonText);
    } catch (e) {
      // If parsing fails, it's likely plain text (expected when tools are used)
      // This is normal behavior - tools require text responses, not JSON
      if (ENABLE_MEMORY_TOOLS) {
        // Tools were used, plain text is expected
        structuredResponse = {
          text_response: responseText,
          action_id: null,
        };
      } else {
        // Tools not used but still got plain text - log warning
        console.warn(
          "Failed to parse Gemini JSON (tools disabled but got plain text):",
          responseText
        );
        structuredResponse = {
          text_response: responseText,
          action_id: null,
        };
      }
    }

    // Update session with interaction ID (critical for stateful conversations!)
    console.log("🔗 [Gemini Interactions] RESPONSE DEBUG:");
    console.log("   - API returned interaction.id:", interaction.id);
    console.log("   - Storing this ID for next message");

    const updatedSession: AIChatSession = {
      userId: userId,
      model: this.model,
      interactionId: interaction.id, // Store for next message!
    };

    return {
      response: structuredResponse,
      session: updatedSession,
    };
  }

  /**
   * Generate greeting using Interactions API
   * Greeting is always a first message, so we send the full system prompt
   */
  async generateGreeting(
    character: any,
    session: any,
    relationship: any,
    characterContext?: string
  ): Promise<any> {
    const ai = getAiClient();
    const userId = session?.userId || USER_ID;

    const systemPrompt = await buildSystemPrompt(
      character,
      relationship,
      [],
      characterContext,
      undefined,
      undefined,
      undefined,
      undefined,
      session?.userId,
      undefined
    );

    try {
      // First, try to get user's name from stored facts
      let userName: string | null = null;
      let hasUserFacts = false;

      try {
        const userFacts = await executeMemoryTool(
          "recall_user_info",
          { category: "identity" },
          userId
        );
        hasUserFacts =
          userFacts && !userFacts.includes("No stored information");

        // Extract name if present
        const nameMatch = userFacts.match(/name:\s*(\w+)/i);
        if (nameMatch) {
          userName = nameMatch[1];
          console.log(`🤖 [Gemini Interactions] Found user name: ${userName}`);
        }
      } catch (e) {
        console.log(
          "🤖 [Gemini Interactions] Could not fetch user facts for greeting"
        );
      }

      // Build relationship-aware greeting prompt
      // First, fetch any open loops to ask about proactively
      let topOpenLoop = null;
      try {
        topOpenLoop = await getTopLoopToSurface(userId);
        if (topOpenLoop) {
          console.log(
            `🔄 [Gemini Interactions] Found open loop to surface: "${topOpenLoop.topic}"`
          );
        }
      } catch (e) {
        console.log(
          "[Gemini Interactions] Could not fetch open loop for greeting"
        );
      }

      const greetingPrompt = buildGreetingPrompt(
        relationship,
        hasUserFacts,
        userName,
        topOpenLoop
      );
      console.log(
        `🤖 [Gemini Interactions] Greeting tier: ${
          relationship?.relationshipTier || "new"
        }, interactions: ${relationship?.totalInteractions || 0}`
      );

      // Build interaction config - greeting is always first message, so send system prompt
      const interactionConfig: any = {
        model: this.model,
        input: [{ type: "text", text: greetingPrompt }],
        // safety_settings: safetySettings,
        // Interactions API REST endpoint expects system_instruction as a plain string
        system_instruction: systemPrompt,
      };

      // Add memory tools to personalize greeting (e.g., look up user's name)
      // Interactions API requires each function to have type: 'function' directly in tools array

      interactionConfig.tools = GeminiMemoryToolDeclarations.map((func) => ({
        type: "function", // Required by Interactions API
        name: func.name,
        description: func.description,
        parameters: func.parameters,
      }));

      // Create interaction
      let interaction;
      try {
        // Use Vite's built-in proxy (development only)
        console.log(
          "🔄 [Gemini Interactions Greeting] Using Vite proxy (development)"
        );
        const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
        const response = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(interactionConfig),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Proxy error: ${response.statusText} - ${errorText}`);
        }

        interaction = await response.json();
      } catch (error: any) {
        // Check for CORS or connection errors (Interactions API may not support browser calls)
        // The Interactions API endpoint may not support direct browser calls due to CORS
        const errorMessage = String(error?.message || "");
        const errorName = String(error?.name || error?.constructor?.name || "");
        const errorCode = String(error?.code || "");
        const errorString = String(error || "");

        // Check for various CORS/connection error indicators
        const isConnectionError =
          errorMessage.includes("CORS") ||
          errorMessage.includes("Failed to fetch") ||
          errorMessage.includes("Connection error") ||
          errorMessage.includes("APIConnectionError") ||
          errorCode === "APIConnectionError" ||
          errorName === "APIConnectionError" ||
          errorString.includes("CORS") ||
          errorString.includes("Failed to fetch");

        if (isConnectionError) {
          console.warn(
            "⚠️ [Gemini Interactions] CORS/Connection error in greeting."
          );
          console.warn(
            "⚠️ [Gemini Interactions] Falling back to old Chat API."
          );
        }
        // Re-throw other errors
        throw error;
      }

      // Handle tool calls for greeting (e.g., looking up user's name)
      const MAX_TOOL_ITERATIONS = 2;
      let iterations = 0;

      while (interaction.outputs && iterations < MAX_TOOL_ITERATIONS) {
        const functionCalls = interaction.outputs.filter(
          (output: any) => output.type === "function_call"
        );

        if (functionCalls.length === 0) break;

        iterations++;
        console.log(
          `🔧 [Gemini Interactions Greeting] Tool call iteration ${iterations}`
        );

        const toolResults = await Promise.all(
          functionCalls.map(async (functionCall: any) => {
            const toolName = functionCall.name as MemoryToolName;
            const toolArgs = functionCall.arguments || {};

            console.log(
              `🔧 [Gemini Interactions Greeting] Executing tool: ${toolName}`,
              toolArgs
            );
            const toolResult = await executeMemoryTool(
              toolName,
              toolArgs,
              userId
            );

            return {
              type: "function_result",
              name: toolName,
              call_id: functionCall.id,
              result: toolResult,
            };
          })
        );

        // Continue interaction with tool results
        // CRITICAL: Must include system_instruction again! The API doesn't persist it.
        // Without this, the AI forgets its character identity after tool calls.
        const toolInteractionConfig = {
          model: this.model,
          previous_interaction_id: interaction.id,
          input: toolResults,
          // safety_settings: safetySettings,
          system_instruction: systemPrompt, // Re-send character identity!
          tools: interactionConfig.tools, // Re-send available tools (like selfie_action)
        };

        // Use Vite's built-in proxy (development only)
        const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
        const response = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toolInteractionConfig),
        });
        interaction = await response.json();
      }

      // Extract text response from outputs
      const textOutput = interaction.outputs?.find(
        (output: any) => output.type === "text"
      );

      const responseText = textOutput?.text || "{}";
      let structuredResponse: AIActionResponse;

      try {
        const cleanedText = responseText
          .replace(/```json\n?|\n?```/g, "")
          .trim();
        const parsed = JSON.parse(cleanedText);
        structuredResponse = normalizeAiResponse(parsed, cleanedText);
      } catch (e) {
        // When tools are enabled, plain text responses are expected (tools require text, not JSON)
        // Only log warning if tools are disabled (unexpected plain text)
        if (!ENABLE_MEMORY_TOOLS) {
          console.warn(
            "Failed to parse Gemini JSON (tools disabled but got plain text):",
            responseText
          );
        }
        structuredResponse = { text_response: responseText, action_id: null };
      }

      // Generate audio for greeting
      const audioData = await generateSpeech(structuredResponse.text_response);

      // Mark the open loop as surfaced (we asked about it)
      if (topOpenLoop) {
        await markLoopSurfaced(topOpenLoop.id);
        console.log(
          `✅ [Gemini Interactions] Marked loop as surfaced: "${topOpenLoop.topic}"`
        );
      }

      return {
        greeting: structuredResponse,
        session: {
          userId: session?.userId || USER_ID,
          model: this.model,
          interactionId: interaction.id, // Store for first real message
        },
        audioData,
      };
    } catch (error) {
      console.error("Gemini Interactions Greeting Error:", error);
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
