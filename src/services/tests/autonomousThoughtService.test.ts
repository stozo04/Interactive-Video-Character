// src/services/tests/autonomousThoughtService.test.ts
/**
 * Autonomous Thought Service Tests
 *
 * Tests LLM-based thought generation including:
 * - Context building with all three behavior sources
 * - Caching behavior (hit/miss)
 * - Error handling (graceful degradation)
 * - Quality validation (confidence, shouldMention)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock GoogleGenAI BEFORE importing the service
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: () => JSON.stringify({
          shouldMention: true,
          content: "working on a video edit... trying to get the pacing right",
          intensity: 0.6,
          confidence: 0.8
        })
      })
    }
  }))
}));

// Import after mocking
import {
  generateAutonomousThought,
  generateAutonomousThoughtCached,
  clearThoughtCache,
  type ThoughtGenerationContext,
  type ThoughtMessage
} from "../autonomousThoughtService";

describe("Autonomous Thought Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearThoughtCache();
  });

  afterEach(() => {
    clearThoughtCache();
  });

  describe("generateAutonomousThought", () => {
    const mockContext: ThoughtGenerationContext = {
      theme: "creative_project",
      characterProfile: "Kayley is a thoughtful, creative person who loves video editing and art.",
      recentConversations: [
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm good! Working on some projects." }
      ],
      currentMood: { energy: 0.6, warmth: 0.5, genuineMoment: false },
      relationshipTier: "friends",
      recentLifeEvents: [
        {
          id: "event1",
          description: "Started new video editing project",
          category: "personal",
          intensity: 0.6,
          createdAt: new Date()
        }
      ],
      userFacts: ["User is interested in creative work"]
    };

    it("should generate thought with valid context", async () => {
      const result = await generateAutonomousThought(mockContext);

      expect(result).toBeDefined();
      expect(result.theme).toBe("creative_project");
      expect(result.content).toBeTruthy();
      expect(result.intensity).toBeGreaterThanOrEqual(0);
      expect(result.intensity).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.shouldMention).toBe("boolean");
    });

    it("should include all three behavior sources in prompt", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: () => JSON.stringify({
          shouldMention: true,
          content: "test thought",
          intensity: 0.5,
          confidence: 0.7
        })
      });

      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent
        }
      }));

      await generateAutonomousThought(mockContext);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.arrayContaining([
            expect.objectContaining({
              parts: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining("CHARACTER PROFILE:")
                })
              ])
            })
          ])
        })
      );

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const promptText = callArgs.contents[0].parts[0].text;

      // Verify all three sources are present
      expect(promptText).toContain("CHARACTER PROFILE:");
      expect(promptText).toContain("RECENT CONVERSATION:");
      expect(promptText).toContain("Mood:");
    });

    it("should clamp intensity and confidence to valid ranges", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: () => JSON.stringify({
              shouldMention: true,
              content: "test thought",
              intensity: 1.5, // Out of bounds
              confidence: -0.2 // Out of bounds
            })
          })
        }
      }));

      const result = await generateAutonomousThought(mockContext);

      // Should be clamped
      expect(result.intensity).toBeLessThanOrEqual(1);
      expect(result.intensity).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it("should handle LLM failure gracefully", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: vi.fn().mockRejectedValue(new Error("LLM error"))
        }
      }));

      const result = await generateAutonomousThought(mockContext);

      // Should return empty result, not throw
      expect(result.content).toBe("");
      expect(result.intensity).toBe(0);
      expect(result.shouldMention).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it("should handle malformed JSON response", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: () => "not valid json"
          })
        }
      }));

      const result = await generateAutonomousThought(mockContext);

      // Should return empty result, not throw
      expect(result.content).toBe("");
      expect(result.shouldMention).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it("should strip markdown code blocks from response", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: () => "```json\n" + JSON.stringify({
              shouldMention: true,
              content: "test thought",
              intensity: 0.5,
              confidence: 0.7
            }) + "\n```"
          })
        }
      }));

      const result = await generateAutonomousThought(mockContext);

      // Should parse successfully despite markdown
      expect(result.content).toBe("test thought");
      expect(result.confidence).toBe(0.7);
    });

    it("should set shouldMention to false if content is empty", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: () => JSON.stringify({
              shouldMention: true,
              content: "",
              intensity: 0.5,
              confidence: 0.7
            })
          })
        }
      }));

      const result = await generateAutonomousThought(mockContext);

      // Should override shouldMention if content is empty
      expect(result.shouldMention).toBe(false);
    });
  });

  describe("generateAutonomousThoughtCached", () => {
    const mockContext: ThoughtGenerationContext = {
      theme: "creative_project",
      characterProfile: "Kayley profile",
      recentConversations: [],
      currentMood: { energy: 0.5, warmth: 0.5, genuineMoment: false },
      relationshipTier: "friends",
      recentLifeEvents: [],
      userFacts: []
    };

    it("should cache thought for 30 minutes", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: () => JSON.stringify({
          shouldMention: true,
          content: "cached thought",
          intensity: 0.6,
          confidence: 0.8
        })
      });

      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent
        }
      }));

      // First call
      const result1 = await generateAutonomousThoughtCached(mockContext);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // Second call (should hit cache)
      const result2 = await generateAutonomousThoughtCached(mockContext);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1); // Still 1, not 2

      // Results should be identical
      expect(result2.content).toBe(result1.content);
      expect(result2.confidence).toBe(result1.confidence);
    });

    it("should generate new thought for different context", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockGenerateContent = vi.fn()
        .mockResolvedValueOnce({
          text: () => JSON.stringify({
            shouldMention: true,
            content: "thought 1",
            intensity: 0.6,
            confidence: 0.8
          })
        })
        .mockResolvedValueOnce({
          text: () => JSON.stringify({
            shouldMention: true,
            content: "thought 2",
            intensity: 0.6,
            confidence: 0.8
          })
        });

      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent
        }
      }));

      // First context
      const result1 = await generateAutonomousThoughtCached(mockContext);

      // Different context (different theme)
      const result2 = await generateAutonomousThoughtCached({
        ...mockContext,
        theme: "family"
      });

      // Should have made 2 calls
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(result1.content).not.toBe(result2.content);
    });

    it("should clear cache with clearThoughtCache", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: () => JSON.stringify({
          shouldMention: true,
          content: "test thought",
          intensity: 0.6,
          confidence: 0.8
        })
      });

      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent
        }
      }));

      // First call
      await generateAutonomousThoughtCached(mockContext);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // Clear cache
      clearThoughtCache();

      // Second call (should NOT hit cache)
      await generateAutonomousThoughtCached(mockContext);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe("context building", () => {
    it("should format conversation history correctly", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: () => JSON.stringify({
          shouldMention: true,
          content: "test",
          intensity: 0.5,
          confidence: 0.7
        })
      });

      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent
        }
      }));

      const messages: ThoughtMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" }
      ];

      await generateAutonomousThought({
        theme: "creative_project",
        characterProfile: "Profile",
        recentConversations: messages,
        currentMood: { energy: 0.5, warmth: 0.5, genuineMoment: false },
        relationshipTier: "friends",
        recentLifeEvents: [],
        userFacts: []
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const promptText = callArgs.contents[0].parts[0].text;

      // Should format as "User:" and "Kayley:"
      expect(promptText).toContain("User: Hello");
      expect(promptText).toContain("Kayley: Hi there!");
    });

    it("should include life events in prompt", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: () => JSON.stringify({
          shouldMention: true,
          content: "test",
          intensity: 0.5,
          confidence: 0.7
        })
      });

      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent
        }
      }));

      await generateAutonomousThought({
        theme: "creative_project",
        characterProfile: "Profile",
        recentConversations: [],
        currentMood: { energy: 0.5, warmth: 0.5, genuineMoment: false },
        relationshipTier: "friends",
        recentLifeEvents: [
          {
            id: "event1",
            description: "Started video project",
            category: "personal",
            intensity: 0.6,
            createdAt: new Date()
          }
        ],
        userFacts: []
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const promptText = callArgs.contents[0].parts[0].text;

      expect(promptText).toContain("RECENT LIFE EVENTS:");
      expect(promptText).toContain("Started video project");
    });

    it("should include user facts in prompt", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: () => JSON.stringify({
          shouldMention: true,
          content: "test",
          intensity: 0.5,
          confidence: 0.7
        })
      });

      // @ts-expect-error - mocking
      GoogleGenAI.mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent
        }
      }));

      await generateAutonomousThought({
        theme: "creative_project",
        characterProfile: "Profile",
        recentConversations: [],
        currentMood: { energy: 0.5, warmth: 0.5, genuineMoment: false },
        relationshipTier: "friends",
        recentLifeEvents: [],
        userFacts: ["User is a software engineer", "User loves music"]
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const promptText = callArgs.contents[0].parts[0].text;

      expect(promptText).toContain("USER FACTS:");
      expect(promptText).toContain("User is a software engineer");
      expect(promptText).toContain("User loves music");
    });
  });
});
