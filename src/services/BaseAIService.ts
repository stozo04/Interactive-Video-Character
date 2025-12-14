import { IAIChatService, AIChatOptions, UserContent, AIChatSession, AIMessage } from './aiService';
import { buildSystemPrompt } from './promptUtils';
import { generateSpeech } from './elevenLabsService';
import { AIActionResponse } from './aiSchema';
import { analyzeUserMessageBackground } from './messageAnalyzer';
import { detectFullIntentLLMCached, type FullMessageIntent } from './intentService';
import { updateEmotionalMomentumWithIntensity } from './moodKnobs';

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
      // 2. Pre-calculate Unified Intent (if input is text)
      // This allows us to react INSTANTLY to genuine moments in the prompt
      let preCalculatedIntent: FullMessageIntent | undefined;
      const userMessageText = 'text' in input ? input.text : '';
      
      // We need interaction count early for context building
      const interactionCount = options.chatHistory?.length || 0;
      
      // Build conversation context early
      const conversationContext = userMessageText ? {
        recentMessages: (options.chatHistory || []).slice(-5).map((msg: any) => ({
          role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
          text: typeof msg.content === 'string' ? msg.content : 
                (msg.content?.text || msg.text || JSON.stringify(msg.content))
        }))
      } : undefined;

      if (userMessageText && userMessageText.length > 5) {
        try {
          // Fire the unified intention detection BEFORE generating response
          // This is the "brain" kicking in first
          preCalculatedIntent = await detectFullIntentLLMCached(userMessageText, conversationContext);
          
          if (preCalculatedIntent?.genuineMoment?.isGenuine) {
             // CRITICAL: Instant mood shift!
             // Update the mood stats immediately so buildSystemPrompt sees the fresh mood
             // We pass 'genuineMomentOverride' to avoid re-detecting
             const genuineMomentResult = {
               isGenuine: true,
               category: preCalculatedIntent.genuineMoment.category,
               matchedKeywords: ["LLM Instant Detection"],
               isPositiveAffirmation: true // implied
             };
             
             // Update momentum state now (sync-ish)
             updateEmotionalMomentumWithIntensity(
               preCalculatedIntent.tone.sentiment, 
               preCalculatedIntent.tone.intensity, 
               userMessageText,
               genuineMomentResult as any // Cast safely
             );
             console.log('⚡ [BaseAIService] Instant genuine moment reaction triggered!');
          }
        } catch (e) {
          console.warn('[BaseAIService] Pre-calculation of intent failed:', e);
        }
      }

      // Shared: Build Prompts (now reflects updated mood if genuine!)
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
      // Phase 1: Now includes conversation context for LLM-based intent detection
      // Context is already built above
      
      if (userMessageText && updatedSession?.userId) {
        analyzeUserMessageBackground(
          updatedSession.userId, 
          userMessageText, 
          interactionCount,
          conversationContext,
          preCalculatedIntent // Pass the already-computed intent to save time/cost
        );
      }

      const audioMode = options.audioMode ?? 'sync';

      // Shared: Voice Generation
      // Note: Some providers might return user_transcription which we might want to use,
      // but generateSpeech usually takes the AI's text response.
      if (audioMode === 'none') {
        return {
          response: aiResponse,
          session: updatedSession,
          intent: preCalculatedIntent,
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
          intent: preCalculatedIntent,
        };
      }

      const audioData = await generateSpeech(aiResponse.text_response);

      return {
        response: aiResponse,
        session: updatedSession,
        audioData,
        intent: preCalculatedIntent
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

