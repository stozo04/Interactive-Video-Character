// src/services/messageOrchestrator.ts

/**
 * Message Orchestrator Service
 *
 * Central coordinator for processing user messages. Handles the complete flow
 * from receiving a message to returning UI updates. Keeps App.tsx thin.
 *
 * @see src/services/docs/MessageOrchestrator.md
 */

import type { AIChatOptions, UserContent } from './aiService';
import {
  ActionType,
  ProcessingStage,
  type OrchestratorInput,
  type OrchestratorResult,
  createEmptyResult,
  determineActionType,
} from '../handlers/messageActions/types';

// Action handlers
import {
  processNewsAction,
  processSelfieAction,
  processVideoAction,
  parseTaskActionFromResponse,
  detectTaskCompletionFallback,
  type NewsAction,
  type SelfieAction,
  type VideoAction,
  type TaskAction,
} from '../handlers/messageActions';
import { appendConversationHistory } from './conversationHistoryService';
import { extractAndRecordTopics } from './topicExhaustionService';
import { refreshConversationAnchor } from './conversationAnchorService';
import { consumeTaskMutationSignal, consumeCalendarMutationSignal } from './memoryService';
import { clientLogger } from './clientLogger';

const log = clientLogger.scoped('MessageOrchestrator');


// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

/**
 * Main entry point for processing user messages
 *
 * Flow:
 * 1. Pre-processing (calendar context injection)
 * 2. AI call (generate response)
 * 3. Action routing (task, calendar, news, selfie)
 * 4. Post-processing (facts, presence - fire-and-forget)
 * 5. Result building
 *
 * @param input - OrchestratorInput with message, services, and context
 * @returns OrchestratorResult with all UI updates needed
 */
export async function processUserMessage(input: OrchestratorInput): Promise<OrchestratorResult> {
  const {
    userMessage,
    userMessageForAI,
    userContent,
    aiService,
    session,
    accessToken,
    chatHistory,
    upcomingEvents,
    tasks,
    isMuted,
    pendingEmail,
  } = input;

  // console.log(`🎯 [Orchestrator] Processing message: "${userMessage.substring(0, 50)}..."`);

  // Start with empty result
  const result: OrchestratorResult = {
    ...createEmptyResult(ProcessingStage.PREPROCESSING),
  };

  try {
    // ========================================================================
    // PHASE 1: PRE-PROCESSING
    // ========================================================================

    // Calendar events are now fetched on-demand via the check_calendar tool.
    // No per-message calendar injection needed.

    // ========================================================================
    // PHASE 2: AI CALL
    // ========================================================================

    result.stage = ProcessingStage.AI_CALL;
    console.log(`⚡ [Orchestrator] Calling AI service...`);

    let textToSend = userMessageForAI ?? userMessage;

    // Append pending email context if Kayley is waiting on a decision
    if (pendingEmail) {
      const emailContext = [
        `[PENDING EMAIL ACTION — Steven is responding to an email you announced:]`,
        `  Message ID : ${pendingEmail.id}`,
        `  Thread ID  : ${pendingEmail.threadId}`,
        `  From       : ${pendingEmail.from}`,
        `  Subject    : ${pendingEmail.subject}`,
        `  Body       : ${(pendingEmail.body?.trim() || pendingEmail.snippet?.trim() || '(no body)').slice(0, 600)}`,
        ``,
        `Based on Steven's message, choose email_action.action:`,
        `  "reply"    — Steven wants to send a reply TO THE EMAIL SENDER.`,
        `               Triggered by: "respond saying X", "reply saying X", "say X", "tell them X", "send them X".`,
        `               Use Steven's exact words as reply_body in your Kayley voice.`,
        `  "archive"  — Steven wants it removed from inbox, no reply sent.`,
        `               Triggered by: "archive it", "delete it", "get rid of it", "done", "handled".`,
        `  "dismiss"  — Steven wants to ignore it with no action.`,
        `CRITICAL: "respond saying X" means reply TO THE SENDER with X — NOT an acknowledgment to Steven.`,
        `Always populate message_id. Populate thread_id + reply_body when action is "reply".`,
      ].join('\n');

      textToSend = `${textToSend}\n\n${emailContext}`;
      log.info(`Injected pending email context`, { emailId: pendingEmail.id });
    }

    // Build input and options for AI service
    let content: UserContent = userContent || { type: "text", text: textToSend };
    if (content.type === "image_text") {
      content = { ...content, text: textToSend };
    } else if (content.type === "text") {
      content = { type: "text", text: textToSend };
    }
    const options: AIChatOptions = {
      // Pass original message to intent detection (keeps payload small)
      // Intent detection doesn't need calendar data - only main chat does
      originalMessageForIntent: undefined,
      chatHistory,
      googleAccessToken: accessToken,
      audioMode: isMuted ? "none" : "sync",
    };

    const aiResult = await aiService.generateResponse(
      content,
      options,
      session || undefined
    );

    // ========================================================================
    // PHASE 3: ACTION ROUTING
    // ========================================================================

    result.stage = ProcessingStage.ACTION_ROUTING;
    const response = aiResult.response;
    const actionType = determineActionType(response);

    console.log(`🎯 [Orchestrator] Action type: ${actionType}`);
    result.actionType = actionType;

    // Set refresh flags based on action type (JSON response path)
    if (actionType === ActionType.TASK) {
      result.refreshTasks = true;
      result.openTaskPanel = true;
    }

    // Set refresh flags when task_action or calendar_action ran as a function tool.
    // The function tool runs inside the AI interaction loop before the response reaches
    // the orchestrator, so response fields are never populated for these. Mutation signals bridge the gap.
    if (consumeTaskMutationSignal()) {
      result.refreshTasks = true;
      result.openTaskPanel = true;
    }
    if (consumeCalendarMutationSignal()) {
      result.refreshCalendar = true;
    }

    // ========================================================================
    // PHASE 6: TASK ACTION DETECTION (execution stays in App.tsx)
    // ========================================================================

    // Fallback task detection from text (task_action now runs as function tool;
    // consumeTaskMutationSignal above handles refreshTasks. These fallbacks catch
    // edge cases where text hints at task intent without a tool call.)
    let detectedTask: TaskAction | null | undefined = null;
    if (!detectedTask && response.text_response) {
      detectedTask = parseTaskActionFromResponse(response.text_response);
    }
    if (!detectedTask) {
      detectedTask = detectTaskCompletionFallback(userMessage, tasks);
    }
    if (detectedTask) {
      result.detectedTaskAction = detectedTask;
    }

    // ========================================================================
    // PHASE 4: EXECUTE ACTION HANDLERS
    // ========================================================================

    // News Action
    if (actionType === ActionType.NEWS) {
      const newsAction = response.news_action as NewsAction | undefined;
      if (newsAction?.action === "fetch") {
        const newsResult = await processNewsAction(newsAction);
        if (newsResult.handled && newsResult.newsPrompt) {
          result.newsPrompt = newsResult.newsPrompt;
          console.log(`📰 [Orchestrator] News fetched, prompt ready`);
        }
      }
    }

    // Selfie Action (Phase 5: Generate complete message with image)
    if (actionType === ActionType.SELFIE) {
      const selfieAction = response.selfie_action as SelfieAction | undefined;
      if (selfieAction?.scene) {
        const selfieResult = await processSelfieAction(selfieAction, {
          userMessage,
          chatHistory,
          upcomingEvents,
        });
        if (selfieResult.handled) {
          if (selfieResult.success && selfieResult.imageBase64) {
            // Phase 5: Add selfie message with image directly to chatMessages
            result.selfieImage = {
              base64: selfieResult.imageBase64,
              mimeType: selfieResult.mimeType || "image/png",
            };
            // The selfie message text (App.tsx will generate TTS for this)
            result.selfieMessageText = "Here you go!";
            console.log(`📸 [Orchestrator] Selfie generated successfully`);
          } else {
            result.selfieError =
              selfieResult.error ||
              "I couldn't take that pic right now, sorry!";
            // The error message text (App.tsx will generate TTS for this)
            result.selfieMessageText = result.selfieError;
            console.log(
              `📸 [Orchestrator] Selfie failed: ${result.selfieError}`
            );
          }
        }
      }
    }

    // Email Action (archive / reply / dismiss a pending email, OR send a new one)
    if (actionType === ActionType.EMAIL) {
      const emailAction = (response as any).email_action as {
        action: 'archive' | 'reply' | 'dismiss' | 'send';
        message_id?: string;
        thread_id?: string;
        to?: string;
        subject?: string;
        reply_body?: string;
      } | undefined;

      // 'send' requires 'to'; archive/reply/dismiss require 'message_id'
      const isValid = emailAction?.action === 'send'
        ? !!emailAction.to
        : !!(emailAction?.action && emailAction?.message_id);

      if (isValid) {
        result.detectedEmailAction = emailAction as any;
        log.info(`Email action detected`, { action: emailAction!.action, messageId: emailAction!.message_id, to: emailAction!.to });
      }
    }

    // GIF Action (Send inline animated GIF via WhatsApp)
    if (actionType === ActionType.GIF) {
      const gifAction = (response as any).gif_action as { query: string; message_text?: string } | undefined;
      if (gifAction?.query) {
        result.gifQuery = gifAction.query;
        result.gifMessageText = gifAction.message_text;
        console.log(`🎞️ [Orchestrator] GIF action query: ${gifAction.query.substring(0, 80)}`);
      }
    }

    // Video Action (Generate companion video)
    if (actionType === ActionType.VIDEO) {
      const videoAction = (response as any).video_action as VideoAction | undefined;
      if (videoAction?.scene) {
        const videoResult = await processVideoAction(videoAction, {
          userMessage,
          chatHistory,
          upcomingEvents,
        });
        if (videoResult.handled) {
          if (videoResult.success && videoResult.videoUrl) {
            result.videoUrl = videoResult.videoUrl;
            result.videoMessageText = "Here's a little video for you!";
            console.log(`🎬 [Orchestrator] Video generated successfully`);
          } else {
            result.videoError =
              videoResult.error ||
              "I couldn't make that video right now, sorry!";
            result.videoMessageText = result.videoError;
            console.log(
              `🎬 [Orchestrator] Video failed: ${result.videoError}`
            );
          }
        }
      }
    }

    // ========================================================================
    // PHASE 4: POST-PROCESSING (Fire-and-forget)
    // ========================================================================

    result.stage = ProcessingStage.POSTPROCESSING;

    // User facts detection has been removed from intent detection to reduce payload size
    // Facts can be stored via the store_user_info tool in the main chat instead

    // Character facts are now stored exclusively via the store_self_info LLM tool
    // Pattern-based detection has been removed in favor of LLM semantic understanding



    // Background conversation history - don't await
    const historyMessages = [
      { role: "user" as const, text: userMessage },
      { role: "model" as const, text: response.text_response },
    ];
    appendConversationHistory(
      historyMessages,
      aiResult.session?.interactionId,
      aiResult.conversationLogId,
      aiResult.tokenUsage,
    ).catch((err) =>
      console.error("❌ [Orchestrator] Failed to append history:", err)
    );

    // Background post-processing: topic tracking + anchor refresh — zero latency impact
    // Turn index = current user turn number (historical user messages + current turn)
    // This matches human/log meaning of "turn number" and avoids "turn 0" on first write
    const turnIndex = chatHistory.filter((m) => m.role === "user").length + 1;

    // Build recent turns including current exchange (so anchor captures THIS turn's asks/commitments)
    const recentHistory = chatHistory.slice(-8).map((msg) => ({
      role: msg.role === "assistant" ? "model" : (msg.role as "user" | "model"),
      text: msg.text,
    }));
    const recentTurnsWithCurrent = [
      ...recentHistory,
      { role: "user" as const, text: userMessage },
      { role: "model" as const, text: response.text_response },
    ].slice(-10); // Cap at 10 messages (5 turns)

    Promise.all([
      extractAndRecordTopics(response.text_response, userMessage),

      // Anchor refresh (skip if missing interactionId)
      aiResult.session?.interactionId
        ? refreshConversationAnchor({
            interactionId: aiResult.session.interactionId,
            turnIndex,
            userMessage,
            recentTurns: recentTurnsWithCurrent,
          })
        : Promise.resolve(),
    ]).catch((err) =>
      console.error("❌ [Orchestrator] Background post-processing failed:", err)
    );

    // ========================================================================
    // PHASE 5: BUILD RESULT
    // ========================================================================

    result.stage = ProcessingStage.COMPLETE;
    result.success = true;
    result.conversationLogId = aiResult.conversationLogId;
    result.tokenUsage = aiResult.tokenUsage;

    // Chat message
    result.chatMessages = [
      {
        role: "model",
        text: response.text_response,
      },
    ];

    // Audio (only if not muted)
    if (!isMuted && aiResult.audioData) {
      result.audioToPlay = aiResult.audioData;
    }

    // App opening
    if (response.open_app) {
      result.appToOpen = response.open_app;
    }

    // Session
    result.updatedSession = aiResult.session;

    // Raw response for action routing in App.tsx
    result.rawResponse = response;

    console.log(
      `✅ [Orchestrator] Complete: actionType=${actionType}, success=true`
    );

    return result;
  } catch (error) {
    console.error(`❌ [Orchestrator] Error:`, error);

    return {
      ...createEmptyResult(ProcessingStage.ERROR),
      success: false,
      actionType: ActionType.NONE,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

