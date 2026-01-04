/**
 * useIdleTracking Hook
 *
 * Manages user idle state tracking for triggering proactive behaviors.
 * Extracted from App.tsx as part of Phase 4B refactoring.
 *
 * @see src/hooks/useIdleTracking.README.md for usage documentation
 */

import { useState, useCallback, useRef, Dispatch, SetStateAction, MutableRefObject } from 'react';

/**
 * Default idle threshold (5 minutes in milliseconds)
 */
const DEFAULT_IDLE_THRESHOLD = 5 * 60 * 1000;

/**
 * Return type for the useIdleTracking hook
 */
export interface UseIdleTrackingResult {
  /** Timestamp of the last user interaction */
  lastInteractionAt: number;

  /** Setter for last interaction timestamp */
  setLastInteractionAt: Dispatch<SetStateAction<number>>;

  /** Ref tracking whether user has ever interacted */
  hasInteractedRef: MutableRefObject<boolean>;

  /** Record a user interaction (updates timestamp and sets hasInteracted) */
  registerInteraction: () => void;

  /** Get the time elapsed since last interaction (in milliseconds) */
  getIdleTime: () => number;

  /** Check if user is idle (time since last interaction >= threshold) */
  isIdle: (thresholdMs?: number) => boolean;
}

/**
 * Hook for tracking user idle state.
 *
 * @example
 * ```typescript
 * const {
 *   lastInteractionAt,
 *   hasInteractedRef,
 *   registerInteraction,
 *   getIdleTime,
 *   isIdle,
 * } = useIdleTracking();
 *
 * // Record an interaction on user activity
 * const handleClick = () => {
 *   registerInteraction();
 *   // ... handle click
 * };
 *
 * // Check if user is idle (default 5 min threshold)
 * if (isIdle()) {
 *   triggerIdleBreaker();
 * }
 *
 * // Check with custom threshold (10 seconds)
 * if (isIdle(10000)) {
 *   showIdlePrompt();
 * }
 * ```
 */
export function useIdleTracking(): UseIdleTrackingResult {
  // Last interaction timestamp (initialized to now)
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now());

  // Track whether user has ever interacted (avoids stale closure issues)
  const hasInteractedRef = useRef(false);

  /**
   * Record a user interaction
   */
  const registerInteraction = useCallback(() => {
    setLastInteractionAt(Date.now());
    hasInteractedRef.current = true;
  }, []);

  /**
   * Get time elapsed since last interaction (in milliseconds)
   */
  const getIdleTime = useCallback(() => {
    return Date.now() - lastInteractionAt;
  }, [lastInteractionAt]);

  /**
   * Check if user is idle based on threshold
   * @param thresholdMs - Idle threshold in milliseconds (default: 5 minutes)
   */
  const isIdle = useCallback((thresholdMs: number = DEFAULT_IDLE_THRESHOLD) => {
    return getIdleTime() >= thresholdMs;
  }, [getIdleTime]);

  return {
    lastInteractionAt,
    setLastInteractionAt,
    hasInteractedRef,
    registerInteraction,
    getIdleTime,
    isIdle,
  };
}
