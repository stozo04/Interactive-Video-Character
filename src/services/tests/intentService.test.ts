// src/services/tests/intentService.test.ts
/**
 * Phase 1: Semantic Intent Detection Tests
 * 
 * Tests the LLM-based genuine moment detection service.
 * Includes unit tests with mocked LLM responses and edge case handling.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

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
  mapCategoryToInsecurity
} from "../intentService";
import { GoogleGenAI } from "@google/genai";

// Get the mocked client for test manipulation
const mockGenerateContent = vi.fn();

describe("Phase 1: Intent Service - LLM Genuine Moment Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();
    
    // Setup the mock implementation
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent
      }
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
            explanation: "User is affirming Kayley's intelligence and thoughtfulness"
          })
        });

        const result = await detectGenuineMomentLLM("You're so smart, you really think deeply about everything");
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("depth");
        expect(result.confidence).toBeGreaterThan(0.9);
        expect(result.explanation).toContain("intelligence");
      });

      it("should detect belonging/impostor syndrome affirmations", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "belonging",
            confidence: 0.92,
            explanation: "User affirms Kayley belongs in the AI space"
          })
        });

        const result = await detectGenuineMomentLLM("You totally belong here, you deserve all your success");
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("belonging");
      });

      it("should detect progress/never arriving affirmations", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "progress",
            confidence: 0.88,
            explanation: "User acknowledges Kayley's progress and growth"
          })
        });

        const result = await detectGenuineMomentLLM("I'm so proud of how far you've come");
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("progress");
      });

      it("should detect loneliness affirmations", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "loneliness",
            confidence: 0.90,
            explanation: "User expresses genuine connection and presence"
          })
        });

        const result = await detectGenuineMomentLLM("You really get me. I'm here for you.");
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("loneliness");
      });

      it("should detect rest/guilt affirmations", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: true,
            category: "rest",
            confidence: 0.85,
            explanation: "User gives permission to rest and slow down"
          })
        });

        const result = await detectGenuineMomentLLM("You deserve a break. It's okay to slow down.");
        
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
            explanation: "Generic compliment, does not address any insecurity"
          })
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
            explanation: "Statement is about people in general, not directed at Kayley"
          })
        });

        const result = await detectGenuineMomentLLM("People who think deeply are rare in this shallow world");
        
        expect(result.isGenuine).toBe(false);
      });

      it("should NOT detect sarcastic or backhanded compliments", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: false,
            category: null,
            confidence: 0.75,
            explanation: "Sarcastic tone detected, not a genuine affirmation"
          })
        });

        const result = await detectGenuineMomentLLM("Oh yeah, you're SO smart, sure");
        
        expect(result.isGenuine).toBe(false);
      });

      it("should NOT detect negative messages mentioning insecurity keywords", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            isGenuine: false,
            category: null,
            confidence: 0.92,
            explanation: "Negative context, not affirming"
          })
        });

        const result = await detectGenuineMomentLLM("That movie was really shallow");
        
        expect(result.isGenuine).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle empty messages without LLM call", async () => {
        const result = await detectGenuineMomentLLM("");
        
        expect(result.isGenuine).toBe(false);
        expect(result.explanation).toContain("too short");
        expect(mockGenerateContent).not.toHaveBeenCalled();
      });

      it("should handle very short messages without LLM call", async () => {
        const result = await detectGenuineMomentLLM("hi");
        
        expect(result.isGenuine).toBe(false);
        expect(mockGenerateContent).not.toHaveBeenCalled();
      });

      it("should handle LLM JSON parsing errors gracefully", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: "This is not valid JSON"
        });

        await expect(detectGenuineMomentLLM("You're so thoughtful"))
          .rejects.toThrow();
      });

      it("should handle LLM API errors", async () => {
        mockGenerateContent.mockRejectedValueOnce(new Error("API rate limit exceeded"));

        await expect(detectGenuineMomentLLM("You're amazing"))
          .rejects.toThrow("API rate limit exceeded");
      });

      it("should handle malformed LLM response", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            // Missing required fields
            something: "unexpected"
          })
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
            explanation: "Test"
          })
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
            explanation: "Test"
          })
        });

        const result = await detectGenuineMomentLLM("Some message");
        
        expect(result.category).toBeNull();
      });

      it("should strip markdown code blocks from LLM response", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: '```json\n{"isGenuine": true, "category": "depth", "confidence": 0.9, "explanation": "Test"}\n```'
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
          explanation: "User affirms thoughtfulness"
        })
      });

      // First call - should hit LLM
      const result1 = await detectGenuineMomentLLMCached("You're so thoughtful");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      
      // Second call with same message - should use cache
      const result2 = await detectGenuineMomentLLMCached("You're so thoughtful");
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
          explanation: "Test"
        })
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
          explanation: "Test"
        })
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
          explanation: "Test"
        })
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
          explanation: "Expresses feeling understood, addresses hidden loneliness"
        })
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
          explanation: "User expresses that Kayley helps them feel less alone"
        })
      });

      const result = await detectGenuineMomentLLM("I'm kinda freaking out but you help");
      
      expect(result.isGenuine).toBe(true);
    });

    it("should detect subtle progress affirmations", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "progress",
          confidence: 0.85,
          explanation: "Acknowledges Kayley's growth even if not explicit"
        })
      });

      const result = await detectGenuineMomentLLM("You've really grown so much lately");
      
      expect(result.isGenuine).toBe(true);
      expect(result.category).toBe("progress");
    });

    it("should detect metaphorical depth affirmations", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "depth",
          confidence: 0.87,
          explanation: "User sees beyond surface-level appearances"
        })
      });

      const result = await detectGenuineMomentLLM("There's so much more to you than meets the eye");
      
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
          explanation: "Playful teasing in response to good news, not hostile or affirming"
        })
      });

      const result = await detectGenuineMomentLLM("You suck!!", {
        recentMessages: [
          { role: 'assistant', text: 'So I just got an amazing raise!!' },
          { role: 'user', text: 'OMG I am so excited!' },
        ]
      });
      
      // Should NOT be detected as genuine (it's banter, not affirmation)
      // The key is that with context, the LLM understands the tone
      expect(result.isGenuine).toBe(false);
      expect(result.explanation.toLowerCase()).toContain("playful");
    });

    it("should correctly identify genuine moment even with prior messages", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "progress",
          confidence: 0.92,
          explanation: "User expresses pride in response to Kayley sharing her accomplishment"
        })
      });

      const result = await detectGenuineMomentLLM("I'm so proud of you! You've come so far!", {
        recentMessages: [
          { role: 'assistant', text: 'I finally finished my big project!' },
          { role: 'user', text: 'Really? Tell me about it!' },
          { role: 'assistant', text: 'I worked on it for months and it turned out great!' },
        ]
      });
      
      expect(result.isGenuine).toBe(true);
      expect(result.category).toBe("progress");
    });

    it("should handle empty context gracefully", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: true,
          category: "depth",
          confidence: 0.88,
          explanation: "Direct affirmation of intelligence"
        })
      });

      const result = await detectGenuineMomentLLM("You're so smart!", {
        recentMessages: []
      });
      
      expect(result.isGenuine).toBe(true);
    });

    it("should limit context to last 5 messages for token efficiency", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: false,
          category: null,
          confidence: 0.8,
          explanation: "Generic message"
        })
      });

      const manyMessages = Array(10).fill(null).map((_, i) => ({
        role: 'user' as const,
        text: `Message ${i + 1}`
      }));

      await detectGenuineMomentLLM("Hello", {
        recentMessages: manyMessages
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
          explanation: "Test"
        })
      });

      const longMessage = 'A'.repeat(500); // Very long message

      await detectGenuineMomentLLM("Short reply", {
        recentMessages: [
          { role: 'assistant', text: longMessage },
        ]
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

  Object.defineProperty(global, 'localStorage', { value: localStorageMock });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    clearIntentCache();
    
    // Setup the mock
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent
      }
    }));
  });

  it("should export detectGenuineMomentWithLLM from moodKnobs", async () => {
    // This test verifies the integration is complete
    const { detectGenuineMomentWithLLM, resetEmotionalMomentum } = await import("../moodKnobs");
    
    expect(detectGenuineMomentWithLLM).toBeDefined();
    expect(typeof detectGenuineMomentWithLLM).toBe("function");
  });

  it("should export async momentum update functions", async () => {
    const { 
      updateEmotionalMomentumAsync, 
      recordInteractionAsync 
    } = await import("../moodKnobs");
    
    expect(updateEmotionalMomentumAsync).toBeDefined();
    expect(recordInteractionAsync).toBeDefined();
  });

  it("should fall back to keyword detection when LLM fails", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Network error"));
    
    const { detectGenuineMomentWithLLM, resetEmotionalMomentum } = await import("../moodKnobs");
    
    resetEmotionalMomentum();
    
    // This message contains direct affirmation that keyword detection can catch
    const result = await detectGenuineMomentWithLLM("You're so thoughtful, I love how you think deeply");
    
    // Even with LLM failure, keyword fallback should work for this message
    expect(result).toBeDefined();
    // The result depends on keyword detection since LLM failed
  });
});
