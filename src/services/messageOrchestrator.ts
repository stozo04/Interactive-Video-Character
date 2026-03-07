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
  type NewsAction,
  type SelfieAction,
  type VideoAction,
} from '../handlers/messageActions';
import { appendConversationHistory } from './conversationHistoryService';
import { extractAndRecordTopics } from './topicExhaustionService';
import { refreshConversationAnchor } from './conversationAnchorService';
import { consumeCalendarMutationSignal } from './memoryService';
import { clientLogger } from './clientLogger';
import { detectSelfieIntent } from './selfieIntentService';

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
    chatHistory,
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
    const selfieIntent = await detectSelfieIntent({
      userMessage,
      chatHistory,
    });
    const forceImmediateSelfie =
      selfieIntent.intent === 'immediate_selfie' && selfieIntent.confidence >= 0.6;

    // Append pending email context if Kayley is waiting on a decision
    if (pendingEmail && !forceImmediateSelfie) {
      const emailContext = [
        `[PENDING EMAIL ACTION — Steven is responding to an email you announced:]`,
        `  Message ID : ${pendingEmail.id}`,
        `  Thread ID  : ${pendingEmail.threadId}`,
        `  From       : ${pendingEmail.from}`,
        `  Subject    : ${pendingEmail.subject}`,
        `  Body       : ${(pendingEmail.body?.trim() || pendingEmail.snippet?.trim() || '(no body)').slice(0, 600)}`,
        ``,
        `If Steven chooses an email action, call the FUNCTION TOOL "email_action" (do not put email_action in output JSON):`,
        `  action="reply"   with message_id + reply_body (+ thread_id optional)`,
        `  action="archive" with message_id`,
        `  action="dismiss" with message_id`,
        `CRITICAL: "respond saying X" means reply TO THE SENDER with X — not just an acknowledgment to Steven.`,
        `For reply actions, keep Steven's intent in reply_body and run email_action.`,
      ].join('\n');

      textToSend = `${textToSend}\n\n${emailContext}`;
      log.info(`Injected pending email context`, { emailId: pendingEmail.id });
    }

    if (pendingEmail && forceImmediateSelfie) {
      log.info(`Skipped pending email context due to immediate selfie intent`, {
        emailId: pendingEmail.id,
        confidence: selfieIntent.confidence,
      });
    }

    if (forceImmediateSelfie) {
      const selfieOverride = [
        `[SELFIE INTENT OVERRIDE]`,
        `Steven is asking for a selfie right now. Fulfill this request in this turn.`,
        `Return output JSON with selfie_action populated now.`,
        `Do NOT call make_promise for this request.`,
        `Keep text_response selfie-focused and brief (one sentence max).`,
        `Do NOT ask unrelated follow-up questions in this turn.`,
        selfieIntent.sceneHint
          ? `Scene hint: ${selfieIntent.sceneHint}`
          : `Scene hint: casual present-moment selfie`,
        selfieIntent.moodHint
          ? `Mood hint: ${selfieIntent.moodHint}`
          : `Mood hint: playful and warm`,
      ].join('\n');
      textToSend = `${textToSend}\n\n${selfieOverride}`;
      log.info(`Applied immediate selfie override`, {
        confidence: selfieIntent.confidence,
        sceneHint: selfieIntent.sceneHint || null,
        moodHint: selfieIntent.moodHint || null,
      });
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
    let actionType = determineActionType(response);

    console.log(`🎯 [Orchestrator] Action type: ${actionType}`);
    result.actionType = actionType;

    // Set refresh flags when calendar_action ran as a function tool.
    // The function tool runs inside the AI interaction loop before the response reaches
    // the orchestrator, so response fields are never populated for these.
    if (consumeCalendarMutationSignal()) {
      result.refreshCalendar = true;
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

    // Fallback guard: if intent was immediate selfie but model did not emit selfie_action,
    // synthesize a safe selfie action so the user still gets the image this turn.
    if (
      forceImmediateSelfie &&
      actionType !== ActionType.SELFIE &&
      !result.selfieImage &&
      !result.selfieError
    ) {
      const fallbackSelfieAction: SelfieAction = {
        scene: selfieIntent.sceneHint || 'casual at-home selfie, present moment',
        mood: selfieIntent.moodHint || 'playful smile',
      };
      log.info(`Running immediate selfie fallback`, {
        fallbackScene: fallbackSelfieAction.scene,
        fallbackMood: fallbackSelfieAction.mood,
        previousActionType: actionType,
      });
      const selfieResult = await processSelfieAction(fallbackSelfieAction, {
        userMessage,
        chatHistory,
      });
      if (selfieResult.handled) {
        actionType = ActionType.SELFIE;
        result.actionType = actionType;
        if (selfieResult.success && selfieResult.imageBase64) {
          result.selfieImage = {
            base64: selfieResult.imageBase64,
            mimeType: selfieResult.mimeType || 'image/png',
          };
          result.selfieMessageText = 'Here you go!';
          log.info(`Immediate selfie fallback succeeded`);
        } else {
          result.selfieError =
            selfieResult.error || "I couldn't take that pic right now, sorry!";
          result.selfieMessageText = result.selfieError;
          log.info(`Immediate selfie fallback failed`, {
            error: result.selfieError,
          });
        }
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
    const suppressAssistantTextForImmediateSelfie =
      forceImmediateSelfie && (Boolean(result.selfieImage) || Boolean(result.selfieError));
    result.chatMessages = suppressAssistantTextForImmediateSelfie
      ? []
      : [
          {
            role: 'model',
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

