import { GoogleGenAI } from "@google/genai";
import { ChatMessage, UploadedImage, Task } from "../types";
import {
  IAIChatService,
  AIChatSession,
  UserContent,
  AIChatOptions,
} from "./aiService";
import {
  buildSystemPromptForNonGreeting,
  buildGreetingPrompt,
  buildNonGreetingPrompt,
  buildProactiveThreadPrompt,
  getSoulLayerContextAsync,
  buildSystemPromptForGreeting,
  DailyLogisticsContext,
} from "./promptUtils";
import { AIActionResponse, GeminiMemoryToolDeclarations } from "./aiSchema";
import { generateSpeech } from "./elevenLabsService";
import {
  executeMemoryTool,
  MemoryToolName,
  getImportantDateFacts,
} from "./memoryService";
import { getTopLoopToSurface, markLoopSurfaced } from "./presenceDirector";
import { resolveActionKey } from "../utils/actionKeyMapper";
import {
  getUndeliveredMessage,
  markMessageDelivered,
  detectAndMarkSurfacedExperiences,
} from "./idleLife";
import { formatCharacterFactsForPrompt } from "./characterFactsService";
import { analyzeUserMessageBackground } from "./messageAnalyzer";
import {
  getOngoingThreadsAsync,
  selectProactiveThread,
  markThreadMentionedAsync,
} from "./ongoingThreads";
import { storeCharacterFact } from "./characterFactsService";
import { getPrefetchedContext, prefetchOnIdle } from "./prefetchService";
import { detectAndMarkSharedThoughts } from "./spontaneity/idleThoughts";
import type { RelationshipMetrics } from "./relationshipService";
import * as relationshipService from "./relationshipService";
import * as taskService from "./taskService";
import { calendarService, type CalendarEvent } from "./calendarService";
import { recordAlmostMoment } from "./almostMomentsService";
import { getKayleyPresenceState } from "./kayleyPresenceService";
import type { NonGreetingReturnContext } from "./system_prompts/builders/greetingPromptBuilders";
import { loadConversationHistory } from "./conversationHistoryService";

// 1. LOAD BOTH MODELS FROM ENV
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL; // The Brain (e.g. gemini-3-flash-preview)
const GEMINI_VIDEO_MODEL = import.meta.env.VITE_GEMINI_VIDEO_MODEL;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const VITE_PROXY_BASE = "/api/google"; // Matches vite.config.ts proxy path
const NON_GREETING_RETURN_CONTEXT_KEY = "kayley_non_greeting_return_context_v1";
const RAPID_RESUME_WINDOW_MINUTES = 15;
const RAPID_RESUME_WINDOW_MS = RAPID_RESUME_WINDOW_MINUTES * 60 * 1000;
if (!GEMINI_MODEL || !GEMINI_VIDEO_MODEL || !GEMINI_API_KEY) {
  console.error("Missing env vars. Ensure VITE_GEMINI_MODEL is set.");
  // throw new Error("Missing environment variables for Gemini chat service.");
}

/**
 * Log when the LLM uses an almost moment expression.
 * Now uses explicit schema field instead of pattern matching for accurate tracking.
 */
async function logAlmostMomentIfUsed(
  aiResponse: AIActionResponse,
): Promise<void> {
  // Check if LLM explicitly reported using an almost moment
  if (!aiResponse.almost_moment_used) return;

  const { feeling_id, stage, expression_used } = aiResponse.almost_moment_used;

  await recordAlmostMoment(
    feeling_id,
    stage,
    expression_used,
    "llm_confirmed_usage",
  );

  console.log(
    `[AlmostMoments] Logged: ${stage} - "${expression_used.substring(
      0,
      50,
    )}..."`,
  );
}

/**
 * Handle promise fulfillment when the LLM indicates it's fulfilling a promise.
 * Marks the promise as fulfilled in the database.
 */
async function handlePromiseFulfillment(
  aiResponse: AIActionResponse,
): Promise<void> {
  // Check if LLM is fulfilling a promise
  if (!aiResponse.fulfilling_promise_id) return;

  const promiseId = aiResponse.fulfilling_promise_id;

  // Extract fulfillment data from the response
  const fulfillmentData: any = {};

  // If there's a message, store it
  if (aiResponse.text_response) {
    fulfillmentData.messageText = aiResponse.text_response;
  }

  // If there's a selfie action, store the params
  if (aiResponse.selfie_action) {
    fulfillmentData.selfieParams = {
      scene: aiResponse.selfie_action.scene,
      mood: aiResponse.selfie_action.mood || "happy",
    };
  }

  // Import dynamically to avoid circular dependencies
  const { markPromiseAsFulfilled } = await import("./promiseService");

  const success = await markPromiseAsFulfilled(promiseId, fulfillmentData);

  if (success) {
    console.log(`[Promises] ✅ Fulfilled promise: ${promiseId}`);
  } else {
    console.warn(`[Promises] ⚠️ Failed to fulfill promise: ${promiseId}`);
  }
}

/**
 * Build character context from REAL presence state (what Kayley actually said she's doing).
 * Falls back to time-appropriate defaults if no presence state exists.
 */
async function buildRealCharacterContext(): Promise<string> {
  try {
    const presenceState = await getKayleyPresenceState();

    if (presenceState) {
      // Build context from real data
      const parts: string[] = [];

      if (presenceState.currentActivity) {
        parts.push(presenceState.currentActivity);
      }
      if (presenceState.currentOutfit) {
        parts.push(`wearing ${presenceState.currentOutfit}`);
      }
      if (presenceState.currentMood) {
        parts.push(`feeling ${presenceState.currentMood}`);
      }
      if (presenceState.currentLocation) {
        parts.push(`at ${presenceState.currentLocation}`);
      }

      if (parts.length > 0) {
        console.log(
          `✨ [GeminiService] Using real presence context: ${parts.join(", ")}`,
        );
        return parts.join(", ");
      }
    }
  } catch (error) {
    console.warn("[GeminiService] Failed to fetch presence state:", error);
    return "Just hanging out";
  }
}

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

/**
 * Convert user message to Interactions API input format
 * Supports text, audio, and image_text types
 */
function formatInteractionInput(userMessage: UserContent): any[] {
  if (userMessage.type === "text") {
    // Empty text triggers idle breaker - send system placeholder
    // (Gemini Interactions API requires non-empty input)
    if (!userMessage.text) {
      return [{ type: "text", text: "[SYSTEM: Initiate conversation]" }];
    }
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
/**
 * ⚠️ CRITICAL: When adding a new field to AIActionResponseSchema,
 * you MUST also add it here or it will be silently stripped out!
 *
 * See docs/Adding_Fields_To_AIActionResponse.md for details.
 */
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

  // ⚠️ WARNING: Every field in AIActionResponseSchema MUST be listed below!
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
    // Almost moment tracking
    almost_moment_used: rawJson.almost_moment_used || null,
    // Promise fulfillment
    fulfilling_promise_id: rawJson.fulfilling_promise_id || null,
    // ⚠️ REMINDER: Did you add your new field above? Check docs/Adding_Fields_To_AIActionResponse.md
  };
}

export class GeminiService implements IAIChatService {
  model = GEMINI_MODEL;

  // ============================================
  // INTERNAL CONTEXT FETCHING
  // ============================================

  /**
   * Fetch user context internally - the service is self-sufficient.
   */
  private async fetchUserContext(googleAccessToken: string): Promise<{
    relationship: RelationshipMetrics | null;
    upcomingEvents: CalendarEvent[];
    tasks: Task[];
    characterContext: string;
  }> {
    // Parallel fetch for performance (including real presence context)
    const [relationshipData, tasksData, characterContext] = await Promise.all([
      relationshipService.getRelationship(),
      taskService.fetchTasks(),
      buildRealCharacterContext(),
    ]);
    console.log("relationshipData: ", relationshipData);
    console.log("tasksData: ", tasksData);
    console.log("characterContext: ", characterContext);

    // Calendar events only if we have a token
    // TODO: Previous Calendar Events
    let upcomingEvents: CalendarEvent[] = [];
    try {
      upcomingEvents =
        await calendarService.getUpcomingEvents(googleAccessToken);
    } catch (e) {
      console.warn("[GeminiService] Calendar fetch failed:", e);
    }
    console.log("upcomingEvents: ", upcomingEvents);

    return {
      relationship: relationshipData,
      upcomingEvents,
      tasks: tasksData,
      characterContext,
    };
  }

  /**
   * Fire-and-forget pre-fetch trigger after a response is sent.
   * Keeps the context cache fresh for the next user message.
   */
  private triggerPostResponsePrefetch(): void {
    // delay slightly to avoid competing with UI updates/audio playback starts
    setTimeout(() => {
      // console.log(`🧪 [GeminiService] Triggering post-response pre-fetch`);
      prefetchOnIdle().catch((err) => {
        console.warn("⚠️ [GeminiService] Post-response pre-fetch failed:", err);
      });
    }, 1000);
  }

  // ============================================
  // HELPER METHODS (Refactored for reusability)
  // ============================================

  /**
   * Check if an error is a connection/CORS error
   */
  private isConnectionError(error: any): boolean {
    const errorMessage = String(error?.message || "");
    const errorName = String(error?.name || error?.constructor?.name || "");
    const errorCode = String(error?.code || "");
    const errorString = String(error || "");

    return (
      errorMessage.includes("CORS") ||
      errorMessage.includes("Failed to fetch") ||
      errorMessage.includes("Connection error") ||
      errorMessage.includes("APIConnectionError") ||
      errorCode === "APIConnectionError" ||
      errorName === "APIConnectionError" ||
      errorString.includes("CORS") ||
      errorString.includes("Failed to fetch")
    );
  }

  /**
   * Log connection/CORS error with helpful guidance
   */
  private logConnectionError(context: string = ""): void {
    console.warn(
      `⚠️ [Gemini Interactions${context}] CORS error detected (expected).`,
    );
    console.warn(
      "⚠️ [Gemini Interactions] Google blocks browser calls for security.",
    );
    console.warn("⚠️ [Gemini Interactions] Solutions:");
    console.warn("   1. Set VITE_GEMINI_PROXY_URL to use a server proxy");
    console.warn(
      "   2. Keep VITE_USE_GEMINI_INTERACTIONS_API=false (use old API)",
    );
    console.warn(
      "⚠️ [Gemini Interactions] Falling back to old Chat API (works reliably from browser).",
    );
  }

  /**
   * Build memory tools array for Interactions API
   */
  private buildMemoryTools(): any[] {
    return GeminiMemoryToolDeclarations.map((func) => ({
      type: "function",
      name: func.name,
      description: func.description,
      parameters: func.parameters,
    }));
  }

  /**
   * Create an interaction via API/proxy with error handling
   */
  private async createInteraction(config: any): Promise<any> {
    try {
      console.log("GATES - createInteraction  config: ", config);
      const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY, // Using a header is often safer for API keys through proxies
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Proxy error: ${response.statusText} - ${errorText}`);
      }

      return await response.json();
      return;
    } catch (error: any) {
      if (this.isConnectionError(error)) {
        this.logConnectionError();
      }
      throw error;
    }
  }

  /**
   * Handle tool calling loop - execute tools and continue interaction
   *
   * IMPORTANT: We include conversation history context to prevent the model
   * from confusing who said what after tool calls.
   */
  private async continueInteractionWithTools(
    interaction: any,
    interactionConfig: any,
    systemPrompt: string,
    options?: AIChatOptions,
    maxIterations: number = 10,
  ): Promise<any> {
    let iterations = 0;

    while (interaction.outputs && iterations < maxIterations) {
      const functionCalls = interaction.outputs.filter(
        (output: any) => output.type === "function_call",
      );

      if (functionCalls.length === 0) break;

      iterations++;
      console.log(
        `🔧 [Gemini Interactions] Tool call iteration ${iterations}:`,
        functionCalls.map((fc: any) => fc.name),
      );

      // Execute all tool calls
      const toolResults = await Promise.all(
        functionCalls.map(async (functionCall: any) => {
          const toolName = functionCall.name as MemoryToolName;
          const toolArgs = functionCall.arguments || {};

          console.log(
            `🔧 [Gemini Interactions] Executing tool: ${toolName}`,
            toolArgs,
          );

          const toolResult = await executeMemoryTool(toolName, toolArgs, {
            googleAccessToken: options?.googleAccessToken,
            userMessage:
              // Check for null/undefined explicitly before using 'in'
              options && typeof options === "object" && "chatHistory" in options
                ? options.chatHistory?.[options.chatHistory.length - 1]?.text
                : undefined,
          });

          return {
            type: "function_result",
            name: toolName,
            call_id: functionCall.id,
            result: toolResult,
          };
        }),
      );

      // Continue interaction with tool results
      // CRITICAL: Must include system_instruction again! The API doesn't persist it.
      // IMPORTANT: Include history context to prevent "who said what" confusion
      const toolInteractionConfig = {
        model: this.model,
        previous_interaction_id: interaction.id,
        input: [...toolResults],
        system_instruction: systemPrompt,
        tools: interactionConfig.tools,
        store: true,
        generation_config: {
          // Controls the depth of reasoning (Gemini 3 specific)
          thinking_level: "medium", // "high", "medium", "low"
          temperature: 1.0
        },
      };

      // Make continuation call
      interaction = await this.createInteraction(toolInteractionConfig);
    }

    if (iterations >= maxIterations) {
      console.warn("⚠️ [Gemini Interactions] Max tool iterations reached");
    }

    return interaction;
  }

  /**
   * Parse interaction response - extract and parse text output
   */
  private parseInteractionResponse(interaction: any): AIActionResponse {
    // CRITICAL FIX: Ensure we are looking at the interaction object
    // If the object passed is the wrapper { interaction, executedTools }, drill down
    const data = interaction.interaction
      ? interaction.interaction
      : interaction;

    if (!data.outputs || data.outputs.length === 0) {
      console.error(
        "❌ [Gemini Interactions] No outputs in response!",
        "Usage:",
        data.usage,
        "Status:",
        data.status,
      );

      return {
        text_response: "I'm having trouble processing that right now.",
        action_id: null,
      };
    }

    // Find the specific text block (skipping 'thought' blocks)
    const textOutput = data.outputs.find((o: any) => o.type === "text");
    const responseText = textOutput?.text || "{}";

    try {
      // Your model returns JSON inside a string, we must extract and parse it
      const cleanedText = responseText.replace(/```json\n?|\n?```/g, "").trim();
      const jsonText = extractJsonFromResponse(cleanedText);
      const parsed = JSON.parse(jsonText);

      return normalizeAiResponse(parsed, jsonText);
    } catch (e) {
      console.warn("Parsing fallback triggered for:", responseText);
      return {
        text_response: responseText,
        action_id: null,
      };
    }
  }

  // ============================================
  // PUBLIC METHODS
  // ============================================

  /**
   * Internal method to call Gemini API.
   */
  private async callGeminiAPI(
    systemPrompt: string,
    userMessage: UserContent,
    session?: AIChatSession,
    options?: AIChatOptions,
  ): Promise<{ response: AIActionResponse; session: AIChatSession }> {
    return await this.callProviderWithInteractions(
      systemPrompt,
      userMessage,
      session,
      options,
    );
  }

  /**
   * New implementation using Interactions API for stateful conversations
   * This method is called when USE_INTERACTIONS_API flag is enabled
   *
   * Key difference: System prompt is only sent on first message.
   * Subsequent messages use previous_interaction_id to maintain context.
   *
   * IMPORTANT: We now include explicit conversation history in the input
   * to prevent the model from confusing who said what (e.g., asking the user
   * about sushi when it was Kayley who was eating sushi).
   */
  private async callProviderWithInteractions(
    systemPrompt: string,
    userMessage: UserContent,
    session?: AIChatSession,
    options?: AIChatOptions,
  ): Promise<{ response: AIActionResponse; session: AIChatSession }> {
    // const ai = getAiClient();
    console.log("system prompt!!: ", systemPrompt);
    console.log("session!!: ", session);
    console.log("options!!: ", options);
    // Format user message for Interactions API
    const userInput = formatInteractionInput(userMessage);
    const input = [...userInput];

    // Determine if this is first message (no previous interaction)
    const isFirstMessage = !session?.interactionId;
    // console.log("🔗 [Gemini Interactions] SESSION DEBUG:");
    // console.log("   - isFirstMessage:", isFirstMessage);
    // console.log("   - Incoming session.interactionId:", session?.interactionId || "NONE");

    // Build interaction config
    const interactionConfig: any = {
      model: this.model,
      input: input,
      system_instruction: systemPrompt,
      store: true, // <-- Important - This enables server-side logging and session continuity
      generation_config: {
        // Controls the depth of reasoning (Gemini 3 specific)
        thinking_level: "medium", // "high", "medium", "low"
        temperature: 1.0
      },
    };

    if (isFirstMessage) {
      console.log(
        "🆕 [Gemini Interactions] First message - sending system prompt",
      );
    } else {
      console.log(
        "🔄 [Gemini Interactions] Continuing conversation - using previous_interaction_id + system prompt",
      );
      // Chain to previous conversation history
      interactionConfig.previous_interaction_id = session.interactionId;
    }

    // Interactions API requires each function to have type: 'function' directly in tools array
    interactionConfig.tools = this.buildMemoryTools();

    // Create interaction - with fallback for expired turn tokens
    let interaction;
    try {
      interaction = await this.createInteraction(interactionConfig);
    } catch (error: any) {
      // If turn token is invalid/expired, retry without continuity
      if (error.message?.includes("Invalid turn token")) {
        console.warn(
          `⚠️ [GeminiService] Turn token expired, creating fresh interaction`,
        );
        delete interactionConfig.previous_interaction_id;
        interaction = await this.createInteraction(interactionConfig);
      } else {
        throw error;
      }
    }
    console.log("INERACTIONS:: ", interaction);
    // Handle tool calling loop (pass history for context)
    const finalInteraction = await this.continueInteractionWithTools(
      interaction,
      interactionConfig,
      systemPrompt,
      options,
      3, // MAX_TOOL_ITERATIONS
    );
    console.log("FINAL INTERACTIONS: ", finalInteraction);
    // Parse response
    const structuredResponse = this.parseInteractionResponse(finalInteraction);

    // Update session with interaction ID (critical for stateful conversations!)
    console.log("🔗 [Gemini Interactions] RESPONSE DEBUG:");
    console.log("   -111 structuredResponse: ", structuredResponse);
    console.log("   - API returned interaction.id:", finalInteraction.id);
    console.log("   - Storing this ID for next message");

    const updatedSession: AIChatSession = {
      model: this.model,
      interactionId: finalInteraction.id, // Store for next message!
    };

    return {
      response: structuredResponse,
      session: updatedSession,
    };
  }

  // ============================================
  // MAIN PUBLIC API - generateResponse
  // ============================================

  /**
   * Main entry point for generating AI responses.
   * This method handles:
   * - Internal context fetching (relationship, tasks, etc.)
   * - Intent detection and pre-calculation
   * - Genuine moment instant reactions
   * - Calling the Gemini API
   * - Background message analysis
   * - TTS generation (sync/async/none modes)
   * - Post-response cache warming
   *
   * The caller only needs to pass minimal session-specific data.
   */
  async generateResponse(
    input: UserContent,
    options: AIChatOptions,
    session?: AIChatSession,
  ): Promise<{
    response: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }> {
    try {
      console.log("generateResponse - input:", input);
      const fetchedContext = await this.fetchUserContext(
        options.googleAccessToken,
      );
      console.log("fetchedContext: ", fetchedContext);
      // ============================================
      // BUILD SYSTEM PROMPT
      // ============================================

      // Move 37: Intent detection removed - main LLM reads messages directly
      const systemPrompt = await buildSystemPromptForNonGreeting(
        fetchedContext.relationship,
        fetchedContext.upcomingEvents,
        fetchedContext.characterContext,
        fetchedContext.tasks,
      );
      console.log("systemPrompt: ", systemPrompt);
      // ============================================
      // CALL GEMINI API
      // ============================================
      const { response: aiResponse, session: updatedSession } =
        await this.callGeminiAPI(systemPrompt, input, session, options);

      // ============================================
      // POST-PROCESSING
      // ============================================

      // Log almost moment usage
      console.log("aiResponse: ", aiResponse);
      console.log("updatedSession: ", updatedSession);
      logAlmostMomentIfUsed(aiResponse).catch((err) => {
        console.warn("[GeminiService] Failed to log almost moment:", err);
      });

      // Handle promise fulfillment
      handlePromiseFulfillment(aiResponse).catch((err) => {
        console.warn(
          "[GeminiService] Failed to handle promise fulfillment:",
          err,
        );
      });

      // Store new character facts if AI generated any
      if (aiResponse.store_self_info) {
        const { category, key, value } = aiResponse.store_self_info;
        console.log(
          `💾 [GeminiService] AI generated new character fact: ${category}.${key} = "${value}"`,
        );

        storeCharacterFact(category as any, key, value)
          .then((stored) => {
            if (stored) {
              console.log(
                `✅ [GeminiService] Character fact saved successfully: ${key}`,
              );
            } else {
              console.log(
                `📋 [GeminiService] Character fact already exists or in profile: ${key}`,
              );
            }
          })
          .catch((err) => {
            console.warn(
              `⚠️ [GeminiService] Failed to store character fact:`,
              err,
            );
          });
      }

      // Detect and mark shared idle thoughts
      if (aiResponse.text_response) {
        detectAndMarkSharedThoughts(aiResponse.text_response)
          .then((markedIds) => {
            if (markedIds.length > 0) {
              console.log(
                `💭 [GeminiService] Marked ${markedIds.length} idle thought(s) as shared`,
              );
            }
          })
          .catch((err) => {
            console.warn(
              "[GeminiService] Failed to detect/mark shared thoughts:",
              err,
            );
          });

        // Detect and mark surfaced Kayley experiences
        detectAndMarkSurfacedExperiences(aiResponse.text_response)
          .then((markedIds) => {
            if (markedIds.length > 0) {
              console.log(
                `🎭 [GeminiService] Marked ${markedIds.length} experience(s) as surfaced`,
              );
            }
          })
          .catch((err) => {
            console.warn(
              "[GeminiService] Failed to detect surfaced experiences:",
              err,
            );
          });
      }
      return {
        response: aiResponse,
        session: updatedSession,
      };
    } catch (error) {
      console.error("Gemini Service Error:", error);
      throw error;
    }
  }

  // ============================================
  // GREETING METHODS
  // ============================================

  /**
   * Generate greeting using Interactions API.
   * Fetches all context internally.
   * If first login of the day, includes daily logistics (calendar, tasks, emails).
   */
  async generateGreeting(googleAccessToken: string): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }> {
    console.log(
      "🌅 [GeminiService] First login of the day - including daily logistics in greeting",
    );

    // ============================================
    // PARALLEL FETCH FOR GREETING CONTEXT
    // ============================================
    // Fetch all data in parallel for performance
    const [fetchedContext, importantDateFacts] = await Promise.all([
      this.fetchUserContext(googleAccessToken),
      getImportantDateFacts(),
    ]);

    console.log("fetchedContext: ", fetchedContext);
    console.log("importantDateFacts: ", importantDateFacts);
    // Filter tasks to incomplete only for greeting prompt
    const incompleteTasks = (fetchedContext.tasks || []).filter(
      (t) => !t.completed && t.priority === "high",
    );

    console.log("incompleteTasks: ", incompleteTasks);

    // Build greeting context from parallel-fetched data
    let greetingContext: DailyLogisticsContext | null = null;
    // let chatHistory = await loadConversationHistory();
    greetingContext = {
      chatHistory: [],
      lastInteractionDateUtc: fetchedContext.relationship.lastInteractionAt,
      importantDateFacts: importantDateFacts.map((f) => ({
        key: f.fact_key,
        value: f.fact_value,
      })),
      tasks: incompleteTasks,
      upcomingEvents: fetchedContext.upcomingEvents,
      // Past calendar events would need to be fetched separately
      // For now, we can filter upcomingEvents client-side if needed
      pastCalendarEvents: [], // TODO:
      kayleyLifeUpdates: [], // TODO: fetch from storyline service if needed
    };

    console.log("greetingContext: ", greetingContext);
    const systemPrompt = await buildSystemPromptForGreeting(greetingContext);
    console.log("systemPrompt: ", systemPrompt);
    const greetingPrompt = buildGreetingPrompt(fetchedContext.relationship);
    console.log("greetingPrompt: ", greetingPrompt);
    // Build interaction config
    const interactionConfig: any = {
      model: this.model,
      input: [{ type: "text", text: greetingPrompt }],
      system_instruction: systemPrompt,
      store: true, // REQUIRED: This ensures logs appear in AI Studio
      generation_config: {
        // Uses the dynamic level calculated above
        thinking_level: "medium",
        temperature: 1.0
      },
      // Combined your custom memory tools with Google Search
      tools: [...this.buildMemoryTools()],
    };

    console.log("interactionConfig: ", interactionConfig);
    // Create the interaction via your proxy
    const interaction = await this.createInteraction(interactionConfig);
    console.log("INERACTIONS:: ", interaction);
    // Handle tool calling loop (pass history for context)
    const finalInteraction = await this.continueInteractionWithTools(
      interaction,
      interactionConfig,
      systemPrompt,
      null,
      3, // MAX_TOOL_ITERATIONS
    );

    // Parse response
    const structuredFinalResponse =
      this.parseInteractionResponse(finalInteraction);

    // Update session with interaction ID (critical for stateful conversations!)
    console.log("🔗 [Gemini Interactions] RESPONSE DEBUG:");
    console.log("   -222 structuredResponse: ", structuredFinalResponse);
    console.log("   - API returned interaction.id:", finalInteraction.id);
    console.log("   - Storing this ID for next message");

    return {
      greeting: structuredFinalResponse,
      session: {
        model: this.model,
        interactionId: interaction.id,
      },
    };
  }

  /**
   * Generate a natural "welcome back" response for returning users.
   * Fetches all context internally.
   */
  async generateNonGreeting(
    session: AIChatSession,
    googleAccessToken: string,
  ): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }> {
    console.log("GATES generateNonGreeting");
    // Fetch context internally
    const fetchedContext = await this.fetchUserContext(googleAccessToken);

    let systemPrompt = await buildSystemPromptForNonGreeting(
      fetchedContext.relationship,
      fetchedContext.upcomingEvents,
      fetchedContext.characterContext,
      fetchedContext.tasks,
    );

    // ============================================
    // INJECT PENDING STORYLINE SUGGESTION (Phase 2)
    // ============================================
    const { getPendingSuggestion, markSuggestionSurfaced } =
      await import("./storylineIdleService");
    const pendingSuggestion = await getPendingSuggestion();

    if (pendingSuggestion) {
      console.log(
        `💭 [Chat] Found pending storyline suggestion: "${pendingSuggestion.theme}"`,
      );

      // Add to system prompt (PASSIVE style - LLM decides when to mention)
      const suggestionPrompt = `

====================================================
RECENT THOUGHTS (While You Were Away)
====================================================

You've been thinking about ${pendingSuggestion.theme}.

**Why this matters to you:**
${pendingSuggestion.reasoning}

**How to handle this:**
- If it feels natural to the conversation, you might mention this
- Don't force it - only bring it up if it fits the flow
- If you decide to announce this as a new life storyline, use the create_life_storyline tool
- If you don't mention it this conversation, that's fine - it will still be on your mind for later

`;

      systemPrompt += suggestionPrompt;

      // Mark as surfaced (shown to user)
      await markSuggestionSurfaced(pendingSuggestion.id);
    }

    try {
      // Fetch any pending message from idle time
      let pendingMessage = null;
      try {
        pendingMessage = await getUndeliveredMessage();
        if (pendingMessage) {
          console.log(
            `[GeminiService] Found pending ${pendingMessage.trigger} message to deliver`,
          );
        }
      } catch (e) {
        console.log(
          "[GeminiService] Could not fetch pending message for non-greeting",
        );
      }

      const nonGreetingPrompt = buildNonGreetingPrompt(
        fetchedContext.relationship.lastInteractionAt,
        fetchedContext.characterContext,
        pendingMessage,
      );

      // Build interaction config
      const interactionConfig: any = {
        model: this.model,
        input: [{ type: "text", text: nonGreetingPrompt }],
        system_instruction: systemPrompt,
        store: true, // <-- Important - This enables server-side logging and session continuity
        generation_config: {
          thinking_level: "medium", // "high", "medium", "low"
          temperature: 1.0
        },
      };

      if (session?.interactionId) {
        console.log(
          `🔗 [GeminiService] Restoring continuity for Non-Greeting: ${session.interactionId}`,
        );
        interactionConfig.previous_interaction_id = session.interactionId;
      }

      // Add memory tools
      interactionConfig.tools = this.buildMemoryTools();

      // Create interaction - with fallback for expired turn tokens
      let interaction;
      try {
        interaction = await this.createInteraction(interactionConfig);
      } catch (error: any) {
        // If turn token is invalid/expired, retry without continuity
        if (error.message?.includes("Invalid turn token")) {
          console.warn(
            `⚠️ [GeminiService] Turn token expired, creating fresh interaction`,
          );
          delete interactionConfig.previous_interaction_id;
          interaction = await this.createInteraction(interactionConfig);
        } else {
          throw error;
        }
      }

      // Handle tool calls
      interaction = await this.continueInteractionWithTools(
        interaction,
        interactionConfig,
        systemPrompt,
        undefined,
        2,
      );

      // Parse response
      const structuredResponse = this.parseInteractionResponse(interaction);

      // Generate audio
      const audioData = await generateSpeech(structuredResponse.text_response);

      // Detect and mark surfaced Kayley experiences (fire-and-forget)
      detectAndMarkSurfacedExperiences(structuredResponse.text_response).catch(
        (err) =>
          console.warn(
            "[GeminiService] Failed to detect surfaced experiences in non-greeting:",
            err,
          ),
      );

      // Handle promise fulfillment (fire-and-forget)
      handlePromiseFulfillment(structuredResponse).catch((err) => {
        console.warn(
          "[GeminiService] Failed to handle promise fulfillment in non-greeting:",
          err,
        );
      });

      // Log almost moment usage (fire-and-forget)
      logAlmostMomentIfUsed(structuredResponse).catch((err) => {
        console.warn(
          "[GeminiService] Failed to log almost moment in non-greeting:",
          err,
        );
      });

      // Mark the pending message as delivered
      if (pendingMessage) {
        await markMessageDelivered(pendingMessage.id);
        console.log(
          `✅ [GeminiService] Marked pending ${pendingMessage.trigger} message as delivered`,
        );
      }

      return {
        greeting: structuredResponse,
        session: {
          model: this.model,
          interactionId: interaction.id,
        },
        audioData,
      };
    } catch (error) {
      console.error("Gemini Non-Greeting Error:", error);
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
    await new Promise((resolve) => setTimeout(resolve, 10000));
    try {
      currentOperation = await ai.operations.getVideosOperation({
        operation: currentOperation,
      });
    } catch (e) {
      console.error("Polling failed", e);
      throw new Error("Failed while polling for video generation status.");
    }
  }

  if (currentOperation.error) {
    console.error("Video generation failed:", currentOperation.error);
    throw new Error(
      `Video generation failed: ${currentOperation.error.message}`,
    );
  }

  const downloadLink =
    currentOperation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink)
    throw new Error("Video generation completed without a download link.");

  const key = import.meta.env.VITE_GEMINI_API_KEY;
  const response = await fetch(`${downloadLink}&key=${key}`);
  if (!response.ok)
    throw new Error(`Failed to download video: ${response.statusText}`);
  return await response.blob();
};

const generateSingleVideo = (image: UploadedImage, prompt: string) => {
  const ai = getAiClient();
  return ai.models.generateVideos({
    model: GEMINI_VIDEO_MODEL,
    prompt,
    image: { imageBytes: image.base64, mimeType: image.mimeType },
    config: { numberOfVideos: 1, resolution: "720p", aspectRatio: "9:16" },
  });
};

export const generateInitialVideo = async (
  image: UploadedImage,
): Promise<Blob> => {
  console.log("Generating new initial video.");
  const prompt = `Animate the character from this image to create a short, seamlessly looping video. The character should be sitting at a desk, looking forward with a pleasant, neutral expression.`;
  const operation = await generateSingleVideo(image, prompt);
  return await pollVideoOperation(operation);
};

export const generateActionVideo = async (
  image: UploadedImage,
  command: string,
): Promise<string> => {
  const prompt = `Animate the character from this image to perform the following action: "${command}".`;
  const operation = await generateSingleVideo(image, prompt);
  const blob = await pollVideoOperation(operation);
  return URL.createObjectURL(blob);
};
