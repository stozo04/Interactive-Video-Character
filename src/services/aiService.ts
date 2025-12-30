import { ChatMessage, CharacterProfile, Task } from '../types';
import { RelationshipMetrics } from './relationshipService';
import { AIActionResponse } from './aiSchema';

import { FullMessageIntent } from './intentService';

// Define what a user can send (Text OR Audio OR Image with Text)
export type UserContent = 
  | { type: 'text'; text: string }
  | { type: 'audio'; data: string; mimeType: string } // data is base64
  | { type: 'image_text'; text: string; imageData: string; mimeType: string };

export interface AIChatOptions {
  character?: CharacterProfile;
  chatHistory?: ChatMessage[];
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[];
  characterContext?: string; // What the character is "doing" right now
  tasks?: Task[]; // User's daily checklist tasks
  googleAccessToken?: string; // Google OAuth access token for calendar operations
  /**
   * Audio generation behavior for this request.
   * - sync (default): wait for TTS before returning
   * - async: return response immediately; generate TTS in background and call onAudioData
   * - none: do not generate audio
   */
  audioMode?: 'sync' | 'async' | 'none';
  /**
   * Only used when audioMode === 'async'. Called when audio is ready.
   */
  onAudioData?: (audioData: string) => void;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'model';
  content: string;
}

export interface AIChatSession {
  userId: string;
  model?: string;
  previousResponseId?: string; // Used by ChatGPT/Grok for stateful conversations
  interactionId?: string; // Used by Gemini Interactions API for stateful conversations
  geminiHistory?: any[]; 
}

// Update return types to include optional audioData
export interface IAIChatService {
  model: string; // Added model property
  generateResponse(
    input: UserContent,
    options: AIChatOptions,
    session?: AIChatSession
  ): Promise<{ 
      response: AIActionResponse; 
      session: AIChatSession;
      audioData?: string; // URL to blob or base64 audio data
      intent?: FullMessageIntent; // Phase 7: Start returning the "brain's" intent from analysis
  }>;

  generateGreeting(
    character: CharacterProfile,
    session?: AIChatSession,
    relationship?: RelationshipMetrics | null,
    characterContext?: string
  ): Promise<{ 
    greeting: AIActionResponse; 
    session: AIChatSession;
    audioData?: string; // URL to blob or base64 audio data
    intent?: FullMessageIntent;
  }>;

  generateNonGreeting(
    character: CharacterProfile,
    session?: AIChatSession,
    relationship?: RelationshipMetrics | null,
    characterContext?: string
  ): Promise<{ 
    greeting: AIActionResponse; 
    session: AIChatSession;
    audioData?: string;
    intent?: FullMessageIntent;
  }>;

  triggerIdleBreaker?(
    userId: string,
    options: {
      character?: CharacterProfile;
      relationship?: RelationshipMetrics | null;
      tasks?: any[];
      chatHistory?: any[];
      characterContext?: string;
      upcomingEvents?: any[];
      proactiveSettings?: {
        checkins?: boolean;
        news?: boolean;
      };
    },
    session?: AIChatSession
  ): Promise<{ 
    response: AIActionResponse; 
    session: AIChatSession; 
    audioData?: string;
  } | null>;
}
