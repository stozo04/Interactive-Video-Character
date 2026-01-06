/**
 * useProactiveSettings Hook
 *
 * Manages proactive feature settings and snooze state with localStorage persistence.
 * Extracted from App.tsx as part of Phase 4A refactoring.
 *
 * @see src/hooks/useProactiveSettings.README.md for usage documentation
 */

import { useState, useCallback, Dispatch, SetStateAction } from 'react';
import type { ProactiveSettings } from '../types';

/**
 * LocalStorage keys
 */
const PROACTIVE_SETTINGS_KEY = 'kayley_proactive_settings';
const SNOOZE_INDEFINITE_KEY = 'kayley_snooze_indefinite';
const SNOOZE_UNTIL_KEY = 'kayley_snooze_until';

/**
 * Default proactive settings
 */
export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  calendar: true,
  news: true,
  checkins: true,
};

/**
 * Snooze state returned by loadSnoozeState
 */
export interface SnoozeState {
  isSnoozed: boolean;
  snoozeUntil: number | null;
}

/**
 * Return type for the useProactiveSettings hook
 */
export interface UseProactiveSettingsResult {
  /** Current proactive settings */
  proactiveSettings: ProactiveSettings;

  /** Update proactive settings (partial update) */
  updateProactiveSettings: (updates: Partial<ProactiveSettings>) => void;

  /** Whether check-ins are currently snoozed */
  isSnoozed: boolean;

  /** Setter for snoozed state */
  setIsSnoozed: Dispatch<SetStateAction<boolean>>;

  /** When the snooze expires (null for indefinite) */
  snoozeUntil: number | null;

  /** Setter for snooze until time */
  setSnoozeUntil: Dispatch<SetStateAction<number | null>>;

  /** Load snooze state from localStorage and update state */
  loadSnoozeState: () => SnoozeState;

  /** Clear snooze state and localStorage */
  clearSnooze: () => void;
}

/**
 * Hook for managing proactive settings and snooze state.
 *
 * @example
 * ```typescript
 * const {
 *   proactiveSettings,
 *   updateProactiveSettings,
 *   isSnoozed,
 *   setIsSnoozed,
 *   snoozeUntil,
 *   setSnoozeUntil,
 *   loadSnoozeState,
 *   clearSnooze,
 * } = useProactiveSettings();
 *
 * // Update a single setting
 * updateProactiveSettings({ calendar: false });
 *
 * // Load snooze state on character selection
 * const { isSnoozed, snoozeUntil } = loadSnoozeState();
 * setIsSnoozed(isSnoozed);
 * setSnoozeUntil(snoozeUntil);
 * ```
 */
export function useProactiveSettings(): UseProactiveSettingsResult {
  // Proactive settings state with localStorage persistence
  const [proactiveSettings, setProactiveSettings] = useState<ProactiveSettings>(() => {
    const stored = localStorage.getItem(PROACTIVE_SETTINGS_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_PROACTIVE_SETTINGS;
  });

  // Snooze state
  const [isSnoozed, setIsSnoozed] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);

  /**
   * Update proactive settings (partial update)
   */
  const updateProactiveSettings = useCallback((updates: Partial<ProactiveSettings>) => {
    setProactiveSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem(PROACTIVE_SETTINGS_KEY, JSON.stringify(next));
      console.log('🔧 [useProactiveSettings] Settings updated:', next);
      return next;
    });
  }, []);

  /**
   * Load snooze state from localStorage
   * Also handles expiry check and cleanup
   */
  const loadSnoozeState = useCallback((): SnoozeState => {
    const snoozeIndefinite = localStorage.getItem(SNOOZE_INDEFINITE_KEY);
    const snoozeUntilStr = localStorage.getItem(SNOOZE_UNTIL_KEY);

    if (snoozeIndefinite === 'true') {
      console.log('⏸️ [useProactiveSettings] Check-ins are snoozed indefinitely');
      setIsSnoozed(true);
      setSnoozeUntil(null);
      return { isSnoozed: true, snoozeUntil: null };
    }

    if (snoozeUntilStr) {
      const snoozeEnd = parseInt(snoozeUntilStr);
      if (Date.now() < snoozeEnd) {
        console.log('⏸️ [useProactiveSettings] Check-ins snoozed until', new Date(snoozeEnd).toLocaleTimeString());
        setIsSnoozed(true);
        setSnoozeUntil(snoozeEnd);
        return { isSnoozed: true, snoozeUntil: snoozeEnd };
      } else {
        // Snooze expired - clear
        localStorage.removeItem(SNOOZE_UNTIL_KEY);
        console.log('⏰ [useProactiveSettings] Snooze period expired (cleared on load)');
        setIsSnoozed(false);
        setSnoozeUntil(null);
        return { isSnoozed: false, snoozeUntil: null };
      }
    }

    return { isSnoozed: false, snoozeUntil: null };
  }, []);

  /**
   * Clear snooze state and localStorage
   */
  const clearSnooze = useCallback(() => {
    localStorage.removeItem(SNOOZE_UNTIL_KEY);
    localStorage.removeItem(SNOOZE_INDEFINITE_KEY);
    setIsSnoozed(false);
    setSnoozeUntil(null);
    console.log('⏰ [useProactiveSettings] Snooze cleared');
  }, []);

  return {
    proactiveSettings,
    updateProactiveSettings,
    isSnoozed,
    setIsSnoozed,
    snoozeUntil,
    setSnoozeUntil,
    loadSnoozeState,
    clearSnooze,
  };
}
