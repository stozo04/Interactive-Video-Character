import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChatMessage,
  UploadedImage,
  CharacterProfile,
  CharacterAction,
  Task,
} from './types';
import * as dbService from './services/cacheService';
import { supabase } from './services/supabaseClient';
import type { AIActionResponse } from './services/aiSchema';
import * as conversationHistoryService from './services/conversationHistoryService';
import * as relationshipService from './services/relationshipService';
import type { RelationshipMetrics } from './services/relationshipService';
import { gmailService, type NewEmailPayload } from './services/gmailService';
import { 
  calendarService, 
  type CalendarEvent,
  type NewEventPayload 
} from './services/calendarService';
import { generateSpeech } from './services/elevenLabsService'; // Import generateSpeech

import { predictActionFromMessage } from './utils/intentUtils';
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
import { useGoogleAuth } from './contexts/GoogleAuthContext';
import { useDebounce } from './hooks/useDebounce';
import { useMediaQueues } from './hooks/useMediaQueues';
import { useAIService } from './contexts/AIServiceContext';
import { AIChatSession, UserContent } from './services/aiService';
import * as taskService from './services/taskService';

// Helper to sanitize text for comparison
const sanitizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

type View = 'loading' | 'selectCharacter' | 'createCharacter' | 'chat' | 'manageCharacter';

interface DisplayCharacter {
  profile: CharacterProfile;
  imageUrl: string;
  videoUrl: string;
}

const App: React.FC = () => {
  const { session, status: authStatus } = useGoogleAuth();
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
  const [aiSession, setAiSession] = useState<AIChatSession | null>(null);
  const [lastSavedMessageIndex, setLastSavedMessageIndex] = useState<number>(-1);
  const [relationship, setRelationship] = useState<RelationshipMetrics | null>(null);
  const [isVideoVisible, setIsVideoVisible] = useState(true);
  const [isLoadingCharacter, setIsLoadingCharacter] = useState(false);
  
  // Task Management State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);
  
  // Snooze State for Idle Check-ins
  const [isSnoozed, setIsSnoozed] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);

  // Gmail Integration State
  const [isGmailConnected, setIsGmailConnected] = useState(false);
  const [emailQueue, setEmailQueue] = useState<NewEmailPayload[]>([]);
  const debouncedEmailQueue = useDebounce(emailQueue, 5000); 

  // Calendar Integration State
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [kayleyContext, setKayleyContext] = useState<string>("");
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

  const triggerIdleBreaker = useCallback(() => {
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
    
    const now = Date.now();
    setLastInteractionAt(now); // reset timer to avoid back-to-back firings
    lastIdleBreakerAtRef.current = now;

    console.log("User is idle. Triggering idle breaker...");

    const relationshipContext = relationship?.relationshipTier
      ? `Relationship tier with user: ${relationship.relationshipTier}.`
      : "Relationship tier with user is unknown.";

    // Check for high-priority tasks
    const highPriorityTasks = tasks.filter(t => !t.completed && t.priority === 'high');
    const taskContext = highPriorityTasks.length > 0
      ? `User has ${highPriorityTasks.length} high-priority task(s): ${highPriorityTasks[0].text}. Consider gently mentioning it if appropriate.`
      : "No urgent tasks pending.";

    const prompt = `
    [SYSTEM EVENT: USER_IDLE]
    The user has been silent for over 5 minutes. 
    ${relationshipContext}
    ${taskContext}
    Your goal: Gently check in. 
    - If relationship is 'close_friend', maybe send a random thought or joke.
    - If 'acquaintance', politely ask if they are still there.
    - If there are high-priority tasks and relationship allows, you MAY gently mention them (but don't be pushy).
    - Keep it very short (1 sentence).
    - Do NOT repeat yourself if you did this recently.
  `;

    triggerSystemMessage(prompt);
  }, [relationship?.relationshipTier, tasks, triggerSystemMessage, isSnoozed, snoozeUntil]);

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
    if (!isGmailConnected || !session) return;

    const pollCalendar = async () => {
        try {
            const events = await calendarService.getUpcomingEvents(session.accessToken);
            setUpcomingEvents(events); 
        } catch(e) { console.error(e); }
    };

    const initialDelayTimer = setTimeout(pollCalendar, 3000);
    const intervalId = setInterval(pollCalendar, 300000);

    return () => {
        clearTimeout(initialDelayTimer);
        clearInterval(intervalId);
    };
  }, [isGmailConnected, session]);


  useEffect(() => {
    const handleNewMail = (event: Event) => {
      const customEvent = event as CustomEvent<NewEmailPayload[]>;
      setEmailQueue(prev => [...prev, ...customEvent.detail]);
    };

    const handleAuthError = () => {
      setIsGmailConnected(false);
      localStorage.removeItem('gmail_history_id');
      setErrorMessage('Google session expired. Please reconnect.');
    };

    gmailService.addEventListener('new-mail', handleNewMail);
    gmailService.addEventListener('auth-error', handleAuthError);

    return () => {
      gmailService.removeEventListener('new-mail', handleNewMail);
      gmailService.removeEventListener('auth-error', handleAuthError);
    };
  }, []); 

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
    
    // Cleanup old action URLs (idle videos are now public URLs - no cleanup needed!)
    cleanupActionUrls(actionVideoUrls);

    // Create action URLs (still using Blobs for now for backward compatibility)
    const newActionUrls = character.actions.reduce((map, action) => {
      map[action.id] = URL.createObjectURL(action.video);
      return map;
    }, {} as Record<string, string>);

    setActionVideoUrls(newActionUrls);
    setSelectedCharacter(character);
    
    // Load tasks and perform daily rollover check
    const loadedTasks = taskService.loadTasks();
    setTasks(loadedTasks);
    console.log(`📋 Loaded ${loadedTasks.length} task(s)`);
    
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
      const savedHistory = await conversationHistoryService.loadConversationHistory(userId);
      const relationshipData = await relationshipService.getRelationship(userId);
      setRelationship(relationshipData);
      
      try {
        const session: AIChatSession = { userId, model: activeService.model }; 
        const { greeting, session: updatedSession } = await activeService.generateGreeting(
            character, session, savedHistory, relationshipData, kayleyContext
        );
        setAiSession(updatedSession);

        const initialHistory = savedHistory.length > 0
            ? [...savedHistory, { role: 'model' as const, text: greeting.text_response }]
            : [{ role: 'model' as const, text: greeting.text_response }];
        setChatHistory(initialHistory);

        if (greeting.action_id && newActionUrls[greeting.action_id]) {
            setTimeout(() => {
                playAction(greeting.action_id!);
            }, 100);
        }
        setLastSavedMessageIndex(savedHistory.length - 1);

      } catch (error) {
        console.error('Error generating greeting:', error);
        setChatHistory(savedHistory);
      }
      setView('chat');
    } catch (error) {
      setErrorMessage('Failed to load character data.');
    } finally {
      setIsLoadingCharacter(false);
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
  const handleTaskCreate = useCallback((text: string, priority?: 'low' | 'medium' | 'high') => {
    taskService.createTask(text, priority);
    setTasks(taskService.loadTasks()); // Reload from service for consistency
    
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
  }, [selectedCharacter, isMuted, media]);

  const handleTaskToggle = useCallback((taskId: string) => {
    const updatedTask = taskService.toggleTask(taskId);
    if (updatedTask) {
      setTasks(taskService.loadTasks());
      
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
  }, [selectedCharacter, isMuted, media]);

  const handleTaskDelete = useCallback((taskId: string) => {
    taskService.deleteTask(taskId);
    setTasks(taskService.loadTasks());
  }, []);

  // Snooze Handlers
  const handleSnooze = useCallback((minutes: number | 'indefinite') => {
    if (minutes === 'indefinite') {
      setIsSnoozed(true);
      setSnoozeUntil(null);
      localStorage.setItem('kayley_snooze_indefinite', 'true');
      console.log('⏸️ Check-ins snoozed indefinitely');
    } else {
      const snoozeEnd = Date.now() + (minutes * 60 * 1000);
      setIsSnoozed(true);
      setSnoozeUntil(snoozeEnd);
      localStorage.setItem('kayley_snooze_until', snoozeEnd.toString());
      localStorage.removeItem('kayley_snooze_indefinite');
      console.log(`⏸️ Check-ins snoozed for ${minutes} minutes`);
    }
    setShowSnoozeMenu(false);
  }, []);

  const handleUnsnooze = useCallback(() => {
    setIsSnoozed(false);
    setSnoozeUntil(null);
    localStorage.removeItem('kayley_snooze_until');
    localStorage.removeItem('kayley_snooze_indefinite');
    console.log('▶️ Check-ins resumed');
    setShowSnoozeMenu(false);
  }, []);

  const handleSendMessage = async (message: string) => {
    if (!selectedCharacter || !session) return;
    registerInteraction();
    setErrorMessage(null);
    
    const updatedHistory = [...chatHistory, { role: 'user' as const, text: message }];
    setChatHistory(updatedHistory);
    setIsProcessingAction(true);

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
      const sessionToUse: AIChatSession = aiSession || { userId, characterId: selectedCharacter.id };
      const context = {
          character: selectedCharacter,
          chatHistory: chatHistory, 
          relationship: relationship, 
          upcomingEvents: upcomingEvents,
          characterContext: kayleyContext,
          tasks: tasks,
      };

      // 1. Start sentiment analysis in background (don't await)
      const sentimentPromise = relationshipService.analyzeMessageSentiment(message, chatHistory, activeServiceId)
        .then(event => relationshipService.updateRelationship(userId, event))
        .catch(error => {
          console.error('Background sentiment analysis failed:', error);
          return null;
        });
        
      // 2. Start AI response immediately (main critical path)
      try {
        const { response, session: updatedSession, audioData } = await activeService.generateResponse(
          { type: 'text', text: message }, 
          context,
          sessionToUse
        );

        setAiSession(updatedSession);
        
        // Debug: Log full response to check structure
        console.log('🔍 Full AI response:', JSON.stringify(response, null, 2));
        
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
          
          try {
            switch (taskAction.action) {
              case 'create':
                if (taskAction.task_text) {
                  const newTask = taskService.createTask(
                    taskAction.task_text, 
                    taskAction.priority as 'low' | 'medium' | 'high' | undefined
                  );
                  setTasks(taskService.loadTasks());
                  console.log('✅ Task created:', newTask.text);
                }
                break;
                
              case 'complete':
                if (taskAction.task_text) {
                  const foundTask = taskService.findTaskByText(taskAction.task_text);
                  if (foundTask) {
                    taskService.toggleTask(foundTask.id);
                    setTasks(taskService.loadTasks());
                    console.log('✅ Task completed:', foundTask.text);
                  }
                } else if (taskAction.task_id) {
                  taskService.toggleTask(taskAction.task_id);
                  setTasks(taskService.loadTasks());
                }
                break;
                
              case 'delete':
                if (taskAction.task_text) {
                  const foundTask = taskService.findTaskByText(taskAction.task_text);
                  if (foundTask) {
                    taskService.deleteTask(foundTask.id);
                    setTasks(taskService.loadTasks());
                    console.log('🗑️ Task deleted:', foundTask.text);
                  }
                } else if (taskAction.task_id) {
                  taskService.deleteTask(taskAction.task_id);
                  setTasks(taskService.loadTasks());
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

        // Check for Calendar Action
        // We search for the tag anywhere in the response, not just at the start.
        const calendarTagIndex = response.text_response.indexOf('[CALENDAR_CREATE]');
        
        if (calendarTagIndex !== -1) {
           try {
             // Extract the JSON part.
             // We assume the JSON starts immediately after the tag and ends at the end of the line or the matching brace.
             // For robustness, we'll take the substring from the end of the tag.
             const tagLength = '[CALENDAR_CREATE]'.length;
             let jsonString = response.text_response.substring(calendarTagIndex + tagLength).trim();
             
             // If there's extra text after the JSON, we might need to be smarter. 
             // But usually the AI puts it at the end or as a block. 
             // Let's try to find the last matching brace if standard parse fails, 
             // or just trust the AI to follow "JSON format" which implies it ends correctly.
             
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
             // If the AI wrote a nice message before the tag, keep it.
             const textBeforeTag = response.text_response.substring(0, calendarTagIndex).trim();
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
             const textBeforeTag = response.text_response.substring(0, calendarTagIndex).trim();
             const errorText = "I tried to create that event, but I got confused by the details. Could you try again?";
             const displayText = textBeforeTag ? `${textBeforeTag}\n\n(System: ${errorText})` : errorText;

             setChatHistory(prev => [...prev, { role: 'model' as const, text: displayText }]);
             await conversationHistoryService.appendConversationHistory(
                userId,
                [{ role: 'user', text: message }, { role: 'model', text: displayText }]
             );
           }
        } else {
            // 3. Handle Response (Critical)
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

      // 4. Handle Sentiment (Non-critical) - Update state when done
      sentimentPromise.then(updatedRelationship => {
         if (updatedRelationship) setRelationship(updatedRelationship);
      });


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
    const timer = setTimeout(() => {
      // 🛑 STOP if user has already typed/clicked
      if (hasInteractedRef.current) {
        console.log("User busy, skipping briefing.");
        return;
      }

      console.log("🌅 Triggering Morning Briefing...");

      // 4. Construct the Prompt
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
      const currentTasks = taskService.loadTasks();
      const incompleteTasks = currentTasks.filter(t => !t.completed);
      const taskSummary = incompleteTasks.length > 0
        ? `User has ${incompleteTasks.length} task(s) from yesterday that need attention: ${incompleteTasks.slice(0, 3).map(t => t.text).join(', ')}`
        : "User's checklist is clear.";

      const prompt = `
        [SYSTEM EVENT: MORNING BRIEFING]
        It is the first login of the day. 
        Context: ${eventSummary}. ${emailSummary}. ${taskSummary}.
        Task: Greet the user warmly. Briefly summarize their schedule/emails/tasks if any exist. 
        If they have tasks from yesterday, gently mention them. 
        Optionally suggest they add tasks related to their calendar events.
        Keep it short (2-3 sentences).
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
          
          {/* Snooze Button - Only visible in chat view */}
          {view === 'chat' && selectedCharacter && (
            <div className="relative">
              <button
                onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
                className={`rounded-full p-3 shadow-lg transition-all hover:scale-110 relative ${
                  isSnoozed 
                    ? 'bg-gradient-to-br from-orange-500 to-red-600 text-white' 
                    : 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white'
                }`}
                title={isSnoozed ? 'Check-ins snoozed' : 'Snooze check-ins'}
              >
                {isSnoozed ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                )}
                {isSnoozed && (
                  <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    ⏸
                  </span>
                )}
              </button>
              
              {/* Snooze Menu Dropdown */}
              {showSnoozeMenu && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowSnoozeMenu(false)}
                  />
                  <div className="absolute top-full right-0 mt-2 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
                    {isSnoozed ? (
                      <>
                        <div className="px-4 py-3 border-b border-gray-700">
                          <p className="text-sm font-semibold text-orange-400">Check-ins Paused</p>
                          {snoozeUntil ? (
                            <p className="text-xs text-gray-400 mt-1">
                              Until {new Date(snoozeUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          ) : (
                            <p className="text-xs text-gray-400 mt-1">Indefinitely</p>
                          )}
                        </div>
                        <button
                          onClick={handleUnsnooze}
                          className="w-full px-4 py-3 text-left text-sm hover:bg-gray-700 transition-colors text-green-400 font-medium"
                        >
                          ▶️ Resume Check-ins
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="px-4 py-3 border-b border-gray-700">
                          <p className="text-sm font-semibold text-gray-200">Snooze Check-ins</p>
                          <p className="text-xs text-gray-400 mt-1">Pause idle notifications</p>
                        </div>
                        <button
                          onClick={() => handleSnooze(15)}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 transition-colors"
                        >
                          15 minutes
                        </button>
                        <button
                          onClick={() => handleSnooze(30)}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 transition-colors"
                        >
                          30 minutes
                        </button>
                        <button
                          onClick={() => handleSnooze(60)}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 transition-colors"
                        >
                          1 hour
                        </button>
                        <button
                          onClick={() => handleSnooze(120)}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 transition-colors"
                        >
                          2 hours
                        </button>
                        <button
                          onClick={() => handleSnooze('indefinite')}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 transition-colors border-t border-gray-700 text-gray-400"
                        >
                          Until I resume...
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          
          <SettingsPanel onGmailConnectionChange={setIsGmailConnected} />
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
                    isSending={isProcessingAction}
                    onUserActivity={markInteraction}
                  />
                </div>
             </div>
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
