// ============================================================================
// IMPORTS
// ============================================================================
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChatMessage,
  UploadedImage,
  CharacterProfile,
  CharacterAction,
} from './types';
import * as dbService from './services/cacheService';
import { supabase } from './services/supabaseClient';
import AuthWarningBanner from './components/AuthWarningBanner';
import * as conversationHistoryService from './services/conversationHistoryService';
import * as relationshipService from './services/relationshipService';
import type { RelationshipMetrics } from './services/relationshipService';
import type { FullMessageIntent } from './services/intentService';
import { recordExchange } from './services/callbackDirector';
import { getTopLoopToSurface } from './services/presenceDirector';
import { gmailService, type NewEmailPayload } from './services/gmailService';
import { 
  calendarService, 
  type CalendarEvent,
  type NewEventPayload 
} from './services/calendarService';
import { generateSpeech } from './services/elevenLabsService'; // Import generateSpeech
import { buildActionKeyMap } from './utils/actionKeyMapper';
import { predictActionFromMessage } from './utils/intentUtils';
import { processAndStoreCharacterFacts } from './services/characterFactsService';
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
import { WhiteboardAction } from './services/whiteboardModes';
import { handleWhiteboardCapture as handleWhiteboardCaptureHandler } from './handlers/whiteboardHandler';
import {
  processTaskAction,
  parseTaskActionFromResponse,
  detectTaskCompletionFallback,
  processCalendarAction,
  parseCalendarTagFromResponse,
  processCalendarTag,
  processNewsAction,
  processSelfieAction,
  TaskAction,
  CalendarAction,
  NewsAction,
  SelfieAction,
} from './handlers/messageActions';
import { useGoogleAuth } from './contexts/GoogleAuthContext';
import { useDebounce } from './hooks/useDebounce';
import { useMediaQueues } from './hooks/useMediaQueues';
import { useCacheWarming } from './hooks/useCacheWarming';
import { useTasks } from './hooks/useTasks';
import { useCalendar } from './hooks/useCalendar';
import { useProactiveSettings } from './hooks/useProactiveSettings';
import { useIdleTracking } from './hooks/useIdleTracking';
import { useCharacterActions } from './hooks/useCharacterActions';
import { useCharacterManagement } from './hooks/useCharacterManagement';
import { useAIService } from './contexts/AIServiceContext';
import { AIChatSession, UserContent, AIChatOptions } from './services/aiService';
import { startCleanupScheduler, stopCleanupScheduler } from './services/loopCleanupService';
import { startIdleThoughtsScheduler, stopIdleThoughtsScheduler } from './services/idleThoughtsScheduler';
import * as taskService from './services/taskService';
import { 
  fetchTechNews, 
  markStoryMentioned,
  storeLastSharedStories,
} from './services/newsService';
// Calendar check-in functions now handled by useCalendar hook
import { generateCompanionSelfie } from './services/imageGenerationService';
import { detectKayleyPresence } from './services/kayleyPresenceDetector';
import { getKayleyPresenceState, updateKayleyPresenceState, getDefaultExpirationMinutes } from './services/kayleyPresenceService';
// Utility imports (Phase 1 extraction)
import { isQuestionMessage } from './utils/textUtils';
import { extractJsonObject } from './utils/jsonUtils';
import { shuffleArray } from './utils/arrayUtils';

// ============================================================================
// CONSTANTS & TYPES
// ============================================================================
const ACTION_VIDEO_BUCKET = 'character-action-videos';

type View = 'loading' | 'selectCharacter' | 'createCharacter' | 'chat' | 'manageCharacter' | 'whiteboard';

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
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterProfile | null>(null);

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
    setTasks,
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
    hasInteractedRef,
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
    triggerIdleAction,
    scheduleIdleAction,
    clearIdleActionTimer,
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
    isUpdatingImage,
    uploadedImage,
    setUploadedImage,
    handleImageUpload,
    handleCharacterCreated,
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
  const [isGmailConnected, setIsGmailConnected] = useState(false);
  const [emailQueue, setEmailQueue] = useState<NewEmailPayload[]>([]);
  const debouncedEmailQueue = useDebounce(emailQueue, 5000);
  const calendarTriggerRef = useRef<(prompt: string) => void>(() => {});
  const [kayleyContext, setKayleyContext] = useState<string>("");

  // Calendar Hook
  const {
    upcomingEvents,
    weekEvents,
    setUpcomingEvents,
    refreshEvents: refreshCalendarEvents,
    refreshWeekEvents,
    triggerCalendarCheckin,
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [notifiedEventIds, setNotifiedEventIds] = useState<Set<string>>(new Set());
  const lastIdleBreakerAtRef = useRef<number | null>(null);

  // ==========================================================================
  // INITIALIZATION EFFECTS
  // ==========================================================================

  // Kayley Context (random vibes for personality)
  useEffect(() => {
    const vibes = [
      "Sipping a matcha latte and people-watching.",
      "Trying to organize my digital photo album.",
      "Feeling energetic and wanting to dance.",
      "A bit sleepy, cozying up with a blanket.",
      "Reading a sci-fi novel about friendly robots.",
      "Thinking about learning how to paint.",
      "Just finished a workout, feeling great.",
      "Reorganizing her apps for the fifth time today.",
      "Practicing Russian pronunciation and giggling every time she messes up.",
      "Twisting her hair while pretending to be deep in thought.",
      "Singing along to a song she barely knows the words to.",
      "Taking a dramatic, unnecessary stretch like a sleepy cat.",
      "Trying to remember where she put her favorite lip balm.",
      "Watching a cooking video she'll never actually make.",
      "Getting lost in a YouTube rabbit hole about space.",
      "Looking at old selfies and judging her eyebrow phases.",
      "Doing a little happy dance for no reason.",
      "Organizing her desktop icons into ✨ aesthetic ✨ rows.",
      "Trying to whistle and failing adorably.",
      "Smiling at her own reflection because she’s feeling cute.",
      "Taking notes on a random idea she’ll probably forget later.",
      "Daydreaming about future adventures.",
      "Testing out new hairstyles in the camera preview.",
      "Pretending she’s in a music video while listening to music.",
      "Practicing dramatic facial expressions for… no reason.",
      "Scrolling Pinterest for aesthetic room ideas.",
      "Giggling at a meme she saw 3 days ago.",
      "Tapping her fingers to a beat only she can hear.",
      "Trying to meditate but getting distracted by her own thoughts.",
      "Petting an imaginary dog (???).",
      "Redoing her ponytail because it's never *quite* right.",
      "Watching clouds and assigning them silly personalities.",
      "Attempting to multitask and forgetting all tasks involved.",
      "Checking her horoscope and pretending it’s super serious.",
      "Rehearsing what she'd say if she got interviewed on TV.",
      "Making a goofy face and instantly cracking up.",
      "Trying to guess what time it is without looking.",
      "Stretching her arms and yawning dramatically.",
      "Pretending she’s an undercover spy for 6 seconds.",
      "Trying to mime opening a stuck jar.",
      "Looking around like she just remembered something important… and didn’t.",
      "Picturing her life as a movie scene.",
      "Getting excited over a cool bird outside the window.",
      "Practicing her signature pose for future paparazzi.",
      "Trying to balance something on her head just for fun.",
      "Doing that little shoulder shimmy when she’s proud of herself.",
      "Wondering if she should text someone or wait 2 minutes.",
      "Saying a random Russian word and feeling accomplished.",
      "Giving herself a pep talk like she’s her own hype squad.",
      "Trying to wink smoothly and blinking with both eyes instead."
    ];

    setKayleyContext(vibes[Math.floor(Math.random() * vibes.length)]);
  }, []);

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


      startIdleThoughtsScheduler();

        return () => {
          stopIdleThoughtsScheduler();
        };

    } catch (e) {
      // Ignore if user ID check fails (e.g. env var missing in dev)
      console.log(`❌ [IdleThoughts] Error starting idle thoughts scheduler:`, e);
    }
  }, []);

  // ==========================================================================
  // IMAGE & MESSAGE HANDLERS
  // ==========================================================================

  const handleSendImage = async (base64: string, mimeType: string) => {
    if (!selectedCharacter || !session) return;
    registerInteraction();
    setErrorMessage(null);

    // 1. Add the image to the chat history visually so the user sees it
    setChatHistory(prev => [...prev, { 
      role: 'user', 
      text: '📷 [Sent an Image]', 
      image: base64 
    }]);
    setIsProcessingAction(true);

    try {
      const sessionToUse: AIChatSession = aiSession || { model: activeService.model };

      // 2. Send to AI Service (service fetches context internally)
      const { response, session: updatedSession, audioData } = await activeService.generateResponse(
        {
          type: 'image_text',
          text: "What do you think of this?", // Default prompt
          imageData: base64,
          mimeType: mimeType
        },
        {
          chatHistory: chatHistory,
          googleAccessToken: session?.accessToken,
        },
        sessionToUse
      );
      
      setAiSession(updatedSession);

      // Check for Calendar Action
      // We search for the tag anywhere in the response, not just at the start.
      const calendarTagIndex = response.text_response.indexOf('[CALENDAR_CREATE]');

      if (calendarTagIndex !== -1) {
         try {
           // Extract the JSON part.
           const tagLength = '[CALENDAR_CREATE]'.length;
           let jsonString = response.text_response.substring(calendarTagIndex + tagLength).trim();
           
           // Simple cleanup if it includes markdown code blocks
           jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();

           // Find the first '{' and the last '}' to isolate the object
           const firstBrace = jsonString.indexOf('{');
           const lastBrace = jsonString.lastIndexOf('}');
           
           if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              jsonString = jsonString.substring(firstBrace, lastBrace + 1);
           }

           console.log("📅 Attempting to parse Calendar JSON:", jsonString);
           const eventData: NewEventPayload = JSON.parse(jsonString);

           // Validation: Ensure required fields exist
           if (!eventData.summary || !eventData.start?.dateTime || !eventData.end?.dateTime) {
               throw new Error("Missing required fields (summary, start.dateTime, end.dateTime)");
           }

           const confirmationText = `Okay, I'll add "${eventData.summary}" to your calendar.`;
           
           // Strip the tag and JSON from the displayed message, showing the rest of the text + confirmation
           const textBeforeTag = response.text_response.substring(0, calendarTagIndex).trim();
           const displayText = textBeforeTag ? `${textBeforeTag}\n\n${confirmationText}` : confirmationText;
           
           setChatHistory(prev => [...prev, { role: 'model' as const, text: displayText }]);
           
           await conversationHistoryService.appendConversationHistory(
             [{ role: 'user', text: '📷 [Sent an Image]' }, { role: 'model', text: displayText }],
             updatedSession?.interactionId || aiSession?.interactionId
           );

           // Create Event
           console.log("📅 Creating event:", eventData);
           await calendarService.createEvent(session.accessToken, eventData);
           
           // Refresh Events
           const events = await calendarService.getUpcomingEvents(session.accessToken);
           setUpcomingEvents(events);

           // Generate Speech for confirmation
           if (!isMuted) {
               const confirmationAudio = await generateSpeech(displayText);
               if (confirmationAudio) media.enqueueAudio(confirmationAudio);
           }
           
           if (response.action_id) playAction(response.action_id);
           if (response.open_app) {
               console.log("🚀 Launching app:", response.open_app);
               window.location.href = response.open_app;
           }

         } catch (e) {
           console.error("Failed to create calendar event", e);
           setErrorMessage("Failed to create calendar event.");
           
           const textBeforeTag = response.text_response.substring(0, calendarTagIndex).trim();
           const errorText = "I tried to create that event, but I got confused by the details. Could you try again?";
           const displayText = textBeforeTag ? `${textBeforeTag}\n\n(System: ${errorText})` : errorText;

           setChatHistory(prev => [...prev, { role: 'model' as const, text: displayText }]);
         }
      } else {
          // 3. Handle response as usual
          setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
          
        await conversationHistoryService.appendConversationHistory(
            [{ role: 'user', text: '📷 [Sent an Image]' }, { role: 'model', text: response.text_response }],
            updatedSession?.interactionId || aiSession?.interactionId
          );

          if (!isMuted && audioData) {
              enqueueAudio(audioData);
          }

          if (response.action_id) {
               playAction(response.action_id);
          }
          if (response.open_app) {
              console.log("🚀 Launching app:", response.open_app);
              window.location.href = response.open_app;
          }
      }

    } catch (error) {
      console.error('Error sending image:', error);
      setErrorMessage('Failed to process image.');
    } finally {
      setIsProcessingAction(false);
    }
  };

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
      console.log(`✅ Loaded ${savedCharacters.length} character(s) in ${loadTime.toFixed(0)}ms`);
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
        generateSpeech(message).then(audio => {
          if (audio) media.enqueueAudio(audio);
        });
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
      // 2. Send to AI (Grok/Gemini)
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

      // 5. Play Audio/Action
      if (!isMuted && audioData) enqueueAudio(audioData);
      if (response.action_id) playAction(response.action_id);
      if (response.open_app) {
         console.log("dYs? Launching app:", response.open_app);
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
    if (!activeService.triggerIdleBreaker) {
      console.warn('[IdleBreaker] Service does not support triggerIdleBreaker');
      return;
    }

    try {
      setIsProcessingAction(true);

      const result = await activeService.triggerIdleBreaker(
        {
          chatHistory,
          googleAccessToken: session?.accessToken,
          proactiveSettings,
        },
        aiSession || { model: activeService.model }
      );

      if (!result) {
        // Service decided to skip (e.g., no news when news-only mode)
        console.log("💤 [IdleBreaker] Service returned null, skipping");
        return;
      }

      const { response, session: updatedSession, audioData } = result;

      setAiSession(updatedSession);

      // UI Layer: Update chat history (no user bubble)
      setChatHistory(prev => [
        ...prev, 
        { role: 'model', text: response.text_response }
      ]);
      
      // Save to DB
      await conversationHistoryService.appendConversationHistory(
        [{ role: 'model', text: response.text_response }],
        updatedSession.interactionId
      );

      // UI Layer: Play Audio/Action
      if (!isMuted && audioData) {
        // Convert string URL to ArrayBuffer if needed, or use directly
        enqueueAudio(audioData as any); // audioData is already a string URL from generateSpeech
      }
      if (response.action_id) playAction(response.action_id);
      if (response.open_app) {
        console.log("Launching app:", response.open_app);
        window.location.href = response.open_app;
      }

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
    kayleyContext,
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
        triggerIdleBreaker();
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

  // Gmail polling
  useEffect(() => {
    if (!isGmailConnected || !session) return;

    const pollNow = async () => {
      try {
        await gmailService.pollForNewMail(session.accessToken);
      } catch (error) {
        console.error('Gmail polling error:', error);
      }
    };

    const initialDelayTimer = setTimeout(pollNow, 2000);
    const intervalId = setInterval(pollNow, 60000);

    return () => {
      clearTimeout(initialDelayTimer);
      clearInterval(intervalId);
    };
  }, [isGmailConnected, session]);

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
    const handleNewMail = (event: Event) => {
      const customEvent = event as CustomEvent<NewEmailPayload[]>;
      setEmailQueue(prev => [...prev, ...customEvent.detail]);
    };

    const handleAuthError = () => {
      console.log("🔒 Google Auth error detected. Attempting background refresh...");
      refreshSession();
    };

    gmailService.addEventListener('new-mail', handleNewMail);
    gmailService.addEventListener('auth-error', handleAuthError);
    calendarService.addEventListener('auth-error', handleAuthError);

    return () => {
      gmailService.removeEventListener('new-mail', handleNewMail);
      gmailService.removeEventListener('auth-error', handleAuthError);
      calendarService.removeEventListener('auth-error', handleAuthError);
    };
  }, [signOut]); 

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

      await conversationHistoryService.appendConversationHistory(
          [{ role: 'model', text: characterMessage }],
          aiSession?.interactionId // Pass the current interaction ID
        );
        setLastSavedMessageIndex(updatedHistory.length - 1);

        // Generate speech for the email notification
        if (!isMuted) {
          const audioData = await generateSpeech(characterMessage);
          if (audioData) {
            enqueueAudio(audioData);
          }
        }

      setEmailQueue([]);
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
      console.log(`🔑 Built action key map for ${character.actions.length} actions`);
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
      
      try {
        // 1. Check if any conversation occurred today (DB source of truth)
        const messageCount = await conversationHistoryService.getTodaysMessageCount();
        const hasHadConversationToday = messageCount > 0;

        // 2. Check if this is the first login of the day (Local state for briefing delay)
        const today = new Date().toDateString();
        const lastBriefingDate = localStorage.getItem(`last_briefing_${character.id}`);
        const isFirstLoginToday = lastBriefingDate !== today;

        // Start with fresh session
        const session: AIChatSession = { model: activeService.model };

        // USER REQUIREMENT: Store the conversationId that google gemini gives per day
        // Try to restore today's Gemini interaction ID for continuity
        const existingInteractionId = await conversationHistoryService.getTodaysInteractionId();
        if (existingInteractionId) {
          console.log(`🔗 [App] Restoring today's interaction ID: ${existingInteractionId}`);
          session.interactionId = existingInteractionId;
        }

        if (!hasHadConversationToday) {
          // No conversation today: Generate greeting
          // The greeting service will automatically include daily logistics if it's the first login
          console.log(isFirstLoginToday
            ? '🌅 [App] First login today - generating greeting with daily logistics'
            : '🤖 [App] Returning to session (no prior chat today) - generating greeting');

          const { greeting, session: updatedSession } = await activeService.generateGreeting(
            aiSession || { model: activeService.model },
            {
              characterId: character.id,
              emailCount: emailQueue.length,
              isGmailConnected,
              isCalendarConnected: !!session,
            }
          );
          setAiSession(updatedSession);

          const initialHistory = [{ role: 'model' as const, text: greeting.text_response }];
          setChatHistory(initialHistory);

          if (greeting.action_id && newActionUrls[greeting.action_id]) {
            setTimeout(() => playAction(greeting.action_id!), 100);
          }
        } else {
          // CONVERSATION OCCURRED TODAY: Reload all exchanges and generate informal "welcome back"
          console.log(`🧠 [App] Chat detected today (${messageCount} messages) - reloading history and generating non-greeting`);

          const todayHistory = await conversationHistoryService.loadTodaysConversationHistory();
          setChatHistory(todayHistory);

          const { greeting: backMessage, session: updatedSession } = await activeService.generateNonGreeting(
            aiSession || { model: activeService.model }
          );
          setAiSession(updatedSession);

          // Append the "welcome back" message to the restored history
          setChatHistory(prev => [...prev, { role: 'model' as const, text: backMessage.text_response }]);

          // Save the interaction record
          await conversationHistoryService.appendConversationHistory(
            [{ role: 'model', text: backMessage.text_response }],
            updatedSession.interactionId || session.interactionId // Restore interactionId here
          );

          if (backMessage.action_id && newActionUrls[backMessage.action_id]) {
            setTimeout(() => playAction(backMessage.action_id!), 100);
          }
        }

        // Reset the last saved index since we're starting fresh
        setLastSavedMessageIndex(-1);

      } catch (error) {
        console.error('Error generating greeting:', error);
        // On error, just start with empty chat
        setChatHistory([]);
      }
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
  // MAIN MESSAGE HANDLER
  // ==========================================================================

  const handleSendMessage = async (message: string) => {
    if (!selectedCharacter || !session) return;
    registerInteraction();
    setErrorMessage(null);
    
    // Show typing indicator
    setIsProcessingAction(true);
    
    const updatedHistory = [...chatHistory, { role: 'user' as const, text: message }];
    setChatHistory(updatedHistory);
    // ... [rest of function] ...


    // ============================================
    // SOUL LAYER: Exchange Recording (Phase 5)
    // ============================================
    // NOTE: analyzeUserMessageBackground is now called in BaseAIService.generateResponse
    // with the pre-calculated intent, preventing duplicate detectFullIntentLLMCached calls.
    // We only record the exchange here for callback timing.
    const startBackgroundAnalysis = () => {
      try {
        recordExchange(); // For callback timing
      } catch (e) { console.warn('Exchange record failed', e); }
    };

    // Start analysis immediately in background
    // (It performs its own async operations without blocking)
    try {
      startBackgroundAnalysis();
    } catch (e) {
      console.error("Failed to start background analysis", e);
    }

    // Background (non-critical) sentiment analysis should NOT compete with the critical path.
    // We'll start it only after we've queued the AI's audio response (or displayed the text if muted).
    let sentimentPromise: Promise<any> | null = null;
    const startBackgroundSentiment = (intent?: FullMessageIntent) => {
      if (sentimentPromise) return;

      sentimentPromise = relationshipService
        .analyzeMessageSentiment(message, updatedHistory, intent)
        .then(event => relationshipService.updateRelationship(event))
        .catch(error => {
          console.error('Background sentiment analysis failed:', error);
          return null;
        });

      sentimentPromise.then(updatedRelationship => {
        if (updatedRelationship) {
          setRelationship(updatedRelationship);
          // Phase 5: Mood interaction is now handled by messageAnalyzer (Async/Supabase)
          // which accurately detects genuine moments using LLM.
          // redundant call removed: recordMoodInteraction(toneScore);
        }
      });
    };

    // Variable to track if we played an action optimistically
    let predictedActionId: string | null = null;
    let talkingActionId: string | null = null;
    const messageIsQuestion = isQuestionMessage(message);
    
    // 1. Ask our helper function to guess the action
    if (selectedCharacter.actions) {
      predictedActionId = predictActionFromMessage(message, selectedCharacter.actions);
    }
    
    // 2. If we guessed an action, PLAY IT NOW!
    if (predictedActionId) {
      console.log(`⚡ Optimistically playing action: ${predictedActionId}`);
      // Force immediate playback so user commands interrupt the current idle clip
      playAction(predictedActionId, true);
    }
    else if (messageIsQuestion) {
      talkingActionId = playRandomTalkingAction(true);
      if (talkingActionId) {
        console.log(`Starting talking animation: ${talkingActionId}`);
      }
    }

    try {
      // ============================================
      // LLM-BASED USER FACT DETECTION
      // Facts are detected by the intent service LLM and processed after response
      // This replaced the old regex-based detectAndStoreUserInfo
      // ============================================

      const sessionToUse: AIChatSession = aiSession || { model: activeService.model };
      const context: AIChatOptions = {
        chatHistory: chatHistory,
        googleAccessToken: session?.accessToken,
        audioMode: 'async',
        onAudioData: (data) => media.enqueueAudio(data),
      };

      // 1. Start AI response immediately (main critical path)
      try {
        let textToSend = message;
        // Inject system context if asking about schedule to override hallucinations
        const lowerMsg = message.toLowerCase();

        // Use a local variable that defaults to current state, but might be updated with fresh data
        let currentEventsContext = upcomingEvents;

        if (lowerMsg.match(/(event|calendar|schedule|meeting|appointment|plan|today|tomorrow|delete|remove|cancel)/)) {
          try {
            // ⚡ LIVE REFRESH: Fetch latest events immediately before answering
            console.log("⚡ Fetching live calendar data for user query...");
            const freshEvents = await calendarService.getUpcomingEvents(session.accessToken);
            console.log(`📅 Calendar API returned ${freshEvents.length} events:`,
              freshEvents.map(e => ({ summary: e.summary, start: e.start.dateTime, id: e.id }))
            );
            setUpcomingEvents(freshEvents); // Update state for UI
            currentEventsContext = freshEvents; // Update local context for AI

            // 🚨 CRITICAL: Inject event data directly into the user message
            // Include IDs so AI can use them for deletion
            if (freshEvents.length > 0) {
              const eventList = freshEvents.map((e, i) => {
                const t = new Date(e.start.dateTime || e.start.date);
                return `${i + 1}. "${e.summary}" (ID: ${e.id}) at ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
              }).join('; ');

              // Check if this is a delete request
              const isDeleteRequest = lowerMsg.match(/(delete|remove|cancel)/);

              if (isDeleteRequest) {
                // Add explicit delete reminder with the exact format needed
                textToSend = `${message}\n\n[LIVE CALENDAR DATA - ${freshEvents.length} EVENTS: ${eventList}]\n\n⚠️ DELETE REMINDER: To delete an event, use the calendar_action tool with action="delete" and the exact "event_id" from the list above.`;
                console.log(`🗑️ Delete request detected - added deletion reminder`);
              } else {
                textToSend = `${message}\n\n[LIVE CALENDAR DATA - ${freshEvents.length} EVENTS: ${eventList}]`;
              }
              console.log(`📅 Injected calendar context into message: ${freshEvents.length} events`);
            }
          } catch (err) {
            console.error("Failed to live-refresh calendar:", err);
            // Fallback to existing 'upcomingEvents' state
          }
        }

        // Service fetches context internally - we just pass minimal options
        const { response, session: updatedSession, audioData, intent } = await activeService.generateResponse(
          { type: 'text', text: textToSend },
          context,
          sessionToUse
        );

        setAiSession(updatedSession);

        // Debug: Log full response to check structure
        console.log('🔍 Full AI response:', JSON.stringify(response, null, 2));

        // Process LLM-detected user facts (background, non-blocking)
        // This uses semantic understanding from the intent service instead of regex patterns
        if (intent?.userFacts?.hasFactsToStore && intent.userFacts.facts.length > 0) {
          import('./services/memoryService').then(({ processDetectedFacts }) => {
            processDetectedFacts(intent.userFacts!.facts).catch(err =>
              console.warn('Failed to process LLM-detected user facts:', err)
            );
          });
        }

        // IMPORTANT: Refresh tasks after AI response in case task_action tool was called
        // The tool modifies Supabase directly, so we need to sync UI state
        refreshTasks().catch(err => {
          console.warn('Failed to refresh tasks:', err);
        });

        // Detect and store character facts from the response (background, non-blocking)
        // This captures new facts about Kayley that aren't in the profile
        if (response.text_response) {
          processAndStoreCharacterFacts(response.text_response).catch(err => {
            console.warn('Failed to process character facts:', err);
          });
        }

        // Detect and track Kayley's presence state (what she's wearing/doing) - background, non-blocking
        if (response.text_response) {
          detectKayleyPresence(response.text_response, message)
            .then(async (detected) => {
              if (detected && detected.confidence > 0.7) {
                const expirationMinutes = getDefaultExpirationMinutes(detected.activity, detected.outfit);
                await updateKayleyPresenceState({
                  outfit: detected.outfit,
                  mood: detected.mood,
                  activity: detected.activity,
                  location: detected.location,
                  expirationMinutes,
                  confidence: detected.confidence,
                });
                console.log('[App] Kayley presence detected:', detected);
              }
            })
            .catch(err => console.warn('[App] Presence detection error:', err));
        }
        
        const maybePlayResponseAction = (actionId?: string | null) => {
          if (!actionId) return;
          if (actionId !== predictedActionId && actionId !== talkingActionId) {
            playAction(actionId, true);
          } else {
            console.log("Skipping duplicate action playback");
          }
        };

        // ============================================
        // TASK ACTIONS (extracted to handlers/messageActions/taskActions.ts)
        // ============================================
        let taskAction = response.task_action as TaskAction | null | undefined;
        console.log("TASK ACTION: ", taskAction);
        let shouldRegenerateAudio = false;

        // Try to parse embedded JSON task_action from text_response
        if (!taskAction && response.text_response) {
          const parsedAction = parseTaskActionFromResponse(response.text_response);
          if (parsedAction) {
            taskAction = parsedAction;
            response.text_response = "Got it! I'll help you with that.";
            shouldRegenerateAudio = true;
          }
        }

        // Fallback: Detect task completion from user message
        if (!taskAction && message) {
          const fallbackAction = detectTaskCompletionFallback(message, tasks);
          if (fallbackAction) {
            taskAction = fallbackAction;
          }
        }

        // Regenerate audio if we cleaned up JSON from text_response
        if (shouldRegenerateAudio && !isMuted) {
          console.log('🔊 Regenerating audio for cleaned response');
          generateSpeech(response.text_response).then(cleanAudio => {
            if (cleanAudio) {
              media.enqueueAudio(cleanAudio);
            }
          });
        }

        // Process task action using extracted handler
        await processTaskAction(taskAction, tasks, {
          handleTaskCreate,
          handleTaskToggle,
          handleTaskDelete,
          setIsTaskPanelOpen,
        });

        // ============================================
        // CALENDAR ACTIONS (extracted to handlers/messageActions/calendarActions.ts)
        // ============================================
        const calendarAction = response.calendar_action as CalendarAction | null | undefined;
        console.log("CALENDAR ACTION: ", calendarAction);
        if (calendarAction && calendarAction.action) {
          const calendarResult = await processCalendarAction(calendarAction, {
            accessToken: session.accessToken,
            currentEvents: currentEventsContext,
          });

          if (calendarResult.handled) {
            // Refresh events after calendar change
            const events = await calendarService.getUpcomingEvents(session.accessToken);
            setUpcomingEvents(events);

            // Show confirmation and handle audio
            setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
            await conversationHistoryService.appendConversationHistory(
              [{ role: 'user', text: message }, { role: 'model', text: response.text_response }],
              updatedSession?.interactionId || aiSession?.interactionId
            );
            setLastSavedMessageIndex(updatedHistory.length);

            if (!isMuted && audioData) {
              media.enqueueAudio(audioData);
            }

            startBackgroundSentiment(intent);
            if (response.action_id) maybePlayResponseAction(response.action_id);
            return;
          } else if (calendarResult.error) {
            setErrorMessage('Failed to execute calendar action');
          }
        }

        // ============================================
        // NEWS ACTIONS (extracted to handlers/messageActions/newsActions.ts)
        // ============================================
        const newsAction = response.news_action as NewsAction | null | undefined;

        if (newsAction && newsAction.action === 'fetch') {
          // Show initial acknowledgment
          setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
          if (!isMuted && audioData) {
            media.enqueueAudio(audioData);
          }
          await conversationHistoryService.appendConversationHistory(
            [{ role: 'user', text: message }, { role: 'model', text: response.text_response }],
            updatedSession?.interactionId || aiSession?.interactionId
          );
          setLastSavedMessageIndex(updatedHistory.length);

          const newsResult = await processNewsAction(newsAction);
          console.log("NEWS ACTION: ", newsResult);

          if (newsResult.handled) {
            // Send news context back to AI for a natural response
            await triggerSystemMessage(newsResult.newsPrompt);
            return;
          } else if (newsResult.error) {
            setErrorMessage('Failed to fetch tech news');
          }
        }

        // ============================================
        // SELFIE ACTIONS (extracted to handlers/messageActions/selfieActions.ts)
        // ============================================
        const selfieAction = response.selfie_action as SelfieAction | null | undefined;
        console.log("SELFIE ACTION: ", selfieAction);
        if (selfieAction && selfieAction.scene) {
          // Show initial acknowledgment
          setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
          if (!isMuted && audioData) {
            media.enqueueAudio(audioData);
          }
          await conversationHistoryService.appendConversationHistory(
            [{ role: 'user', text: message }, { role: 'model', text: response.text_response }],
            updatedSession?.interactionId || aiSession?.interactionId
          );
          setLastSavedMessageIndex(updatedHistory.length);

          const selfieResult = await processSelfieAction(selfieAction, {
            userMessage: message,
            chatHistory,
            upcomingEvents,
          });

          if (selfieResult.handled) {
            if (selfieResult.success && selfieResult.imageBase64) {
              // Add a follow-up message with the generated image
              const imageMessage: ChatMessage = {
                role: 'model' as const,
                text: "Here you go!",
                assistantImage: selfieResult.imageBase64,
                assistantImageMimeType: selfieResult.mimeType,
              };
              setChatHistory(prev => [...prev, imageMessage]);

              if (!isMuted) {
                const imageAudio = await generateSpeech("Here you go!");
                if (imageAudio) media.enqueueAudio(imageAudio);
              }
              console.log('✅ Selfie generated and added to chat!');
            } else {
              // Generation failed
              const errorMessage = selfieResult.error || "I couldn't take that pic right now, sorry!";
              setChatHistory(prev => [...prev, { role: 'model' as const, text: errorMessage }]);

              if (!isMuted) {
                const errorAudio = await generateSpeech(errorMessage);
                if (errorAudio) media.enqueueAudio(errorAudio);
              }
              console.error('❌ Selfie generation failed:', selfieResult.error);
            }

            startBackgroundSentiment(intent);
            if (response.action_id) maybePlayResponseAction(response.action_id);
            return;
          }
        }

        // ============================================
        // FALLBACK: Calendar tags in text_response
        // (extracted to handlers/messageActions/calendarActions.ts)
        // ============================================
        const calendarTagParsed = parseCalendarTagFromResponse(response.text_response);

        if (calendarTagParsed) {
          const tagResult = await processCalendarTag(calendarTagParsed, {
            accessToken: session.accessToken,
            currentEvents: upcomingEvents,
          });

          if (tagResult.handled) {
            const confirmationText = tagResult.action === 'create'
              ? `Okay, I'll add "${tagResult.eventSummary}" to your calendar.`
              : `Done! I've removed "${tagResult.eventSummary}" from your calendar.`;
            const displayText = calendarTagParsed.textBeforeTag
              ? `${calendarTagParsed.textBeforeTag}\n\n${confirmationText}`
              : confirmationText;

            setChatHistory(prev => [...prev, { role: 'model' as const, text: displayText }]);
            await conversationHistoryService.appendConversationHistory(
              [{ role: 'user', text: message }, { role: 'model', text: displayText }],
              updatedSession?.interactionId || aiSession?.interactionId
            );
            setLastSavedMessageIndex(updatedHistory.length);

            // Refresh events
            const events = await calendarService.getUpcomingEvents(session.accessToken);
            setUpcomingEvents(events);

            if (!isMuted) {
              const confirmationAudio = await generateSpeech(displayText);
              if (confirmationAudio) media.enqueueAudio(confirmationAudio);
            }

            startBackgroundSentiment(intent);
            if (response.action_id) maybePlayResponseAction(response.action_id);
            if (response.open_app) {
              console.log("🚀 Launching app:", response.open_app);
              window.location.href = response.open_app;
            }
          } else {
            // Tag parsing failed - show error message
            const errorText = tagResult.action === 'delete'
              ? "I tried to delete that event, but couldn't find it. Can you check the event name?"
              : "I tried to create that event, but I got confused by the details. Could you try again?";
            const displayText = calendarTagParsed.textBeforeTag
              ? `${calendarTagParsed.textBeforeTag}\n\n(System: ${errorText})`
              : errorText;

            setErrorMessage(tagResult.error || 'Failed to process calendar action');
            setChatHistory(prev => [...prev, { role: 'model' as const, text: displayText }]);
            await conversationHistoryService.appendConversationHistory(
              [{ role: 'user', text: message }, { role: 'model', text: displayText }],
              updatedSession?.interactionId || aiSession?.interactionId
            );
          }
        } else {
          // 3. Handle Response (no calendar actions)
            setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
            
          await conversationHistoryService.appendConversationHistory(
              [{ role: 'user', text: message }, { role: 'model', text: response.text_response }],
              updatedSession?.interactionId || aiSession?.interactionId
            );
            setLastSavedMessageIndex(updatedHistory.length);

            // Only use original audio if we're not regenerating (i.e., text wasn't JSON)
            if (!isMuted && audioData && !shouldRegenerateAudio) {
                media.enqueueAudio(audioData);
            }

            // Non-critical: kick off sentiment *after* we queued audio (or after text if muted)
          startBackgroundSentiment(intent);

            if (response.action_id) {
                maybePlayResponseAction(response.action_id);
            }
            if (response.open_app) {
                console.log("🚀 Launching app:", response.open_app);
                window.location.href = response.open_app;
            }
        }
      } catch (error) {
        console.error('AI Response failed:', error);
        setErrorMessage("AI Failed to respond");
      }

    } catch (error) {
      console.error('Error:', error);
      setErrorMessage('Failed to generate response.');
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
            onGmailConnectionChange={setIsGmailConnected}
            proactiveSettings={proactiveSettings}
            onProactiveSettingsChange={updateProactiveSettings}
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
                    onSendImage={handleSendImage}
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
