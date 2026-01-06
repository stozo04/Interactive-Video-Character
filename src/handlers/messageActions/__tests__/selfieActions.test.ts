import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processSelfieAction,
  SelfieActionResult,
} from '../selfieActions';
import type { ChatMessage } from '../../../types';
import type { CalendarEvent } from '../../../services/calendarService';

// Mock image generation service
vi.mock('../../../services/imageGenerationService', () => ({
  generateCompanionSelfie: vi.fn().mockResolvedValue({
    success: true,
    imageBase64: 'base64-image-data',
    mimeType: 'image/png',
  }),
}));

// Mock kayley presence service
vi.mock('../../../services/kayleyPresenceService', () => ({
  getKayleyPresenceState: vi.fn().mockResolvedValue({
    currentOutfit: 'casual sweater',
    currentMood: 'happy',
    currentActivity: 'chatting',
    currentLocation: 'home',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
}));

describe('selfieActions', () => {
  const mockChatHistory: ChatMessage[] = [
    { role: 'user', text: 'Hey!' },
    { role: 'model', text: 'Hi there!' },
  ];

  const mockEvents: CalendarEvent[] = [
    {
      id: 'event-1',
      summary: 'Team Meeting',
      start: { dateTime: '2025-01-04T10:00:00' },
      end: { dateTime: '2025-01-04T11:00:00' },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processSelfieAction', () => {
    it("should generate selfie with scene and mood", async () => {
      const selfieAction = {
        scene: "cozy coffee shop",
        mood: "happy",
        outfit_hint: "casual",
      };

      const result = await processSelfieAction(selfieAction, {
        userMessage: "Send me a selfie!",
        chatHistory: mockChatHistory,
        upcomingEvents: mockEvents,
      });

      expect(result.handled).toBe(true);
      expect(result.success).toBe(true);
      expect(result.imageBase64).toBe("base64-image-data");
      expect(result.mimeType).toBe("image/png");
    });

    it("should return not handled for null action", async () => {
      const result = await processSelfieAction(null, {
        userMessage: "",
        chatHistory: [],
        upcomingEvents: [],
      });

      expect(result.handled).toBe(false);
    });

    // it('should return not handled when scene is missing', async () => {
    //   const selfieAction = {
    //     mood: 'happy',
    //     // missing scene
    //   };

    //   const result = await processSelfieAction(selfieAction, {
    //     userMessage: '',
    //     chatHistory: [],
    //     upcomingEvents: [],
    //   });

    //   expect(result.handled).toBe(false);
    // });

    it("should handle generation failure gracefully", async () => {
      const { generateCompanionSelfie } = await import(
        "../../../services/imageGenerationService"
      );
      vi.mocked(generateCompanionSelfie).mockResolvedValueOnce({
        success: false,
        error: "API rate limit exceeded",
      });

      const selfieAction = {
        scene: "beach",
        mood: "relaxed",
      };

      const result = await processSelfieAction(selfieAction, {
        userMessage: "Send a pic!",
        chatHistory: [],
        upcomingEvents: [],
      });

      expect(result.handled).toBe(true);
      expect(result.success).toBe(false);
      expect(result.error).toBe("API rate limit exceeded");
    });

    it("should include presence state in generation context", async () => {
      const { generateCompanionSelfie } = await import(
        "../../../services/imageGenerationService"
      );

      const selfieAction = {
        scene: "at my desk",
        mood: "focused",
      };

      await processSelfieAction(selfieAction, {
        userMessage: "Show me what you look like!",
        chatHistory: mockChatHistory,
        upcomingEvents: [],
      });

      expect(generateCompanionSelfie).toHaveBeenCalledWith(
        expect.objectContaining({
          scene: "at my desk",
          mood: "focused",
          presenceOutfit: "casual sweater",
          presenceMood: "happy",
        })
      );
    });

    it("should handle calendar events for outfit context", async () => {
      const { generateCompanionSelfie } = await import(
        "../../../services/imageGenerationService"
      );

      const formalEvent: CalendarEvent = {
        id: "event-1",
        summary: "Dinner Reservation",
        start: { dateTime: "2025-01-04T19:00:00" },
        end: { dateTime: "2025-01-04T21:00:00" },
      };

      const selfieAction = {
        scene: "getting ready",
        mood: "excited",
      };

      await processSelfieAction(selfieAction, {
        userMessage: "How do I look?",
        chatHistory: [],
        upcomingEvents: [formalEvent],
      });

      expect(generateCompanionSelfie).toHaveBeenCalledWith(
        expect.objectContaining({
          upcomingEvents: expect.arrayContaining([
            expect.objectContaining({
              title: "Dinner Reservation",
              isFormal: true,
            }),
          ]),
        })
      );
    });

    it("should handle exceptions gracefully", async () => {
      const { generateCompanionSelfie } = await import(
        "../../../services/imageGenerationService"
      );
      vi.mocked(generateCompanionSelfie).mockRejectedValueOnce(
        new Error("Network error")
      );

      const selfieAction = {
        scene: "office",
        mood: "professional",
      };

      const result = await processSelfieAction(selfieAction, {
        userMessage: "Selfie please!",
        chatHistory: [],
        upcomingEvents: [],
      });

      expect(result.handled).toBe(true);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });
});
