import { IAIChatService, AIChatOptions, UserContent, AIChatSession, AIMessage } from './aiService';
import { buildSystemPrompt } from './promptUtils';
import { generateSpeech } from './elevenLabsService';
import { AIActionResponse } from './aiSchema';
import { analyzeUserMessageBackground } from './messageAnalyzer';

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

      // Analyze user message for patterns, milestones, and open loops (non-blocking)
      // This powers the Phase 1-5 "magic" systems
      const userMessageText = 'text' in input ? input.text : '';
      if (userMessageText && updatedSession?.userId) {
        const interactionCount = options.chatHistory?.length || 0;
        analyzeUserMessageBackground(updatedSession.userId, userMessageText, interactionCount);
      }

      const audioMode = options.audioMode ?? 'sync';

      // Shared: Voice Generation
      // Note: Some providers might return user_transcription which we might want to use,
      // but generateSpeech usually takes the AI's text response.
      if (audioMode === 'none') {
        return {
          response: aiResponse,
          session: updatedSession,
        };
      }

      if (audioMode === 'async') {
        const WB_DEBUG =
          typeof window !== 'undefined' &&
          window.localStorage?.getItem('debug:whiteboard') === '1';
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

        // Fire-and-forget TTS so UI can react immediately (e.g. start drawing).
        generateSpeech(aiResponse.text_response)
          .then((audioData) => {
            if (WB_DEBUG) {
              const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
              console.log('🔊 [BaseAIService] async TTS done', { dtMs: Math.round(t1 - t0), hasAudio: !!audioData });
            }
            if (audioData) options.onAudioData?.(audioData);
          })
          .catch((err) => {
            if (WB_DEBUG) console.warn('🔊 [BaseAIService] async TTS failed', err);
          });

        return {
          response: aiResponse,
          session: updatedSession,
        };
      }

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
    relationship: any,
    characterContext?: string
  ): Promise<any>;
}

