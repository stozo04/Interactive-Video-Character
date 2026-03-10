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

import {
  processSelfieAction,
  processVideoAction,
  type SelfieAction,
  type VideoAction,
} from '../handlers/messageActions';
import { appendConversationHistory } from './conversationHistoryService';
import { extractAndRecordTopics } from './topicExhaustionService';
import { refreshConversationAnchor } from './conversationAnchorService';
import { consumeCalendarMutationSignal } from './memoryService';
import {
  getOldestPendingDraft,
  getPendingDraftForConversationScope,
} from '../../server/services/xTwitterServerService';
import { clientLogger } from './clientLogger';

const log = clientLogger.scoped('MessageOrchestrator');

/**
 * Main entry point for processing user messages
 *
 * Flow:
 * 1. Pre-processing
 * 2. AI call
 * 3. Action routing
 * 4. Post-processing
 * 5. Result building
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
    conversationScopeId,
    eventBus,
  } = input;

  const result: OrchestratorResult = {
    ...createEmptyResult(ProcessingStage.PREPROCESSING),
  };

  try {
    result.stage = ProcessingStage.AI_CALL;
    console.log(`AI [Orchestrator] Calling AI service...`);

    let textToSend = userMessageForAI ?? userMessage;

    if (pendingEmail) {
      const emailContext = [
        `[PENDING EMAIL ACTION - Steven is responding to an email you announced:]`,
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
        `CRITICAL: "respond saying X" means reply TO THE SENDER with X - not just an acknowledgment to Steven.`,
        `For reply actions, keep Steven's intent in reply_body and run email_action.`,
      ].join('\n');

      textToSend = `${textToSend}\n\n${emailContext}`;
      log.info(`Injected pending email context`, { emailId: pendingEmail.id });
    }

    let content: UserContent = userContent || { type: 'text', text: textToSend };
    if (content.type === 'image_text') {
      content = { ...content, text: textToSend };
    } else if (content.type === 'text') {
      content = { type: 'text', text: textToSend };
    }

    const options: AIChatOptions = {
      originalMessageForIntent: undefined,
      chatHistory,
      audioMode: isMuted ? 'none' : 'sync',
      conversationScopeId,
      eventBus,
    };

    const aiResult = await aiService.generateResponse(
      content,
      options,
      session || undefined,
    );

    result.stage = ProcessingStage.ACTION_ROUTING;
    const response = aiResult.response;
    const actionType = determineActionType(response);

    console.log(`Action [Orchestrator] Type: ${actionType}`);
    result.actionType = actionType;

    if (consumeCalendarMutationSignal()) {
      result.refreshCalendar = true;
    }

    result.stage = ProcessingStage.POSTPROCESSING;

    if (actionType === ActionType.SELFIE) {
      const selfieAction = response.selfie_action as SelfieAction | undefined;
      if (selfieAction?.scene) {
        const selfieStartMs = Date.now();
        eventBus?.emit('sse', { type: 'action_start', actionName: 'selfie', actionDisplayName: 'Generating selfie', timestamp: Date.now() });
        const selfieResult = await processSelfieAction(selfieAction, {
          userMessage,
          chatHistory,
        });
        eventBus?.emit('sse', { type: 'action_end', actionName: 'selfie', durationMs: Date.now() - selfieStartMs, success: selfieResult.success, timestamp: Date.now() });

        if (selfieResult.handled) {
          if (selfieResult.success && selfieResult.imageBase64) {
            result.selfieImage = {
              base64: selfieResult.imageBase64,
              mimeType: selfieResult.mimeType || 'image/png',
            };
            result.selfieHistoryId = selfieResult.historyId ?? null;
            result.selfieScene = selfieAction.scene;
            result.selfieMood = selfieAction.mood ?? null;
            result.selfieMessageText = 'Here you go!';
            log.info('Selfie generated successfully', { scene: selfieAction.scene });
          } else {
            result.selfieError =
              selfieResult.error ||
              "I couldn't take that pic right now, sorry!";
            result.selfieMessageText = result.selfieError;
            log.error('Selfie generation failed', { error: result.selfieError, scene: selfieAction.scene });
          }
        }
      }
    }

    if (actionType === ActionType.GIF) {
      const gifAction = (response as any).gif_action as { query: string; message_text?: string } | undefined;
      if (gifAction?.query) {
        result.gifQuery = gifAction.query;
        result.gifMessageText = gifAction.message_text;
        console.log(`GIF [Orchestrator] Query: ${gifAction.query.substring(0, 80)}`);
      }
    }

    if (actionType === ActionType.VIDEO) {
      const videoAction = (response as any).video_action as VideoAction | undefined;
      if (videoAction?.scene) {
        const videoStartMs = Date.now();
        eventBus?.emit('sse', { type: 'action_start', actionName: 'video', actionDisplayName: 'Generating video', timestamp: Date.now() });
        const videoResult = await processVideoAction(videoAction, {
          userMessage,
          chatHistory,
        });
        eventBus?.emit('sse', { type: 'action_end', actionName: 'video', durationMs: Date.now() - videoStartMs, success: videoResult.success, timestamp: Date.now() });

        if (videoResult.handled) {
          if (videoResult.success && videoResult.videoUrl) {
            result.videoUrl = videoResult.videoUrl;
            result.videoScene = videoAction.scene;
            result.videoMood = videoAction.mood ?? null;
            result.videoMessageText = "Here's a little video for you!";
            console.log(`Video [Orchestrator] Generated successfully`);
          } else {
            result.videoError =
              videoResult.error ||
              "I couldn't make that video right now, sorry!";
            result.videoMessageText = result.videoError;
            console.log(`Video [Orchestrator] Failed: ${result.videoError}`);
          }
        }
      }
    }

    const historyMessages = [
      { role: 'user' as const, text: userMessage },
      { role: 'model' as const, text: response.text_response },
    ];
    appendConversationHistory(
      historyMessages,
      aiResult.session?.interactionId,
      aiResult.conversationLogId,
      aiResult.tokenUsage,
    ).catch((err) =>
      console.error('Failed to append history:', err),
    );

    const turnIndex = chatHistory.filter((m) => m.role === 'user').length + 1;
    const recentHistory = chatHistory.slice(-8).map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : (msg.role as 'user' | 'model'),
      text: msg.text,
    }));
    const recentTurnsWithCurrent = [
      ...recentHistory,
      { role: 'user' as const, text: userMessage },
      { role: 'model' as const, text: response.text_response },
    ].slice(-10);

    Promise.all([
      extractAndRecordTopics(response.text_response, userMessage),
      aiResult.session?.interactionId
        ? refreshConversationAnchor({
            interactionId: aiResult.session.interactionId,
            turnIndex,
            userMessage,
            recentTurns: recentTurnsWithCurrent,
          })
        : Promise.resolve(),
    ]).catch((err) =>
      console.error('Background post-processing failed:', err),
    );

    result.stage = ProcessingStage.COMPLETE;
    result.success = true;
    result.conversationLogId = aiResult.conversationLogId;
    result.tokenUsage = aiResult.tokenUsage;
    result.chatMessages = [
      {
        role: 'model',
        text: response.text_response,
      },
    ];

    if (!isMuted && aiResult.audioData) {
      result.audioToPlay = aiResult.audioData;
    }

    if (response.open_app) {
      result.appToOpen = response.open_app;
    }

    result.updatedSession = aiResult.session;
    result.rawResponse = response;

    if (conversationScopeId) {
      try {
        let pendingDraft = await getPendingDraftForConversationScope(conversationScopeId);
        if (!pendingDraft && conversationScopeId.startsWith('web-')) {
          pendingDraft = await getOldestPendingDraft();
        }
        if (pendingDraft) {
          result.pendingTweetDraft = {
            id: pendingDraft.id,
            tweetText: pendingDraft.tweetText,
            includeSelfie: pendingDraft.includeSelfie,
            selfieScene: pendingDraft.selfieScene ?? null,
          };
        }
      } catch (err) {
        log.warning('Failed to load pending tweet draft', {
          conversationScopeId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    console.log(`Complete [Orchestrator]: actionType=${actionType}, success=true`);
    return result;
  } catch (error) {
    console.error(`Error [Orchestrator]:`, error);

    return {
      ...createEmptyResult(ProcessingStage.ERROR),
      success: false,
      actionType: ActionType.NONE,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
