import { ChatMessage } from '../types';
import { AIActionResponse } from './aiSchema';
import { FullMessageIntent } from './intentService';

// Define what a user can send (Text OR Audio OR Image with Text)
export type UserContent =
  | { type: 'text'; text: string }
  | { type: 'audio'; data: string; mimeType: string } // data is base64
  | { type: 'image_text'; text: string; imageData: string; mimeType: string };

/**
 * Options for AI chat requests.
 *
 * ARCHITECTURE NOTE: The service fetches all context internally using VITE_USER_ID.
 * This is a single-user app - no userId parameter needed.
 */
export interface AIChatOptions {
  /**
   * Current session chat history (for display and context).
   */
  chatHistory?: ChatMessage[];

  /**
   * Google OAuth access token for calendar/email operations.
   */
  googleAccessToken?: string;

  /**
   * Audio generation behavior for this request.
   * - sync (default): wait for TTS before returning
   * - async: return response immediately; generate TTS in background and call onAudioData
   * - none: do not generate audio
   */
  audioMode?: 'sync' | 'async' | 'none';

  /**
   * Original user message (before enrichment with calendar/email data).
   * Used for intent detection to keep payload small.
   * If not provided, falls back to using the main input message.
   */
  originalMessageForIntent?: string;

  /**
   * Only used when audioMode === 'async'. Called when audio is ready.
   */
  onAudioData?: (audioData: string) => void;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'model';
  content: string;
}

/**
 * Session state for AI conversations.
 * Uses VITE_USER_ID internally - no userId field needed.
 */
export interface AIChatSession {
  model?: string;
  interactionId?: string; // Used by Gemini Interactions API for stateful conversations
}

// Update return types to include optional audioData
export interface IAIChatService {
  model: string;

  generateResponse(
    input: UserContent,
    options: AIChatOptions,
    session?: AIChatSession,
  ): Promise<{
    response: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
    intent?: FullMessageIntent;
  }>;

  generateGreeting(googleAccessToken: string): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }>;

  generateNonGreeting(session: AIChatSession, googleAccessToken: string): Promise<{
    greeting: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  }>;

  /**
   * Triggered when the user has been idle. Decides whether to ask about
   * an open loop or share a proactive thought.
   */
  triggerIdleBreaker?(
    options: {
      chatHistory?: any[];
      googleAccessToken?: string;
      proactiveSettings?: {
        checkins?: boolean;
        news?: boolean;
        calendar?: boolean;
      };
    },
    session?: AIChatSession,
  ): Promise<{
    response: AIActionResponse;
    session: AIChatSession;
    audioData?: string;
  } | null>;
}
