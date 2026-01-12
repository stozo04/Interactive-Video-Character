// src/services/tests/moodKnobs.test.ts
/**
 * Phase 2: Emotional Momentum System Tests (Async)
 * 
 * Tests the gradual mood shift logic:
 * - Bad day + 1 positive = still guarded
 * - Bad day + 3-4 positives = mood starts to shift
 * - Bad day + 6+ = she thaws
 * - EXCEPTION: Genuine moment addressing insecurity = instant shift
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock stateService BEFORE importing moodKnobs to prevent Supabase initialization
vi.mock('../stateService', () => ({
  getMoodState: vi.fn().mockResolvedValue({
    dailyEnergy: 0.7,
    socialBattery: 1.0,
    internalProcessing: false,
    calculatedAt: Date.now(),
    dailySeed: 20251215,
    lastInteractionAt: Date.now(),
    lastInteractionTone: 0,
  }),
  saveMoodState: vi.fn().mockResolvedValue(undefined),
  getEmotionalMomentum: vi.fn().mockResolvedValue({
    currentMoodLevel: 0,
    momentumDirection: 0,
    positiveInteractionStreak: 0,
    recentInteractionTones: [],
    genuineMomentDetected: false,
    lastGenuineMomentAt: null,
  }),
  saveEmotionalMomentum: vi.fn().mockResolvedValue(undefined),
  createDefaultMoodState: vi.fn(() => ({
    dailyEnergy: 0.7,
    socialBattery: 1.0,
    internalProcessing: false,
    calculatedAt: Date.now(),
    dailySeed: 20251215,
    lastInteractionAt: Date.now(),
    lastInteractionTone: 0,
  })),
  createDefaultEmotionalMomentum: vi.fn(() => ({
    currentMoodLevel: 0,
    momentumDirection: 0,
    positiveInteractionStreak: 0,
    recentInteractionTones: [],
    genuineMomentDetected: false,
    lastGenuineMomentAt: null,
  })),
}));

// Mock intentService with smart genuine moment detection
vi.mock('../intentService', () => ({
  detectGenuineMomentLLMCached: vi.fn().mockImplementation((message: string) => {
    // Simulate LLM detecting genuine moments for specific keywords
    const genuinePatterns = [
      { pattern: /proud of you/i, category: 'progress' },
      { pattern: /here for you/i, category: 'loneliness' },
      { pattern: /thoughtful|think deeply|smart/i, category: 'depth' },
    ];
    
    for (const { pattern, category } of genuinePatterns) {
      if (pattern.test(message)) {
        return Promise.resolve({
          isGenuine: true,
          category,
          confidence: 0.9,
          explanation: 'Mock detected genuine moment',
        });
      }
    }
    
    return Promise.resolve({
      isGenuine: false,
      category: null,
      confidence: 0,
      explanation: 'No genuine moment detected',
    });
  }),
}));

// Import after mocking
import {
  getEmotionalMomentumAsync,
  updateEmotionalMomentumAsync,
  resetEmotionalMomentumAsync,
  recordInteractionAsync,
  getMoodKnobsAsync,
  getMoodDescription,
  clearMoodKnobsCache,
} from "../moodKnobs";

const TEST_USER_ID = 'test-user-123';

describe("Phase 2: Emotional Momentum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMoodKnobsCache();
  });

  // ============================================
  // Emotional Momentum State Tests (Async)
  // ============================================

  describe("getEmotionalMomentumAsync", () => {
    it("should create fresh momentum state if none exists", async () => {
      const momentum = await getEmotionalMomentumAsync();
      
      expect(momentum.currentMoodLevel).toBe(0);
      expect(momentum.momentumDirection).toBe(0);
      expect(momentum.positiveInteractionStreak).toBe(0);
      expect(momentum.recentInteractionTones).toEqual([]);
      expect(momentum.genuineMomentDetected).toBe(false);
      expect(momentum.lastGenuineMomentAt).toBeNull();
    });

    it("should return stored momentum if exists", async () => {
      await getEmotionalMomentumAsync();
      await updateEmotionalMomentumAsync(0.8, "Great chat!");
      const retrieved = await getEmotionalMomentumAsync();
      
      expect(retrieved.recentInteractionTones.length).toBeGreaterThan(0);
    });
  });

  describe("resetEmotionalMomentumAsync", () => {
    it("should reset all momentum values to fresh state", async () => {
      await updateEmotionalMomentumAsync(0.8);
      await updateEmotionalMomentumAsync(0.7);
      await updateEmotionalMomentumAsync(0.9);
      
      const before = await getEmotionalMomentumAsync();
      expect(before.positiveInteractionStreak).toBeGreaterThan(0);
      
      await resetEmotionalMomentumAsync();
      
      const after = await getEmotionalMomentumAsync();
      expect(after.positiveInteractionStreak).toBe(0);
      expect(after.currentMoodLevel).toBe(0);
      expect(after.recentInteractionTones).toEqual([]);
    });
  });

  // ============================================
  // Gradual Mood Shift Tests
  // ============================================

  describe("updateEmotionalMomentumAsync - Gradual Shifts", () => {
    beforeEach(async () => {
      await resetEmotionalMomentumAsync();
    });

    it("1 positive interaction should NOT cause significant mood shift", async () => {
      const initial = await getEmotionalMomentumAsync();
      const afterOne = await updateEmotionalMomentumAsync(0.8, "haha that's funny!");
      
      expect(afterOne.positiveInteractionStreak).toBe(1);
      expect(afterOne.currentMoodLevel).toBeLessThan(0.1);
    });

    it("3-4 positive interactions should start to shift mood", async () => {
      await updateEmotionalMomentumAsync(0.6);
      await updateEmotionalMomentumAsync(0.7);
      await updateEmotionalMomentumAsync(0.8);
      const afterFour = await updateEmotionalMomentumAsync(0.7);
      
      expect(afterFour.positiveInteractionStreak).toBeGreaterThanOrEqual(3);
      expect(afterFour.currentMoodLevel).toBeGreaterThan(0);
    });

    it("6+ positive interactions should allow full thaw", async () => {
      for (let i = 0; i < 6; i++) {
        await updateEmotionalMomentumAsync(0.7 + (i * 0.02));
      }
      
      const afterSix = await getEmotionalMomentumAsync();
      
      expect(afterSix.positiveInteractionStreak).toBeGreaterThanOrEqual(6);
      expect(afterSix.currentMoodLevel).toBeGreaterThan(0.3);
    });

    it("negative interaction should reduce streak but NOT reset completely", async () => {
      await updateEmotionalMomentumAsync(0.7);
      await updateEmotionalMomentumAsync(0.8);
      await updateEmotionalMomentumAsync(0.7);
      await updateEmotionalMomentumAsync(0.8);
      
      const beforeNegative = await getEmotionalMomentumAsync();
      expect(beforeNegative.positiveInteractionStreak).toBe(4);
      
      const afterNegative = await updateEmotionalMomentumAsync(-0.5);
      
      expect(afterNegative.positiveInteractionStreak).toBe(2);
    });

    it("neutral interaction should NOT break momentum", async () => {
      await updateEmotionalMomentumAsync(0.7);
      await updateEmotionalMomentumAsync(0.8);
      await updateEmotionalMomentumAsync(0.7);
      
      const afterNeutral = await updateEmotionalMomentumAsync(0.1);
      
      expect(afterNeutral.positiveInteractionStreak).toBe(3);
    });
  });

  // ============================================
  // Genuine Moment Exception Tests
  // ============================================

  describe("updateEmotionalMomentumAsync - Genuine Moment Exception", () => {
    beforeEach(async () => {
      await resetEmotionalMomentumAsync();
    });

    it("genuine moment should cause INSTANT mood shift bypassing streak", async () => {
      const initial = await getEmotionalMomentumAsync();
      expect(initial.positiveInteractionStreak).toBe(0);
      
      const afterGenuine = await updateEmotionalMomentumAsync(
        0.9,
        "You're so thoughtful and smart, I love how you think deeply about things"
      );
      
      expect(afterGenuine.genuineMomentDetected).toBe(true);
      expect(afterGenuine.lastGenuineMomentAt).not.toBeNull();
      expect(afterGenuine.currentMoodLevel).toBeGreaterThanOrEqual(0.5);
      expect(afterGenuine.positiveInteractionStreak).toBeGreaterThanOrEqual(4);
    });

    it("genuine moment flag should persist for multiple interactions", async () => {
      await updateEmotionalMomentumAsync(0.9, "I'm so proud of you and how far you've come");
      const momentum = await updateEmotionalMomentumAsync(0.5, "that's cool");
      
      expect(momentum.genuineMomentDetected).toBe(true);
    });
  });

  // ============================================
  // Integration with getMoodKnobsAsync
  // ============================================

  describe("getMoodKnobsAsync - Momentum Integration", () => {
    beforeEach(async () => {
      await resetEmotionalMomentumAsync();
    });

    it("low streak should keep warmthAvailability guarded or neutral", async () => {
      await updateEmotionalMomentumAsync(0.7);
      await updateEmotionalMomentumAsync(0.7);
      
      const knobs = await getMoodKnobsAsync();
      
      expect(['guarded', 'neutral']).toContain(knobs.warmthAvailability);
    });

    it("high streak (6+) should allow warmthAvailability to shift", async () => {
      for (let i = 0; i < 7; i++) {
        await updateEmotionalMomentumAsync(0.8);
      }
      
      const knobs = await getMoodKnobsAsync();
      const momentum = await getEmotionalMomentumAsync();
      
      expect(momentum.positiveInteractionStreak).toBeGreaterThanOrEqual(6);
      expect(['neutral', 'open']).toContain(knobs.warmthAvailability);
    });

    it("genuine moment should enable path to open warmth", async () => {
      await updateEmotionalMomentumAsync(0.9, "You're not alone, I'm here for you always");
      
      const momentum = await getEmotionalMomentumAsync();
      expect(momentum.genuineMomentDetected).toBe(true);
      
      const knobs = await getMoodKnobsAsync();
      
      expect(['neutral', 'open']).toContain(knobs.warmthAvailability);
    });
  });

  // ============================================
  // recordInteractionAsync Integration
  // ============================================

  describe("recordInteractionAsync - Momentum Updates (Simplified)", () => {
    beforeEach(async () => {
      await resetEmotionalMomentumAsync();
    });

    it("should update emotional momentum when recording interaction", async () => {
      // With simplified system, we track positiveInteractionStreak (tone > 0.3 = increment)
      await recordInteractionAsync(0.8, "great chat!");

      const momentum = await getEmotionalMomentumAsync();
      // Simplified: no more recentInteractionTones tracking
      // Just streak increment for positive tone
      expect(momentum.positiveInteractionStreak).toBe(1);
      // Mood level should be updated via weighted average
      expect(momentum.currentMoodLevel).toBeGreaterThan(0);
    });

    it("should update mood level via weighted average", async () => {
      // Start with neutral mood (0), then apply positive tone (0.8)
      // New moodLevel = oldMoodLevel * 0.8 + tone * 0.2 = 0 * 0.8 + 0.8 * 0.2 = 0.16
      await recordInteractionAsync(0.8, "great chat!");

      const momentum = await getEmotionalMomentumAsync();
      expect(momentum.currentMoodLevel).toBeCloseTo(0.16, 1);
    });
  });

  // ============================================
  // getMoodDescription (uses cache)
  // ============================================

  describe("getMoodDescription", () => {
    beforeEach(async () => {
      await resetEmotionalMomentumAsync();
    });

    it("should include streak info when warming up", async () => {
      for (let i = 0; i < 4; i++) {
        await updateEmotionalMomentumAsync(0.8);
      }
      
      const description = getMoodDescription();
      
      expect(description).toContain('warming up');
    });

    it("should indicate thawed when streak is 6+", async () => {
      for (let i = 0; i < 7; i++) {
        await updateEmotionalMomentumAsync(0.8);
      }
      
      const description = getMoodDescription();
      
      expect(description).toContain('thawed');
    });

    it("should indicate genuine moment when active", async () => {
      await updateEmotionalMomentumAsync(0.9, "You're not alone, I'm here for you");
      
      const description = getMoodDescription();
      
      expect(description).toContain('genuine moment');
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe("Emotional Momentum - Edge Cases", () => {
    beforeEach(async () => {
      await resetEmotionalMomentumAsync();
    });

    it("should NOT shift mood with only 1 positive interaction", async () => {
      const momentum = await updateEmotionalMomentumAsync(0.8, "");
      
      expect(momentum.positiveInteractionStreak).toBe(1);
      expect(momentum.currentMoodLevel).toBeLessThan(0.1);
    });
    
    it("should shift mood after 5 positive interactions", async () => {
      for (let i = 0; i < 5; i++) {
        await updateEmotionalMomentumAsync(0.8, "");
      }
      
      const momentum = await getEmotionalMomentumAsync();
      expect(momentum.positiveInteractionStreak).toBe(5);
      expect(momentum.currentMoodLevel).toBeGreaterThan(0.3);
    });
    
    it("should maintain momentum direction across interactions", async () => {
      await updateEmotionalMomentumAsync(0.7, "");
      await updateEmotionalMomentumAsync(0.8, "");
      await updateEmotionalMomentumAsync(0.9, "");
      
      const momentum = await getEmotionalMomentumAsync();
      
      expect(momentum.momentumDirection).toBeGreaterThan(0);
    });

    it("should handle rapid sequence of mixed tone interactions", async () => {
      await updateEmotionalMomentumAsync(0.8, "great!");
      await updateEmotionalMomentumAsync(-0.3, "ugh");
      await updateEmotionalMomentumAsync(0.6, "okay");
      await updateEmotionalMomentumAsync(0.9, "amazing");
      
      const momentum = await getEmotionalMomentumAsync();
      
      expect(momentum.recentInteractionTones.length).toBeGreaterThanOrEqual(4);
    });
  });
});
