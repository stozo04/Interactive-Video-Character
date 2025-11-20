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
  const [idleVideoUrl, setIdleVideoUrl] = useState<string | null>(null);
  const [actionVideoUrls, setActionVideoUrls] = useState<Record<string, string>>(
    {}
  );
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

      // BUG FIX #1: Use the consistent placeholder text you saw
      const placeholderText = "🎤 [Audio Message]";
      
      // Add placeholder immediately
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

              // 2. Call AI Service
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
              
              // 3. Update Chat History: Replace Placeholder with Transcript + Add Response
              setChatHistory(currentHistory => {
                  const newHistory = [...currentHistory];
                  const lastIndex = newHistory.length - 1;
                  
                  // Find the placeholder we added and replace it
                  if (newHistory[lastIndex].text === placeholderText) {
                      newHistory[lastIndex] = { 
                          role: 'user', 
                          text: response.user_transcription 
                              ? `🎤 ${response.user_transcription}` 
                              : "🎤 [Audio Message]" 
                      };
                  }
                  
                  // Append the AI's text response
                  newHistory.push({ role: 'model' as const, text: response.text_response });
                  return newHistory;
              });

              // 4. Play Audio Response (if returned)
              if (!isMuted && audioData) {
                setResponseAudioSrc(audioData);
              }

              // 5. Play Action Video (if needed)
              if (response.action_id) {
                 const actionUrl = actionVideoUrls[response.action_id];
                 if (actionUrl) {
                     setCurrentVideoUrl(actionUrl);
                     setCurrentActionId(response.action_id);
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
        videoUrl: URL.createObjectURL(profile.idleVideo)
      }));
    } catch (e) {
      console.error("Error creating object URLs:", e);
      return [];
    }
  }, [characters]);

  useEffect(() => {
    return () => {
      displayCharacters.forEach(c => {
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
      };
    });
  }, [characterForActionManagement, selectedCharacter, actionVideoUrls]);

  const triggerIdleAction = useCallback(() => {
    if (!selectedCharacter) return;
    if (selectedCharacter.actions.length === 0) return;
    if (!idleVideoUrl) return;
    if (currentVideoUrl && currentVideoUrl !== idleVideoUrl) return;

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
        idleVideo: idleVideoBlob,
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
    if (!selectedCharacter) return;
    registerInteraction();
    setIsCreatingAction(true);
    try {
      const metadata = await dbService.createCharacterAction(selectedCharacter.id, {
        name: input.name,
        phrases: input.phrases,
        video: input.videoFile,
      });
      
      // Optimistic update
      const newAction = {
        id: metadata.id,
        name: metadata.name,
        phrases: metadata.phrases,
        video: input.videoFile,
        videoPath: metadata.videoPath,
        sortOrder: metadata.sortOrder ?? null,
      };
      
      applyCharacterUpdate(selectedCharacter.id, char => ({
          ...char, actions: [...char.actions, newAction]
      }));
      setActionVideoUrls(prev => ({ ...prev, [metadata.id]: URL.createObjectURL(input.videoFile) }));

    } catch (error) {
      reportError('Failed to create action.', error);
    } finally {
      setIsCreatingAction(false);
    }
  };

  const handleUpdateAction = async (actionId: string, input: any) => {
    if (!selectedCharacter) return;
    setUpdatingActionId(actionId);
    try {
        const metadata = await dbService.updateCharacterAction(selectedCharacter.id, actionId, input);
        applyCharacterUpdate(selectedCharacter.id, char => ({
            ...char, 
            actions: char.actions.map(a => a.id === actionId ? { ...a, ...metadata, video: input.videoFile || a.video } : a)
        }));
        if(input.videoFile) {
            setActionVideoUrls(prev => ({...prev, [actionId]: URL.createObjectURL(input.videoFile)}));
        }
    } catch (e) { reportError('Failed to update', e); } 
    finally { setUpdatingActionId(null); }
  };

  const handleDeleteAction = async (actionId: string) => {
    if (!selectedCharacter) return;
    setDeletingActionId(actionId);
    try {
        await dbService.deleteCharacterAction(selectedCharacter.id, actionId);
        applyCharacterUpdate(selectedCharacter.id, char => ({
            ...char, actions: char.actions.filter(a => a.id !== actionId)
        }));
    } catch(e) { reportError('Failed to delete', e); }
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

  const handleSelectCharacter = async (character: CharacterProfile) => {
    setErrorMessage(null);
    setIsLoadingCharacter(true);
    registerInteraction();

    if (idleVideoUrl) URL.revokeObjectURL(idleVideoUrl);
    cleanupActionUrls(actionVideoUrls);

    const newIdleVideoUrl = URL.createObjectURL(character.idleVideo);
    const newActionUrls = character.actions.reduce((map, action) => {
      map[action.id] = URL.createObjectURL(action.video);
      return map;
    }, {} as Record<string, string>);

    setSelectedCharacter(character);
    setIdleVideoUrl(newIdleVideoUrl);
    setActionVideoUrls(newActionUrls);
    setCurrentVideoUrl(newIdleVideoUrl);
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
                setCurrentVideoUrl(newActionUrls[greeting.action_id]);
                setCurrentActionId(greeting.action_id);
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
    setSelectedCharacter(null);
    setIdleVideoUrl(null);
    setCurrentVideoUrl(null);
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
      
      // Send Text -> Get Text (and optionally Audio if configured in service)
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

      // Play Audio (if generated for text inputs)
      if (!isMuted && audioData) {
          setResponseAudioSrc(audioData);
      }

      if (response.action_id && actionVideoUrls[response.action_id]) {
           setCurrentVideoUrl(actionVideoUrls[response.action_id]);
           setCurrentActionId(response.action_id);
      }

    } catch (error) {
      console.error('Error:', error);
      setErrorMessage('Failed to generate response.');
    } finally {
      setIsProcessingAction(false);
    }
  };
  
  const handleVideoEnd = () => {
    if (currentVideoUrl !== idleVideoUrl && idleVideoUrl) {
      setCurrentVideoUrl(idleVideoUrl);
      setCurrentActionId(null);
    }
  };

  // Show login if not authenticated
  if (!session || authStatus !== 'connected') {
    return <LoginPage />;
  }

  // BUG FIX #3: Updated classes for full screen with no growth (h-screen + overflow-hidden)
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
      
      {/* BUG FIX #3: Added min-h-0 to allow flex child (ChatPanel) to scroll internally */}
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
                       src={currentVideoUrl}
                       onEnded={handleVideoEnd}
                       loop={currentVideoUrl === idleVideoUrl}
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