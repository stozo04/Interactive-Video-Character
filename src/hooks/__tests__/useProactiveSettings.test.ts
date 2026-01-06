import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProactiveSettings } from '../../types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Mock React hooks
let stateCounter = 0;
const stateStore: Record<number, unknown> = {};

vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual as object,
    useState: <T,>(initialValue: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void] => {
      const id = stateCounter++;
      if (!(id in stateStore)) {
        // Handle lazy initialization
        stateStore[id] = typeof initialValue === 'function'
          ? (initialValue as () => T)()
          : initialValue;
      }
      const setter = (val: T | ((prev: T) => T)) => {
        stateStore[id] = typeof val === 'function'
          ? (val as (prev: T) => T)(stateStore[id] as T)
          : val;
      };
      return [stateStore[id] as T, setter];
    },
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  };
});

const resetMockState = () => {
  stateCounter = 0;
  Object.keys(stateStore).forEach(key => delete stateStore[key as unknown as number]);
  localStorageMock.clear();
  vi.clearAllMocks();
};

// Import after mocks
import { useProactiveSettings, DEFAULT_PROACTIVE_SETTINGS } from '../useProactiveSettings';

describe('useProactiveSettings', () => {
  beforeEach(() => {
    resetMockState();
  });

  describe('initial state', () => {
    it('should return default proactive settings when no stored value', () => {
      const hook = useProactiveSettings();

      expect(hook.proactiveSettings).toEqual(DEFAULT_PROACTIVE_SETTINGS);
    });

    it('should load stored proactive settings from localStorage', () => {
      const storedSettings: ProactiveSettings = {
        calendar: false,
        news: false,
        checkins: true,
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(storedSettings));

      resetMockState();
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(storedSettings));

      const hook = useProactiveSettings();

      expect(hook.proactiveSettings).toEqual(storedSettings);
    });

    it('should expose isSnoozed as false initially', () => {
      const hook = useProactiveSettings();

      expect(hook.isSnoozed).toBe(false);
    });

    it('should expose snoozeUntil as null initially', () => {
      const hook = useProactiveSettings();

      expect(hook.snoozeUntil).toBeNull();
    });
  });

  describe('updateProactiveSettings', () => {
    it('should persist settings to localStorage when updating', () => {
      const hook = useProactiveSettings();

      hook.updateProactiveSettings({ calendar: false });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'kayley_proactive_settings',
        expect.any(String)
      );

      // Verify the stored value contains our update
      const storedValue = localStorageMock.setItem.mock.calls[0][1];
      const parsed = JSON.parse(storedValue);
      expect(parsed.calendar).toBe(false);
    });

    it('should merge with existing settings', () => {
      const hook = useProactiveSettings();

      hook.updateProactiveSettings({ news: false });

      const storedValue = localStorageMock.setItem.mock.calls[0][1];
      const parsed = JSON.parse(storedValue);

      // Should have all other defaults plus our update
      expect(parsed.news).toBe(false);
      expect(parsed.calendar).toBe(true); // default preserved
      expect(parsed.checkins).toBe(true); // default preserved
    });
  });

  describe('snooze functions', () => {
    it('should expose setIsSnoozed function', () => {
      const hook = useProactiveSettings();

      expect(typeof hook.setIsSnoozed).toBe('function');
    });

    it('should expose setSnoozeUntil function', () => {
      const hook = useProactiveSettings();

      expect(typeof hook.setSnoozeUntil).toBe('function');
    });
  });

  describe('loadSnoozeState', () => {
    it('should return snooze state object with isSnoozed and snoozeUntil', () => {
      const hook = useProactiveSettings();
      const result = hook.loadSnoozeState();

      expect(result).toHaveProperty('isSnoozed');
      expect(result).toHaveProperty('snoozeUntil');
      expect(typeof result.isSnoozed).toBe('boolean');
    });

    it('should detect indefinite snooze', () => {
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'kayley_snooze_indefinite') return 'true';
        return null;
      });

      const hook = useProactiveSettings();
      const result = hook.loadSnoozeState();

      expect(result.isSnoozed).toBe(true);
      expect(result.snoozeUntil).toBeNull();
    });

    it('should detect timed snooze that is still active', () => {
      const futureTime = Date.now() + 3600000; // 1 hour from now
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'kayley_snooze_until') return futureTime.toString();
        return null;
      });

      const hook = useProactiveSettings();
      const result = hook.loadSnoozeState();

      expect(result.isSnoozed).toBe(true);
      expect(result.snoozeUntil).toBe(futureTime);
    });

    it('should clear expired snooze', () => {
      const pastTime = Date.now() - 3600000; // 1 hour ago
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'kayley_snooze_until') return pastTime.toString();
        return null;
      });

      const hook = useProactiveSettings();
      const result = hook.loadSnoozeState();

      expect(result.isSnoozed).toBe(false);
      expect(result.snoozeUntil).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('kayley_snooze_until');
    });
  });

  describe('clearSnooze', () => {
    it('should clear snooze state', () => {
      const hook = useProactiveSettings();

      hook.clearSnooze();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('kayley_snooze_until');
    });
  });
});
