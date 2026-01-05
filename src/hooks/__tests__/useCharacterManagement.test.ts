import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CharacterProfile, CharacterAction, UploadedImage } from '../../types';

// Mock cacheService (aliased as dbService in App.tsx)
vi.mock('../../services/cacheService', () => ({
  hashImage: vi.fn().mockResolvedValue('hash-123'),
  saveCharacter: vi.fn().mockResolvedValue(undefined),
  getCharacters: vi.fn().mockResolvedValue([]),
  createCharacterAction: vi.fn().mockResolvedValue({
    id: 'action-new',
    name: 'Test Action',
    phrases: ['test phrase'],
    videoPath: 'actions/test.mp4',
    sortOrder: 0,
  }),
  updateCharacterAction: vi.fn().mockResolvedValue({
    id: 'action-1',
    name: 'Updated Action',
    phrases: ['updated phrase'],
    videoPath: 'actions/test.mp4',
  }),
  deleteCharacterAction: vi.fn().mockResolvedValue(undefined),
  addIdleVideo: vi.fn().mockResolvedValue('idle-new'),
  getIdleVideos: vi.fn().mockResolvedValue([
    { id: 'idle-0', path: 'idle/video0.mp4' },
  ]),
  deleteIdleVideo: vi.fn().mockResolvedValue(undefined),
  deleteCharacter: vi.fn().mockResolvedValue(undefined),
  updateCharacterImage: vi.fn().mockResolvedValue(undefined),
}));

// Mock supabase
vi.mock('../../services/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://storage.example.com/${path}` },
        }),
      }),
    },
  },
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
import { useCharacterManagement } from '../useCharacterManagement';
import * as dbService from '../../services/cacheService';

// Test data factories
const createMockAction = (overrides: Partial<CharacterAction> = {}): CharacterAction => ({
  id: 'action-1',
  name: 'Test Action',
  video: new Blob(),
  phrases: ['test phrase'],
  videoPath: 'actions/test.mp4',
  ...overrides,
});

const createMockCharacter = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
  id: 'char-1',
  name: 'Test Character',
  displayName: 'Test',
  idleVideoUrls: ['https://example.com/idle1.mp4'],
  actions: [createMockAction()],
  profileImage: new Blob(),
  ...overrides,
});

const createMockImage = (): UploadedImage => ({
  base64: 'base64data',
  mimeType: 'image/png',
  file: new File([''], 'test.png', { type: 'image/png' }),
});

describe('useCharacterManagement', () => {
  let mockOptions: {
    characters: CharacterProfile[];
    setCharacters: ReturnType<typeof vi.fn>;
    selectedCharacter: CharacterProfile | null;
    setSelectedCharacter: ReturnType<typeof vi.fn>;
    characterForManagement: CharacterProfile | null;
    setCharacterForManagement: ReturnType<typeof vi.fn>;
    actionVideoUrls: Record<string, string>;
    setActionVideoUrls: ReturnType<typeof vi.fn>;
    setView: ReturnType<typeof vi.fn>;
    reportError: ReturnType<typeof vi.fn>;
    registerInteraction: ReturnType<typeof vi.fn>;
    media: {
      setVideoQueue: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    resetMockState();
    mockOptions = {
      characters: [createMockCharacter()],
      setCharacters: vi.fn(),
      selectedCharacter: createMockCharacter(),
      setSelectedCharacter: vi.fn(),
      characterForManagement: null,
      setCharacterForManagement: vi.fn(),
      actionVideoUrls: { 'action-1': 'https://example.com/action1.mp4' },
      setActionVideoUrls: vi.fn(),
      setView: vi.fn(),
      reportError: vi.fn(),
      registerInteraction: vi.fn(),
      media: {
        setVideoQueue: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should initialize with correct default values', () => {
      const hook = useCharacterManagement(mockOptions);

      expect(hook.isSavingCharacter).toBe(false);
      expect(hook.isCreatingAction).toBe(false);
      expect(hook.updatingActionId).toBeNull();
      expect(hook.deletingActionId).toBeNull();
      expect(hook.isAddingIdleVideo).toBe(false);
      expect(hook.deletingIdleVideoId).toBeNull();
      expect(hook.isUpdatingImage).toBe(false);
      expect(hook.uploadedImage).toBeNull();
    });
  });

  describe('handleImageUpload', () => {
    it('should set uploaded image', () => {
      const hook = useCharacterManagement(mockOptions);
      const mockImage = createMockImage();

      hook.handleImageUpload(mockImage);

      // Reset counter to read updated state
      stateCounter = 0;
      refCounter = 0;
      const hook2 = useCharacterManagement(mockOptions);

      expect(hook2.uploadedImage).toEqual(mockImage);
    });
  });

  describe('handleCreateAction', () => {
    it('should create action and update character', async () => {
      mockOptions.characterForManagement = createMockCharacter();
      const hook = useCharacterManagement(mockOptions);

      const input = {
        name: 'New Action',
        phrases: ['phrase 1'],
        videoFile: new File([''], 'video.mp4', { type: 'video/mp4' }),
      };

      await hook.handleCreateAction(input);

      expect(dbService.createCharacterAction).toHaveBeenCalledWith('char-1', {
        name: 'New Action',
        phrases: ['phrase 1'],
        video: input.videoFile,
      });
      expect(mockOptions.registerInteraction).toHaveBeenCalled();
    });

    it('should not create action when no character selected', async () => {
      mockOptions.selectedCharacter = null;
      mockOptions.characterForManagement = null;
      const hook = useCharacterManagement(mockOptions);

      await hook.handleCreateAction({
        name: 'Test',
        phrases: [],
        videoFile: new File([''], 'video.mp4'),
      });

      expect(dbService.createCharacterAction).not.toHaveBeenCalled();
    });

    it('should handle error during action creation', async () => {
      mockOptions.characterForManagement = createMockCharacter();
      vi.mocked(dbService.createCharacterAction).mockRejectedValueOnce(new Error('DB Error'));

      const hook = useCharacterManagement(mockOptions);

      await hook.handleCreateAction({
        name: 'Test',
        phrases: [],
        videoFile: new File([''], 'video.mp4'),
      });

      expect(mockOptions.reportError).toHaveBeenCalledWith(
        'Failed to create action.',
        expect.any(Error)
      );
    });
  });

  describe('handleUpdateAction', () => {
    it('should update action', async () => {
      mockOptions.characterForManagement = createMockCharacter();
      const hook = useCharacterManagement(mockOptions);

      await hook.handleUpdateAction('action-1', {
        name: 'Updated Name',
        phrases: ['new phrase'],
      });

      expect(dbService.updateCharacterAction).toHaveBeenCalledWith('char-1', 'action-1', {
        name: 'Updated Name',
        phrases: ['new phrase'],
      });
    });

    it('should not update when no character', async () => {
      mockOptions.selectedCharacter = null;
      mockOptions.characterForManagement = null;
      const hook = useCharacterManagement(mockOptions);

      await hook.handleUpdateAction('action-1', { name: 'Test' });

      expect(dbService.updateCharacterAction).not.toHaveBeenCalled();
    });
  });

  describe('handleDeleteAction', () => {
    it('should delete action', async () => {
      mockOptions.characterForManagement = createMockCharacter();
      const hook = useCharacterManagement(mockOptions);

      await hook.handleDeleteAction('action-1');

      expect(dbService.deleteCharacterAction).toHaveBeenCalledWith('char-1', 'action-1');
    });

    it('should update video queue after deletion', async () => {
      mockOptions.characterForManagement = createMockCharacter();
      mockOptions.actionVideoUrls = { 'action-1': 'blob:url-to-revoke' };
      const hook = useCharacterManagement(mockOptions);

      await hook.handleDeleteAction('action-1');

      expect(mockOptions.media.setVideoQueue).toHaveBeenCalled();
    });
  });

  describe('handleAddIdleVideo', () => {
    it('should add idle video', async () => {
      mockOptions.characterForManagement = createMockCharacter();
      const hook = useCharacterManagement(mockOptions);
      const videoFile = new File([''], 'idle.mp4', { type: 'video/mp4' });

      await hook.handleAddIdleVideo(videoFile);

      expect(dbService.addIdleVideo).toHaveBeenCalledWith('char-1', videoFile);
    });

    it('should not add when no character for management', async () => {
      mockOptions.characterForManagement = null;
      const hook = useCharacterManagement(mockOptions);

      await hook.handleAddIdleVideo(new File([''], 'idle.mp4'));

      expect(dbService.addIdleVideo).not.toHaveBeenCalled();
    });
  });

  describe('handleDeleteIdleVideo', () => {
    it('should delete idle video by index', async () => {
      mockOptions.characterForManagement = createMockCharacter({
        idleVideoUrls: ['url1', 'url2'],
      });
      const hook = useCharacterManagement(mockOptions);

      await hook.handleDeleteIdleVideo('idle-0');

      expect(dbService.getIdleVideos).toHaveBeenCalledWith('char-1');
      expect(dbService.deleteIdleVideo).toHaveBeenCalled();
    });

    it('should not delete with invalid id format', async () => {
      mockOptions.characterForManagement = createMockCharacter();
      const hook = useCharacterManagement(mockOptions);

      await hook.handleDeleteIdleVideo('invalid-format');

      expect(dbService.deleteIdleVideo).not.toHaveBeenCalled();
    });
  });

  describe('handleManageCharacter', () => {
    it('should set character for management and switch view', () => {
      const hook = useCharacterManagement(mockOptions);
      const character = createMockCharacter();

      hook.handleManageCharacter(character);

      expect(mockOptions.registerInteraction).toHaveBeenCalled();
      expect(mockOptions.setCharacterForManagement).toHaveBeenCalledWith(character);
      expect(mockOptions.setView).toHaveBeenCalledWith('manageCharacter');
    });

    it('should create action URLs for character actions', () => {
      const character = createMockCharacter({
        actions: [
          createMockAction({ id: 'new-action' }),
        ],
      });
      mockOptions.actionVideoUrls = {}; // No existing URLs

      const hook = useCharacterManagement(mockOptions);
      hook.handleManageCharacter(character);

      expect(mockOptions.setActionVideoUrls).toHaveBeenCalled();
    });
  });

  describe('handleDeleteCharacter', () => {
    // Mock globalThis.confirm for Node environment
    const originalConfirm = globalThis.confirm;

    beforeEach(() => {
      // @ts-expect-error - mocking global
      globalThis.confirm = vi.fn().mockReturnValue(true);
    });

    afterEach(() => {
      globalThis.confirm = originalConfirm;
    });

    it('should delete character after confirmation', async () => {
      // @ts-expect-error - mocking global
      globalThis.confirm = vi.fn().mockReturnValue(true);

      const hook = useCharacterManagement(mockOptions);

      await hook.handleDeleteCharacter('char-1');

      expect(dbService.deleteCharacter).toHaveBeenCalledWith('char-1');
      expect(mockOptions.setCharacters).toHaveBeenCalled();
    });

    it('should not delete when user cancels', async () => {
      // @ts-expect-error - mocking global
      globalThis.confirm = vi.fn().mockReturnValue(false);

      const hook = useCharacterManagement(mockOptions);

      await hook.handleDeleteCharacter('char-1');

      expect(dbService.deleteCharacter).not.toHaveBeenCalled();
    });

    it('should call handleBackToSelection when deleting selected character', async () => {
      // @ts-expect-error - mocking global
      globalThis.confirm = vi.fn().mockReturnValue(true);

      mockOptions.selectedCharacter = createMockCharacter({ id: 'char-1' });
      const hook = useCharacterManagement(mockOptions);

      await hook.handleDeleteCharacter('char-1');

      // Should have called the back to selection logic
      expect(mockOptions.media.setVideoQueue).toHaveBeenCalledWith([]);
    });
  });

  describe('handleBackToSelection', () => {
    it('should clear state and return to selection', () => {
      const hook = useCharacterManagement(mockOptions);

      hook.handleBackToSelection();

      expect(mockOptions.media.setVideoQueue).toHaveBeenCalledWith([]);
      expect(mockOptions.setSelectedCharacter).toHaveBeenCalledWith(null);
      expect(mockOptions.setView).toHaveBeenCalledWith('selectCharacter');
    });
  });

  describe('handleSelectLocalVideo', () => {
    it('should call handleCharacterCreated with uploaded image', async () => {
      const hook = useCharacterManagement(mockOptions);
      const mockImage = createMockImage();

      // Set uploaded image first
      hook.handleImageUpload(mockImage);

      // Reset to get updated state
      stateCounter = 0;
      refCounter = 0;
      const hook2 = useCharacterManagement(mockOptions);

      const videoFile = new File([''], 'video.mp4', { type: 'video/mp4' });
      await hook2.handleSelectLocalVideo(videoFile);

      expect(dbService.hashImage).toHaveBeenCalledWith('base64data');
    });

    it('should report error when no image uploaded', async () => {
      const hook = useCharacterManagement(mockOptions);

      await hook.handleSelectLocalVideo(new File([''], 'video.mp4'));

      expect(mockOptions.reportError).toHaveBeenCalledWith('Upload an image first.');
    });
  });

  describe('applyCharacterUpdate', () => {
    it('should update character in characters list', () => {
      const hook = useCharacterManagement(mockOptions);

      hook.applyCharacterUpdate('char-1', (char) => ({
        ...char,
        name: 'Updated Name',
      }));

      expect(mockOptions.setCharacters).toHaveBeenCalled();
    });

    it('should update selected character if it matches', () => {
      mockOptions.selectedCharacter = createMockCharacter({ id: 'char-1' });
      const hook = useCharacterManagement(mockOptions);

      hook.applyCharacterUpdate('char-1', (char) => ({
        ...char,
        name: 'Updated Name',
      }));

      expect(mockOptions.setSelectedCharacter).toHaveBeenCalled();
    });
  });

  describe('cleanupActionUrls', () => {
    it('should revoke all object URLs', () => {
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const hook = useCharacterManagement(mockOptions);
      hook.cleanupActionUrls({
        'action-1': 'blob:url1',
        'action-2': 'blob:url2',
      });

      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
      revokeObjectURL.mockRestore();
    });
  });
});
