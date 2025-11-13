
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChatMessage,
  UploadedImage,
  CharacterProfile,
  CharacterAction,
} from './types';
import * as dbService from './services/cacheService';
import { supabase } from './services/supabaseClient';
import * as mockChatService from './services/mockChatService';

import ImageUploader from './components/ImageUploader';
import VideoPlayer from './components/VideoPlayer';
import ChatPanel from './components/ChatPanel';
import CharacterSelector from './components/CharacterSelector';
import LoadingSpinner from './components/LoadingSpinner';
import ActionManager from './components/ActionManager';

const sanitizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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
  const normalizedMessage = sanitizeText(message);
  if (!normalizedMessage) return null;

  const candidates: CharacterProfile['actions'] = [];

  for (const action of actions) {
    const terms = buildActionTerms(action);
    if (
      terms.some(
        (term) =>
          term === normalizedMessage ||
          normalizedMessage.includes(term) ||
          term.includes(normalizedMessage)
      )
    ) {
      candidates.push(action);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return randomFromArray(candidates);
};

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

const App: React.FC = () => {
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
    
    // Generate personalized greeting using mock ChatGPT
    const greeting = await mockChatService.generateGreeting(character);
    setChatHistory([{ role: 'model', text: greeting }]);
    setView('chat');

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

  const handleBackToSelection = () => {
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
    setUploadedImage(null);
    setErrorMessage(null);
    setView('selectCharacter');
    setIsCreatingAction(false);
    setUpdatingActionId(null);
    setDeletingActionId(null);
    setIsActionManagerOpen(false);
  };

  const handleSendMessage = async (message: string) => {
    if (!selectedCharacter) return;

    registerInteraction();
    setErrorMessage(null);
    setChatHistory((prev) => [...prev, { role: 'user', text: message }]);
    setIsProcessingAction(true);

    try {
      const matchingAction = findMatchingAction(
        message,
        selectedCharacter.actions
      );

      // Generate response from mock ChatGPT service
      const response = await mockChatService.generateMockResponse(message, {
        character: selectedCharacter,
        matchingAction,
        chatHistory,
      });

      // If action was matched, play it
      if (matchingAction) {
        const actionUrl = actionVideoUrls[matchingAction.id];
        if (!actionUrl) {
          // Fallback to Supabase URL if local URL not available
          if (matchingAction.videoPath) {
            const { data } = supabase.storage
              .from(ACTION_VIDEO_BUCKET)
              .getPublicUrl(matchingAction.videoPath);
            const fallbackUrl = data?.publicUrl ?? null;
            if (fallbackUrl) {
              setCurrentVideoUrl(fallbackUrl);
              setCurrentActionId(matchingAction.id);
            }
          }
        } else {
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
          setCurrentActionId(matchingAction.id);
        }
      }

      // Add the generated response to chat
      setChatHistory((prev) => [
        ...prev,
        { role: 'model', text: response },
      ]);
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
              <div className="relative grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-5 gap-8 h-full">
                <button 
                  onClick={handleBackToSelection} 
                  className="absolute top-2 left-2 z-30 bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2 transition-colors"
                  aria-label="Back to character selection"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
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
                <div className="h-full xl:col-span-2">
                  <ChatPanel
                    history={chatHistory}
                    onSendMessage={handleSendMessage}
                    isSending={isBusy}
                  />
                </div>
                <div className="lg:col-span-2 xl:col-span-1 h-full flex flex-col gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      registerInteraction();
                      setIsActionManagerOpen((previous) => !previous);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-700 text-white px-4 py-2 hover:bg-gray-600 transition-colors self-end shadow"
                  >
                    {isActionManagerOpen ? 'Hide Actions' : 'Show Actions'}
                  </button>
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

  return (
    <div className="bg-gray-900 text-gray-100 min-h-screen flex flex-col p-4 md:p-8">
      <header className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-600">
          Interactive Video Character
        </h1>
        <p className="text-gray-400 mt-2">
          Play pre-recorded character animations stored in Supabase.
        </p>
      </header>
      <main className="flex-grow bg-gray-800/50 rounded-2xl p-4 md:p-6 shadow-2xl shadow-black/30 backdrop-blur-sm border border-gray-700">
        {errorMessage && <div className="bg-red-500/20 border border-red-500 text-red-300 p-3 rounded-lg mb-4 text-center">{errorMessage}</div>}
        {renderContent()}
      </main>
    </div>
  );
};

export default App;
