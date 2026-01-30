// ============================================================================
// IMPORTS
// ============================================================================
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChatMessage,
  CharacterProfile,
} from './types';
import * as dbService from './services/cacheService';
import { supabase } from './services/supabaseClient';
import AuthWarningBanner from './components/AuthWarningBanner';
import * as conversationHistoryService from './services/conversationHistoryService';
import * as relationshipService from './services/relationshipService';
import type { RelationshipMetrics } from './services/relationshipService';
import { gmailService, type NewEmailPayload } from './services/gmailService';
import { calendarService } from './services/calendarService';
import { buildActionKeyMap } from './utils/actionKeyMapper';
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
import { useCacheWarming } from './hooks/useCacheWarming';
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
  useCacheWarming();

  // --------------------------------------------------------------------------
  // CHAT & PROCESSING STATE
  // --------------------------------------------------------------------------
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [aiSession, setAiSession] = useState<AIChatSession | null>(null);
  const [lastSavedMessageIndex, setLastSavedMessageIndex] = useState<number>(-1);
  const [relationship, setRelationship] = useState<RelationshipMetrics | null>(null);

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
    emailQueue,
    clearQueue: clearEmailQueue,
    isConnected: isGmailConnected
  } = useGmail({ session, status: authStatus });

  const debouncedEmailQueue = useDebounce(emailQueue, 5000);
  const calendarTriggerRef = useRef<(prompt: string) => void>(() => { });

  // Calendar Hook
  const {
    upcomingEvents,
    weekEvents,
    refreshEvents: refreshCalendarEvents,
    registerCalendarEffects,
    checkForApplicableCheckins,
  } = useCalendar({
    session,
    selectedCharacter,
    proactiveSettings,
    isSnoozed,
    isProcessingAction,
    isSpeaking,
    triggerSystemMessage: (prompt) => calendarTriggerRef.current(prompt),
  });

  const lastIdleBreakerAtRef = useRef<number | null>(null);

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
    
    const now = Date.now();
    setLastInteractionAt(now); // reset timer to avoid back-to-back firings
    lastIdleBreakerAtRef.current = now;

    console.log("💤 User is idle. Triggering idle breaker...");

    if (!selectedCharacter || !session) {
      console.warn('[IdleBreaker] Missing character or session, skipping');
      return;
    }

    // Business Logic: Delegate to BaseAIService (the Brain)
    // if (!activeService.triggerIdleBreaker) {
    //   console.warn('[IdleBreaker] Service does not support triggerIdleBreaker');
    //   return;
    // }

    try {
      setIsProcessingAction(true);

      // const result = await activeService.triggerIdleBreaker(
      //   {
      //     chatHistory,
      //     googleAccessToken: session?.accessToken,
      //     proactiveSettings,
      //   },
      //   aiSession || { model: activeService.model }
      // );

      // if (!result) {
      //   // Service decided to skip (e.g., no news when news-only mode)
      //   console.log("💤 [IdleBreaker] Service returned null, skipping");
      //   return;
      // }

     // const { response, session: updatedSession, audioData } = result;

      // setAiSession(updatedSession);

      // // UI Layer: Update chat history (no user bubble)
      // setChatHistory(prev => [
      //   ...prev, 
      //   { role: 'model', text: response.text_response }
      // ]);
      
      // Save to DB
      // await conversationHistoryService.appendConversationHistory(
      //   [{ role: 'model', text: response.text_response }],
      //   updatedSession.interactionId
      // );

      // // UI Layer: Play Audio/Action
      // if (!isMuted && audioData) {
      //   // Convert string URL to ArrayBuffer if needed, or use directly
      //   // Gates: Disable Audio 
      //   // enqueueAudio(audioData as any); // audioData is already a string URL from generateSpeech
      // }
      // if (response.action_id) playAction(response.action_id);
      // if (response.open_app) {
      //   console.log("Launching app:", response.open_app);
      //   window.location.href = response.open_app;
      // }

    } catch (error) {
      console.error('[IdleBreaker] Error:', error);
    } finally {
      setIsProcessingAction(false);
    }
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

  // Idle timeout check (5 minutes)
  useEffect(() => {
    const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const IDLE_CHECK_INTERVAL = 10000; // 10 seconds

    const checkIdle = () => {
      const now = Date.now();
      const timeSinceInteraction = now - lastInteractionAt;
      const lastBreakerAt = lastIdleBreakerAtRef.current ?? 0;
      const recentlyTriggered =
        lastBreakerAt !== 0 && now - lastBreakerAt < IDLE_TIMEOUT;

      if (
        timeSinceInteraction > IDLE_TIMEOUT &&
        !isProcessingAction &&
        !isSpeaking &&
        !recentlyTriggered
      ) {
        // GATES: To get Idle thoughts complete I need a way to have Kayley 
        // mention or share her idle thoughts (that she chooses) and then
        // think about following up or resolving this thoughts
        // Plus: Right now all thoughts are hard coded and not LLM Generated
        // based on past conversation history
        console.log("Idle thoughts are not conected.")
        // triggerIdleBreaker();
      }
    };

    const interval = window.setInterval(checkIdle, IDLE_CHECK_INTERVAL);
    return () => window.clearInterval(interval);
  }, [lastInteractionAt, isProcessingAction, isSpeaking, triggerIdleBreaker]);

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
      console.log('Google Auth error detected. Attempting background refresh...');
      try {
        await refreshSession();
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

  useEffect(() => {
    if (debouncedEmailQueue.length === 0 || !selectedCharacter) return;

    const processEmailNotification = async () => {
      let characterMessage = '';
      if (debouncedEmailQueue.length === 1) {
        const email = debouncedEmailQueue[0];
        characterMessage = `📧 New email from ${email.from}: ${email.subject}`;
      } else {
        characterMessage = `📧 You have ${debouncedEmailQueue.length} new emails.`;
      }

      const updatedHistory = [...chatHistory, { role: 'model' as const, text: characterMessage }];
      setChatHistory(updatedHistory);

      // Get the latest interaction ID from DB to avoid creating a UUID fallback
      const existingInteractionId = await conversationHistoryService.getTodaysInteractionId();
      const interactionIdToUse = aiSession?.interactionId || existingInteractionId;

      await conversationHistoryService.appendConversationHistory(
          [{ role: 'model', text: characterMessage }],
          interactionIdToUse // Use latest valid interaction ID
        );
        setLastSavedMessageIndex(updatedHistory.length - 1);

        // Generate speech for the email notification
        // Gates: Disable Audio
        // if (!isMuted) {
        //   const audioData = await generateSpeech(characterMessage);
        //   if (audioData) {
        //     enqueueAudio(audioData);
        //   }
        // }

      clearEmailQueue();
    };

    processEmailNotification();
  }, [debouncedEmailQueue, selectedCharacter, isMuted, aiSession]);

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
    handleUserInterrupt();
  };

  // ==========================================================================
  // MAIN MESSAGE HANDLER (Refactored to use messageOrchestrator)
  // ==========================================================================

  const handleSendMessage = async (
    message: string,
    image?: { base64: string; mimeType: string }
  ) => {
    if (!selectedCharacter || !session) return;
    registerInteraction();
    setErrorMessage(null);
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !image) return;
    setIsProcessingAction(true);

    if (image) {
      const userText = trimmedMessage || '📷 [Sent an Image]';
      setChatHistory(prev => [
        ...prev,
        { role: 'user' as const, text: userText, image: image.base64, imageMimeType: image.mimeType },
      ]);

      try {
        const sessionToUse: AIChatSession = aiSession || { model: activeService.model };
          console.log("SENDING MESSAGE")
        const { response, session: updatedSession, audioData } = await activeService.generateResponse(
          {
            type: 'image_text',
            text: trimmedMessage || "What do you think of this?",
            imageData: image.base64,
            mimeType: image.mimeType,
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
        userMessage: trimmedMessage,
        aiService: activeService,
        session: aiSession,
        accessToken: session.accessToken,
        chatHistory,
        upcomingEvents,
        tasks,
        isMuted,
      });

      if (result.updatedSession) setAiSession(result.updatedSession);
      if (result.error) setErrorMessage(result.error);

      const maybePlayResponseAction = (actionId?: string | null) => {
        if (actionId && actionId !== predictedActionId && actionId !== talkingActionId) {
          playAction(actionId, true);
        }
      };

      const startBackgroundSentiment = () => {
        relationshipService
          .analyzeMessageSentiment(trimmedMessage, updatedHistory, result.intent)
          .then(event => relationshipService.updateRelationship(event))
          .then(updated => { if (updated) setRelationship(updated); })
          .catch(err => console.error('Sentiment analysis failed:', err));
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

      // NEWS ACTIONS (orchestrator fetched, we trigger system message)
      if (result.newsPrompt) {
        if (result.chatMessages.length > 0) setChatHistory(prev => [...prev, ...result.chatMessages]);
        if (result.audioToPlay) media.enqueueAudio(result.audioToPlay);
        await triggerSystemMessage(result.newsPrompt);
        startBackgroundSentiment();
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
        startBackgroundSentiment();
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
        startBackgroundSentiment();
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
      startBackgroundSentiment();

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
            proactiveSettings={proactiveSettings}
            onProactiveSettingsChange={updateProactiveSettings}
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
