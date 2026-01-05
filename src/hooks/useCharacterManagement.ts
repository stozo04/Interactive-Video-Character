/**
 * useCharacterManagement Hook
 *
 * Manages character CRUD operations, action management, and idle video management.
 * Extracted from App.tsx as part of Phase 7 refactoring.
 *
 * @see src/hooks/useCharacterManagement.README.md for usage documentation
 */

import React, { useState, useCallback } from 'react';
import { CharacterProfile, CharacterAction, UploadedImage } from '../types';
import * as dbService from '../services/cacheService';
import { supabase } from '../services/supabaseClient';
import { shuffleArray } from '../utils/arrayUtils';

/**
 * Constants
 */
const CHARACTER_VIDEOS_BUCKET = 'character-videos';

/**
 * Hook options
 */
interface UseCharacterManagementOptions {
  /** List of all characters */
  characters: CharacterProfile[];
  /** Setter for characters list */
  setCharacters: React.Dispatch<React.SetStateAction<CharacterProfile[]>>;
  /** Currently selected character for chat */
  selectedCharacter: CharacterProfile | null;
  /** Setter for selected character */
  setSelectedCharacter: React.Dispatch<React.SetStateAction<CharacterProfile | null>>;
  /** Character being managed (in management view) */
  characterForManagement: CharacterProfile | null;
  /** Setter for character being managed */
  setCharacterForManagement: React.Dispatch<React.SetStateAction<CharacterProfile | null>>;
  /** Map of action IDs to video URLs */
  actionVideoUrls: Record<string, string>;
  /** Setter for action video URLs */
  setActionVideoUrls: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Setter for current view */
  setView: (view: 'loading' | 'selectCharacter' | 'createCharacter' | 'chat' | 'manageCharacter' | 'whiteboard') => void;
  /** Error reporting function */
  reportError: (message: string, error?: unknown) => void;
  /** Register user interaction (for idle tracking) */
  registerInteraction: () => void;
  /** Media hook for video queue management */
  media: {
    setVideoQueue: React.Dispatch<React.SetStateAction<string[]>>;
    setAudioQueue?: React.Dispatch<React.SetStateAction<string[]>>;
  };
}

/**
 * Hook return type
 */
export interface UseCharacterManagementResult {
  // Loading states
  isSavingCharacter: boolean;
  isCreatingAction: boolean;
  updatingActionId: string | null;
  deletingActionId: string | null;
  isAddingIdleVideo: boolean;
  deletingIdleVideoId: string | null;
  isUpdatingImage: boolean;
  setIsUpdatingImage: React.Dispatch<React.SetStateAction<boolean>>;

  // Image upload state
  uploadedImage: UploadedImage | null;
  setUploadedImage: React.Dispatch<React.SetStateAction<UploadedImage | null>>;

  // Character handlers
  handleImageUpload: (image: UploadedImage) => void;
  handleCharacterCreated: (image: UploadedImage, idleVideoBlob: Blob) => Promise<void>;
  handleSelectLocalVideo: (videoFile: File) => Promise<void>;
  handleManageCharacter: (character: CharacterProfile) => void;
  handleDeleteCharacter: (id: string) => Promise<void>;
  handleBackToSelection: () => void;

  // Action handlers
  handleCreateAction: (input: { name: string; phrases: string[]; videoFile: File }) => Promise<void>;
  handleUpdateAction: (actionId: string, input: { name?: string; phrases?: string[]; videoFile?: File }) => Promise<void>;
  handleDeleteAction: (actionId: string) => Promise<void>;

  // Idle video handlers
  handleAddIdleVideo: (videoFile: File) => Promise<void>;
  handleDeleteIdleVideo: (videoId: string) => Promise<void>;

  // Utility functions
  applyCharacterUpdate: (characterId: string, updater: (char: CharacterProfile) => CharacterProfile) => void;
  cleanupActionUrls: (urls: Record<string, string>) => void;
}

/**
 * Hook for managing character CRUD operations.
 */
export function useCharacterManagement(options: UseCharacterManagementOptions): UseCharacterManagementResult {
  const {
    characters,
    setCharacters,
    selectedCharacter,
    setSelectedCharacter,
    characterForManagement,
    setCharacterForManagement,
    actionVideoUrls,
    setActionVideoUrls,
    setView,
    reportError,
    registerInteraction,
    media,
  } = options;

  // Loading states
  const [isSavingCharacter, setIsSavingCharacter] = useState(false);
  const [isCreatingAction, setIsCreatingAction] = useState(false);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);
  const [deletingActionId, setDeletingActionId] = useState<string | null>(null);
  const [isAddingIdleVideo, setIsAddingIdleVideo] = useState(false);
  const [deletingIdleVideoId, setDeletingIdleVideoId] = useState<string | null>(null);
  const [isUpdatingImage, setIsUpdatingImage] = useState(false);

  // Image upload state
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);

  /**
   * Cleanup action video URLs (revoke blob URLs)
   */
  const cleanupActionUrls = useCallback((urls: Record<string, string>) => {
    Object.values(urls).forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        console.warn('Failed to revoke action video URL', error);
      }
    });
  }, []);

  /**
   * Apply an update to a character in both the characters list and selected character
   */
  const applyCharacterUpdate = useCallback(
    (characterId: string, updater: (character: CharacterProfile) => CharacterProfile) => {
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
    [setCharacters, setSelectedCharacter]
  );

  /**
   * Handle image upload for character creation
   */
  const handleImageUpload = useCallback((image: UploadedImage) => {
    setUploadedImage(image);
  }, []);

  /**
   * Handle character creation
   */
  const handleCharacterCreated = useCallback(async (
    image: UploadedImage,
    idleVideoBlob: Blob
  ) => {
    registerInteraction();
    setIsSavingCharacter(true);

    try {
      const imageHash = await dbService.hashImage(image.base64);
      const existingChar = characters.find((c) => c.id === imageHash);

      if (existingChar) {
        alert('Character exists. Loading...');
        // Note: handleSelectCharacter is complex and stays in App.tsx
        // The caller should handle this case
        setIsSavingCharacter(false);
        return;
      }

      const newCharacter: CharacterProfile = {
        id: imageHash,
        createdAt: Date.now(),
        image,
        idleVideoUrls: [],
        actions: [],
        name: 'Kayley Adams',
        displayName: 'Kayley',
      };

      await dbService.saveCharacter(newCharacter, idleVideoBlob);

      // Reload character to get the public URL
      const savedChars = await dbService.getCharacters();
      const savedChar = savedChars.find(c => c.id === imageHash);

      if (savedChar) {
        setCharacters((prev) => [savedChar, ...prev]);
        // Note: Caller should handle selecting the character
      }
    } catch (error) {
      reportError('Failed to save character.', error);
    } finally {
      setIsSavingCharacter(false);
    }
  }, [registerInteraction, characters, setCharacters, reportError]);

  /**
   * Handle selecting a local video file for character creation
   */
  const handleSelectLocalVideo = useCallback(async (videoFile: File) => {
    if (!uploadedImage) {
      reportError('Upload an image first.');
      return;
    }
    await handleCharacterCreated(uploadedImage, videoFile);
  }, [uploadedImage, handleCharacterCreated, reportError]);

  /**
   * Handle entering character management view
   */
  const handleManageCharacter = useCallback((character: CharacterProfile) => {
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
  }, [registerInteraction, actionVideoUrls, setActionVideoUrls, setCharacterForManagement, setView]);

  /**
   * Handle creating a new action
   */
  const handleCreateAction = useCallback(async (input: { name: string; phrases: string[]; videoFile: File }) => {
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

      const newAction: CharacterAction = {
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
          actions: [...char.actions, newAction],
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
            actions: [...prev.actions, newAction],
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
  }, [characterForManagement, selectedCharacter, registerInteraction, applyCharacterUpdate, setActionVideoUrls, setCharacterForManagement, reportError]);

  /**
   * Handle updating an action
   */
  const handleUpdateAction = useCallback(async (actionId: string, input: { name?: string; phrases?: string[]; videoFile?: File }) => {
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
        actions: char.actions.map(a =>
          a.id === actionId ? { ...a, ...metadata, video: input.videoFile || a.video } : a
        ),
      }));

      // Update URL if new video provided
      if (input.videoFile) {
        const newUrl = URL.createObjectURL(input.videoFile);
        setActionVideoUrls(prev => ({ ...prev, [actionId]: newUrl }));
        console.log(`  Created new URL for updated video`);
      }

      // Update the management character state if we're in management view
      if (characterForManagement) {
        setCharacterForManagement(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            actions: prev.actions.map(a =>
              a.id === actionId ? { ...a, ...metadata, video: input.videoFile || a.video } : a
            ),
          };
        });
        console.log(`  Updated management character`);
      }
    } catch (error) {
      reportError('Failed to update', error);
      console.error('Action update error:', error);
    } finally {
      setUpdatingActionId(null);
    }
  }, [characterForManagement, selectedCharacter, applyCharacterUpdate, setActionVideoUrls, setCharacterForManagement, reportError]);

  /**
   * Handle deleting an action
   */
  const handleDeleteAction = useCallback(async (actionId: string) => {
    const character = characterForManagement || selectedCharacter;
    if (!character) return;

    console.log(`🗑️ Deleting action "${actionId}" for ${character.displayName}`);

    setDeletingActionId(actionId);

    try {
      await dbService.deleteCharacterAction(character.id, actionId);
      console.log(`✅ Deleted action from database`);

      // Update global character list
      applyCharacterUpdate(character.id, char => ({
        ...char,
        actions: char.actions.filter(a => a.id !== actionId),
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
            actions: prev.actions.filter(a => a.id !== actionId),
          };
          console.log(`  Updated management character: ${prev.actions.length} -> ${updated.actions.length} actions`);
          return updated;
        });
      }
    } catch (error) {
      reportError('Failed to delete', error);
      console.error('Action delete error:', error);
    } finally {
      setDeletingActionId(null);
    }
  }, [characterForManagement, selectedCharacter, applyCharacterUpdate, actionVideoUrls, media, setCharacterForManagement, reportError]);

  /**
   * Handle adding an idle video
   */
  const handleAddIdleVideo = useCallback(async (videoFile: File) => {
    if (!characterForManagement) return;

    setIsAddingIdleVideo(true);

    try {
      const videoId = await dbService.addIdleVideo(characterForManagement.id, videoFile);

      // Get the public URL for the newly added video
      const idleVideosList = await dbService.getIdleVideos(characterForManagement.id);
      const newVideo = idleVideosList.find(v => v.id === videoId);

      if (newVideo) {
        const { data: urlData } = supabase.storage
          .from(CHARACTER_VIDEOS_BUCKET)
          .getPublicUrl(newVideo.path);

        const newUrl = urlData.publicUrl;

        // Update character with new video URL
        applyCharacterUpdate(characterForManagement.id, char => ({
          ...char,
          idleVideoUrls: [...char.idleVideoUrls, newUrl],
        }));

        // Update the management character state
        setCharacterForManagement(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            idleVideoUrls: [...prev.idleVideoUrls, newUrl],
          };
        });
      }
    } catch (error) {
      reportError('Failed to add idle video.', error);
    } finally {
      setIsAddingIdleVideo(false);
    }
  }, [characterForManagement, applyCharacterUpdate, setCharacterForManagement, reportError]);

  /**
   * Handle deleting an idle video
   */
  const handleDeleteIdleVideo = useCallback(async (videoId: string) => {
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
        applyCharacterUpdate(characterForManagement.id, char => ({
          ...char,
          idleVideoUrls: char.idleVideoUrls.filter((_, i) => i !== index),
        }));

        // Update the management character state
        setCharacterForManagement(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            idleVideoUrls: prev.idleVideoUrls.filter((_, i) => i !== index),
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
  }, [characterForManagement, applyCharacterUpdate, setCharacterForManagement, media, reportError]);

  /**
   * Handle deleting a character
   */
  const handleDeleteCharacter = useCallback(async (id: string) => {
    // Use globalThis for test compatibility (window may not exist in Node)
    const confirmFn = typeof window !== 'undefined' ? window.confirm : globalThis.confirm;
    if (!confirmFn?.('Delete character?')) return;

    // If deleting the selected character, go back to selection first
    if (selectedCharacter?.id === id) {
      media.setVideoQueue([]);
      if (media.setAudioQueue) {
        media.setAudioQueue([]);
      }
      setSelectedCharacter(null);
      setView('selectCharacter');
    }

    await dbService.deleteCharacter(id);
    setCharacters(prev => prev.filter(c => c.id !== id));
  }, [selectedCharacter, setSelectedCharacter, setCharacters, setView, media]);

  /**
   * Handle returning to character selection
   */
  const handleBackToSelection = useCallback(() => {
    // Clear video queue
    media.setVideoQueue([]);

    // Clear audio queue if available
    if (media.setAudioQueue) {
      media.setAudioQueue([]);
    }

    setSelectedCharacter(null);
    setView('selectCharacter');
  }, [media, setSelectedCharacter, setView]);

  return {
    // Loading states
    isSavingCharacter,
    isCreatingAction,
    updatingActionId,
    deletingActionId,
    isAddingIdleVideo,
    deletingIdleVideoId,
    isUpdatingImage,
    setIsUpdatingImage,

    // Image upload state
    uploadedImage,
    setUploadedImage,

    // Character handlers
    handleImageUpload,
    handleCharacterCreated,
    handleSelectLocalVideo,
    handleManageCharacter,
    handleDeleteCharacter,
    handleBackToSelection,

    // Action handlers
    handleCreateAction,
    handleUpdateAction,
    handleDeleteAction,

    // Idle video handlers
    handleAddIdleVideo,
    handleDeleteIdleVideo,

    // Utility functions
    applyCharacterUpdate,
    cleanupActionUrls,
  };
}
