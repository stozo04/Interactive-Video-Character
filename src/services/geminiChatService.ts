import { GoogleGenAI } from "@google/genai";
import { ChatMessage, UploadedImage, Task } from "../types";
import {
  IAIChatService,
  AIChatSession,
  UserContent,
  AIChatOptions,
} from "./aiService";
import {
  buildSystemPrompt,
  buildGreetingPrompt,
  buildNonGreetingPrompt,
  buildProactiveThreadPrompt,
  getSoulLayerContextAsync,
} from "./promptUtils";
import { AIActionResponse, GeminiMemoryToolDeclarations } from "./aiSchema";
import { generateSpeech } from "./elevenLabsService";
import { executeMemoryTool, MemoryToolName } from "./memoryService";
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
  detectFullIntentLLMCached,
  isFunctionalCommand,
  type FullMessageIntent,
} from "./intentService";
import { recordInteractionAsync } from "./moodKnobs";
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
import {
  hasBeenBriefedToday,
  markBriefedToday,
  type DailyLogisticsContext,
} from "./dailyCatchupService";
import { getKayleyPresenceState } from "./kayleyPresenceService";

// 1. LOAD BOTH MODELS FROM ENV
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL; // The Brain (e.g. gemini-3-flash-preview)
const GEMINI_VIDEO_MODEL = import.meta.env.VITE_GEMINI_VIDEO_MODEL;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
// Feature flag for memory tools (can be disabled if issues arise)
const ENABLE_MEMORY_TOOLS = true;
const VITE_PROXY_BASE = "/api/google"; // Matches vite.config.ts proxy path
if (!GEMINI_MODEL || !GEMINI_VIDEO_MODEL || !GEMINI_API_KEY) {
  console.error("Missing env vars. Ensure VITE_GEMINI_MODEL is set.");
  // throw new Error("Missing environment variables for Gemini chat service.");
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Guardrail: Check if text_response is valid for TTS.
 * Rejects empty strings, "{}", "null", or single-character responses.
 * This prevents 400 errors from ElevenLabs when AI returns malformed output after tool use.
 */
function isValidTextForTTS(text: string | undefined | null): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  // Reject empty, JSON artifacts, or too-short responses
  if (trimmed.length < 2) return false;
  if (trimmed === "{}" || trimmed === "null" || trimmed === "[]") return false;
  // Check for mostly punctuation/whitespace (invalid speech)
  const alphanumericChars = trimmed.replace(/[^a-zA-Z0-9]/g, "").length;
  if (alphanumericChars < 2) return false;
  return true;
}

/**
 * Pre-fetch context data in parallel with intent detection.
 * This is an optimization to avoid waiting for intent before starting context fetch.
 */
async function prefetchContext(): Promise<{
  soulContext: Awaited<ReturnType<typeof getSoulLayerContextAsync>>;
  characterFacts: string;
}> {
  const [soulContext, characterFacts] = await Promise.all([
    getSoulLayerContextAsync(),
    formatCharacterFactsForPrompt(),
  ]);

  return { soulContext, characterFacts };
}

/**
 * Log when the LLM uses an almost moment expression.
 * Now uses explicit schema field instead of pattern matching for accurate tracking.
 */
async function logAlmostMomentIfUsed(
  aiResponse: AIActionResponse
): Promise<void> {
  // Check if LLM explicitly reported using an almost moment
  if (!aiResponse.almost_moment_used) return;

  const { feeling_id, stage, expression_used } = aiResponse.almost_moment_used;

  await recordAlmostMoment(
    feeling_id,
    stage,
    expression_used,
    "llm_confirmed_usage"
  );

  console.log(
    `[AlmostMoments] Logged: ${stage} - "${expression_used.substring(
      0,
      50
    )}..."`
  );
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
          `✨ [GeminiService] Using real presence context: ${parts.join(", ")}`
        );
        return parts.join(", ");
      }
    }

    // Fallback: Time-appropriate default (no fake random vibes)
    const hour = new Date().getUTCHours();
    if (hour >= 5 && hour < 12) {
      return "Starting my day, feeling pretty awake";
    } else if (hour >= 12 && hour < 17) {
      return "In the middle of my day";
    } else if (hour >= 17 && hour < 21) {
      return "Winding down for the evening";
    } else {
      return "Up late, feeling a bit tired";
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

export class GeminiService implements IAIChatService {
  model = GEMINI_MODEL;

  // ============================================
  // INTERNAL CONTEXT FETCHING
  // ============================================

  /**
   * Fetch user context internally - the service is self-sufficient.
   */
  private async fetchUserContext(googleAccessToken?: string): Promise<{
    relationship: RelationshipMetrics | null;
    upcomingEvents: CalendarEvent[];
    tasks: Task[];
    characterContext: string;
  }> {
    // Parallel fetch for performance (including real presence context)
    const [relationshipData, tasksData, characterContext] = await Promise.all([
      relationshipService.getRelationship().catch((err) => {
        console.warn("[GeminiService] Failed to fetch relationship:", err);
        return null;
      }),
      taskService.fetchTasks().catch((err) => {
        console.warn("[GeminiService] Failed to fetch tasks:", err);
        return [] as Task[];
      }),
      buildRealCharacterContext(),
    ]);

    // Calendar events only if we have a token
    let upcomingEvents: CalendarEvent[] = [];
    if (googleAccessToken) {
      try {
        upcomingEvents = await calendarService.getUpcomingEvents(
          googleAccessToken
        );
      } catch (e) {
        console.warn("[GeminiService] Calendar fetch failed:", e);
      }
    }

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
      console.log(`🧪 [GeminiService] Triggering post-response pre-fetch`);
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
      `⚠️ [Gemini Interactions${context}] CORS error detected (expected).`
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
      const proxyUrl = `${VITE_PROXY_BASE}/v1beta/interactions?key=${GEMINI_API_KEY}`;
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Proxy error: ${response.statusText} - ${errorText}`);
      }

      return await response.json();
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
    maxIterations: number = 3
  ): Promise<any> {
    let iterations = 0;

    while (interaction.outputs && iterations < maxIterations) {
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

          const toolResult = await executeMemoryTool(toolName, toolArgs, {
            googleAccessToken: options?.googleAccessToken,
            userMessage: typeof options === 'object' && 'chatHistory' in options ? options.chatHistory?.[options.chatHistory.length - 1]?.text : undefined
          });

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
      // IMPORTANT: Include history context to prevent "who said what" confusion
      const toolInteractionConfig = {
        model: this.model,
        previous_interaction_id: interaction.id,
        input: [...toolResults],
        system_instruction: systemPrompt,
        tools: interactionConfig.tools,
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
    // Check if outputs array exists and has content
    if (!interaction.outputs || interaction.outputs.length === 0) {
      console.error(
        "❌ [Gemini Interactions] No outputs in response!",
        "total_output_tokens:",
        interaction.usage?.total_output_tokens || 0,
        "status:",
        interaction.status
      );

      // Return a fallback response instead of empty object
      return {
        text_response: "Sorry, I'm having trouble responding right now. Can you try again?",
        action_id: null,
      };
    }

    const textOutput = interaction.outputs?.find(
      (output: any) => output.type === "text"
    );

    const responseText = textOutput?.text || "{}";

    try {
      const cleanedText = responseText.replace(/```json\n?|\n?```/g, "").trim();
      const jsonText = extractJsonFromResponse(cleanedText);
      const parsed = JSON.parse(jsonText);
      return normalizeAiResponse(parsed, jsonText);
    } catch (e) {
      // When tools are enabled, plain text is expected
      if (ENABLE_MEMORY_TOOLS) {
        return {
          text_response: responseText,
          action_id: null,
        };
      } else {
        console.warn(
          "Failed to parse Gemini JSON (tools disabled but got plain text):",
          responseText
        );
        return {
          text_response: responseText,
          action_id: null,
        };
      }
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
    options?: AIChatOptions
  ): Promise<{ response: AIActionResponse; session: AIChatSession }> {
    return await this.callProviderWithInteractions(
      systemPrompt,
      userMessage,
      session,
      options
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
    options?: AIChatOptions
  ): Promise<{ response: AIActionResponse; session: AIChatSession }> {
    const ai = getAiClient();

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
    interactionConfig.tools = this.buildMemoryTools();
    console.log("🧠 [Gemini Interactions] Memory tools enabled");

    // Create interaction
    let interaction = await this.createInteraction(interactionConfig);

    // Handle tool calling loop (pass history for context)
    const finalInteraction = await this.continueInteractionWithTools(
      interaction,
      interactionConfig,
      systemPrompt,
      options,
      3 // MAX_TOOL_ITERATIONS
    );

    // Parse response
    const structuredResponse = this.parseInteractionResponse(finalInteraction);

    // Update session with interaction ID (critical for stateful conversations!)
    console.log("🔗 [Gemini Interactions] RESPONSE DEBUG:");
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
    session?: AIChatSession
  ): Promise<{
    response: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
    intent?: FullMessageIntent;
  }> {
    try {
      // Extract user message text for analysis
      const userMessageText = "text" in input ? input.text : "";
      // console.log("userMessageText: ", userMessageText);

      // Use original message for intent detection (without calendar/email enrichment)
      // This keeps intent detection payload small (~3000 chars vs ~5000 chars)
      const messageForIntent = options.originalMessageForIntent || userMessageText;

      // Build conversation context early (for intent detection)
      const interactionCount = options.chatHistory?.length || 0;
      // console.log("interactionCount: ", interactionCount);

      const conversationContext = userMessageText
        ? {
            recentMessages: (options.chatHistory || [])
              .slice(-5)
              .map((msg: any) => ({
                role:
                  msg.role === "user"
                    ? ("user" as const)
                    : ("assistant" as const),
                text:
                  typeof msg.content === "string"
                    ? msg.content
                    : msg.content?.text ||
                      msg.text ||
                      JSON.stringify(msg.content),
              })),
          }
        : undefined;

      console.log("conversationContext: ", conversationContext);

      // ============================================
      // COMMAND BYPASS: Fast Path for Utility Commands
      // ============================================
      const trimmedMessage = userMessageText?.trim() || "";
      const isCommand = trimmedMessage && isFunctionalCommand(trimmedMessage);
      //  console.log("isCommand: ", isCommand);

      let intentPromise: Promise<FullMessageIntent> | undefined;
      let preCalculatedIntent: FullMessageIntent | undefined;

      // ============================================
      // OPTIMIZATION: Parallel Intent + Context Fetch
      // ============================================

      // 🚀 CHECK GLOBAL PREFETCH CACHE FIRST (Idle optimization)
      const cachedContext = getPrefetchedContext();
      let prefetchedContext:
        | {
            soulContext: Awaited<ReturnType<typeof getSoulLayerContextAsync>>;
            characterFacts: string;
          }
        | undefined = cachedContext
        ? {
            soulContext: cachedContext.soulContext,
            characterFacts: cachedContext.characterFacts,
          }
        : undefined;

      // Start context prefetch if not cached
      let contextPrefetchPromise:
        | Promise<{
            soulContext: Awaited<ReturnType<typeof getSoulLayerContextAsync>>;
            characterFacts: string;
          }>
        | undefined;

      if (!prefetchedContext) {
        contextPrefetchPromise = prefetchContext();
        console.log("🚀 [GeminiService] Started context prefetch in parallel");
      } else {
        console.log(
          "✅ [GeminiService] Using context from idle pre-fetch cache"
        );
      }

      // Start intent detection using CLEAN message (without calendar data)
      const trimmedMessageForIntent = messageForIntent.trim();
      if (trimmedMessageForIntent && trimmedMessageForIntent.length > 5) {
        intentPromise = detectFullIntentLLMCached(
          trimmedMessageForIntent,
          conversationContext
        );
        console.log("intentPromise initialized");

        if (isCommand) {
          // 🚀 FAST PATH: Don't wait for intent - Main LLM handles commands directly
          console.log(
            "⚡ [GeminiService] Command detected - skipping blocking intent analysis"
          );
        } else {
          // 🐢 NORMAL PATH: Wait for intent (needed for empathy/conversation)
          try {
            preCalculatedIntent = await intentPromise;
            console.log("preCalculatedIntent: ", preCalculatedIntent);

            if (preCalculatedIntent?.genuineMoment?.isGenuine) {
              // CRITICAL: Instant mood shift!
              const genuineMomentResult = {
                isGenuine: true,
                category: preCalculatedIntent.genuineMoment.category,
                matchedKeywords: ["LLM Instant Detection"],
                isPositiveAffirmation: true,
              };

              await recordInteractionAsync(
                preCalculatedIntent.tone,
                userMessageText,
                genuineMomentResult as any
              );
              console.log(
                "⚡ [GeminiService] Instant genuine moment reaction triggered!"
              );
            }
          } catch (e) {
            console.warn(
              "[GeminiService] Pre-calculation of intent failed:",
              e
            );
          }
        }
      }

      // Wait for prefetched context
      if (contextPrefetchPromise) {
        try {
          prefetchedContext = await contextPrefetchPromise;
          console.log("✅ [GeminiService] Context prefetch completed");
        } catch (e) {
          console.warn("[GeminiService] Context prefetch failed:", e);
        }
      }

      // ============================================
      // INTERNAL CONTEXT FETCHING
      // ============================================
      const fetchedContext = await this.fetchUserContext(
        options.googleAccessToken
      );

      // ============================================
      // BUILD SYSTEM PROMPT
      // ============================================
      const systemPrompt = await buildSystemPrompt(
        undefined, // character - not needed, service handles internally
        fetchedContext.relationship,
        fetchedContext.upcomingEvents,
        fetchedContext.characterContext,
        fetchedContext.tasks,
        preCalculatedIntent?.relationshipSignals,
        preCalculatedIntent?.tone,
        preCalculatedIntent,
        undefined, // userTimeZone
        prefetchedContext
      );

      // ============================================
      // CALL GEMINI API
      // ============================================
      const { response: aiResponse, session: updatedSession } =
        await this.callGeminiAPI(systemPrompt, input, session, options);

      // ============================================
      // POST-PROCESSING
      // ============================================

      // Log almost moment usage
      logAlmostMomentIfUsed(aiResponse).catch((err) => {
        console.warn("[GeminiService] Failed to log almost moment:", err);
      });

      // Store new character facts if AI generated any
      if (aiResponse.store_self_info) {
        const { category, key, value } = aiResponse.store_self_info;
        console.log(
          `💾 [GeminiService] AI generated new character fact: ${category}.${key} = "${value}"`
        );

        storeCharacterFact(category as any, key, value)
          .then((stored) => {
            if (stored) {
              console.log(
                `✅ [GeminiService] Character fact saved successfully: ${key}`
              );
            } else {
              console.log(
                `📋 [GeminiService] Character fact already exists or in profile: ${key}`
              );
            }
          })
          .catch((err) => {
            console.warn(
              `⚠️ [GeminiService] Failed to store character fact:`,
              err
            );
          });
      }

      // Background message analysis
      if (userMessageText) {
        if (preCalculatedIntent) {
          analyzeUserMessageBackground(
            userMessageText,
            interactionCount,
            conversationContext,
            preCalculatedIntent
          );
        } else if (intentPromise) {
          // COMMAND BYPASS PATH: Intent is still resolving
          intentPromise
            .then((resolvedIntent) => {
              if (resolvedIntent) {
                analyzeUserMessageBackground(
                  userMessageText,
                  interactionCount,
                  conversationContext,
                  resolvedIntent
                );
                console.log(
                  "📝 [GeminiService] Background intent analysis completed for command"
                );
              }
            })
            .catch((err) => {
              console.warn(
                "[GeminiService] Background intent resolution failed:",
                err
              );
              analyzeUserMessageBackground(
                userMessageText,
                interactionCount,
                conversationContext,
                undefined
              );
            });
        }
      }

      // Detect and mark shared idle thoughts
      if (aiResponse.text_response) {
        detectAndMarkSharedThoughts(aiResponse.text_response)
          .then((markedIds) => {
            if (markedIds.length > 0) {
              console.log(
                `💭 [GeminiService] Marked ${markedIds.length} idle thought(s) as shared`
              );
            }
          })
          .catch((err) => {
            console.warn(
              "[GeminiService] Failed to detect/mark shared thoughts:",
              err
            );
          });

        // Detect and mark surfaced Kayley experiences
        detectAndMarkSurfacedExperiences(aiResponse.text_response)
          .then((markedIds) => {
            if (markedIds.length > 0) {
              console.log(
                `🎭 [GeminiService] Marked ${markedIds.length} experience(s) as surfaced`
              );
            }
          })
          .catch((err) => {
            console.warn(
              "[GeminiService] Failed to detect surfaced experiences:",
              err
            );
          });
      }

      // ============================================
      // TTS GENERATION
      // ============================================
      const audioMode = options.audioMode ?? "async";
      console.log("audioMode: ", audioMode);

      if (audioMode === "none") {
        this.triggerPostResponsePrefetch();
        return {
          response: aiResponse,
          session: updatedSession,
          intent: preCalculatedIntent,
        };
      }

      if (audioMode === "async") {
        // Fire-and-forget TTS
        if (isValidTextForTTS(aiResponse.text_response)) {
          generateSpeech(aiResponse.text_response)
            .then((audioData) => {
              if (audioData) options.onAudioData?.(audioData);
            })
            .catch((err) => {
              console.warn("🔊 [GeminiService] async TTS failed", err);
            });
        } else {
          console.warn(
            "⚠️ [GeminiService] Skipped async TTS: text_response was empty or invalid:",
            aiResponse.text_response
          );
        }

        this.triggerPostResponsePrefetch();

        return {
          response: aiResponse,
          session: updatedSession,
          intent: preCalculatedIntent,
        };
      }

      // SYNC mode: Wait for TTS
      let audioData: string | undefined;
      if (isValidTextForTTS(aiResponse.text_response)) {
        audioData = await generateSpeech(aiResponse.text_response);
        console.log("audioData: ", audioData);
      } else {
        console.warn(
          "⚠️ [GeminiService] Skipped TTS: text_response was empty or invalid:",
          aiResponse.text_response
        );
        audioData = undefined;
      }

      // Post-response prefetch
      this.triggerPostResponsePrefetch();

      return {
        response: aiResponse,
        session: updatedSession,
        audioData,
        intent: preCalculatedIntent,
      };
    } catch (error) {
      console.error("Gemini Service Error:", error);
      throw error;
    }
  }

  // ============================================
  // IDLE BREAKER
  // ============================================

  /**
   * Triggered when the user has been idle (e.g., 5-10 mins).
   * Decides whether to ask about a user topic (Open Loop)
   * or share a thought (Proactive Thread).
   *
   */
  async triggerIdleBreaker(
    options: {
      chatHistory?: any[];
      googleAccessToken?: string;
      proactiveSettings?: {
        checkins?: boolean;
        news?: boolean;
        calendar?: boolean;
      };
    },
    session?: AIChatSession
  ): Promise<{
    response: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  } | null> {
    console.log(`💤 [GeminiService] Triggering idle breaker`);

    // STEP A: Fetch Candidates in Parallel
    let openLoop: any = null;
    let threads: any[] = [];
    let activeThread: any = null;

    try {
      [openLoop, threads] = await Promise.all([
        getTopLoopToSurface(),
        getOngoingThreadsAsync(),
      ]);
      activeThread = selectProactiveThread(threads);
    } catch (error) {
      console.warn(
        "[GeminiService] Failed to fetch proactive candidates:",
        error
      );
    }

    let systemInstruction = "";
    let logReason = "";
    let threadIdToMark: string | null = null;
    let loopIdToMark: string | null = null;
    let inputTopic = ""; // What Kayley is thinking about - passed as input to LLM

    // ============================================
    // CONSERVATIVE PROACTIVE LOGIC
    // Only trigger for TRULY URGENT things to avoid spam.
    // Non-urgent thoughts/threads surface naturally during conversation.
    // ============================================

    // URGENT: High salience open loop (something important about the USER)
    if (openLoop && openLoop.salience >= 0.8) {
      logReason = `High priority loop: ${openLoop.topic} (salience: ${openLoop.salience})`;
      inputTopic = `[PROACTIVE: Ask about "${openLoop.topic}"]`;
      systemInstruction = `
[SYSTEM EVENT: USER_IDLE - HIGH PRIORITY OPEN LOOP]
The user has been silent for over 5 minutes.
You have something important to ask about: "${openLoop.topic}"
${
  openLoop.triggerContext
    ? `Context: They said: "${openLoop.triggerContext.slice(0, 100)}..."`
    : "From a previous conversation"
}
Suggested ask: "${
        openLoop.suggestedFollowup ||
        `How did things go with ${openLoop.topic}?`
      }"

Bring this up naturally. This is about THEM, not you.
Tone: Caring, curious, not demanding.
`.trim();
      loopIdToMark = openLoop.id;

    // NOT URGENT: Skip proactive threads and lower-priority loops
    // These will surface naturally during conversation via the system prompt
    } else if (activeThread && activeThread.intensity >= 0.9) {
      // Only share thoughts proactively if VERY high intensity (0.9+)
      // This is rare - most thoughts wait for conversation
      logReason = `Urgent thought: ${activeThread.currentState.slice(0, 50)}... (intensity: ${activeThread.intensity})`;
      inputTopic = `[PROACTIVE: Share urgent thought - "${activeThread.currentState.slice(0, 80)}"]`;
      systemInstruction = buildProactiveThreadPrompt(activeThread);
      threadIdToMark = activeThread.id;

    // CHECK-INS DISABLED OR NOTHING URGENT
    } else {
      // No urgent open loops or threads - check if we should do a gentle check-in
      // This is MUCH more conservative than before

      // Check if check-ins are disabled entirely
      if (!options.proactiveSettings?.checkins) {
        console.log(
          "💤 [GeminiService] No urgent topics and check-ins disabled, skipping idle breaker"
        );
        return null;
      }

      // Only do generic check-in if user has HIGH PRIORITY tasks pending
      // Otherwise, stay silent and let thoughts surface naturally in conversation
      const fetchedContext = await this.fetchUserContext(
        options.googleAccessToken
      );
      const tasksData = fetchedContext.tasks;
      const highPriorityTasks = (tasksData || []).filter(
        (t) => !t.completed && t.priority === "high"
      );

      if (highPriorityTasks.length > 0) {
        // User has urgent tasks - gently remind them
        logReason = `Task reminder: ${highPriorityTasks[0].text}`;
        inputTopic = `[PROACTIVE: Gentle reminder about "${highPriorityTasks[0].text}"]`;
        systemInstruction = `
[SYSTEM EVENT: USER_IDLE - TASK REMINDER]
The user has been idle and has a high-priority task: "${highPriorityTasks[0].text}"
Gently check in about it. Don't be pushy.
Example: "Hey, just checking - did you get a chance to work on that ${highPriorityTasks[0].text.toLowerCase()} thing?"
Keep it very short (1 sentence).
`.trim();
      } else {
        // Nothing urgent - stay silent
        // Non-urgent thoughts/threads will surface naturally when user talks to us
        console.log(
          "💤 [GeminiService] No urgent topics to share, staying quiet (thoughts will surface in conversation)"
        );
        return null;
      }
    }

    console.log(`🤖 [GeminiService] Selected strategy: ${logReason}`);

    // STEP C: Mark the winner as surfaced/mentioned
    if (threadIdToMark) {
      markThreadMentionedAsync(threadIdToMark).catch((err) =>
        console.warn("[GeminiService] Failed to mark thread as mentioned:", err)
      );
    }
    if (loopIdToMark) {
      markLoopSurfaced(loopIdToMark).catch((err) =>
        console.warn("[GeminiService] Failed to mark loop as surfaced:", err)
      );
    }

    // STEP D: Generate the system prompt
    const [soulResult, factsResult] = await Promise.all([
      getSoulLayerContextAsync(),
      formatCharacterFactsForPrompt(),
    ]);

    // Fetch context for prompt building
    const fetchedContext = await this.fetchUserContext(
      options.googleAccessToken
    );

    const fullSystemPrompt = await buildSystemPrompt(
      undefined, // character - not needed
      fetchedContext.relationship,
      fetchedContext.upcomingEvents,
      fetchedContext.characterContext,
      fetchedContext.tasks,
      undefined, // relationshipSignals
      undefined, // toneIntent
      undefined, // fullIntent
      undefined, // userTimeZone
      { soulContext: soulResult, characterFacts: factsResult }
    );

    // Combine the idle breaker instruction with the full system prompt
    const combinedSystemPrompt = `${fullSystemPrompt}\n\n${systemInstruction}`;

    // STEP E: Call the LLM with the proactive topic as input
    console.log(`💭 [GeminiService] Proactive input: ${inputTopic}`);
    const { response, session: updatedSession } = await this.callGeminiAPI(
      combinedSystemPrompt,
      { type: "text", text: inputTopic }, // What Kayley is thinking about
      session
    );

    // Generate audio for the response
    const audioData = isValidTextForTTS(response.text_response)
      ? await generateSpeech(response.text_response)
      : undefined;

    if (!isValidTextForTTS(response.text_response)) {
      console.warn(
        "⚠️ [GeminiService] Skipped idle breaker TTS: text_response was empty or invalid:",
        response.text_response
      );
    }

    return {
      response,
      session: updatedSession,
      audioData: audioData || undefined,
    };
  }

  // ============================================
  // GREETING METHODS
  // ============================================

  /**
   * Generate greeting using Interactions API.
   * Fetches all context internally.
   * If first login of the day, includes daily logistics (calendar, tasks, emails).
   */
  async generateGreeting(
    session?: AIChatSession,
    options?: {
      characterId?: string;
      emailCount?: number;
      isGmailConnected?: boolean;
      isCalendarConnected?: boolean;
    }
  ): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }> {
    // Fetch context internally
    const fetchedContext = await this.fetchUserContext();

    // Check if this is the first login of the day
    const characterId = options?.characterId || "default";
    const isFirstLoginToday = !hasBeenBriefedToday(characterId);

    if (isFirstLoginToday) {
      console.log(
        "🌅 [GeminiService] First login of the day - including daily logistics in greeting"
      );
    }

    const systemPrompt = await buildSystemPrompt(
      undefined, // character
      fetchedContext.relationship,
      fetchedContext.upcomingEvents,
      fetchedContext.characterContext,
      fetchedContext.tasks,
      undefined,
      undefined,
      undefined,
      undefined
    );

    try {
      // First, try to get user's name from stored facts
      let userName: string | null = null;
      let hasUserFacts = false;

      try {
        const userFacts = await executeMemoryTool("recall_user_info", {
          category: "identity",
        });
        hasUserFacts =
          userFacts && !userFacts.includes("No stored information");

        // Extract name if present
        const nameMatch = userFacts.match(/name:\s*(\w+)/i);
        if (nameMatch) {
          userName = nameMatch[1];
          console.log(`🤖 [GeminiService] Found user name: ${userName}`);
        }
      } catch (e) {
        console.log(
          "🤖 [GeminiService] Could not fetch user facts for greeting"
        );
      }

      // Fetch any open loops to ask about proactively
      let topOpenLoop = null;
      try {
        topOpenLoop = await getTopLoopToSurface();
        if (topOpenLoop) {
          console.log(
            `🔄 [GeminiService] Found open loop to surface: "${topOpenLoop.topic}"`
          );
        }
      } catch (e) {
        console.log("[GeminiService] Could not fetch open loop for greeting");
      }

      // Fetch any pending message from idle time
      let pendingMessage = null;
      try {
        pendingMessage = await getUndeliveredMessage();
        if (pendingMessage) {
          console.log(
            `💌 [GeminiService] Found pending ${pendingMessage.trigger} message to deliver`
          );
        }
      } catch (e) {
        console.log(
          "[GeminiService] Could not fetch pending message for greeting"
        );
      }

      // Build daily logistics context if first login of the day
      let dailyLogistics: DailyLogisticsContext | null = null;
      if (isFirstLoginToday) {
        dailyLogistics = {
          upcomingEvents: fetchedContext.upcomingEvents,
          tasks: fetchedContext.tasks,
          emailCount: options?.emailCount ?? 0,
          isCalendarConnected: options?.isCalendarConnected ?? false,
          isGmailConnected: options?.isGmailConnected ?? false,
        };
      }

      const greetingPrompt = buildGreetingPrompt(
        fetchedContext.relationship,
        hasUserFacts,
        userName,
        topOpenLoop,
        null, // proactiveThread
        pendingMessage,
        null, // kayleyActivity
        null, // expectedReturnTime
        dailyLogistics // NEW: daily logistics for first login
      );
      console.log(
        `🤖 [GeminiService] Greeting tier: ${
          fetchedContext.relationship?.relationshipTier || "new"
        }, interactions: ${
          fetchedContext.relationship?.totalInteractions || 0
        }${isFirstLoginToday ? " (first login today)" : ""}`
      );

      // Build interaction config
      const interactionConfig: any = {
        model: this.model,
        input: [{ type: "text", text: greetingPrompt }],
        system_instruction: systemPrompt,
      };

      if (session?.interactionId) {
        console.log(
          `🔗 [GeminiService] Restoring continuity for Greeting: ${session.interactionId}`
        );
        interactionConfig.previous_interaction_id = session.interactionId;
      }

      // Add memory tools
      interactionConfig.tools = this.buildMemoryTools();

      // Create interaction
      let interaction = await this.createInteraction(interactionConfig);

      // Handle tool calls for greeting
      interaction = await this.continueInteractionWithTools(
        interaction,
        interactionConfig,
        systemPrompt,
        undefined,
        2
      );

      // Parse response
      const structuredResponse = this.parseInteractionResponse(interaction);

      // Generate audio for greeting
      const audioData = await generateSpeech(structuredResponse.text_response);

      // Mark the open loop as surfaced
      if (topOpenLoop) {
        await markLoopSurfaced(topOpenLoop.id);
        console.log(
          `✅ [GeminiService] Marked loop as surfaced: "${topOpenLoop.topic}"`
        );
      }

      // Mark the pending message as delivered
      if (pendingMessage) {
        await markMessageDelivered(pendingMessage.id);
        console.log(
          `✅ [GeminiService] Marked pending ${pendingMessage.trigger} message as delivered`
        );
      }

      // Mark as briefed today if this was the first login
      if (isFirstLoginToday) {
        markBriefedToday(characterId);
        console.log(
          `📅 [GeminiService] Marked daily briefing complete for ${characterId}`
        );
      }

      // Detect and mark surfaced Kayley experiences (fire-and-forget)
      detectAndMarkSurfacedExperiences(structuredResponse.text_response).catch(
        (err) =>
          console.warn(
            "[GeminiService] Failed to detect surfaced experiences in greeting:",
            err
          )
      );

      return {
        greeting: structuredResponse,
        session: {
          model: this.model,
          interactionId: interaction.id,
        },
        audioData,
      };
    } catch (error) {
      console.error("Gemini Greeting Error:", error);
      throw error;
    }
  }

  /**
   * Generate a natural "welcome back" response for returning users.
   * Fetches all context internally.
   */
  async generateNonGreeting(session?: AIChatSession): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }> {
    // Fetch context internally
    const fetchedContext = await this.fetchUserContext();

    const systemPrompt = await buildSystemPrompt(
      undefined, // character
      fetchedContext.relationship,
      fetchedContext.upcomingEvents,
      fetchedContext.characterContext,
      fetchedContext.tasks,
      undefined,
      undefined,
      undefined,
      undefined
    );

    try {
      // Get user's name if known
      let userName: string | null = null;
      try {
        const userFacts = await executeMemoryTool("recall_user_info", {
          category: "identity",
        });
        const nameMatch = userFacts.match(/name:\s*(\w+)/i);
        if (nameMatch) {
          userName = nameMatch[1];
        }
      } catch (e) {
        // Ignore errors fetching name
      }

      // Fetch any pending message from idle time
      let pendingMessage = null;
      try {
        pendingMessage = await getUndeliveredMessage();
        if (pendingMessage) {
          console.log(
            `[GeminiService] Found pending ${pendingMessage.trigger} message to deliver`
          );
        }
      } catch (e) {
        console.log(
          "[GeminiService] Could not fetch pending message for non-greeting"
        );
      }

      const nonGreetingPrompt = buildNonGreetingPrompt(
        fetchedContext.relationship,
        userName,
        fetchedContext.characterContext,
        pendingMessage
      );

      // Build interaction config
      const interactionConfig: any = {
        model: this.model,
        input: [{ type: "text", text: nonGreetingPrompt }],
        system_instruction: systemPrompt,
      };

      if (session?.interactionId) {
        console.log(
          `🔗 [GeminiService] Restoring continuity for Non-Greeting: ${session.interactionId}`
        );
        interactionConfig.previous_interaction_id = session.interactionId;
      }

      // Add memory tools
      interactionConfig.tools = this.buildMemoryTools();

      // Create interaction
      let interaction = await this.createInteraction(interactionConfig);

      // Handle tool calls
      interaction = await this.continueInteractionWithTools(
        interaction,
        interactionConfig,
        systemPrompt,
        undefined,
        2
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
            err
          )
      );

      // Mark the pending message as delivered
      if (pendingMessage) {
        await markMessageDelivered(pendingMessage.id);
        console.log(
          `✅ [GeminiService] Marked pending ${pendingMessage.trigger} message as delivered`
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
      `Video generation failed: ${currentOperation.error.message}`
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
  image: UploadedImage
): Promise<Blob> => {
  console.log("Generating new initial video.");
  const prompt = `Animate the character from this image to create a short, seamlessly looping video. The character should be sitting at a desk, looking forward with a pleasant, neutral expression.`;
  const operation = await generateSingleVideo(image, prompt);
  return await pollVideoOperation(operation);
};

export const generateActionVideo = async (
  image: UploadedImage,
  command: string
): Promise<string> => {
  const prompt = `Animate the character from this image to perform the following action: "${command}".`;
  const operation = await generateSingleVideo(image, prompt);
  const blob = await pollVideoOperation(operation);
  return URL.createObjectURL(blob);
};
