import { ChatMessage, CharacterProfile, Task } from '../types';
import { RelationshipMetrics } from './relationshipService';
import { AIActionResponse } from './aiSchema';

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
  previousResponseId?: string; 
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
  }>;
}
