
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChatMessage,
  UploadedImage,
  CharacterProfile,
  CharacterAction,
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

import ImageUploader from './components/ImageUploader';
import VideoPlayer from './components/VideoPlayer';
import AudioPlayer from './components/AudioPlayer';
import ChatPanel from './components/ChatPanel';
import CharacterSelector from './components/CharacterSelector';
import LoadingSpinner from './components/LoadingSpinner';
import ActionManagementView from './components/ActionManagementView';
import { SettingsPanel } from './components/SettingsPanel';
import { LoginPage } from './components/LoginPage';
import { useGoogleAuth } from './contexts/GoogleAuthContext';
import { useDebounce } from './hooks/useDebounce';
import { useAIService } from './contexts/AIServiceContext';
import { AIChatSession, UserContent } from './services/aiService';

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

type View = 'loading' | 'selectCharacter' | 'createCharacter' | 'chat' | 'manageActions';

// A type for characters that includes their profile and the temporary URLs for display
interface DisplayCharacter {
  profile: CharacterProfile;
  imageUrl: string;
  videoUrl: string;
}

// Removed getCharacterRelationshipAnchor - no longer needed since we use userId only

const App: React.FC = () => {
  const { session, status: authStatus } = useGoogleAuth();
  const { activeService, activeServiceId } = useAIService();
  const [view, setView] = useState<View>('loading');
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterProfile | null>(null);
  const [idleVideoUrl, setIdleVideoUrl] = useState<string | null>(null);
  const [actionVideoUrls, setActionVideoUrls] = useState<Record<string, string>>(
    {}
  );
  // NEW STATE: Source for AI Voice Audio
  const [responseAudioSrc, setResponseAudioSrc] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null);
  const [currentActionId, setCurrentActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [isSavingCharacter, setIsSavingCharacter] = useState(false);
  const [isCreatingAction, setIsCreatingAction] = useState(false);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);
  const [deletingActionId, setDeletingActionId] = useState<string | null>(null);
  const [characterForActionManagement, setCharacterForActionManagement] = useState<CharacterProfile | null>(null);
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now());
  const [isMuted, setIsMuted] = useState(false);
  const [aiSession, setAiSession] = useState<AIChatSession | null>(null);
  const [lastSavedMessageIndex, setLastSavedMessageIndex] = useState<number>(-1);
  const [relationship, setRelationship] = useState<RelationshipMetrics | null>(null);
  const [isVideoVisible, setIsVideoVisible] = useState(true);
  const [isLoadingCharacter, setIsLoadingCharacter] = useState(false);

  // Gmail Integration State
  const [isGmailConnected, setIsGmailConnected] = useState(false);
  const [emailQueue, setEmailQueue] = useState<NewEmailPayload[]>([]);
  const debouncedEmailQueue = useDebounce(emailQueue, 5000); // 5 second debounce

  // Calendar Integration State
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [notifiedEventIds, setNotifiedEventIds] = useState<Set<string>>(new Set());
  const idleActionTimerRef = useRef<number | null>(null);

  // --- NEW: Handle Audio Input ---
  const handleSendAudio = async (audioBlob: Blob) => {
      if (!selectedCharacter || !session) return;
      registerInteraction();
      setErrorMessage(null);

      // 1. Add placeholder
      const updatedHistory = [...chatHistory, { role: 'user' as const, text: "🎤 [Audio Message]" }];
      setChatHistory(updatedHistory);
      setIsProcessingAction(true);

      try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
              const base64data = reader.result as string;
              const base64Content = base64data.split(',')[1];
              const mimeType = audioBlob.type || 'audio/webm';

              const userId = getUserId();
              const sessionToUse: AIChatSession = aiSession || { userId, characterId: selectedCharacter.id };

              const input: UserContent = { 
                  type: 'audio', 
                  data: base64Content, 
                  mimeType: mimeType 
              };

              // 2. Call AI Service
              const { response, session: updatedSession, audioData } = await activeService.generateResponse(
                  input,
                  {
                      character: selectedCharacter,
                      chatHistory: chatHistory, // Pass OLD history
                      relationship: relationship, 
                      upcomingEvents: upcomingEvents,
                  },
                  sessionToUse
              );

              setAiSession(updatedSession);
              
              const textResponse = response.text_response;
              const actionIdToPlay = response.action_id;
              const userTranscription = response.user_transcription;

              // 3. Update Placeholder
              setChatHistory(currentHistory => {
                  const newHistory = [...currentHistory];
                  const lastMsgIndex = newHistory.length - 1;
                  if (lastMsgIndex >= 0 && newHistory[lastMsgIndex].text === "🎤 [Audio Message]") {
                      newHistory[lastMsgIndex] = { 
                          role: 'user', 
                          text: userTranscription ? `🎤 ${userTranscription}` : "🎤 [Audio Sent]" 
                      };
                  }
                  return [...newHistory, { role: 'model' as const, text: textResponse }];
              });

              // 4. Play Audio Response
              if (!isMuted) {
                if (audioData) {
                    setResponseAudioSrc(audioData);
                }
              }

              // 5. Play Action
              if (actionIdToPlay) {
                 const actionUrl = actionVideoUrls[actionIdToPlay];
                 if (actionUrl) {
                     setCurrentVideoUrl(actionUrl);
                     setCurrentActionId(actionIdToPlay);
                 }
              }
              
              setIsProcessingAction(false);
          };
      } catch (error) {
          console.error("Audio Error:", error);
          setErrorMessage("Failed to process audio.");
          setIsProcessingAction(false);
      }
  };

  const reportError = useCallback((message: string, error?: unknown) => {
    console.error(message, error);
    setErrorMessage(message);
  }, []);

  const registerInteraction = useCallback(() => {
    setLastInteractionAt(Date.now());
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
    const startTime = performance.now(); // Performance tracking
    try {
      const savedCharacters = await dbService.getCharacters();
      const loadTime = performance.now() - startTime;
      console.log(`✅ Loaded ${savedCharacters.length} character(s) in ${loadTime.toFixed(0)}ms`);
      
      if (savedCharacters.length === 0) {
        console.warn('No characters loaded. This could mean: 1) No characters in database, 2) All characters have missing video files, 3) Storage access issues.');
      }
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
    try {
      return characters.map(profile => ({
        profile,
        // Use base64 data URL for the image to avoid issues with File object serialization from IndexedDB.
        imageUrl: `data:${profile.image.mimeType};base64,${profile.image.base64}`,
        videoUrl: URL.createObjectURL(profile.idleVideo)
      }));
    } catch (e) {
      console.error("Error creating object URLs for character list:", e);
      setErrorMessage("Failed to load character data. Some characters may be corrupted.");
      return [];
    }
  }, [characters]);

  useEffect(() => {
    // Cleanup object URLs when component unmounts or characters change.
    return () => {
      displayCharacters.forEach(c => {
        // Only videoUrl needs to be revoked, as imageUrl is now a data URL.
        URL.revokeObjectURL(c.videoUrl);
      });
    };
  }, [displayCharacters]);

  const managedActions = useMemo(() => {
    const character = characterForActionManagement || selectedCharacter;
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
        hasAudio: action.hasAudio ?? false,
      };
    });
  }, [characterForActionManagement, selectedCharacter, actionVideoUrls]);

  const triggerIdleAction = useCallback(() => {
    if (!selectedCharacter) return;
    if (selectedCharacter.actions.length === 0) return;
    if (!idleVideoUrl) return;
    if (currentVideoUrl && currentVideoUrl !== idleVideoUrl) return;

    // Exclude greeting actions from idle random actions
    const nonGreetingActions = getNonGreetingActions(selectedCharacter.actions);
    if (nonGreetingActions.length === 0) return;

    const action: CharacterAction = randomFromArray(nonGreetingActions);

    let actionUrl = actionVideoUrls[action.id] ?? null;
    if (!actionUrl && action.videoPath) {
      const { data } = supabase.storage
        .from(ACTION_VIDEO_BUCKET)
        .getPublicUrl(action.videoPath);
      actionUrl = data?.publicUrl ?? null;
    }

    if (!actionUrl) {
      return;
    }

    setCurrentVideoUrl(actionUrl);
    setCurrentActionId(action.id);
    setLastInteractionAt(Date.now());
  }, [
    selectedCharacter,
    idleVideoUrl,
    currentVideoUrl,
    actionVideoUrls,
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
    if (!idleVideoUrl) return;
    if (!currentVideoUrl) return;
    if (currentVideoUrl !== idleVideoUrl) return;
    if (isProcessingAction) return;

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
    idleVideoUrl,
    currentVideoUrl,
    isProcessingAction,
    triggerIdleAction,
  ]);

  useEffect(() => {
    scheduleIdleAction();
    return () => {
      clearIdleActionTimer();
    };
  }, [scheduleIdleAction, clearIdleActionTimer, lastInteractionAt]);

  // Gmail Integration: Polling Loop
  useEffect(() => {
    if (!isGmailConnected || !session) {
      return; // Don't poll if not connected
    }

    const pollNow = async () => {
      try {
        await gmailService.pollForNewMail(session.accessToken);
      } catch (error) {
        console.error('Gmail polling error:', error);
      }
    };

    // Add small delay before first poll to ensure initialization completes
    const initialDelayTimer = setTimeout(() => {
      pollNow();
    }, 2000); // 2 second initial delay

    // Then poll every 60 seconds (configurable via env var)
    const pollInterval = Number(import.meta.env.VITE_GMAIL_POLL_INTERVAL_MS) || 60000;
    const intervalId = setInterval(pollNow, pollInterval);

    // Cleanup: Stop polling when component unmounts or disconnects
    return () => {
      clearTimeout(initialDelayTimer);
      clearInterval(intervalId);
    };
  }, [isGmailConnected, session]);

  // Calendar Integration: Polling Loop
  const pollCalendar = useCallback(async () => {
    if (!isGmailConnected || !session) return; // Use same connection flag

    try {
      const events = await calendarService.getUpcomingEvents(session.accessToken);
      setUpcomingEvents(events); // Update state for the AI to read

      // Proactive reminder logic
      const now = Date.now();
      const reminderWindowMs = 15 * 60 * 1000; // 15 minutes

      for (const event of events) {
        if (!event.start?.dateTime) continue; // Skip all-day events

        const startTime = new Date(event.start.dateTime).getTime();
        
        // Check if event is starting soon and hasn't been notified
        if (
          startTime > now &&
          startTime < (now + reminderWindowMs) &&
          !notifiedEventIds.has(event.id)
        ) {
          console.log(`⏰ Character notifying about upcoming event: ${event.summary}`);
          
          const characterMessage = 
            `⏰ Hey! Just a reminder - you have an event starting in less than 15 minutes:\n` +
            `Event: ${event.summary}\n` +
            `Time: ${new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          
          // Add character notification directly to chat (character-initiated message)
          setChatHistory(prev => [...prev, { role: 'model' as const, text: characterMessage }]);
          
          // Save to conversation history
          if (selectedCharacter) {
            const userId = getUserId();
            try {
              await conversationHistoryService.appendConversationHistory(
                userId,
                [{ role: 'model', text: characterMessage }]
              );
            } catch (error) {
              console.error('Failed to save calendar notification to history:', error);
            }
          }
          
          // Mark as notified
          setNotifiedEventIds(prev => new Set(prev).add(event.id));
        }
      }
    } catch (error) {
      console.error('Calendar polling error:', error);
    }
  }, [isGmailConnected, session, notifiedEventIds]);

  useEffect(() => {
    if (!isGmailConnected || !session) {
      return;
    }

    // Add small delay before first poll to ensure initialization completes
    const initialDelayTimer = setTimeout(() => {
      pollCalendar();
    }, 3000); // 3 second initial delay for calendar

    const pollInterval = 5 * 60 * 1000; // Poll calendar every 5 minutes
    const intervalId = setInterval(pollCalendar, pollInterval);

    return () => {
      clearTimeout(initialDelayTimer);
      clearInterval(intervalId);
    };
  }, [isGmailConnected, session, pollCalendar]);

  // Gmail Integration: Event Listeners
  useEffect(() => {
    // Handler for new emails
    const handleNewMail = (event: Event) => {
      const customEvent = event as CustomEvent<NewEmailPayload[]>;
      console.log('📧 New emails received:', customEvent.detail);
      
      // Add to queue instead of immediately processing
      // (in case more emails arrive quickly)
      setEmailQueue(prev => [...prev, ...customEvent.detail]);
    };

    // Handler for auth errors (token expired)
    const handleAuthError = () => {
      console.error('🔒 Google authentication error - token likely expired');
      setIsGmailConnected(false);
      localStorage.removeItem('gmail_history_id');
      setUpcomingEvents([]); // Clear calendar events
      setErrorMessage('Google session expired. Please reconnect your account.');
    };

    // Start listening
    gmailService.addEventListener('new-mail', handleNewMail);
    gmailService.addEventListener('auth-error', handleAuthError);
    calendarService.addEventListener('auth-error', handleAuthError);

    // Stop listening on cleanup
    return () => {
      gmailService.removeEventListener('new-mail', handleNewMail);
      gmailService.removeEventListener('auth-error', handleAuthError);
      calendarService.removeEventListener('auth-error', handleAuthError);
    };
  }, []); // Only set up once - handlers don't depend on changing values

  // Gmail Integration: Process Debounced Emails and Notify Character
  useEffect(() => {
    if (debouncedEmailQueue.length === 0 || !selectedCharacter) {
      return; // No emails to process or no character selected
    }

    const processEmailNotification = async () => {
      // Create a notification message from the character
      let characterMessage = '';
      
      if (debouncedEmailQueue.length === 1) {
        const email = debouncedEmailQueue[0];
        characterMessage = 
          `📧 Hey! You just got a new email.\n` +
          `From: ${email.from}\n` +
          `Subject: ${email.subject}\n` +
          `${email.snippet ? `Preview: ${email.snippet}` : ''}`;
      } else {
        characterMessage = 
          `📧 Hey! You just received ${debouncedEmailQueue.length} new emails.\n` +
          `Most recent:\n` +
          `From: ${debouncedEmailQueue[0].from}\n` +
          `Subject: ${debouncedEmailQueue[0].subject}`;
      }

      console.log('💬 Character notifying about emails:', characterMessage);

      // Add character notification directly to chat (character-initiated message)
      const updatedHistory = [...chatHistory, { role: 'model' as const, text: characterMessage }];
      setChatHistory(updatedHistory);

      // Save to conversation history
      const userId = getUserId();
      try {
        await conversationHistoryService.appendConversationHistory(
          userId,
          [{ role: 'model', text: characterMessage }]
        );
        setLastSavedMessageIndex(updatedHistory.length - 1);
      } catch (error) {
        console.error('Failed to save email notification to history:', error);
      }

      // Clear the queue after processing
      setEmailQueue([]);
    };

    processEmailNotification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedEmailQueue, selectedCharacter]);

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
        alert(
          'A character with this image already exists. Loading that character instead.'
        );
        handleSelectCharacter(existingChar);
        return;
      }

      const newCharacter: CharacterProfile = {
        id: imageHash,
        createdAt: Date.now(),
        image,
        idleVideo: idleVideoBlob,
        actions: [],
        name: 'Kayley Adams',
        displayName: 'Kayley',
      };

      await dbService.saveCharacter(newCharacter);
      setCharacters((prev) => [newCharacter, ...prev]);
      handleSelectCharacter(newCharacter);
    } catch (error) {
      reportError('Failed to save the new character.', error);
    } finally {
      setIsSavingCharacter(false);
    }
  };

  const handleCreateAction = async ({
    name,
    phrases,
    videoFile,
  }: {
    name: string;
    phrases: string[];
    videoFile: File;
  }) => {
    if (!selectedCharacter) return;
    registerInteraction();
    const characterId = selectedCharacter.id;
    setIsCreatingAction(true);

    let videoUrl: string | null = null;

    try {
      const metadata = await dbService.createCharacterAction(characterId, {
        name,
        phrases,
        video: videoFile,
      });

      const newAction: CharacterAction = {
        id: metadata.id,
        name: metadata.name,
        phrases: metadata.phrases,
        video: videoFile,
        videoPath: metadata.videoPath,
        sortOrder: metadata.sortOrder ?? null,
      };

      const createdUrl = URL.createObjectURL(videoFile);
      videoUrl = createdUrl;

      applyCharacterUpdate(characterId, (character) => ({
        ...character,
        actions: [...character.actions, newAction],
      }));

      setActionVideoUrls((prev) => ({
        ...prev,
        [newAction.id]: createdUrl,
      }));
    } catch (error) {
      if (videoUrl) {
        try {
          URL.revokeObjectURL(videoUrl);
        } catch (revokeError) {
          console.warn(
            'Failed to revoke action video URL after creation error',
            revokeError
          );
        }
      }
      reportError('Failed to create new action.', error);
    } finally {
      setIsCreatingAction(false);
    }
  };

  const handleUpdateAction = async (
    actionId: string,
    {
      name,
      phrases,
      videoFile,
    }: {
      name: string;
      phrases: string[];
      videoFile?: File;
    }
  ) => {
    if (!selectedCharacter) return;
    registerInteraction();
    const characterId = selectedCharacter.id;
    const previousUrl = actionVideoUrls[actionId] ?? null;

    setUpdatingActionId(actionId);

    let newVideoUrl: string | null = null;

    try {
      const metadata = await dbService.updateCharacterAction(
        characterId,
        actionId,
        {
          name,
          phrases,
          video: videoFile,
        }
      );

      if (videoFile) {
        newVideoUrl = URL.createObjectURL(videoFile);
      }

      applyCharacterUpdate(characterId, (character) => ({
        ...character,
        actions: character.actions.map((action) =>
          action.id === actionId
            ? {
                ...action,
                name: metadata.name,
                phrases: metadata.phrases,
                sortOrder:
                  metadata.sortOrder !== undefined
                    ? metadata.sortOrder
                    : action.sortOrder ?? null,
                videoPath: metadata.videoPath,
                video: videoFile ?? action.video,
              }
            : action
        ),
      }));

      if (videoFile && newVideoUrl) {
        setActionVideoUrls((prev) => {
          const updated = { ...prev };
          const existingUrl = updated[actionId];
          if (existingUrl && existingUrl !== newVideoUrl) {
            try {
              URL.revokeObjectURL(existingUrl);
            } catch (error) {
              console.warn(
                'Failed to revoke previous action video URL',
                error
              );
            }
          }
          updated[actionId] = newVideoUrl;
          return updated;
        });

        if (currentVideoUrl && previousUrl && currentVideoUrl === previousUrl) {
          setCurrentVideoUrl(newVideoUrl);
        }
      }
    } catch (error) {
      if (newVideoUrl) {
        try {
          URL.revokeObjectURL(newVideoUrl);
        } catch (revokeError) {
          console.warn(
            'Failed to revoke updated action video URL after error',
            revokeError
          );
        }
      }
      reportError('Failed to update action.', error);
    } finally {
      setUpdatingActionId(null);
    }
  };

  const handleDeleteAction = async (actionId: string) => {
    if (!selectedCharacter) return;
    registerInteraction();
    const characterId = selectedCharacter.id;
    const previousUrl = actionVideoUrls[actionId] ?? null;

    setDeletingActionId(actionId);

    try {
      await dbService.deleteCharacterAction(characterId, actionId);

      applyCharacterUpdate(characterId, (character) => ({
        ...character,
        actions: character.actions.filter((action) => action.id !== actionId),
      }));

      setActionVideoUrls((prev) => {
        if (!(actionId in prev)) {
          return prev;
        }
        const updated = { ...prev };
        const url = updated[actionId];
        delete updated[actionId];
        if (url) {
          try {
            URL.revokeObjectURL(url);
          } catch (error) {
            console.warn('Failed to revoke deleted action video URL', error);
          }
        }
        return updated;
      });

      if (currentVideoUrl && previousUrl && currentVideoUrl === previousUrl) {
        setCurrentVideoUrl(idleVideoUrl ?? null);
      }
    } catch (error) {
      reportError('Failed to delete action.', error);
    } finally {
      setDeletingActionId(null);
    }
  };

  const handleSelectLocalVideo = async (videoFile: File) => {
    if (isSavingCharacter) return;
    if (!uploadedImage) {
      reportError('Upload a character image before selecting an animation.');
      return;
    }
    setErrorMessage(null);
    try {
      await handleCharacterCreated(uploadedImage, videoFile);
    } catch (error) {
      reportError('There was a problem processing your video file.', error);
    }
  };

  const handleManageActions = (character: CharacterProfile) => {
    registerInteraction();
    
    // Load action video URLs for this character if not already loaded
    const newActionUrls = character.actions.reduce((map, action) => {
      if (!actionVideoUrls[action.id]) {
        map[action.id] = URL.createObjectURL(action.video);
      } else {
        map[action.id] = actionVideoUrls[action.id];
      }
      return map;
    }, {} as Record<string, string>);
    
    setActionVideoUrls((prev) => ({ ...prev, ...newActionUrls }));
    setCharacterForActionManagement(character);
    setView('manageActions');
  };

  const handleBackFromActionManagement = () => {
    registerInteraction();
    setCharacterForActionManagement(null);
    setView('selectCharacter');
  };

  const handleSelectCharacter = async (character: CharacterProfile) => {
    setErrorMessage(null);
    setIsCreatingAction(false);
    setUpdatingActionId(null);
    setDeletingActionId(null);
    setIsLoadingCharacter(true);
    registerInteraction();

    if (idleVideoUrl) {
      try {
        URL.revokeObjectURL(idleVideoUrl);
      } catch (error) {
        console.warn('Failed to revoke idle video URL', error);
      }
    }

    if (currentVideoUrl && currentVideoUrl !== idleVideoUrl) {
      const isKnownActionUrl = Object.values(actionVideoUrls).includes(
        currentVideoUrl
      );
      if (!isKnownActionUrl) {
        try {
          URL.revokeObjectURL(currentVideoUrl);
        } catch (error) {
          console.warn('Failed to revoke previous action video URL', error);
        }
      }
    }

    cleanupActionUrls(actionVideoUrls);

    const newIdleVideoUrl = URL.createObjectURL(character.idleVideo);
    const newActionUrls = character.actions.reduce((map, action) => {
      if (map[action.id]) {
        console.warn(
          `Duplicate action id "${action.id}" detected for character "${character.id}".`
        );
      }
      map[action.id] = URL.createObjectURL(action.video);
      return map;
    }, {} as Record<string, string>);

    setSelectedCharacter(character);
    setIdleVideoUrl(newIdleVideoUrl);
    setActionVideoUrls(newActionUrls);
    setCurrentVideoUrl(newIdleVideoUrl);
    setCurrentActionId(null);
    
    try {
      // Load conversation history and relationship for this user
      const userId = getUserId();
      const savedHistory = await conversationHistoryService.loadConversationHistory(userId);
      const relationshipData = await relationshipService.getRelationship(userId);
      setRelationship(relationshipData);
      
      // Generate personalized greeting using Active Service (with full history and relationship context)
     try {
      // Generate greeting
      // Using simplified session creation for now, as state is managed inside App
      const session: AIChatSession = { userId, model: activeService.model }; 
      
      const { greeting, session: updatedSession } = await activeService.generateGreeting(
        character,
        session,
        savedHistory, // Pass saved history for context
        relationshipData // Pass relationship context
      );
      setAiSession(updatedSession);

      // 2. Parse the response object
      const textResponse = greeting.text_response;
      const actionIdToPlay = greeting.action_id;

      // 3. Combine saved history with the new text_response
      const initialHistory = savedHistory.length > 0
        ? [...savedHistory, { role: 'model' as const, text: textResponse }]
        : [{ role: 'model' as const, text: textResponse }];
      setChatHistory(initialHistory);

      // 4. Play the greeting action (e.g., a wave) if one was sent
      if (actionIdToPlay) {
        const actionUrl = newActionUrls[actionIdToPlay];
        if (actionUrl) {
          // Use setTimeout to ensure state is set before playing greeting
          setTimeout(() => {
            setCurrentVideoUrl(actionUrl);
            setCurrentActionId(actionIdToPlay);
          }, 100);
        } else {
          console.warn(`Greeting action "${actionIdToPlay}" not found.`);
        }
      }
      // --- FIX END ---

      // Track that all loaded messages are saved (greeting is new, so we're at savedHistory.length)
      setLastSavedMessageIndex(savedHistory.length - 1);

    } catch (error) {
        console.error('Error generating greeting:', error);
        // Show error to user and start with saved history only (no greeting)
        setErrorMessage('Failed to generate greeting. Please try again.');
        const initialHistory = savedHistory.length > 0
          ? savedHistory
          : [];
        setChatHistory(initialHistory);
        setLastSavedMessageIndex(savedHistory.length - 1);
      }
      
      setView('chat');
    } catch (error) {
      console.error('Error loading character:', error);
      setErrorMessage('Failed to load character data. Please try again.');
    } finally {
      setIsLoadingCharacter(false);
    }

    // Check for greeting actions and play one automatically
    const greetingActions = getGreetingActions(character.actions);
    if (greetingActions.length > 0) {
      // Use setTimeout to ensure state is set before playing greeting
      setTimeout(() => {
        const greetingAction = randomFromArray(greetingActions);
        const greetingUrl = newActionUrls[greetingAction.id] ?? null;
        
        if (!greetingUrl && greetingAction.videoPath) {
          const { data } = supabase.storage
            .from(ACTION_VIDEO_BUCKET)
            .getPublicUrl(greetingAction.videoPath);
          const fallbackUrl = data?.publicUrl ?? null;
          if (fallbackUrl) {
            setCurrentVideoUrl(fallbackUrl);
            setCurrentActionId(greetingAction.id);
          }
        } else if (greetingUrl) {
          setCurrentVideoUrl(greetingUrl);
          setCurrentActionId(greetingAction.id);
        }
      }, 100);
    }
  };

  const handleDeleteCharacter = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this character?")) {
        registerInteraction();
        if (selectedCharacter?.id === id) {
          handleBackToSelection();
        }
        await dbService.deleteCharacter(id);
        setCharacters(prev => prev.filter(c => c.id !== id));
    }
  };

  const handleBackToSelection = async () => {
    registerInteraction();
    
    // Save any unsaved conversation history before leaving
    // Note: We don't save greetings (they're generated fresh each time)
    if (selectedCharacter && chatHistory.length > 0 && lastSavedMessageIndex < chatHistory.length - 1) {
      const userId = getUserId();
      // Only save messages that haven't been saved yet
      // Filter out any greeting messages (they start with common greeting patterns)
      const unsavedMessages = chatHistory
        .slice(lastSavedMessageIndex + 1)
        .filter(msg => {
          // Don't save greeting messages - they're generated fresh each time
          const text = msg.text.toLowerCase();
          const isGreeting = text.includes('hi!') || text.includes('hello') || 
            (text.includes('can perform') && text.length < 50);
          return !isGreeting || msg.role === 'user'; // Always save user messages
        });
      
      if (unsavedMessages.length > 0) {
        try {
          await conversationHistoryService.appendConversationHistory(
            userId,
            unsavedMessages
          );
        } catch (error) {
          console.error('Failed to save conversation history:', error);
          // Don't block user from leaving
        }
      }
    }
    
    if (idleVideoUrl) {
      try {
        URL.revokeObjectURL(idleVideoUrl);
      } catch (error) {
        console.warn('Failed to revoke idle video URL', error);
      }
    }

    if (currentVideoUrl && currentVideoUrl !== idleVideoUrl) {
      const isKnownActionUrl = Object.values(actionVideoUrls).includes(
        currentVideoUrl
      );
      if (!isKnownActionUrl) {
        try {
          URL.revokeObjectURL(currentVideoUrl);
        } catch (error) {
          console.warn('Failed to revoke current action video URL', error);
        }
      }
    }

    cleanupActionUrls(actionVideoUrls);

    setSelectedCharacter(null);
    setIdleVideoUrl(null);
    setCurrentVideoUrl(null);
    setCurrentActionId(null);
    setActionVideoUrls({});
    setChatHistory([]);
    setAiSession(null);
    setLastSavedMessageIndex(-1);
    setRelationship(null);
    setUpcomingEvents([]);
    setNotifiedEventIds(new Set());
    setUploadedImage(null);
    setErrorMessage(null);
    setView('selectCharacter');
    setIsCreatingAction(false);
    setUpdatingActionId(null);
    setDeletingActionId(null);
  };

  const handleSendMessage = async (message: string) => {
    if (!selectedCharacter || !session) return;
    registerInteraction();
    setErrorMessage(null);
    
    const updatedHistory = [...chatHistory, { role: 'user' as const, text: message }];
    setChatHistory(updatedHistory);
    setIsProcessingAction(true);

    try {
      const userId = getUserId();
      // Note: analyzeMessageSentiment needs 'grok' or 'gemini' passed to it if we want to switch sentimental brains too.
      // For now using default.
      const relationshipEvent = await relationshipService.analyzeMessageSentiment(message, chatHistory);
      const updatedRelationship = await relationshipService.updateRelationship(userId, relationshipEvent);
      if (updatedRelationship) setRelationship(updatedRelationship);

      const sessionToUse: AIChatSession = aiSession || { userId, characterId: selectedCharacter.id };
      
      // Send TEXT content
      const { response, session: updatedSession, audioData } = await activeService.generateResponse(
        { type: 'text', text: message }, 
        {
          character: selectedCharacter,
          chatHistory: chatHistory, 
          relationship: updatedRelationship, 
          upcomingEvents: upcomingEvents,
        },
        sessionToUse
      );
      
      setAiSession(updatedSession);
      
      const textResponse = response.text_response;
      const actionIdToPlay = response.action_id;
      
      // (Calendar logic omitted for brevity, assumes same as before)

      setChatHistory(prev => [...prev, { role: 'model' as const, text: textResponse }]);
      
      // Save History
      conversationHistoryService.appendConversationHistory(
        userId,
        [{ role: 'user', text: message }, { role: 'model', text: textResponse }]
      ).then(() => setLastSavedMessageIndex(updatedHistory.length));

      // --- NEW: Play Audio Response ---
      if (!isMuted) {
        if (audioData) {
          setResponseAudioSrc(audioData);
        }

      }

      // Play Action
      if (actionIdToPlay) {
        const actionUrl = actionVideoUrls[actionIdToPlay];
        // ... (fallback fetch logic) ...
        if (actionUrl) {
             setCurrentVideoUrl(actionUrl);
             setCurrentActionId(actionIdToPlay);
        }
      }

    } catch (error) {
      console.error('Error generating response:', error);
      setErrorMessage('Failed to generate response.');
    } finally {
      setIsProcessingAction(false);
    }
  };
  
  const isActionVideoPlaying =
    currentVideoUrl !== null && currentVideoUrl !== idleVideoUrl;

  const handleVideoEnd = () => {
    if (isActionVideoPlaying && idleVideoUrl) {
      setCurrentVideoUrl(idleVideoUrl);
      setCurrentActionId(null);
    }
  };

  const isBusy = isProcessingAction;

  const renderContent = () => {
    switch (view) {
        case 'loading':
            return <div className="flex items-center justify-center h-full"><LoadingSpinner /></div>;
        case 'selectCharacter':
            return <CharacterSelector 
                characters={displayCharacters}
                onSelectCharacter={handleSelectCharacter}
                onCreateNew={() => setView('createCharacter')}
                onDeleteCharacter={handleDeleteCharacter}
                onManageActions={handleManageActions}
                isLoading={isLoadingCharacter}
            />;
        case 'manageActions':
            if (!characterForActionManagement) return null;
            return (
              <ActionManagementView
                character={characterForActionManagement}
                actions={managedActions}
                onCreateAction={handleCreateAction}
                onUpdateAction={handleUpdateAction}
                onDeleteAction={handleDeleteAction}
                onBack={handleBackFromActionManagement}
                isCreating={isCreatingAction}
                updatingActionId={updatingActionId}
                deletingActionId={deletingActionId}
              />
            );
        case 'createCharacter':
            return (
              <ImageUploader 
                onImageUpload={handleImageUpload}
                onSelectLocalVideo={handleSelectLocalVideo}
                imagePreview={uploadedImage?.base64 ? `data:${uploadedImage.mimeType};base64,${uploadedImage.base64}` : null}
                isSaving={isSavingCharacter}
                onBack={handleBackToSelection}
              />
            );
        case 'chat':
            if (!selectedCharacter) return null; // Should not happen
            return (
              <div
                className={`relative grid gap-8 h-full ${
                  isVideoVisible
                    ? 'grid-cols-1 lg:grid-cols-2'
                    : 'grid-cols-1'
                }`}
              >
                <button 
                  onClick={handleBackToSelection} 
                  className="absolute top-2 left-2 z-30 bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2 transition-colors"
                  aria-label="Back to character selection"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className="absolute top-2 right-2 z-30">
                  <button
                    onClick={() => setIsVideoVisible((prev) => !prev)}
                    className="bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full px-4 py-2 transition-colors whitespace-nowrap"
                  >
                    {isVideoVisible ? 'Hide Video' : 'Show Video'}
                  </button>
                </div>
                {isVideoVisible && (
                  <div className="h-full flex items-center justify-center bg-black rounded-lg relative">
                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className="absolute top-2 right-2 z-30 bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2 transition-colors"
                      aria-label={isMuted ? "Unmute audio" : "Mute audio"}
                    >
                      {isMuted ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                      )}
                    </button>
                    <VideoPlayer 
                      src={currentVideoUrl}
                      onEnded={handleVideoEnd}
                      isLoading={isProcessingAction}
                      loop={!isActionVideoPlaying}
                      muted={isMuted}
                    />
                  </div>
                )}
                <div className="h-full">
                  <ChatPanel
                    history={chatHistory}
                    onSendMessage={handleSendMessage}
                    onSendAudio={handleSendAudio}
                    useAudioInput={activeServiceId === 'gemini'}
                    isSending={isBusy}
                  />
                </div>
              </div>
            );
    }
  };

  // Show loading screen while checking authentication
  if (authStatus === 'loading') {
    return (
      <div className="bg-gray-900 text-gray-100 min-h-screen flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  // Show login page if not authenticated
  if (!session || authStatus !== 'connected') {
    return <LoginPage />;
  }

  // Show main app only when authenticated
  return (
    <div className="bg-gray-900 text-gray-100 min-h-screen flex flex-col p-4 md:p-8">
      <header className="text-center mb-8 relative">
        <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-600">
          Interactive Video Character
        </h1>
        <p className="text-gray-400 mt-2">
          Play pre-recorded character animations stored in Supabase.
        </p>
        <div className="absolute top-0 right-0">
          <SettingsPanel onGmailConnectionChange={setIsGmailConnected} />
        </div>
      </header>
      <main className="flex-grow bg-gray-800/50 rounded-2xl p-4 md:p-6 shadow-2xl shadow-black/30 backdrop-blur-sm border border-gray-700">
        {errorMessage && <div className="bg-red-500/20 border border-red-500 text-red-300 p-3 rounded-lg mb-4 text-center">{errorMessage}</div>}
        {renderContent()}
      </main>
    </div>
  );
};

export default App;
