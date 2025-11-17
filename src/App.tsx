
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChatMessage,
  UploadedImage,
  CharacterProfile,
  CharacterAction,
} from './types';
import * as dbService from './services/cacheService';
import { supabase } from './services/supabaseClient';
import * as grokChatService from './services/grokChatService';
import type { GrokChatSession } from './services/grokChatService';
// NEW: Import the response type from the schema
import type { GrokActionResponse } from './services/grokSchema';
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
import ChatPanel from './components/ChatPanel';
import CharacterSelector from './components/CharacterSelector';
import LoadingSpinner from './components/LoadingSpinner';
import ActionManager from './components/ActionManager';
import { SettingsPanel } from './components/SettingsPanel';
import { LoginPage } from './components/LoginPage';
import { useGoogleAuth } from './contexts/GoogleAuthContext';
import { useDebounce } from './hooks/useDebounce';

const sanitizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Generate or retrieve a stable user ID (browser fingerprinting)
const getUserId = (): string => {
  const storageKey = 'interactive_video_character_user_id';
  let userId = localStorage.getItem(storageKey);
  
  if (!userId) {
    // Generate a unique ID based on browser fingerprint
    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      new Date().getTime(),
    ].join('|');
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    userId = `user_${Math.abs(hash).toString(36)}`;
    localStorage.setItem(storageKey, userId);
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

// --- THESE FUNCTIONS ARE NO LONGER NEEDED ---
// Grok will now decide which actions to play based on intent
/*
const buildActionTerms = (
  action: CharacterProfile['actions'][number]
): string[] => {
  const terms = new Set<string>();
  const addTerm = (term: string | undefined | null) => {
    if (!term) return;
    const cleaned = sanitizeText(term);
    if (cleaned) {
      terms.add(cleaned);
    }
  };

  addTerm(action.id);
  addTerm(action.name);
  action.phrases.forEach(addTerm);

  return Array.from(terms);
};

const findMatchingAction = (
  message: string,
  actions: CharacterProfile['actions']
) => {
  // ... (all of this logic is now handled by Grok)
};
*/

const formatActionList = (actions: CharacterProfile['actions']): string => {
  if (actions.length === 0) return '';
  return actions
    .map((action) => action.name.trim())
    .filter((name) => name.length > 0)
    .join(', ');
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

type View = 'loading' | 'selectCharacter' | 'createCharacter' | 'chat';

// A type for characters that includes their profile and the temporary URLs for display
interface DisplayCharacter {
  profile: CharacterProfile;
  imageUrl: string;
  videoUrl: string;
}

const slugifyIdentifier = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const getCharacterRelationshipAnchor = (character: CharacterProfile): string => {
  const candidates = [
    character.personaId,
    character.name,
    character.displayName,
    character.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (candidate === character.id) {
      // character.id is already a stable hash—no need to slugify
      return candidate;
    }
    const slug = slugifyIdentifier(trimmed);
    if (slug.length > 0) {
      return slug;
    }
  }

  return character.id;
};

const App: React.FC = () => {
  const { session, status: authStatus } = useGoogleAuth();
  const [view, setView] = useState<View>('loading');
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterProfile | null>(null);
  const [idleVideoUrl, setIdleVideoUrl] = useState<string | null>(null);
  const [actionVideoUrls, setActionVideoUrls] = useState<Record<string, string>>(
    {}
  );

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
  const [isActionManagerOpen, setIsActionManagerOpen] = useState(false);
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now());
  const [isMuted, setIsMuted] = useState(false);
  const [grokSession, setGrokSession] = useState<GrokChatSession | null>(null);
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
    try {
      const savedCharacters = await dbService.getCharacters();
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
    if (!selectedCharacter) return [];

    return selectedCharacter.actions.map((action) => {
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
  }, [selectedCharacter, actionVideoUrls]);

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

    // Poll immediately on connection
    pollNow();

    // Then poll every 60 seconds (configurable via env var)
    const pollInterval = Number(import.meta.env.VITE_GMAIL_POLL_INTERVAL_MS) || 60000;
    const intervalId = setInterval(pollNow, pollInterval);

    // Cleanup: Stop polling when component unmounts or disconnects
    return () => clearInterval(intervalId);
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
          console.log(`⏰ Notifying character about upcoming event: ${event.summary}`);
          
          const systemMessage = 
            `[⏰ System Notification] You have an event starting in less than 15 minutes:\n` +
            `Event: ${event.summary}\n` +
            `Time: ${new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          
          // Send this notification to the AI
          await handleSendMessage(systemMessage);
          
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

    // Poll immediately
    pollCalendar();

    const pollInterval = 5 * 60 * 1000; // Poll calendar every 5 minutes
    const intervalId = setInterval(pollCalendar, pollInterval);

    return () => clearInterval(intervalId);
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
      // Create a message for the character
      let systemMessage = '';
      
      if (debouncedEmailQueue.length === 1) {
        const email = debouncedEmailQueue[0];
        systemMessage = 
          `[📧 System Notification] You just received a new email.\n` +
          `From: ${email.from}\n` +
          `Subject: ${email.subject}\n` +
          `Preview: ${email.snippet}`;
      } else {
        systemMessage = 
          `[📧 System Notification] You just received ${debouncedEmailQueue.length} new emails.\n` +
          `Most recent:\n` +
          `From: ${debouncedEmailQueue[0].from}\n` +
          `Subject: ${debouncedEmailQueue[0].subject}`;
      }

      console.log('💬 Notifying character about emails:', systemMessage);

      // Automatically trigger character response to the email notification
      await handleSendMessage(systemMessage);

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

  const handleSelectCharacter = async (character: CharacterProfile) => {
    setErrorMessage(null);
    setIsCreatingAction(false);
    setUpdatingActionId(null);
    setDeletingActionId(null);
    setIsActionManagerOpen(false);
    setIsLoadingCharacter(true);
    registerInteraction();
    const personaId = getCharacterRelationshipAnchor(character);

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
      // Load conversation history and relationship for this character-user pair
      const userId = getUserId();
      const savedHistory = await conversationHistoryService.loadConversationHistory(personaId, userId);
      const relationshipData = await relationshipService.getRelationship(personaId, userId);
      setRelationship(relationshipData);
      
      // Generate personalized greeting using Grok (with full history and relationship context)
     // Generate personalized greeting using Grok (with full history and relationship context)
     try {
      const session = grokChatService.getOrCreateSession(personaId, userId);

      // --- FIX START ---
      // 1. generateGrokGreeting now returns a GrokActionResponse object, not a string.
      const { greeting, session: updatedSession } = await grokChatService.generateGrokGreeting(
        character,
        session,
        savedHistory, // Pass saved history for context
        relationshipData // Pass relationship context
      );
      setGrokSession(updatedSession);

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
        console.error('Error generating Grok greeting:', error);
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
    const personaId = selectedCharacter
      ? getCharacterRelationshipAnchor(selectedCharacter)
      : null;
    
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
            personaId ?? selectedCharacter.id,
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
    setGrokSession(null);
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
    setIsActionManagerOpen(false);
  };

  const handleSendMessage = async (message: string) => {
    if (!selectedCharacter || !session) return;

    registerInteraction();
    setErrorMessage(null);
    const personaId = getCharacterRelationshipAnchor(selectedCharacter);
    
    // Add user message to local state immediately
    const updatedHistory = [...chatHistory, { role: 'user' as const, text: message }];
    setChatHistory(updatedHistory);
    setIsProcessingAction(true);

    try {
      // Analyze message sentiment and update relationship
      const userId = getUserId();
      const relationshipEvent = await relationshipService.analyzeMessageSentiment(
        message,
        chatHistory
      );
      
      // Update relationship based on sentiment
      const updatedRelationship = await relationshipService.updateRelationship(
        personaId,
        userId,
        relationshipEvent
      );
      
      if (updatedRelationship) {
        setRelationship(updatedRelationship);
      }

      // Generate response from Grok chat service (with relationship context and calendar events)
      const grokSessionToUse = grokSession || grokChatService.getOrCreateSession(personaId, userId);
      
      const { response, session: updatedSession } = await grokChatService.generateGrokResponse(
        message,
        {
          character: selectedCharacter,
          chatHistory: chatHistory, // Use chat history without adding the new user message
          relationship: updatedRelationship, // Pass relationship context
          upcomingEvents: upcomingEvents, // Pass calendar events
        },
        grokSessionToUse
      );
      
      setGrokSession(updatedSession);
      
      // --- NEW LOGIC: Parse the Structured Response ---
      // 'response' is now our GrokActionResponse object
      const grokResponse: GrokActionResponse = response;
      const textResponse = grokResponse.text_response;
      const actionIdToPlay = grokResponse.action_id; // This will be "WAVE", "KISS", "GREETING", or null
      
      // Check if response is a calendar action (textResponse might still contain this)
      if (textResponse.startsWith('[CALENDAR_CREATE]')) {
        try {
          const jsonString = textResponse.substring('[CALENDAR_CREATE]'.length);
          const eventData: NewEventPayload = JSON.parse(jsonString);

          // Add a confirmation message to chat *before* making API call
          const confirmationText = `Okay, I'll add "${eventData.summary}" to your calendar.`;
          const finalHistory = [...updatedHistory, { role: 'model' as const, text: confirmationText }];
          setChatHistory(finalHistory);

          // Asynchronously save this confirmation
          conversationHistoryService.appendConversationHistory(
            personaId,
            userId,
            [
              { role: 'user', text: message },
              { role: 'model', text: confirmationText },
            ]
          ).then(() => {
            setLastSavedMessageIndex(finalHistory.length - 1);
          }).catch(error => {
            console.error('Failed to save conversation history:', error);
          });
          
          // Now, create the event
          await calendarService.createEvent(session.accessToken, eventData);
          
          // Refresh calendar events immediately
          pollCalendar();
          
        } catch (err) {
          console.error("Failed to create calendar event:", err);
          setErrorMessage("I tried to create the event, but something went wrong.");
          // Add error message to chat
          setChatHistory(prev => [...prev, { role: 'model', text: "Sorry, I ran into an error trying to add that to your calendar." }]);
        }
        
        setIsProcessingAction(false);
        return; // Stop here, we've handled the response
      }
      
      // Add Grok's *text response* to local state
      const finalHistory = [...updatedHistory, { role: 'model' as const, text: textResponse }];
      setChatHistory(finalHistory);
      
      // Append new messages to conversation history in database
      // We append incrementally to avoid re-saving the entire history each time
      const newMessages: ChatMessage[] = [
        { role: 'user', text: message },
        { role: 'model', text: textResponse }, // <-- Use textResponse
      ];
      // Save asynchronously - don't block UI
      conversationHistoryService.appendConversationHistory(
        personaId,
        userId,
        newMessages
      ).then(() => {
        // Track that we've saved up to the current message count
        setLastSavedMessageIndex(finalHistory.length - 1);
      }).catch(error => {
        console.error('Failed to save conversation history:', error);
      });

      // --- NEW: Play the action Grok decided on ---
      if (actionIdToPlay) {
        // 'actionIdToPlay' is an ID like "WAVE". We find its URL in state.
        const actionUrl = actionVideoUrls[actionIdToPlay];
        
        if (!actionUrl) {
          // Fallback to Supabase URL if local URL not available
          const matchedAction = selectedCharacter.actions.find(a => a.id === actionIdToPlay);
          if (matchedAction?.videoPath) {
            const { data } = supabase.storage
              .from(ACTION_VIDEO_BUCKET)
              .getPublicUrl(matchedAction.videoPath);
            const fallbackUrl = data?.publicUrl ?? null;
            if (fallbackUrl) {
              setCurrentVideoUrl(fallbackUrl);
              setCurrentActionId(matchedAction.id);
            }
          } else {
            console.warn(`Grok chose action "${actionIdToPlay}" but it could not be found.`);
          }
        } else {
          // Clean up previous action video URL if needed
          if (
            currentVideoUrl &&
            currentVideoUrl !== idleVideoUrl &&
            currentVideoUrl !== actionUrl
          ) {
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

          setCurrentVideoUrl(actionUrl);
          setCurrentActionId(actionIdToPlay);
        }
      }

      // Response already added to chat history above
    } catch (error) {
      console.error('Error generating response:', error);
      setErrorMessage('Failed to generate response. Please try again.');
      setChatHistory((prev) => [
        ...prev,
        { role: 'model', text: "Sorry, I'm having trouble responding right now." },
      ]);
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
                isLoading={isLoadingCharacter}
            />;
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
                    ? 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-5'
                    : 'grid-cols-1 lg:grid-cols-1 xl:grid-cols-4'
                }`}
              >
                <button 
                  onClick={handleBackToSelection} 
                  className="absolute top-2 left-2 z-30 bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2 transition-colors"
                  aria-label="Back to character selection"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className="absolute top-2 right-2 z-30 flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => setIsVideoVisible((prev) => !prev)}
                    className="bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full px-4 py-2 transition-colors whitespace-nowrap"
                  >
                    {isVideoVisible ? 'Hide Video' : 'Show Video'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      registerInteraction();
                      setIsActionManagerOpen((previous) => !previous);
                    }}
                    className="bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full px-4 py-2 transition-colors whitespace-nowrap"
                  >
                    {isActionManagerOpen ? 'Hide Actions' : 'Show Actions'}
                  </button>
                </div>
                {isVideoVisible && (
                  <div className="xl:col-span-2 h-full flex items-center justify-center bg-black rounded-lg relative">
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
                <div className={`h-full ${isVideoVisible ? 'xl:col-span-2' : 'xl:col-span-3'}`}>
                  <ChatPanel
                    history={chatHistory}
                    onSendMessage={handleSendMessage}
                    isSending={isBusy}
                  />
                </div>
                <div className="lg:col-span-2 xl:col-span-1 h-full flex flex-col gap-4">
                  {isActionManagerOpen && (
                    <ActionManager
                      actions={managedActions}
                      onCreateAction={handleCreateAction}
                      onUpdateAction={handleUpdateAction}
                      onDeleteAction={handleDeleteAction}
                      isCreating={isCreatingAction}
                      updatingActionId={updatingActionId}
                      deletingActionId={deletingActionId}
                    />
                  )}
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
