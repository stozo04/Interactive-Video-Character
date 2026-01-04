import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock React hooks
let stateCounter = 0;
const stateStore: Record<number, unknown> = {};
const refStore: Record<number, { current: unknown }> = {};
let refCounter = 0;

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
    useRef: <T,>(initialValue: T): { current: T } => {
      const id = refCounter++;
      if (!(id in refStore)) {
        refStore[id] = { current: initialValue };
      }
      return refStore[id] as { current: T };
    },
  };
});

const resetMockState = () => {
  stateCounter = 0;
  refCounter = 0;
  Object.keys(stateStore).forEach(key => delete stateStore[key as unknown as number]);
  Object.keys(refStore).forEach(key => delete refStore[key as unknown as number]);
  vi.clearAllMocks();
};

// Import after mocks
import { useIdleTracking } from '../useIdleTracking';

describe('useIdleTracking', () => {
  beforeEach(() => {
    resetMockState();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-03T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should initialize lastInteractionAt to current time', () => {
      const hook = useIdleTracking();

      expect(hook.lastInteractionAt).toBe(Date.now());
    });

    it('should initialize hasInteractedRef to false', () => {
      const hook = useIdleTracking();

      expect(hook.hasInteractedRef.current).toBe(false);
    });
  });

  describe('registerInteraction', () => {
    it('should update lastInteractionAt to current time', () => {
      const hook = useIdleTracking();

      const initialTime = hook.lastInteractionAt;

      // Advance time
      vi.advanceTimersByTime(5000);

      hook.registerInteraction();

      // Re-invoke hook to get updated state
      resetMockState();
      vi.setSystemTime(new Date('2025-01-03T12:00:05Z'));
      const hook2 = useIdleTracking();
      hook2.registerInteraction();

      // Should be later than initial (in the state store)
      expect(stateStore[0]).toBe(Date.now());
    });

    it('should set hasInteractedRef to true', () => {
      const hook = useIdleTracking();

      expect(hook.hasInteractedRef.current).toBe(false);

      hook.registerInteraction();

      expect(hook.hasInteractedRef.current).toBe(true);
    });

    it('should be callable multiple times', () => {
      const hook = useIdleTracking();

      hook.registerInteraction();
      expect(hook.hasInteractedRef.current).toBe(true);

      vi.advanceTimersByTime(1000);
      hook.registerInteraction();

      expect(hook.hasInteractedRef.current).toBe(true);
      expect(stateStore[0]).toBe(Date.now());
    });
  });

  describe('getIdleTime', () => {
    it('should return 0 immediately after initialization', () => {
      const hook = useIdleTracking();

      expect(hook.getIdleTime()).toBe(0);
    });

    it('should return elapsed time since last interaction', () => {
      const hook = useIdleTracking();

      vi.advanceTimersByTime(10000); // 10 seconds

      expect(hook.getIdleTime()).toBe(10000);
    });

    it('should update lastInteractionAt after registerInteraction', () => {
      const hook = useIdleTracking();

      vi.advanceTimersByTime(10000);
      expect(hook.getIdleTime()).toBe(10000);

      hook.registerInteraction();

      // The state in stateStore should be updated to current time
      const currentTime = Date.now();
      expect(stateStore[0]).toBe(currentTime);
    });
  });

  describe('isIdle', () => {
    it('should return false when idle time is less than threshold', () => {
      const hook = useIdleTracking();

      vi.advanceTimersByTime(1000); // 1 second

      expect(hook.isIdle(5000)).toBe(false);
    });

    it('should return true when idle time equals threshold', () => {
      const hook = useIdleTracking();

      vi.advanceTimersByTime(5000);

      expect(hook.isIdle(5000)).toBe(true);
    });

    it('should return true when idle time exceeds threshold', () => {
      const hook = useIdleTracking();

      vi.advanceTimersByTime(10000);

      expect(hook.isIdle(5000)).toBe(true);
    });

    it('should use default threshold of 5 minutes if not provided', () => {
      const hook = useIdleTracking();

      // Less than 5 minutes
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(hook.isIdle()).toBe(false);

      // More than 5 minutes
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(hook.isIdle()).toBe(true);
    });
  });

  describe('exposed types', () => {
    it('should expose setLastInteractionAt setter', () => {
      const hook = useIdleTracking();

      expect(typeof hook.setLastInteractionAt).toBe('function');
    });
  });
});
