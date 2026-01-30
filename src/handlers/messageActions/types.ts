// src/handlers/messageActions/types.ts

/**
 * Shared Types for Message Action Handlers
 *
 * Contains enums and interfaces used across all action handlers
 * and the message orchestrator service.
 *
 * IMPORTANT: Use enums instead of magic strings!
 */

import type { ChatMessage, Task } from '../../types';
import type { CalendarEvent } from '../../services/calendarService';
import type { IAIChatService, AIChatSession } from '../../services/aiService';
import type { FullMessageIntent } from '../../services/intentService';
import type { AIActionResponse } from '../../services/aiSchema';
import type { TaskAction } from '../messageActions/taskActions';

// ============================================================================
// ENUMS (No magic strings!)
// ============================================================================

/**
 * Types of actions that can be triggered by AI responses
 */
export enum ActionType {
  TASK = 'task',
  CALENDAR = 'calendar',
  NEWS = 'news',
  SELFIE = 'selfie',
  VIDEO = 'video',
  NONE = 'none',
}

/**
 * Types of calendar queries detected in user messages
 */
export enum CalendarQueryType {
  /** No calendar-related query */
  NONE = 'none',
  /** Reading calendar (e.g., "What's on my calendar?") */
  READ = 'read',
  /** Modifying calendar (e.g., "Add meeting", "Delete event") */
  WRITE = 'write',
}

/**
 * Stages of message processing (for logging/debugging)
 */
export enum ProcessingStage {
  /** Initial setup and validation */
  PREPROCESSING = 'preprocessing',
  /** Calling the AI service */
  AI_CALL = 'ai_call',
  /** Routing to action handlers */
  ACTION_ROUTING = 'action_routing',
  /** Background processing (facts, presence) */
  POSTPROCESSING = 'postprocessing',
  /** Successfully completed */
  COMPLETE = 'complete',
  /** Failed with error */
  ERROR = 'error',
}

// ============================================================================
// ORCHESTRATOR INTERFACES
// ============================================================================

/**
 * Input to the message orchestrator
 */
export interface OrchestratorInput {
  /** The user's message text */
  userMessage: string;

  /** AI service instance to use */
  aiService: IAIChatService;

  /** Current AI session (may be null for first message) */
  session: AIChatSession | null;

  /** Google OAuth access token for calendar/email */
  accessToken?: string;

  /** Current chat history for context */
  chatHistory: ChatMessage[];

  /** Current calendar events (may be refreshed) */
  upcomingEvents: CalendarEvent[];

  /** Current task list */
  tasks: Task[];

  /** Whether audio is muted */
  isMuted: boolean;
}

/**
 * Result from the message orchestrator
 * Contains everything needed to update the UI
 */
export interface OrchestratorResult {
  // ---- Status ----
  /** Whether processing completed successfully */
  success: boolean;

  /** What type of action was processed */
  actionType: ActionType;

  /** Which stage completed (for debugging) */
  stage: ProcessingStage;

  // ---- Chat Updates ----
  /** Messages to add to chat history */
  chatMessages: ChatMessage[];

  // ---- Media ----
  /** Base64 audio to play (if any) */
  audioToPlay?: string;

  /** Action ID to play (if any) */
  actionToPlay?: string;

  // ---- Navigation ----
  /** URL to open (if any) */
  appToOpen?: string;

  // ---- State Refresh Flags ----
  /** Should refresh calendar events */
  refreshCalendar: boolean;

  /** Should refresh task list */
  refreshTasks: boolean;

  /** Should open task panel */
  openTaskPanel: boolean;

  // ---- Session ----
  /** Updated AI session (if changed) */
  updatedSession?: AIChatSession;

  /** Updated calendar events (if refreshed) */
  updatedEvents?: CalendarEvent[];

  // ---- Error ----
  /** Error message (if failed) */
  error?: string;

  // ---- Raw Response (for action routing) ----
  /** Raw AI response for App.tsx to route to action handlers */
  rawResponse?: AIActionResponse;

  /** Intent from the AI response (for sentiment analysis) */
  intent?: FullMessageIntent;

  // ---- Action-Specific Results (Phase 4) ----

  /** Selfie image result (if selfie action succeeded) */
  selfieImage?: {
    base64: string;
    mimeType: string;
  };

  /** Selfie error message (if selfie action failed) */
  selfieError?: string;

  /** Selfie message text for TTS (Phase 5) */
  selfieMessageText?: string;

  /** Video URL result (if video action succeeded) */
  videoUrl?: string;

  /** Video error message (if video action failed) */
  videoError?: string;

  /** Video message text for TTS */
  videoMessageText?: string;

  /** News prompt for system message (if news action succeeded) */
  newsPrompt?: string;

  /** Detected task action for App.tsx to execute (Phase 6) */
  detectedTaskAction?: TaskAction;
}

// ============================================================================
// ACTION HANDLER INTERFACES
// ============================================================================

/**
 * Standardized result from any action handler
 */
export interface ActionHandlerResult {
  /** Whether this handler processed the action */
  handled: boolean;

  /** Whether processing succeeded (only relevant if handled=true) */
  success: boolean;

  /** Messages to add to chat */
  chatMessages: ChatMessage[];

  /** Audio to play */
  audioToPlay?: string;

  /** Should refresh calendar */
  refreshCalendar?: boolean;

  /** Should refresh tasks */
  refreshTasks?: boolean;

  /** Should open task panel */
  openTaskPanel?: boolean;

  /** Error message (if failed) */
  error?: string;
}

/**
 * Context passed to action handlers
 */
export interface ActionContext {
  /** Original user message */
  userMessage: string;

  /** Current chat history */
  chatHistory: ChatMessage[];

  /** Current calendar events */
  upcomingEvents: CalendarEvent[];

  /** Current tasks */
  tasks: Task[];

  /** Google access token */
  accessToken?: string;

  /** Whether audio is muted */
  isMuted: boolean;

  /** Intent analysis from AI */
  intent?: FullMessageIntent;
}

// ============================================================================
// HELPER TYPE GUARDS
// ============================================================================

/**
 * Check if a value is a valid ActionType
 */
export function isValidActionType(value: string): value is ActionType {
  return Object.values(ActionType).includes(value as ActionType);
}

/**
 * Check if a value is a valid CalendarQueryType
 */
export function isValidCalendarQueryType(value: string): value is CalendarQueryType {
  return Object.values(CalendarQueryType).includes(value as CalendarQueryType);
}

/**
 * Check if a value is a valid ProcessingStage
 */
export function isValidProcessingStage(value: string): value is ProcessingStage {
  return Object.values(ProcessingStage).includes(value as ProcessingStage);
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a default (empty) orchestrator result
 */
export function createEmptyResult(stage: ProcessingStage = ProcessingStage.PREPROCESSING): OrchestratorResult {
  return {
    success: false,
    actionType: ActionType.NONE,
    stage,
    chatMessages: [],
    refreshCalendar: false,
    refreshTasks: false,
    openTaskPanel: false,
  };
}

/**
 * Create a success result with a single chat message
 */
export function createSuccessResult(
  textResponse: string,
  actionType: ActionType = ActionType.NONE
): OrchestratorResult {
  return {
    success: true,
    actionType,
    stage: ProcessingStage.COMPLETE,
    chatMessages: [{ role: 'model', text: textResponse }],
    refreshCalendar: false,
    refreshTasks: false,
    openTaskPanel: false,
  };
}

/**
 * Create an error result
 */
export function createErrorResult(error: string, stage: ProcessingStage = ProcessingStage.ERROR): OrchestratorResult {
  return {
    success: false,
    actionType: ActionType.NONE,
    stage,
    chatMessages: [],
    refreshCalendar: false,
    refreshTasks: false,
    openTaskPanel: false,
    error,
  };
}

/**
 * Create a default action handler result (not handled)
 */
export function createUnhandledResult(): ActionHandlerResult {
  return {
    handled: false,
    success: false,
    chatMessages: [],
  };
}

/**
 * Determine action type from AI response
 */
export function determineActionType(response: AIActionResponse): ActionType {
  if (response.task_action) return ActionType.TASK;
  if (response.calendar_action) return ActionType.CALENDAR;
  if (response.news_action) return ActionType.NEWS;
  if (response.selfie_action) return ActionType.SELFIE;
  if ((response as any).video_action) return ActionType.VIDEO;
  return ActionType.NONE;
}
