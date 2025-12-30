import { IAIChatService, AIChatOptions, UserContent, AIChatSession, AIMessage } from './aiService';
import { buildSystemPrompt, buildProactiveThreadPrompt, getSoulLayerContextAsync } from './promptUtils';
import { formatCharacterFactsForPrompt } from './characterFactsService';
import { generateSpeech } from './elevenLabsService';
import { AIActionResponse } from './aiSchema';
import { analyzeUserMessageBackground } from './messageAnalyzer';
import { detectFullIntentLLMCached, isFunctionalCommand, type FullMessageIntent } from './intentService';
import { recordInteractionAsync } from './moodKnobs';
import { getOngoingThreadsAsync, selectProactiveThread, markThreadMentionedAsync } from './ongoingThreads';
import { getTopLoopToSurface, markLoopSurfaced } from './presenceDirector';
import { storeCharacterFact } from './characterFactsService';
import { getPrefetchedContext, prefetchOnIdle } from './prefetchService';
import { detectAndMarkSharedThoughts } from './spontaneity/idleThoughts';
import type { CharacterProfile, Task } from '../types';
import type { RelationshipMetrics } from './relationshipService';
import {
  getUnsaidFeelings,
  calculateStage,
  recordAlmostMoment,
  generateAlmostExpression
} from './almostMomentsService';

/**
 * Guardrail: Check if text_response is valid for TTS.
 * Rejects empty strings, "{}", "null", or single-character responses.
 * This prevents 400 errors from ElevenLabs when AI returns malformed output after tool use.
 */
function isValidTextForTTS(text: string | undefined | null): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  // Reject empty, JSON artifacts, or too-short responses
  if (trimmed.length < 2) return false;
  if (trimmed === '{}' || trimmed === 'null' || trimmed === '[]') return false;
  // Check for mostly punctuation/whitespace (invalid speech)
  const alphanumericChars = trimmed.replace(/[^a-zA-Z0-9]/g, '').length;
  if (alphanumericChars < 2) return false;
  return true;
}

/**
 * Pre-fetch context data in parallel with intent detection.
 * This is an optimization to avoid waiting for intent before starting context fetch.
 * 
 * @param userId - The user's ID for fetching their specific context
 * @returns Promise that resolves to the pre-fetched context
 */
async function prefetchContext(userId: string): Promise<{
  soulContext: Awaited<ReturnType<typeof getSoulLayerContextAsync>>;
  characterFacts: string;
}> {
  const [soulContext, characterFacts] = await Promise.all([
    getSoulLayerContextAsync(userId),
    formatCharacterFactsForPrompt()
  ]);
  
  return { soulContext, characterFacts };
}

/**
 * Log when the LLM uses an almost moment expression.
 * Now uses explicit schema field instead of pattern matching for accurate tracking.
 */
async function logAlmostMomentIfUsed(
  userId: string,
  aiResponse: AIActionResponse
): Promise<void> {
  // Check if LLM explicitly reported using an almost moment
  if (!aiResponse.almost_moment_used) return;

  const { feeling_id, stage, expression_used } = aiResponse.almost_moment_used;

  await recordAlmostMoment(
    userId,
    feeling_id,
    stage,
    expression_used,
    "llm_confirmed_usage"
  );

  console.log(`[AlmostMoments] Logged: ${stage} - "${expression_used.substring(0, 50)}..."`);
}

export abstract class BaseAIService implements IAIChatService {
  abstract model: string;
  
  // 1. Abstract method: The only thing that changes per service
  protected abstract callProvider(
    systemPrompt: string, 
    userMessage: UserContent, 
    history: any[],
    session?: AIChatSession,
    options?: AIChatOptions
  ): Promise<{ response: AIActionResponse, session: AIChatSession }>; // Returns structured JSON response and updated session

  // 2. Shared Logic
  async generateResponse(input: UserContent, options: AIChatOptions, session?: AIChatSession) {
    try {
      // 2. Pre-calculate Unified Intent (if input is text)
      // This allows us to react INSTANTLY to genuine moments in the prompt
      let preCalculatedIntent: FullMessageIntent | undefined;
      const userMessageText = 'text' in input ? input.text : '';
      console.log("userMessageText: ", userMessageText);
      // We need interaction count early for context building
      const interactionCount = options.chatHistory?.length || 0;
      console.log("interactionCount: ", interactionCount);
      // Build conversation context early
      const conversationContext = userMessageText
        ? {
            recentMessages: (options.chatHistory || [])
              .slice(-5)
              .map((msg: any) => ({
                role:
                  msg.role === "user"
                    ? ("user" as const)
                    : ("assistant" as const),
                text:
                  typeof msg.content === "string"
                    ? msg.content
                    : msg.content?.text ||
                      msg.text ||
                      JSON.stringify(msg.content),
              })),
          }
        : undefined;

      console.log("conversationContext: ", conversationContext);
      // ============================================
      // COMMAND BYPASS: Fast Path for Utility Commands
      // ============================================
      // For commands like "add task...", we skip the ~2s blocking intent
      // analysis. The Main LLM is smart enough to handle task creation.
      // Intent detection still runs in background for memory/analytics.
      // This cuts latency from ~3.8s to ~1.8s for commands.

      const trimmedMessage = userMessageText?.trim() || "";
      const isCommand = trimmedMessage && isFunctionalCommand(trimmedMessage);
      console.log("isCommand: ", isCommand);
      let intentPromise: Promise<FullMessageIntent> | undefined;

      // ============================================
      // OPTIMIZATION: Parallel Intent + Context Fetch
      // ============================================
      // Start context prefetch IMMEDIATELY alongside intent detection
      // This saves ~300ms by not waiting for intent before fetching context

      const effectiveUserId = session?.userId || import.meta.env.VITE_USER_ID;
      let contextPrefetchPromise: Promise<{
        soulContext: Awaited<ReturnType<typeof getSoulLayerContextAsync>>;
        characterFacts: string;
      }> | undefined;

      // 🚀 CHECK GLOBAL PREFETCH CACHE FIRST (Idle optimization)
      const cachedContext = getPrefetchedContext();
      let prefetchedContext: {
        soulContext: Awaited<ReturnType<typeof getSoulLayerContextAsync>>;
        characterFacts: string;
      } | undefined = cachedContext ? {
        soulContext: cachedContext.soulContext,
        characterFacts: cachedContext.characterFacts
      } : undefined;

      // 🚀 START CONTEXT PREFETCH EARLY (runs in parallel with intent) if not already cached
      if (effectiveUserId && !prefetchedContext) {
        contextPrefetchPromise = prefetchContext(effectiveUserId);
        console.log('🚀 [BaseAIService] Started context prefetch in parallel');
      } else if (prefetchedContext) {
        console.log('✅ [BaseAIService] Using context from idle pre-fetch cache');
      }

      if (trimmedMessage && trimmedMessage.length > 5) {
        // 1. ALWAYS kick off intent detection (for memory, analytics, patterns)
        intentPromise = detectFullIntentLLMCached(trimmedMessage, conversationContext);
        console.log("intentPromise initialized: ", intentPromise);
        
        if (isCommand) {
          // 🚀 FAST PATH: Don't wait! The Main LLM handles commands directly.
          console.log('⚡ [BaseAIService] Command detected - skipping blocking intent analysis');
          // Intent runs in background, we'll still record it for memory below
        } else {
          // 🐢 NORMAL PATH: Wait for intent (needed for empathy/conversation)
          try {
            preCalculatedIntent = await intentPromise;
            console.log("preCalculatedIntent: ", preCalculatedIntent);
            
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
               
               // Update mood state now using simplified recordInteractionAsync
               const targetUserId = session?.userId || import.meta.env.VITE_USER_ID;
               await recordInteractionAsync(
                 targetUserId,
                 preCalculatedIntent.tone,  // Pass full ToneIntent
                 userMessageText,
                 genuineMomentResult as any
               );
               console.log('⚡ [BaseAIService] Instant genuine moment reaction triggered!');
            }
          } catch (e) {
            console.warn('[BaseAIService] Pre-calculation of intent failed:', e);
          }
        }
      }

      // 🚀 OPTIMIZATION: Wait for prefetched context (should already be ready!)
      if (contextPrefetchPromise) {
        try {
          prefetchedContext = await contextPrefetchPromise;
          console.log('✅ [BaseAIService] Context prefetch completed');
        } catch (e) {
          console.warn('[BaseAIService] Context prefetch failed, will fetch in buildSystemPrompt:', e);
        }
      }

      // Shared: Build Prompts (now reflects updated mood if genuine!)
      // Pass the FULL semantic intent to inform response style dynamically
      const systemPrompt = await buildSystemPrompt(
        options.character, 
        options.relationship, 
        options.upcomingEvents,
        options.characterContext,
        options.tasks,
        preCalculatedIntent?.relationshipSignals,
        preCalculatedIntent?.tone,
        preCalculatedIntent, // Pass the entire FullMessageIntent
        session?.userId || import.meta.env.VITE_USER_ID, // Pass userId for async state retrieval
        undefined, // userTimeZone - defaults to 'America/Chicago'
        prefetchedContext // 🚀 PASS PREFETCHED CONTEXT
      );
      //console.log("systemPrompt built: ", systemPrompt);
      
      // Debug: Log calendar events being sent to AI
      // console.log(`📅 [BaseAIService] Building prompt with ${options.upcomingEvents?.length || 0} events:`,
      //   options.upcomingEvents?.map(e => e.summary) || []
      // );
      
      // Call the specific provider
      const { response: aiResponse, session: updatedSession } = await this.callProvider(
        systemPrompt,
        input,
        options.chatHistory || [],
        session,
        options
      );

      const loggingUserId = updatedSession?.userId || session?.userId || effectiveUserId;
      if (loggingUserId) {
        logAlmostMomentIfUsed(loggingUserId, aiResponse).catch((err) => {
          console.warn('[BaseAIService] Failed to log almost moment:', err);
        });
      }

      // ============================================
      // STORE SELF INFO: Save New Character Facts
      // ============================================
      // If the LLM generated new facts about Kayley, save them (fire-and-forget)
      if (aiResponse.store_self_info) {
        const { category, key, value } = aiResponse.store_self_info;
        console.log(`💾 [BaseAIService] AI generated new character fact: ${category}.${key} = "${value}"`);
        
        // Fire-and-forget: Don't block the response for database write
        storeCharacterFact(category as any, key, value)
          .then(stored => {
            if (stored) {
              console.log(`✅ [BaseAIService] Character fact saved successfully: ${key}`);
            } else {
              console.log(`📋 [BaseAIService] Character fact already exists or in profile: ${key}`);
            }
          })
          .catch(err => {
            console.warn(`⚠️ [BaseAIService] Failed to store character fact:`, err);
          });
      }

      // Analyze user message for patterns, milestones, and open loops (non-blocking)
      // This powers the Phase 1-5 "magic" systems
      // Phase 1: Now includes conversation context for LLM-based intent detection
      // Context is already built above

      const finalUserId = updatedSession?.userId || session?.userId || import.meta.env.VITE_USER_ID;
      console.log("finalUserId: ", finalUserId);
      
      if (userMessageText && finalUserId) {
        if (preCalculatedIntent) {
          // NORMAL PATH: We already have the intent, pass it directly
          analyzeUserMessageBackground(
            finalUserId, 
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
                finalUserId, 
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

      // ============================================
      // DETECT IDLE THOUGHTS: Mark Thoughts as Shared
      // ============================================
      // If Kayley mentioned any unshared idle thoughts in her response, mark them as shared
      // This is fire-and-forget to avoid blocking the response
      if (finalUserId && aiResponse.text_response) {
        detectAndMarkSharedThoughts(finalUserId, aiResponse.text_response)
          .then(markedIds => {
            if (markedIds.length > 0) {
              console.log(`💭 [BaseAIService] Marked ${markedIds.length} idle thought(s) as shared`);
            }
          })
          .catch(err => {
            console.warn('[BaseAIService] Failed to detect/mark shared thoughts:', err);
          });
      }

      const audioMode = options.audioMode ?? 'async';  // was 'sync'
      console.log("audioMode: ", audioMode);

      // Shared: Voice Generation
      // Note: Some providers might return user_transcription which we might want to use,
      // but generateSpeech usually takes the AI's text response.
      if (audioMode === 'none') {
        if (effectiveUserId) {
          this.triggerPostResponsePrefetch(effectiveUserId);
        }

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
        // GUARDRAIL: Skip TTS for empty/malformed text_response (e.g., "{}" after tool calls)
        if (isValidTextForTTS(aiResponse.text_response)) {
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
        } else {
          console.warn('⚠️ [BaseAIService] Skipped async TTS: text_response was empty or invalid:', aiResponse.text_response);
        }

        if (effectiveUserId) {
          this.triggerPostResponsePrefetch(effectiveUserId);
        }

        return {
          response: aiResponse,
          session: updatedSession,
          intent: preCalculatedIntent,
        };
      }

      // GUARDRAIL: Skip TTS for empty/malformed text_response (e.g., "{}" after tool calls)
      let audioData: string | undefined;
      if (isValidTextForTTS(aiResponse.text_response)) {
        audioData = await generateSpeech(aiResponse.text_response);
        console.log("audioData: ", audioData);
      } else {
        console.warn('⚠️ [BaseAIService] Skipped TTS: text_response was empty or invalid:', aiResponse.text_response);
        audioData = undefined;
      }

      // 🚀 POST-RESPONSE OPTIMIZATION: Warm the cache for the next message
      // This is fire-and-forget, doesn't block the current response.
      if (effectiveUserId) {
        this.triggerPostResponsePrefetch(effectiveUserId);
      }

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

  abstract generateNonGreeting(
    character: any,
    session: any,
    relationship: any,
    characterContext?: string
  ): Promise<any>;

  /**
   * Triggered when the user has been idle (e.g., 5-10 mins).
   * Decides whether to ask about a user topic (Open Loop) 
   * or share a thought (Proactive Thread).
   * 
   * Fast Router Philosophy: Parallel fetch, structured conflict resolution
   * 
   * @param userId - User ID for state retrieval
   * @param options - Context needed for prompt building (character, relationship, tasks, etc.)
   * @param session - Current AI session
   * @returns AI response or null if should skip
   */
  async triggerIdleBreaker(
    userId: string,
    options: {
      character?: CharacterProfile;
      relationship?: RelationshipMetrics | null;
      tasks?: Task[];
      chatHistory?: any[];
      characterContext?: string;
      upcomingEvents?: any[];
      proactiveSettings?: {
        checkins?: boolean;
        news?: boolean;
      };
    },
    session?: AIChatSession
  ): Promise<{ response: AIActionResponse, session: AIChatSession, audioData?: string } | null> {
    console.log(`💤 [BaseAIService] Triggering idle breaker for ${userId}`);

    // STEP A: Fetch Candidates in Parallel (Fast Router optimization)
    let openLoop: any = null;
    let threads: any[] = [];
    let activeThread: any = null;

    try {
      [openLoop, threads] = await Promise.all([
        getTopLoopToSurface(userId),      // "How was your interview?"
        getOngoingThreadsAsync(userId)    // Fetch all threads
      ]);
      
      activeThread = selectProactiveThread(threads);
    } catch (error) {
      console.warn('[BaseAIService] Failed to fetch proactive candidates:', error);
      // Continue with fallback
    }

    let systemInstruction = "";
    let logReason = "";
    let threadIdToMark: string | null = null;
    let loopIdToMark: string | null = null;

    // STEP B: Conflict Resolution Logic (4-Tier Priority System)
    // PRIORITY 1: High Salience User Loop (Crisis/Event) > Everything
    if (openLoop && openLoop.salience >= 0.8) {
      logReason = `High priority loop: ${openLoop.topic} (salience: ${openLoop.salience})`;
      systemInstruction = `
[SYSTEM EVENT: USER_IDLE - HIGH PRIORITY OPEN LOOP]
The user has been silent for over 5 minutes.
You have something important to ask about: "${openLoop.topic}"
${openLoop.triggerContext ? `Context: They said: "${openLoop.triggerContext.slice(0, 100)}..."` : 'From a previous conversation'}
Suggested ask: "${openLoop.suggestedFollowup || `How did things go with ${openLoop.topic}?`}"

Bring this up naturally. This is about THEM, not you.
Tone: Caring, curious, not demanding.
`.trim();
      loopIdToMark = openLoop.id;
      
    // PRIORITY 2: Proactive Thread (Kayley's Mind)
    } else if (activeThread) {
      logReason = `Proactive thread: ${activeThread.currentState.slice(0, 50)}...`;
      systemInstruction = buildProactiveThreadPrompt(activeThread);
      threadIdToMark = activeThread.id;
      
    // PRIORITY 3: Lower Priority Open Loop (still user-focused)
    } else if (openLoop && openLoop.salience > 0.7) {
      logReason = `Standard loop: ${openLoop.topic} (salience: ${openLoop.salience})`;
      systemInstruction = `
[SYSTEM EVENT: USER_IDLE - OPEN LOOP]
The user has been silent for over 5 minutes.
Casual check-in: "${openLoop.topic}"
${openLoop.triggerContext ? `Context: They mentioned: "${openLoop.triggerContext.slice(0, 100)}..."` : 'From a previous conversation'}
Suggested ask: "${openLoop.suggestedFollowup || `How did ${openLoop.topic} go?`}"

Bring this up naturally. Keep it light and conversational.
`.trim();
      loopIdToMark = openLoop.id;
      
    // PRIORITY 4: Generic Fallback
    } else {
      logReason = "Generic check-in";
      
      const relationshipContext = options.relationship?.relationshipTier
        ? `Relationship tier with user: ${options.relationship.relationshipTier}.`
        : "Relationship tier with user is unknown.";

      const highPriorityTasks = (options.tasks || []).filter(t => !t.completed && t.priority === 'high');
      const taskContext = highPriorityTasks.length > 0
        ? `User has ${highPriorityTasks.length} high-priority task(s): ${highPriorityTasks[0].text}. Consider gently mentioning it if appropriate.`
        : "No urgent tasks pending.";

      // Check if check-ins are disabled
      if (!options.proactiveSettings?.checkins && !options.proactiveSettings?.news) {
        console.log("💤 [BaseAIService] Check-ins and news disabled, skipping idle breaker");
        return null;
      }

      // Fetch tech news if enabled (this could be moved to a service, but keeping it here for now)
      let newsContext = "";
      if (options.proactiveSettings?.news) {
        try {
          const { fetchTechNews, getUnmentionedStory, markStoryMentioned } = await import('./newsService');
          const stories = await fetchTechNews();
          const story = getUnmentionedStory(stories);
          if (story) {
            markStoryMentioned(story.id);
            const hostname = story.url ? new URL(story.url).hostname : '';
            newsContext = `
[OPTIONAL NEWS TO DISCUSS]
There's an interesting tech story trending on Hacker News: "${story.title}"
${hostname ? `(from: ${hostname})` : ''}

You can mention this if the conversation allows, or use it as a conversation starter.
Translate it in your style - make it accessible and interesting!
Don't force it - only bring it up if it feels natural.
          `.trim();
          }
        } catch (e) {
          console.warn('[BaseAIService] Failed to fetch news for idle breaker', e);
        }
      }
      
      // If check-ins are off but news is on, only proceed if we have news
      if (!options.proactiveSettings?.checkins && !newsContext) {
        console.log("💤 [BaseAIService] Check-ins disabled and no news to share, skipping");
        return null;
      }

      // Build prompt based on what's enabled
      if (options.proactiveSettings?.checkins) {
        systemInstruction = `
[SYSTEM EVENT: USER_IDLE]
The user has been silent for over 5 minutes. 
${relationshipContext}
${taskContext}
${newsContext}
Your goal: Gently check in or start a conversation.
- If relationship is 'close_friend', maybe send a random thought or joke.
- If 'acquaintance', politely ask if they are still there.
- If there are high-priority tasks and relationship allows, you MAY gently mention them (but don't be pushy).
- You can mention tech news if it feels natural and interesting.
- Remember: you translate tech into human terms!
- Keep it very short (1 sentence).
- Do NOT repeat yourself if you did this recently.
        `.trim();
      } else {
        // News only mode - just share the news
        systemInstruction = `
[SYSTEM EVENT: NEWS_UPDATE]
Share this interesting tech news with the user naturally.
${newsContext}

Your goal: Share this news in your style - make it accessible and interesting!
- Keep it conversational and short (1-2 sentences).
- Translate tech jargon into human terms.
        `.trim();
      }
    }

    console.log(`🤖 [BaseAIService] Selected strategy: ${logReason}`);

    // STEP C: Mark the winner as surfaced/mentioned (side effects)
    if (threadIdToMark) {
      markThreadMentionedAsync(userId, threadIdToMark).catch(err => 
        console.warn('[BaseAIService] Failed to mark thread as mentioned:', err)
      );
    }
    if (loopIdToMark) {
      markLoopSurfaced(loopIdToMark).catch(err => 
        console.warn('[BaseAIService] Failed to mark loop as surfaced:', err)
      );
    }

    // STEP D: Generate the system prompt using promptUtils
    // Use pre-fetched context if available
    const [soulResult, factsResult] = await Promise.all([
      getSoulLayerContextAsync(userId),
      formatCharacterFactsForPrompt()
    ]);

    const fullSystemPrompt = await buildSystemPrompt(
      options.character,
      options.relationship,
      options.upcomingEvents || [],
      options.characterContext,
      options.tasks,
      undefined, // relationshipSignals - not needed for idle breaker
      undefined, // toneIntent - not needed for idle breaker
      undefined, // fullIntent - not needed for idle breaker
      userId,
      undefined, // userTimeZone
      { soulContext: soulResult, characterFacts: factsResult } // 🚀 OPTIMIZATION
    );

    // Combine the idle breaker instruction with the full system prompt
    const combinedSystemPrompt = `${fullSystemPrompt}\n\n${systemInstruction}`;

    // STEP E: Call the LLM provider and return the response
    // We pass an empty user message because *SHE* is speaking first
    const { response, session: updatedSession } = await this.callProvider(
      combinedSystemPrompt,
      { type: 'text', text: '' }, // Empty trigger - she's initiating
      options.chatHistory || [],
      session
    );

    // Generate audio for the response
    // GUARDRAIL: Skip TTS for empty/malformed text_response
    const audioData = isValidTextForTTS(response.text_response)
      ? await generateSpeech(response.text_response)
      : undefined;
    
    if (!isValidTextForTTS(response.text_response)) {
      console.warn('⚠️ [BaseAIService] Skipped idle breaker TTS: text_response was empty or invalid:', response.text_response);
    }

    return {
      response,
      session: updatedSession,
      audioData: audioData || undefined
    };
  }

  /**
   * Fire-and-forget pre-fetch trigger after a response is sent.
   * Keeps the context cache fresh for the next user message.
   */
  private triggerPostResponsePrefetch(userId: string): void {
    // delay slightly to avoid competing with UI updates/audio playback starts
    setTimeout(() => {
      console.log(`🧪 [BaseAIService] Triggering post-response pre-fetch for user: ${userId}`);
      prefetchOnIdle(userId).catch(err => {
        console.warn('⚠️ [BaseAIService] Post-response pre-fetch failed:', err);
      });
    }, 1000); 
  }
}

