import { ChatMessage, CharacterProfile } from '../types';
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
      audioData?: string; // URL to blob or base64 audio data
  }>;

  generateGreeting(
    character: CharacterProfile,
    session?: AIChatSession,
    chatHistory?: ChatMessage[],
    relationship?: RelationshipMetrics | null
  ): Promise<{ 
      greeting: AIActionResponse; 
      session: AIChatSession;
      audioData?: string; // URL to blob or base64 audio data
  }>;
}
