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
} from './services/calendarService';

import ImageUploader from './components/ImageUploader';
import VideoPlayer from './components/VideoPlayer';
import AudioPlayer from './components/AudioPlayer';
import ChatPanel from './components/ChatPanel';
import CharacterSelector from './components/CharacterSelector';
import LoadingSpinner from './components/LoadingSpinner';
import ActionManagementView from './components/ActionManagementView';
import IdleVideoManagementView from './components/IdleVideoManagementView';
import { SettingsPanel } from './components/SettingsPanel';
import { LoginPage } from './components/LoginPage';
import { useGoogleAuth } from './contexts/GoogleAuthContext';
import { useDebounce } from './hooks/useDebounce';
import { useAIService } from './contexts/AIServiceContext';
import { AIChatSession, UserContent } from './services/aiService';

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

type View = 'loading' | 'selectCharacter' | 'createCharacter' | 'chat' | 'manageActions' | 'manageIdleVideos';

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
  
  // New Video State Logic
  const [idleVideoUrls, setIdleVideoUrls] = useState<string[]>([]);
  const [videoQueue, setVideoQueue] = useState<string[]>([]);
  const [currentVideoSrc, setCurrentVideoSrc] = useState<string | null>(null);

  const [actionVideoUrls, setActionVideoUrls] = useState<Record<string, string>>(
    {}
  );
  const [responseAudioSrc, setResponseAudioSrc] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [currentActionId, setCurrentActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [isSavingCharacter, setIsSavingCharacter] = useState(false);
  const [isCreatingAction, setIsCreatingAction] = useState(false);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);
  const [deletingActionId, setDeletingActionId] = useState<string | null>(null);
  const [characterForActionManagement, setCharacterForActionManagement] = useState<CharacterProfile | null>(null);
  const [characterForIdleVideoManagement, setCharacterForIdleVideoManagement] = useState<CharacterProfile | null>(null);
  const [isAddingIdleVideo, setIsAddingIdleVideo] = useState(false);
  const [deletingIdleVideoId, setDeletingIdleVideoId] = useState<string | null>(null);
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
  const debouncedEmailQueue = useDebounce(emailQueue, 5000); 

  // Calendar Integration State
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [notifiedEventIds, setNotifiedEventIds] = useState<Set<string>>(new Set());
  const idleActionTimerRef = useRef<number | null>(null);

  // --- UPDATED: Handle Audio Input ---
  const handleSendAudio = async (audioBlob: Blob) => {
      if (!selectedCharacter || !session) return;
      registerInteraction();
      setErrorMessage(null);

      const placeholderText = "🎤 [Audio Message]";
      
      setChatHistory(prev => [...prev, { role: 'user' as const, text: placeholderText }]);
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

              const { response, session: updatedSession, audioData } = await activeService.generateResponse(
                  input,
                  {
                      character: selectedCharacter,
                      chatHistory: chatHistory, 
                      relationship: relationship, 
                      upcomingEvents: upcomingEvents,
                  },
                  sessionToUse
              );

              setAiSession(updatedSession);
              
              setChatHistory(currentHistory => {
                  const newHistory = [...currentHistory];
                  const lastIndex = newHistory.length - 1;
                  
                  if (newHistory[lastIndex].text === placeholderText) {
                      newHistory[lastIndex] = { 
                          role: 'user', 
                          text: response.user_transcription 
                              ? `🎤 ${response.user_transcription}` 
                              : "🎤 [Audio Message]" 
                      };
                  }
                  
                  newHistory.push({ role: 'model' as const, text: response.text_response });
                  return newHistory;
              });

              if (!isMuted && audioData) {
                setResponseAudioSrc(audioData);
              }

              // Handle Action Video
              if (response.action_id) {
                 playAction(response.action_id);
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
    try {
      return characters.map(profile => ({
        profile,
        imageUrl: `data:${profile.image.mimeType};base64,${profile.image.base64}`,
        videoUrl: profile.idleVideos.length > 0 ? URL.createObjectURL(profile.idleVideos[0]) : ''
      }));
    } catch (e) {
      console.error("Error creating object URLs:", e);
      return [];
    }
  }, [characters]);

  useEffect(() => {
    return () => {
      displayCharacters.forEach(c => {
        if (c.videoUrl) URL.revokeObjectURL(c.videoUrl);
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
      };
    });
  }, [characterForActionManagement, selectedCharacter, actionVideoUrls]);

  const managedIdleVideos = useMemo(() => {
    const character = characterForIdleVideoManagement || selectedCharacter;
    if (!character) return [];

    return character.idleVideos.map((videoBlob, index) => {
      // Always create a URL for each video - either use existing or create new one
      let videoUrl = idleVideoUrls[index];
      if (!videoUrl) {
        videoUrl = URL.createObjectURL(videoBlob);
      }
      return {
        id: `idle-${index}`,
        videoUrl,
        isLocal: true,
      };
    });
  }, [characterForIdleVideoManagement, selectedCharacter, idleVideoUrls]);

  // New helper to insert action into queue
  const playAction = (actionId: string) => {
      const actionUrl = actionVideoUrls[actionId];
      if (actionUrl) {
          // We insert the action at index 1 (next video)
          // Queue: [Playing, Next, ...]
          // New Queue: [Playing, Action, Next, ...]
          setVideoQueue(prev => {
              const playing = prev[0];
              const rest = prev.slice(1);
              const newQueue = [playing, actionUrl, ...rest];
              return newQueue;
          });
          
          // Immediately force VideoPlayer to preload this new action
          setCurrentVideoSrc(actionUrl);
          setCurrentActionId(actionId);
      }
  };

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
        // If we fetched a public URL, we should cache/track it? 
        // For now, assume actionVideoUrls has it or we rely on public URL.
        // If it's not in actionVideoUrls map, we might need to update map, but strict logic uses map.
        // Let's use actionUrl directly for the queue.
        
        // Insert into queue
        setVideoQueue(prev => {
             const playing = prev[0];
             const rest = prev.slice(1);
             return [playing, actionUrl!, ...rest];
        });
        setCurrentVideoSrc(actionUrl);
        setCurrentActionId(action.id);
        setLastInteractionAt(Date.now());
    }

  }, [
    selectedCharacter,
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
      } catch (error) { console.error(error); }

      setEmailQueue([]);
    };

    processEmailNotification();
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
        alert('Character exists. Loading...');
        handleSelectCharacter(existingChar);
        return;
      }

      const newCharacter: CharacterProfile = {
        id: imageHash,
        createdAt: Date.now(),
        image,
        idleVideos: [idleVideoBlob], // Initialize with array
        actions: [],
        name: 'Kayley Adams',
        displayName: 'Kayley',
      };

      await dbService.saveCharacter(newCharacter);
      setCharacters((prev) => [newCharacter, ...prev]);
      handleSelectCharacter(newCharacter);
    } catch (error) {
      reportError('Failed to save character.', error);
    } finally {
      setIsSavingCharacter(false);
    }
  };

  const handleCreateAction = async (input: { name: string; phrases: string[]; videoFile: File }) => {
    const character = characterForActionManagement || selectedCharacter;
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
      if (characterForActionManagement) {
        setCharacterForActionManagement(prev => {
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
    const character = characterForActionManagement || selectedCharacter;
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
        if (characterForActionManagement) {
          setCharacterForActionManagement(prev => {
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
    const character = characterForActionManagement || selectedCharacter;
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
        }
        
        // Update the management character state if we're in management view
        if (characterForActionManagement) {
          setCharacterForActionManagement(prev => {
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

  const handleManageActions = (character: CharacterProfile) => {
    registerInteraction();
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

  const handleManageIdleVideos = (character: CharacterProfile) => {
    registerInteraction();
    
    console.log(`🎬 Opening idle video manager for ${character.displayName}`);
    console.log(`  Character has ${character.idleVideos.length} idle videos`);
    console.log(`  Current idleVideoUrls length: ${idleVideoUrls.length}`);
    
    // Create URLs for idle videos if they don't exist
    const newIdleUrls = character.idleVideos.map((blob, index) => {
      const existingUrl = idleVideoUrls[index];
      if (existingUrl) {
        console.log(`  Using existing URL for video ${index}`);
        return existingUrl;
      } else {
        const newUrl = URL.createObjectURL(blob);
        console.log(`  Created new URL for video ${index}`);
        return newUrl;
      }
    });
    
    console.log(`  Total URLs created: ${newIdleUrls.length}`);
    setIdleVideoUrls(newIdleUrls);
    setCharacterForIdleVideoManagement(character);
    setView('manageIdleVideos');
  };

  const handleAddIdleVideo = async (videoFile: File) => {
    if (!characterForIdleVideoManagement) return;
    setIsAddingIdleVideo(true);
    try {
      const videoId = await dbService.addIdleVideo(characterForIdleVideoManagement.id, videoFile);
      
      console.log(`✅ Added idle video with ID: ${videoId}`);
      
      // Convert File to Blob (File extends Blob, so this is safe)
      const videoBlob: Blob = videoFile;
      
      // Update character with new video
      applyCharacterUpdate(characterForIdleVideoManagement.id, char => {
        console.log(`  Updating character: adding video to ${char.idleVideos.length} existing videos`);
        return {
          ...char,
          idleVideos: [...char.idleVideos, videoBlob]
        };
      });
      
      // Create URL for immediate preview
      const newUrl = URL.createObjectURL(videoFile);
      console.log(`  Created new URL for immediate display`);
      
      // Add to idle video URLs
      setIdleVideoUrls(prev => {
        const updated = [...prev, newUrl];
        console.log(`  Updated idleVideoUrls from ${prev.length} to ${updated.length}`);
        return updated;
      });
      
      // Update the management character state to reflect the new video
      setCharacterForIdleVideoManagement(prev => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          idleVideos: [...prev.idleVideos, videoBlob]
        };
        console.log(`  Updated management character: ${prev.idleVideos.length} -> ${updated.idleVideos.length} videos`);
        return updated;
      });
      
    } catch (error) {
      reportError('Failed to add idle video.', error);
    } finally {
      setIsAddingIdleVideo(false);
    }
  };

  const handleDeleteIdleVideo = async (videoId: string) => {
    if (!characterForIdleVideoManagement) return;
    
    // Extract index from ID (format: "idle-{index}")
    const index = parseInt(videoId.split('-')[1]);
    if (isNaN(index)) return;
    
    console.log(`🗑️ Deleting idle video at index ${index}`);
    
    setDeletingIdleVideoId(videoId);
    try {
      // Get the actual database ID from the character's idle videos
      const idleVideosList = await dbService.getIdleVideos(characterForIdleVideoManagement.id);
      console.log(`  Found ${idleVideosList.length} videos in database`);
      
      if (idleVideosList[index]) {
        await dbService.deleteIdleVideo(characterForIdleVideoManagement.id, idleVideosList[index].id);
        console.log(`  ✅ Deleted from database: ${idleVideosList[index].path}`);
        
        // Update character by removing the video at this index
        applyCharacterUpdate(characterForIdleVideoManagement.id, char => {
          console.log(`  Updating character: removing video ${index} from ${char.idleVideos.length} videos`);
          return {
            ...char,
            idleVideos: char.idleVideos.filter((_, i) => i !== index)
          };
        });
        
        // Update URLs
        const urlToRevoke = idleVideoUrls[index];
        if (urlToRevoke) {
          URL.revokeObjectURL(urlToRevoke);
          console.log(`  Revoked URL for video ${index}`);
        }
        setIdleVideoUrls(prev => {
          const updated = prev.filter((_, i) => i !== index);
          console.log(`  Updated idleVideoUrls from ${prev.length} to ${updated.length}`);
          return updated;
        });
        
        // Update the management character state
        setCharacterForIdleVideoManagement(prev => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            idleVideos: prev.idleVideos.filter((_, i) => i !== index)
          };
          console.log(`  Updated management character: ${prev.idleVideos.length} -> ${updated.idleVideos.length} videos`);
          return updated;
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
    registerInteraction();

    // Cleanup old URLs
    idleVideoUrls.forEach(url => URL.revokeObjectURL(url));
    cleanupActionUrls(actionVideoUrls);

    // Create new URLs
    const newIdleVideoUrls = character.idleVideos.map(blob => URL.createObjectURL(blob));
    const newActionUrls = character.actions.reduce((map, action) => {
      map[action.id] = URL.createObjectURL(action.video);
      return map;
    }, {} as Record<string, string>);

    setIdleVideoUrls(newIdleVideoUrls);
    setActionVideoUrls(newActionUrls);
    setSelectedCharacter(character);

    // Initialize Queue
    // Add idle videos (shuffled)
    let initialQueue = shuffleArray([...newIdleVideoUrls]);
    if (initialQueue.length === 0) initialQueue = []; // Should not happen if character valid
    
    // Ensure we have enough items in queue
    while (initialQueue.length < 5 && newIdleVideoUrls.length > 0) {
        initialQueue = [...initialQueue, ...shuffleArray(newIdleVideoUrls)];
    }

    console.log(`🎬 Initializing video queue with ${initialQueue.length} videos`);
    
    // Set queue first
    setVideoQueue(initialQueue);
    
    // Set the FIRST video as current (it will start playing)
    if (initialQueue.length > 0) {
        setCurrentVideoSrc(initialQueue[0]);
        console.log(`  Set initial video (index 0)`);
    }
    
    // The useEffect will handle preloading index 1 when queue updates
    setCurrentActionId(null);
    
    try {
      const userId = getUserId();
      const savedHistory = await conversationHistoryService.loadConversationHistory(userId);
      const relationshipData = await relationshipService.getRelationship(userId);
      setRelationship(relationshipData);
      
      try {
        const session: AIChatSession = { userId, model: activeService.model }; 
        const { greeting, session: updatedSession } = await activeService.generateGreeting(
            character, session, savedHistory, relationshipData
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

  const handleBackToSelection = async () => {
    idleVideoUrls.forEach(url => URL.revokeObjectURL(url));
    setIdleVideoUrls([]);
    setVideoQueue([]);
    setCurrentVideoSrc(null);
    
    setSelectedCharacter(null);
    setChatHistory([]);
    setAiSession(null);
    setResponseAudioSrc(null);
    setView('selectCharacter');
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
      const relationshipEvent = await relationshipService.analyzeMessageSentiment(message, chatHistory, activeServiceId);
      const updatedRelationship = await relationshipService.updateRelationship(userId, relationshipEvent);
      if (updatedRelationship) setRelationship(updatedRelationship);

      const sessionToUse: AIChatSession = aiSession || { userId, characterId: selectedCharacter.id };
      
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
      setChatHistory(prev => [...prev, { role: 'model' as const, text: response.text_response }]);
      
      await conversationHistoryService.appendConversationHistory(
        userId,
        [{ role: 'user', text: message }, { role: 'model', text: response.text_response }]
      );
      setLastSavedMessageIndex(updatedHistory.length);

      if (!isMuted && audioData) {
          setResponseAudioSrc(audioData);
      }

      if (response.action_id) {
           playAction(response.action_id);
      }

    } catch (error) {
      console.error('Error:', error);
      setErrorMessage('Failed to generate response.');
    } finally {
      setIsProcessingAction(false);
    }
  };
  
  const handleVideoEnd = () => {
    console.log('📹 Video ended in App');
    console.log(`  Current queue length: ${videoQueue.length}`);
    console.log(`  Current queue: [${videoQueue.map((_, i) => i).join(', ')}]`);
    
    // Shift the queue - remove the video that just finished
    setVideoQueue(prev => {
        const newQueue = prev.slice(1);
        console.log(`  New queue length after shift: ${newQueue.length}`);
        
        // Replenish if low
        if (newQueue.length < 3 && idleVideoUrls.length > 0) {
            const replenished = [...newQueue, ...shuffleArray(idleVideoUrls)];
            console.log(`  Replenished queue to length: ${replenished.length}`);
            return replenished;
        }
        return newQueue;
    });
    
    // The useEffect will handle updating currentVideoSrc to videoQueue[1]
    // when the queue state updates
    
    setCurrentActionId(null);
  };

  // Queue Manager Effect - Updates video source when queue changes
  useEffect(() => {
      if (videoQueue.length > 1) {
          // Always preload the NEXT video (index 1)
          // Index 0 is currently playing.
          const nextSrc = videoQueue[1];
          console.log(`🎯 Queue changed, preloading next video (index 1 of ${videoQueue.length})`);
          setCurrentVideoSrc(nextSrc);
      } else if (videoQueue.length === 1) {
          // Only one video left, set it as current
          console.log(`🎯 Only 1 video in queue, setting as current`);
          setCurrentVideoSrc(videoQueue[0]);
      } else {
          console.log(`⚠️ Queue is empty!`);
      }
  }, [videoQueue]);

  // Show login if not authenticated
  if (!session || authStatus !== 'connected') {
    return <LoginPage />;
  }

  return (
    <div className="bg-gray-900 text-gray-100 h-screen overflow-hidden flex flex-col p-4 md:p-8">
      {/* Audio Player (Hidden) */}
      {responseAudioSrc && (
        <AudioPlayer 
            src={responseAudioSrc} 
            onEnded={() => setResponseAudioSrc(null)} 
        />
      )}

      <header className="text-center mb-4 relative flex-shrink-0">
        <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-600">
          Interactive Video Character
        </h1>
        <div className="absolute top-0 right-0">
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
                onDeleteCharacter={handleDeleteCharacter}
                onManageActions={handleManageActions}
                onManageIdleVideos={handleManageIdleVideos}
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

        {view === 'manageActions' && characterForActionManagement && (
            <ActionManagementView
                character={characterForActionManagement}
                actions={managedActions}
                onCreateAction={handleCreateAction}
                onUpdateAction={handleUpdateAction}
                onDeleteAction={handleDeleteAction}
                onBack={() => {
                    setCharacterForActionManagement(null);
                    setView('selectCharacter');
                }}
                isCreating={isCreatingAction}
                updatingActionId={updatingActionId}
                deletingActionId={deletingActionId}
            />
        )}

        {view === 'manageIdleVideos' && characterForIdleVideoManagement && (
            <IdleVideoManagementView
                character={characterForIdleVideoManagement}
                idleVideos={managedIdleVideos}
                onAddIdleVideo={handleAddIdleVideo}
                onDeleteIdleVideo={handleDeleteIdleVideo}
                onBack={() => {
                    setCharacterForIdleVideoManagement(null);
                    setView('selectCharacter');
                }}
                isAdding={isAddingIdleVideo}
                deletingVideoId={deletingIdleVideoId}
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
                       src={currentVideoSrc}
                       onEnded={handleVideoEnd}
                       loop={false} // Queue system handles looping/playback
                       muted={isMuted}
                     />
                  </div>
                )}
                <div className="h-full min-h-0">
                  <ChatPanel
                    history={chatHistory}
                    onSendMessage={handleSendMessage}
                    onSendAudio={handleSendAudio}
                    useAudioInput={activeServiceId === 'gemini'} 
                    isSending={isProcessingAction}
                  />
                </div>
             </div>
        )}
      </main>
    </div>
  );
};

export default App;
