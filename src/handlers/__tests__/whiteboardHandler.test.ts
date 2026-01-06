import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWhiteboardCapture } from '../whiteboardHandler';
import type { CharacterProfile } from '../../types';
import type { AIChatSession } from '../../services/aiService';

// Mock whiteboardModes
vi.mock('../../services/whiteboardModes', () => ({
  parseWhiteboardAction: vi.fn().mockReturnValue({
    type: 'draw',
    content: 'test drawing',
  }),
}));

// Mock memoryService
vi.mock('../../services/memoryService', () => ({
  getUserFacts: vi.fn().mockResolvedValue([]),
  formatFactValueForDisplay: vi.fn().mockImplementation((val) => String(val)),
}));

// Test data factories
const createMockCharacter = (): CharacterProfile => ({
  id: 'char-1',
  createdAt: Date.now(),
  name: 'Test Character',
  displayName: 'Test',
  image: {
    file: new File([''], 'test.png', { type: 'image/png' }),
    base64: 'data:image/png;base64,test',
    mimeType: 'image/png',
  },
  idleVideoUrls: ['https://example.com/idle1.mp4'],
  actions: [
    {
      id: 'action-1',
      name: 'Test Action',
      video: new Blob(),
      phrases: ['test phrase'],
      videoPath: 'actions/test.mp4',
    },
  ],
});

const createMockSession = (): { accessToken: string } => ({
  accessToken: 'test-access-token',
});

const createMockAiSession = (): AIChatSession => ({
  model: 'gemini-2.0-flash',
});

const createMockActiveService = () => ({
  model: 'gemini-2.0-flash',
  generateResponse: vi.fn().mockResolvedValue({
    response: {
      text_response: 'Here is my response',
      action_id: null,
    },
    session: createMockAiSession(),
  }),
  generateGreeting: vi.fn().mockResolvedValue({
    greeting: {
      text_response: 'Hello!',
      action_id: null,
    },
    session: createMockAiSession(),
  }),
  generateNonGreeting: vi.fn().mockResolvedValue({
    greeting: {
      text_response: 'Hey there!',
      action_id: null,
    },
    session: createMockAiSession(),
  }),
});

describe('whiteboardHandler', () => {
  let mockOptions: {
    selectedCharacter: CharacterProfile | null;
    session: { accessToken: string } | null;
    aiSession: AIChatSession | null;
    activeService: ReturnType<typeof createMockActiveService>;
    setAiSession: ReturnType<typeof vi.fn>;
    playAction: ReturnType<typeof vi.fn>;
    isMutedRef: { current: boolean };
    enqueueAudio: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOptions = {
      selectedCharacter: createMockCharacter(),
      session: createMockSession(),
      aiSession: createMockAiSession(),
      activeService: createMockActiveService(),
      setAiSession: vi.fn(),
      playAction: vi.fn(),
      isMutedRef: { current: false },
      enqueueAudio: vi.fn(),
    };
  });

  describe('handleWhiteboardCapture', () => {
    it("should return error message when no character selected", async () => {
      mockOptions.selectedCharacter = null;

      const result = await handleWhiteboardCapture(
        "base64data",
        "draw a cat",
        "drawing mode",
        mockOptions
      );

      expect(result.textResponse).toBe("Please select a character first.");
      expect(mockOptions.activeService.generateResponse).not.toHaveBeenCalled();
    });

    it("should return error message when no session", async () => {
      mockOptions.session = null;

      const result = await handleWhiteboardCapture(
        "base64data",
        "draw a cat",
        "drawing mode",
        mockOptions
      );

      expect(result.textResponse).toBe("Please select a character first.");
      expect(mockOptions.activeService.generateResponse).not.toHaveBeenCalled();
    });

    it("should call generateResponse with correct parameters", async () => {
      await handleWhiteboardCapture(
        "base64imagedata",
        "draw a cat",
        "You are in drawing mode",
        mockOptions
      );

      expect(mockOptions.activeService.generateResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "image_text",
          imageData: "base64imagedata",
          mimeType: "image/png",
        }),
        expect.objectContaining({
          chatHistory: [],
          googleAccessToken: "test-access-token",
          audioMode: "async",
        }),
        expect.any(Object)
      );
    });

    it("should update AI session after response", async () => {
      const updatedSession = {
        model: "gemini-2.0-flash",
        interactionId: "new-id",
      };
      mockOptions.activeService.generateResponse.mockResolvedValue({
        response: { text_response: "Test response", action_id: null },
        session: updatedSession,
      });

      await handleWhiteboardCapture(
        "base64data",
        "draw a cat",
        "drawing mode",
        mockOptions
      );

      expect(mockOptions.setAiSession).toHaveBeenCalledWith(updatedSession);
    });

    it("should play action when action_id is returned", async () => {
      mockOptions.activeService.generateResponse.mockResolvedValue({
        response: { text_response: "Here you go!", action_id: "action-1" },
        session: createMockAiSession(),
      });

      await handleWhiteboardCapture(
        "base64data",
        "draw a cat",
        "drawing mode",
        mockOptions
      );

      expect(mockOptions.playAction).toHaveBeenCalledWith("action-1");
    });

    it("should not play action when no action_id", async () => {
      mockOptions.activeService.generateResponse.mockResolvedValue({
        response: { text_response: "Here you go!", action_id: null },
        session: createMockAiSession(),
      });

      await handleWhiteboardCapture(
        "base64data",
        "draw a cat",
        "drawing mode",
        mockOptions
      );

      expect(mockOptions.playAction).not.toHaveBeenCalled();
    });

    it("should return text response and whiteboard action", async () => {
      mockOptions.activeService.generateResponse.mockResolvedValue({
        response: { text_response: "I drew a cat!", action_id: null },
        session: createMockAiSession(),
      });

      const result = await handleWhiteboardCapture(
        "base64data",
        "draw a cat",
        "drawing mode",
        mockOptions
      );

      expect(result.textResponse).toBe("I drew a cat!");
      expect(result.whiteboardAction).toEqual({
        type: "draw",
        content: "test drawing",
      });
    });

    it("should handle errors gracefully", async () => {
      mockOptions.activeService.generateResponse.mockRejectedValue(
        new Error("API Error")
      );

      const result = await handleWhiteboardCapture(
        "base64data",
        "draw a cat",
        "drawing mode",
        mockOptions
      );

      expect(result.textResponse).toBe(
        "Hmm, I had trouble seeing your drawing. Try again?"
      );
    });

    it("should use default session when aiSession is null", async () => {
      mockOptions.aiSession = null;

      await handleWhiteboardCapture(
        "base64data",
        "draw a cat",
        "drawing mode",
        mockOptions
      );

      expect(mockOptions.activeService.generateResponse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { model: "gemini-2.0-flash" }
      );
    });

    // it('should include user facts in context when available', async () => {
    //   const { getUserFacts } = await import('../../services/memoryService');
    //   vi.mocked(getUserFacts).mockResolvedValue([
    //     { fact_key: 'name', fact_value: 'John' },
    //     { fact_key: 'favorite_color', fact_value: 'blue' },
    //   ]);

    //   await handleWhiteboardCapture(
    //     'base64data',
    //     'draw my name',
    //     'drawing mode',
    //     mockOptions
    //   );

    //   expect(mockOptions.activeService.generateResponse).toHaveBeenCalledWith(
    //     expect.objectContaining({
    //       text: expect.stringContaining('[KNOWN USER INFO'),
    //     }),
    //     expect.any(Object),
    //     expect.any(Object)
    //   );
    // });
  });
});
