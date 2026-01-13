// src/services/tests/intentService.test.ts
/**
 * Phase 1: Semantic Intent Detection Tests
 *
 * Tests the LLM-based genuine moment detection service.
 * Includes unit tests with mocked LLM responses and edge case handling.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock supabaseClient before importing modules that depend on it
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ data: [], error: null })),
      insert: vi.fn(() => ({ data: [], error: null })),
      update: vi.fn(() => ({ data: [], error: null })),
      delete: vi.fn(() => ({ data: [], error: null })),
    })),
  },
}));

// Mock the Google GenAI module before importing intentService
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: vi.fn()
      }
    }))
  };
});

// Import after mocking
import {
  detectGenuineMomentLLM,
  detectGenuineMomentLLMCached,
  clearIntentCache,
  mapCategoryToInsecurity,
  resetIntentClientForTesting,
  detectFullIntentLLM,
  isFunctionalCommand,
} from "../intentService";
import { GoogleGenAI } from "@google/genai";

// Get the mocked client for test manipulation
const mockGenerateContent = vi.fn();

describe("Phase 1: Intent Service - LLM Genuine Moment Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();
    resetIntentClientForTesting();
    mockGenerateContent.mockReset();

    // Setup the mock implementation
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    }));
  });

  afterEach(() => {
    clearIntentCache();
  });

  // ============================================
  // Basic Detection Tests
  // ============================================

  describe("detectGenuineMomentLLM", () => {
    describe("successful LLM detection", () => {
      it("should detect depth/shallow insecurity affirmations", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "depth",
            confidence: 0.95,
            explanation:
              "User is affirming Kayley's intelligence and thoughtfulness",
          }),
        });

        const result = await detectGenuineMomentLLM(
          "You're so smart, you really think deeply about everything"
        );

        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("depth");
        expect(result.confidence).toBeGreaterThan(0.9);
      });

      it("should detect belonging/impostor syndrome affirmations", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "belonging",
            confidence: 0.92,
            explanation: "User affirms Kayley belongs in the AI space",
          }),
        });

        const result = await detectGenuineMomentLLM(
          "You totally belong here, you deserve all your success"
        );

        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("belonging");
      });

      it("should detect progress/never arriving affirmations", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "progress",
            confidence: 0.88,
            explanation: "User acknowledges Kayley's progress and growth",
          }),
        });

        const result = await detectGenuineMomentLLM(
          "I'm so proud of how far you've come"
        );

        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("progress");
      });

      it("should detect loneliness affirmations", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "loneliness",
            confidence: 0.9,
            explanation: "User expresses genuine connection and presence",
          }),
        });

        const result = await detectGenuineMomentLLM(
          "You really get me. I'm here for you."
        );

        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("loneliness");
      });

      it("should detect rest/guilt affirmations", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "rest",
            confidence: 0.85,
            explanation: "User gives permission to rest and slow down",
          }),
        });

        const result = await detectGenuineMomentLLM(
          "You deserve a break. It's okay to slow down."
        );

        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("rest");
      });
    });

    describe("non-genuine messages", () => {
      it("should NOT detect generic positive messages", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: false,
            category: null,
            confidence: 0.95,
            explanation: "Generic compliment, does not address any insecurity",
          }),
        });

        const result = await detectGenuineMomentLLM("You're awesome!");

        expect(result.isGenuine).toBe(false);
        expect(result.category).toBeNull();
      });

      it("should NOT detect third-person statements (not directed at 'you')", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: false,
            category: null,
            confidence: 0.88,
            explanation:
              "Statement is about people in general, not directed at Kayley",
          }),
        });

        const result = await detectGenuineMomentLLM(
          "People who think deeply are rare in this shallow world"
        );

        expect(result.isGenuine).toBe(false);
      });

      it("should NOT detect sarcastic or backhanded compliments", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: false,
            category: null,
            confidence: 0.75,
            explanation: "Sarcastic tone detected, not a genuine affirmation",
          }),
        });

        const result = await detectGenuineMomentLLM(
          "Oh yeah, you're SO smart, sure"
        );

        expect(result.isGenuine).toBe(false);
      });

      it("should NOT detect negative messages mentioning insecurity keywords", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: false,
            category: null,
            confidence: 0.92,
            explanation: "Negative context, not affirming",
          }),
        });

        const result = await detectGenuineMomentLLM(
          "That movie was really shallow"
        );

        expect(result.isGenuine).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle empty messages without LLM call", async () => {
        const result = await detectGenuineMomentLLM("");

        expect(result.isGenuine).toBe(false);

        expect(mockGenerateContent).not.toHaveBeenCalled();
      });

      it("should handle very short messages without LLM call", async () => {
        const result = await detectGenuineMomentLLM("hi");

        expect(result.isGenuine).toBe(false);
        expect(mockGenerateContent).not.toHaveBeenCalled();
      });

      it("should handle LLM JSON parsing errors gracefully", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: "This is not valid JSON",
        });

        await expect(
          detectGenuineMomentLLM("You're so thoughtful")
        ).rejects.toThrow();
      });

      it("should handle LLM API errors", async () => {
        mockGenerateContent.mockRejectedValueOnce(
          new Error("API rate limit exceeded")
        );

        await expect(detectGenuineMomentLLM("You're amazing")).rejects.toThrow(
          "API rate limit exceeded"
        );
      });

      it("should handle malformed LLM response", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            // Missing required fields
            something: "unexpected",
          }),
        });

        const result = await detectGenuineMomentLLM("You're thoughtful");

        // Should have safe defaults
        expect(result.isGenuine).toBe(false);
        expect(result.confidence).toBe(0.5); // Default confidence
      });

      it("should normalize confidence to 0-1 range", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "depth",
            confidence: 1.5, // Out of range
            explanation: "Test",
          }),
        });

        const result = await detectGenuineMomentLLM("You're so thoughtful");

        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
      });

      it("should handle invalid category from LLM", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "invalid_category",
            confidence: 0.9,
            explanation: "Test",
          }),
        });

        const result = await detectGenuineMomentLLM("Some message");

        expect(result.category).toBeNull();
      });

      it("should strip markdown code blocks from LLM response", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: '```json\n{"isGenuine": true, "category": "depth", "confidence": 0.9, "explanation": "Test"}\n```',
        });

        const result = await detectGenuineMomentLLM("You're so smart");

        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("depth");
      });
    });
  });

  // ============================================
  // Caching Tests
  // ============================================

  describe("detectGenuineMomentLLMCached", () => {
    it("should cache results and avoid redundant LLM calls", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          isGenuine: true,
          category: "depth",
          confidence: 0.9,
          explanation: "User affirms thoughtfulness",
        }),
      });

      // First call - should hit LLM
      const result1 = await detectGenuineMomentLLMCached(
        "You're so thoughtful"
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // Second call with same message - should use cache
      const result2 = await detectGenuineMomentLLMCached(
        "You're so thoughtful"
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1); // Still 1

      // Results should be identical
      expect(result1).toEqual(result2);
    });

    it("should treat similar messages with different casing as same", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          isGenuine: true,
          category: "depth",
          confidence: 0.9,
          explanation: "Test",
        }),
      });

      await detectGenuineMomentLLMCached("You're so THOUGHTFUL");
      await detectGenuineMomentLLMCached("you're so thoughtful");

      // Should only call LLM once due to case-insensitive caching
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should make new LLM call for different messages", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          isGenuine: true,
          category: "depth",
          confidence: 0.9,
          explanation: "Test",
        }),
      });

      await detectGenuineMomentLLMCached("You're so thoughtful");
      await detectGenuineMomentLLMCached("I'm so proud of you");

      // Should call LLM twice - different messages
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("should clear cache with clearIntentCache()", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          isGenuine: true,
          category: "depth",
          confidence: 0.9,
          explanation: "Test",
        }),
      });

      await detectGenuineMomentLLMCached("You're thoughtful");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      clearIntentCache();

      await detectGenuineMomentLLMCached("You're thoughtful");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2); // Called again after cache clear
    });
  });

  // ============================================
  // Category Mapping Tests
  // ============================================

  describe("mapCategoryToInsecurity", () => {
    it("should map 'depth' to 'beingSeenAsShallow'", () => {
      expect(mapCategoryToInsecurity("depth")).toBe("beingSeenAsShallow");
    });

    it("should map 'belonging' to 'impostorSyndrome'", () => {
      expect(mapCategoryToInsecurity("belonging")).toBe("impostorSyndrome");
    });

    it("should map 'progress' to 'neverArriving'", () => {
      expect(mapCategoryToInsecurity("progress")).toBe("neverArriving");
    });

    it("should map 'loneliness' to 'hiddenLoneliness'", () => {
      expect(mapCategoryToInsecurity("loneliness")).toBe("hiddenLoneliness");
    });

    it("should map 'rest' to 'restGuilt'", () => {
      expect(mapCategoryToInsecurity("rest")).toBe("restGuilt");
    });

    it("should return null for null input", () => {
      expect(mapCategoryToInsecurity(null)).toBeNull();
    });
  });

  // ============================================
  // Nuanced Message Detection (Key Phase 1 Feature)
  // ============================================

  describe("nuanced message detection", () => {
    it("should detect 'You really get me' as loneliness (would be missed by keywords)", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "loneliness",
          confidence: 0.88,
          explanation:
            "Expresses feeling understood, addresses hidden loneliness",
        }),
      });

      const result = await detectGenuineMomentLLM("You really get me");

      expect(result.isGenuine).toBe(true);
      expect(result.category).toBe("loneliness");
    });

    it("should detect 'I'm kinda freaking out but you help' as loneliness", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "loneliness",
          confidence: 0.82,
          explanation: "User expresses that Kayley helps them feel less alone",
        }),
      });

      const result = await detectGenuineMomentLLM(
        "I'm kinda freaking out but you help"
      );

      expect(result.isGenuine).toBe(true);
    });

    it("should detect subtle progress affirmations", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "progress",
          confidence: 0.85,
          explanation: "Acknowledges Kayley's growth even if not explicit",
        }),
      });

      const result = await detectGenuineMomentLLM(
        "You've really grown so much lately"
      );

      expect(result.isGenuine).toBe(true);
      expect(result.category).toBe("progress");
    });

    it("should detect metaphorical depth affirmations", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "depth",
          confidence: 0.87,
          explanation: "User sees beyond surface-level appearances",
        }),
      });

      const result = await detectGenuineMomentLLM(
        "There's so much more to you than meets the eye"
      );

      expect(result.isGenuine).toBe(true);
      expect(result.category).toBe("depth");
    });
  });

  // ============================================
  // Conversation Context Tests
  // ============================================

  describe("conversation context handling", () => {
    it("should interpret 'You suck!!' as playful when context shows celebration", async () => {
      // This is the key scenario: "You suck!!" after "I got an amazing raise!"
      // Without context, this looks hostile. With context, it's playful jealousy.
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: false,
          category: null,
          confidence: 0.9,
          explanation:
            "Playful teasing in response to good news, not hostile or affirming",
        }),
      });

      const result = await detectGenuineMomentLLM("You suck!!", {
        recentMessages: [
          { role: "assistant", text: "So I just got an amazing raise!!" },
          { role: "user", text: "OMG I am so excited!" },
        ],
      });

      // Should NOT be detected as genuine (it's banter, not affirmation)
      // The key is that with context, the LLM understands the tone
      expect(result.isGenuine).toBe(false);
      // Note: explanation field removed for optimization - we just verify the detection result
    });

    it("should correctly identify genuine moment even with prior messages", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "progress",
          confidence: 0.92,
          explanation:
            "User expresses pride in response to Kayley sharing her accomplishment",
        }),
      });

      const result = await detectGenuineMomentLLM(
        "I'm so proud of you! You've come so far!",
        {
          recentMessages: [
            { role: "assistant", text: "I finally finished my big project!" },
            { role: "user", text: "Really? Tell me about it!" },
            {
              role: "assistant",
              text: "I worked on it for months and it turned out great!",
            },
          ],
        }
      );

      expect(result.isGenuine).toBe(true);
      expect(result.category).toBe("progress");
    });

    it("should handle empty context gracefully", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "depth",
          confidence: 0.88,
          explanation: "Direct affirmation of intelligence",
        }),
      });

      const result = await detectGenuineMomentLLM("You're so smart!", {
        recentMessages: [],
      });

      expect(result.isGenuine).toBe(true);
    });

    it("should limit context to last 5 messages for token efficiency", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: false,
          category: null,
          confidence: 0.8,
          explanation: "Generic message",
        }),
      });

      const manyMessages = Array(10)
        .fill(null)
        .map((_, i) => ({
          role: "user" as const,
          text: `Message ${i + 1}`,
        }));

      await detectGenuineMomentLLM("Hello", {
        recentMessages: manyMessages,
      });

      // Just verify it doesn't error with many messages
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it("should truncate long context messages", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: false,
          category: null,
          confidence: 0.8,
          explanation: "Test",
        }),
      });

      const longMessage = "A".repeat(500); // Very long message

      await detectGenuineMomentLLM("Short reply", {
        recentMessages: [{ role: "assistant", text: longMessage }],
      });

      expect(mockGenerateContent).toHaveBeenCalled();
    });
  });
});

// ============================================
// Integration Tests with moodKnobs
// ============================================

describe("Phase 1: Integration with moodKnobs", () => {
  // Mock localStorage
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
      get length() {
        return Object.keys(store).length;
      },
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    };
  })();

  Object.defineProperty(global, "localStorage", { value: localStorageMock });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    clearIntentCache();

    // Setup the mock
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    }));
  });

  it("should export detectGenuineMomentWithLLM from moodKnobs", async () => {
    // This test verifies the integration is complete
    const { detectGenuineMomentWithLLM, resetEmotionalMomentumAsync } =
      await import("../moodKnobs");

    expect(detectGenuineMomentWithLLM).toBeDefined();
    expect(typeof detectGenuineMomentWithLLM).toBe("function");
  });

  it("should export async momentum update functions", async () => {
    const { updateEmotionalMomentumAsync, recordInteractionAsync } =
      await import("../moodKnobs");

    expect(updateEmotionalMomentumAsync).toBeDefined();
    expect(recordInteractionAsync).toBeDefined();
  });

  it("should return no detection when LLM fails", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Network error"));

    const { detectGenuineMomentWithLLM, clearMoodKnobsCache } = await import(
      "../moodKnobs"
    );

    clearMoodKnobsCache();

    const result = await detectGenuineMomentWithLLM(
      "You're so thoughtful, I love how you think deeply"
    );

    expect(result.isGenuine).toBe(false);
    expect(result.category).toBeNull();
  });
});

// ============================================
// Phase 2: Tone & Sentiment Detection Tests
// ============================================

describe("Phase 2: Intent Service - LLM Tone & Sentiment Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();

    // Setup the mock implementation
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    }));
  });

  afterEach(() => {
    clearIntentCache();
  });
});

// ============================================
// Phase 3: Mood Detection Tests
// ============================================

describe("Phase 3: Mood Detection via ToneIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // localStorage is already mocked from earlier test suite
    if (typeof localStorage !== "undefined" && localStorage.clear) {
      localStorage.clear();
    }
    clearIntentCache();

    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    }));
  });

  // ============================================
  // Emotion-to-Mood Mapping Tests
  // ============================================

  describe("mapEmotionToMood", () => {
    it("should export mapEmotionToMood from moodKnobs", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood).toBeDefined();
      expect(typeof mapEmotionToMood).toBe("function");
    });

    it("should map 'happy' emotion to 'happy' mood", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("happy")).toBe("happy");
    });

    it("should map 'sad' emotion to 'sad' mood", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("sad")).toBe("sad");
    });

    it("should map 'frustrated' emotion to 'frustrated' mood", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("frustrated")).toBe("frustrated");
    });

    it("should map 'anxious' emotion to 'anxious' mood", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("anxious")).toBe("anxious");
    });

    it("should map 'excited' emotion to 'happy' mood (for pattern purposes)", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("excited")).toBe("happy");
    });

    it("should map 'angry' emotion to 'frustrated' mood", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("angry")).toBe("frustrated");
    });

    it("should return null for 'playful' (tone, not mood)", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("playful")).toBeNull();
    });

    it("should return null for 'dismissive' (tone, not mood)", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("dismissive")).toBeNull();
    });

    it("should return null for 'neutral'", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("neutral")).toBeNull();
    });

    it("should return null for 'mixed'", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood("mixed")).toBeNull();
    });
  });

  // ============================================
  // recordInteractionAsync with ToneIntent Tests
  // ============================================

  const testUserId = "test-user-intent";

  describe("recordInteractionAsync with ToneIntent (Simplified)", () => {
    it("should accept ToneIntent object", async () => {
      const {
        recordInteractionAsync,
        resetEmotionalMomentumAsync,
        getEmotionalMomentumAsync,
      } = await import("../moodKnobs");

      await resetEmotionalMomentumAsync();

      // Create a ToneIntent object
      const toneIntent = {
        sentiment: 0.7,
        primaryEmotion: "happy" as const,
        intensity: 0.8,
        isSarcastic: false,
        explanation: "Test tone",
      };

      // Should not throw
      await recordInteractionAsync(toneIntent, "Test message");

      // Should have recorded the interaction - check streak updated
      const momentum = await getEmotionalMomentumAsync();
      expect(momentum.positiveInteractionStreak).toBe(1);
    });

    it("should still accept number", async () => {
      const {
        recordInteractionAsync,
        resetEmotionalMomentumAsync,
        getEmotionalMomentumAsync,
      } = await import("../moodKnobs");

      await resetEmotionalMomentumAsync();

      // Should not throw with number
      await recordInteractionAsync(0.5, "Test message");

      const momentum = await getEmotionalMomentumAsync();
      // Tone 0.5 > 0.3 = positive, so streak should be 1
      expect(momentum.positiveInteractionStreak).toBe(1);
    });

    it("should extract sentiment from ToneIntent for mood calculations", async () => {
      const {
        recordInteractionAsync,
        resetEmotionalMomentumAsync,
        getEmotionalMomentumAsync,
      } = await import("../moodKnobs");

      await resetEmotionalMomentumAsync();

      const toneIntent = {
        sentiment: 0.9, // Very positive
        primaryEmotion: "happy" as const,
        intensity: 0.7,
        isSarcastic: false,
        explanation: "Very positive tone",
      };

      await recordInteractionAsync(toneIntent, "Great day!");

      const momentum = await getEmotionalMomentumAsync();
      // Simplified: mood level should be updated via weighted average
      // Initial mood 0, tone 0.9 -> 0 * 0.8 + 0.9 * 0.2 = 0.18
      expect(momentum.currentMoodLevel).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Simplified Mood Shift Tests (Intensity Removed)
  // ============================================

  describe("simplified mood shifts (no intensity modulation)", () => {
    it("should shift mood based on sentiment only (intensity removed)", async () => {
      const {
        recordInteractionAsync,
        resetEmotionalMomentumAsync,
        getEmotionalMomentumAsync,
      } = await import("../moodKnobs");

      // Start fresh
      await resetEmotionalMomentumAsync();

      // Record several positive interactions
      for (let i = 0; i < 5; i++) {
        await recordInteractionAsync(
          {
            sentiment: 0.8,
            primaryEmotion: "excited" as const,
            intensity: 0.95, // Intensity is now ignored
            isSarcastic: false,
          },
          "Feeling amazing!"
        );
      }

      const momentum = await getEmotionalMomentumAsync();

      // With simplified system, mood level uses weighted average
      // Each interaction: newMood = oldMood * 0.8 + tone * 0.2
      // After 5 interactions with 0.8 tone, mood should approach 0.8
      expect(momentum.currentMoodLevel).toBeGreaterThan(0);
      expect(momentum.positiveInteractionStreak).toBe(5);
    });

    it("should shift mood down with negative sentiment", async () => {
      const {
        recordInteractionAsync,
        resetEmotionalMomentumAsync,
        getEmotionalMomentumAsync,
      } = await import("../moodKnobs");

      await resetEmotionalMomentumAsync();

      // Record negative interaction
      await recordInteractionAsync(
        {
          sentiment: -0.7,
          primaryEmotion: "angry" as const,
          intensity: 0.9, // Intensity is now ignored
          isSarcastic: false,
        },
        "So frustrated!"
      );

      const momentum = await getEmotionalMomentumAsync();

      // Mood level should be negative after negative interaction
      expect(momentum.currentMoodLevel).toBeLessThan(0);
      // Streak should be 0 (negative tone < -0.2 decrements)
      expect(momentum.positiveInteractionStreak).toBe(0);
    });

    it("should update mood when passing number directly", async () => {
      const {
        recordInteractionAsync,
        resetEmotionalMomentumAsync,
        getEmotionalMomentumAsync,
      } = await import("../moodKnobs");

      await resetEmotionalMomentumAsync();

      // Record with number
      await recordInteractionAsync(0.8, "Positive message");

      const momentum = await getEmotionalMomentumAsync();

      // Should have recorded - streak should be 1 (tone > 0.3)
      expect(momentum.positiveInteractionStreak).toBe(1);
      expect(momentum.currentMoodLevel).toBeGreaterThan(0);
    });
  });

  // ============================================
  // ToneIntent Type Export Tests
  // ============================================

  describe("ToneIntent and PrimaryEmotion type exports", () => {
    it("should export ToneIntent type from moodKnobs", async () => {
      // This is a type check - if the import works and we can use it, the type is exported
      const moodKnobs = await import("../moodKnobs");

      // The function that uses ToneIntent should be available
      expect(moodKnobs.recordInteractionAsync).toBeDefined();
      expect(moodKnobs.mapEmotionToMood).toBeDefined();
    });

    it("should export PrimaryEmotion type from moodKnobs", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");

      // All valid PrimaryEmotion values should work
      const validEmotions = [
        "happy",
        "sad",
        "frustrated",
        "anxious",
        "excited",
        "angry",
        "playful",
        "dismissive",
        "neutral",
        "mixed",
      ] as const;

      for (const emotion of validEmotions) {
        // Should not throw for any valid emotion
        expect(() => mapEmotionToMood(emotion)).not.toThrow();
      }
    });
  });

  // ============================================
  // Pattern Detection with ToneIntent Tests
  // ============================================

  describe("userPatterns with ToneIntent", () => {
    it("should use LLM emotion for mood pattern when ToneIntent provided", async () => {
      // This test verifies the integration exists
      const { analyzeMessageForPatterns } = await import("../userPatterns");

      expect(analyzeMessageForPatterns).toBeDefined();

      // The function should accept optional ToneIntent parameter
      // (4th parameter as per our implementation)
    });
  });
});

// ============================================
// Phase 4: Topic Detection Tests
// ============================================

describe("Phase 4: Intent Service - LLM Topic Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();
    resetIntentClientForTesting();
    mockGenerateContent.mockReset();

    // Setup the mock implementation
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    }));
  });

  afterEach(() => {
    clearIntentCache();
  });
});

// ============================================
// Phase 4: userPatterns Integration Tests
// ============================================

describe("Phase 4: userPatterns with TopicIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();
    resetIntentClientForTesting();
    mockGenerateContent.mockReset();

    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    }));
  });

  it("should use LLM topics when TopicIntent is provided", async () => {
    const { analyzeMessageForPatterns } = await import("../userPatterns");

    const topicResult = {
      topics: ["work" as const],
      primaryTopic: "work" as const,
      emotionalContext: { work: "frustrated" },
      entities: ["boss"],
      explanation: "Work frustration",
    };

    const toneResult = {
      sentiment: -0.5,
      primaryEmotion: "frustrated" as const,
      intensity: 0.6,
      isSarcastic: false,
      explanation: "Frustrated tone",
    };

    // This should not throw
    const result = await analyzeMessageForPatterns(
      "My boss is really annoying",
      new Date(),
      toneResult,
      topicResult
    );

    // Result should be an array
    expect(Array.isArray(result)).toBe(true);
  });

  it("should use emotional context from TopicIntent for pattern tracking", async () => {
    const { analyzeMessageForPatterns } = await import("../userPatterns");

    const topicResult = {
      topics: ["work" as const, "health" as const],
      primaryTopic: "work" as const,
      emotionalContext: {
        work: "stressed",
        health: "neglected",
      },
      entities: [],
      explanation: "Multiple topics with different emotions",
    };

    const toneResult = {
      sentiment: -0.3,
      primaryEmotion: "anxious" as const,
      intensity: 0.5,
      isSarcastic: false,
      explanation: "Anxious tone",
    };

    // Should not throw - emotional context is used for richer pattern tracking
    const result = await analyzeMessageForPatterns(
      "Work stress is affecting my health",
      new Date(),
      toneResult,
      topicResult
    );

    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================
// Phase 5: Open Loop Detection Tests
// ============================================

describe("Phase 5: Intent Service - LLM Open Loop Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();
    resetIntentClientForTesting();
    mockGenerateContent.mockReset();

    // Setup the mock implementation
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    }));
  });

  afterEach(() => {
    clearIntentCache();
  });
});

// ============================================
// Phase 6: Relationship Signal Detection Tests
// ============================================

describe("Phase 6: Intent Service - LLM Relationship Signal Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();
    resetIntentClientForTesting();
    mockGenerateContent.mockReset();

    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    }));
  });

  afterEach(() => {
    clearIntentCache();
  });
});

// ============================================
// Phase 7: Unified Intent Detection Tests
// ============================================

describe("Phase 7: Intent Service - Unified Intent Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();
    resetIntentClientForTesting();
    mockGenerateContent.mockReset();

    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent
      }
    }));
  });

  describe("detectFullIntentLLM", () => {
    it("should detect deep talk milestone via inference for 'This got deep huh'", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            genuineMoment: { isGenuine: false, category: null, confidence: 0, explanation: "" },
            tone: { sentiment: 0, primaryEmotion: "neutral", intensity: 0, isSarcastic: false, explanation: "" },
            topics: { topics: [], primaryTopic: null, emotionalContext: [], entities: [], explanation: "" },
            openLoops: { hasFollowUp: false, loopType: null, topic: null, suggestedFollowUp: null, timeframe: null, salience: 0, explanation: "" },
            relationshipSignals: {
              isVulnerable: false,
              isSeekingSupport: false,
              isAcknowledgingSupport: false,
              isJoking: false,
              isDeepTalk: true,
              milestone: null, // LLM fails to set this explicitly
              milestoneConfidence: 0.8,
              isHostile: false,
              hostilityReason: null,
              explanation: "Meta-commentary"
            }
          })
        });

        const result = await detectFullIntentLLM("This got deep huh");

        expect(result.relationshipSignals.isDeepTalk).toBe(true);
        expect(result.relationshipSignals.milestone).toBe("first_deep_talk");
    });

    it("should return parsed values for all sections", async () => {
        mockGenerateContent.mockResolvedValueOnce({
            text: JSON.stringify({
              genuineMoment: { isGenuine: true, category: "depth", confidence: 0.9, explanation: "Genuine" },
              tone: { sentiment: 0.8, primaryEmotion: "happy", intensity: 0.7, isSarcastic: false, explanation: "Happy" },
              topics: { topics: ["work"], primaryTopic: "work", emotionalContext: [{ topic: "work", emotion: "excited" }], entities: ["project"], explanation: "Work" },
              openLoops: { hasFollowUp: true, loopType: "pending_event", topic: "launch", suggestedFollowUp: "How did it go?", timeframe: "tomorrow", salience: 0.9, explanation: "Loop" },
              relationshipSignals: { milestone: "first_support", milestoneConfidence: 0.9, isHostile: false, explanation: "Signal" }
            })
        });

        const result = await detectFullIntentLLM("I'm so excited about my project launch tomorrow!");

        expect(result.genuineMoment.isGenuine).toBe(true);
        expect(result.genuineMoment.category).toBe("depth");
        expect(result.tone.primaryEmotion).toBe("happy");
        expect(result.topics.topics).toContain("work");
        expect(result.openLoops.hasFollowUp).toBe(true);
        expect(result.relationshipSignals.milestone).toBe("first_support");
    });
  });
});

// ============================================
// Command Bypass - isFunctionalCommand Tests
// ============================================

describe("Command Bypass: isFunctionalCommand", () => {
  describe("should detect task commands", () => {
    it("should detect 'add task' commands", () => {
      expect(isFunctionalCommand("add task go to work")).toBe(true);
      expect(isFunctionalCommand("Add task buy groceries")).toBe(true);
      expect(isFunctionalCommand("ADD TASK call mom")).toBe(true);
    });

    it("should detect 'create task' commands", () => {
      expect(isFunctionalCommand("create task finish project")).toBe(true);
      expect(isFunctionalCommand("Create a task for tomorrow")).toBe(true);
    });

    it("should detect 'please' prefix commands", () => {
      expect(isFunctionalCommand("please add task water plants")).toBe(true);
      expect(isFunctionalCommand("Please create reminder for meeting")).toBe(true);
    });

    it("should detect 'can you' prefix commands", () => {
      expect(isFunctionalCommand("can you add task pick up dry cleaning")).toBe(true);
      expect(isFunctionalCommand("Can you create a reminder for 3pm")).toBe(true);
    });

    it("should detect delete/remove commands", () => {
      expect(isFunctionalCommand("delete task laundry")).toBe(true);
      expect(isFunctionalCommand("remove reminder meeting")).toBe(true);
      expect(isFunctionalCommand("clear my tasks")).toBe(true);
    });

    it("should detect list/show commands", () => {
      expect(isFunctionalCommand("list my tasks")).toBe(true);
      expect(isFunctionalCommand("show calendar")).toBe(true);
      expect(isFunctionalCommand("show my events")).toBe(true);
    });

    it("should detect schedule/reminder commands", () => {
      expect(isFunctionalCommand("schedule meeting at 3pm")).toBe(true);
      expect(isFunctionalCommand("remind me to call doctor")).toBe(true);
      expect(isFunctionalCommand("set reminder for dentist")).toBe(true);
    });

    it("should detect update/edit commands", () => {
      expect(isFunctionalCommand("update task deadline")).toBe(true);
      expect(isFunctionalCommand("edit reminder time")).toBe(true);
    });

    it("should detect complete/mark commands", () => {
      expect(isFunctionalCommand("complete task laundry")).toBe(true);
      expect(isFunctionalCommand("mark task done")).toBe(true);
      expect(isFunctionalCommand("check off task groceries")).toBe(true);
    });

    it("should detect cancel/dismiss commands", () => {
      expect(isFunctionalCommand("cancel reminder")).toBe(true);
      expect(isFunctionalCommand("dismiss alarm")).toBe(true);
    });
  });

  describe("should NOT detect conversational messages", () => {
    it("should not detect regular greetings", () => {
      expect(isFunctionalCommand("hello")).toBe(false);
      expect(isFunctionalCommand("hi there")).toBe(false);
      expect(isFunctionalCommand("hey kayley")).toBe(false);
    });

    it("should not detect emotional messages", () => {
      expect(isFunctionalCommand("I'm feeling stressed about work")).toBe(false);
      expect(isFunctionalCommand("I had an amazing day today!")).toBe(false);
      expect(isFunctionalCommand("I'm really worried about my interview")).toBe(false);
    });

    it("should not detect questions", () => {
      expect(isFunctionalCommand("what do you think about this?")).toBe(false);
      expect(isFunctionalCommand("how are you doing today?")).toBe(false);
      expect(isFunctionalCommand("can you help me understand something?")).toBe(false);
    });

    it("should not detect messages that mention tasks but aren't commands", () => {
      expect(isFunctionalCommand("I'm thinking about adding tasks to my routine")).toBe(false);
      expect(isFunctionalCommand("My mom wants me to create a task list")).toBe(false);
      expect(isFunctionalCommand("What tasks should I do tomorrow?")).toBe(false);
    });

    it("should not detect affirmations or emotional support", () => {
      expect(isFunctionalCommand("You're so smart!")).toBe(false);
      expect(isFunctionalCommand("I really appreciate you")).toBe(false);
      expect(isFunctionalCommand("Thank you for listening")).toBe(false);
    });

    it("should not detect story/context sharing", () => {
      expect(isFunctionalCommand("So my boss said the strangest thing today")).toBe(false);
      expect(isFunctionalCommand("Let me tell you what happened at the meeting")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings", () => {
      expect(isFunctionalCommand("")).toBe(false);
    });

    it("should handle whitespace-only strings", () => {
      expect(isFunctionalCommand("   ")).toBe(false);
    });

    it("should trim leading/trailing whitespace", () => {
      expect(isFunctionalCommand("   add task test   ")).toBe(true);
    });
  });
});
