// server/services/ai/serverGeminiService.ts
//
// Server-side IAIChatService implementation using @google/genai SDK Chat sessions.
// Replaces the Interactions API (raw HTTP fetch + manual tool loop) with:
//   - SDK Chat sessions (in-memory history, automatic session continuity)
//   - SDK automaticFunctionCalling (no custom tool loop)
//   - Server-only API key (never sent to browser)
//
// This service is used by agentRoutes.ts for all server-side AI calls.
// The browser GeminiService (src/services/geminiChatService.ts) is kept for
// backward compatibility but will be deprecated once all clients use /agent/*.

import type { Part } from "@google/genai";
import type { ChatMessage, Task } from "../../../src/types";
import type {
  IAIChatService,
  AIChatSession,
  UserContent,
  AIChatOptions,
} from "../../../src/services/aiService";
import type { AIActionResponse } from "../../../src/services/aiSchema";
import type { TurnTokenUsage } from "../../../src/services/conversationHistoryService";
import type { CalendarEvent } from "../../../src/services/calendarService";
import type { RelationshipMetrics } from "../../../src/services/relationshipService";

import { GEMINI_MODEL } from "./geminiClient";
import { getOrCreateSession, invalidateSession } from "./chatSessionManager";
import { createCallableTools } from "./toolBridge";

import {
  buildSystemPromptForNonGreeting,
  buildGreetingPrompt,
  buildNonGreetingPrompt,
  buildSystemPromptForGreeting,
  type DailyLogisticsContext,
} from "../../../src/services/promptUtils";
import { generateSpeech } from "../../../src/services/elevenLabsService";
import { getImportantDateFacts } from "../../../src/services/memoryService";
import { storeCharacterFact } from "../../../src/services/characterFactsService";
import * as relationshipService from "../../../src/services/relationshipService";
import * as taskService from "../../../src/services/taskService";
import { calendarService } from "../../../src/services/calendarService";
import { recordAlmostMoment } from "../../../src/services/almostMomentsService";
import { getKayleyPresenceState } from "../../../src/services/kayleyPresenceService";
import { getLastInteractionDate } from "../../../src/services/conversationHistoryService";
import { getActiveStorylines } from "../../../src/services/storylineService";

import { log } from "../../runtimeLogger";

const runtimeLog = log.fromContext({ source: "serverGeminiService" });

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract JSON from model response text that may include conversational preamble.
 * Handles "Here's the thing! { ... }" patterns.
 */
function extractJsonFromResponse(responseText: string): string {
  const trimmed = responseText.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) return trimmed;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = firstBrace; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escape) { escape = false; continue; }
    if (char === "\\" && inString) { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (!inString) {
      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) return trimmed.slice(firstBrace, i + 1);
      }
    }
  }

  // Fallback: last brace approach
  const lastBraceIndex = trimmed.lastIndexOf("{");
  if (lastBraceIndex !== -1) {
    const potentialJson = trimmed.slice(lastBraceIndex);
    if (potentialJson.trim().endsWith("}")) return potentialJson;
  }

  return trimmed;
}

/**
 * Normalize raw JSON into the AIActionResponse shape.
 * Mirror of the same function in geminiChatService.ts.
 */
function normalizeAiResponse(rawJson: any, rawText: string): AIActionResponse {
  let wbAction = rawJson.whiteboard_action || null;
  if (!wbAction && rawJson.draw_shapes) {
    wbAction = { type: "draw", draw_shapes: rawJson.draw_shapes };
  }

  return {
    text_response: rawJson.text_response || rawJson.response || rawText,
    user_transcription: rawJson.user_transcription || null,
    open_app: rawJson.open_app || null,
    calendar_action: rawJson.calendar_action || null,
    news_action: rawJson.news_action || null,
    whiteboard_action: wbAction,
    game_move: rawJson.game_move,
    selfie_action: rawJson.selfie_action || null,
    gif_action: rawJson.gif_action || null,
    video_action: rawJson.video_action || null,
    store_self_info: rawJson.store_self_info || null,
    almost_moment_used: rawJson.almost_moment_used || null,
    fulfilling_promise_id: rawJson.fulfilling_promise_id || null,
    email_action: rawJson.email_action || null,
  };
}

/**
 * Convert UserContent into SDK Part[] for chat.sendMessage().
 */
function formatMessageParts(userMessage: UserContent): Part[] {
  if (userMessage.type === "text") {
    const text = userMessage.text || "[SYSTEM: Initiate conversation]";
    return [{ text }];
  }
  if (userMessage.type === "audio") {
    return [{
      inlineData: {
        data: userMessage.data,
        mimeType: userMessage.mimeType,
      },
    }];
  }
  if (userMessage.type === "image_text") {
    return [
      { text: userMessage.text },
      {
        inlineData: {
          data: userMessage.imageData,
          mimeType: userMessage.mimeType,
        },
      },
    ];
  }
  return [{ text: "[empty message]" }];
}

/**
 * Map SDK UsageMetadata to the TurnTokenUsage shape used by conversation history.
 */
function mapTokenUsage(usageMetadata: any): TurnTokenUsage {
  if (!usageMetadata) {
    return {
      total_input_tokens: null,
      total_output_tokens: null,
      total_tokens: null,
      total_thought_tokens: null,
      total_tool_use_tokens: null,
      total_cached_tokens: null,
      input_tokens_by_modality: null,
    };
  }

  return {
    total_input_tokens: usageMetadata.promptTokenCount ?? null,
    total_output_tokens: usageMetadata.candidatesTokenCount ?? null,
    total_tokens: usageMetadata.totalTokenCount ?? null,
    total_thought_tokens: usageMetadata.thoughtsTokenCount ?? null,
    total_tool_use_tokens: usageMetadata.toolUsePromptTokenCount ?? null,
    total_cached_tokens: usageMetadata.cachedContentTokenCount ?? null,
    input_tokens_by_modality: usageMetadata.promptTokensDetails ?? null,
  };
}

/**
 * Parse SDK response text into AIActionResponse.
 */
function parseResponseText(responseText: string | undefined): AIActionResponse {
  if (!responseText) {
    return { text_response: "I'm having trouble processing that right now." };
  }

  try {
    const cleaned = responseText.replace(/```json\n?|\n?```/g, "").trim();
    const jsonText = extractJsonFromResponse(cleaned);
    const parsed = JSON.parse(jsonText);
    return normalizeAiResponse(parsed, jsonText);
  } catch {
    // Not valid JSON — treat as plain text response
    return { text_response: responseText };
  }
}

/** Fire-and-forget: log almost moment usage */
async function logAlmostMomentIfUsed(aiResponse: AIActionResponse): Promise<void> {
  if (!aiResponse.almost_moment_used) return;
  const { feeling_id, stage, expression_used } = aiResponse.almost_moment_used;
  await recordAlmostMoment(feeling_id, stage, expression_used, "llm_confirmed_usage");
}

/** Fire-and-forget: handle promise fulfillment */
async function handlePromiseFulfillment(aiResponse: AIActionResponse): Promise<void> {
  if (!aiResponse.fulfilling_promise_id) return;
  const { markPromiseAsFulfilled } = await import("../../../src/services/promiseService");
  const fulfillmentData: any = {};
  if (aiResponse.text_response) fulfillmentData.messageText = aiResponse.text_response;
  if (aiResponse.selfie_action) {
    fulfillmentData.selfieParams = {
      scene: aiResponse.selfie_action.scene,
      mood: aiResponse.selfie_action.mood || "happy",
    };
  }
  await markPromiseAsFulfilled(aiResponse.fulfilling_promise_id, fulfillmentData);
}

// ============================================================================
// ServerGeminiService — SDK Chat implementation of IAIChatService
// ============================================================================

export class ServerGeminiService implements IAIChatService {
  model = GEMINI_MODEL;

  // ------------------------------------------------------------------
  // Internal context fetching (same as browser GeminiService)
  // ------------------------------------------------------------------

  private async fetchUserContext(googleAccessToken: string): Promise<{
    relationship: RelationshipMetrics | null;
    upcomingEvents: CalendarEvent[];
    tasks: Task[];
    characterContext: string;
  }> {
    const [relationshipData, tasksData, characterContext, lastInteractionAt] =
      await Promise.all([
        relationshipService.getRelationship(),
        taskService.fetchTasks(),
        this.buildCharacterContext(),
        getLastInteractionDate(),
      ]);

    relationshipData.lastInteractionAt = lastInteractionAt;

    let upcomingEvents: CalendarEvent[] = [];
    try {
      upcomingEvents = await calendarService.getUpcomingEvents(googleAccessToken);
    } catch (e) {
      runtimeLog.warning("Calendar fetch failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return { relationship: relationshipData, upcomingEvents, tasks: tasksData, characterContext };
  }

  private async buildCharacterContext(): Promise<string> {
    try {
      const presenceState = await getKayleyPresenceState();
      if (presenceState) {
        const parts: string[] = [];
        if (presenceState.currentActivity) parts.push(presenceState.currentActivity);
        if (presenceState.currentOutfit) parts.push(`wearing ${presenceState.currentOutfit}`);
        if (presenceState.currentMood) parts.push(`feeling ${presenceState.currentMood}`);
        if (presenceState.currentLocation) parts.push(`at ${presenceState.currentLocation}`);
        if (parts.length > 0) return parts.join(", ");
      }
    } catch (error) {
      runtimeLog.warning("Failed to fetch presence state", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return "Just hanging out";
  }

  // ------------------------------------------------------------------
  // Core API: generateResponse
  // ------------------------------------------------------------------

  async generateResponse(
    input: UserContent,
    options: AIChatOptions,
    session?: AIChatSession,
  ): Promise<{
    response: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
    conversationLogId: string;
    tokenUsage: TurnTokenUsage;
  }> {
    const conversationLogId = crypto.randomUUID();
    const startMs = Date.now();

    runtimeLog.info("generateResponse start", {
      conversationLogId,
      inputType: input.type,
      sessionId: session?.interactionId,
    });

    try {
      // Fetch context
      const ctx = await this.fetchUserContext(options.googleAccessToken || "");

      // Extract user message for active recall
      const currentUserMessage =
        input.type === "text" ? input.text
        : input.type === "image_text" ? input.text
        : undefined;

      // Build system prompt
      const systemPrompt = await buildSystemPromptForNonGreeting(
        ctx.relationship,
        ctx.upcomingEvents,
        ctx.characterContext,
        session?.interactionId,
        currentUserMessage,
        0,
      );

      // Create callable tools with context
      const tools = createCallableTools({
        googleAccessToken: options.googleAccessToken,
        userMessage: currentUserMessage,
      });

      // Get or create SDK Chat session
      const sessionId = session?.interactionId || `server-${conversationLogId}`;
      const chat = getOrCreateSession({
        sessionId,
        systemPrompt,
        tools: [tools],
      });

      // Send message — SDK handles tool loop automatically
      const messageParts = formatMessageParts(input);
      const response = await chat.sendMessage({ message: messageParts });

      // Parse response
      const aiResponse = parseResponseText(response.text);
      const tokenUsage = mapTokenUsage(response.usageMetadata);

      const elapsedMs = Date.now() - startMs;
      runtimeLog.info("generateResponse complete", {
        conversationLogId,
        elapsedMs,
        textLength: aiResponse.text_response?.length || 0,
        tokenUsage,
      });

      // Post-processing (fire-and-forget)
      logAlmostMomentIfUsed(aiResponse).catch((err) =>
        runtimeLog.warning("Failed to log almost moment", { error: String(err) })
      );
      handlePromiseFulfillment(aiResponse).catch((err) =>
        runtimeLog.warning("Failed to handle promise fulfillment", { error: String(err) })
      );

      if (aiResponse.store_self_info) {
        const { category, key, value } = aiResponse.store_self_info;
        storeCharacterFact(category as any, key, value).catch((err) =>
          runtimeLog.warning("Failed to store character fact", { error: String(err) })
        );
      }

      return {
        response: aiResponse,
        session: { model: this.model, interactionId: sessionId },
        conversationLogId,
        tokenUsage,
      };
    } catch (error) {
      runtimeLog.error("generateResponse failed", {
        conversationLogId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // Greeting
  // ------------------------------------------------------------------

  async generateGreeting(googleAccessToken: string): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }> {
    const conversationLogId = crypto.randomUUID();
    const startMs = Date.now();

    runtimeLog.info("generateGreeting start", { conversationLogId });

    const [ctx, importantDateFacts] = await Promise.all([
      this.fetchUserContext(googleAccessToken),
      getImportantDateFacts(),
    ]);

    const incompleteTasks = (ctx.tasks || []).filter(
      (t) => !t.completed && t.priority === "high",
    );

    const greetingContext: DailyLogisticsContext = {
      chatHistory: [],
      lastInteractionDateUtc: ctx.relationship?.lastInteractionAt,
      importantDateFacts: importantDateFacts.map((f) => ({
        key: f.fact_key,
        value: f.fact_value,
      })),
      tasks: incompleteTasks,
      upcomingEvents: ctx.upcomingEvents,
      pastCalendarEvents: [],
      kayleyLifeUpdates: [],
    };

    const systemPrompt = await buildSystemPromptForGreeting(greetingContext);
    const greetingPrompt = buildGreetingPrompt(ctx.relationship);

    const tools = createCallableTools({ googleAccessToken });
    const sessionId = `greeting-${conversationLogId}`;
    const chat = getOrCreateSession({
      sessionId,
      systemPrompt,
      tools: [tools],
    });

    const response = await chat.sendMessage({ message: greetingPrompt });
    const greeting = parseResponseText(response.text);

    const elapsedMs = Date.now() - startMs;
    runtimeLog.info("generateGreeting complete", {
      conversationLogId,
      elapsedMs,
      textLength: greeting.text_response?.length || 0,
    });

    return {
      greeting,
      session: { model: this.model, interactionId: sessionId },
    };
  }

  // ------------------------------------------------------------------
  // Non-Greeting (welcome back / idle breaker)
  // ------------------------------------------------------------------

  async generateNonGreeting(
    session: AIChatSession,
    googleAccessToken: string,
  ): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }> {
    const conversationLogId = crypto.randomUUID();
    const startMs = Date.now();

    runtimeLog.info("generateNonGreeting start", { conversationLogId });

    const ctx = await this.fetchUserContext(googleAccessToken);

    let systemPrompt = await buildSystemPromptForNonGreeting(
      ctx.relationship,
      ctx.upcomingEvents,
      ctx.characterContext,
      session.interactionId,
      undefined,
      0,
    );

    // Inject pending storyline suggestion (Phase 2 feature)
    try {
      const { getPendingSuggestion, markSuggestionSurfaced } =
        await import("../../../src/services/storylineIdleService");
      const pendingSuggestion = await getPendingSuggestion();

      if (pendingSuggestion) {
        runtimeLog.info("Injecting pending storyline suggestion", {
          theme: pendingSuggestion.theme,
        });
        systemPrompt += `\n\n====================================================
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
        await markSuggestionSurfaced(pendingSuggestion.id);
      }
    } catch (err) {
      runtimeLog.warning("Failed to fetch pending suggestion", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const nonGreetingPrompt = buildNonGreetingPrompt(
      ctx.relationship?.lastInteractionAt,
      ctx.characterContext,
    );

    const tools = createCallableTools({ googleAccessToken });
    const sessionId = session.interactionId || `nongreeting-${conversationLogId}`;
    const chat = getOrCreateSession({
      sessionId,
      systemPrompt,
      tools: [tools],
    });

    const response = await chat.sendMessage({ message: nonGreetingPrompt });
    const structuredResponse = parseResponseText(response.text);

    // Generate audio for non-greeting
    const audioData = await generateSpeech(structuredResponse.text_response);

    // Post-processing (fire-and-forget)
    handlePromiseFulfillment(structuredResponse).catch((err) =>
      runtimeLog.warning("Non-greeting promise fulfillment failed", { error: String(err) })
    );
    logAlmostMomentIfUsed(structuredResponse).catch((err) =>
      runtimeLog.warning("Non-greeting almost moment logging failed", { error: String(err) })
    );

    const elapsedMs = Date.now() - startMs;
    runtimeLog.info("generateNonGreeting complete", {
      conversationLogId,
      elapsedMs,
      textLength: structuredResponse.text_response?.length || 0,
    });

    return {
      greeting: structuredResponse,
      session: { model: this.model, interactionId: sessionId },
      audioData,
    };
  }
}

/** Singleton instance for server-side use. */
export const serverGeminiService = new ServerGeminiService();
