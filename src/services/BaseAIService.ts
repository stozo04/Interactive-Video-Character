import { IAIChatService, AIChatOptions, UserContent, AIChatSession, AIMessage } from './aiService';
import { buildSystemPrompt } from './promptUtils';
import { generateSpeech } from './elevenLabsService';
import { AIActionResponse } from './aiSchema';
import { analyzeUserMessageBackground } from './messageAnalyzer';
import { detectFullIntentLLMCached, isFunctionalCommand, type FullMessageIntent } from './intentService';
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

      // ============================================
      // COMMAND BYPASS: Fast Path for Utility Commands
      // ============================================
      // For commands like "add task...", we skip the ~2s blocking intent 
      // analysis. The Main LLM is smart enough to handle task creation.
      // Intent detection still runs in background for memory/analytics.
      // This cuts latency from ~3.8s to ~1.8s for commands.
      
      const trimmedMessage = userMessageText?.trim() || '';
      const isCommand = trimmedMessage && isFunctionalCommand(trimmedMessage);
      let intentPromise: Promise<FullMessageIntent> | undefined;

      if (trimmedMessage && trimmedMessage.length > 5) {
        // 1. ALWAYS kick off intent detection (for memory, analytics, patterns)
        intentPromise = detectFullIntentLLMCached(trimmedMessage, conversationContext);
        
        if (isCommand) {
          // 🚀 FAST PATH: Don't wait! The Main LLM handles commands directly.
          console.log('⚡ [BaseAIService] Command detected - skipping blocking intent analysis');
          // Intent runs in background, we'll still record it for memory below
        } else {
          // 🐢 NORMAL PATH: Wait for intent (needed for empathy/conversation)
          try {
            preCalculatedIntent = await intentPromise;
            
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
      }

      // Shared: Build Prompts (now reflects updated mood if genuine!)
      // Pass the FULL semantic intent to inform response style dynamically
      const systemPrompt = buildSystemPrompt(
        options.character, 
        options.relationship, 
        options.upcomingEvents,
        options.characterContext,
        options.tasks,
        preCalculatedIntent?.relationshipSignals,
        preCalculatedIntent?.tone,
        preCalculatedIntent // Pass the entire FullMessageIntent
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
        if (preCalculatedIntent) {
          // NORMAL PATH: We already have the intent, pass it directly
          analyzeUserMessageBackground(
            updatedSession.userId, 
            userMessageText, 
            interactionCount,
            conversationContext,
            preCalculatedIntent
          );
        } else if (intentPromise) {
          // COMMAND BYPASS PATH: Intent is still resolving, wait for it in background
          // This ensures memory/patterns are STILL recorded, just not blocking the response
          intentPromise.then(resolvedIntent => {
            if (resolvedIntent) {
              analyzeUserMessageBackground(
                updatedSession.userId, 
                userMessageText, 
                interactionCount,
                conversationContext,
                resolvedIntent
              );
              console.log('📝 [BaseAIService] Background intent analysis completed for command');
            }
          }).catch(err => {
            console.warn('[BaseAIService] Background intent resolution failed:', err);
            // Still run analysis without intent as fallback
            analyzeUserMessageBackground(
              updatedSession.userId, 
              userMessageText, 
              interactionCount,
              conversationContext,
              undefined
            );
          });
        }
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

