import { IAIChatService, AIChatOptions, UserContent, AIChatSession, AIMessage } from './aiService';
import { buildSystemPrompt } from './promptUtils';
import { generateSpeech } from './elevenLabsService';
import { AIActionResponse } from './aiSchema';

export abstract class BaseAIService implements IAIChatService {
  abstract model: string;
  
  // 1. Abstract method: The only thing that changes per service
  protected abstract callProvider(
    systemPrompt: string, 
    userMessage: UserContent, 
    history: any[],
    session?: AIChatSession
  ): Promise<{ response: AIActionResponse, session: AIChatSession }>; // Returns structured JSON response and updated session

  // 2. Shared Logic
  async generateResponse(input: UserContent, options: AIChatOptions, session?: AIChatSession) {
    try {
      // Shared: Build Prompts
      const systemPrompt = buildSystemPrompt(
        options.character, 
        options.relationship, 
        options.upcomingEvents,
        options.characterContext,
        options.tasks
      );
      
      // Debug: Log calendar events being sent to AI
      console.log(`📅 [BaseAIService] Building prompt with ${options.upcomingEvents?.length || 0} events:`,
        options.upcomingEvents?.map(e => e.summary) || []
      );
      
      // Call the specific provider
      const { response: aiResponse, session: updatedSession } = await this.callProvider(
        systemPrompt, 
        input, 
        options.chatHistory || [],
        session
      );

      // Shared: Voice Generation
      // Note: Some providers might return user_transcription which we might want to use, 
      // but generateSpeech usually takes the AI's text response.
      const audioData = await generateSpeech(aiResponse.text_response);

      return {
        response: aiResponse,
        session: updatedSession,
        audioData
      };
    } catch (error) {
      console.error("AI Service Error:", error);
      throw error;
    }
  }
  
  abstract generateGreeting(
    character: any, 
    session: any, 
    previousHistory: any, 
    relationship: any,
    characterContext?: string
  ): Promise<any>;
}

