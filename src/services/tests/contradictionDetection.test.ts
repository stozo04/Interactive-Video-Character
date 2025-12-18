// src/services/tests/contradictionDetection.test.ts
/**
 * Tests for Contradiction Detection
 * 
 * Tests the contradiction detection feature that identifies when users
 * deny or dispute something previously discussed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock supabaseClient
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ data: [], error: null })),
      insert: vi.fn(() => ({ data: [], error: null })),
      update: vi.fn(() => ({ data: [], error: null })),
    })),
  },
}));

// Mock the Google GenAI module
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: vi.fn()
      }
    }))
  };
});

import { 
  detectFullIntentLLM,
  detectFullIntentLLMCached,
  clearIntentCache,
  resetIntentClientForTesting,
  type FullMessageIntent
} from "../intentService";
import { GoogleGenAI } from "@google/genai";

const mockGenerateContent = vi.fn();

describe("Contradiction Detection", () => {
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

  describe("detectFullIntentLLM - contradiction field", () => {
    it("should detect contradiction when user denies something", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          genuineMoment: { isGenuine: false, category: null, confidence: 0 },
          tone: { sentiment: 0, primaryEmotion: "neutral", intensity: 0.3, isSarcastic: false },
          topics: { topics: [], primaryTopic: null, emotionalContext: {}, entities: [] },
          openLoops: { hasFollowUp: false, loopType: null, topic: null, suggestedFollowUp: null, timeframe: null, salience: 0 },
          relationshipSignals: { milestone: null, milestoneConfidence: 0, isHostile: false, hostilityReason: null, isInappropriate: false, inappropriatenessReason: null },
          contradiction: {
            isContradicting: true,
            topic: "party",
            confidence: 0.9
          }
        })
      });

      const result = await detectFullIntentLLM("I don't have a party on my calendar");

      expect(result.contradiction).toBeDefined();
      expect(result.contradiction?.isContradicting).toBe(true);
      expect(result.contradiction?.topic).toBe("party");
      expect(result.contradiction?.confidence).toBeGreaterThan(0.6);
    });

    it("should not detect contradiction for normal messages", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          genuineMoment: { isGenuine: false, category: null, confidence: 0 },
          tone: { sentiment: 0.5, primaryEmotion: "happy", intensity: 0.5, isSarcastic: false },
          topics: { topics: ["work"], primaryTopic: "work", emotionalContext: {}, entities: [] },
          openLoops: { hasFollowUp: false, loopType: null, topic: null, suggestedFollowUp: null, timeframe: null, salience: 0 },
          relationshipSignals: { milestone: null, milestoneConfidence: 0, isHostile: false, hostilityReason: null, isInappropriate: false, inappropriatenessReason: null },
          contradiction: {
            isContradicting: false,
            topic: null,
            confidence: 0
          }
        })
      });

      const result = await detectFullIntentLLM("I'm excited about my meeting tomorrow");

      expect(result.contradiction).toBeDefined();
      expect(result.contradiction?.isContradicting).toBe(false);
      expect(result.contradiction?.topic).toBeNull();
    });

    it("should extract topic from contradiction", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          genuineMoment: { isGenuine: false, category: null, confidence: 0 },
          tone: { sentiment: -0.2, primaryEmotion: "frustrated", intensity: 0.4, isSarcastic: false },
          topics: { topics: [], primaryTopic: null, emotionalContext: {}, entities: [] },
          openLoops: { hasFollowUp: false, loopType: null, topic: null, suggestedFollowUp: null, timeframe: null, salience: 0 },
          relationshipSignals: { milestone: null, milestoneConfidence: 0, isHostile: false, hostilityReason: null, isInappropriate: false, inappropriatenessReason: null },
          contradiction: {
            isContradicting: true,
            topic: "meeting",
            confidence: 0.85
          }
        })
      });

      const result = await detectFullIntentLLM("That event isn't on my calendar");

      expect(result.contradiction?.isContradicting).toBe(true);
      expect(result.contradiction?.topic).toBe("meeting");
    });

    it("should handle various contradiction patterns", async () => {
      const testCases = [
        { message: "I don't have a party tonight", expectedTopic: "party" },
        { message: "That's not on my calendar", expectedTopic: "event" },
        { message: "I never mentioned a meeting", expectedTopic: "meeting" },
        { message: "That's wrong", expectedTopic: null }, // May not extract specific topic
      ];

      for (const testCase of testCases) {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            genuineMoment: { isGenuine: false, category: null, confidence: 0 },
            tone: { sentiment: 0, primaryEmotion: "neutral", intensity: 0.3, isSarcastic: false },
            topics: { topics: [], primaryTopic: null, emotionalContext: {}, entities: [] },
            openLoops: { hasFollowUp: false, loopType: null, topic: null, suggestedFollowUp: null, timeframe: null, salience: 0 },
            relationshipSignals: { milestone: null, milestoneConfidence: 0, isHostile: false, hostilityReason: null, isInappropriate: false, inappropriatenessReason: null },
            contradiction: {
              isContradicting: true,
              topic: testCase.expectedTopic,
              confidence: 0.8
            }
          })
        });

        const result = await detectFullIntentLLM(testCase.message);

        expect(result.contradiction?.isContradicting).toBe(true);
        if (testCase.expectedTopic) {
          expect(result.contradiction?.topic).toBe(testCase.expectedTopic);
        }
      }
    });

    it("should validate contradiction confidence threshold", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          genuineMoment: { isGenuine: false, category: null, confidence: 0 },
          tone: { sentiment: 0, primaryEmotion: "neutral", intensity: 0.3, isSarcastic: false },
          topics: { topics: [], primaryTopic: null, emotionalContext: {}, entities: [] },
          openLoops: { hasFollowUp: false, loopType: null, topic: null, suggestedFollowUp: null, timeframe: null, salience: 0 },
          relationshipSignals: { milestone: null, milestoneConfidence: 0, isHostile: false, hostilityReason: null, isInappropriate: false, inappropriatenessReason: null },
          contradiction: {
            isContradicting: true,
            topic: "party",
            confidence: 0.4 // Low confidence
          }
        })
      });

      const result = await detectFullIntentLLM("Maybe I don't have a party?");

      expect(result.contradiction?.isContradicting).toBe(true);
      expect(result.contradiction?.confidence).toBe(0.4);
      // Low confidence contradictions should still be detected, but may not trigger dismissal
    });
  });

  describe("validateFullIntent - contradiction validation", () => {
    it("should handle missing contradiction field gracefully", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          genuineMoment: { isGenuine: false, category: null, confidence: 0 },
          tone: { sentiment: 0, primaryEmotion: "neutral", intensity: 0.3, isSarcastic: false },
          topics: { topics: [], primaryTopic: null, emotionalContext: {}, entities: [] },
          openLoops: { hasFollowUp: false, loopType: null, topic: null, suggestedFollowUp: null, timeframe: null, salience: 0 },
          relationshipSignals: { milestone: null, milestoneConfidence: 0, isHostile: false, hostilityReason: null, isInappropriate: false, inappropriatenessReason: null }
          // No contradiction field
        })
      });

      const result = await detectFullIntentLLM("Normal message");

      // Should not throw, contradiction should be undefined
      expect(result.contradiction).toBeUndefined();
    });

    it("should normalize contradiction confidence to 0-1 range", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          genuineMoment: { isGenuine: false, category: null, confidence: 0 },
          tone: { sentiment: 0, primaryEmotion: "neutral", intensity: 0.3, isSarcastic: false },
          topics: { topics: [], primaryTopic: null, emotionalContext: {}, entities: [] },
          openLoops: { hasFollowUp: false, loopType: null, topic: null, suggestedFollowUp: null, timeframe: null, salience: 0 },
          relationshipSignals: { milestone: null, milestoneConfidence: 0, isHostile: false, hostilityReason: null, isInappropriate: false, inappropriatenessReason: null },
          contradiction: {
            isContradicting: true,
            topic: "party",
            confidence: 1.5 // Out of range
          }
        })
      });

      const result = await detectFullIntentLLM("I don't have a party");

      expect(result.contradiction?.confidence).toBeLessThanOrEqual(1);
      expect(result.contradiction?.confidence).toBeGreaterThanOrEqual(0);
    });
  });
});

