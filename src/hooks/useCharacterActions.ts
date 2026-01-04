/**
 * useCharacterActions Hook
 *
 * Manages character action video playback, idle action scheduling, and action categorization.
 * Extracted from App.tsx as part of Phase 6 refactoring.
 *
 * @see src/hooks/useCharacterActions.README.md for usage documentation
 */

import { useState, useCallback, useRef, Dispatch, SetStateAction } from 'react';
import { CharacterProfile, CharacterAction } from '../types';
import { supabase } from '../services/supabaseClient';
import { shuffleArray, randomFromArray } from '../utils/arrayUtils';
import { sanitizeText } from '../utils/textUtils';

/**
 * Constants
 */
const ACTION_VIDEO_BUCKET = 'character-action-videos';
const IDLE_ACTION_DELAY_MIN_MS = 10_000;
const IDLE_ACTION_DELAY_MAX_MS = 45_000;

const TALKING_KEYWORDS = ['talk', 'talking', 'speak', 'chat', 'answer', 'respond'];

/**
 * Check if an action is a "talking" action based on name or phrases
 */
export const isTalkingAction = (action: CharacterAction): boolean => {
  const normalizedName = sanitizeText(action.name);
  if (TALKING_KEYWORDS.some(keyword => normalizedName.includes(keyword))) {
    return true;
  }
  const normalizedPhrases = action.phrases.map(sanitizeText);
  return normalizedPhrases.some(phrase =>
    TALKING_KEYWORDS.some(keyword => phrase.includes(keyword))
  );
};

/**
 * Check if an action is a "greeting" action based on name or phrases
 */
export const isGreetingAction = (action: CharacterAction): boolean => {
  const normalizedName = sanitizeText(action.name);
  const normalizedPhrases = action.phrases.map(sanitizeText);

  return (
    normalizedName.includes('greeting') ||
    normalizedPhrases.some(phrase => phrase.includes('greeting'))
  );
};

/**
 * Get greeting actions from a list
 */
export const getGreetingActions = (actions: CharacterAction[]): CharacterAction[] => {
  return actions.filter(isGreetingAction);
};

/**
 * Get non-greeting actions from a list
 */
export const getNonGreetingActions = (actions: CharacterAction[]): CharacterAction[] => {
  return actions.filter(action => !isGreetingAction(action));
};

/**
 * Get talking actions from a list
 */
export const getTalkingActions = (actions: CharacterAction[]): CharacterAction[] => {
  return actions.filter(isTalkingAction);
};

/**
 * Hook options
 */
interface UseCharacterActionsOptions {
  selectedCharacter: CharacterProfile | null;
  isProcessingAction: boolean;
  media: {
    playAction: (url: string, forceImmediate?: boolean) => void;
  };
  registerInteraction: () => void;
}

/**
 * Hook return type
 */
export interface UseCharacterActionsResult {
  /** Currently playing action ID */
  currentActionId: string | null;

  /** Setter for current action ID */
  setCurrentActionId: Dispatch<SetStateAction<string | null>>;

  /** Map of action IDs to video URLs */
  actionVideoUrls: Record<string, string>;

  /** Setter for action video URLs */
  setActionVideoUrls: Dispatch<SetStateAction<Record<string, string>>>;

  /** Play a specific action by ID */
  playAction: (actionId: string, forceImmediate?: boolean) => boolean;

  /** Play a random talking action */
  playRandomTalkingAction: (forceImmediate?: boolean) => string | null;

  /** Trigger an idle action immediately */
  triggerIdleAction: () => void;

  /** Schedule an idle action after random delay */
  scheduleIdleAction: () => void;

  /** Clear the scheduled idle action timer */
  clearIdleActionTimer: () => void;

  /** Check if an action ID is a talking action */
  isTalkingActionId: (actionId: string) => boolean;

  /** Get all talking actions for the character */
  getTalkingActions: () => CharacterAction[];

  /** Get all non-greeting actions for the character */
  getNonGreetingActions: () => CharacterAction[];

  /** Get all greeting actions for the character */
  getGreetingActions: () => CharacterAction[];
}

/**
 * Hook for managing character action video playback.
 */
export function useCharacterActions(options: UseCharacterActionsOptions): UseCharacterActionsResult {
  const { selectedCharacter, isProcessingAction, media, registerInteraction } = options;

  // State
  const [currentActionId, setCurrentActionId] = useState<string | null>(null);
  const [actionVideoUrls, setActionVideoUrls] = useState<Record<string, string>>({});

  // Refs
  const idleActionTimerRef = useRef<number | null>(null);

  /**
   * Get the URL for an action (from cache or Supabase)
   */
  const getActionUrl = useCallback((actionId: string): string | null => {
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

    return actionUrl;
  }, [actionVideoUrls, selectedCharacter]);

  /**
   * Play a specific action by ID
   */
  const playAction = useCallback((actionId: string, forceImmediate = false): boolean => {
    const actionUrl = getActionUrl(actionId);
    if (!actionUrl) return false;

    media.playAction(actionUrl, forceImmediate);
    setCurrentActionId(actionId);
    return true;
  }, [getActionUrl, media]);

  /**
   * Check if an action ID is a talking action
   */
  const isTalkingActionIdFn = useCallback((actionId: string): boolean => {
    const action = selectedCharacter?.actions.find(a => a.id === actionId);
    return action ? isTalkingAction(action) : false;
  }, [selectedCharacter]);

  /**
   * Get talking actions for the current character
   */
  const getTalkingActionsFn = useCallback((): CharacterAction[] => {
    if (!selectedCharacter) return [];
    return selectedCharacter.actions.filter(isTalkingAction);
  }, [selectedCharacter]);

  /**
   * Get non-greeting actions for the current character
   */
  const getNonGreetingActionsFn = useCallback((): CharacterAction[] => {
    if (!selectedCharacter) return [];
    return selectedCharacter.actions.filter(action => !isGreetingAction(action));
  }, [selectedCharacter]);

  /**
   * Get greeting actions for the current character
   */
  const getGreetingActionsFn = useCallback((): CharacterAction[] => {
    if (!selectedCharacter) return [];
    return selectedCharacter.actions.filter(isGreetingAction);
  }, [selectedCharacter]);

  /**
   * Play a random talking action
   */
  const playRandomTalkingAction = useCallback((forceImmediate = true): string | null => {
    if (!selectedCharacter) return null;

    const talkingActions = shuffleArray(getTalkingActionsFn());
    for (const action of talkingActions) {
      const played = playAction(action.id, forceImmediate);
      if (played) {
        return action.id;
      }
    }

    return null;
  }, [selectedCharacter, getTalkingActionsFn, playAction]);

  /**
   * Clear the idle action timer
   */
  const clearIdleActionTimer = useCallback(() => {
    if (idleActionTimerRef.current !== null) {
      clearTimeout(idleActionTimerRef.current);
      idleActionTimerRef.current = null;
    }
  }, []);

  /**
   * Trigger an idle action immediately
   */
  const triggerIdleAction = useCallback(() => {
    if (!selectedCharacter) return;
    if (selectedCharacter.actions.length === 0) return;

    const nonGreetingActions = getNonGreetingActionsFn();
    if (nonGreetingActions.length === 0) return;

    const action = randomFromArray(nonGreetingActions);

    // Get the URL
    let actionUrl = actionVideoUrls[action.id] ?? null;
    if (!actionUrl && action.videoPath) {
      const { data } = supabase.storage
        .from(ACTION_VIDEO_BUCKET)
        .getPublicUrl(action.videoPath);
      actionUrl = data?.publicUrl ?? null;
    }

    if (actionUrl) {
      media.playAction(actionUrl);
      setCurrentActionId(action.id);
      registerInteraction();
    }
  }, [selectedCharacter, getNonGreetingActionsFn, actionVideoUrls, media, registerInteraction]);

  /**
   * Schedule an idle action after a random delay
   */
  const scheduleIdleAction = useCallback(() => {
    clearIdleActionTimer();

    if (!selectedCharacter) return;
    if (selectedCharacter.actions.length === 0) return;
    if (isProcessingAction) return;

    const delay =
      Math.floor(
        Math.random() *
          (IDLE_ACTION_DELAY_MAX_MS - IDLE_ACTION_DELAY_MIN_MS + 1)
      ) + IDLE_ACTION_DELAY_MIN_MS;

    idleActionTimerRef.current = setTimeout(() => {
      triggerIdleAction();
    }, delay) as unknown as number;
  }, [clearIdleActionTimer, selectedCharacter, isProcessingAction, triggerIdleAction]);

  return {
    currentActionId,
    setCurrentActionId,
    actionVideoUrls,
    setActionVideoUrls,
    playAction,
    playRandomTalkingAction,
    triggerIdleAction,
    scheduleIdleAction,
    clearIdleActionTimer,
    isTalkingActionId: isTalkingActionIdFn,
    getTalkingActions: getTalkingActionsFn,
    getNonGreetingActions: getNonGreetingActionsFn,
    getGreetingActions: getGreetingActionsFn,
  };
}
