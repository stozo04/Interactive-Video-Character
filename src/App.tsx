// ============================================================================
// IMPORTS
// ============================================================================
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChatMessage,
  CharacterProfile,
  PendingChatAttachment,
  PendingFileAttachment,
} from './types';
import * as dbService from './services/cacheService';
import { supabase } from './services/supabaseClient';
import AuthWarningBanner from './components/AuthWarningBanner';
import * as conversationHistoryService from './services/conversationHistoryService';
import * as relationshipService from './services/relationshipService';
import type { RelationshipMetrics } from './services/relationshipService';
import { gmailService } from './services/gmailService';
import { generateEmailAnnouncement, generateEmailConfirmation, composePolishedReply } from './services/emailProcessingService';
import { getUserFacts, formatFactsForAI } from './services/memoryService';
import { clientLogger } from './services/clientLogger';
import { 
  calendarService, 
  type CalendarEvent,
  type NewEventPayload 
} from './services/calendarService';
import { predictActionFromMessage } from './utils/intentUtils';
import { prefetchOnIdle, clearPrefetchCache } from './services/prefetchService';
import ImageUploader from './components/ImageUploader';
import VideoPlayer from './components/VideoPlayer';
import AudioPlayer from './components/AudioPlayer';
import ChatPanel from './components/ChatPanel';
import CharacterSelector from './components/CharacterSelector';
import LoadingSpinner from './components/LoadingSpinner';
import CharacterManagementView from './components/CharacterManagementView';
import { SettingsPanel } from './components/SettingsPanel';
import { LoginPage } from './components/LoginPage';
import { TaskPanel } from './components/TaskPanel';
import { WhiteboardView } from './components/WhiteboardView';
import AdminDashboardView from './components/AdminDashboardView';
import { WhiteboardAction } from './services/whiteboardModes';
import { handleWhiteboardCapture as handleWhiteboardCaptureHandler } from './handlers/whiteboardHandler';
import { processSelfieAction, processTaskAction } from './handlers/messageActions';
import { processUserMessage } from './services/messageOrchestrator';
import { useGoogleAuth } from './contexts/GoogleAuthContext';
import { useDebounce } from './hooks/useDebounce';
import { useMediaQueues } from './hooks/useMediaQueues';
import { useTasks } from './hooks/useTasks';
import { useCalendar } from './hooks/useCalendar';
import { useProactiveSettings } from './hooks/useProactiveSettings';
import { useGmail } from './hooks/useGmail';
import { useIdleTracking } from './hooks/useIdleTracking';
import { useCharacterActions } from './hooks/useCharacterActions';
import { useCharacterManagement } from './hooks/useCharacterManagement';
import { useAIService } from './contexts/AIServiceContext';
import { AIChatSession } from './services/aiService';
import { startCleanupScheduler, stopCleanupScheduler } from './services/loopCleanupService';
import { processStorylineOnStartup } from './services/storylineService';
import { startStorylineIdleService, stopStorylineIdleService } from './services/storylineIdleService';
import { isQuestionMessage } from './utils/textUtils';
import { shuffleArray } from './utils/arrayUtils';
import { getAccessToken } from './services/googleAuth';
import { hasBeenBriefedToday, markBriefedToday } from './services/dailyCatchupService';
import { StorageKey } from './utils/enums';
import { runIdleThinkingTick } from './services/idleThinkingService';
import { registerXAuthTestHelper } from './services/xAuthTestHelper';
import { handleXAuthCallback, refreshRecentTweetMetrics } from './services/xTwitterService';
import { handleOAuthCallback as handleAnthropicOAuthCallback } from './services/anthropicService';
import { pollAndProcessMentions } from './services/xMentionService';
import {
  ackPendingMessageDelivered,
  fetchNextPendingMessage,
} from './services/pendingMessageService';
import {
  listWorkspaceAgentRuns,
  type WorkspaceAgentRun,
  type WorkspaceAgentRunStatus,
} from './services/projectAgentService';
import { buildActionKeyMap } from './utils/actionKeyMapper';
import { subscribeToTicketUpdates, type TerminatedTicket } from './services/engineeringTicketWatcher';

// Register X auth test helper on window (dev only)
if (import.meta.env.DEV) {
  registerXAuthTestHelper();
}

// ============================================================================
// CONSTANTS & TYPES
// ============================================================================
const ACTION_VIDEO_BUCKET = 'character-action-videos';

type View = 'loading' | 'selectCharacter' | 'createCharacter' | 'chat' | 'manageCharacter' | 'whiteboard' | 'admin';

interface DisplayCharacter {
  profile: CharacterProfile;
  imageUrl: string;
  videoUrl: string;
}

const WORKSPACE_CHAT_ANNOUNCE_STATUSES: ReadonlySet<WorkspaceAgentRunStatus> = new Set([
  'requires_approval',
  'rejected',
  'success',
  'failed',
  'verification_failed',
]);

const buildFileAttachmentPayload = (
  message: string,
  attachment: PendingFileAttachment
): string => {
  const header = message.trim() || `Please read the attached file "${attachment.fileName}".`;
  const metadata = [
    `name="${attachment.fileName}"`,
    `mime="${attachment.mimeType}"`,
    `size_bytes="${attachment.size}"`,
    `extension="${attachment.extension}"`,
    `truncated="${attachment.truncated ? 'true' : 'false'}"`,
  ].join(' ');

  return `${header}\n\n<attached_file ${metadata}>\n${attachment.text}\n</attached_file>`;
};

function getWorkspaceActionTarget(run: WorkspaceAgentRun): string {
  const path = run.request?.args?.path;
  if (typeof path === 'string' && path.trim().length > 0) {
    return ` (${path})`;
  }
  return '';
}

function formatWorkspaceRunStatusMessage(run: WorkspaceAgentRun): string | null {
  const action = run.request?.action || 'workspace action';
  const target = getWorkspaceActionTarget(run);

  if (run.status === 'accepted' || run.status === 'pending' || run.status === 'running') {
    return `[Agent] Started ${action}${target}. Run ${run.id} is ${run.status}.`;
  }

  if (run.status === 'requires_approval') {
    return `[Agent] ${action}${target} needs approval in Admin > Agent. Run ${run.id}.`;
  }

  if (run.status === 'success') {
    return `[Agent] Completed ${action}${target}. ${run.summary} (Run ${run.id}).`;
  }

  if (run.status === 'verification_failed') {
    return `[Agent] ${action}${target} could not be verified. ${run.summary} (Run ${run.id}).`;
  }

  if (run.status === 'failed') {
    return `[Agent] ${action}${target} failed. ${run.summary} (Run ${run.id}).`;
  }

  if (run.status === 'rejected') {
    return `[Agent] ${action}${target} was rejected. ${run.summary} (Run ${run.id}).`;
  }

  return null;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const App: React.FC = () => {
  // --------------------------------------------------------------------------
  // AUTH & CORE SERVICES
  // --------------------------------------------------------------------------
  const { session, status: authStatus, signOut, refreshSession } = useGoogleAuth();
  const activeService = useAIService();

  // --------------------------------------------------------------------------
  // X OAUTH CALLBACK HANDLER
  // --------------------------------------------------------------------------
  const [xAuthStatus, setXAuthStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [anthropicAuthStatus, setAnthropicAuthStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');

  // Anthropic OAuth callback handler
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === '/auth/anthropic/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (code && state) {
        setAnthropicAuthStatus('processing');
        handleAnthropicOAuthCallback(code, state)
          .then((success) => {
            console.log('Anthropic OAuth callback:', success ? 'succeeded' : 'failed');
            setAnthropicAuthStatus(success ? 'success' : 'error');
            window.history.replaceState({}, '', '/');
          })
          .catch((error) => {
            console.error('Anthropic OAuth callback failed:', error);
            setAnthropicAuthStatus('error');
            window.history.replaceState({}, '', '/');
          });
      } else {
        window.history.replaceState({}, '', '/');
      }
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === '/auth/x/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (code && state) {
        setXAuthStatus('processing');
        handleXAuthCallback(code, state)
          .then(() => {
            console.log('X OAuth callback succeeded — account connected');
            setXAuthStatus('success');
            window.history.replaceState({}, '', '/');
          })
          .catch((error) => {
            console.error('X OAuth callback failed:', error);
            setXAuthStatus('error');
            window.history.replaceState({}, '', '/');
          });
      } else {
        // Callback URL missing required params — redirect home
        window.history.replaceState({}, '', '/');
      }
    }
  }, []);

  // --------------------------------------------------------------------------
  // UI STATE
  // --------------------------------------------------------------------------
  const [view, setView] = useState<View>('loading');
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterProfile | null>(null);

  // Voice Mode State
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [talkingVideoUrl, setTalkingVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    // Placeholder for talking video URL. 
    // In a real app, this would come from the character profile or DB.
    // const url = "https://your-supabase-url.../talking_loop.mp4"; 
    // setTalkingVideoUrl(url);
  }, []);

  // --------------------------------------------------------------------------
  // MEDIA & CACHE HOOKS
  // --------------------------------------------------------------------------
  const media = useMediaQueues();


  // --------------------------------------------------------------------------
  // CHAT & PROCESSING STATE
  // --------------------------------------------------------------------------
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [aiSession, setAiSession] = useState<AIChatSession | null>(null);
  const [lastSavedMessageIndex, setLastSavedMessageIndex] = useState<number>(-1);
  const [relationship, setRelationship] = useState<RelationshipMetrics | null>(null);
  const chatHistoryRef = useRef<ChatMessage[]>([]);
  const workspaceRunStatusRef = useRef<Map<string, WorkspaceAgentRunStatus>>(new Map());
  const workspaceStatusBaselineReadyRef = useRef(false);
  const pendingMessageInFlightRef = useRef(false);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  // --------------------------------------------------------------------------
  // CHARACTER MANAGEMENT STATE (Partial - rest managed by useCharacterManagement hook)
  // --------------------------------------------------------------------------
  const [characterForManagement, setCharacterForManagement] = useState<CharacterProfile | null>(null);
  const [isVideoVisible, setIsVideoVisible] = useState(true);
  const [isLoadingCharacter, setIsLoadingCharacter] = useState(false);
  const [loadingCharacterName, setLoadingCharacterName] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // AUDIO STATE & REFS
  // --------------------------------------------------------------------------
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  
  // --------------------------------------------------------------------------
  // CUSTOM HOOKS (Extracted from App.tsx for modularity)
  // --------------------------------------------------------------------------

  // Task Management
  const taskCelebrateRef = useRef<(message: string) => void>(() => {});
  const taskPlayPositiveRef = useRef<() => void>(() => {});
  const {
    tasks,
    isTaskPanelOpen,
    setIsTaskPanelOpen,
    loadTasks,
    refreshTasks,
    handleTaskCreate,
    handleTaskToggle,
    handleTaskDelete,
  } = useTasks({
    onCelebrate: (msg) => taskCelebrateRef.current(msg),
    onPlayPositiveAction: () => taskPlayPositiveRef.current(),
  });

  // Proactive Settings & Snooze
  const {
    proactiveSettings,
    updateProactiveSettings,
    isSnoozed,
    setIsSnoozed,
    snoozeUntil,
    setSnoozeUntil,
    loadSnoozeState,
  } = useProactiveSettings();

  // Idle Tracking
  const {
    lastInteractionAt,
    setLastInteractionAt,
    registerInteraction,
    isIdle,
  } = useIdleTracking();

  // Character Actions (playback, idle scheduling, categorization)
  const {
    currentActionId,
    setCurrentActionId,
    actionVideoUrls,
    setActionVideoUrls,
    playAction,
    playRandomTalkingAction,
    isTalkingActionId,
  } = useCharacterActions({
    selectedCharacter,
    isProcessingAction,
    media,
    registerInteraction,
  });

  // Character Management (CRUD operations for characters, actions, idle videos)
  const reportErrorRef = useRef<(message: string, error?: unknown) => void>((msg) => {
    console.error(msg);
    setErrorMessage(msg);
  });
  const {
    isSavingCharacter,
    isCreatingAction,
    updatingActionId,
    deletingActionId,
    isAddingIdleVideo,
    setIsUpdatingImage,
    deletingIdleVideoId,
    uploadedImage,
    handleImageUpload,
    handleSelectLocalVideo,
    handleManageCharacter,
    handleDeleteCharacter,
    handleBackToSelection,
    handleCreateAction,
    handleUpdateAction,
    handleDeleteAction,
    handleAddIdleVideo,
    handleDeleteIdleVideo,
    applyCharacterUpdate,
    cleanupActionUrls,
  } = useCharacterManagement({
    characters,
    setCharacters,
    selectedCharacter,
    setSelectedCharacter,
    characterForManagement,
    setCharacterForManagement,
    actionVideoUrls,
    setActionVideoUrls,
    setView,
    reportError: (msg, err) => reportErrorRef.current(msg, err),
    registerInteraction,
    media,
  });

  // Derived state - override idle video if speaking
  const currentVideoSrc =
    (isSpeaking && talkingVideoUrl && !currentActionId)
      ? talkingVideoUrl
      : media.currentVideoSrc;
  const nextVideoSrc = media.nextVideoSrc;

  // --------------------------------------------------------------------------
  // GMAIL & CALENDAR INTEGRATION
  // --------------------------------------------------------------------------
  // Gmail Hook
  const {
    currentPendingEmail,
    advanceQueue:       advanceEmailQueue,
    clearQueue:         clearEmailQueue,
    isConnected:        isGmailConnected,
  } = useGmail({ session, status: authStatus });

  // Tracks which email ID Kayley has already announced — prevents double-firing
  // on re-renders while the same email sits at the front of the queue.
  const announcedEmailIdRef = useRef<string | null>(null);
  const calendarTriggerRef = useRef<(prompt: string) => void>(() => { });
  const ticketTerminatedRef = useRef<(ticket: TerminatedTicket) => void>(() => { });

  // Calendar Hook
  const {
    upcomingEvents,
    weekEvents,
    refreshEvents: refreshCalendarEvents,
    registerCalendarEffects,
    checkForApplicableCheckins,
  } = useCalendar({
    session,
    isAuthConnected: authStatus === 'connected',
    selectedCharacter,
    proactiveSettings,
    isSnoozed,
    isProcessingAction,
    isSpeaking,
    triggerSystemMessage: (prompt) => calendarTriggerRef.current(prompt),
  });

  const lastIdleActionAtRef = useRef<number | null>(null);
  const idleThinkingInFlightRef = useRef<boolean>(false);

  // ==========================================================================
  // INITIALIZATION EFFECTS
  // ==========================================================================

  // Loop Cleanup: Initialize scheduled cleanup for stale/duplicate loops
  useEffect(() => {
    try {
      startCleanupScheduler({
          onComplete: (result) => {
            if (result.totalExpired > 0) {
              console.log(`🧹 Cleaned up ${result.totalExpired} stale loops`);
            }
          }
        });
        
        return () => {
          stopCleanupScheduler();
        };
    } catch (e) {
      // Ignore if user ID check fails (e.g. env var missing in dev)
      console.log(`❌ [LoopCleanup] Error starting cleanup scheduler:`, e);
    }
  }, []);

  // Idle Thoughts: Initialize scheduler to generate thoughts during user absence
  useEffect(() => {
    try {
      console.log("❌ Idle Thoughts are disabled.")
      // Disabling Idle Thoughts as this is not working as expected.
      // I need to get rid of the hard code logic in idleThougths.ts
      // and make it dynamic
      // startIdleThoughtsScheduler();

      // return () => {
      //   stopIdleThoughtsScheduler();
      // };

    } catch (e) {
      // Ignore if user ID check fails (e.g. env var missing in dev)
      console.log(`❌ [IdleThoughts] Error starting idle thoughts scheduler:`, e);
    }
  }, []);

  // Storyline Idle Service: Generate storyline suggestions during user absence
  useEffect(() => {
    try {
      startStorylineIdleService();
      return () => {
        stopStorylineIdleService();
      };
    } catch (e) {
      console.log(`❌ [StorylineIdle] Error starting idle service:`, e);
    }
  }, []);

  // Storyline Processing: Check for missed days on app startup
  useEffect(() => {
    processStorylineOnStartup().catch(error => {
      console.error('📖 [Storylines] Error in startup processing:', error);
    });
  }, []); // Run once on mount

  // X Tweet Metrics: Refresh engagement metrics every 30 minutes
  useEffect(() => {
    const METRICS_INTERVAL = 30 * 60 * 1000; // 30 minutes

    // Initial refresh after a short delay
    const initialTimeout = setTimeout(() => {
      refreshRecentTweetMetrics().catch(e =>
        console.warn('[X Metrics] Initial refresh failed:', e)
      );
    }, 10000);

    const interval = setInterval(() => {
      refreshRecentTweetMetrics().catch(e =>
        console.warn('[X Metrics] Periodic refresh failed:', e)
      );
    }, METRICS_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  // X Mentions: Poll for @mentions every 5 minutes
  useEffect(() => {
    const MENTION_INTERVAL = 5 * 60 * 1000; // 5 minutes

    // Initial poll after 15s delay
    const initialTimeout = setTimeout(() => {
      pollAndProcessMentions().catch(e =>
        console.warn('[X Mentions] Initial poll failed:', e)
      );
    }, 15000);

    const interval = setInterval(() => {
      pollAndProcessMentions().catch(e =>
        console.warn('[X Mentions] Periodic poll failed:', e)
      );
    }, MENTION_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  // ==========================================================================
  // UTILITY FUNCTIONS
  // ==========================================================================

  const reportError = useCallback((message: string, error?: unknown) => {
    console.error(message, error);
    setErrorMessage(message);
  }, []);

  // ==========================================================================
  // CHARACTER LOADING & MEMOIZED DATA
  // ==========================================================================

  const loadCharacters = useCallback(async () => {
    setView('loading');
    const startTime = performance.now(); 
    try {
      const savedCharacters = await dbService.getCharacters();
      const loadTime = performance.now() - startTime;
      // console.log(`✅ Loaded ${savedCharacters.length} character(s) in ${loadTime.toFixed(0)}ms`);
      setCharacters(savedCharacters.sort((a, b) => b.createdAt - a.createdAt));
      setView('selectCharacter');
    } catch (error) {
      console.error('Failed to load characters:', error);
      setErrorMessage('Failed to load characters. Check console for details.');
      setView('selectCharacter');
    }
  }, []);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters]);

  const displayCharacters = useMemo((): DisplayCharacter[] => {
    return characters.map(profile => ({
      profile,
      imageUrl: `data:${profile.image.mimeType};base64,${profile.image.base64}`,
      videoUrl: profile.idleVideoUrls.length > 0 ? profile.idleVideoUrls[0] : ''
    }));
  }, [characters]);

  const managedActions = useMemo(() => {
    const character = characterForManagement || selectedCharacter;
    if (!character) return [];

    return character.actions.map((action) => {
      const localUrl = actionVideoUrls[action.id] ?? null;
      let fallbackUrl: string | null = null;

      if (!localUrl && action.videoPath) {
        const { data } = supabase.storage
          .from(ACTION_VIDEO_BUCKET)
          .getPublicUrl(action.videoPath);
        fallbackUrl = data?.publicUrl ?? null;
      }

      const previewAssetUrl = localUrl ?? fallbackUrl;

      return {
        id: action.id,
        name: action.name,
        phrases: action.phrases,
        videoUrl: localUrl,
        previewAssetUrl,
      };
    });
  }, [characterForManagement, selectedCharacter, actionVideoUrls]);

  const managedIdleVideos = useMemo(() => {
    const character = characterForManagement || selectedCharacter;
    if (!character) return [];

    return character.idleVideoUrls.map((videoUrl, index) => {
      return {
        id: `idle-${index}`,
        videoUrl, // Already a public URL!
        isLocal: true,
      };
    });
  }, [characterForManagement, selectedCharacter]);

  // ==========================================================================
  // CALLBACK WIRING & AUDIO HANDLERS
  // ==========================================================================

  // Task celebration callbacks (wired via refs for late binding)
  useEffect(() => {
    taskCelebrateRef.current = (message: string) => {
      if (selectedCharacter && !isMutedRef.current) {
        // Gates: Disable Audio
        // generateSpeech(message).then(audio => {
        //   if (audio) media.enqueueAudio(audio);
        // });
        setChatHistory(prev => [...prev, { role: 'model', text: message }]);
      }
    };
    taskPlayPositiveRef.current = () => {
      if (selectedCharacter) {
        const positiveActions = selectedCharacter.actions.filter(a =>
          a.name.toLowerCase().includes('happy') ||
          a.name.toLowerCase().includes('celebrate') ||
          a.name.toLowerCase().includes('excited')
        );
        if (positiveActions.length > 0) {
          playAction(positiveActions[0].id);
        }
      }
    };
  }, [selectedCharacter, media, playAction]);

  const syncWorkspaceRunStatus = useCallback(
    (run: WorkspaceAgentRun, shouldEmitChatMessage: boolean) => {
      const previousStatus = workspaceRunStatusRef.current.get(run.id);
      if (previousStatus === run.status) {
        return;
      }

      workspaceRunStatusRef.current.set(run.id, run.status);

      if (!shouldEmitChatMessage) {
        return;
      }

      if (!WORKSPACE_CHAT_ANNOUNCE_STATUSES.has(run.status)) {
        return;
      }

      const message = formatWorkspaceRunStatusMessage(run);
      if (!message) {
        return;
      }

      setChatHistory((prev) => [...prev, { role: 'system', text: message }]);
    },
    [],
  );

  const backfillWorkspaceRuns = useCallback(
    async (shouldEmitChatMessage: boolean) => {
      const result = await listWorkspaceAgentRuns(20);
      if (!result.ok) {
        console.warn('[WorkspaceAgentChat] Failed to list runs for backfill', {
          error: result.error,
        });
        return;
      }

      // API returns newest-first; process oldest-first for natural chat order.
      [...result.runs]
        .reverse()
        .forEach((run) => syncWorkspaceRunStatus(run, shouldEmitChatMessage));
    },
    [syncWorkspaceRunStatus],
  );

  // NOTE: subscribeWorkspaceAgentEvents removed — the /agent/events SSE endpoint
  // does not exist on the server. Engineering ticket status is delivered via
  // Supabase Realtime through subscribeToTicketUpdates below.

  useEffect(() => {
    if (view !== 'chat' || !selectedCharacter || !session) {
      return;
    }

    let isDisposed = false;

    const tryDeliverPendingMessage = async () => {
      if (pendingMessageInFlightRef.current || isDisposed) {
        return;
      }

      pendingMessageInFlightRef.current = true;
      try {
        const pending = await fetchNextPendingMessage();
        if (!pending || isDisposed) {
          return;
        }

        let assistantImage: string | undefined;
        let assistantImageMimeType: string | undefined;

        if (pending.messageType === 'photo') {
          const selfieParams = (pending.metadata?.selfieParams || {}) as Record<string, unknown>;
          const scene =
            typeof selfieParams.scene === 'string' && selfieParams.scene.trim().length > 0
              ? selfieParams.scene
              : 'casual outdoor selfie';
          const mood =
            typeof selfieParams.mood === 'string' && selfieParams.mood.trim().length > 0
              ? selfieParams.mood
              : 'happy smile';
          const outfit =
            typeof selfieParams.outfit === 'string' ? selfieParams.outfit : undefined;

          const selfieResult = await processSelfieAction(
            { scene, mood, outfit },
            {
              userMessage: 'pending message delivery',
              chatHistory: chatHistoryRef.current,
              upcomingEvents,
            },
          );

          if (selfieResult.success && selfieResult.imageBase64) {
            assistantImage = selfieResult.imageBase64;
            assistantImageMimeType = selfieResult.mimeType || 'image/png';
          } else if (selfieResult.error) {
            console.error('[PendingMessage] Selfie generation failed', selfieResult.error);
          }
        }

        const modelMessage: ChatMessage = {
          role: 'model',
          text: pending.messageText,
          assistantImage,
          assistantImageMimeType,
        };

        setChatHistory((prev) => [...prev, modelMessage]);
        await conversationHistoryService.appendConversationHistory(
          [{ role: 'model', text: pending.messageText }],
          aiSession?.interactionId,
        );

        const acked = await ackPendingMessageDelivered(pending.id);
        if (!acked) {
          console.warn('[PendingMessage] Delivery ack skipped or already claimed', {
            pendingMessageId: pending.id,
          });
        }
      } catch (error) {
        console.error('[PendingMessage] Delivery failed', error);
      } finally {
        pendingMessageInFlightRef.current = false;
      }
    };

    void tryDeliverPendingMessage();
    const intervalId = window.setInterval(() => {
      void tryDeliverPendingMessage();
    }, 30_000);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
    };
  }, [aiSession?.interactionId, selectedCharacter, session, upcomingEvents, view]);

  const handleSpeechStart = useCallback(() => {
    setIsSpeaking(true);
    if (!isTalkingActionId(currentActionId || '')) {
      playRandomTalkingAction(true);
    }
  }, [currentActionId, isTalkingActionId, playRandomTalkingAction]);

  const { enqueueAudio, handleAudioEnd } = media;

  // ==========================================================================
  // SYSTEM MESSAGE & IDLE BREAKER
  // ==========================================================================
  const triggerSystemMessage = useCallback(async (systemPrompt: string) => {
    if (!selectedCharacter || !session) return;

    // 1. Show typing indicator immediately
    setIsProcessingAction(true);

    try {
      // 2. Send to AI (Gemini)
      // Notice we pass the systemPrompt as 'text' but with a special type or just handle it as text
      const { response, session: updatedSession, audioData } = await activeService.generateResponse(
        { type: 'text', text: systemPrompt },
        {
          chatHistory, // Pass existing history so it knows context
          googleAccessToken: session?.accessToken,
        },
        aiSession || { model: activeService.model }
      );

      setAiSession(updatedSession);

      // 3. Add ONLY the AI response to chat history (No user bubble)
      setChatHistory(prev => [
        ...prev, 
        { role: 'model', text: response.text_response }
      ]);
      
      // 4. Save to DB
      await conversationHistoryService.appendConversationHistory(
        [{ role: 'model', text: response.text_response }],
        updatedSession.interactionId
      );

      // 5. Play Audio
      if (!isMuted && audioData) enqueueAudio(audioData);
      if (response.open_app) {
        console.log("Launching app:", response.open_app);
         window.location.href = response.open_app;
      }

    } catch (error) {
      console.error('Briefing error:', error);
    } finally {
      setIsProcessingAction(false);
    }
  }, [
    activeService,
    aiSession,
    chatHistory,
    enqueueAudio,
    isMuted,
    relationship,
    selectedCharacter,
    session,
    upcomingEvents,
    playAction
  ]);

  // Wire up calendar trigger ref
  useEffect(() => {
    calendarTriggerRef.current = triggerSystemMessage;
  }, [triggerSystemMessage]);

  // Keep ticket handler ref current (same pattern as calendarTriggerRef)
  useEffect(() => {
    ticketTerminatedRef.current = (ticket: TerminatedTicket) => {
      let prompt = '';
      if (ticket.status === 'completed') {
        prompt = `[SYSTEM: Opey just finished the engineering ticket "${ticket.title}". Let Steven know it's done — keep it natural and brief.]`;
      } else if (ticket.status === 'failed') {
        const reason = ticket.failureReason ? ` Failure reason: ${ticket.failureReason}.` : '';
        prompt = `[SYSTEM: The engineering ticket "${ticket.title}" has failed.${reason} Let Steven know something went wrong — brief and empathetic.]`;
      } else if (ticket.status === 'pr_ready') {
        const prLink = ticket.finalPrUrl ? ` PR: ${ticket.finalPrUrl}` : '';
        prompt = `[SYSTEM: Opey opened a pull request for "${ticket.title}".${prLink} Let Steven know the PR is ready for review.]`;
      } else if (ticket.status === 'needs_clarification') {
        const questions = ticket.clarificationQuestions ?? 'some clarifying questions';
        prompt = `[SYSTEM: Opey has started working on "${ticket.title}" but needs clarification before he can implement it. His questions: ${questions}\n\nRelay these questions to Steven naturally — like you're passing along a message from a teammate. Keep it conversational. Once Steven answers, call submit_clarification with ticketId="${ticket.id}" and his response.]`;
      }
      if (prompt) void triggerSystemMessage(prompt);
    };
  }, [triggerSystemMessage]);

  // Subscribe to engineering ticket terminal status changes via Supabase Realtime
  // Unsubscribes automatically when session/character goes away
  useEffect(() => {
    if (!selectedCharacter || !session) return;
    return subscribeToTicketUpdates((ticket) => ticketTerminatedRef.current(ticket));
  }, [selectedCharacter, session]);

  const triggerIdleBreaker = useCallback(async () => {
    // UI Layer: Simple validation and trigger
    // Check if snoozed
    if (isSnoozed) {
      // Handle indefinite snooze (snoozeUntil is null)
      if (snoozeUntil === null) {
        console.log("⏸️ Check-ins are snoozed indefinitely");
        return; // Skip idle breaker while snoozed indefinitely
      }
      
      // Handle timed snooze
      const now = Date.now();
      if (now < snoozeUntil) {
        console.log("⏸️ Check-ins are snoozed until", new Date(snoozeUntil).toLocaleTimeString());
        return; // Skip idle breaker while snoozed
      } else {
        // Snooze period ended - clear state and return
        // Let the next naturally-scheduled check trigger instead of firing immediately
        setIsSnoozed(false);
        setSnoozeUntil(null);
        localStorage.removeItem('kayley_snooze_until');
        console.log("⏰ Snooze period ended (waiting for next scheduled check)");
        return; // Exit without triggering check-in immediately
      }
    }
    
    // If both check-ins and news are disabled, don't trigger anything
    if (!proactiveSettings.checkins && !proactiveSettings.news) {
      console.log("💤 Both check-ins and news are disabled, skipping idle breaker");
      return;
    }
    
    if (idleThinkingInFlightRef.current) {
      console.log("[IdleThinking] Idle thinking already in flight, skipping");
      return;
    }

    const idleNow = Date.now();
    lastIdleActionAtRef.current = idleNow;

    console.log("[IdleThinking] User is idle. Running idle thinking tick...");

    try {
      // idleThinkingInFlightRef.current = true;
      // const result = await runIdleThinkingTick({
      //   allowStoryline: proactiveSettings.checkins,
      //   allowQuestion: proactiveSettings.checkins,
      //   allowBrowse: proactiveSettings.news,
      // });
      // console.log("[IdleThinking] Idle thinking result:", result);
      console.log("IDLE THINK COMMENTED OUT")
    } catch (error) {
      console.error("[IdleThinking] Error:", error);
    } finally {
      idleThinkingInFlightRef.current = false;
    }

    return;
  }, [
    isSnoozed,
    snoozeUntil,
    proactiveSettings.checkins,
    proactiveSettings.news,
    activeService,
    selectedCharacter,
    session,
    relationship,
    tasks,
    chatHistory,
    upcomingEvents,
    aiSession,
    isMuted,
    enqueueAudio,
    playAction
  ]);

  // ==========================================================================
  // IDLE & PREFETCH EFFECTS
  // ==========================================================================

  // Idle timeout check (2 minutes)
  useEffect(() => {
    const IDLE_TIMEOUT = 2 * 60 * 1000; // 2 minutes
    const IDLE_CHECK_INTERVAL = 30000; // 30 seconds

    const checkIdle = () => {
      const now = Date.now();
      if (!isIdle(IDLE_TIMEOUT)) return;
      if (isProcessingAction || isSpeaking) return;

      const lastActionAt = lastIdleActionAtRef.current ?? 0;
      if (now - lastActionAt < IDLE_TIMEOUT) return;

      triggerIdleBreaker();
    };

    const interval = window.setInterval(checkIdle, IDLE_CHECK_INTERVAL);
    return () => window.clearInterval(interval);
  }, [isIdle, isProcessingAction, isSpeaking, triggerIdleBreaker]);

  // 🚀 OPTIMIZATION: Pre-fetch context on idle (30s)
  useEffect(() => {
    if (!selectedCharacter || !session) return;

    const PREFETCH_IDLE_TIMEOUT = 30000; // 30 seconds
    let prefetchTriggered = false;

    const checkPrefetch = () => {
      if (prefetchTriggered) return;

      const now = Date.now();
      const timeSinceInteraction = now - lastInteractionAt;

      if (timeSinceInteraction > PREFETCH_IDLE_TIMEOUT && !isProcessingAction && !isSpeaking) {
        prefetchOnIdle();
        prefetchTriggered = true;
      }
    };

    const interval = window.setInterval(checkPrefetch, 5000);
    return () => {
      window.clearInterval(interval);
      clearPrefetchCache();
    };
  }, [lastInteractionAt, isProcessingAction, isSpeaking, selectedCharacter, session]);

  // ==========================================================================
  // KEYBOARD SHORTCUTS
  // ==========================================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + T to toggle task panel
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        if (view === 'chat' && selectedCharacter) {
          setIsTaskPanelOpen(prev => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, selectedCharacter]);

  // ==========================================================================
  // GMAIL & CALENDAR POLLING EFFECTS
  // ==========================================================================


  // Calendar polling effects - now handled by useCalendar hook
  useEffect(() => {
    return registerCalendarEffects();
  }, [registerCalendarEffects]);

  // Calendar check-in effect
  useEffect(() => {
    if (!selectedCharacter || weekEvents.length === 0 || !proactiveSettings.calendar) return;

    // Check every 2 minutes
    const interval = setInterval(() => {
      checkForApplicableCheckins(weekEvents);
    }, 2 * 60 * 1000);

    // Initial check after delay (to avoid firing on initial load)
    const initialCheck = setTimeout(() => {
      checkForApplicableCheckins(weekEvents);
    }, 30000);

    return () => {
      clearInterval(interval);
      clearTimeout(initialCheck);
    };
  }, [weekEvents, selectedCharacter, proactiveSettings.calendar, checkForApplicableCheckins]);

  useEffect(() => {
    const handleAuthError = async () => {
      console.log('Google Auth error detected. Attempting forced refresh...');
      try {
        await refreshSession({ force: true, reason: 'gmail_or_calendar_401' });
      } catch (err) {
        console.warn('Background refresh failed:', err);
      }
    };

    gmailService.addEventListener('auth-error', handleAuthError);
    calendarService.addEventListener('auth-error', handleAuthError);

    return () => {
      gmailService.removeEventListener('auth-error', handleAuthError);
      calendarService.removeEventListener('auth-error', handleAuthError);
    };
  }, [refreshSession]); 

  // ==========================================================================
  // EMAIL: Announce the current pending email (FIFO — one at a time)
  // Fires a lightweight Gemini call to let Kayley react naturally.
  // ==========================================================================
  useEffect(() => {
    if (!currentPendingEmail || !selectedCharacter) return;

    // Already announced this one — skip (guards against re-renders)
    if (announcedEmailIdRef.current === currentPendingEmail.id) return;
    announcedEmailIdRef.current = currentPendingEmail.id;

    const announceEmail = async () => {
      const log = clientLogger.scoped('App:Email');
      log.info('Announcing new email', { messageId: currentPendingEmail.id, from: currentPendingEmail.from });

      try {
        // 1. Load user facts so Kayley knows who Steven is and recognizes senders
        let userContext: string | undefined;
        try {
          const facts = await getUserFacts();
          if (facts.length > 0) userContext = formatFactsForAI(facts);
        } catch {
          // Non-fatal — announcement still works without context
        }

        // 2. Lightweight Gemini call — Kayley summarizes and asks what to do
        const announcement = await generateEmailAnnouncement(currentPendingEmail, userContext);

        // 3. Add to chat history so the conversation makes sense when Steven replies
        setChatHistory(prev => [...prev, { role: 'model' as const, text: announcement }]);

        // 4. Save to conversation_history so email interactions are tracked like any other chat
        conversationHistoryService.appendConversationHistory(
          [{ role: 'model', text: announcement }], aiSession?.interactionId
        ).catch(err => log.error('Failed to save email announcement to conversation_history', { err: String(err) }));

        // 5. TTS — Gates: Disable Audio
        // if (!isMuted) {
        //   const audioData = await generateSpeech(announcement);
        //   if (audioData) media.enqueueAudio(audioData);
        // }

        // 6. Persist to kayley_email_actions as 'pending'.
        // Note: the server (gmailPoller) may have already written this row — ignore 23505.
        const { error } = await supabase.from('kayley_email_actions').insert({
          gmail_message_id: currentPendingEmail.id,
          gmail_thread_id:  currentPendingEmail.threadId,
          from_address:     currentPendingEmail.from,
          subject:          currentPendingEmail.subject,
          action_taken:     'pending',
          kayley_summary:   announcement,
          announced_at:     new Date().toISOString(),
        });
        if (error && error.code !== '23505') {
          log.error('Failed to insert email action record', { err: error.message });
        }

        log.info('Email announced successfully', { messageId: currentPendingEmail.id });
      } catch (err) {
        clientLogger.error('[App:Email] Failed to announce email', { err: String(err) });
      }
    };

    announceEmail();
  }, [currentPendingEmail, selectedCharacter, isMuted]);

  // ==========================================================================
  // EMAIL: Execute action returned by orchestrator + generate confirmation
  // ==========================================================================
  const executeEmailAction = useCallback(async (emailAction: {
    action: 'archive' | 'reply' | 'dismiss' | 'send';
    message_id?: string;
    thread_id?: string;
    to?: string;
    subject?: string;
    reply_body?: string;
  }) => {
    if (!session?.accessToken) return;

    const log = clientLogger.scoped('App:Email');
    log.info('Executing email action', { action: emailAction.action, messageId: emailAction.message_id, to: emailAction.to });

    let success = false;

    // ---- Execute the action against Gmail API ----
    if (emailAction.action === 'archive') {
      if (!emailAction.message_id) { log.error('Archive missing message_id'); return; }
      success = await gmailService.archiveEmail(session.accessToken, emailAction.message_id);

    } else if (emailAction.action === 'reply') {
      if (!emailAction.reply_body) {
        log.error('Reply action missing reply_body', { emailAction });
        return;
      }

      // Use currentPendingEmail if still in queue; otherwise look up from DB.
      // Also pulls thread_id from DB when the model didn't include it — which happens
      // on follow-up replies after the queue was already advanced.
      let emailContext = currentPendingEmail;
      if (!emailContext && emailAction.message_id) {
        const { data } = await supabase
          .from('kayley_email_actions')
          .select('from_address, subject, gmail_thread_id')
          .eq('gmail_message_id', emailAction.message_id)
          .single();
        if (data) {
          // Prefer the DB thread_id — the model may have omitted it
          if (!emailAction.thread_id && data.gmail_thread_id) {
            emailAction.thread_id = data.gmail_thread_id;
          }
          emailContext = {
            id: emailAction.message_id, threadId: emailAction.thread_id ?? '',
            from: data.from_address, subject: data.subject,
            snippet: '', body: '', receivedAt: '',
          };
        }
      }

      if (!emailContext || !emailAction.thread_id) {
        log.error('Reply action: missing email context or thread_id (not in queue or DB)', { emailAction });
        return;
      }

      // Polish Steven's rough intent into a proper email.
      // Calendar events are passed so Kayley can reference travel dates, busy periods, etc.
      log.info('Polishing reply with LLM + calendar context', { eventCount: upcomingEvents.length });
      const polishedBody = await composePolishedReply(
        emailAction.reply_body,
        emailContext,
        upcomingEvents,
      );
      log.info('Reply polished', { original: emailAction.reply_body, polished: polishedBody });

      // Extract plain email address from "Name <email@example.com>"
      const toMatch = emailContext.from.match(/<(.+?)>/);
      const toAddress = toMatch ? toMatch[1] : emailContext.from;

      success = await gmailService.sendReply(
        session.accessToken,
        emailAction.thread_id,
        toAddress,
        emailContext.subject,
        polishedBody,    // send the polished version, not the raw AI output
      );

    } else if (emailAction.action === 'send') {
      // Ad-hoc email — no pending email in queue, Kayley composes from scratch
      if (!emailAction.to || !emailAction.subject || !emailAction.reply_body) {
        log.error('Send action missing to, subject, or reply_body', { emailAction });
        return;
      }

      // Stub a minimal email payload so composePolishedReply has recipient/subject context
      const stubEmail = {
        id: '', threadId: '', from: emailAction.to, subject: emailAction.subject,
        snippet: '', body: '', receivedAt: new Date().toISOString(),
      };

      log.info('Polishing ad-hoc email with LLM + calendar context', { to: emailAction.to });
      const polishedBody = await composePolishedReply(emailAction.reply_body, stubEmail, upcomingEvents);
      log.info('Ad-hoc email polished', { polished: polishedBody });

      success = await gmailService.sendReply(
        session.accessToken,
        null,           // no threadId — creates a new thread
        emailAction.to,
        emailAction.subject,
        polishedBody,
      );

    } else if (emailAction.action === 'dismiss') {
      success = true; // No API call needed — just acknowledge and move on
    }

    if (!success) {
      log.error('Email action execution failed', { action: emailAction.action });
      setChatHistory(prev => [...prev, { role: 'model' as const, text: "Hmm, something went wrong on my end — couldn't do that. Try again?" }], aiSession?.interactionId);
      return;
    }

    // ---- Update DB record (only for queue-based actions that have a message_id) ----
    if (emailAction.message_id) {
      const dbAction = emailAction.action === 'dismiss' ? 'dismissed' : emailAction.action;
      await supabase
        .from('kayley_email_actions')
        .update({ action_taken: dbAction, reply_body: emailAction.reply_body ?? null, actioned_at: new Date().toISOString() })
        .eq('gmail_message_id', emailAction.message_id);
    }

    // ---- Lightweight Gemini call — Kayley confirms what she did ----
    try {
      // Map 'send' → 'reply' for the confirmation message — both mean "email sent"
      const confirmAction = emailAction.action === 'send' ? 'reply' : emailAction.action;
      const confirmEmail = currentPendingEmail ?? {
        id: '', threadId: '', from: emailAction.to ?? '', subject: emailAction.subject ?? '',
        snippet: '', body: '', receivedAt: new Date().toISOString(),
      };
      const confirmation = await generateEmailConfirmation(confirmAction as 'archive' | 'reply' | 'dismiss', confirmEmail as any);
      setChatHistory(prev => [...prev, { role: 'model' as const, text: confirmation }]);

      // Gates: Disable Audio
      // if (!isMuted) {
      //   const audioData = await generateSpeech(confirmation);
      //   if (audioData) media.enqueueAudio(audioData);
      // }
    } catch (err) {
      log.error('Failed to generate confirmation', { err: String(err) });
    }

    log.info('Email action complete', { action: emailAction.action });

    // ---- Only advance the FIFO queue for queue-based actions (not ad-hoc sends) ----
    if (emailAction.action !== 'send') {
      advanceEmailQueue();
      announcedEmailIdRef.current = null; // reset so next email can be announced
    }
  }, [session, currentPendingEmail, isMuted, advanceEmailQueue, upcomingEvents]);

  // ==========================================================================
  // CHARACTER SELECTION & IMAGE UPDATE
  // (CRUD operations moved to useCharacterManagement hook)
  // ==========================================================================

  const handleSelectCharacter = async (character: CharacterProfile) => {
    setErrorMessage(null);
    setIsLoadingCharacter(true);
    setLoadingCharacterName(character.displayName || character.name);
    
    // Cleanup old action URLs (idle videos are now public URLs - no cleanup needed!)
    cleanupActionUrls(actionVideoUrls);

    // Create action URLs (still using Blobs for now for backward compatibility)
    const newActionUrls = character.actions.reduce((map, action) => {
      map[action.id] = URL.createObjectURL(action.video);
      return map;
    }, {} as Record<string, string>);

    setActionVideoUrls(newActionUrls);
    setSelectedCharacter(character);
    
    // Phase 1 Optimization: Build action key map for LLM response resolution
    if (character.actions?.length) {
      buildActionKeyMap(character.actions);
      // console.log(`🔑 Built action key map for ${character.actions.length} actions`);
    }


    // Load tasks (handled by useTasks hook)
     const currentTasks = await loadTasks();
    
    // Load snooze state (handled by useProactiveSettings hook)
    loadSnoozeState();

    // Initialize Queue with shuffled idle video URLs (already public URLs!)
    let initialQueue = shuffleArray([...character.idleVideoUrls]);
    
    // Ensure we have enough items in queue for smooth playback
    while (initialQueue.length < 5 && character.idleVideoUrls.length > 0) {
        initialQueue = [...initialQueue, ...shuffleArray(character.idleVideoUrls)];
    }
    
    // Set queue - currentVideoSrc and nextVideoSrc are derived automatically
    media.setVideoQueue(initialQueue);
    setCurrentActionId(null);
    
    try {
      // ============================================
      // FRESH SESSION: Don't load history anymore!
      // AI uses memory tools to recall past context
      // ============================================
      console.log('🧠 [App] Starting FRESH session - AI will use memory tools for context');

      // Still load relationship data for tone/personality
      const relationshipData = await relationshipService.getRelationship();
      setRelationship(relationshipData);
      
        // 1. Check if any conversation occurred today (DB source of truth)
        const messageCount = await conversationHistoryService.getTodaysMessageCount();
        const googleAccessToken = await getAccessToken()
        // Start with fresh session
        const session: AIChatSession = { model: activeService.model };
        const handleStartupSelfie = async (
          selfieAction: { scene?: string; mood?: string; outfit?: string } | null | undefined,
          baseHistory: ChatMessage[]
        ) => {
          if (!selfieAction?.scene) return;

          const selfieResult = await processSelfieAction(selfieAction, {
            userMessage: "pending message delivery",
            chatHistory: baseHistory,
            upcomingEvents,
          });

          if (selfieResult.success && selfieResult.imageBase64) {
            setChatHistory(prev => {
              if (prev.length === 0) return prev;
              const updated = [...prev];
              const lastIndex = updated.length - 1;
              const lastMessage = updated[lastIndex];

              if (lastMessage.role === 'model' && !lastMessage.assistantImage) {
                updated[lastIndex] = {
                  ...lastMessage,
                  assistantImage: selfieResult.imageBase64,
                  assistantImageMimeType: selfieResult.mimeType || 'image/png',
                };
              } else {
                updated.push({
                  role: 'model',
                  text: '',
                  assistantImage: selfieResult.imageBase64,
                  assistantImageMimeType: selfieResult.mimeType || 'image/png',
                });
              }

              return updated;
            });
          } else if (selfieResult.error) {
            console.error('Selfie generation failed on startup:', selfieResult.error);
          }
        };
        

        if (!hasBeenBriefedToday()) {
          console.log("[App] First login today - generating greeting with daily logistics");
          console.log('googleAccessToken: ', googleAccessToken)
          const { greeting, session: updatedSession } = await activeService.generateGreeting(googleAccessToken.accessToken);
          setAiSession(updatedSession);
        // Important: set localStorage so we do not need to query database
          markBriefedToday()
          console.log("Has Been Briefed : ", hasBeenBriefedToday())
          const initialHistory = [{ role: 'model' as const, text: greeting.text_response }];
          
          setChatHistory(initialHistory);
          await handleStartupSelfie(greeting.selfie_action, initialHistory);
          await conversationHistoryService.appendConversationHistory(
            [{ role: 'model', text: greeting.text_response }],
            updatedSession.interactionId
          );

        } else {
          // CONVERSATION OCCURRED TODAY: Reload all exchanges and generate informal "welcome back"
          console.log(`🧠 [App] Chat detected today (${messageCount} messages) - reloading history and generating non-greeting`);
          const existingInteractionId = await conversationHistoryService.getTodaysInteractionId();
          if (existingInteractionId) {
            console.log(`🔗 [App] Restoring today's interaction ID: ${existingInteractionId}`);
            session.interactionId = existingInteractionId;
          }

          const todayHistory = await conversationHistoryService.loadTodaysConversationHistory();
          setChatHistory(todayHistory);

          const { greeting: backMessage, session: updatedSession } = await activeService.generateNonGreeting(session, googleAccessToken.accessToken);
          setAiSession(updatedSession);

          // Append the "welcome back" message to the restored history
          const updatedHistory = [...todayHistory, { role: 'model' as const, text: backMessage.text_response }];
          setChatHistory(updatedHistory);
          await handleStartupSelfie(backMessage.selfie_action, updatedHistory);

          // Save the interaction record
          await conversationHistoryService.appendConversationHistory(
            [{ role: 'model', text: backMessage.text_response }],
            updatedSession.interactionId || session.interactionId // Restore interactionId here
          );

        }

        // Reset the last saved index since we're starting fresh
        setLastSavedMessageIndex(-1);

    
      setView('chat');
    } catch (error) {
      setErrorMessage('Failed to load character data.');
    } finally {
      setIsLoadingCharacter(false);
      setLoadingCharacterName(null);
    }
  };

  const handleUpdateImage = async (character: CharacterProfile) => {
    // Create a hidden file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setIsUpdatingImage(true);
      setErrorMessage(null);

      try {
        // Read the image file
        const reader = new FileReader();
        reader.readAsDataURL(file);
        
        reader.onload = async () => {
          const base64data = reader.result as string;
          const [, base64Content] = base64data.split(',');
          
          // Update in database
          await dbService.updateCharacterImage(character.id, {
            base64: base64Content,
            mimeType: file.type,
            fileName: file.name,
          });

          // Update in local state
          applyCharacterUpdate(character.id, (char) => ({
            ...char,
            image: {
              file,
              base64: base64Content,
              mimeType: file.type,
            },
          }));

          // If this is the selected character, update that too
          if (selectedCharacter?.id === character.id) {
            setSelectedCharacter((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                image: {
                  file,
                  base64: base64Content,
                  mimeType: file.type,
                },
              };
            });
          }

          setIsUpdatingImage(false);
        };

        reader.onerror = () => {
          setErrorMessage('Failed to read image file.');
          setIsUpdatingImage(false);
        };
      } catch (error) {
        reportError('Failed to update character image.', error);
        setIsUpdatingImage(false);
      }
    };

    input.click();
  };

  const handleUserInterrupt = () => {
    // Only interrupt if she is currently speaking or has audio queued
    if (isSpeaking || media.audioQueue.length > 0) {
      console.log("🛑 User interrupted! Stopping audio.");

      // 1. Stop the current audio immediately and clear queue
      // This will make media.currentAudioSrc null, unmounting the player
      media.setAudioQueue([]);

      // 2. Reset speaking state
      setIsSpeaking(false);

      // 3. (Optional) Add a visual reaction to chat history
      // This helps the user know she stopped on purpose
      setChatHistory(prev => [
        ...prev, 
        { role: 'model', text: "*(Stops speaking)* Oh, sorry, go ahead." }
      ]);
    }
  };

  const markInteraction = () => {
    registerInteraction();
    lastIdleActionAtRef.current = null;
    handleUserInterrupt();
  };

  // ==========================================================================
  // MAIN MESSAGE HANDLER (Refactored to use messageOrchestrator)
  // ==========================================================================

  const handleSendMessage = async (
    message: string,
    attachment?: PendingChatAttachment
  ) => {
    if (!selectedCharacter || !session) return;
    registerInteraction();
    lastIdleActionAtRef.current = null;
    setErrorMessage(null);
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !attachment) return;
    setIsProcessingAction(true);

    if (attachment?.kind === 'image') {
      const userText = trimmedMessage || '📷 [Sent an Image]';
      setChatHistory(prev => [
        ...prev,
        { role: 'user' as const, text: userText, image: attachment.base64, imageMimeType: attachment.mimeType },
      ]);

      try {
        const sessionToUse: AIChatSession = aiSession || { model: activeService.model };
          console.log("SENDING MESSAGE")
        const { response, session: updatedSession, audioData } = await activeService.generateResponse(
          {
            type: 'image_text',
            text: trimmedMessage || "What do you think of this?",
            imageData: attachment.base64,
            mimeType: attachment.mimeType,
          },
          {
            chatHistory: chatHistory,
            googleAccessToken: session?.accessToken,
          },
          sessionToUse
        );

        setAiSession(updatedSession);
        setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);

        await conversationHistoryService.appendConversationHistory(
          [{ role: 'user', text: userText }, { role: 'model', text: response.text_response }],
          updatedSession?.interactionId || aiSession?.interactionId
        );

        if (!isMuted && audioData) {
          enqueueAudio(audioData);
        }

        // if (response.action_id) {
        //   playAction(response.action_id);
        // }
        if (response.open_app) {
          console.log("🚀 Launching app:", response.open_app);
          window.location.href = response.open_app;
        }
      } catch (error) {
        console.error('Error sending image:', error);
        setErrorMessage('Failed to process image.');
      } finally {
        setIsProcessingAction(false);
      }
      return;
    }

    if (attachment?.kind === 'file') {
      const userText = trimmedMessage || '[Sent a File]';
      const messageForAI = buildFileAttachmentPayload(message, attachment);

      setChatHistory(prev => [
        ...prev,
        {
          role: 'user' as const,
          text: userText,
          fileAttachment: {
            name: attachment.fileName,
            mimeType: attachment.mimeType,
            size: attachment.size,
          },
        },
      ]);

      try {
        const result = await processUserMessage({
          userMessage: userText,
          userMessageForAI: messageForAI,
          aiService: activeService,
          session: aiSession,
          accessToken: session.accessToken,
          chatHistory,
          upcomingEvents,
          tasks,
          isMuted,
          pendingEmail: currentPendingEmail,
        });

        if (result.updatedSession) setAiSession(result.updatedSession);
        if (result.error) setErrorMessage(result.error);

        const maybePlayResponseAction = (actionId?: string | null) => {
          if (actionId) {
            playAction(actionId, true);
          }
        };

        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...result.chatMessages]);
        if (result.audioToPlay && !isMuted) media.enqueueAudio(result.audioToPlay);
        maybePlayResponseAction(result.actionToPlay);
        if (result.appToOpen) window.location.href = result.appToOpen;
        if (result.refreshCalendar && session) refreshCalendarEvents(session.accessToken);
        if (result.refreshTasks) refreshTasks();
        if (result.openTaskPanel) setIsTaskPanelOpen(true);
      } catch (error) {
        console.error('❌ [App] File attachment processing failed:', error);
        setErrorMessage('Failed to process attachment');
      } finally {
        setIsProcessingAction(false);
      }
      return;
    }

    const updatedHistory = [...chatHistory, { role: 'user' as const, text: trimmedMessage }];
    setChatHistory(updatedHistory);

    // Optimistic action prediction (UI responsiveness)
    let predictedActionId: string | null = null;
    let talkingActionId: string | null = null;
    if (selectedCharacter.actions) {
      predictedActionId = predictActionFromMessage(trimmedMessage, selectedCharacter.actions);
    }
    if (predictedActionId) {
      // console.log(`⚡ Optimistically playing action: ${predictedActionId}`);
      playAction(predictedActionId, true);
    } else if (isQuestionMessage(trimmedMessage)) {
      talkingActionId = playRandomTalkingAction(true);
    }

    try {
      // ============================================
      // ORCHESTRATOR: AI Call + Background Processing
      // ============================================
      const result = await processUserMessage({
        userMessage:  trimmedMessage,
        aiService:    activeService,
        session:      aiSession,
        accessToken:  session.accessToken,
        chatHistory,
        upcomingEvents,
        tasks,
        isMuted,
        pendingEmail: currentPendingEmail, // inject pending email context when present
      });

      if (result.updatedSession) setAiSession(result.updatedSession);
      if (result.error) setErrorMessage(result.error);

      const maybePlayResponseAction = (actionId?: string | null) => {
        if (actionId && actionId !== predictedActionId && actionId !== talkingActionId) {
          playAction(actionId, true);
        }
      };

      // ============================================
      // ACTION-SPECIFIC PROCESSING (Phase 6: Simplified)
      // ============================================

      // TASK ACTIONS (Phase 6: Detection in orchestrator, execution here for React callbacks)
      if (result.detectedTaskAction) {
        await processTaskAction(result.detectedTaskAction, tasks, {
          handleTaskCreate, handleTaskToggle, handleTaskDelete, setIsTaskPanelOpen,
        });
      }

      // EMAIL ACTIONS (archive / reply / dismiss a pending email)
      // Apply the normal chat message first (Kayley's in-chat response),
      // then execute the Gmail action + generate confirmation.
      if (result.detectedEmailAction) {
        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...result.chatMessages]);
        if (result.audioToPlay && !isMuted) media.enqueueAudio(result.audioToPlay);
        await executeEmailAction(result.detectedEmailAction);
        return;
      }

      // NEWS ACTIONS (orchestrator fetched, we trigger system message)
      if (result.newsPrompt) {
        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...result.chatMessages]);
        if (result.audioToPlay) media.enqueueAudio(result.audioToPlay);
        await triggerSystemMessage(result.newsPrompt);
        return;
      }

      // SELFIE ACTIONS (Phase 5: Use orchestrator-generated message text)
      if (result.selfieImage || result.selfieError) {
        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...result.chatMessages]);
        if (result.audioToPlay) media.enqueueAudio(result.audioToPlay);
        const selfieMsg = result.selfieMessageText || (result.selfieImage ? "Here you go!" : "I couldn't take that pic right now, sorry!");
        if (result.selfieImage) {
          setChatHistory(prev => [...prev, { role: 'model', text: selfieMsg, assistantImage: result.selfieImage.base64, assistantImageMimeType: result.selfieImage.mimeType }]);
        } else {
          setChatHistory(prev => [...prev, { role: 'model', text: selfieMsg }]);
        }
        // Gates: Disable Audio
        // if (!isMuted) { const audio = await generateSpeech(selfieMsg); if (audio) media.enqueueAudio(audio); }
        maybePlayResponseAction(result.actionToPlay);
        return;
      }

      // VIDEO ACTIONS (Generate companion video)
      if (result.videoUrl || result.videoError) {
        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...result.chatMessages]);
        if (result.audioToPlay) media.enqueueAudio(result.audioToPlay);
        const videoMsg = result.videoMessageText || (result.videoUrl ? "Here's a little video for you!" : "I couldn't make that video right now, sorry!");
        if (result.videoUrl) {
          setChatHistory(prev => [...prev, { role: 'model', text: videoMsg, assistantVideoUrl: result.videoUrl }]);
        } else {
          setChatHistory(prev => [...prev, { role: 'model', text: videoMsg }]);
        }
        maybePlayResponseAction(result.actionToPlay);
        return;
      }

      // ============================================
      // DEFAULT: Apply standard results
      // ============================================
      if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...result.chatMessages]);
      if (result.audioToPlay && !isMuted) media.enqueueAudio(result.audioToPlay);
      maybePlayResponseAction(result.actionToPlay);
      if (result.appToOpen) window.location.href = result.appToOpen;
      if (result.refreshCalendar && session) refreshCalendarEvents(session.accessToken);
      if (result.refreshTasks) refreshTasks();
      if (result.openTaskPanel) setIsTaskPanelOpen(true);

    } catch (error) {
      console.error('❌ [App] Message processing failed:', error);
      setErrorMessage('Failed to process message');
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ==========================================================================
  // VIDEO & WHITEBOARD HANDLERS
  // ==========================================================================

  const handleVideoEnd = () => {
    // Shift the queue - remove the video that just finished
    media.setVideoQueue(prev => {
        const newQueue = prev.slice(1);
        
        // Replenish if queue is getting low
        if (newQueue.length < 3 && selectedCharacter && selectedCharacter.idleVideoUrls.length > 0) {
            return [...newQueue, ...shuffleArray(selectedCharacter.idleVideoUrls)];
        }
        return newQueue;
    });
    
    setCurrentActionId(null);
  };

  // Whiteboard AI Interaction Handler (extracted to src/handlers/whiteboardHandler.ts)
  const handleWhiteboardCapture = async (
    base64: string,
    userMessage: string,
    modeContext: string
  ): Promise<{ textResponse: string; whiteboardAction?: WhiteboardAction | null }> => {
    return handleWhiteboardCaptureHandler(base64, userMessage, modeContext, {
      selectedCharacter,
      session,
      aiSession,
      activeService,
      setAiSession,
      playAction,
      isMutedRef,
      enqueueAudio: media.enqueueAudio,
    });
  };

  // ==========================================================================
  // RENDER
  // ==========================================================================

  if (!session || authStatus !== 'connected') {
    return <LoginPage />;
  }

  return (
    <div className="bg-gray-900 text-gray-100 h-screen overflow-hidden flex flex-col p-4 md:p-8">
      <AuthWarningBanner />
      <div className="flex-1 flex flex-col relative overflow-hidden chat-container z-10 p-2 sm:p-4">
      {/* Audio Player (Hidden) - plays audio responses sequentially */}
      {media.currentAudioSrc && (
        <AudioPlayer 
            src={media.currentAudioSrc} 
            onStart={handleSpeechStart}
            onEnded={() => {
                setIsSpeaking(false);
                handleAudioEnd();
            }}
        />
      )}

      <header className="text-center mb-4 relative flex-shrink-0">
        <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-600">
          Interactive Video Character
        </h1>
        <div className="absolute top-0 right-0 flex items-center gap-2">
          {/* Task Panel Toggle - Only visible in chat view */}
          {view === 'chat' && selectedCharacter && (
            <button
              onClick={() => setIsTaskPanelOpen(!isTaskPanelOpen)}
              className="bg-gradient-to-br from-purple-500 to-indigo-600 text-white rounded-full p-3 shadow-lg transition-all hover:scale-110 relative"
              title={isTaskPanelOpen ? 'Close checklist' : 'Open checklist'}
            >
              {tasks.filter(t => !t.completed).length > 0 && !isTaskPanelOpen && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {tasks.filter(t => !t.completed).length}
                </span>
              )}
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </button>
          )}
          
            <SettingsPanel
            proactiveSettings={selectedCharacter ? proactiveSettings : undefined}
            onProactiveSettingsChange={selectedCharacter ? updateProactiveSettings : undefined}
              onAdminDashboard={() => setView('admin')}
          />
        </div>
      </header>
      
      <main className="flex-grow min-h-0 bg-gray-800/50 rounded-2xl p-4 md:p-6 shadow-2xl shadow-black/30 backdrop-blur-sm border border-gray-700">
        {errorMessage && <div className="bg-red-500/20 border border-red-500 text-red-300 p-3 rounded-lg mb-4 text-center">{errorMessage}</div>}
        
        {view === 'loading' && <div className="flex items-center justify-center h-full"><LoadingSpinner /></div>}
        
        {view === 'selectCharacter' && (
            <CharacterSelector 
                characters={displayCharacters}
                onSelectCharacter={handleSelectCharacter}
                onCreateNew={() => setView('createCharacter')}
                onManageCharacter={handleManageCharacter}
                isLoading={isLoadingCharacter}
                loadingCharacterName={loadingCharacterName}
            />
        )}

        {view === 'createCharacter' && (
             <ImageUploader 
                onImageUpload={handleImageUpload}
                onSelectLocalVideo={handleSelectLocalVideo}
                imagePreview={uploadedImage?.base64 ? `data:${uploadedImage.mimeType};base64,${uploadedImage.base64}` : null}
                isSaving={isSavingCharacter}
                onBack={handleBackToSelection}
              />
        )}

        {view === 'manageCharacter' && characterForManagement && (
            <CharacterManagementView
                character={characterForManagement}
                actions={managedActions}
                idleVideos={managedIdleVideos}
                onBack={() => {
                    setCharacterForManagement(null);
                    setView('selectCharacter');
                }}
                onUpdateImage={() => handleUpdateImage(characterForManagement)}
                onDeleteCharacter={() => {
                    handleDeleteCharacter(characterForManagement.id);
                    setCharacterForManagement(null);
                    setView('selectCharacter');
                }}
                onCreateAction={handleCreateAction}
                onUpdateAction={handleUpdateAction}
                onDeleteAction={handleDeleteAction}
                onAddIdleVideo={handleAddIdleVideo}
                onDeleteIdleVideo={handleDeleteIdleVideo}
                isCreatingAction={isCreatingAction}
                updatingActionId={updatingActionId}
                deletingActionId={deletingActionId}
                isAddingIdleVideo={isAddingIdleVideo}
                deletingIdleVideoId={deletingIdleVideoId}
            />
        )}

        {view === 'chat' && selectedCharacter && (
             <div className={`relative grid gap-8 h-full ${
               isVideoVisible 
                 ? 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-2 lg:grid-rows-1' 
                 : 'grid-cols-1 grid-rows-[minmax(0,1fr)]'
             }`}>
                <button 
                  onClick={handleBackToSelection} 
                  className="absolute top-2 left-2 z-30 bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2 transition-colors"
                  title="Back to Character Selection"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>

                <button 
                  onClick={() => setIsVideoVisible(!isVideoVisible)}
                  className="absolute top-2 left-14 z-30 bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2 transition-colors"
                  title={isVideoVisible ? "Hide Video Panel" : "Show Video Panel"}
                >
                    {isVideoVisible ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                    )}
                </button>
                
                {isVideoVisible && (
                  <div className="h-64 lg:h-full flex items-center justify-center bg-black rounded-lg relative">
                     <button onClick={() => setIsMuted(!isMuted)} className="absolute top-2 right-2 z-30 bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2">
                        {isMuted ? "🔇" : "🔊"}
                     </button>
                     <VideoPlayer 
                       currentSrc={currentVideoSrc}
                       nextSrc={nextVideoSrc}
                       onVideoFinished={handleVideoEnd}
                       loop={false}
                       muted={isMuted}
                     />
                  </div>
                )}
                <div className="h-full min-h-0">
                  <ChatPanel
                    history={chatHistory}
                    onSendMessage={handleSendMessage}
                onOpenWhiteboard={() => setView('whiteboard')}
                    isSending={isProcessingAction}
                    onUserActivity={markInteraction}
                  />
                </div>
             </div>
        )}


        {view === 'whiteboard' && (
          <WhiteboardView
            onSendToAI={handleWhiteboardCapture}
            onClose={() => setView('chat')}
            disabled={isProcessingAction}
          />
        )}

          {view === 'admin' && (
            <AdminDashboardView
              onBack={() => setView('chat')}
            />
          )}
      </main>
      
      {/* Task Panel - Available in chat view */}
      {view === 'chat' && selectedCharacter && (
        <TaskPanel
          tasks={tasks}
          isOpen={isTaskPanelOpen}
          onToggle={() => setIsTaskPanelOpen(!isTaskPanelOpen)}
          onTaskToggle={handleTaskToggle}
          onTaskDelete={handleTaskDelete}
          onTaskCreate={handleTaskCreate}
        />
      )}
      </div>
    </div>
  );
};

export default App;
