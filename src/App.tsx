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
import * as conversationHistoryService from './services/conversationHistoryService';
import * as relationshipService from './services/relationshipService';
import type { RelationshipMetrics } from './services/relationshipService';
import { clientLogger } from './services/clientLogger';
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
import AdminDashboardView from './components/AdminDashboardView';
import { processSelfieAction } from './handlers/messageActions';
import type { PendingTweetDraft, OrchestratorResult } from './handlers/messageActions/types';
import { agentClient } from './services/agentClient';
import { useDebounce } from './hooks/useDebounce';
import { useMediaQueues } from './hooks/useMediaQueues';
import { useProactiveSettings } from './hooks/useProactiveSettings';
import { useIdleTracking } from './hooks/useIdleTracking';
import { useCharacterActions } from './hooks/useCharacterActions';
import { useCharacterManagement } from './hooks/useCharacterManagement';
import { AIChatSession } from './services/aiService';
import { startCleanupScheduler, stopCleanupScheduler } from './services/loopCleanupService';
import { processStorylineOnStartup } from './services/storylineService';
import { startStorylineIdleService, stopStorylineIdleService } from './services/storylineIdleService';
import { isQuestionMessage } from './utils/textUtils';
import { shuffleArray } from './utils/arrayUtils';
import { StorageKey } from './utils/enums';
import { getXAuthStatus, handleXAuthCallback, refreshRecentTweetMetrics } from './services/xClient';
import { handleOAuthCallback as handleAnthropicOAuthCallback } from './services/anthropicService';
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
import BackgroundTaskIndicator from './components/BackgroundTaskIndicator';

// ============================================================================
// CONSTANTS & TYPES
// ============================================================================
const ACTION_VIDEO_BUCKET = 'character-action-videos';

type View = 'loading' | 'selectCharacter' | 'createCharacter' | 'chat' | 'manageCharacter' | 'admin';

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

async function fetchGiphyGifUrl(query: string): Promise<string | null> {
  const apiKey = import.meta.env.VITE_GIPHY_API_KEY as string | undefined;
  if (!apiKey) return null;
  try {
    const url = new URL('https://api.giphy.com/v1/gifs/search');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    url.searchParams.set('rating', 'g');
    url.searchParams.set('lang', 'en');
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const payload = await res.json() as { data?: Array<{ images?: Record<string, { url?: string }> }> };
    const results = payload.data ?? [];
    for (const gif of results) {
      const url = gif.images?.['downsized']?.url ?? gif.images?.['fixed_height']?.url ?? gif.images?.['original']?.url;
      if (url) return url;
    }
    return null;
  } catch {
    return null;
  }
}

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
const LOG_PREFIX = '[App]';

const App: React.FC = () => {
  // --------------------------------------------------------------------------
  // X OAUTH CALLBACK HANDLER
  // --------------------------------------------------------------------------
  const [anthropicAuthStatus, setAnthropicAuthStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const anthropicCallbackHandledRef = useRef(false);
  const xCallbackHandledRef = useRef(false);

  // Anthropic OAuth callback handler
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === '/auth/anthropic/callback') {
      if (anthropicCallbackHandledRef.current) {
        return;
      }
      anthropicCallbackHandledRef.current = true;

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (code && state) {
        setAnthropicAuthStatus('processing');
        handleAnthropicOAuthCallback(code, state)
          .then((success) => {
            clientLogger.info(`${LOG_PREFIX} Anthropic OAuth callback`, { source: 'App.tsx', success });
            setAnthropicAuthStatus(success ? 'success' : 'error');
            window.history.replaceState({}, '', '/');
          })
          .catch((error) => {
            clientLogger.error(`${LOG_PREFIX} Anthropic OAuth callback failed`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
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
      if (xCallbackHandledRef.current) {
        return;
      }
      xCallbackHandledRef.current = true;

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (code && state) {
        handleXAuthCallback(code, state)
          .then(() => {
            clientLogger.info(`${LOG_PREFIX} X OAuth callback succeeded — account connected`, { source: 'App.tsx' });
            window.history.replaceState({}, '', '/');
          })
          .catch((error) => {
            clientLogger.error(`${LOG_PREFIX} X OAuth callback failed`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
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


  // --------------------------------------------------------------------------
  // MEDIA & CACHE HOOKS
  // --------------------------------------------------------------------------
  const media = useMediaQueues();


  // --------------------------------------------------------------------------
  // CHAT & PROCESSING STATE
  // --------------------------------------------------------------------------
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const isProcessingAction = pendingRequestCount > 0;
  const [activeToolCalls, setActiveToolCalls] = useState<import('./types').ToolCallDisplay[]>([]);
  const [aiSession, setAiSession] = useState<AIChatSession | null>(null);
  const [pendingTweetDraft, setPendingTweetDraft] = useState<PendingTweetDraft | null>(null);
  /** Stable session ID for the server agent — persists for this browser tab's lifetime */
  const webSessionIdRef = useRef<string>(`web-${crypto.randomUUID()}`);
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

  // Legacy in-app checklist was removed. Tasks now flow through Google Tasks via function tools.

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
    clientLogger.error(`${LOG_PREFIX} ${msg}`, { source: 'App.tsx' });
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
  // Calendar events are now fetched server-side on demand via calendar_action tool
  const ticketTerminatedRef = useRef<(ticket: TerminatedTicket) => void>(() => { });

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
              clientLogger.info(`${LOG_PREFIX} Cleaned up ${result.totalExpired} stale loops`, { source: 'App.tsx' });
            }
          }
        });
        
        return () => {
          stopCleanupScheduler();
        };
    } catch (e) {
      // Ignore if user ID check fails (e.g. env var missing in dev)
      clientLogger.error(`${LOG_PREFIX} [LoopCleanup] Error starting cleanup scheduler`, { source: 'App.tsx', error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // X Tweet Metrics: Refresh engagement metrics every 30 minutes
  useEffect(() => {
    const METRICS_INTERVAL = 30 * 60 * 1000; // 30 minutes

    const refreshMetricsIfConnected = async (mode: 'initial' | 'periodic') => {
      try {
        const status = await getXAuthStatus();
        if (!status.connected) {
          return;
        }
        await refreshRecentTweetMetrics();
      } catch (e) {
        clientLogger.warning(
          `${LOG_PREFIX} [X Metrics] ${mode === 'initial' ? 'Initial' : 'Periodic'} refresh failed`,
          { source: 'App.tsx', error: e instanceof Error ? e.message : String(e) },
        );
      }
    };

    // Initial refresh after a short delay
    const initialTimeout = setTimeout(() => {
      void refreshMetricsIfConnected('initial');
    }, 10000);

    const interval = setInterval(() => {
      void refreshMetricsIfConnected('periodic');
    }, METRICS_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  // ==========================================================================
  // UTILITY FUNCTIONS
  // ==========================================================================

  const reportError = useCallback((message: string, error?: unknown) => {
    clientLogger.error(`${LOG_PREFIX} ${message}`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
    setErrorMessage(message);
  }, []);

  // ==========================================================================
  // CHARACTER LOADING & MEMOIZED DATA
  // ==========================================================================

  const loadCharacters = useCallback(async () => {
    setView('loading');
    try {
      const savedCharacters = await dbService.getCharacters();
      setCharacters(savedCharacters.sort((a, b) => b.createdAt - a.createdAt));
      setView('selectCharacter');
    } catch (error) {
      clientLogger.error(`${LOG_PREFIX} Failed to load characters`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
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
        clientLogger.warning(`${LOG_PREFIX} [WorkspaceAgentChat] Failed to list runs for backfill`, { source: 'App.tsx', error: result.error });
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
    if (view !== 'chat' || !selectedCharacter) {
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
            },
          );

          if (selfieResult.success && selfieResult.imageBase64) {
            assistantImage = selfieResult.imageBase64;
            assistantImageMimeType = selfieResult.mimeType || 'image/png';
          } else if (selfieResult.error) {
            clientLogger.error(`${LOG_PREFIX} [PendingMessage] Selfie generation failed`, { source: 'App.tsx', error: selfieResult.error });
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
          clientLogger.warning(`${LOG_PREFIX} [PendingMessage] Delivery ack skipped or already claimed`, { source: 'App.tsx', pendingMessageId: pending.id });
        }
      } catch (error) {
        clientLogger.error(`${LOG_PREFIX} [PendingMessage] Delivery failed`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
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
  }, [aiSession?.interactionId, selectedCharacter, view]);

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
    if (!selectedCharacter) return;

    // 1. Show typing indicator immediately
    setPendingRequestCount(c => c + 1);

    try {
      // 2. Send system prompt through server agent (no user bubble)
      const result = await agentClient.sendMessage({
        message: systemPrompt,
        sessionId: webSessionIdRef.current,
        chatHistory,
        isMuted,
      });

      if (result.updatedSession) setAiSession(result.updatedSession);

      // 3. Add ONLY the AI response to chat history (No user bubble)
      if (result.chatMessages?.length > 0) {
        setChatHistory(prev => [...prev, ...result.chatMessages]);
      }

      // 4. Play Audio
      if (!isMuted && result.audioToPlay) enqueueAudio(result.audioToPlay);
      if (result.appToOpen) {
        clientLogger.info(`${LOG_PREFIX} Launching app`, { source: 'App.tsx', url: result.appToOpen });
        window.location.href = result.appToOpen;
      }

    } catch (error) {
      clientLogger.error(`${LOG_PREFIX} Briefing error`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
    } finally {
      setPendingRequestCount(c => Math.max(0, c - 1));
    }
  }, [
    aiSession,
    chatHistory,
    enqueueAudio,
    isMuted,
    selectedCharacter,
    playAction
  ]);

  // Keep ticket handler ref current
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
  useEffect(() => {
    if (!selectedCharacter) return;
    return subscribeToTicketUpdates((ticket) => ticketTerminatedRef.current(ticket));
  }, [selectedCharacter]);

  const triggerIdleBreaker = useCallback(async () => {
    // UI Layer: Simple validation and trigger
    // Check if snoozed
    if (isSnoozed) {
      // Handle indefinite snooze (snoozeUntil is null)
      if (snoozeUntil === null) {
        clientLogger.info(`${LOG_PREFIX} Check-ins are snoozed indefinitely`, { source: 'App.tsx' });
        return; // Skip idle breaker while snoozed indefinitely
      }

      // Handle timed snooze
      const now = Date.now();
      if (now < snoozeUntil) {
        clientLogger.info(`${LOG_PREFIX} Check-ins are snoozed until ${new Date(snoozeUntil).toLocaleTimeString()}`, { source: 'App.tsx' });
        return; // Skip idle breaker while snoozed
      } else {
        // Snooze period ended - clear state and return
        // Let the next naturally-scheduled check trigger instead of firing immediately
        setIsSnoozed(false);
        setSnoozeUntil(null);
        localStorage.removeItem('kayley_snooze_until');
        clientLogger.info(`${LOG_PREFIX} Snooze period ended (waiting for next scheduled check)`, { source: 'App.tsx' });
        return; // Exit without triggering check-in immediately
      }
    }

    // If both check-ins and news are disabled, don't trigger anything
    if (!proactiveSettings.checkins && !proactiveSettings.news) {
      clientLogger.info(`${LOG_PREFIX} Both check-ins and news are disabled, skipping idle breaker`, { source: 'App.tsx' });
      return;
    }

    if (idleThinkingInFlightRef.current) {
      clientLogger.info(`${LOG_PREFIX} [IdleThinking] Idle thinking already in flight, skipping`, { source: 'App.tsx' });
      return;
    }

    const idleNow = Date.now();
    lastIdleActionAtRef.current = idleNow;

    clientLogger.info(`${LOG_PREFIX} [IdleThinking] User is idle. Running idle thinking tick...`, { source: 'App.tsx' });

    try {
      // TIDY: ⚠️ Idle thinking is disabled — implement runIdleThinkingTick integration here
    } catch (error) {
      clientLogger.error(`${LOG_PREFIX} [IdleThinking] Error`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
    } finally {
      idleThinkingInFlightRef.current = false;
    }

    return;
  }, [
    isSnoozed,
    snoozeUntil,
    proactiveSettings.checkins,
    proactiveSettings.news,
    selectedCharacter,
    relationship,
    chatHistory,
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
    if (!selectedCharacter) return;

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
  }, [lastInteractionAt, isProcessingAction, isSpeaking, selectedCharacter]);

  // ==========================================================================
  // KEYBOARD SHORTCUTS
  // ==========================================================================
  // Calendar check-ins are now handled server-side via calendarHeartbeat.ts

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
    }

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
      clientLogger.info(`${LOG_PREFIX} Starting FRESH session - AI will use memory tools for context`, { source: 'App.tsx' });

      // Still load relationship data for tone/personality
      const relationshipData = await relationshipService.getRelationship();
      setRelationship(relationshipData);
      
        // 1. Check if any conversation occurred today (DB source of truth)
        const messageCount = await conversationHistoryService.getTodaysMessageCount();

        // Start with fresh session (no auto-greeting or background AI calls).
        // Model is managed server-side; this is informational only.
        const session: AIChatSession = { model: import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash' };

        if (messageCount > 0) {
          clientLogger.info(`${LOG_PREFIX} Chat detected today (${messageCount} messages) - reloading history only`, { source: 'App.tsx' });
          const existingInteractionId = await conversationHistoryService.getTodaysInteractionId();
          if (existingInteractionId) {
            clientLogger.info(`${LOG_PREFIX} Restoring today's interaction ID: ${existingInteractionId}`, { source: 'App.tsx' });
            session.interactionId = existingInteractionId;
          }

          const todayHistory = await conversationHistoryService.loadTodaysConversationHistory();
          setChatHistory(todayHistory);
        } else {
          setChatHistory([]);
        }

        setAiSession(session);

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
      clientLogger.info(`${LOG_PREFIX} User interrupted! Stopping audio.`, { source: 'App.tsx' });

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

  const handleResolveTweetDraft = useCallback(async (action: 'post' | 'reject') => {
    if (!pendingTweetDraft) {
      return { success: false, error: 'No pending tweet draft.' };
    }

    const draftId = pendingTweetDraft.id;
    const result = await agentClient.resolveTweetDraft(draftId, action);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    setPendingTweetDraft(null);

    const systemMessage =
      action === 'post'
        ? `[System] Tweet draft posted: ${draftId}`
        : `[System] Tweet draft rejected: ${draftId}`;

    try {
      const followUp = await agentClient.sendMessage({
        message: systemMessage,
        sessionId: webSessionIdRef.current,
        chatHistory: chatHistoryRef.current,
        isMuted: isMutedRef.current,
      });

      if (followUp.updatedSession) setAiSession(followUp.updatedSession);
      if (followUp.chatMessages?.length > 0) {
        setChatHistory(prev => [...prev, ...followUp.chatMessages]);
      }
      if (followUp.audioToPlay && !isMutedRef.current) {
        media.enqueueAudio(followUp.audioToPlay);
      }
      if (followUp.pendingTweetDraft) {
        setPendingTweetDraft(followUp.pendingTweetDraft);
      }
    } catch (error) {
      clientLogger.error(`${LOG_PREFIX} Tweet draft follow-up failed`, {
        source: 'App.tsx',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { success: true };
  }, [pendingTweetDraft, media]);

  // ==========================================================================
  // MAIN MESSAGE HANDLER (Refactored to use messageOrchestrator)
  // ==========================================================================

  const handleSendMessage = async (
    message: string,
    attachment?: PendingChatAttachment
  ) => {
    if (!selectedCharacter) return;
    registerInteraction();
    lastIdleActionAtRef.current = null;
    setErrorMessage(null);
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !attachment) return;
    setPendingRequestCount(c => c + 1);

    if (attachment?.kind === 'image') {
      const userText = trimmedMessage || '📷 [Sent an Image]';
      setChatHistory(prev => [
        ...prev,
        { role: 'user' as const, text: userText, image: attachment.base64, imageMimeType: attachment.mimeType },
      ]);

      try {
        const result = await agentClient.sendMessage({
          message: userText,
          userContent: {
            type: 'image_text',
            text: trimmedMessage || "What do you think of this?",
            imageData: attachment.base64,
            mimeType: attachment.mimeType,
          },
          sessionId: webSessionIdRef.current,
          chatHistory,
          isMuted,
        });

        if (result.updatedSession) setAiSession(result.updatedSession);
        setPendingTweetDraft(result.pendingTweetDraft ?? null);
        if (result.chatMessages?.length > 0) {
          setChatHistory(prev => [...prev, ...result.chatMessages]);
        }
        if (!isMuted && result.audioToPlay) enqueueAudio(result.audioToPlay);
        if (result.appToOpen) {
          clientLogger.info(`${LOG_PREFIX} Launching app`, { source: 'App.tsx', url: result.appToOpen });
          window.location.href = result.appToOpen;
        }
      } catch (error) {
        clientLogger.error(`${LOG_PREFIX} Error sending image`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
        setErrorMessage('Failed to process image.');
      } finally {
        setPendingRequestCount(c => Math.max(0, c - 1));
      }
      return;
    }

    if (attachment?.kind === 'gif') {
      const userText = trimmedMessage || '🎞️ [Sent a GIF]';
      setChatHistory(prev => [
        ...prev,
        { role: 'user' as const, text: userText, gifUrl: attachment.url },
      ]);
      const messageForAI = trimmedMessage || `[User sent a GIF: "${attachment.title}"]`;
      try {
        const result = await agentClient.sendMessage({
          message: userText,
          messageForAI,
          sessionId: webSessionIdRef.current,
          chatHistory,
          isMuted,
        });
        if (result.updatedSession) setAiSession(result.updatedSession);
        setPendingTweetDraft(result.pendingTweetDraft ?? null);
        if (result.error) setErrorMessage(result.error);
        const maybePlayResponseAction = (actionId?: string | null) => { if (actionId) playAction(actionId, true); };
        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...result.chatMessages]);
        if (result.audioToPlay && !isMuted) media.enqueueAudio(result.audioToPlay);
        maybePlayResponseAction(result.actionToPlay);
      } catch (error) {
        clientLogger.error(`${LOG_PREFIX} GIF send failed`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
        setErrorMessage('Failed to send GIF');
      } finally {
        setPendingRequestCount(c => Math.max(0, c - 1));
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
        const result = await agentClient.sendMessage({
          message: userText,
          messageForAI,
          sessionId: webSessionIdRef.current,
          chatHistory,
          isMuted,
        });

        if (result.updatedSession) setAiSession(result.updatedSession);
        setPendingTweetDraft(result.pendingTweetDraft ?? null);
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
      } catch (error) {
        clientLogger.error(`${LOG_PREFIX} File attachment processing failed`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
        setErrorMessage('Failed to process attachment');
      } finally {
        setPendingRequestCount(c => Math.max(0, c - 1));
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
      playAction(predictedActionId, true);
    } else if (isQuestionMessage(trimmedMessage)) {
      talkingActionId = playRandomTalkingAction(true);
    }

    // Track accumulated tool calls for this turn
    const turnToolCalls: import('./types').ToolCallDisplay[] = [];

    try {
      // ============================================
      // ORCHESTRATOR: AI Call + Background Processing (SSE Stream)
      // ============================================
      const result = await new Promise<OrchestratorResult>((resolve, reject) => {
        agentClient.sendMessageStream(
          {
            message:   trimmedMessage,
            sessionId: webSessionIdRef.current,
            chatHistory,
            isMuted,
          },
          {
            onToolStart: (event) => {
              const tc: import('./types').ToolCallDisplay = {
                callIndex: event.callIndex,
                toolName: event.toolName,
                toolDisplayName: event.toolDisplayName,
                status: 'running',
                startedAt: event.timestamp,
                toolArgs: event.toolArgs,
              };
              turnToolCalls.push(tc);
              setActiveToolCalls([...turnToolCalls]);
            },
            onToolEnd: (event) => {
              const existing = turnToolCalls.find(t => t.callIndex === event.callIndex);
              if (existing) {
                existing.status = event.success ? 'success' : 'failed';
                existing.durationMs = event.durationMs;
                existing.resultSummary = event.resultSummary;
              }
              setActiveToolCalls([...turnToolCalls]);
            },
            onActionStart: (_event) => {
              // Action events update tool calls display too
              const tc: import('./types').ToolCallDisplay = {
                callIndex: turnToolCalls.length,
                toolName: _event.actionName,
                toolDisplayName: _event.actionDisplayName,
                status: 'running',
                startedAt: _event.timestamp,
              };
              turnToolCalls.push(tc);
              setActiveToolCalls([...turnToolCalls]);
            },
            onActionEnd: (_event) => {
              const existing = turnToolCalls.find(t => t.toolName === _event.actionName && t.status === 'running');
              if (existing) {
                existing.status = _event.success ? 'success' : 'failed';
                existing.durationMs = _event.durationMs;
              }
              setActiveToolCalls([...turnToolCalls]);
            },
            onComplete: resolve,
            onError: (err) => reject(new Error(err)),
            onRetrying: () => {
              const tc: import('./types').ToolCallDisplay = {
                callIndex: turnToolCalls.length,
                toolName: 'reconnecting',
                toolDisplayName: 'Reconnecting...',
                status: 'running',
                startedAt: Date.now(),
              };
              turnToolCalls.push(tc);
              setActiveToolCalls([...turnToolCalls]);
            },
          },
        );
      });

      // Clear active tool calls — they'll be attached to the chat message
      setActiveToolCalls([]);

      if (result.updatedSession) setAiSession(result.updatedSession);
      setPendingTweetDraft(result.pendingTweetDraft ?? null);
      if (result.error) setErrorMessage(result.error);

      const maybePlayResponseAction = (actionId?: string | null) => {
        if (actionId && actionId !== predictedActionId && actionId !== talkingActionId) {
          playAction(actionId, true);
        }
      };

      // Helper: attach accumulated tool calls to the first model message
      const attachToolCalls = (messages: ChatMessage[]): ChatMessage[] => {
        if (turnToolCalls.length === 0) return messages;
        const firstModelIdx = messages.findIndex(m => m.role === 'model');
        if (firstModelIdx === -1) return messages;
        return messages.map((m, i) =>
          i === firstModelIdx ? { ...m, toolCalls: [...turnToolCalls] } : m
        );
      };

      // ============================================
      // ACTION-SPECIFIC PROCESSING (Phase 6: Simplified)
      // ============================================

      // SELFIE ACTIONS (Phase 5: Use orchestrator-generated message text)
      if (result.selfieImage || result.selfieError) {
        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...attachToolCalls(result.chatMessages)]);
        if (result.audioToPlay) media.enqueueAudio(result.audioToPlay);
        const selfieMsg = result.selfieMessageText || (result.selfieImage ? "Here you go!" : "I couldn't take that pic right now, sorry!");
        if (result.selfieImage) {
          setChatHistory(prev => [...prev, { role: 'model', text: selfieMsg, assistantImage: result.selfieImage!.base64, assistantImageMimeType: result.selfieImage!.mimeType }]);
          if (result.selfieHistoryId) {
            void agentClient.sendMediaHistoryEvent({
              mediaType: 'selfie',
              status: 'delivered',
              historyId: result.selfieHistoryId,
              messageText: selfieMsg,
              deliveryChannel: 'web',
            });
          }
        } else {
          setChatHistory(prev => [...prev, { role: 'model', text: selfieMsg }]);
          if (result.selfieHistoryId) {
            void agentClient.sendMediaHistoryEvent({
              mediaType: 'selfie',
              status: 'failed',
              historyId: result.selfieHistoryId,
              messageText: selfieMsg,
              deliveryChannel: 'web',
              error: result.selfieError || 'Selfie was not rendered in web client.',
            });
          }
        }
        maybePlayResponseAction(result.actionToPlay);
        return;
      }

      // GIF ACTIONS (Fetch from GIPHY and display inline)
      if (result.gifQuery) {
        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...attachToolCalls(result.chatMessages)]);
        if (result.audioToPlay) media.enqueueAudio(result.audioToPlay);
        const gifUrl = await fetchGiphyGifUrl(result.gifQuery);
        const gifText = result.gifMessageText || '';
        setChatHistory(prev => [...prev, { role: 'model', text: gifText, assistantGifUrl: gifUrl ?? undefined }]);
        maybePlayResponseAction(result.actionToPlay);
        return;
      }

      // VIDEO ACTIONS (Generate companion video)
      if (result.videoUrl || result.videoError) {
        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...attachToolCalls(result.chatMessages)]);
        if (result.audioToPlay) media.enqueueAudio(result.audioToPlay);
        const videoMsg = result.videoMessageText || (result.videoUrl ? "Here's a little video for you!" : "I couldn't make that video right now, sorry!");
        if (result.videoUrl) {
          setChatHistory(prev => [...prev, { role: 'model', text: videoMsg, assistantVideoUrl: result.videoUrl }]);
          void agentClient.sendMediaHistoryEvent({
            mediaType: 'video',
            status: 'delivered',
            scene: result.videoScene || 'video',
            mood: result.videoMood || null,
            messageText: videoMsg,
            videoUrl: result.videoUrl,
            deliveryChannel: 'web',
          });
        } else {
          setChatHistory(prev => [...prev, { role: 'model', text: videoMsg }]);
          if (result.videoScene) {
            void agentClient.sendMediaHistoryEvent({
              mediaType: 'video',
              status: 'failed',
              scene: result.videoScene,
              mood: result.videoMood || null,
              messageText: videoMsg,
              videoUrl: result.videoUrl || null,
              deliveryChannel: 'web',
              error: result.videoError || 'Video was not rendered in web client.',
            });
          }
        }
        maybePlayResponseAction(result.actionToPlay);
        return;
      }

      // ============================================
      // DEFAULT: Apply standard results
      // ============================================
      if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...attachToolCalls(result.chatMessages)]);
      if (result.rawResponse?.send_as_voice) {
        const voiceNoteText = result.chatMessages?.[0]?.text || '';
        if (result.audioToPlay && !isMuted) {
          void agentClient.sendMediaHistoryEvent({
            mediaType: 'voice_note',
            status: 'delivered',
            messageText: voiceNoteText,
            deliveryChannel: 'web',
          });
        } else if (!isMuted) {
          void agentClient.sendMediaHistoryEvent({
            mediaType: 'voice_note',
            status: 'failed',
            messageText: voiceNoteText,
            deliveryChannel: 'web',
            error: 'Voice note was requested but no audio payload was available for the web client.',
          });
        }
      }
      if (result.audioToPlay && !isMuted) media.enqueueAudio(result.audioToPlay);
      maybePlayResponseAction(result.actionToPlay);
      if (result.appToOpen) window.location.href = result.appToOpen;

    } catch (error) {
      clientLogger.error(`${LOG_PREFIX} Message processing failed`, { source: 'App.tsx', error: error instanceof Error ? error.message : String(error) });
      setErrorMessage('Failed to process message');
      setActiveToolCalls([]);
    } finally {
      setPendingRequestCount(c => Math.max(0, c - 1));
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


  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div className="bg-gray-900 text-gray-100 h-screen overflow-hidden flex flex-col p-4 md:p-8">
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
                <BackgroundTaskIndicator />

                <div className="h-full min-h-0">
                  <ChatPanel
                    history={chatHistory}
                    onSendMessage={handleSendMessage}
                    isSending={isProcessingAction}
                    onUserActivity={markInteraction}
                    pendingTweetDraft={pendingTweetDraft}
                    onResolveTweetDraft={handleResolveTweetDraft}
                    activeToolCalls={activeToolCalls}
                  />
                </div>
             </div>
        )}



          {view === 'admin' && (
            <AdminDashboardView
              onBack={() => setView('chat')}
            />
          )}
      </main>
      
      </div>
    </div>
  );
};

export default App;
