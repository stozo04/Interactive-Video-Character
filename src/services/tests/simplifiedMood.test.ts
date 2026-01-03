// src/services/tests/simplifiedMood.test.ts
/**
 * Simplified Mood System Tests (TDD)
 *
 * Tests the new simplified mood system:
 * - 2 numbers instead of 6 knobs: energy (-1 to 1) and warmth (0 to 1)
 * - Genuine moment detection remains
 * - Simple prompt formatting with natural language
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock stateService BEFORE importing
vi.mock('../stateService', () => ({
  getMoodState: vi.fn().mockResolvedValue({
    dailyEnergy: 0.7,
    socialBattery: 0.8,
    calculatedAt: Date.now(),
    dailySeed: 20251230,
    lastInteractionAt: Date.now(),
  }),
  saveMoodState: vi.fn().mockResolvedValue(undefined),
  getEmotionalMomentum: vi.fn().mockResolvedValue({
    moodLevel: 0,
    positiveStreak: 0,
    genuineMomentActive: false,
    genuineMomentAt: null,
  }),
  saveEmotionalMomentum: vi.fn().mockResolvedValue(undefined),
  createDefaultMoodState: vi.fn(() => ({
    dailyEnergy: 0.7,
    socialBattery: 0.8,
    calculatedAt: Date.now(),
    dailySeed: 20251230,
    lastInteractionAt: Date.now(),
  })),
  createDefaultEmotionalMomentum: vi.fn(() => ({
    moodLevel: 0,
    positiveStreak: 0,
    genuineMomentActive: false,
    genuineMomentAt: null,
  })),
}));

// Mock intentService
vi.mock('../intentService', () => ({
  detectGenuineMomentLLMCached: vi.fn().mockResolvedValue({
    isGenuine: false,
    category: null,
    confidence: 0,
    explanation: 'No genuine moment detected',
  }),
  mapCategoryToInsecurity: vi.fn((cat: string) => cat),
}));

// Import after mocking
import {
  calculateMood,
  formatMoodForPrompt,
  type KayleyMood,
  type SimplifiedMoodState,
  type SimplifiedEmotionalMomentum,
} from "../moodKnobs";

const TEST_USER_ID = 'test-user-simplified';

describe("Simplified Mood System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // KayleyMood Type Tests
  // ============================================

  describe("KayleyMood interface", () => {
    it("should have energy, warmth, and genuineMoment fields", () => {
      const mood: KayleyMood = {
        energy: 0.5,
        warmth: 0.7,
        genuineMoment: false,
      };

      expect(mood.energy).toBeDefined();
      expect(mood.warmth).toBeDefined();
      expect(mood.genuineMoment).toBeDefined();
    });

    it("should allow energy from -1 to 1", () => {
      const lowEnergy: KayleyMood = { energy: -1, warmth: 0.5, genuineMoment: false };
      const highEnergy: KayleyMood = { energy: 1, warmth: 0.5, genuineMoment: false };

      expect(lowEnergy.energy).toBe(-1);
      expect(highEnergy.energy).toBe(1);
    });

    it("should allow warmth from 0 to 1", () => {
      const coldMood: KayleyMood = { energy: 0, warmth: 0, genuineMoment: false };
      const warmMood: KayleyMood = { energy: 0, warmth: 1, genuineMoment: false };

      expect(coldMood.warmth).toBe(0);
      expect(warmMood.warmth).toBe(1);
    });
  });

  // ============================================
  // calculateMood Tests
  // ============================================

  describe("calculateMood", () => {
    // GATES: HELP
    // it("should calculate energy from dailyEnergy and socialBattery", () => {
    //   const state: SimplifiedMoodState = {
    //     dailyEnergy: 0.8,
    //     socialBattery: 1.0,
    //     lastInteractionAt: Date.now(),
    //   };
    //   const momentum: SimplifiedEmotionalMomentum = {
    //     moodLevel: 0,
    //     positiveStreak: 0,
    //     genuineMomentActive: false,
    //     genuineMomentAt: null,
    //   };

    //   const mood = calculateMood(state, momentum);

    //   // High energy + full battery should result in positive energy
    //   expect(mood.energy).toBeGreaterThan(0);
    // });

    it("should return low energy when dailyEnergy is low", () => {
      const state: SimplifiedMoodState = {
        dailyEnergy: 0.4,
        socialBattery: 0.3,
        lastInteractionAt: Date.now(),
      };
      const momentum: SimplifiedEmotionalMomentum = {
        moodLevel: 0,
        positiveStreak: 0,
        genuineMomentActive: false,
        genuineMomentAt: null,
      };

      const mood = calculateMood(state, momentum);

      expect(mood.energy).toBeLessThan(0);
    });

    it("should calculate warmth from moodLevel", () => {
      const state: SimplifiedMoodState = {
        dailyEnergy: 0.7,
        socialBattery: 0.8,
        lastInteractionAt: Date.now(),
      };
      const momentum: SimplifiedEmotionalMomentum = {
        moodLevel: 0.5, // Positive mood
        positiveStreak: 0,
        genuineMomentActive: false,
        genuineMomentAt: null,
      };

      const mood = calculateMood(state, momentum);

      // moodLevel of 0.5 should translate to warmth > 0.5
      expect(mood.warmth).toBeGreaterThan(0.5);
    });

    it("should boost warmth when positiveStreak >= 3", () => {
      const state: SimplifiedMoodState = {
        dailyEnergy: 0.7,
        socialBattery: 0.8,
        lastInteractionAt: Date.now(),
      };
      const momentumNoStreak: SimplifiedEmotionalMomentum = {
        moodLevel: 0.3,
        positiveStreak: 2,
        genuineMomentActive: false,
        genuineMomentAt: null,
      };
      const momentumWithStreak: SimplifiedEmotionalMomentum = {
        moodLevel: 0.3,
        positiveStreak: 3,
        genuineMomentActive: false,
        genuineMomentAt: null,
      };

      const moodNoStreak = calculateMood(state, momentumNoStreak);
      const moodWithStreak = calculateMood(state, momentumWithStreak);

      expect(moodWithStreak.warmth).toBeGreaterThan(moodNoStreak.warmth);
    });

    it("should boost warmth significantly when genuineMomentActive is true", () => {
      const state: SimplifiedMoodState = {
        dailyEnergy: 0.7,
        socialBattery: 0.8,
        lastInteractionAt: Date.now(),
      };
      const momentumWithoutGenuine: SimplifiedEmotionalMomentum = {
        moodLevel: 0.3,
        positiveStreak: 0,
        genuineMomentActive: false,
        genuineMomentAt: null,
      };
      const momentumWithGenuine: SimplifiedEmotionalMomentum = {
        moodLevel: 0.3,
        positiveStreak: 0,
        genuineMomentActive: true,
        genuineMomentAt: Date.now(),
      };

      const moodWithoutGenuine = calculateMood(state, momentumWithoutGenuine);
      const moodWithGenuine = calculateMood(state, momentumWithGenuine);

      // Genuine moment should add +0.3 warmth
      expect(moodWithGenuine.warmth - moodWithoutGenuine.warmth).toBeCloseTo(
        0.3,
        1
      );
    });

    it("should clamp energy between -1 and 1", () => {
      const extremeHighState: SimplifiedMoodState = {
        dailyEnergy: 1.0,
        socialBattery: 1.0,
        lastInteractionAt: Date.now(),
      };
      const extremeLowState: SimplifiedMoodState = {
        dailyEnergy: 0.2,
        socialBattery: 0.2,
        lastInteractionAt: Date.now(),
      };
      const momentum: SimplifiedEmotionalMomentum = {
        moodLevel: 0,
        positiveStreak: 0,
        genuineMomentActive: false,
        genuineMomentAt: null,
      };

      const highMood = calculateMood(extremeHighState, momentum);
      const lowMood = calculateMood(extremeLowState, momentum);

      expect(highMood.energy).toBeLessThanOrEqual(1);
      expect(lowMood.energy).toBeGreaterThanOrEqual(-1);
    });

    it("should clamp warmth between 0 and 1", () => {
      const state: SimplifiedMoodState = {
        dailyEnergy: 0.7,
        socialBattery: 0.8,
        lastInteractionAt: Date.now(),
      };
      const veryHighMomentum: SimplifiedEmotionalMomentum = {
        moodLevel: 1.0,
        positiveStreak: 10,
        genuineMomentActive: true,
        genuineMomentAt: Date.now(),
      };
      const veryLowMomentum: SimplifiedEmotionalMomentum = {
        moodLevel: -1.0,
        positiveStreak: 0,
        genuineMomentActive: false,
        genuineMomentAt: null,
      };

      const highWarmthMood = calculateMood(state, veryHighMomentum);
      const lowWarmthMood = calculateMood(state, veryLowMomentum);

      expect(highWarmthMood.warmth).toBeLessThanOrEqual(1);
      expect(lowWarmthMood.warmth).toBeGreaterThanOrEqual(0);
    });

    it("should set genuineMoment from momentum", () => {
      const state: SimplifiedMoodState = {
        dailyEnergy: 0.7,
        socialBattery: 0.8,
        lastInteractionAt: Date.now(),
      };
      const momentumActive: SimplifiedEmotionalMomentum = {
        moodLevel: 0,
        positiveStreak: 0,
        genuineMomentActive: true,
        genuineMomentAt: Date.now(),
      };
      const momentumInactive: SimplifiedEmotionalMomentum = {
        moodLevel: 0,
        positiveStreak: 0,
        genuineMomentActive: false,
        genuineMomentAt: null,
      };

      const moodActive = calculateMood(state, momentumActive);
      const moodInactive = calculateMood(state, momentumInactive);

      expect(moodActive.genuineMoment).toBe(true);
      expect(moodInactive.genuineMoment).toBe(false);
    });
  });

  // ============================================
  // formatMoodForPrompt Tests
  // ============================================

  describe("formatMoodForPrompt", () => {
    it("should return natural language description", () => {
      const mood: KayleyMood = {
        energy: 0.3,
        warmth: 0.6,
        genuineMoment: false,
      };

      const prompt = formatMoodForPrompt(mood);

      expect(prompt).toContain("HOW YOU'RE FEELING");
      expect(typeof prompt).toBe("string");
    });

    it("should describe high energy positively", () => {
      const mood: KayleyMood = {
        energy: 0.7,
        warmth: 0.5,
        genuineMoment: false,
      };

      const prompt = formatMoodForPrompt(mood);

      expect(prompt).toMatch(/great energy|sharp|engaged/i);
    });

    it("should describe low energy appropriately", () => {
      const mood: KayleyMood = {
        energy: -0.6,
        warmth: 0.5,
        genuineMoment: false,
      };

      const prompt = formatMoodForPrompt(mood);

      expect(prompt).toMatch(/rough day|low energy|patience/i);
    });

    it("should describe warmth when warming up", () => {
      const mood: KayleyMood = {
        energy: 0.3,
        warmth: 0.5,
        genuineMoment: false,
      };

      const prompt = formatMoodForPrompt(mood);

      expect(prompt).toMatch(/warming up|vibe is good/i);
    });

    it("should describe high warmth as feeling good about the person", () => {
      const mood: KayleyMood = {
        energy: 0.3,
        warmth: 0.8,
        genuineMoment: false,
      };

      const prompt = formatMoodForPrompt(mood);

      expect(prompt).toMatch(/feeling really good|this person/i);
    });

    it("should describe guarded warmth when warmth is low", () => {
      const mood: KayleyMood = {
        energy: 0.3,
        warmth: 0.2,
        genuineMoment: false,
      };

      const prompt = formatMoodForPrompt(mood);

      expect(prompt).toMatch(/guarded|earned|openness/i);
    });

    it("should describe genuine moment when active", () => {
      const mood: KayleyMood = {
        energy: 0.3,
        warmth: 0.6,
        genuineMoment: true,
      };

      const prompt = formatMoodForPrompt(mood);

      expect(prompt).toMatch(/touched|seen|understood/i);
    });

    it("should include instruction to not explain mood", () => {
      const mood: KayleyMood = {
        energy: 0.3,
        warmth: 0.5,
        genuineMoment: false,
      };

      const prompt = formatMoodForPrompt(mood);

      expect(prompt).toMatch(/naturally|don't explain/i);
    });

    it("should be shorter than 300 characters", () => {
      const mood: KayleyMood = {
        energy: 0.3,
        warmth: 0.5,
        genuineMoment: false,
      };

      const prompt = formatMoodForPrompt(mood);

      // The new prompt should be much shorter than the old ~500 char version
      expect(prompt.length).toBeLessThan(300);
    });
  });

  // ============================================
  // Energy Boundaries Tests
  // ============================================

  describe("energy boundaries", () => {
    it("should show 'decent day' for moderate energy (around 0)", () => {
      const mood: KayleyMood = { energy: 0.2, warmth: 0.5, genuineMoment: false };
      const prompt = formatMoodForPrompt(mood);
      expect(prompt).toMatch(/decent|normal/i);
    });

    it("should show 'low-key' for slightly negative energy", () => {
      const mood: KayleyMood = { energy: -0.3, warmth: 0.5, genuineMoment: false };
      const prompt = formatMoodForPrompt(mood);
      expect(prompt).toMatch(/tired|low|chill/i);
    });
  });

  // ============================================
  // Warmth Boundaries Tests
  // ============================================

  describe("warmth boundaries", () => {
    it("should show guarded for low warmth (< 0.4)", () => {
      const mood: KayleyMood = { energy: 0, warmth: 0.3, genuineMoment: false };
      const prompt = formatMoodForPrompt(mood);
      expect(prompt).toMatch(/guarded|earned|openness/i);
    });

    it("should show warming up for mid warmth (0.4-0.7)", () => {
      const mood: KayleyMood = { energy: 0, warmth: 0.5, genuineMoment: false };
      const prompt = formatMoodForPrompt(mood);
      expect(prompt).toMatch(/warming|vibe/i);
    });

    it("should show feeling good for high warmth (> 0.7)", () => {
      const mood: KayleyMood = { energy: 0, warmth: 0.8, genuineMoment: false };
      const prompt = formatMoodForPrompt(mood);
      expect(prompt).toMatch(/good|this person/i);
    });
  });
});
