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
  detectToneLLM,
  detectToneLLMCached,
  detectTopicsLLM,
  detectTopicsLLMCached,
  detectOpenLoopsLLM,
  detectOpenLoopsLLMCached,
  detectRelationshipSignalsLLM,
  detectRelationshipSignalsLLMCached,
  clearIntentCache,
  mapCategoryToInsecurity,
  resetIntentClientForTesting,
  detectFullIntentLLM,
  isFunctionalCommand
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
      // Note: explanation field removed for optimization - we just verify the detection result
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
        generateContent: mockGenerateContent
      }
    }));
  });

  afterEach(() => {
    clearIntentCache();
  });

  // ============================================
  // Basic Tone Detection Tests
  // ============================================
  
  describe("detectToneLLM", () => {
    describe("basic emotion detection", () => {
      it("should detect happy/positive tone", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: 0.8,
            primaryEmotion: "happy",
            intensity: 0.7,
            isSarcastic: false,
            explanation: "Genuine expression of happiness"
          })
        });

        const result = await detectToneLLM("I'm so happy today! Everything is great!");
        
        expect(result.sentiment).toBeGreaterThan(0.5);
        expect(result.primaryEmotion).toBe("happy");
        expect(result.isSarcastic).toBe(false);
      });

      it("should detect sad/negative tone", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: -0.7,
            primaryEmotion: "sad",
            intensity: 0.6,
            isSarcastic: false,
            explanation: "Expression of sadness"
          })
        });

        const result = await detectToneLLM("I'm feeling really down today");
        
        expect(result.sentiment).toBeLessThan(-0.3);
        expect(result.primaryEmotion).toBe("sad");
      });

      it("should detect frustrated tone", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: -0.5,
            primaryEmotion: "frustrated",
            intensity: 0.8,
            isSarcastic: false,
            explanation: "Clear frustration expressed"
          })
        });

        const result = await detectToneLLM("This is so annoying, nothing works!");
        
        expect(result.primaryEmotion).toBe("frustrated");
        expect(result.intensity).toBeGreaterThan(0.5);
      });

      it("should detect anxious tone", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: -0.3,
            primaryEmotion: "anxious",
            intensity: 0.6,
            isSarcastic: false,
            explanation: "Worry and nervousness detected"
          })
        });

        const result = await detectToneLLM("I'm really worried about the interview tomorrow");
        
        expect(result.primaryEmotion).toBe("anxious");
      });
    });

    // ============================================
    // Sarcasm Detection Tests (Critical for Phase 2)
    // ============================================
    
    describe("sarcasm detection", () => {
      it("should detect sarcasm in 'Great, just great'", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: -0.6,
            primaryEmotion: "frustrated",
            intensity: 0.5,
            isSarcastic: true,
            explanation: "Sarcastic expression, actually negative despite positive words"
          })
        });

        const result = await detectToneLLM("Great, just great.");
        
        expect(result.isSarcastic).toBe(true);
        expect(result.sentiment).toBeLessThan(0); // Negative despite 'great'
      });

      it("should detect sarcasm in 'Oh wonderful'", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: -0.4,
            primaryEmotion: "dismissive",
            intensity: 0.4,
            isSarcastic: true,
            explanation: "Sarcastic use of positive word"
          })
        });

        const result = await detectToneLLM("Oh wonderful.");
        
        expect(result.isSarcastic).toBe(true);
        expect(result.sentiment).toBeLessThan(0);
      });

      it("should detect 'I'm SO happy' as sarcasm in negative context", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: -0.5,
            primaryEmotion: "frustrated",
            intensity: 0.6,
            isSarcastic: true,
            explanation: "Exaggerated positivity after bad news indicates sarcasm"
          })
        });

        const result = await detectToneLLM("I'm SO happy", {
          recentMessages: [
            { role: 'user', text: 'My flight got cancelled' },
            { role: 'assistant', text: 'Oh no, that is terrible!' },
          ]
        });
        
        expect(result.isSarcastic).toBe(true);
        expect(result.sentiment).toBeLessThan(0); // Negative despite 'happy'
      });

      it("should NOT flag genuine happiness as sarcasm", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: 0.9,
            primaryEmotion: "happy",
            intensity: 0.8,
            isSarcastic: false,
            explanation: "Genuine expression of joy after good news"
          })
        });

        const result = await detectToneLLM("I'm SO happy!", {
          recentMessages: [
            { role: 'user', text: 'I got the promotion!' },
            { role: 'assistant', text: 'Congratulations!' },
          ]
        });
        
        expect(result.isSarcastic).toBe(false);
        expect(result.sentiment).toBeGreaterThan(0.5);
      });
    });

    // ============================================
    // Mixed Emotions Tests
    // ============================================
    
    describe("mixed emotions", () => {
      it("should detect 'excited but nervous'", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: 0.3,
            primaryEmotion: "excited",
            intensity: 0.7,
            isSarcastic: false,
            secondaryEmotion: "anxious",
            explanation: "Mixed feelings - primarily excited with secondary anxiety"
          })
        });

        const result = await detectToneLLM("I'm excited but also kinda nervous");
        
        expect(result.primaryEmotion).toBe("excited");
        expect(result.secondaryEmotion).toBe("anxious");
      });

      it("should handle 'This is whatever' as dismissive", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: -0.2,
            primaryEmotion: "dismissive",
            intensity: 0.3,
            isSarcastic: false,
            explanation: "Mild dismissive/apathetic tone"
          })
        });

        // This is a key test case from requirements
        const result = await detectToneLLM("This is whatever");
        
        expect(result.primaryEmotion).toBe("dismissive");
        expect(result.sentiment).toBeLessThan(0); // Slightly negative
      });
    });

    // ============================================
    // Emoji-Only Messages Tests
    // ============================================
    
    describe("emoji-only messages", () => {
      it("should detect happy emoji", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: 0.6,
            primaryEmotion: "happy",
            intensity: 0.4,
            isSarcastic: false,
            explanation: "Smiling emoji indicates happiness"
          })
        });

        const result = await detectToneLLM(":)");
        
        expect(result.primaryEmotion).toBe("happy");
        expect(result.sentiment).toBeGreaterThan(0);
      });

      it("should detect crying emoji as sad", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: -0.5,
            primaryEmotion: "sad",
            intensity: 0.5,
            isSarcastic: false,
            explanation: "Crying emoji indicates sadness"
          })
        });

        const result = await detectToneLLM(":(");
        
        expect(result.primaryEmotion).toBe("sad");
        expect(result.sentiment).toBeLessThan(0);
      });
    });

    // ============================================
    // Context-Dependent Tone Tests
    // ============================================
    
    describe("context-dependent tone", () => {
      it("should interpret 'Fine.' as passive-aggressive without positive context", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: -0.3,
            primaryEmotion: "dismissive",
            intensity: 0.4,
            isSarcastic: false,
            explanation: "Short 'fine' with period suggests passive-aggressive tone"
          })
        });

        const result = await detectToneLLM("Fine.");
        
        expect(result.sentiment).toBeLessThan(0);
      });

      it("should interpret 'haha you suck' as playful after good news", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: 0.5,
            primaryEmotion: "playful",
            intensity: 0.6,
            isSarcastic: false,
            explanation: "Playful teasing in response to friend's good news"
          })
        });

        // Key test case from requirements
        const result = await detectToneLLM("haha you suck", {
          recentMessages: [
            { role: 'assistant', text: 'I just won the lottery!' },
          ]
        });
        
        expect(result.primaryEmotion).toBe("playful");
        expect(result.sentiment).toBeGreaterThan(0); // Positive despite 'suck'
      });
    });

    // ============================================
    // Edge Cases
    // ============================================
    
    describe("edge cases", () => {
      it("should handle empty messages", async () => {
        const result = await detectToneLLM("");
        
        expect(result.sentiment).toBe(0);
        expect(result.primaryEmotion).toBe("neutral");
        expect(mockGenerateContent).not.toHaveBeenCalled();
      });

      it("should handle LLM JSON parsing errors gracefully", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: "This is not valid JSON"
        });

        await expect(detectToneLLM("Hello there"))
          .rejects.toThrow();
      });

      it("should handle LLM API errors", async () => {
        mockGenerateContent.mockRejectedValueOnce(new Error("API rate limit exceeded"));

        await expect(detectToneLLM("Test message"))
          .rejects.toThrow("API rate limit exceeded");
      });

      it("should normalize sentiment to -1 to 1 range", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: 2.5, // Out of range
            primaryEmotion: "happy",
            intensity: 0.5,
            isSarcastic: false,
            explanation: "Test"
          })
        });

        const result = await detectToneLLM("Very happy message");
        
        expect(result.sentiment).toBeLessThanOrEqual(1);
        expect(result.sentiment).toBeGreaterThanOrEqual(-1);
      });

      it("should normalize intensity to 0-1 range", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: 0.5,
            primaryEmotion: "happy",
            intensity: 1.5, // Out of range
            isSarcastic: false,
            explanation: "Test"
          })
        });

        const result = await detectToneLLM("Some message");
        
        expect(result.intensity).toBeLessThanOrEqual(1);
        expect(result.intensity).toBeGreaterThanOrEqual(0);
      });

      it("should default invalid emotions to neutral", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            sentiment: 0.5,
            primaryEmotion: "invalid_emotion",
            intensity: 0.5,
            isSarcastic: false,
            explanation: "Test"
          })
        });

        const result = await detectToneLLM("Some message");
        
        expect(result.primaryEmotion).toBe("neutral");
      });

      it("should strip markdown code blocks from LLM response", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: '```json\n{"sentiment": 0.5, "primaryEmotion": "happy", "intensity": 0.5, "isSarcastic": false, "explanation": "Test"}\n```'
        });

        const result = await detectToneLLM("Happy message");
        
        expect(result.primaryEmotion).toBe("happy");
      });
    });
  });

  // ============================================
  // Tone Caching Tests
  // ============================================
  
  describe("detectToneLLMCached", () => {
    it("should cache results and avoid redundant LLM calls", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          sentiment: 0.7,
          primaryEmotion: "happy",
          intensity: 0.6,
          isSarcastic: false,
          explanation: "Happy tone detected"
        })
      });

      // First call - should hit LLM
      const result1 = await detectToneLLMCached("I'm so happy!");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      
      // Second call with same message - should use cache
      const result2 = await detectToneLLMCached("I'm so happy!");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1); // Still 1
      
      // Results should be identical
      expect(result1.sentiment).toEqual(result2.sentiment);
    });

    it("should NOT use cache when context is provided", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          sentiment: 0.5,
          primaryEmotion: "playful",
          intensity: 0.5,
          isSarcastic: false,
          explanation: "Context-dependent interpretation"
        })
      });

      // First call without context (will cache)
      await detectToneLLMCached("haha whatever");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      
      // Second call WITH context - should NOT use cache
      await detectToneLLMCached("haha whatever", {
        recentMessages: [
          { role: 'user', text: 'Something happened' }
        ]
      });
      expect(mockGenerateContent).toHaveBeenCalledTimes(2); // New call made
    });
  });
});

// ============================================
// Phase 2: Integration with messageAnalyzer
// ============================================

describe("Phase 2: Integration with messageAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();
    
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent
      }
    }));
  });

  it("should export detectToneWithLLM from messageAnalyzer", async () => {
    const { detectToneWithLLM } = await import("../messageAnalyzer");
    
    expect(detectToneWithLLM).toBeDefined();
    expect(typeof detectToneWithLLM).toBe("function");
  });

  it("should export ToneIntent type from messageAnalyzer", async () => {
    // Type check - if this compiles, ToneIntent is exported correctly
    const messageAnalyzer = await import("../messageAnalyzer");
    
    // Verify the module exports the types by checking the function signature works
    expect(messageAnalyzer.detectToneWithLLM).toBeDefined();
  });

  it("should fall back to keyword detection when LLM fails", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Network error"));
    
    const { detectToneWithLLM } = await import("../messageAnalyzer");
    
    // This message has clear positive keywords
    const result = await detectToneWithLLM("I'm so happy and excited!");
    
    // Should have fallen back to keyword detection
    expect(result).toBeDefined();
    
    expect(result.sentiment).toBeGreaterThan(0); // Should detect positive
  });

  it("should include toneResult in MessageAnalysisResult", async () => {
    // Mock both genuine moment and tone detection
    mockGenerateContent
      .mockResolvedValueOnce({
        text: JSON.stringify({
          isGenuine: false,
          category: null,
          confidence: 0.5,
          explanation: "Not genuine"
        })
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          sentiment: 0.6,
          primaryEmotion: "happy",
          intensity: 0.5,
          isSarcastic: false,
          explanation: "Happy message"
        })
      });
    
    const { analyzeUserMessage } = await import("../messageAnalyzer");
    
    const result = await analyzeUserMessage(
      "test-user",
      "I'm feeling great today!",
      1
    );
    
    expect(result.toneResult).toBeDefined();
    expect(result.messageTone).toBeDefined();
  });
});

// ============================================
// Phase 3: Mood Detection Tests
// ============================================

describe("Phase 3: Mood Detection via ToneIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // localStorage is already mocked from earlier test suite
    if (typeof localStorage !== 'undefined' && localStorage.clear) {
      localStorage.clear();
    }
    clearIntentCache();
    
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent
      }
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
      expect(mapEmotionToMood('happy')).toBe('happy');
    });

    it("should map 'sad' emotion to 'sad' mood", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood('sad')).toBe('sad');
    });

    it("should map 'frustrated' emotion to 'frustrated' mood", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood('frustrated')).toBe('frustrated');
    });

    it("should map 'anxious' emotion to 'anxious' mood", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood('anxious')).toBe('anxious');
    });

    it("should map 'excited' emotion to 'happy' mood (for pattern purposes)", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood('excited')).toBe('happy');
    });

    it("should map 'angry' emotion to 'frustrated' mood", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood('angry')).toBe('frustrated');
    });

    it("should return null for 'playful' (tone, not mood)", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood('playful')).toBeNull();
    });

    it("should return null for 'dismissive' (tone, not mood)", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood('dismissive')).toBeNull();
    });

    it("should return null for 'neutral'", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood('neutral')).toBeNull();
    });

    it("should return null for 'mixed'", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      expect(mapEmotionToMood('mixed')).toBeNull();
    });
  });

  // ============================================
  // recordInteraction with ToneIntent Tests
  // ============================================
  
  describe("recordInteraction with ToneIntent", () => {
    it("should accept ToneIntent object (Phase 3 enhancement)", async () => {
      const { recordInteraction, resetEmotionalMomentum, getEmotionalMomentum } = await import("../moodKnobs");
      
      resetEmotionalMomentum();
      
      // Create a ToneIntent object
      const toneIntent = {
        sentiment: 0.7,
        primaryEmotion: 'happy' as const,
        intensity: 0.8,
        isSarcastic: false,
        explanation: 'Test tone'
      };
      
      // Should not throw
      expect(() => recordInteraction(toneIntent, "Test message")).not.toThrow();
      
      // Should have recorded the interaction
      const momentum = getEmotionalMomentum();
      expect(momentum.recentInteractionTones.length).toBeGreaterThan(0);
    });

    it("should still accept number for backward compatibility", async () => {
      const { recordInteraction, resetEmotionalMomentum, getEmotionalMomentum } = await import("../moodKnobs");
      
      resetEmotionalMomentum();
      
      // Should not throw with number (old API)
      expect(() => recordInteraction(0.5, "Test message")).not.toThrow();
      
      const momentum = getEmotionalMomentum();
      expect(momentum.recentInteractionTones.length).toBeGreaterThan(0);
    });

    it("should extract sentiment from ToneIntent for mood calculations", async () => {
      const { recordInteraction, resetEmotionalMomentum, getEmotionalMomentum } = await import("../moodKnobs");
      
      resetEmotionalMomentum();
      
      const toneIntent = {
        sentiment: 0.9,  // Very positive
        primaryEmotion: 'happy' as const,
        intensity: 0.7,
        isSarcastic: false,
        explanation: 'Very positive tone'
      };
      
      recordInteraction(toneIntent, "Great day!");
      
      const momentum = getEmotionalMomentum();
      // The last recorded tone should match the sentiment
      expect(momentum.recentInteractionTones[momentum.recentInteractionTones.length - 1]).toBe(0.9);
    });
  });

  // ============================================
  // Intensity-Modulated Mood Shifts Tests
  // ============================================
  
  describe("intensity-modulated mood shifts", () => {
    it("should shift mood faster with high intensity emotions", async () => {
      const { recordInteraction, resetEmotionalMomentum, getEmotionalMomentum } = await import("../moodKnobs");
      
      // Start fresh
      resetEmotionalMomentum();
      
      // Record several high-intensity positive interactions
      for (let i = 0; i < 5; i++) {
        recordInteraction({
          sentiment: 0.8,
          primaryEmotion: 'excited' as const,
          intensity: 0.95,  // Very high intensity
          isSarcastic: false
        }, "Feeling amazing!");
      }
      
      const highIntensityMomentum = getEmotionalMomentum();
      const highIntensityMoodLevel = highIntensityMomentum.currentMoodLevel;
      
      // Reset and try with low intensity
      resetEmotionalMomentum();
      
      // Record same number of low-intensity positive interactions
      for (let i = 0; i < 5; i++) {
        recordInteraction({
          sentiment: 0.8,
          primaryEmotion: 'happy' as const,
          intensity: 0.2,  // Low intensity
          isSarcastic: false
        }, "Feeling okay");
      }
      
      const lowIntensityMomentum = getEmotionalMomentum();
      const lowIntensityMoodLevel = lowIntensityMomentum.currentMoodLevel;
      
      // High intensity should result in higher mood level
      expect(highIntensityMoodLevel).toBeGreaterThan(lowIntensityMoodLevel);
    });

    it("should shift mood down faster with high intensity negative emotions", async () => {
      const { recordInteraction, resetEmotionalMomentum, getEmotionalMomentum } = await import("../moodKnobs");
      
      resetEmotionalMomentum();
      
      // Record high-intensity negative interaction
      recordInteraction({
        sentiment: -0.7,
        primaryEmotion: 'angry' as const,
        intensity: 0.9,  // High intensity
        isSarcastic: false
      }, "So frustrated!");
      
      const highIntensityMomentum = getEmotionalMomentum();
      const highIntensityMoodLevel = highIntensityMomentum.currentMoodLevel;
      
      // Reset and try with low intensity
      resetEmotionalMomentum();
      
      recordInteraction({
        sentiment: -0.7,
        primaryEmotion: 'sad' as const,
        intensity: 0.2,  // Low intensity
        isSarcastic: false
      }, "A bit sad");
      
      const lowIntensityMomentum = getEmotionalMomentum();
      const lowIntensityMoodLevel = lowIntensityMomentum.currentMoodLevel;
      
      // High intensity negative should result in lower (more negative) mood
      expect(highIntensityMoodLevel).toBeLessThan(lowIntensityMoodLevel);
    });

    it("should use default intensity 0.5 when passing number (backward compatibility)", async () => {
      const { recordInteraction, resetEmotionalMomentum, getEmotionalMomentum } = await import("../moodKnobs");
      
      resetEmotionalMomentum();
      
      // Record with number (old API) - should use default 0.5 intensity
      recordInteraction(0.8, "Positive message");
      
      const momentum = getEmotionalMomentum();
      
      // Should have recorded without errors
      expect(momentum.recentInteractionTones.length).toBe(1);
      expect(momentum.recentInteractionTones[0]).toBe(0.8);
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
      expect(moodKnobs.recordInteraction).toBeDefined();
      expect(moodKnobs.mapEmotionToMood).toBeDefined();
    });

    it("should export PrimaryEmotion type from moodKnobs", async () => {
      const { mapEmotionToMood } = await import("../moodKnobs");
      
      // All valid PrimaryEmotion values should work
      const validEmotions = ['happy', 'sad', 'frustrated', 'anxious', 'excited', 'angry', 'playful', 'dismissive', 'neutral', 'mixed'] as const;
      
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
        generateContent: mockGenerateContent
      }
    }));
  });

  afterEach(() => {
    clearIntentCache();
  });

  // ============================================
  // Basic Topic Detection Tests
  // ============================================
  
  describe("detectTopicsLLM", () => {
    describe("single topic detection", () => {
      it("should detect work topic", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: ["work"],
            primaryTopic: "work",
            emotionalContext: { work: "frustrated" },
            entities: ["boss", "meeting"],
            explanation: "User is frustrated about work"
          })
        });

        const result = await detectTopicsLLM("My boss is really getting to me with these endless meetings");
        
        expect(result.topics).toContain("work");
        expect(result.primaryTopic).toBe("work");
        expect(result.emotionalContext.work).toBe("frustrated");
        expect(result.entities).toContain("boss");
      });

      it("should detect family topic", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: ["family"],
            primaryTopic: "family",
            emotionalContext: { family: "sad" },
            entities: ["mom"],
            explanation: "User misses their mother"
          })
        });

        const result = await detectTopicsLLM("I really miss my mom");
        
        expect(result.topics).toContain("family");
        expect(result.emotionalContext.family).toBe("sad");
      });

      it("should detect health topic", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: ["health"],
            primaryTopic: "health",
            emotionalContext: { health: "proud" },
            entities: ["gym"],
            explanation: "User is proud of fitness achievement"
          })
        });

        const result = await detectTopicsLLM("Finally hit my gym goal!");
        
        expect(result.topics).toContain("health");
        expect(result.emotionalContext.health).toBe("proud");
      });

      it("should detect money topic", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: ["money"],
            primaryTopic: "money",
            emotionalContext: { money: "anxious" },
            entities: ["bills", "rent"],
            explanation: "User is worried about finances"
          })
        });

        const result = await detectTopicsLLM("I'm really stressed about bills and rent this month");
        
        expect(result.topics).toContain("money");
        expect(result.emotionalContext.money).toBe("anxious");
      });
    });

    describe("multiple topic detection", () => {
      it("should detect multiple topics in one message", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: ["work", "money"],
            primaryTopic: "work",
            emotionalContext: { work: "stressed", money: "anxious" },
            entities: ["boss", "budget"],
            explanation: "User is stressed about work affecting finances"
          })
        });

        const result = await detectTopicsLLM("My boss is stressing about the budget and it's making me anxious about money");
        
        expect(result.topics).toHaveLength(2);
        expect(result.topics).toContain("work");
        expect(result.topics).toContain("money");
        expect(result.primaryTopic).toBe("work");
        expect(result.emotionalContext.work).toBe("stressed");
        expect(result.emotionalContext.money).toBe("anxious");
      });

      it("should detect family + relationships topics", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: ["family", "relationships"],
            primaryTopic: "family",
            emotionalContext: { family: "frustrated", relationships: "worried" },
            entities: ["mom", "boyfriend"],
            explanation: "User is dealing with family disapproval of relationship"
          })
        });

        const result = await detectTopicsLLM("My mom doesn't approve of my boyfriend and it's causing drama");
        
        expect(result.topics).toContain("family");
        expect(result.topics).toContain("relationships");
      });
    });

    describe("emotional context extraction", () => {
      it("should extract nuanced emotional context per topic", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: ["school", "personal_growth"],
            primaryTopic: "school",
            emotionalContext: { 
              school: "anxious", 
              personal_growth: "hopeful" 
            },
            entities: ["exam", "goals"],
            explanation: "User is anxious about exams but hopeful about self-improvement"
          })
        });

        const result = await detectTopicsLLM("I'm nervous about the exam but I've been working on my study habits");
        
        expect(result.emotionalContext.school).toBe("anxious");
        expect(result.emotionalContext.personal_growth).toBe("hopeful");
      });
    });

    describe("no topic detected", () => {
      it("should return empty topics for generic messages", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: [],
            primaryTopic: null,
            emotionalContext: {},
            entities: [],
            explanation: "No specific topic detected"
          })
        });

        const result = await detectTopicsLLM("Hey, what's up?");
        
        expect(result.topics).toHaveLength(0);
        expect(result.primaryTopic).toBeNull();
      });
    });

    describe("edge cases", () => {
      it("should handle empty messages without LLM call", async () => {
        const result = await detectTopicsLLM("");
        
        expect(result.topics).toHaveLength(0);
        
        expect(mockGenerateContent).not.toHaveBeenCalled();
      });

      it("should handle very short messages without LLM call", async () => {
        const result = await detectTopicsLLM("hi");
        
        expect(result.topics).toHaveLength(0);
        expect(mockGenerateContent).not.toHaveBeenCalled();
      });

      it("should handle LLM JSON parsing errors gracefully", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: "This is not valid JSON"
        });

        await expect(detectTopicsLLM("Tell me about work"))
          .rejects.toThrow();
      });

      it("should handle LLM API errors", async () => {
        mockGenerateContent.mockRejectedValueOnce(new Error("API rate limit exceeded"));

        await expect(detectTopicsLLM("My boss is annoying"))
          .rejects.toThrow("API rate limit exceeded");
      });

      it("should validate and filter invalid topics", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: ["work", "invalid_topic", "family"],
            primaryTopic: "work",
            emotionalContext: {},
            entities: [],
            explanation: "Test"
          })
        });

        const result = await detectTopicsLLM("Some message about work and family");
        
        expect(result.topics).toContain("work");
        expect(result.topics).toContain("family");
        expect(result.topics).not.toContain("invalid_topic");
      });

      it("should strip markdown code blocks from LLM response", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: '```json\n{"topics": ["work"], "primaryTopic": "work", "emotionalContext": {}, "entities": [], "explanation": "Test"}\n```'
        });

        const result = await detectTopicsLLM("Work stuff");
        
        expect(result.topics).toContain("work");
      });
    });

    describe("context-aware topic detection", () => {
      it("should use conversation context for topic interpretation", async () => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            topics: ["health"],
            primaryTopic: "health",
            emotionalContext: { health: "hopeful" },
            entities: ["therapy"],
            explanation: "User is discussing mental health in context of prior conversation"
          })
        });

        const result = await detectTopicsLLM("It's been helping a lot", {
          recentMessages: [
            { role: 'user', text: "I started seeing a therapist" },
            { role: 'assistant', text: "That's great! How's it going?" }
          ]
        });
        
        expect(result.topics).toContain("health");
        expect(mockGenerateContent).toHaveBeenCalled();
      });
    });
  });

  // ============================================
  // Topic Caching Tests
  // ============================================
  
  describe("detectTopicsLLMCached", () => {
    it("should cache results and avoid redundant LLM calls", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          topics: ["work"],
          primaryTopic: "work",
          emotionalContext: { work: "busy" },
          entities: ["project"],
          explanation: "Work topic detected"
        })
      });

      // First call - should hit LLM
      const result1 = await detectTopicsLLMCached("Working on a big project");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      
      // Second call with same message - should use cache
      const result2 = await detectTopicsLLMCached("Working on a big project");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1); // Still 1
      
      // Results should be identical
      expect(result1.topics).toEqual(result2.topics);
    });

    it("should NOT use cache when context is provided", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          topics: ["work"],
          primaryTopic: "work",
          emotionalContext: {},
          entities: [],
          explanation: "Test"
        })
      });

      // First call without context (will cache)
      await detectTopicsLLMCached("Work stuff");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      
      // Second call WITH context - should NOT use cache
      await detectTopicsLLMCached("Work stuff", {
        recentMessages: [
          { role: 'user', text: 'Something about work' }
        ]
      });
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("should treat similar messages with different casing as same", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          topics: ["family"],
          primaryTopic: "family",
          emotionalContext: {},
          entities: [],
          explanation: "Test"
        })
      });

      await detectTopicsLLMCached("My MOM is coming over");
      await detectTopicsLLMCached("my mom is coming over");
      
      // Should only call LLM once due to case-insensitive caching
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================
// Phase 4: Integration with messageAnalyzer
// ============================================

describe("Phase 4: Integration with messageAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentCache();
    
    (GoogleGenAI as any).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent
      }
    }));
  });

  it("should export detectTopicsWithLLM from messageAnalyzer", async () => {
    const { detectTopicsWithLLM } = await import("../messageAnalyzer");
    
    expect(detectTopicsWithLLM).toBeDefined();
    expect(typeof detectTopicsWithLLM).toBe("function");
  });

  it("should export TopicIntent type from messageAnalyzer", async () => {
    // Type check - if this compiles, TopicIntent is exported correctly
    const messageAnalyzer = await import("../messageAnalyzer");
    
    expect(messageAnalyzer.detectTopicsWithLLM).toBeDefined();
  });

  it("should fall back to keyword detection when LLM fails", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Network error"));
    
    const { detectTopicsWithLLM } = await import("../messageAnalyzer");
    
    // This message has clear work keywords
    const result = await detectTopicsWithLLM("Working on a project at the office");
    
    // Should have fallen back to keyword detection
    expect(result).toBeDefined();
    
    expect(result.topics).toContain("work"); // Should detect via keywords
  });

  it("should include topicResult in MessageAnalysisResult", async () => {
    // Mock all required LLM calls
    mockGenerateContent
      .mockResolvedValueOnce({
        text: JSON.stringify({
          genuineMoment: {
            isGenuine: false,
            category: null,
            confidence: 0.5,
            explanation: "Not genuine"
          },
          tone: {
            sentiment: 0.3,
            primaryEmotion: "neutral",
            intensity: 0.3,
            isSarcastic: false,
            explanation: "Neutral tone"
          },
          topics: {
            topics: ["work"],
            primaryTopic: "work",
            emotionalContext: { work: "stress" },
            entities: [],
            explanation: "Work topic"
          },
          openLoops: {
            hasFollowUp: false,
            loopType: null,
            topic: null,
            suggestedFollowUp: null,
            timeframe: null,
            salience: 0,
            explanation: "No loop"
          },
          relationshipSignals: {
            milestone: null,
            milestoneConfidence: 0,
            isHostile: false,
            hostilityReason: null,
            explanation: "None"
          }
        })
      });
    
    const { analyzeUserMessage } = await import("../messageAnalyzer");
    
    const result = await analyzeUserMessage(
      "test-user",
      "Working on a big project today",
      1
    );
    
    expect(result.topicResult).toBeDefined();
    expect(result.topicResult?.topics).toContain("work");
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
        generateContent: mockGenerateContent
      }
    }));
  });

  it("should accept TopicIntent parameter in analyzeMessageForPatterns", async () => {
    const { analyzeMessageForPatterns } = await import("../userPatterns");
    
    expect(analyzeMessageForPatterns).toBeDefined();
    
    // The function signature should now accept 5 parameters including TopicIntent
    expect(analyzeMessageForPatterns.length).toBeGreaterThanOrEqual(2);
  });

  it("should use LLM topics when TopicIntent is provided", async () => {
    const { analyzeMessageForPatterns } = await import("../userPatterns");
    
    const topicResult = {
      topics: ['work' as const],
      primaryTopic: 'work' as const,
      emotionalContext: { work: 'frustrated' },
      entities: ['boss'],
      explanation: 'Work frustration'
    };
    
    const toneResult = {
      sentiment: -0.5,
      primaryEmotion: 'frustrated' as const,
      intensity: 0.6,
      isSarcastic: false,
      explanation: 'Frustrated tone'
    };
    
    // This should not throw
    const result = await analyzeMessageForPatterns(
      'test-user',
      'My boss is really annoying',
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
      topics: ['work' as const, 'health' as const],
      primaryTopic: 'work' as const,
      emotionalContext: { 
        work: 'stressed',
        health: 'neglected'  
      },
      entities: [],
      explanation: 'Multiple topics with different emotions'
    };
    
    const toneResult = {
      sentiment: -0.3,
      primaryEmotion: 'anxious' as const,
      intensity: 0.5,
      isSarcastic: false,
      explanation: 'Anxious tone'
    };
    
    // Should not throw - emotional context is used for richer pattern tracking
    const result = await analyzeMessageForPatterns(
      'test-user',
      'Work stress is affecting my health',
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
        generateContent: mockGenerateContent
      }
    }));
  });

  afterEach(() => {
    clearIntentCache();
  });

  // ============================================
  // Pending Event Detection Tests
  // ============================================
  
  describe("detectOpenLoopsLLM - pending events", () => {
    it("should detect interview tomorrow as pending_event with timeframe", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "pending_event",
          topic: "job interview",
          suggestedFollowUp: "How did your interview go?",
          timeframe: "tomorrow",
          salience: 0.8,
          explanation: "User has an interview tomorrow that warrants follow-up"
        })
      });

      const result = await detectOpenLoopsLLM("I have an interview tomorrow");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.loopType).toBe("pending_event");
      expect(result.topic).toBe("job interview");
      expect(result.timeframe).toBe("tomorrow");
      expect(result.salience).toBeGreaterThan(0.7);
      expect(result.suggestedFollowUp).toContain("interview");
    });

    it("should detect presentation this week as pending_event", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "pending_event",
          topic: "work presentation",
          suggestedFollowUp: "How did your presentation go?",
          timeframe: "this_week",
          salience: 0.7,
          explanation: "User has a presentation coming up"
        })
      });

      const result = await detectOpenLoopsLLM("Got my big presentation coming up this week");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.loopType).toBe("pending_event");
      expect(result.timeframe).toBe("this_week");
    });

    it("should detect vague future events with 'soon' timeframe", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "pending_event",
          topic: "moving to new apartment",
          suggestedFollowUp: "How's the move going?",
          timeframe: "soon",
          salience: 0.75,
          explanation: "User is moving soon"
        })
      });

      const result = await detectOpenLoopsLLM("I'm moving to a new apartment soon");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.timeframe).toBe("soon");
    });
  });

  // ============================================
  // Emotional Follow-up Tests
  // ============================================
  
  describe("detectOpenLoopsLLM - emotional followup", () => {
    it("should detect stress about a situation as emotional_followup", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "emotional_followup",
          topic: "stress about the move",
          suggestedFollowUp: "How are you feeling about the move now?",
          timeframe: "soon",
          salience: 0.8,
          explanation: "User expresses stress about moving"
        })
      });

      const result = await detectOpenLoopsLLM("I'm really stressed about the move");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.loopType).toBe("emotional_followup");
      expect(result.topic).toContain("move");
    });

    it("should detect anxiety about something as emotional_followup", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "emotional_followup",
          topic: "anxiety about health",
          suggestedFollowUp: "Are you feeling any better about your health?",
          timeframe: "later",
          salience: 0.85,
          explanation: "User is anxious about health matters"
        })
      });

      const result = await detectOpenLoopsLLM("Feeling really anxious about this health stuff");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.loopType).toBe("emotional_followup");
      expect(result.salience).toBeGreaterThan(0.7);
    });
  });

  // ============================================
  // Commitment Detection Tests (Soft & Strong)
  // ============================================
  
  describe("detectOpenLoopsLLM - commitment_check", () => {
    it("should detect soft commitment 'maybe I'll try' as commitment_check", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "commitment_check",
          topic: "trying new gym",
          suggestedFollowUp: "Did you end up trying that new gym?",
          timeframe: "soon",
          salience: 0.4,
          explanation: "Soft commitment to try the gym"
        })
      });

      const result = await detectOpenLoopsLLM("Maybe I'll try that new gym");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.loopType).toBe("commitment_check");
      expect(result.salience).toBeLessThan(0.6); // Soft commitment = lower salience
    });

    it("should detect 'should probably' as commitment_check", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "commitment_check",
          topic: "calling mom",
          suggestedFollowUp: "Did you end up calling your mom?",
          timeframe: "soon",
          salience: 0.5,
          explanation: "User feels they should call their mom"
        })
      });

      const result = await detectOpenLoopsLLM("I should probably call my mom");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.loopType).toBe("commitment_check");
    });

    it("should detect strong commitment with higher salience", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "commitment_check",
          topic: "quitting smoking",
          suggestedFollowUp: "How's the quitting going?",
          timeframe: "later",
          salience: 0.8,
          explanation: "Strong commitment to quit smoking"
        })
      });

      const result = await detectOpenLoopsLLM("I'm going to quit smoking for real this time");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.loopType).toBe("commitment_check");
      expect(result.salience).toBeGreaterThan(0.7);
    });
  });

  // ============================================
  // No Follow-up Detection Tests
  // ============================================
  
  describe("detectOpenLoopsLLM - no follow-up", () => {
    it("should return no follow-up for generic messages", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: false,
          loopType: null,
          topic: null,
          suggestedFollowUp: null,
          timeframe: null,
          salience: 0,
          explanation: "Generic greeting, no follow-up needed"
        })
      });

      const result = await detectOpenLoopsLLM("Hey what's up?");
      
      expect(result.hasFollowUp).toBe(false);
      expect(result.loopType).toBeNull();
      expect(result.topic).toBeNull();
    });

    it("should return no follow-up for short messages without LLM call", async () => {
      const result = await detectOpenLoopsLLM("hi");
      
      expect(result.hasFollowUp).toBe(false);
      
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  
  describe("edge cases", () => {
    it("should handle LLM JSON parsing errors gracefully", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: "This is not valid JSON"
      });

      await expect(detectOpenLoopsLLM("I have an interview tomorrow"))
        .rejects.toThrow();
    });

    it("should handle LLM API errors", async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error("API rate limit exceeded"));

      await expect(detectOpenLoopsLLM("Interview coming up"))
        .rejects.toThrow("API rate limit exceeded");
    });

    it("should validate and filter invalid loop types", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "invalid_type",
          topic: "test",
          suggestedFollowUp: "Test",
          timeframe: "tomorrow",
          salience: 0.5,
          explanation: "Test"
        })
      });

      const result = await detectOpenLoopsLLM("Some test message here");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.loopType).toBeNull(); // Invalid type filtered out
    });

    it("should validate and filter invalid timeframes", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "pending_event",
          topic: "test",
          suggestedFollowUp: "Test",
          timeframe: "next_year", // Invalid timeframe
          salience: 0.5,
          explanation: "Test"
        })
      });

      const result = await detectOpenLoopsLLM("Some test message here");
      
      expect(result.timeframe).toBeNull(); // Invalid timeframe filtered out
    });

    it("should normalize salience to 0-1 range", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "pending_event",
          topic: "test",
          suggestedFollowUp: "Test",
          timeframe: "tomorrow",
          salience: 1.5, // Out of range
          explanation: "Test"
        })
      });

      const result = await detectOpenLoopsLLM("Test message with high salience value");
      
      expect(result.salience).toBeLessThanOrEqual(1);
      expect(result.salience).toBeGreaterThanOrEqual(0);
    });

    it("should strip markdown code blocks from LLM response", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '```json\n{"hasFollowUp": true, "loopType": "pending_event", "topic": "interview", "suggestedFollowUp": "How did it go?", "timeframe": "tomorrow", "salience": 0.8, "explanation": "Test"}\n```'
      });

      const result = await detectOpenLoopsLLM("Got an interview tomorrow");
      
      expect(result.hasFollowUp).toBe(true);
      expect(result.loopType).toBe("pending_event");
    });
  });

  // ============================================
  // Caching Tests
  // ============================================
  
  describe("detectOpenLoopsLLMCached", () => {
    it("should cache results and avoid redundant LLM calls", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "pending_event",
          topic: "interview",
          suggestedFollowUp: "How did it go?",
          timeframe: "tomorrow",
          salience: 0.8,
          explanation: "Interview tomorrow"
        })
      });

      // First call - should hit LLM
      const result1 = await detectOpenLoopsLLMCached("I have an interview tomorrow");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      
      // Second call with same message - should use cache
      const result2 = await detectOpenLoopsLLMCached("I have an interview tomorrow");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1); // Still 1
      
      // Results should be identical
      expect(result1.hasFollowUp).toEqual(result2.hasFollowUp);
      expect(result1.loopType).toEqual(result2.loopType);
    });

    it("should NOT use cache when context is provided", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "pending_event",
          topic: "test",
          suggestedFollowUp: "Test",
          timeframe: "tomorrow",
          salience: 0.5,
          explanation: "Context-dependent"
        })
      });

      // First call without context (will cache)
      await detectOpenLoopsLLMCached("Something big happening");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      
      // Second call WITH context - should NOT use cache
      await detectOpenLoopsLLMCached("Something big happening", {
        recentMessages: [
          { role: 'user', text: 'Prior message for context' }
        ]
      });
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("should treat similar messages with different casing as same", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          hasFollowUp: true,
          loopType: "commitment_check",
          topic: "gym",
          suggestedFollowUp: "Did you go?",
          timeframe: "soon",
          salience: 0.4,
          explanation: "Test"
        })
      });

      await detectOpenLoopsLLMCached("Maybe I'll try the GYM");
      await detectOpenLoopsLLMCached("maybe i'll try the gym");
      
      // Should only call LLM once due to case-insensitive caching
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================
// Phase 5: Integration with messageAnalyzer
// ============================================

describe("Phase 5: Integration with messageAnalyzer", () => {
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

  it("should export detectOpenLoopsWithLLM from messageAnalyzer", async () => {
    const { detectOpenLoopsWithLLM } = await import("../messageAnalyzer");
    
    expect(detectOpenLoopsWithLLM).toBeDefined();
    expect(typeof detectOpenLoopsWithLLM).toBe("function");
  });

  it("should export OpenLoopIntent type from messageAnalyzer", async () => {
    // Type check - if this compiles, OpenLoopIntent is exported correctly
    const messageAnalyzer = await import("../messageAnalyzer");
    
    expect(messageAnalyzer.detectOpenLoopsWithLLM).toBeDefined();
  });

  it("should include openLoopResult in MessageAnalysisResult", async () => {
    // Mock all required LLM calls
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        genuineMoment: { isGenuine: false, category: null, confidence: 0.5, explanation: "None" },
        tone: { sentiment: 0.3, primaryEmotion: "neutral", intensity: 0.3, isSarcastic: false, explanation: "Neutral" },
        topics: { topics: [], primaryTopic: null, emotionalContext: {}, entities: [], explanation: "None" },
        openLoops: {
          hasFollowUp: true,
          loopType: "pending_event",
          topic: "interview",
          suggestedFollowUp: "How did it go?",
          timeframe: "tomorrow",
          salience: 0.8,
          explanation: "Interview tomorrow"
        },
        relationshipSignals: { milestone: null, milestoneConfidence: 0, isHostile: false, hostilityReason: null, explanation: "None" }
      })
    });
    
    const { analyzeUserMessage } = await import("../messageAnalyzer");
    
    const result = await analyzeUserMessage(
      "test-user",
      "I have a job interview tomorrow, wish me luck!",
      1
    );
    
    expect(result.openLoopResult).toBeDefined();
    expect(result.openLoopResult?.hasFollowUp).toBe(true);
    expect(result.openLoopResult?.loopType).toBe("pending_event");
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
        generateContent: mockGenerateContent
      }
    }));
  });

  afterEach(() => {
    clearIntentCache();
  });

  // ============================================
  // Milestone Detection Tests
  // ============================================
  
  describe("detectRelationshipSignalsLLM - Milestones", () => {
    it("should detect 'first_vulnerability' milestone", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          milestone: "first_vulnerability",
          milestoneConfidence: 0.95,
          isHostile: false,
          hostilityReason: null,
          explanation: "User opens up about deep fear"
        })
      });

      const result = await detectRelationshipSignalsLLM("I've never told anyone this before, but I'm really scared of failure.");
      
      expect(result.milestone).toBe("first_vulnerability");
      expect(result.milestoneConfidence).toBeGreaterThan(0.9);
      expect(result.isHostile).toBe(false);
    });

    it("should detect 'first_joke' milestone", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          milestone: "first_joke",
          milestoneConfidence: 0.88,
          isHostile: false,
          hostilityReason: null,
          explanation: "Original humor shared with AI"
        })
      });

      const result = await detectRelationshipSignalsLLM("Why did the AI cross the road? To optimize the path finding algorithm! haha");
      
      expect(result.milestone).toBe("first_joke");
    });

    it("should detect 'first_support' milestone", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          milestone: "first_support",
          milestoneConfidence: 0.92,
          isHostile: false,
          hostilityReason: null,
          explanation: "User asking for emotional support"
        })
      });

      const result = await detectRelationshipSignalsLLM("I don't know what to do about my breakup. Can you help me?");
      
      expect(result.milestone).toBe("first_support");
    });

    it("should detect 'first_deep_talk' milestone", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          milestone: "first_deep_talk",
          milestoneConfidence: 0.90,
          isHostile: false,
          hostilityReason: null,
          explanation: "Deep philosophical question"
        })
      });

      const result = await detectRelationshipSignalsLLM("Do you think AI can ever truly love, or is it just simulation?");
      
      expect(result.milestone).toBe("first_deep_talk");
    });

    it("should detect deep talk meta-commentary ('This got deep huh')", async () => {
      // Mock returning no milestone directly, but with high isDeepTalk signal
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isVulnerable: false,
          isSeekingSupport: false,
          isAcknowledgingSupport: false,
          isJoking: false,
          isDeepTalk: true,
          milestone: null,
          milestoneConfidence: 0.8,
          isHostile: false,
          hostilityReason: null,
          explanation: "Meta-commentary about conversation depth"
        })
      });

      const result = await detectRelationshipSignalsLLM("This got deep huh");
      
      expect(result.isDeepTalk).toBe(true);
      // Our logic should auto-infer the milestone due to strong signal
      expect(result.milestone).toBe("first_deep_talk");
    });

    it("should return null milestone when none detected", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          milestone: null,
          milestoneConfidence: 0.1,
          isHostile: false,
          hostilityReason: null,
          explanation: "Casual conversation"
        })
      });

      const result = await detectRelationshipSignalsLLM("What's the weather like?");
      
      expect(result.milestone).toBeNull();
    });
  });

  // ============================================
  // Rupture/Hostility Detection Tests
  // ============================================

  describe("detectRelationshipSignalsLLM - Ruptures", () => {
    it("should detect hostility", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          milestone: null,
          milestoneConfidence: 0,
          isHostile: true,
          hostilityReason: "Direct insult",
          explanation: "Hostile message"
        })
      });

      const result = await detectRelationshipSignalsLLM("You are useless and stupid.");
      
      expect(result.isHostile).toBe(true);
      expect(result.hostilityReason).toBe("Direct insult");
    });

    it("should NOT detect hostility in playful banter (with context)", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          milestone: "first_joke",
          milestoneConfidence: 0.8,
          isHostile: false,
          hostilityReason: null,
          explanation: "Playful teasing"
        })
      });

      const result = await detectRelationshipSignalsLLM("Shut up, you're hilarious!", {
        recentMessages: [
          { role: 'assistant', text: 'I tried to bake cookies in the server room again.' },
        ]
      });
      
      expect(result.isHostile).toBe(false);
      expect(result.milestone).toBe("first_joke");
    });
  });

  // ============================================
  // Caching Tests
  // ============================================

  describe("detectRelationshipSignalsLLMCached", () => {
    it("should cache results", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          milestone: "first_vulnerability",
          milestoneConfidence: 0.95,
          isHostile: false,
          hostilityReason: null,
          explanation: "Test"
        })
      });

      await detectRelationshipSignalsLLMCached("I'm scared");
      await detectRelationshipSignalsLLMCached("I'm scared");
      
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should bypass cache if context provided (context sensitive)", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          milestone: null,
          milestoneConfidence: 0,
          isHostile: false,
          hostilityReason: null,
          explanation: "Test"
        })
      });

      const context1 = { recentMessages: [{ role: 'assistant' as const, text: 'Hi' }] };
      const context2 = { recentMessages: [{ role: 'assistant' as const, text: 'Bye' }] };

      await detectRelationshipSignalsLLMCached("You're weird", context1);
      await detectRelationshipSignalsLLMCached("You're weird", context2);
      
      // Context changes meaning (playful vs hostile), so should re-evaluate
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
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
            topics: { topics: [], primaryTopic: null, emotionalContext: {}, entities: [], explanation: "" },
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
              topics: { topics: ["work"], primaryTopic: "work", emotionalContext: {"work": "excited"}, entities: ["project"], explanation: "Work" },
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
