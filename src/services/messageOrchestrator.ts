// src/services/messageOrchestrator.ts

/**
 * Message Orchestrator Service
 *
 * Central coordinator for processing user messages. Handles the complete flow
 * from receiving a message to returning UI updates. Keeps App.tsx thin.
 *
 * @see src/services/docs/MessageOrchestrator.md
 */

import type { IAIChatService, AIChatOptions, UserContent } from './aiService';
import type { CalendarEvent } from './calendarService';
import {
  ActionType,
  CalendarQueryType,
  ProcessingStage,
  type OrchestratorInput,
  type OrchestratorResult,
  createEmptyResult,
  determineActionType,
} from '../handlers/messageActions/types';

// Action handlers
import {
  processCalendarAction,
  processNewsAction,
  processSelfieAction,
  parseTaskActionFromResponse,
  detectTaskCompletionFallback,
  type CalendarAction,
  type NewsAction,
  type SelfieAction,
  type TaskAction,
} from '../handlers/messageActions';

// Background services (fire-and-forget)
import { processDetectedFacts } from './memoryService';
import { detectKayleyPresence } from './kayleyPresenceDetector';
import { updateKayleyPresenceState, getDefaultExpirationMinutes } from './kayleyPresenceService';
import { appendConversationHistory } from './conversationHistoryService';

// ============================================================================
// CALENDAR QUERY DETECTION
// ============================================================================

// Keywords that indicate calendar-related queries
const CALENDAR_READ_KEYWORDS = [
  'calendar',
  'schedule',
  'meeting',
  'meetings',
  'event',
  'events',
  'today',
  'tomorrow',
  'appointment',
  'appointments',
  'plan',
  'plans',
];

// Keywords that indicate calendar modification intent
const CALENDAR_WRITE_KEYWORDS = ['delete', 'remove', 'cancel', 'add', 'create', 'schedule'];

/**
 * Detects if a user message is asking about their calendar
 *
 * @param message - The user's message
 * @returns CalendarQueryType indicating READ, WRITE, or NONE
 */
export function detectCalendarQuery(message: string): CalendarQueryType {
  const lower = message.toLowerCase();

  // Check for write operations first (they take priority)
  const hasWriteKeyword = CALENDAR_WRITE_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasWriteKeyword) {
    // "schedule a meeting" is WRITE, but "what's my schedule" is READ
    // Check if it's "schedule" used as a noun vs verb
    if (lower.includes('schedule a') || lower.includes('schedule an')) {
      return CalendarQueryType.WRITE;
    }
    // Other write keywords are always write operations
    if (CALENDAR_WRITE_KEYWORDS.filter((kw) => kw !== 'schedule').some((kw) => lower.includes(kw))) {
      return CalendarQueryType.WRITE;
    }
  }

  // Check for read operations
  const hasReadKeyword = CALENDAR_READ_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasReadKeyword) {
    return CalendarQueryType.READ;
  }

  return CalendarQueryType.NONE;
}

// ============================================================================
// EVENT FORMATTING
// ============================================================================

/**
 * Formats calendar events into a readable string for AI context
 *
 * @param events - Array of calendar events
 * @returns Formatted string with event details including IDs
 */
export function formatEventsForContext(events: CalendarEvent[]): string {
  if (!events || events.length === 0) {
    return '';
  }

  return events
    .map((event) => {
      const start = event.start?.dateTime || event.start?.date || 'No start time';
      const end = event.end?.dateTime || event.end?.date || 'No end time';
      return `- ${event.summary} (ID: ${event.id})\n  Start: ${start}\n  End: ${end}`;
    })
    .join('\n');
}

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
    aiService,
    session,
    accessToken,
    chatHistory,
    upcomingEvents,
    tasks,
    isMuted,
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

    // Detect if this is a calendar query
    const calendarQueryType = detectCalendarQuery(userMessage);
    let calendarContext = "";

    if (calendarQueryType !== CalendarQueryType.NONE) {
      console.log(
        `📅 [Orchestrator] Detected calendar query: ${calendarQueryType}`
      );

      if (upcomingEvents && upcomingEvents.length > 0) {
        calendarContext = formatEventsForContext(upcomingEvents);
        console.log(
          `📅 [Orchestrator] Injected ${upcomingEvents.length} events into context`
        );
      }
    }

    // ========================================================================
    // PHASE 2: AI CALL
    // ========================================================================

    result.stage = ProcessingStage.AI_CALL;
    console.log(`⚡ [Orchestrator] Calling AI service...`);

    // Build message with calendar context if needed
    let textToSend = userMessage;
    if (calendarContext && calendarQueryType === CalendarQueryType.WRITE) {
      textToSend = `${userMessage}\n\n[LIVE CALENDAR DATA - ${upcomingEvents.length} EVENTS:\n${calendarContext}]\n\n⚠️ DELETE REMINDER: Use calendar_action with exact event_id from above.`;
    } else if (calendarContext) {
      textToSend = `${userMessage}\n\n[LIVE CALENDAR DATA - ${upcomingEvents.length} EVENTS:\n${calendarContext}]`;
    }

    // Build input and options for AI service
    const content: UserContent = { type: "text", text: textToSend };
    const options: AIChatOptions = {
      // Pass original message to intent detection (keeps payload small)
      // Intent detection doesn't need calendar data - only main chat does
      originalMessageForIntent: calendarContext ? userMessage : undefined,
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

    // Set refresh flags based on action type
    if (actionType === ActionType.TASK) {
      result.refreshTasks = true;
      result.openTaskPanel = true;
    }

    // ========================================================================
    // PHASE 6: TASK ACTION DETECTION (execution stays in App.tsx)
    // ========================================================================

    // Detect task action from response or fallback detection
    let detectedTask: TaskAction | null | undefined = response.task_action as
      | TaskAction
      | undefined;
    if (!detectedTask && response.text_response) {
      detectedTask = parseTaskActionFromResponse(response.text_response);
    }
    if (!detectedTask) {
      detectedTask = detectTaskCompletionFallback(userMessage, tasks);
    }

    // Pass task action directly to App.tsx
    if (detectedTask) {
      result.detectedTaskAction = detectedTask;
      console.log(
        `📋 [Orchestrator] Detected task action: ${detectedTask.action}`
      );
    }

    // ========================================================================
    // PHASE 4: EXECUTE ACTION HANDLERS
    // ========================================================================

    // Calendar Action
    if (actionType === ActionType.CALENDAR) {
      const calendarAction = response.calendar_action as
        | CalendarAction
        | undefined;
      if (calendarAction?.action && accessToken) {
        const calendarResult = await processCalendarAction(calendarAction, {
          accessToken,
          currentEvents: upcomingEvents,
        });
        if (calendarResult.handled) {
          result.refreshCalendar = true;
          console.log(
            `📅 [Orchestrator] Calendar action executed: ${calendarResult.action}`
          );
        }
      }
    }

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

    // ========================================================================
    // PHASE 4: POST-PROCESSING (Fire-and-forget)
    // ========================================================================

    result.stage = ProcessingStage.POSTPROCESSING;
    const intent = aiResult.intent;

    // User facts detection has been removed from intent detection to reduce payload size
    // Facts can be stored via the store_user_info tool in the main chat instead

    // Character facts are now stored exclusively via the store_self_info LLM tool
    // Pattern-based detection has been removed in favor of LLM semantic understanding

    // Background presence detection - don't await
    detectKayleyPresence(response.text_response, userMessage)
      .then((presence) => {
        if (presence && presence.confidence > 0.7) {
          console.log(
            `👁️ [Orchestrator] Detected presence: ${presence.activity}`
          );
          const expirationMinutes = getDefaultExpirationMinutes(
            presence.activity,
            presence.outfit
          );
          updateKayleyPresenceState({
            outfit: presence.outfit,
            mood: presence.mood,
            activity: presence.activity,
            location: presence.location,
            expirationMinutes,
            confidence: presence.confidence,
          }).catch((err) =>
            console.error("❌ [Orchestrator] Failed to update presence:", err)
          );
        }
      })
      .catch((err) =>
        console.error("❌ [Orchestrator] Failed to detect presence:", err)
      );

    // Background conversation history - don't await
    const historyMessages = [
      { role: "user" as const, text: userMessage },
      { role: "model" as const, text: response.text_response },
    ];
    appendConversationHistory(
      historyMessages,
      aiResult.session?.interactionId
    ).catch((err) =>
      console.error("❌ [Orchestrator] Failed to append history:", err)
    );

    // ========================================================================
    // PHASE 5: BUILD RESULT
    // ========================================================================

    result.stage = ProcessingStage.COMPLETE;
    result.success = true;

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

    // Action playback
    if (response.action_id) {
      result.actionToPlay = response.action_id;
    }

    // App opening
    if (response.open_app) {
      result.appToOpen = response.open_app;
    }

    // Session
    result.updatedSession = aiResult.session;

    // Raw response for action routing in App.tsx
    result.rawResponse = response;
    result.intent = intent;

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
