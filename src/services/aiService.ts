import { ChatMessage, CharacterProfile } from '../types';
import { RelationshipMetrics } from './relationshipService';
import { AIActionResponse } from './aiSchema';

// Define what a user can send (Text OR Audio)
export type UserContent = 
  | { type: 'text'; text: string }
  | { type: 'audio'; data: string; mimeType: string }; // data is base64

export interface AIChatOptions {
  character?: CharacterProfile;
  chatHistory?: ChatMessage[];
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[];
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
  generateResponse(
    input: UserContent,
    options: AIChatOptions,
    session?: AIChatSession
  ): Promise<{ 
      response: AIActionResponse; 
      session: AIChatSession;
      audioData?: string; // Base64 audio data
  }>;

  generateGreeting(
    character: CharacterProfile,
    session?: AIChatSession,
    chatHistory?: ChatMessage[],
    relationship?: RelationshipMetrics | null
  ): Promise<{ 
      greeting: AIActionResponse; 
      session: AIChatSession;
      audioData?: string; // Base64 audio data
  }>;
}