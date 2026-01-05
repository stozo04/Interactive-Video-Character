/**
 * Whiteboard Handler
 *
 * Handles AI interaction for whiteboard/drawing mode.
 * Extracted from App.tsx as part of Phase 8 refactoring.
 *
 * @see src/handlers/whiteboardHandler.README.md for usage documentation
 */

import { CharacterProfile } from '../types';
import { AIChatSession, IAIChatService } from '../services/aiService';
import { parseWhiteboardAction, WhiteboardAction } from '../services/whiteboardModes';

/**
 * Options for the whiteboard capture handler
 */
export interface WhiteboardHandlerOptions {
  /** Currently selected character */
  selectedCharacter: CharacterProfile | null;
  /** Google session with access token */
  session: { accessToken: string } | null;
  /** Current AI chat session */
  aiSession: AIChatSession | null;
  /** Active AI service instance */
  activeService: IAIChatService;
  /** Callback to update AI session state */
  setAiSession: (session: AIChatSession) => void;
  /** Callback to play a character action */
  playAction: (actionId: string) => void;
  /** Ref tracking muted state */
  isMutedRef: { current: boolean };
  /** Callback to enqueue audio for playback */
  enqueueAudio: (audioData: string) => void;
}

/**
 * Result from the whiteboard capture handler
 */
export interface WhiteboardHandlerResult {
  /** Text response from the AI */
  textResponse: string;
  /** Parsed whiteboard action (draw, game move, etc.) */
  whiteboardAction?: WhiteboardAction | null;
}

/**
 * Debug logging helper
 */
const createDebugLogger = () => {
  const WB_DEBUG =
    typeof window !== 'undefined' &&
    window.localStorage?.getItem('debug:whiteboard') === '1';
  const wbNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wbLog = (...args: unknown[]) => {
    if (WB_DEBUG) console.log(...args);
  };
  return { wbNow, wbLog, WB_DEBUG };
};

/**
 * Fetch user facts for context enrichment
 */
async function fetchUserInfoContext(wbLog: (...args: unknown[]) => void, wbNow: () => number): Promise<string> {
  try {
    const tFacts0 = wbNow();
    const { getUserFacts, formatFactValueForDisplay } = await import('../services/memoryService');
    const userFacts = await getUserFacts('all');
    wbLog('⏱️ [Whiteboard] user_facts done', {
      dtMs: Math.round(wbNow() - tFacts0),
      count: Array.isArray(userFacts) ? userFacts.length : 'n/a',
    });

    if (userFacts.length > 0) {
      const factsFormatted = userFacts
        .map((f) => `- ${f.fact_key}: ${formatFactValueForDisplay(f.fact_value)}`)
        .join('\n');
      console.log(
        '🧠 [Whiteboard] Pre-loaded user facts:',
        userFacts.map((f) => `${f.fact_key}=${formatFactValueForDisplay(f.fact_value)}`)
      );
      return `\n\n[KNOWN USER INFO - USE THIS!]\nYou already know these facts about the user:\n${factsFormatted}\n\nIf they ask you to draw "my name" and you have their name above, USE IT! Don't ask again!\n`;
    }
  } catch (err) {
    console.warn('Could not pre-fetch user info:', err);
  }
  return '';
}

/**
 * Handle whiteboard capture and AI interaction
 *
 * @param base64 - Base64-encoded image data from the whiteboard
 * @param userMessage - User's message/instruction
 * @param modeContext - Context string describing the current whiteboard mode
 * @param options - Handler options with dependencies
 * @returns Promise with text response and optional whiteboard action
 */
export async function handleWhiteboardCapture(
  base64: string,
  userMessage: string,
  modeContext: string,
  options: WhiteboardHandlerOptions
): Promise<WhiteboardHandlerResult> {
  const {
    selectedCharacter,
    session,
    aiSession,
    activeService,
    setAiSession,
    playAction,
    isMutedRef,
    enqueueAudio,
  } = options;

  // Validate prerequisites
  if (!selectedCharacter || !session) {
    return { textResponse: 'Please select a character first.' };
  }

  const { wbNow, wbLog } = createDebugLogger();
  const wbT0 = wbNow();

  wbLog('⏱️ [Whiteboard] handleWhiteboardCapture start', {
    bytes: base64?.length ?? 0,
    msgLen: userMessage?.length ?? 0,
    hasSelectedCharacter: !!selectedCharacter,
  });

  const sessionToUse: AIChatSession = aiSession || { model: activeService.model };

  try {
    // Pre-fetch user info for context enrichment
    const userInfoContext = await fetchUserInfoContext(wbLog, wbNow);
    const enrichedContext = modeContext + userInfoContext;

    // Generate AI response
    const tGem0 = wbNow();
    const { response, session: updatedSession } = await activeService.generateResponse(
      {
        type: 'image_text',
        text: enrichedContext,
        imageData: base64,
        mimeType: 'image/png',
      },
      {
        chatHistory: [],
        googleAccessToken: session.accessToken,
        audioMode: 'async',
        onAudioData: (audioData: string) => {
          // Handle async audio - respect mute state at callback time
          try {
            wbLog('⏱️ [Whiteboard] async audio ready', {
              dtMs: Math.round(wbNow() - wbT0),
              hasAudio: !!audioData,
            });
          } catch {
            // Ignore logging errors
          }
          if (!audioData) return;
          if (!isMutedRef.current) {
            enqueueAudio(audioData);
          } else {
            wbLog('⏱️ [Whiteboard] async audio dropped (muted)');
          }
        },
      },
      sessionToUse
    );

    wbLog('⏱️ [Whiteboard] generateResponse done', {
      dtMs: Math.round(wbNow() - tGem0),
      hasAudio: false,
      hasActionId: !!response?.action_id,
    });

    // Update AI session
    setAiSession(updatedSession);

    // Play action if specified
    if (response.action_id) {
      playAction(response.action_id);
    }

    // Parse whiteboard action from response
    const tParse0 = wbNow();
    const whiteboardAction = parseWhiteboardAction(response);
    wbLog('⏱️ [Whiteboard] parseWhiteboardAction done', {
      dtMs: Math.round(wbNow() - tParse0),
      hasAction: !!whiteboardAction,
      type: (whiteboardAction as { type?: string })?.type,
    });

    return {
      textResponse: response.text_response,
      whiteboardAction,
    };
  } catch (error) {
    console.error('Whiteboard AI error:', error);
    return { textResponse: "Hmm, I had trouble seeing your drawing. Try again?" };
  } finally {
    wbLog('⏱️ [Whiteboard] handleWhiteboardCapture end', {
      dtTotalMs: Math.round(wbNow() - wbT0),
    });
  }
}
