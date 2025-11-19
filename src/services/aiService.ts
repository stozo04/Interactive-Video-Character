// src/services/aiService.ts
import { ChatMessage, CharacterProfile } from '../types';
import { RelationshipMetrics } from './relationshipService';
import { AIActionResponse } from './aiSchema';

export type UserContent = 
  | { type: 'text'; text: string }
  | { type: 'audio'; data: string; mimeType: string }; // data is base64

export interface AIChatOptions {
  character?: CharacterProfile;
  chatHistory?: ChatMessage[];
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[];
}

// Abstract AIMessage helper
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// A unified session object that can hold state for either provider
export interface AIChatSession {
  userId: string;
  model: string;  
  // Grok specific
  previousResponseId?: string;  
  // Gemini specific (optional, usually managed by startChat but good to have if needed)
  geminiHistory?: any[]; 
}

export interface IAIChatService {
  generateResponse(
    message: UserContent,
    options: AIChatOptions,
    session?: AIChatSession
  ): Promise<{ response: AIActionResponse; session: AIChatSession }>;

  generateGreeting(
    character: CharacterProfile,
    session?: AIChatSession,
    chatHistory?: ChatMessage[],
    relationship?: RelationshipMetrics | null
  ): Promise<{ greeting: AIActionResponse; session: AIChatSession }>;
}