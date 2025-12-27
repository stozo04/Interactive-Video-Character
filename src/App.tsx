import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChatMessage,
  UploadedImage,
  CharacterProfile,
  CharacterAction,
  Task,
  ProactiveSettings,
  DEFAULT_PROACTIVE_SETTINGS,
} from './types';
import * as dbService from './services/cacheService';
import { supabase } from './services/supabaseClient';
import type { AIActionResponse } from './services/aiSchema';
import * as conversationHistoryService from './services/conversationHistoryService';
import * as relationshipService from './services/relationshipService';
import type { RelationshipMetrics } from './services/relationshipService';
import type { FullMessageIntent } from './services/intentService';
import { recordExchange } from './services/callbackDirector';
import { getTopLoopToSurface } from './services/presenceDirector';
import messageAnalyzer from './services/messageAnalyzer';
import { migrateLocalStorageToSupabase } from './services/stateService';
import { gmailService, type NewEmailPayload } from './services/gmailService';
import { 
  calendarService, 
  type CalendarEvent,
  type NewEventPayload 
} from './services/calendarService';
import { generateSpeech } from './services/elevenLabsService'; // Import generateSpeech
import { buildActionKeyMap } from './utils/actionKeyMapper'; // Phase 1 Optimization

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
import { 
  buildWhiteboardPrompt, 
  WHITEBOARD_MODES, 
  parseWhiteboardAction,
  WhiteboardAction 
} from './services/whiteboardModes';
import { useGoogleAuth } from './contexts/GoogleAuthContext';
import { useDebounce } from './hooks/useDebounce';
import { useMediaQueues } from './hooks/useMediaQueues';
import { useCacheWarming } from './hooks/useCacheWarming';
import { useAIService } from './contexts/AIServiceContext';
import { AIChatSession, UserContent } from './services/aiService';
import { startCleanupScheduler, stopCleanupScheduler } from './services/loopCleanupService';
import { GAMES_PROFILE } from './domain/characters/gamesProfile';
import * as taskService from './services/taskService';
import { 
  fetchTechNews, 
  getUnmentionedStory, 
  markStoryMentioned,
  storeLastSharedStories,
  getRecentNewsContext 
} from './services/newsService';
import {
  getApplicableCheckin,
  markCheckinDone,
  buildEventCheckinPrompt,
  cleanupOldCheckins,
  type CheckinType,
} from './services/calendarCheckinService';
import { generateCompanionSelfie } from './services/imageGenerationService';
// Business logic moved to BaseAIService.ts (Clean Architecture)

// Helper to sanitize text for comparison
const sanitizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Helper to extract a single JSON object from a string (finds matching braces)
const extractJsonObject = (str: string): string | null => {
  const firstBrace = str.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = firstBrace; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') depth++;
      if (char === '}') depth--;

      if (depth === 0) {
        return str.substring(firstBrace, i + 1);
      }
    }
  }

  return null;
};

// Get user ID from environment variable
const getUserId = (): string => {
  const userId = import.meta.env.VITE_USER_ID;
  
  if (!userId) {
    throw new Error('VITE_USER_ID environment variable is not set. Please add it to your .env file.');
  }
  
  return userId;
};

const ACTION_VIDEO_BUCKET = 'character-action-videos';
const IDLE_ACTION_DELAY_MIN_MS = 10_000;
const IDLE_ACTION_DELAY_MAX_MS = 45_000;

const randomFromArray = <T,>(items: T[]): T => {
  if (items.length === 0) {
    throw new Error('Cannot select a random item from an empty array.');
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
};

const shuffleArray = <T,>(array: T[]): T[] => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

const QUESTION_STARTERS = [
  'who','what','when','where','why','how',
  'do','does','did','can','could','would','will','is','are','am','was','were',
  'should','shall','have','has','had'
];

const isQuestionMessage = (message: string): boolean => {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('?')) return true;
  const normalized = sanitizeText(trimmed);
  if (!normalized) return false;
  const firstWord = normalized.split(' ')[0];
  return QUESTION_STARTERS.includes(firstWord);
};

const TALKING_KEYWORDS = ['talk', 'talking', 'speak', 'chat', 'answer', 'respond'];
const isTalkingAction = (action: CharacterAction): boolean => {
  const normalizedName = sanitizeText(action.name);
  if (TALKING_KEYWORDS.some(keyword => normalizedName.includes(keyword))) {
    return true;
  }
  const normalizedPhrases = action.phrases.map(sanitizeText);
  return normalizedPhrases.some(phrase =>
    TALKING_KEYWORDS.some(keyword => phrase.includes(keyword))
  );
};

const isGreetingAction = (action: CharacterAction): boolean => {
  const normalizedName = sanitizeText(action.name);
  const normalizedPhrases = action.phrases.map(sanitizeText);
  
  return (
    normalizedName.includes('greeting') ||
    normalizedPhrases.some(phrase => phrase.includes('greeting'))
  );
};

const getGreetingActions = (actions: CharacterProfile['actions']): CharacterAction[] => {
  return actions.filter(isGreetingAction);
};

const getNonGreetingActions = (actions: CharacterProfile['actions']): CharacterAction[] => {
  return actions.filter(action => !isGreetingAction(action));
};

const getTalkingActions = (actions: CharacterProfile['actions']): CharacterAction[] => {
  return actions.filter(isTalkingAction);
};

type View = 'loading' | 'selectCharacter' | 'createCharacter' | 'chat' | 'manageCharacter' | 'whiteboard';

interface DisplayCharacter {
  profile: CharacterProfile;
  imageUrl: string;
  videoUrl: string;
}

const App: React.FC = () => {
  const { session, status: authStatus, signOut } = useGoogleAuth();
  const { activeService, activeServiceId } = useAIService();
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

  // Media Queues Hook
  const media = useMediaQueues();
  
  // Optimization 3: Cache Warming (Idle Pre-fetch)
  // This warms up the stateService and presence caches before the first message
  const userId = useMemo(() => {
    try {
      return getUserId();
    } catch (e) {
      return null;
    }
  }, []);
  useCacheWarming(userId);

  const [currentActionId, setCurrentActionId] = useState<string | null>(null);

  // Derived state - override idle video if speaking
  const currentVideoSrc = 
    (isSpeaking && talkingVideoUrl && !currentActionId) 
      ? talkingVideoUrl 
      : media.currentVideoSrc;

  const nextVideoSrc = media.nextVideoSrc;

  const [actionVideoUrls, setActionVideoUrls] = useState<Record<string, string>>(
    {}
  );
  // Audio queue logic moved to useMediaQueues hook
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [isSavingCharacter, setIsSavingCharacter] = useState(false);
  const [isCreatingAction, setIsCreatingAction] = useState(false);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);
  const [deletingActionId, setDeletingActionId] = useState<string | null>(null);
  const [characterForManagement, setCharacterForManagement] = useState<CharacterProfile | null>(null);
  const [isAddingIdleVideo, setIsAddingIdleVideo] = useState(false);
  const [deletingIdleVideoId, setDeletingIdleVideoId] = useState<string | null>(null);
  const [isUpdatingImage, setIsUpdatingImage] = useState(false);
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now());
  const [isMuted, setIsMuted] = useState(false);
  // Avoid stale-closure issues in async callbacks (e.g. async TTS completion).
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  const [aiSession, setAiSession] = useState<AIChatSession | null>(null);
  const [lastSavedMessageIndex, setLastSavedMessageIndex] = useState<number>(-1);
  const [relationship, setRelationship] = useState<RelationshipMetrics | null>(null);
  const [isVideoVisible, setIsVideoVisible] = useState(true);
  const [isLoadingCharacter, setIsLoadingCharacter] = useState(false);
  const [loadingCharacterName, setLoadingCharacterName] = useState<string | null>(null);
  
  // Task Management State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);
  
  // Snooze State for Idle Check-ins (controlled via Settings > Proactive Features)
  const [isSnoozed, setIsSnoozed] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);

  // Gmail Integration State
  const [isGmailConnected, setIsGmailConnected] = useState(false);
  const [emailQueue, setEmailQueue] = useState<NewEmailPayload[]>([]);
  const debouncedEmailQueue = useDebounce(emailQueue, 5000); 

  // Calendar Integration State
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>([]);
  const [kayleyContext, setKayleyContext] = useState<string>("");
  
  // Proactive Settings State
  const PROACTIVE_SETTINGS_KEY = 'kayley_proactive_settings';
  const [proactiveSettings, setProactiveSettings] = useState<ProactiveSettings>(() => {
    const stored = localStorage.getItem(PROACTIVE_SETTINGS_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_PROACTIVE_SETTINGS;
  });
  
  const updateProactiveSettings = useCallback((updates: Partial<ProactiveSettings>) => {
    setProactiveSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem(PROACTIVE_SETTINGS_KEY, JSON.stringify(next));
      console.log('🔧 Proactive settings updated:', next);
      return next;
    });
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [notifiedEventIds, setNotifiedEventIds] = useState<Set<string>>(new Set());
  const idleActionTimerRef = useRef<number | null>(null);
  const hasInteractedRef = useRef(false);
  const lastIdleBreakerAtRef = useRef<number | null>(null);

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

  // Phase 5 Migration: LocalStorage -> Supabase
  // Ensure user data is migrated when they log in
  useEffect(() => {
    try {
      const userId = getUserId();
      migrateLocalStorageToSupabase(userId)
        .catch(err => console.error('❌ [Migration] Failed:', err));
    } catch (e) {
      // Ignore if user ID check fails (e.g. env var missing in dev)
    }
  }, []);

  // Loop Cleanup: Initialize scheduled cleanup for stale/duplicate loops
  useEffect(() => {
    try {
      const userId = getUserId();
      if (userId) {
        startCleanupScheduler(userId, {
          onComplete: (result) => {
            if (result.totalExpired > 0) {
              console.log(`🧹 Cleaned up ${result.totalExpired} stale loops`);
            }
          }
        });
        
        return () => {
          stopCleanupScheduler();
        };
      }
    } catch (e) {
      // Ignore if user ID check fails (e.g. env var missing in dev)
      console.log(`❌ [LoopCleanup] Error starting cleanup scheduler:`, e);
    }
  }, []);


  // --- Handle Image Input ---
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
      const userId = getUserId();
      const sessionToUse: AIChatSession = aiSession || { userId, characterId: selectedCharacter.id };

      // 2. Send to AI Service
      const { response, session: updatedSession, audioData } = await activeService.generateResponse(
        { 
          type: 'image_text', 
          text: "What do you think of this?", // Default prompt
          imageData: base64,
          mimeType: mimeType
        },
        {
          character: selectedCharacter,
          chatHistory: chatHistory, 
          relationship: relationship, 
          upcomingEvents: upcomingEvents,
          characterContext: kayleyContext,
          tasks: tasks,
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
              userId,
              [{ role: 'user', text: '📷 [Sent an Image]' }, { role: 'model', text: displayText }]
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
            userId,
            [{ role: 'user', text: '📷 [Sent an Image]' }, { role: 'model', text: response.text_response }]
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

  // REMOVED: handleSendAudio is no longer used since we use text-only input for all services now
  // The microphone now just populates the text input via browser STT.

  const reportError = useCallback((message: string, error?: unknown) => {
    console.error(message, error);
    setErrorMessage(message);
  }, []);

  const registerInteraction = useCallback(() => {
    setLastInteractionAt(Date.now());
    hasInteractedRef.current = true;
  }, []);

  const cleanupActionUrls = useCallback((urls: Record<string, string>) => {
    Object.values(urls).forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        console.warn('Failed to revoke action video URL', error);
      }
    });
  }, []);

  const applyCharacterUpdate = useCallback(
    (
      characterId: string,
      updater: (character: CharacterProfile) => CharacterProfile
    ) => {
      let updatedCharacter: CharacterProfile | null = null;

      setCharacters((chars) =>
        chars.map((char) => {
          if (char.id !== characterId) {
            return char;
          }
          const next = updater(char);
          updatedCharacter = next;
          return next;
        })
      );

      setSelectedCharacter((current) => {
        if (!current || current.id !== characterId) {
          return current;
        }
        if (updatedCharacter) {
          return updatedCharacter;
        }
        return updater(current);
      });
    },
    []
  );

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

  // Insert action video; optionally interrupt the current video for instant playback
  const playAction = (actionId: string, forceImmediate = false): boolean => {
    let actionUrl = actionVideoUrls[actionId] ?? null;

    // Fallback to public URL if we only have a stored path
    if (!actionUrl) {
      const action = selectedCharacter?.actions.find(a => a.id === actionId);
      if (action?.videoPath) {
        const { data } = supabase.storage
        .from(ACTION_VIDEO_BUCKET)
        .getPublicUrl(action.videoPath);
        actionUrl = data?.publicUrl ?? null;
      }
    }

    if (!actionUrl) return false;

    media.playAction(actionUrl, forceImmediate);
    setCurrentActionId(actionId);
    return true;
  };

  const isTalkingActionId = useCallback(
    (actionId: string): boolean => {
      const action = selectedCharacter?.actions.find(a => a.id === actionId);
      return action ? isTalkingAction(action) : false;
    },
    [selectedCharacter]
  );

  const playRandomTalkingAction = (forceImmediate = true): string | null => {
    if (!selectedCharacter) return null;

    const talkingActions = shuffleArray(getTalkingActions(selectedCharacter.actions));
    for (const action of talkingActions) {
      const played = playAction(action.id, forceImmediate);
      if (played) {
        return action.id;
      }
    }

    return null;
  };

  const handleSpeechStart = useCallback(() => {
    setIsSpeaking(true);
    if (!isTalkingActionId(currentActionId || '')) {
      playRandomTalkingAction(true);
    }
  }, [currentActionId, isTalkingActionId]);

  const triggerIdleAction = useCallback(() => {
    if (!selectedCharacter) return;
    if (selectedCharacter.actions.length === 0) return;
    
    const nonGreetingActions = getNonGreetingActions(selectedCharacter.actions);
    if (nonGreetingActions.length === 0) return;

    const action: CharacterAction = randomFromArray(nonGreetingActions);
    
    // Ensure we have the URL
    let actionUrl = actionVideoUrls[action.id] ?? null;
    if (!actionUrl && action.videoPath) {
      const { data } = supabase.storage
        .from(ACTION_VIDEO_BUCKET)
        .getPublicUrl(action.videoPath);
      actionUrl = data?.publicUrl ?? null;
    }
    
    if (actionUrl) {
        // Insert action at index 1 (next to play)
        media.playAction(actionUrl);
        setCurrentActionId(action.id);
        setLastInteractionAt(Date.now());
    }

  }, [
    selectedCharacter,
    actionVideoUrls,
    media
  ]);

  const clearIdleActionTimer = useCallback(() => {
    if (idleActionTimerRef.current !== null) {
      window.clearTimeout(idleActionTimerRef.current);
      idleActionTimerRef.current = null;
    }
  }, []);

  const scheduleIdleAction = useCallback(() => {
    clearIdleActionTimer();

    if (!selectedCharacter) return;
    if (selectedCharacter.actions.length === 0) return;
    if (isProcessingAction) return;
    // Don't schedule if we are already playing an action?
    // We can check if current video is an idle video.
    // With queue, it's harder to know if queue[0] is idle or action unless we track it.
    // For now, simple random schedule.

    const delay =
      Math.floor(
        Math.random() *
          (IDLE_ACTION_DELAY_MAX_MS - IDLE_ACTION_DELAY_MIN_MS + 1)
      ) + IDLE_ACTION_DELAY_MIN_MS;

    idleActionTimerRef.current = window.setTimeout(() => {
      triggerIdleAction();
    }, delay);
  }, [
    clearIdleActionTimer,
    selectedCharacter,
    isProcessingAction,
    triggerIdleAction,
  ]);

  // Audio Queue Management handled by useMediaQueues hook
  const { enqueueAudio, handleAudioEnd } = media;

  const triggerSystemMessage = useCallback(async (systemPrompt: string) => {
    if (!selectedCharacter || !session) return;

    // 1. Show typing indicator immediately
    setIsProcessingAction(true);

    try {
      const userId = getUserId();
      // 2. Send to AI (Grok/Gemini)
      // Notice we pass the systemPrompt as 'text' but with a special type or just handle it as text
      const { response, session: updatedSession, audioData } = await activeService.generateResponse(
        { type: 'text', text: systemPrompt }, 
        {
          character: selectedCharacter,
          chatHistory, // Pass existing history so it knows context
          relationship, 
          upcomingEvents,
          characterContext: kayleyContext,
        },
        aiSession || { userId, characterId: selectedCharacter.id }
      );

      setAiSession(updatedSession);

      // 3. Add ONLY the AI response to chat history (No user bubble)
      setChatHistory(prev => [
        ...prev, 
        { role: 'model', text: response.text_response }
      ]);
      
      // 4. Play Audio/Action
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

    const userId = getUserId();

    // Business Logic: Delegate to BaseAIService (the Brain)
    if (!activeService.triggerIdleBreaker) {
      console.warn('[IdleBreaker] Service does not support triggerIdleBreaker');
      return;
    }

    try {
      setIsProcessingAction(true);

      const result = await activeService.triggerIdleBreaker(
        userId,
        {
          character: selectedCharacter,
          relationship,
          tasks,
          chatHistory,
          characterContext: kayleyContext,
          upcomingEvents,
          proactiveSettings,
        },
        aiSession || { userId, characterId: selectedCharacter.id }
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

  // Calendar check-in trigger function
  const triggerCalendarCheckin = useCallback((event: CalendarEvent, type: CheckinType) => {
    // Respect snooze and proactive settings
    if (isSnoozed || !proactiveSettings.calendar) {
      console.log(`📅 Skipping calendar check-in (snoozed: ${isSnoozed}, calendar enabled: ${proactiveSettings.calendar})`);
      return;
    }
    
    // Mark this check-in as done to avoid duplicates
    markCheckinDone(event.id, type);
    
    // Build and send the prompt
    const prompt = buildEventCheckinPrompt(event, type);
    console.log(`📅 Triggering ${type} check-in for event: ${event.summary}`);
    triggerSystemMessage(prompt);
  }, [isSnoozed, proactiveSettings.calendar, triggerSystemMessage]);

  // Check for applicable calendar check-ins
  useEffect(() => {
    if (!selectedCharacter || weekEvents.length === 0 || !proactiveSettings.calendar) return;
    
    const checkCalendarEvents = () => {
      // Don't trigger if already processing or speaking
      if (isProcessingAction || isSpeaking) return;
      
      for (const event of weekEvents) {
        const applicableType = getApplicableCheckin(event);
        if (applicableType) {
          triggerCalendarCheckin(event, applicableType);
          break; // One check-in at a time
        }
      }
    };
    
    // Check every 2 minutes
    const interval = setInterval(checkCalendarEvents, 2 * 60 * 1000);
    // Also check immediately after a delay (to avoid firing on initial load)
    const initialCheck = setTimeout(checkCalendarEvents, 30000);
    
    return () => {
      clearInterval(interval);
      clearTimeout(initialCheck);
    };
  }, [weekEvents, selectedCharacter, isProcessingAction, isSpeaking, proactiveSettings.calendar, triggerCalendarCheckin]);

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
        try {
          const userId = getUserId();
          prefetchOnIdle(userId);
          prefetchTriggered = true;
        } catch (e) {
          // Ignore if userId not available
        }
      }
    };

    const interval = window.setInterval(checkPrefetch, 5000);
    return () => {
      window.clearInterval(interval);
      clearPrefetchCache();
    };
  }, [lastInteractionAt, isProcessingAction, isSpeaking, selectedCharacter, session]);

  // Keyboard Shortcuts
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

  // Gmail Integration Hooks
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

  useEffect(() => {
    // Calendar should work as long as we are logged in, regardless of "Gmail Connected" toggle
    if (!session) return;

    const pollCalendar = async () => {
        try {
          console.log("📅 Polling calendar events...");
            const events = await calendarService.getUpcomingEvents(session.accessToken);
            setUpcomingEvents(events); 
        } catch (e) { console.error("Calendar poll failed", e); }
    };

    // Poll immediately on mount/session-start, then every 5 min
    pollCalendar();

    const intervalId = setInterval(pollCalendar, 300000);

    return () => {
        clearInterval(intervalId);
    };
  }, [session]);
  
  // Fetch week events for proactive calendar check-ins
  useEffect(() => {
    if (!session) return;
    
    const fetchWeekEvents = async () => {
      try {
        console.log("📅 Fetching week calendar events for proactive check-ins...");
        const events = await calendarService.getWeekEvents(session.accessToken);
        setWeekEvents(events);
        // Clean up old check-in states for events no longer in this week
        cleanupOldCheckins(events.map(e => e.id));
      } catch (e) {
        console.error('Week calendar fetch failed', e);
      }
    };
    
    fetchWeekEvents();
    // Refresh every 5 minutes
    const interval = setInterval(fetchWeekEvents, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [session]);


  useEffect(() => {
    const handleNewMail = (event: Event) => {
      const customEvent = event as CustomEvent<NewEmailPayload[]>;
      setEmailQueue(prev => [...prev, ...customEvent.detail]);
    };

    const handleAuthError = () => {
      console.log("🔒 Auth error detected. Signing out...");
      setIsGmailConnected(false);
      localStorage.removeItem('gmail_history_id');
      setErrorMessage('Google session expired. Please reconnect.');
      signOut(); // Force sign out to clear invalid session
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

      const userId = getUserId();
      try {
        await conversationHistoryService.appendConversationHistory(
          userId,
          [{ role: 'model', text: characterMessage }]
        );
        setLastSavedMessageIndex(updatedHistory.length - 1);

        // Generate speech for the email notification
        if (!isMuted) {
          const audioData = await generateSpeech(characterMessage);
          if (audioData) {
            enqueueAudio(audioData);
          }
        }

      } catch (error) { console.error(error); }

      setEmailQueue([]);
    };

    processEmailNotification();
  }, [debouncedEmailQueue, selectedCharacter, isMuted]); // Added isMuted to dependencies

  const handleImageUpload = (image: UploadedImage) => {
    setUploadedImage(image);
    setErrorMessage(null);
  };

  const handleCharacterCreated = async (
    image: UploadedImage,
    idleVideoBlob: Blob
  ) => {
    registerInteraction();
    setIsSavingCharacter(true);
    setErrorMessage(null);
    try {
      const imageHash = await dbService.hashImage(image.base64);
      const existingChar = characters.find((c) => c.id === imageHash);
      if (existingChar) {
        alert('Character exists. Loading...');
        handleSelectCharacter(existingChar);
        return;
      }

      const newCharacter: CharacterProfile = {
        id: imageHash,
        createdAt: Date.now(),
        image,
        idleVideoUrls: [], // Will be populated after save
        actions: [],
        name: 'Kayley Adams',
        displayName: 'Kayley',
      };

      // Save character with the video file
      await dbService.saveCharacter(newCharacter, idleVideoBlob);
      
      // Reload character to get the public URL
      const savedChars = await dbService.getCharacters();
      const savedChar = savedChars.find(c => c.id === imageHash);
      if (savedChar) {
        setCharacters((prev) => [savedChar, ...prev]);
        handleSelectCharacter(savedChar);
      }
    } catch (error) {
      reportError('Failed to save character.', error);
    } finally {
      setIsSavingCharacter(false);
    }
  };

  const handleCreateAction = async (input: { name: string; phrases: string[]; videoFile: File }) => {
    const character = characterForManagement || selectedCharacter;
    if (!character) return;
    
    console.log(`🎬 Creating action "${input.name}" for ${character.displayName}`);
    
    registerInteraction();
    setIsCreatingAction(true);
    try {
      const metadata = await dbService.createCharacterAction(character.id, {
        name: input.name,
        phrases: input.phrases,
        video: input.videoFile,
      });
      
      console.log(`✅ Created action with ID: ${metadata.id}`);
      
      const newAction = {
        id: metadata.id,
        name: metadata.name,
        phrases: metadata.phrases,
        video: input.videoFile,
        videoPath: metadata.videoPath,
        sortOrder: metadata.sortOrder ?? null,
      };
      
      // Update global character list
      applyCharacterUpdate(character.id, char => {
        console.log(`  Updating character: adding action to ${char.actions.length} existing actions`);
        return {
          ...char, 
          actions: [...char.actions, newAction]
        };
      });
      
      // Create URL for immediate preview
      const newUrl = URL.createObjectURL(input.videoFile);
      setActionVideoUrls(prev => ({ ...prev, [metadata.id]: newUrl }));
      console.log(`  Created URL for action video`);
      
      // Update the management character state if we're in management view
      if (characterForManagement) {
        setCharacterForManagement(prev => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            actions: [...prev.actions, newAction]
          };
          console.log(`  Updated management character: ${prev.actions.length} -> ${updated.actions.length} actions`);
          return updated;
        });
      }

    } catch (error) {
      reportError('Failed to create action.', error);
      console.error('Action creation error:', error);
    } finally {
      setIsCreatingAction(false);
    }
  };

  const handleUpdateAction = async (actionId: string, input: any) => {
    const character = characterForManagement || selectedCharacter;
    if (!character) return;
    
    console.log(`✏️ Updating action "${actionId}" for ${character.displayName}`);
    
    setUpdatingActionId(actionId);
    try {
        const metadata = await dbService.updateCharacterAction(character.id, actionId, input);
        console.log(`✅ Updated action metadata`);
        
        // Update global character list
        applyCharacterUpdate(character.id, char => ({
            ...char, 
            actions: char.actions.map(a => a.id === actionId ? { ...a, ...metadata, video: input.videoFile || a.video } : a)
        }));
        
        // Update URL if new video provided
        if(input.videoFile) {
            const newUrl = URL.createObjectURL(input.videoFile);
            setActionVideoUrls(prev => ({...prev, [actionId]: newUrl}));
            console.log(`  Created new URL for updated video`);
        }
        
        // Update the management character state if we're in management view
        if (characterForManagement) {
          setCharacterForManagement(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              actions: prev.actions.map(a => a.id === actionId ? { ...a, ...metadata, video: input.videoFile || a.video } : a)
            };
          });
          console.log(`  Updated management character`);
        }
    } catch (e) { 
      reportError('Failed to update', e);
      console.error('Action update error:', e);
    } 
    finally { setUpdatingActionId(null); }
  };

  const handleDeleteAction = async (actionId: string) => {
    const character = characterForManagement || selectedCharacter;
    if (!character) return;
    
    console.log(`🗑️ Deleting action "${actionId}" for ${character.displayName}`);
    
    setDeletingActionId(actionId);
    try {
        await dbService.deleteCharacterAction(character.id, actionId);
        console.log(`✅ Deleted action from database`);
        
        // Update global character list
        applyCharacterUpdate(character.id, char => ({
            ...char, actions: char.actions.filter(a => a.id !== actionId)
        }));
        
        // Revoke URL
        const urlToRevoke = actionVideoUrls[actionId];
        if (urlToRevoke) {
          URL.revokeObjectURL(urlToRevoke);
          console.log(`  Revoked URL for action`);
          
          // Remove any queued instances of this action clip to avoid invalid blob URLs
          const idleFallback = (characterForManagement || selectedCharacter)?.idleVideoUrls ?? [];
          media.setVideoQueue(prev => {
            const filtered = prev.filter(url => url !== urlToRevoke);
            if (filtered.length > 0) return filtered;
            // If nothing left, fall back to idle videos
            return idleFallback.length > 0
              ? shuffleArray([...idleFallback])
              : [];
          });
        }
        
        // Update the management character state if we're in management view
        if (characterForManagement) {
          setCharacterForManagement(prev => {
            if (!prev) return prev;
            const updated = {
              ...prev,
              actions: prev.actions.filter(a => a.id !== actionId)
            };
            console.log(`  Updated management character: ${prev.actions.length} -> ${updated.actions.length} actions`);
            return updated;
          });
        }
    } catch(e) { 
      reportError('Failed to delete', e);
      console.error('Action delete error:', e);
    }
    finally { setDeletingActionId(null); }
  };

  const handleSelectLocalVideo = async (videoFile: File) => {
    if (!uploadedImage) {
      reportError('Upload an image first.');
      return;
    }
    await handleCharacterCreated(uploadedImage, videoFile);
  };

  const handleManageCharacter = (character: CharacterProfile) => {
    registerInteraction();
    
    // Create URLs for action videos if they don't exist
    const newActionUrls = character.actions.reduce((map, action) => {
      if (!actionVideoUrls[action.id]) {
        map[action.id] = URL.createObjectURL(action.video);
      } else {
        map[action.id] = actionVideoUrls[action.id];
      }
      return map;
    }, {} as Record<string, string>);
    
    setActionVideoUrls((prev) => ({ ...prev, ...newActionUrls }));
    setCharacterForManagement(character);
    setView('manageCharacter');
  };

  const handleAddIdleVideo = async (videoFile: File) => {
    if (!characterForManagement) return;
    setIsAddingIdleVideo(true);
    try {
      const videoId = await dbService.addIdleVideo(characterForManagement.id, videoFile);
      
      // Get the public URL for the newly added video
      const idleVideosList = await dbService.getIdleVideos(characterForManagement.id);
      const newVideo = idleVideosList.find(v => v.id === videoId);
      
      if (newVideo) {
        const { data: urlData } = supabase.storage
          .from('character-videos')
          .getPublicUrl(newVideo.path);
        
        const newUrl = urlData.publicUrl;
        
        // Update character with new video URL
        applyCharacterUpdate(characterForManagement.id, char => {
          return {
            ...char,
            idleVideoUrls: [...char.idleVideoUrls, newUrl]
          };
        });
        
        // Update the management character state
        setCharacterForManagement(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            idleVideoUrls: [...prev.idleVideoUrls, newUrl]
          };
        });
      }
      
      } catch (error) {
      reportError('Failed to add idle video.', error);
    } finally {
      setIsAddingIdleVideo(false);
    }
  };

  const handleDeleteIdleVideo = async (videoId: string) => {
    if (!characterForManagement) return;
    
    // Extract index from ID (format: "idle-{index}")
    const index = parseInt(videoId.split('-')[1]);
    if (isNaN(index)) return;
    
    setDeletingIdleVideoId(videoId);
    try {
      // Get the actual database ID from the character's idle videos
      const idleVideosList = await dbService.getIdleVideos(characterForManagement.id);
      
      if (idleVideosList[index]) {
        const removedUrl = characterForManagement.idleVideoUrls[index];
        const remainingUrls = characterForManagement.idleVideoUrls.filter((_, i) => i !== index);

        await dbService.deleteIdleVideo(characterForManagement.id, idleVideosList[index].id);
        
        // Update character by removing the video URL at this index
        applyCharacterUpdate(characterForManagement.id, char => {
          return {
            ...char,
            idleVideoUrls: char.idleVideoUrls.filter((_, i) => i !== index)
          };
        });
        
        // Update the management character state
        setCharacterForManagement(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            idleVideoUrls: prev.idleVideoUrls.filter((_, i) => i !== index)
          };
        });

        // Remove the deleted idle clip from the playback queue to avoid invalid sources
        media.setVideoQueue(prev => {
          const filtered = prev.filter(url => url !== removedUrl);
          if (filtered.length > 0) return filtered;
          // If queue is empty, repopulate with remaining idle videos (if any)
          return remainingUrls.length > 0 ? shuffleArray([...remainingUrls]) : [];
        });
      }
    } catch (error) {
      reportError('Failed to delete idle video.', error);
    } finally {
      setDeletingIdleVideoId(null);
    }
  };

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


    // Load tasks and perform daily rollover check
    // ASYNC TASK LOADING
    let currentTasks: Task[] = [];
    try {
      // Use session ID if available, otherwise fallback to env user ID
      const userId = getUserId();
      if (userId) {
        currentTasks = await taskService.fetchTasks(userId);
        console.log(`📋 Loaded ${currentTasks.length} task(s) from Supabase for user ${userId}`);
      } else {
        console.warn('⚠️ No user ID available, skipping task fetch');
      }
    } catch (err) {
      console.error('Failed to fetch tasks', err);
    }
    setTasks(currentTasks);
    
    // Load snooze state
    const snoozeIndefinite = localStorage.getItem('kayley_snooze_indefinite');
    const snoozeUntilStr = localStorage.getItem('kayley_snooze_until');
    
    if (snoozeIndefinite === 'true') {
      setIsSnoozed(true);
      setSnoozeUntil(null);
      console.log('⏸️ Check-ins are snoozed indefinitely');
    } else if (snoozeUntilStr) {
      const snoozeEnd = parseInt(snoozeUntilStr);
      if (Date.now() < snoozeEnd) {
        setIsSnoozed(true);
        setSnoozeUntil(snoozeEnd);
        console.log('⏸️ Check-ins are snoozed until', new Date(snoozeEnd).toLocaleTimeString());
      } else {
        // Snooze expired - clear both localStorage and React state
        localStorage.removeItem('kayley_snooze_until');
        setIsSnoozed(false);
        setSnoozeUntil(null);
        console.log('⏰ Snooze period expired (cleared on load)');
      }
    }

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
      const userId = getUserId();

      // ============================================
      // FRESH SESSION: Don't load history anymore!
      // AI uses memory tools to recall past context
      // ============================================
      console.log('🧠 [App] Starting FRESH session - AI will use memory tools for context');

      // Still load relationship data for tone/personality
      const relationshipData = await relationshipService.getRelationship(userId);
      setRelationship(relationshipData);
      
      try {
        // Check if this is the first login of the day
        // If so, skip the immediate greeting - the Daily Catch-up will handle it in 5s
        const today = new Date().toDateString();
        const lastBriefingDate = localStorage.getItem(`last_briefing_${character.id}`);
        const isFirstLoginToday = lastBriefingDate !== today;

        // Start with fresh session
        const session: AIChatSession = { userId, model: activeService.model };

        if (isFirstLoginToday) {
          // First login of the day: Skip immediate greeting, let Daily Catch-up handle it
          console.log('🌅 [App] First login today - skipping immediate greeting, Daily Catch-up will fire in 5s');
          setAiSession(session);
          setChatHistory([]); // Empty - catch-up will provide the greeting
        } else {
          // Returning user (already had catch-up today): Generate normal greeting
          const { greeting, session: updatedSession } = await activeService.generateGreeting(
            character, session, relationshipData, kayleyContext
          );
          setAiSession(updatedSession);

          // Start with just the greeting - fresh session!
          const initialHistory = [{ role: 'model' as const, text: greeting.text_response }];
          setChatHistory(initialHistory);

          if (greeting.action_id && newActionUrls[greeting.action_id]) {
              setTimeout(() => {
                  playAction(greeting.action_id!);
              }, 100);
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

  const handleDeleteCharacter = async (id: string) => {
    if (window.confirm("Delete character?")) {
        if (selectedCharacter?.id === id) handleBackToSelection();
        await dbService.deleteCharacter(id);
        setCharacters(prev => prev.filter(c => c.id !== id));
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

  const handleBackToSelection = async () => {
    // No need to revoke idle video URLs - they're public URLs!
    media.setVideoQueue([]); // This also clears currentVideoSrc and nextVideoSrc (derived)
    
    // Clear audio
    media.setAudioQueue([]);
    
    setSelectedCharacter(null);
    setChatHistory([]);
    setAiSession(null);
    setView('selectCharacter');
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

  // Task Management Handlers
  const handleTaskCreate = useCallback(async (text: string, priority?: 'low' | 'medium' | 'high') => {
    const userId = getUserId();
    const newTask = await taskService.createTask(userId, text, priority);
    if (newTask) {
      setTasks(prev => [...prev, newTask]);

      // Kayley celebrates the task creation
      if (selectedCharacter && !isMuted) {
        const celebrations = [
          "Got it! Added to your list ✨",
          "Done! I'll help you remember that.",
          "Added! One step at a time 🤍",
          "On the list! You've got this."
        ];
        const message = celebrations[Math.floor(Math.random() * celebrations.length)];

        generateSpeech(message).then(audio => {
          if (audio) media.enqueueAudio(audio);
        });

        setChatHistory(prev => [...prev, { role: 'model', text: message }]);
      }
    }
  }, [selectedCharacter, isMuted, media]);

  const handleTaskToggle = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const updatedTask = await taskService.toggleTask(taskId, task.completed);
    if (updatedTask) {
      setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));
      
      // Celebrate completion!
      if (updatedTask.completed && selectedCharacter && !isMuted) {
        const celebrations = [
          "Nice! That's one thing off your plate ✨",
          "You crushed it! One down!",
          "Look at you go! ✅",
          "Done and done! Great work 🤍",
          "Boom! Another one bites the dust!"
        ];
        const message = celebrations[Math.floor(Math.random() * celebrations.length)];
        
        generateSpeech(message).then(audio => {
          if (audio) media.enqueueAudio(audio);
        });
        
        setChatHistory(prev => [...prev, { role: 'model', text: message }]);
        
        // Try to play a positive action if available
        const positiveActions = selectedCharacter.actions.filter(a => 
          a.name.toLowerCase().includes('happy') || 
          a.name.toLowerCase().includes('celebrate') ||
          a.name.toLowerCase().includes('excited')
        );
        if (positiveActions.length > 0) {
          playAction(positiveActions[0].id);
        }
      }
    }
  }, [tasks, selectedCharacter, isMuted, media, playAction]); // Added tasks dependency for current state

  const handleTaskDelete = useCallback(async (taskId: string) => {
    const success = await taskService.deleteTask(taskId);
    if (success) {
      setTasks(prev => prev.filter(t => t.id !== taskId));
    }
  }, []);

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
    const startBackgroundAnalysis = (_userId: string) => {
      try {
        recordExchange(); // For callback timing
      } catch (e) { console.warn('Exchange record failed', e); }
    };

    // Start analysis immediately in background
    // (It performs its own async operations without blocking)
    try {
      startBackgroundAnalysis(getUserId());
    } catch (e) {
      console.error("Failed to start background analysis", e);
    }

    // Background (non-critical) sentiment analysis should NOT compete with the critical path.
    // We'll start it only after we've queued the AI's audio response (or displayed the text if muted).
    let sentimentPromise: Promise<any> | null = null;
    const startBackgroundSentiment = (userId: string, intent?: FullMessageIntent) => {
      if (sentimentPromise) return;

      sentimentPromise = relationshipService
        .analyzeMessageSentiment(message, updatedHistory, activeServiceId, intent)
        .then(event => relationshipService.updateRelationship(userId, event))
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
      const userId = getUserId();

      // ============================================
      // LLM-BASED USER FACT DETECTION
      // Facts are detected by the intent service LLM and processed after response
      // This replaced the old regex-based detectAndStoreUserInfo
      // ============================================

      const sessionToUse: AIChatSession = aiSession || { userId, characterId: selectedCharacter.id };
      const context = {
          character: selectedCharacter,
          chatHistory: chatHistory, 
          relationship: relationship, 
          upcomingEvents: upcomingEvents,
          characterContext: kayleyContext,
          tasks: tasks,
        googleAccessToken: session.accessToken,
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

        // Update context with the potentially fresher events
        const freshContext = {
          ...context,
          upcomingEvents: currentEventsContext
        };

        const { response, session: updatedSession, audioData, intent } = await activeService.generateResponse(
          { type: 'text', text: textToSend },
          freshContext,
          sessionToUse
        );

        setAiSession(updatedSession);

        // Debug: Log full response to check structure
        console.log('🔍 Full AI response:', JSON.stringify(response, null, 2));

        // Process LLM-detected user facts (background, non-blocking)
        // This uses semantic understanding from the intent service instead of regex patterns
        if (intent?.userFacts?.hasFactsToStore && intent.userFacts.facts.length > 0) {
          import('./services/memoryService').then(({ processDetectedFacts }) => {
            processDetectedFacts(userId, intent.userFacts!.facts).catch(err =>
              console.warn('Failed to process LLM-detected user facts:', err)
            );
          });
        }

        // IMPORTANT: Refresh tasks after AI response in case task_action tool was called
        // The tool modifies Supabase directly, so we need to sync UI state
        taskService.fetchTasks(userId).then(freshTasks => {
          setTasks(freshTasks);
          console.log('📋 Tasks refreshed after AI response');
        }).catch(err => {
          console.warn('Failed to refresh tasks:', err);
        });

        // Detect and store character facts from the response (background, non-blocking)
        // This captures new facts about Kayley that aren't in the profile
        if (response.text_response) {
          processAndStoreCharacterFacts(response.text_response).catch(err => {
            console.warn('Failed to process character facts:', err);
          });
        }
        
        const maybePlayResponseAction = (actionId?: string | null) => {
          if (!actionId) return;
          if (actionId !== predictedActionId && actionId !== talkingActionId) {
            playAction(actionId, true);
          } else {
            console.log("Skipping duplicate action playback");
          }
        };

        // Parse task_action from text_response if it's embedded as JSON
        let taskAction = response.task_action;
        let shouldRegenerateAudio = false;
        
        if (!taskAction && response.text_response) {
          try {
            // Check if text_response contains JSON with task_action
            const textResponseTrimmed = response.text_response.trim();
            if (textResponseTrimmed.startsWith('{') && textResponseTrimmed.includes('task_action')) {
              const parsed = JSON.parse(textResponseTrimmed);
              if (parsed.task_action) {
                console.log('📋 Extracted task_action from text_response');
                taskAction = parsed.task_action;
                // Clean up the text_response to remove the JSON
                response.text_response = "Got it! I'll help you with that.";
                // Flag to regenerate audio with the cleaned text
                shouldRegenerateAudio = true;
              }
            }
          } catch (e) {
            console.warn('Failed to parse task_action from text_response:', e);
          }
        }
        
        // Fallback: Detect task completion intent from user message if AI didn't provide task_action
        if (!taskAction && message) {
          const messageLower = message.toLowerCase();
          const completionKeywords = ['done', 'finished', 'complete', 'completed', 'is done', 'finished', 'got it done'];
          const taskKeywords = ['task', 'todo', 'checklist'];
          
          // Check if message indicates task completion
          const hasCompletionIntent = completionKeywords.some(kw => messageLower.includes(kw));
          const mentionsTask = taskKeywords.some(kw => messageLower.includes(kw)) || tasks.some(t => messageLower.includes(t.text.toLowerCase()));
          
          if (hasCompletionIntent && (mentionsTask || tasks.length > 0)) {
            console.log('📋 Detected task completion intent from user message (AI missed it)');
            
            // Try to find which task they're referring to
            let matchedTask = null;
            for (const task of tasks) {
              if (!task.completed && messageLower.includes(task.text.toLowerCase())) {
                matchedTask = task.text;
                break;
              }
            }
            
            // If we found a task match, create the task_action
            if (matchedTask) {
              console.log(`📋 Fallback: Marking "${matchedTask}" as complete`);
              taskAction = {
                action: 'complete',
                task_text: matchedTask
              };
            }
          }
        }
        
        // Regenerate audio if we cleaned up JSON from text_response
        if (shouldRegenerateAudio && !isMuted) {
          console.log('🔊 Regenerating audio for cleaned response');
          generateSpeech(response.text_response).then(cleanAudio => {
            if (cleanAudio) {
              // Replace the audio data with clean version
              media.enqueueAudio(cleanAudio);
            }
          });
        }

        // Check for Task Action
        if (taskAction && taskAction.action) {
          console.log('📋 Task action detected:', taskAction);
          const userId = getUserId();
          
          try {
            switch (taskAction.action) {
              case 'create':
                if (taskAction.task_text) {
                  const newTask = await taskService.createTask(
                    userId,
                    taskAction.task_text, 
                    taskAction.priority as 'low' | 'medium' | 'high' | undefined
                  );
                  if (newTask) setTasks(prev => [...prev, newTask]);
                  console.log('✅ Task created (AI):', newTask?.text);
                }
                break;
                
              case 'complete':
                if (taskAction.task_text) {
                  const foundTask = await taskService.findTaskByText(userId, taskAction.task_text);
                  if (foundTask) {
                    const updated = await taskService.toggleTask(foundTask.id, foundTask.completed);
                    if (updated) setTasks(prev => prev.map(t => t.id === foundTask.id ? updated : t));
                    console.log('✅ Task completed (AI):', foundTask.text);
                  }
                } else if (taskAction.task_id) {
                  // We need current state to toggle
                  const task = tasks.find(t => t.id === taskAction.task_id);
                  if (task) {
                    const updated = await taskService.toggleTask(taskAction.task_id, task.completed);
                    if (updated) setTasks(prev => prev.map(t => t.id === taskAction.task_id ? updated : t));
                  }
                }
                break;
                
              case 'delete':
                if (taskAction.task_text) {
                  const foundTask = await taskService.findTaskByText(userId, taskAction.task_text);
                  if (foundTask) {
                    await taskService.deleteTask(foundTask.id);
                    setTasks(prev => prev.filter(t => t.id !== foundTask.id));
                    console.log('🗑️ Task deleted (AI):', foundTask.text);
                  }
                } else if (taskAction.task_id) {
                  await taskService.deleteTask(taskAction.task_id);
                  setTasks(prev => prev.filter(t => t.id !== taskAction.task_id));
                }
                break;
                
              case 'list':
                // Task list is already in the AI's context, no action needed
                // Optionally open the task panel
                setIsTaskPanelOpen(true);
                break;
            }
          } catch (error) {
            console.error('Failed to execute task action:', error);
          }
        }

        // Check for Calendar Actions - FIRST check the structured calendar_action field
        const calendarAction = response.calendar_action;
        
        if (calendarAction && calendarAction.action) {
          console.log('📅 Calendar action detected:', calendarAction);

          try {
            if (calendarAction.action === 'delete') {
              // Determine which events to delete
              let eventIdsToDelete: string[] = [];
              
              if (calendarAction.delete_all) {
                // Delete ALL events
                console.log('🗑️ Delete ALL events requested');
                eventIdsToDelete = currentEventsContext.map(e => e.id);
              } else if (calendarAction.event_ids && calendarAction.event_ids.length > 0) {
                // Delete multiple specific events
                console.log(`🗑️ Deleting ${calendarAction.event_ids.length} events`);
                eventIdsToDelete = calendarAction.event_ids;
              } else if (calendarAction.event_id) {
                // Delete single event
                console.log(`🗑️ Deleting single event: ${calendarAction.event_id}`);
                eventIdsToDelete = [calendarAction.event_id];
              }
              
              if (eventIdsToDelete.length > 0) {
                // Delete all specified events
                let deletedCount = 0;
                for (const eventId of eventIdsToDelete) {
                  try {
                    await calendarService.deleteEvent(session.accessToken, eventId);
                    deletedCount++;
                    console.log(`✅ Deleted event: ${eventId}`);
                  } catch (deleteErr) {
                    console.error(`❌ Failed to delete event ${eventId}:`, deleteErr);
                  }
                }
                console.log(`✅ Successfully deleted ${deletedCount}/${eventIdsToDelete.length} events`);
                
                // Refresh events
                const events = await calendarService.getUpcomingEvents(session.accessToken);
                setUpcomingEvents(events);
                
                // Show confirmation
                setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
                await conversationHistoryService.appendConversationHistory(
                  userId,
                  [{ role: 'user', text: message }, { role: 'model', text: response.text_response }]
                );
                setLastSavedMessageIndex(updatedHistory.length);
                
                if (!isMuted && audioData) {
                  media.enqueueAudio(audioData);
                }

                // Non-critical: kick off sentiment *after* we queued audio
                startBackgroundSentiment(userId, intent);
                
                if (response.action_id) maybePlayResponseAction(response.action_id);
                
                // Skip the rest of calendar handling
                return;
              }
            } else if (calendarAction.action === 'create' && calendarAction.summary && calendarAction.start && calendarAction.end) {
              // Create event using structured data
              console.log(`📅 Creating event via calendar_action: ${calendarAction.summary}`);

              const eventData = {
                summary: calendarAction.summary,
                start: {
                  dateTime: calendarAction.start,
                  timeZone: calendarAction.timeZone || 'America/Chicago'
                },
                end: {
                  dateTime: calendarAction.end,
                  timeZone: calendarAction.timeZone || 'America/Chicago'
                }
              };

              await calendarService.createEvent(session.accessToken, eventData);
              console.log('✅ Event created successfully');

              // Refresh events
              const events = await calendarService.getUpcomingEvents(session.accessToken);
              setUpcomingEvents(events);

              // Show confirmation
              setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
              await conversationHistoryService.appendConversationHistory(
                userId,
                [{ role: 'user', text: message }, { role: 'model', text: response.text_response }]
              );
              setLastSavedMessageIndex(updatedHistory.length);

              if (!isMuted && audioData) {
                media.enqueueAudio(audioData);
              }

              // Non-critical: kick off sentiment *after* we queued audio
              startBackgroundSentiment(userId, intent);

              if (response.action_id) maybePlayResponseAction(response.action_id);

              // Skip the rest of calendar handling
              return;
            }
          } catch (error) {
            console.error('Failed to execute calendar_action:', error);
            setErrorMessage('Failed to execute calendar action');
          }
        }

        // Check for News Action - fetch latest tech news from Hacker News
        const newsAction = response.news_action;
        
        if (newsAction && newsAction.action === 'fetch') {
          console.log('📰 News action detected - fetching latest tech news');
          
          try {
            // Show initial acknowledgment
            setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
            
            // Play the initial acknowledgment audio
            if (!isMuted && audioData) {
              media.enqueueAudio(audioData);
            }
            
            // Fetch news from Hacker News
            const stories = await fetchTechNews();
            
            if (stories.length > 0) {
              // Build news context for AI with full URLs for sharing
              const newsItems = stories.slice(0, 3).map((story, i) => {
                const hostname = story.url ? new URL(story.url).hostname : 'Hacker News';
                return `${i + 1}. "${story.title}"
   Source: ${hostname}
   URL: ${story.url || `https://news.ycombinator.com/item?id=${story.id}`}
   Score: ${story.score} upvotes`;
              }).join('\n\n');
              
              const newsPrompt = `
[SYSTEM EVENT: NEWS_FETCHED]
Here are the latest trending AI/tech stories from Hacker News:

${newsItems}

Your goal: Share these news stories with the user in your signature style.
- Pick 1-2 that seem most interesting
- Translate tech jargon into human terms
- Be enthusiastic and conversational
- Ask if they want to hear more about any of them
- Keep it natural (2-3 sentences)

IMPORTANT: You have the URLs above. If the user asks for a link or wants to read more:
- Share the URL directly in your response
- Example: "Here's the link: [URL]"
- You can also offer to share the Hacker News discussion: https://news.ycombinator.com/item?id=[story.id]
              `.trim();
              
              // Store stories for follow-up questions
              const sharedStories = stories.slice(0, 3);
              storeLastSharedStories(sharedStories);
              
              // Send news context back to AI for a natural response
              await triggerSystemMessage(newsPrompt);
              
              // Mark stories as mentioned
              sharedStories.forEach(story => markStoryMentioned(story.id));
            } else {
              // No news found
              await triggerSystemMessage(`
[SYSTEM EVENT: NEWS_FETCHED]
I checked Hacker News but didn't find any super relevant AI/tech stories right now.
Let the user know in a friendly way and maybe offer to check back later.
              `.trim());
            }
            
            // Skip rest of response handling since triggerSystemMessage will handle it
            return;
          } catch (error) {
            console.error('Failed to fetch news:', error);
            setErrorMessage('Failed to fetch tech news');
          }
        }

        // Check for Selfie Action - generate AI companion image
        const selfieAction = response.selfie_action;
        
        if (selfieAction && selfieAction.scene) {
          console.log('📸 Selfie action detected - generating companion image');
          console.log('📸 Scene:', selfieAction.scene, 'Mood:', selfieAction.mood);
          
          try {
            // Show initial acknowledgment with text
            setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
            
            // Play the initial acknowledgment audio
            if (!isMuted && audioData) {
              media.enqueueAudio(audioData);
            }
            
            // Save initial conversation
            await conversationHistoryService.appendConversationHistory(
              userId,
              [{ role: 'user', text: message }, { role: 'model', text: response.text_response }]
            );
            setLastSavedMessageIndex(updatedHistory.length);
            
            // Generate the selfie image
            const selfieResult = await generateCompanionSelfie({
              scene: selfieAction.scene,
              mood: selfieAction.mood,
              outfitHint: selfieAction.outfit_hint,
            });
            
            if (selfieResult.success && selfieResult.imageBase64) {
              // Add a follow-up message with the generated image
              const imageMessage: ChatMessage = {
                role: 'model' as const,
                text: "Here you go! 📸✨",
                assistantImage: selfieResult.imageBase64,
                assistantImageMimeType: selfieResult.mimeType,
              };
              
              setChatHistory(prev => [...prev, imageMessage]);
              
              // Generate audio for the follow-up
              if (!isMuted) {
                const imageAudio = await generateSpeech("Here you go!");
                if (imageAudio) media.enqueueAudio(imageAudio);
              }
              
              console.log('✅ Selfie generated and added to chat!');
            } else {
              // Generation failed - let the user know
              const errorMessage = selfieResult.error || "I couldn't take that pic right now, sorry! 😅";
              setChatHistory(prev => [...prev, { role: 'model' as const, text: errorMessage }]);
              
              if (!isMuted) {
                const errorAudio = await generateSpeech(errorMessage);
                if (errorAudio) media.enqueueAudio(errorAudio);
              }
              
              console.error('❌ Selfie generation failed:', selfieResult.error);
            }
            
            // Non-critical: sentiment analysis
            startBackgroundSentiment(userId, intent);
            
            if (response.action_id) maybePlayResponseAction(response.action_id);
            
            // Skip rest of response handling
            return;
          } catch (error) {
            console.error('Failed to generate selfie:', error);
            setErrorMessage('Failed to generate image');
          }
        }

        // FALLBACK: Check for Calendar Action tags in text_response
        // We search for tags anywhere in the response, not just at the start.
        const calendarCreateIndex = response.text_response.indexOf('[CALENDAR_CREATE]');
        const calendarDeleteIndex = response.text_response.indexOf('[CALENDAR_DELETE]');

        if (calendarCreateIndex !== -1) {
          try {
            // Extract the JSON part using helper that finds matching braces
            const tagLength = '[CALENDAR_CREATE]'.length;
            const afterTag = response.text_response.substring(calendarCreateIndex + tagLength).trim();

             const jsonString = extractJsonObject(afterTag);
             
             if (!jsonString) {
               throw new Error("Could not find valid JSON after [CALENDAR_CREATE] tag");
             }

             console.log("📅 Attempting to parse Calendar CREATE JSON:", jsonString);
             
             const eventData: NewEventPayload = JSON.parse(jsonString);

             // Validation: Ensure required fields exist
             if (!eventData.summary || !eventData.start?.dateTime || !eventData.end?.dateTime) {
                 throw new Error("Missing required fields (summary, start.dateTime, end.dateTime)");
             }

             const confirmationText = `Okay, I'll add "${eventData.summary}" to your calendar.`;
             
             // Strip the tag and JSON from the displayed message
             const textBeforeTag = response.text_response.substring(0, calendarCreateIndex).trim();
             const displayText = textBeforeTag ? `${textBeforeTag}\n\n${confirmationText}` : confirmationText;

             setChatHistory(prev => [...prev, { role: 'model' as const, text: displayText }]);
             
             await conversationHistoryService.appendConversationHistory(
                userId,
                [{ role: 'user', text: message }, { role: 'model', text: displayText }]
             );
             setLastSavedMessageIndex(updatedHistory.length);

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

             // Non-critical: kick off sentiment *after* we queued audio (or after text if muted)
             startBackgroundSentiment(userId, intent);
             
              if (response.action_id) {
                 maybePlayResponseAction(response.action_id);
              }
             if (response.open_app) {
                console.log("🚀 Launching app:", response.open_app);
                window.location.href = response.open_app;
             }

           } catch (e) {
             console.error("Failed to create calendar event", e);
             setErrorMessage("Failed to create calendar event.");
             
             // Fallback: Show the original text but mention the error
             const textBeforeTag = response.text_response.substring(0, calendarCreateIndex).trim();
             const errorText = "I tried to create that event, but I got confused by the details. Could you try again?";
             const displayText = textBeforeTag ? `${textBeforeTag}\n\n(System: ${errorText})` : errorText;

            setChatHistory(prev => [...prev, { role: 'model' as const, text: displayText }]);
            await conversationHistoryService.appendConversationHistory(
              userId,
              [{ role: 'user', text: message }, { role: 'model', text: displayText }]
            );
          }
        } else if (calendarDeleteIndex !== -1) {
          // Handle CALENDAR_DELETE
          try {
            const tagLength = '[CALENDAR_DELETE]'.length;
            const afterTag = response.text_response.substring(calendarDeleteIndex + tagLength).trim();

            // Use helper to extract just the first JSON object (finds matching braces)
            const jsonString = extractJsonObject(afterTag);

            if (!jsonString) {
              throw new Error("Could not find valid JSON after [CALENDAR_DELETE] tag");
            }

            console.log("🗑️ Attempting to parse Calendar DELETE JSON:", jsonString);

            const deleteData: { id?: string; summary?: string } = JSON.parse(jsonString);

            // Find the event to delete
            let eventToDelete: CalendarEvent | undefined;

            if (deleteData.id) {
              // Preferred: Delete by ID
              eventToDelete = upcomingEvents.find(e => e.id === deleteData.id);
              if (!eventToDelete) {
                console.warn(`Event with ID "${deleteData.id}" not found in current events, attempting API call anyway`);
              }
            } else if (deleteData.summary) {
              // Fallback: Delete by summary (case-insensitive match)
              const searchSummary = deleteData.summary.toLowerCase();
              eventToDelete = upcomingEvents.find(e =>
                e.summary.toLowerCase() === searchSummary ||
                e.summary.toLowerCase().includes(searchSummary) ||
                searchSummary.includes(e.summary.toLowerCase())
              );
            }

            if (!eventToDelete && !deleteData.id) {
              throw new Error(`Could not find event matching: ${deleteData.summary || deleteData.id}`);
            }

            const eventIdToDelete = deleteData.id || eventToDelete?.id;
            const eventName = deleteData.summary || eventToDelete?.summary || 'the event';

            if (!eventIdToDelete) {
              throw new Error("No event ID available for deletion");
            }

            const confirmationText = `Done! I've removed "${eventName}" from your calendar.`;

            // Strip the tag and JSON from the displayed message
            const textBeforeTag = response.text_response.substring(0, calendarDeleteIndex).trim();
            const displayText = textBeforeTag ? `${textBeforeTag}\n\n${confirmationText}` : confirmationText;

            // Delete the event
            console.log("�️ Deleting event:", eventIdToDelete);
            await calendarService.deleteEvent(session.accessToken, eventIdToDelete);

            setChatHistory(prev => [...prev, { role: 'model' as const, text: displayText }]);

            await conversationHistoryService.appendConversationHistory(
              userId,
              [{ role: 'user', text: message }, { role: 'model', text: displayText }]
            );
            setLastSavedMessageIndex(updatedHistory.length);

            // Refresh Events
            const events = await calendarService.getUpcomingEvents(session.accessToken);
            setUpcomingEvents(events);

            // Generate Speech for confirmation
            if (!isMuted) {
              const confirmationAudio = await generateSpeech(displayText);
              if (confirmationAudio) media.enqueueAudio(confirmationAudio);
            }

            // Non-critical: kick off sentiment *after* we queued audio (or after text if muted)
            startBackgroundSentiment(userId, intent);

            if (response.action_id) {
              maybePlayResponseAction(response.action_id);
            }
            if (response.open_app) {
              console.log("🚀 Launching app:", response.open_app);
              window.location.href = response.open_app;
            }

          } catch (e) {
            console.error("Failed to delete calendar event", e);
            setErrorMessage("Failed to delete calendar event.");

            // Fallback: Show the original text but mention the error
            const textBeforeTag = response.text_response.substring(0, calendarDeleteIndex).trim();
            const errorText = "I tried to delete that event, but couldn't find it. Can you check the event name?";
            const displayText = textBeforeTag ? `${textBeforeTag}\n\n(System: ${errorText})` : errorText;

             setChatHistory(prev => [...prev, { role: 'model' as const, text: displayText }]);
             await conversationHistoryService.appendConversationHistory(
                userId,
                [{ role: 'user', text: message }, { role: 'model', text: displayText }]
             );
           }
        } else {
          // 3. Handle Response (no calendar actions)
            setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
            
            await conversationHistoryService.appendConversationHistory(
                userId,
                [{ role: 'user', text: message }, { role: 'model', text: response.text_response }]
            );
            setLastSavedMessageIndex(updatedHistory.length);

            // Only use original audio if we're not regenerating (i.e., text wasn't JSON)
            if (!isMuted && audioData && !shouldRegenerateAudio) {
                media.enqueueAudio(audioData);
            }

            // Non-critical: kick off sentiment *after* we queued audio (or after text if muted)
          startBackgroundSentiment(userId, intent);

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

  // Morning Briefing Effect
  useEffect(() => {
    // 1. Safety Checks
    if (!selectedCharacter || !session) return;

    // 2. Check if we already did this today
    const today = new Date().toDateString(); // e.g., "Mon Nov 18 2025"
    const lastBriefingDate = localStorage.getItem(`last_briefing_${selectedCharacter.id}`);

    if (lastBriefingDate === today) {
      console.log("☕ Already briefed today.");
      return;
    }

    // Reset interaction flag on new session/character load
    // This ensures a fresh start for the briefing timer
    hasInteractedRef.current = false;

    // 3. Start the Timer
    const timer = setTimeout(async () => {
      // 🛑 STOP if user has already typed/clicked
      if (hasInteractedRef.current) {
        console.log("User busy, skipping briefing.");
        return;
      }

      console.log("🌅 Triggering Daily Catch-up...");

      // 4. Construct the Prompt with DYNAMIC time-of-day
      const now = new Date();
      const hour = now.getHours();
      const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
      const timeString = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

      let eventSummary = "Calendar not connected.";
      let emailSummary = "Gmail not connected.";

      if (isGmailConnected) {
        eventSummary = upcomingEvents.length > 0
          ? `User has ${upcomingEvents.length} events today. First one: ${upcomingEvents[0].summary} at ${upcomingEvents[0].start.dateTime}`
          : "No events scheduled.";

        emailSummary = emailQueue.length > 0
          ? `User has ${emailQueue.length} unread emails.`
          : "No new emails.";
      }

      // Task summary - load current tasks at briefing time
      const userId = getUserId();
      const currentTasks = await taskService.fetchTasks(userId);
      const incompleteTasks = currentTasks.filter(t => !t.completed);
      const taskSummary = incompleteTasks.length > 0
        ? `User has ${incompleteTasks.length} task(s) pending: ${incompleteTasks.slice(0, 3).map(t => t.text).join(', ')}`
        : "User's checklist is clear.";

      // Fetch open loop for personal continuity (e.g., "Houston trip")
      const topLoop = await getTopLoopToSurface(userId);
      const openLoopContext = topLoop
        ? `You've been wondering about: "${topLoop.topic}". Ask: "${topLoop.suggestedFollowup || `How did ${topLoop.topic} go?`}"`
        : "";

      const prompt = `
        [SYSTEM EVENT: FIRST LOGIN CATCH-UP]
        Context: It is the first time the user has logged in today. Current time: ${timeString} (${timeOfDay}).

        ${openLoopContext ? `PAST CONTINUITY (Top Priority):\n${openLoopContext}\n` : ""}
        DAILY LOGISTICS (Secondary Priority):
        - ${eventSummary}
        - ${emailSummary}
        - ${taskSummary}

        TASK:
        1. Greet them warmly for the ${timeOfDay}. Use time-appropriate language (NOT "Good morning" if it's ${timeOfDay}!).
        ${openLoopContext ? `2. Lead with the personal follow-up - it shows you were thinking of them.
        3. Naturally bridge to their schedule/tasks if relevant.` : `2. Briefly mention their schedule/tasks if any exist.`}

        Keep it short (2-3 sentences). Be natural, not robotic.
      `;

      // 5. Fire it off
      triggerSystemMessage(prompt);

      // 6. Save state so we don't annoy them again today
      localStorage.setItem(`last_briefing_${selectedCharacter.id}`, today);

    }, 5000); // 5 second delay

    // Cleanup on unmount
    return () => clearTimeout(timer);

  }, [selectedCharacter, session, isGmailConnected, upcomingEvents, emailQueue, triggerSystemMessage]);
  
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

  // Whiteboard AI Interaction Handler
  const handleWhiteboardCapture = async (
    base64: string,
    userMessage: string,
    modeContext: string
  ): Promise<{ textResponse: string; whiteboardAction?: WhiteboardAction | null }> => {
    if (!selectedCharacter || !session) {
      return { textResponse: "Please select a character first." };
    }

    const WB_DEBUG =
      typeof window !== 'undefined' &&
      window.localStorage?.getItem('debug:whiteboard') === '1';
    const wbNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const wbLog = (...args: any[]) => {
      if (WB_DEBUG) console.log(...args);
    };
    const wbT0 = wbNow();
    wbLog('⏱️ [App/Whiteboard] handleWhiteboardCapture start', {
      bytes: base64?.length ?? 0,
      msgLen: userMessage?.length ?? 0,
      hasSelectedCharacter: !!selectedCharacter,
    });

    const userId = getUserId();
    const sessionToUse: AIChatSession = aiSession || { userId, characterId: selectedCharacter.id };

    try {
      // ============================================
      // PRE-FETCH USER INFO (Because AI doesn't always call tools reliably)
      // ============================================
      let userInfoContext = '';
      try {
        const tFacts0 = wbNow();
        const { getUserFacts } = await import('./services/memoryService');
        const userFacts = await getUserFacts(userId, 'all');
        wbLog('⏱️ [App/Whiteboard] user_facts done', {
          dtMs: Math.round(wbNow() - tFacts0),
          count: Array.isArray(userFacts) ? userFacts.length : 'n/a',
        });
        if (userFacts.length > 0) {
          const { formatFactValueForDisplay } = await import('./services/memoryService');
          const factsFormatted = userFacts.map(f => `- ${f.fact_key}: ${formatFactValueForDisplay(f.fact_value)}`).join('\n');
          userInfoContext = `\n\n[KNOWN USER INFO - USE THIS!]\nYou already know these facts about the user:\n${factsFormatted}\n\nIf they ask you to draw "my name" and you have their name above, USE IT! Don't ask again!\n`;
          console.log('🧠 [Whiteboard] Pre-loaded user facts:', userFacts.map(f => `${f.fact_key}=${formatFactValueForDisplay(f.fact_value)}`));
        }
      } catch (err) {
        console.warn('Could not pre-fetch user info:', err);
      }

      const enrichedContext = modeContext + userInfoContext;

      const tGem0 = wbNow();
      const { response, session: updatedSession } = await activeService.generateResponse(
        {
          type: 'image_text',
          text: enrichedContext, // Contains the full whiteboard context + user info
          imageData: base64,
          mimeType: 'image/png'
        },
        {
          character: selectedCharacter,
          chatHistory: [], // Fresh context for games
          relationship,
          characterContext: `Playing a game on the whiteboard.\n\n${GAMES_PROFILE}`,
          audioMode: 'async',
          onAudioData: (audioData: string) => {
            // Don't block drawing/action on TTS.
            // Respect mute at callback time.
            try {
              wbLog('⏱️ [App/Whiteboard] async audio ready', { dtMs: Math.round(wbNow() - wbT0), hasAudio: !!audioData });
            } catch {}
            if (!audioData) return;
            if (!isMutedRef.current) {
              media.enqueueAudio(audioData);
            } else {
              wbLog('⏱️ [App/Whiteboard] async audio dropped (muted)');
            }
          },
        },
        sessionToUse
      );
      wbLog('⏱️ [App/Whiteboard] generateResponse done', {
        dtMs: Math.round(wbNow() - tGem0),
        hasAudio: false,
        hasActionId: !!response?.action_id,
      });

      setAiSession(updatedSession);

      // Play action if specified
      if (response.action_id) {
        playAction(response.action_id);
      }

      const tParse0 = wbNow();
      const whiteboardAction = parseWhiteboardAction(response);
      wbLog('⏱️ [App/Whiteboard] parseWhiteboardAction done', {
        dtMs: Math.round(wbNow() - tParse0),
        hasAction: !!whiteboardAction,
        type: (whiteboardAction as any)?.type,
      });

      // NOTE: User fact detection is handled by LLM intent service in main chat flow
      // Whiteboard mode (games/drawing) typically doesn't involve personal fact sharing

      return {
        textResponse: response.text_response,
        whiteboardAction,
      };
    } catch (error) {
      console.error('Whiteboard AI error:', error);
      return { textResponse: "Hmm, I had trouble seeing your drawing. Try again?" };
    } finally {
      wbLog('⏱️ [App/Whiteboard] handleWhiteboardCapture end', { dtTotalMs: Math.round(wbNow() - wbT0) });
    }
  };

  // Show login if not authenticated
  if (!session || authStatus !== 'connected') {
    return <LoginPage />;
  }

  return (
    <div className="bg-gray-900 text-gray-100 h-screen overflow-hidden flex flex-col p-4 md:p-8">
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
  );
};

export default App;
