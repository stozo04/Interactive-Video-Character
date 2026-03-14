// server/services/ai/claudeAgentService.ts
//
// Claude Agent SDK implementation of IAIChatService.
// Replaces serverGeminiService.ts — uses the Claude Agent SDK's query() function
// with MCP tools for Kayley's domain capabilities and built-in tools for
// filesystem, bash, web search, etc.

import type {
  IAIChatService,
  AIChatSession,
  UserContent,
  AIChatOptions,
} from "../../../src/services/aiService";
import type { AIActionResponse } from "../../../src/services/aiSchema";
import type { TurnTokenUsage } from "../../../src/services/conversationHistoryService";
import type { RelationshipMetrics } from "../../../src/services/relationshipService";

import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  Options,
  HookInput,
  HookJSONOutput,
  HookCallbackMatcher,
} from "@anthropic-ai/claude-agent-sdk";

import { createKayleyMcpServer } from "./kayleyMcpServer";
import { getToolDisplayName, sanitizeToolArgs, truncateResultSummary } from "./sseTypes";

/** Minimal event bus interface matching AIChatOptions.eventBus */
interface EventBusLike {
  emit(event: string, data: unknown): boolean;
  nextCallIndex?: () => number;
}

import {
  buildSystemPromptForNonGreeting,
  buildGreetingPrompt,
  buildNonGreetingPrompt,
  buildSystemPromptForGreeting,
  type DailyLogisticsContext,
} from "../../../src/services/promptUtils";
import { generateSpeech } from "../../../src/services/elevenLabsService";
import { getImportantDateFacts } from "../../../src/services/memoryService";
import * as relationshipService from "../../../src/services/relationshipService";
import { recordAlmostMoment } from "../../../src/services/almostMomentsService";
import { getLastInteractionDate } from "../../../src/services/conversationHistoryService";

import { log } from "../../runtimeLogger";
import { buildXTweetPromptSection } from "../xPromptContextService";
import { buildMediaNudgePromptSection } from "../mediaNudgePromptService";
import { buildMentionsPromptSection } from "../xMentionService";

const runtimeLog = log.fromContext({ source: "claudeAgentService" });

// Claude model to use — configurable via env
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse the SDK result text into an AIActionResponse.
 * Claude returns the final response as text — we expect JSON matching AIActionResponseSchema.
 */
function parseResultToResponse(resultText: string | undefined): AIActionResponse {
  if (!resultText) {
    return { text_response: "I'm having trouble processing that right now." };
  }

  try {
    // Strip markdown code fences if present
    const cleaned = resultText.replace(/```json\n?|\n?```/g, "").trim();

    // Find the JSON object
    const firstBrace = cleaned.indexOf("{");
    if (firstBrace === -1) {
      return { text_response: cleaned };
    }

    // Balance braces to extract JSON
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (escape) { escape = false; continue; }
      if (char === "\\" && inString) { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (!inString) {
        if (char === "{") depth++;
        if (char === "}") {
          depth--;
          if (depth === 0) {
            const jsonText = cleaned.slice(firstBrace, i + 1);
            const parsed = JSON.parse(jsonText);
            return normalizeAiResponse(parsed, jsonText);
          }
        }
      }
    }

    // Fallback: try parsing the whole thing
    const parsed = JSON.parse(cleaned);
    return normalizeAiResponse(parsed, cleaned);
  } catch {
    // Not valid JSON — treat as plain text response
    return { text_response: resultText };
  }
}

/**
 * Normalize raw JSON into the AIActionResponse shape.
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
    whiteboard_action: wbAction,
    game_move: rawJson.game_move,
    selfie_action: rawJson.selfie_action || null,
    gif_action: rawJson.gif_action || null,
    video_action: rawJson.video_action || null,
    almost_moment_used: rawJson.almost_moment_used || null,
    fulfilling_promise_id: rawJson.fulfilling_promise_id || null,
    send_as_voice: rawJson.send_as_voice || false,
  };
}

/**
 * Map SDK usage to TurnTokenUsage shape for conversation history.
 */
function mapTokenUsage(resultMsg: SDKResultMessage | null): TurnTokenUsage {
  if (!resultMsg || resultMsg.subtype !== "success") {
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

  const usage = resultMsg.usage;
  return {
    total_input_tokens: usage.input_tokens ?? null,
    total_output_tokens: usage.output_tokens ?? null,
    total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    total_thought_tokens: null,
    total_tool_use_tokens: null,
    total_cached_tokens: usage.cache_read_input_tokens ?? null,
    input_tokens_by_modality: null,
  };
}

/**
 * Convert UserContent to a text prompt for the SDK.
 * Audio is pre-processed to text transcription before this point.
 * Images are described textually (TODO: save to temp file for Read tool).
 */
function formatUserPrompt(input: UserContent): string {
  if (input.type === "text") {
    return input.text || "[SYSTEM: Initiate conversation]";
  }
  if (input.type === "audio") {
    // Audio should be pre-transcribed before reaching here.
    // If it somehow gets here raw, flag it.
    return "[Audio message received — transcription unavailable]";
  }
  if (input.type === "image_text") {
    return input.text + "\n\n[User also sent an image — use context from the text to respond]";
  }
  return "[empty message]";
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

// Display names for built-in tools (augments the MCP tool display names in sseTypes.ts)
const BUILT_IN_DISPLAY_NAMES: Record<string, string> = {
  Read: "Reading file",
  Write: "Writing file",
  Edit: "Editing file",
  Bash: "Running command",
  Glob: "Searching files",
  Grep: "Searching code",
  WebSearch: "Searching the web",
  WebFetch: "Fetching web page",
};

/**
 * Build programmatic hooks for SSE tool visibility.
 * PreToolUse emits tool_start, PostToolUse emits tool_end for both built-in
 * and MCP tools — giving the web client real-time tool call visibility.
 */
function buildSSEHooks(
  eventBus: EventBusLike | undefined,
  toolTimers: Map<string, { startTime: number; callIndex: number }>,
): Partial<Record<string, HookCallbackMatcher[]>> {
  if (!eventBus) return {};

  let callCounter = 0;
  const nextIndex = () => eventBus.nextCallIndex?.() ?? callCounter++;

  const preToolUseHook: HookCallbackMatcher = {
    hooks: [
      async (input: HookInput, _toolUseId: string | undefined): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== "PreToolUse") return {};

        const { tool_name, tool_input, tool_use_id } = input;
        const callIndex = nextIndex();

        // Track start time + callIndex keyed on tool_use_id
        toolTimers.set(tool_use_id, { startTime: Date.now(), callIndex });

        // Determine display name — check built-in first, then MCP
        const rawName = tool_name.replace(/^mcp__kayley__/, "");
        const displayName =
          BUILT_IN_DISPLAY_NAMES[tool_name] || getToolDisplayName(rawName);

        eventBus.emit("tool_start", {
          type: "tool_start" as const,
          toolName: rawName,
          toolDisplayName: displayName,
          toolArgs: sanitizeToolArgs(
            typeof tool_input === "object" && tool_input !== null
              ? (tool_input as Record<string, unknown>)
              : {},
          ),
          callIndex,
          timestamp: Date.now(),
        });

        return {};
      },
    ],
  };

  const postToolUseHook: HookCallbackMatcher = {
    hooks: [
      async (input: HookInput, _toolUseId: string | undefined): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== "PostToolUse") return {};

        const { tool_name, tool_response, tool_use_id } = input;
        const tracked = toolTimers.get(tool_use_id);
        toolTimers.delete(tool_use_id);

        const rawName = tool_name.replace(/^mcp__kayley__/, "");

        eventBus.emit("tool_end", {
          type: "tool_end" as const,
          toolName: rawName,
          callIndex: tracked?.callIndex ?? 0,
          durationMs: Date.now() - (tracked?.startTime ?? Date.now()),
          success: true,
          resultSummary: truncateResultSummary(tool_response),
          timestamp: Date.now(),
        });

        return {};
      },
    ],
  };

  const postToolUseFailureHook: HookCallbackMatcher = {
    hooks: [
      async (input: HookInput, _toolUseId: string | undefined): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== "PostToolUseFailure") return {};

        const { tool_name, tool_use_id } = input;
        const tracked = toolTimers.get(tool_use_id);
        toolTimers.delete(tool_use_id);

        const rawName = tool_name.replace(/^mcp__kayley__/, "");

        eventBus.emit("tool_end", {
          type: "tool_end" as const,
          toolName: rawName,
          callIndex: tracked?.callIndex ?? 0,
          durationMs: Date.now() - (tracked?.startTime ?? Date.now()),
          success: false,
          resultSummary: "error" in input ? String((input as any).error) : "Tool failed",
          timestamp: Date.now(),
        });

        return {};
      },
    ],
  };

  return {
    PreToolUse: [preToolUseHook],
    PostToolUse: [postToolUseHook],
    PostToolUseFailure: [postToolUseFailureHook],
  };
}

/**
 * Build the allowed tools list for the SDK.
 * Includes built-in Claude Code tools + all MCP tools.
 */
function buildAllowedTools(): string[] {
  return [
    // Built-in Claude Code tools (replace workspace_action, read_agent_file, write_agent_file, web_*)
    "Read", "Write", "Edit", "Bash", "Glob", "Grep",
    "WebSearch", "WebFetch",
    // All Kayley MCP tools (auto-prefixed by SDK as mcp__kayley__<name>)
    "mcp__kayley__recall_memory",
    "mcp__kayley__recall_user_info",
    "mcp__kayley__store_user_info",
    "mcp__kayley__store_self_info",
    "mcp__kayley__store_character_info",
    "mcp__kayley__recall_character_profile",
    "mcp__kayley__calendar_action",
    "mcp__kayley__google_task_action",
    "mcp__kayley__google_cli",
    "mcp__kayley__email_action",
    "mcp__kayley__email_action_manage",
    "mcp__kayley__store_daily_note",
    "mcp__kayley__retrieve_daily_notes",
    "mcp__kayley__store_monthly_note",
    "mcp__kayley__retrieve_monthly_notes",
    "mcp__kayley__store_lessons_learned",
    "mcp__kayley__retrieve_lessons_learned",
    "mcp__kayley__mila_note",
    "mcp__kayley__retrieve_mila_notes",
    "mcp__kayley__resolve_idle_question",
    "mcp__kayley__resolve_idle_browse_note",
    "mcp__kayley__resolve_open_loop",
    "mcp__kayley__create_open_loop",
    "mcp__kayley__create_life_storyline",
    "mcp__kayley__make_promise",
    "mcp__kayley__tool_suggestion",
    "mcp__kayley__resolve_x_tweet",
    "mcp__kayley__post_x_tweet",
    "mcp__kayley__resolve_x_mention",
    "mcp__kayley__review_pr",
    "mcp__kayley__submit_pr_review",
    "mcp__kayley__delegate_to_engineering",
    "mcp__kayley__get_engineering_ticket_status",
    "mcp__kayley__submit_clarification",
    "mcp__kayley__kayley_pulse",
    "mcp__kayley__query_database",
    "mcp__kayley__start_background_task",
    "mcp__kayley__check_task_status",
    "mcp__kayley__cancel_task",
    "mcp__kayley__list_active_tasks",
  ];
}

// ============================================================================
// ClaudeAgentService
// ============================================================================

export class ClaudeAgentService implements IAIChatService {
  model = CLAUDE_MODEL;

  private async fetchUserContext(): Promise<{
    relationship: RelationshipMetrics | null;
  }> {
    const [relationshipData, lastInteractionAt] = await Promise.all([
      relationshipService.getRelationship(),
      getLastInteractionDate(),
    ]);

    if (relationshipData) {
      relationshipData.lastInteractionAt = lastInteractionAt;
    }

    return { relationship: relationshipData };
  }

  /**
   * Run a Claude Agent SDK query and collect the result.
   *
   * Session management:
   * - First query for a conversation: uses `sessionId` option for deterministic ID
   * - Follow-up queries: uses `resume` to continue the existing session
   * - Greetings/non-greetings: use `persistSession: false` (ephemeral)
   *
   * Hooks:
   * - PreToolUse/PostToolUse/PostToolUseFailure: emit SSE events for web client tool visibility
   */
  private async runQuery(
    prompt: string,
    systemPrompt: string,
    options: AIChatOptions,
    conversationLogId: string,
    sessionId?: string,
    ephemeral = false,
  ): Promise<{
    resultText: string;
    sdkSessionId: string;
    resultMessage: SDKResultMessage | null;
  }> {
    // Create MCP server with per-request context
    const context = {
      userMessage: prompt,
      conversationScopeId: options.conversationScopeId,
      conversationLogId,
      eventBus: options.eventBus,
    };
    const mcpServer = createKayleyMcpServer(() => context);

    // Timer map for tracking tool call durations + callIndex across Pre/Post hooks
    const toolTimers = new Map<string, { startTime: number; callIndex: number }>();
    const hooks = buildSSEHooks(options.eventBus, toolTimers);

    const queryOptions: Options = {
      model: this.model,
      systemPrompt,
      mcpServers: { kayley: mcpServer },
      allowedTools: buildAllowedTools(),
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      cwd: process.cwd(),
      maxTurns: 15,
      effort: "medium",
      // Don't load CLAUDE.md or user settings — Kayley has her own prompts
      settingSources: [],
      // Programmatic hooks for SSE tool visibility on ALL tools (built-in + MCP)
      hooks,
      // Ephemeral sessions (greetings) don't persist — regular conversations do
      persistSession: !ephemeral,
    };

    // Session management:
    // - If we have a prior SDK session ID (from a previous turn), resume it
    // - Otherwise, this is a fresh conversation — let SDK auto-generate
    if (sessionId && !sessionId.startsWith("greeting-") && !sessionId.startsWith("nongreeting-")) {
      queryOptions.resume = sessionId;
    }

    let resultText = "";
    let sdkSessionId = "";
    let resultMessage: SDKResultMessage | null = null;

    const q = query({ prompt, options: queryOptions });

    for await (const message of q) {
      const msg = message as SDKMessage;

      if (msg.type === "system" && (msg as SDKSystemMessage).subtype === "init") {
        sdkSessionId = msg.session_id;
        runtimeLog.info("Claude SDK session initialized", {
          sessionId: sdkSessionId,
          model: (msg as SDKSystemMessage).model,
          tools: (msg as SDKSystemMessage).tools?.length ?? 0,
          mcpServers: (msg as SDKSystemMessage).mcp_servers,
          conversationLogId,
          ephemeral,
        });
      }

      if (msg.type === "result") {
        resultMessage = msg as SDKResultMessage;
        if (resultMessage.subtype === "success") {
          resultText = resultMessage.result;
          sdkSessionId = resultMessage.session_id ?? sdkSessionId;
          runtimeLog.info("Claude SDK query completed", {
            conversationLogId,
            sessionId: sdkSessionId,
            durationMs: resultMessage.duration_ms,
            numTurns: resultMessage.num_turns,
            costUsd: resultMessage.total_cost_usd,
          });
        } else {
          runtimeLog.error("Claude SDK query failed", {
            conversationLogId,
            sessionId: sdkSessionId,
            result: resultMessage,
          });
        }
      }
    }

    return { resultText, sdkSessionId, resultMessage };
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
      requestId: conversationLogId,
      conversationLogId,
      inputType: input.type,
      sessionId: session?.interactionId,
    });

    try {
      const ctx = await this.fetchUserContext();

      const currentUserMessage =
        input.type === "text" ? input.text
        : input.type === "image_text" ? input.text
        : undefined;

      const [xTweetPrompt, xMentionsPrompt, mediaNudgePrompt] = await Promise.all([
        buildXTweetPromptSection(),
        buildMentionsPromptSection(),
        buildMediaNudgePromptSection(currentUserMessage),
      ]);

      const systemPrompt = await buildSystemPromptForNonGreeting(
        ctx.relationship,
        session?.interactionId,
        currentUserMessage,
        options.chatHistory?.length ?? 0,
        { xTweetPrompt, xMentionsPrompt, mediaNudgePrompt },
      );

      const prompt = formatUserPrompt(input);

      const { resultText, sdkSessionId, resultMessage } = await this.runQuery(
        prompt,
        systemPrompt,
        options,
        conversationLogId,
        session?.interactionId,
      );

      const aiResponse = parseResultToResponse(resultText);
      const tokenUsage = mapTokenUsage(resultMessage);

      const elapsedMs = Date.now() - startMs;
      runtimeLog.info("generateResponse complete", {
        requestId: conversationLogId,
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

      return {
        response: aiResponse,
        session: { model: this.model, interactionId: sdkSessionId },
        conversationLogId,
        tokenUsage,
      };
    } catch (error) {
      runtimeLog.error("generateResponse failed", {
        requestId: conversationLogId,
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

  async generateGreeting(): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }> {
    const conversationLogId = crypto.randomUUID();
    const startMs = Date.now();

    runtimeLog.info("generateGreeting start", { requestId: conversationLogId, conversationLogId });

    const [ctx, importantDateFacts] = await Promise.all([
      this.fetchUserContext(),
      getImportantDateFacts(),
    ]);

    const greetingContext: DailyLogisticsContext = {
      chatHistory: [],
      lastInteractionDateUtc: ctx.relationship?.lastInteractionAt ?? new Date(),
      importantDateFacts: importantDateFacts.map((f) => ({
        key: f.fact_key,
        value: f.fact_value,
      })),
      upcomingEvents: [],
      pastCalendarEvents: [],
      kayleyLifeUpdates: [],
    };

    const systemPrompt = await buildSystemPromptForGreeting(greetingContext);
    const greetingPrompt = buildGreetingPrompt(ctx.relationship!);

    const greetingOptions: AIChatOptions = { audioMode: "none" };
    const { resultText, sdkSessionId } = await this.runQuery(
      greetingPrompt,
      systemPrompt,
      greetingOptions,
      conversationLogId,
      undefined, // no prior session
      true, // ephemeral — greeting sessions don't persist
    );

    const greeting = parseResultToResponse(resultText);

    const elapsedMs = Date.now() - startMs;
    runtimeLog.info("generateGreeting complete", {
      requestId: conversationLogId,
      conversationLogId,
      elapsedMs,
      textLength: greeting.text_response?.length || 0,
    });

    return {
      greeting,
      session: { model: this.model, interactionId: sdkSessionId },
    };
  }

  // ------------------------------------------------------------------
  // Non-Greeting (welcome back / idle breaker)
  // ------------------------------------------------------------------

  async generateNonGreeting(
    session: AIChatSession,
  ): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }> {
    const conversationLogId = crypto.randomUUID();
    const startMs = Date.now();

    runtimeLog.info("generateNonGreeting start", { requestId: conversationLogId, conversationLogId });

    const ctx = await this.fetchUserContext();

    const [xTweetPrompt, xMentionsPrompt] = await Promise.all([
      buildXTweetPromptSection(),
      buildMentionsPromptSection(),
    ]);

    let systemPrompt = await buildSystemPromptForNonGreeting(
      ctx.relationship,
      session.interactionId,
      undefined,
      1,
      { xTweetPrompt, xMentionsPrompt },
    );

    // Inject pending storyline suggestion
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
      ctx.relationship?.lastInteractionAt ?? new Date(),
    );

    const nonGreetingOptions: AIChatOptions = { audioMode: "none" };
    const { resultText, sdkSessionId } = await this.runQuery(
      nonGreetingPrompt,
      systemPrompt,
      nonGreetingOptions,
      conversationLogId,
      session.interactionId,
      true, // ephemeral — non-greeting/idle breaker sessions don't persist
    );

    const structuredResponse = parseResultToResponse(resultText);

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
      requestId: conversationLogId,
      conversationLogId,
      elapsedMs,
      textLength: structuredResponse.text_response?.length || 0,
    });

    return {
      greeting: structuredResponse,
      session: { model: this.model, interactionId: sdkSessionId },
      audioData,
    };
  }
}

/** Singleton instance for server-side use. */
export const claudeAgentService = new ClaudeAgentService();
