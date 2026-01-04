import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CharacterAction, CharacterProfile } from '../../types';

// Mock supabase
vi.mock('../../services/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://storage.example.com/${path}` }
        })
      })
    }
  }
}));

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
import { useCharacterActions, isTalkingAction, isGreetingAction } from '../useCharacterActions';

// Test data
const createMockAction = (overrides: Partial<CharacterAction> = {}): CharacterAction => ({
  id: 'action-1',
  name: 'Test Action',
  video: new Blob(),
  phrases: ['test phrase'],
  videoPath: 'actions/test.mp4',
  ...overrides
});

const createMockCharacter = (actions: CharacterAction[] = []): CharacterProfile => ({
  id: 'char-1',
  name: 'Test Character',
  idleVideoUrls: ['idle-1.mp4'],
  actions,
  profileImage: new Blob(),
});

describe('useCharacterActions', () => {
  let mockMedia: { playAction: ReturnType<typeof vi.fn> };
  let mockRegisterInteraction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetMockState();
    vi.useFakeTimers();
    mockMedia = { playAction: vi.fn() };
    mockRegisterInteraction = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should initialize with null currentActionId', () => {
      const hook = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      expect(hook.currentActionId).toBeNull();
    });

    it('should initialize with empty actionVideoUrls', () => {
      const hook = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      expect(hook.actionVideoUrls).toEqual({});
    });
  });

  describe('playAction', () => {
    it('should return false when action URL not found', () => {
      const hook = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      const result = hook.playAction('nonexistent-action');

      expect(result).toBe(false);
      expect(mockMedia.playAction).not.toHaveBeenCalled();
    });

    it('should play action when URL is in actionVideoUrls', () => {
      const hook = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      // Set action URL
      hook.setActionVideoUrls({ 'action-1': 'https://example.com/video.mp4' });

      // Reset counter to get fresh hook state
      stateCounter = 0;
      refCounter = 0;

      const hook2 = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      const result = hook2.playAction('action-1');

      expect(result).toBe(true);
      expect(mockMedia.playAction).toHaveBeenCalledWith('https://example.com/video.mp4', false);
    });

    it('should fallback to public URL from videoPath', () => {
      const action = createMockAction({ id: 'action-2', videoPath: 'actions/video2.mp4' });
      const character = createMockCharacter([action]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      const result = hook.playAction('action-2');

      expect(result).toBe(true);
      expect(mockMedia.playAction).toHaveBeenCalledWith(
        'https://storage.example.com/actions/video2.mp4',
        false
      );
    });

    it('should pass forceImmediate parameter', () => {
      const action = createMockAction();
      const character = createMockCharacter([action]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      hook.playAction('action-1', true);

      expect(mockMedia.playAction).toHaveBeenCalledWith(
        expect.any(String),
        true
      );
    });
  });

  describe('isTalkingActionId', () => {
    it('should return true for talking action', () => {
      const action = createMockAction({ name: 'Talking Animation' });
      const character = createMockCharacter([action]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      expect(hook.isTalkingActionId('action-1')).toBe(true);
    });

    it('should return false for non-talking action', () => {
      const action = createMockAction({ name: 'Wave Hello' });
      const character = createMockCharacter([action]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      expect(hook.isTalkingActionId('action-1')).toBe(false);
    });

    it('should return false for unknown action', () => {
      const hook = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      expect(hook.isTalkingActionId('unknown')).toBe(false);
    });
  });

  describe('getTalkingActions', () => {
    it('should return only talking actions', () => {
      const talkAction = createMockAction({ id: 'talk', name: 'Talking' });
      const waveAction = createMockAction({ id: 'wave', name: 'Wave' });
      const character = createMockCharacter([talkAction, waveAction]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      const result = hook.getTalkingActions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('talk');
    });

    it('should return empty array when no character', () => {
      const hook = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      expect(hook.getTalkingActions()).toEqual([]);
    });
  });

  describe('getGreetingActions', () => {
    it('should return only greeting actions', () => {
      const greetAction = createMockAction({ id: 'greet', name: 'Greeting Wave' });
      const talkAction = createMockAction({ id: 'talk', name: 'Talking' });
      const character = createMockCharacter([greetAction, talkAction]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      const result = hook.getGreetingActions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('greet');
    });
  });

  describe('getNonGreetingActions', () => {
    it('should exclude greeting actions', () => {
      const greetAction = createMockAction({ id: 'greet', name: 'Greeting' });
      const talkAction = createMockAction({ id: 'talk', name: 'Talking' });
      const character = createMockCharacter([greetAction, talkAction]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      const result = hook.getNonGreetingActions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('talk');
    });
  });

  describe('clearIdleActionTimer', () => {
    it('should not throw when no timer set', () => {
      const hook = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      // Should not throw when clearing non-existent timer
      expect(() => hook.clearIdleActionTimer()).not.toThrow();
    });
  });

  describe('scheduleIdleAction', () => {
    it('should not trigger action when no character', () => {
      const hook = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      hook.scheduleIdleAction();

      // Advance past max delay
      vi.advanceTimersByTime(50_000);

      // Should not have played any action
      expect(mockMedia.playAction).not.toHaveBeenCalled();
    });

    it('should not trigger action when no actions', () => {
      const character = createMockCharacter([]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      hook.scheduleIdleAction();
      vi.advanceTimersByTime(50_000);

      expect(mockMedia.playAction).not.toHaveBeenCalled();
    });

    it('should not trigger action when processing', () => {
      const action = createMockAction({ name: 'Wave', videoPath: 'wave.mp4' });
      const character = createMockCharacter([action]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: true, // Processing
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      hook.scheduleIdleAction();
      vi.advanceTimersByTime(50_000);

      expect(mockMedia.playAction).not.toHaveBeenCalled();
    });

    it('should trigger idle action after delay', () => {
      const action = createMockAction({ name: 'Wave', videoPath: 'wave.mp4' });
      const character = createMockCharacter([action]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      hook.scheduleIdleAction();

      // Should not have played yet
      expect(mockMedia.playAction).not.toHaveBeenCalled();

      // Advance past max delay
      vi.advanceTimersByTime(50_000);

      // Should have played the action
      expect(mockMedia.playAction).toHaveBeenCalled();
    });
  });

  describe('triggerIdleAction', () => {
    it('should not trigger when no character', () => {
      const hook = useCharacterActions({
        selectedCharacter: null,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      hook.triggerIdleAction();

      expect(mockMedia.playAction).not.toHaveBeenCalled();
    });

    it('should call registerInteraction when action plays', () => {
      const action = createMockAction({ name: 'Wave', videoPath: 'wave.mp4' });
      const character = createMockCharacter([action]);

      const hook = useCharacterActions({
        selectedCharacter: character,
        isProcessingAction: false,
        media: mockMedia,
        registerInteraction: mockRegisterInteraction,
      });

      hook.triggerIdleAction();

      expect(mockMedia.playAction).toHaveBeenCalled();
      expect(mockRegisterInteraction).toHaveBeenCalled();
    });
  });
});

describe('helper functions', () => {
  describe('isTalkingAction', () => {
    it('should detect talking by name', () => {
      const action = createMockAction({ name: 'Talking Animation' });
      expect(isTalkingAction(action)).toBe(true);
    });

    it('should detect speak by name', () => {
      const action = createMockAction({ name: 'Speaking' });
      expect(isTalkingAction(action)).toBe(true);
    });

    it('should detect by phrase', () => {
      const action = createMockAction({
        name: 'Animation 1',
        phrases: ['when talking to user']
      });
      expect(isTalkingAction(action)).toBe(true);
    });

    it('should return false for non-talking action', () => {
      const action = createMockAction({ name: 'Wave', phrases: ['hello'] });
      expect(isTalkingAction(action)).toBe(false);
    });
  });

  describe('isGreetingAction', () => {
    it('should detect greeting by name', () => {
      const action = createMockAction({ name: 'Greeting Wave' });
      expect(isGreetingAction(action)).toBe(true);
    });

    it('should detect greeting by phrase', () => {
      const action = createMockAction({
        name: 'Wave',
        phrases: ['greeting hello']
      });
      expect(isGreetingAction(action)).toBe(true);
    });

    it('should return false for non-greeting action', () => {
      const action = createMockAction({ name: 'Wave', phrases: ['bye'] });
      expect(isGreetingAction(action)).toBe(false);
    });
  });
});
