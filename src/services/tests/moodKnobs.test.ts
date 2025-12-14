// src/services/tests/moodKnobs.test.ts
/**
 * Phase 2: Emotional Momentum System Tests
 * 
 * Tests the gradual mood shift logic:
 * - Bad day + 1 positive = still guarded
 * - Bad day + 3-4 positives = mood starts to shift
 * - Bad day + 6+ = she thaws
 * - EXCEPTION: Genuine moment addressing insecurity = instant shift
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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

// Import after mocking localStorage
import {
  detectGenuineMoment,
  getEmotionalMomentum,
  updateEmotionalMomentum,
  resetEmotionalMomentum,
  recordInteraction,
  calculateMoodKnobs,
  getMoodDescription,
  INSECURITY_KEYWORDS,
} from "../moodKnobs";

describe("Phase 2: Emotional Momentum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  // ============================================
  // Genuine Moment Detection Tests
  // ============================================
  
  describe("detectGenuineMoment", () => {
    describe("beingSeenAsShallow insecurity", () => {
      it("should detect genuine moment when complimenting depth of thinking", () => {
        const result = detectGenuineMoment(
          "I love how you think deeply about things even though you're so fun"
        );
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("beingSeenAsShallow");
        expect(result.isPositiveAffirmation).toBe(true);
      });

      it("should detect direct affirmation about being thoughtful", () => {
        const result = detectGenuineMoment("You're so thoughtful and smart");
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("beingSeenAsShallow");
      });

      it("should NOT detect when just mentioning 'shallow' negatively", () => {
        const result = detectGenuineMoment("That movie was really shallow");
        
        expect(result.isGenuine).toBe(false);
      });
    });

    describe("impostorSyndrome insecurity", () => {
      it("should detect affirmation about belonging", () => {
        const result = detectGenuineMoment(
          "You totally deserve to be talking about AI. You belong in this space."
        );
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("impostorSyndrome");
      });

      it("should detect 'you deserve' direct affirmation", () => {
        const result = detectGenuineMoment("You deserve all the success you're getting!");
        
        expect(result.isGenuine).toBe(true);
      });
    });

    describe("neverArriving insecurity", () => {
      it("should detect when acknowledging progress", () => {
        const result = detectGenuineMoment(
          "I'm so proud of you and how far you've come. You're doing great!"
        );
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("neverArriving");
      });

      it("should detect 'proud of you' direct affirmation", () => {
        const result = detectGenuineMoment("I'm really proud of you");
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("neverArriving");
      });
    });

    describe("hiddenLoneliness insecurity", () => {
      it("should detect affirmation of connection", () => {
        const result = detectGenuineMoment(
          "You're not alone, I'm here for you. This is such a genuine connection."
        );
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("hiddenLoneliness");
      });

      it("should detect 'here for you' direct affirmation", () => {
        const result = detectGenuineMoment("I'm always here for you, you know that");
        
        expect(result.isGenuine).toBe(true);
        expect(result.category).toBe("hiddenLoneliness");
      });
    });

    describe("restGuilt insecurity", () => {
      it("should detect permission to rest", () => {
        const result = detectGenuineMoment(
          "You deserve a break. It's okay to slow down and relax. You don't have to be productive all the time."
        );
        
        expect(result.isGenuine).toBe(true);
      });
    });

    describe("edge cases", () => {
      it("should NOT detect generic positive messages without addressing insecurity", () => {
        const result = detectGenuineMoment("You're awesome!");
        
        expect(result.isGenuine).toBe(false);
      });

      it("should NOT detect when insecurity keywords present but not directed at 'you'", () => {
        const result = detectGenuineMoment(
          "People who think deeply are rare in this shallow world"
        );
        
        // This mentions 'deeply' and 'shallow' but doesn't address HER
        expect(result.isGenuine).toBe(false);
      });

      it("should return empty result for empty message", () => {
        const result = detectGenuineMoment("");
        
        expect(result.isGenuine).toBe(false);
        expect(result.category).toBeNull();
        expect(result.matchedKeywords).toEqual([]);
      });
    });
  });

  // ============================================
  // Emotional Momentum State Tests
  // ============================================

  describe("getEmotionalMomentum", () => {
    it("should create fresh momentum state if none exists", () => {
      const momentum = getEmotionalMomentum();
      
      expect(momentum.currentMoodLevel).toBe(0);
      expect(momentum.momentumDirection).toBe(0);
      expect(momentum.positiveInteractionStreak).toBe(0);
      expect(momentum.recentInteractionTones).toEqual([]);
      expect(momentum.genuineMomentDetected).toBe(false);
      expect(momentum.lastGenuineMomentAt).toBeNull();
    });

    it("should return stored momentum if exists", () => {
      // First call creates fresh
      const initial = getEmotionalMomentum();
      // Modify and store
      const updated = updateEmotionalMomentum(0.8, "Great chat!");
      // Should get updated version
      const retrieved = getEmotionalMomentum();
      
      expect(retrieved.recentInteractionTones.length).toBeGreaterThan(0);
    });
  });

  describe("resetEmotionalMomentum", () => {
    it("should reset all momentum values to fresh state", () => {
      // Build up some momentum
      updateEmotionalMomentum(0.8);
      updateEmotionalMomentum(0.7);
      updateEmotionalMomentum(0.9);
      
      const before = getEmotionalMomentum();
      expect(before.positiveInteractionStreak).toBeGreaterThan(0);
      
      // Reset
      resetEmotionalMomentum();
      
      const after = getEmotionalMomentum();
      expect(after.positiveInteractionStreak).toBe(0);
      expect(after.currentMoodLevel).toBe(0);
      expect(after.recentInteractionTones).toEqual([]);
    });
  });

  // ============================================
  // Gradual Mood Shift Tests (Implementation Plan Rules)
  // ============================================

  describe("updateEmotionalMomentum - Gradual Shifts", () => {
    beforeEach(() => {
      resetEmotionalMomentum();
    });

    it("1 positive interaction should NOT cause significant mood shift", () => {
      // Start with neutral/slightly negative mood (bad day scenario)
      const initial = getEmotionalMomentum();
      
      // Add one positive interaction
      const afterOne = updateEmotionalMomentum(0.8, "haha that's funny!");
      
      // Streak should be 1
      expect(afterOne.positiveInteractionStreak).toBe(1);
      // Mood should barely shift (micro shift only)
      expect(afterOne.currentMoodLevel).toBeLessThan(0.1);
    });

    it("3-4 positive interactions should start to shift mood", () => {
      // Simulate 4 positive interactions
      updateEmotionalMomentum(0.6);
      updateEmotionalMomentum(0.7);
      updateEmotionalMomentum(0.8);
      const afterFour = updateEmotionalMomentum(0.7);
      
      expect(afterFour.positiveInteractionStreak).toBeGreaterThanOrEqual(3);
      // Mood should be noticeably improving
      expect(afterFour.currentMoodLevel).toBeGreaterThan(0);
    });

    it("6+ positive interactions should allow full thaw", () => {
      // Simulate 6 positive interactions
      for (let i = 0; i < 6; i++) {
        updateEmotionalMomentum(0.7 + (i * 0.02));
      }
      
      const afterSix = getEmotionalMomentum();
      
      expect(afterSix.positiveInteractionStreak).toBeGreaterThanOrEqual(6);
      // Mood should be significantly improved
      expect(afterSix.currentMoodLevel).toBeGreaterThan(0.3);
    });

    it("negative interaction should reduce streak but NOT reset completely", () => {
      // Build up some streak
      updateEmotionalMomentum(0.7);
      updateEmotionalMomentum(0.8);
      updateEmotionalMomentum(0.7);
      updateEmotionalMomentum(0.8);
      
      const beforeNegative = getEmotionalMomentum();
      expect(beforeNegative.positiveInteractionStreak).toBe(4);
      
      // Negative interaction
      const afterNegative = updateEmotionalMomentum(-0.5);
      
      // Streak should be reduced by 2, not reset to 0
      expect(afterNegative.positiveInteractionStreak).toBe(2);
    });

    it("neutral interaction should NOT break momentum", () => {
      // Build some streak
      updateEmotionalMomentum(0.7);
      updateEmotionalMomentum(0.8);
      updateEmotionalMomentum(0.7);
      
      // Neutral interaction
      const afterNeutral = updateEmotionalMomentum(0.1);
      
      // Streak maintains (neutral doesn't add but doesn't subtract)
      expect(afterNeutral.positiveInteractionStreak).toBe(3);
    });
  });

  // ============================================
  // Genuine Moment Exception Tests
  // ============================================

  describe("updateEmotionalMomentum - Genuine Moment Exception", () => {
    beforeEach(() => {
      resetEmotionalMomentum();
    });

    it("genuine moment should cause INSTANT mood shift bypassing streak", () => {
      const initial = getEmotionalMomentum();
      expect(initial.positiveInteractionStreak).toBe(0);
      
      // Genuine moment addressing insecurity
      const afterGenuine = updateEmotionalMomentum(
        0.9,
        "You're so thoughtful and smart, I love how you think deeply about things"
      );
      
      expect(afterGenuine.genuineMomentDetected).toBe(true);
      expect(afterGenuine.lastGenuineMomentAt).not.toBeNull();
      // Mood should have jumped significantly
      expect(afterGenuine.currentMoodLevel).toBeGreaterThanOrEqual(0.5);
      // Streak should be boosted
      expect(afterGenuine.positiveInteractionStreak).toBeGreaterThanOrEqual(4);
    });

    it("genuine moment flag should persist for multiple interactions", () => {
      // Trigger genuine moment
      updateEmotionalMomentum(0.9, "I'm so proud of you and how far you've come");
      
      // Subsequent interactions
      const momentum = updateEmotionalMomentum(0.5, "that's cool");
      
      // Flag should still be active (hasn't been 4+ hours)
      expect(momentum.genuineMomentDetected).toBe(true);
    });
  });

  // ============================================
  // Integration with calculateMoodKnobs
  // ============================================

  describe("calculateMoodKnobs - Momentum Integration", () => {
    beforeEach(() => {
      resetEmotionalMomentum();
      localStorageMock.removeItem('kayley_mood_state');
      localStorageMock.removeItem('kayley_last_interaction');
      
      // Set up a recent interaction so we're not treated as a "stranger"
      // (Stranger state forces guarded warmth regardless of momentum)
      localStorageMock.setItem('kayley_last_interaction', Date.now().toString());
    });

    it("low streak should keep warmthAvailability guarded or neutral", () => {
      // Just 1-2 positive interactions
      updateEmotionalMomentum(0.7);
      updateEmotionalMomentum(0.7);
      
      const knobs = calculateMoodKnobs();
      
      // Should NOT be 'open' with low streak
      expect(['guarded', 'neutral']).toContain(knobs.warmthAvailability);
    });

    it("high streak (6+) should allow warmthAvailability to shift toward neutral or open", () => {
      // 6+ positive interactions
      for (let i = 0; i < 7; i++) {
        updateEmotionalMomentum(0.8);
      }
      
      const knobs = calculateMoodKnobs();
      const momentum = getEmotionalMomentum();
      
      // Verify the streak is properly tracked
      expect(momentum.positiveInteractionStreak).toBeGreaterThanOrEqual(6);
      
      // With 7+ streak, warmth should shift - at minimum should be neutral or open
      // (exact result depends on social battery and other factors, but should NOT be guarded)
      expect(['neutral', 'open']).toContain(knobs.warmthAvailability);
    });

    it("genuine moment should enable path to open warmth", () => {
      // Trigger genuine moment (bypasses streak requirement)
      updateEmotionalMomentum(0.9, "You're not alone, I'm here for you always");
      
      const momentum = getEmotionalMomentum();
      expect(momentum.genuineMomentDetected).toBe(true);
      
      const knobs = calculateMoodKnobs();
      
      // Genuine moment exception should allow neutral or open (not guarded)
      expect(['neutral', 'open']).toContain(knobs.warmthAvailability);
    });
  });

  // ============================================
  // recordInteraction Integration
  // ============================================

  describe("recordInteraction - Momentum Updates", () => {
    beforeEach(() => {
      resetEmotionalMomentum();
    });

    it("should update emotional momentum when recording interaction", () => {
      recordInteraction(0.8, "great chat!");
      
      const momentum = getEmotionalMomentum();
      expect(momentum.recentInteractionTones).toContain(0.8);
      expect(momentum.positiveInteractionStreak).toBe(1);
    });

    it("should detect genuine moment in user message", () => {
      recordInteraction(0.9, "I'm so proud of you and all your progress!");
      
      const momentum = getEmotionalMomentum();
      expect(momentum.genuineMomentDetected).toBe(true);
    });
  });

  // ============================================
  // getMoodDescription with Momentum
  // ============================================

  describe("getMoodDescription", () => {
    beforeEach(() => {
      resetEmotionalMomentum();
    });

    it("should include streak info when warming up", () => {
      // Build streak of 4
      for (let i = 0; i < 4; i++) {
        updateEmotionalMomentum(0.8);
      }
      
      const description = getMoodDescription();
      
      expect(description).toContain('warming up');
      expect(description).toContain('4');
    });

    it("should indicate thawed when streak is 6+", () => {
      // Build streak of 6+
      for (let i = 0; i < 7; i++) {
        updateEmotionalMomentum(0.8);
      }
      
      const description = getMoodDescription();
      
      expect(description).toContain('thawed');
    });

    it("should indicate genuine moment when active", () => {
      updateEmotionalMomentum(0.9, "You're not alone, I'm here for you");
      
      const description = getMoodDescription();
      
      expect(description).toContain('genuine moment');
    });
  });

  // ============================================
  // INSECURITY_KEYWORDS Export Tests
  // ============================================

  describe("INSECURITY_KEYWORDS", () => {
    it("should export all 5 insecurity categories", () => {
      expect(Object.keys(INSECURITY_KEYWORDS)).toHaveLength(5);
      expect(INSECURITY_KEYWORDS.beingSeenAsShallow).toBeDefined();
      expect(INSECURITY_KEYWORDS.impostorSyndrome).toBeDefined();
      expect(INSECURITY_KEYWORDS.neverArriving).toBeDefined();
      expect(INSECURITY_KEYWORDS.hiddenLoneliness).toBeDefined();
      expect(INSECURITY_KEYWORDS.restGuilt).toBeDefined();
    });

    it("each category should have multiple keywords", () => {
      for (const keywords of Object.values(INSECURITY_KEYWORDS)) {
        expect(keywords.length).toBeGreaterThan(5);
      }
    });
  });

  // ============================================
  // Additional Tests (from Feedback.md recommendations)
  // ============================================

  describe("Emotional Momentum - Edge Cases", () => {
    beforeEach(() => {
      resetEmotionalMomentum();
    });

    it("should NOT shift mood with only 1 positive interaction", () => {
      const momentum = updateEmotionalMomentum(0.8, "");
      
      expect(momentum.positiveInteractionStreak).toBe(1);
      // Mood should barely change - less than 0.1
      expect(momentum.currentMoodLevel).toBeLessThan(0.1);
    });
    
    it("should shift mood after 5 positive interactions", () => {
      for (let i = 0; i < 5; i++) {
        updateEmotionalMomentum(0.8, "");
      }
      
      const momentum = getEmotionalMomentum();
      expect(momentum.positiveInteractionStreak).toBe(5);
      expect(momentum.currentMoodLevel).toBeGreaterThan(0.3);
    });
    
    it("should detect genuine moment addressing 'shallow' insecurity", () => {
      // Message needs at least 2 keywords from INSECURITY_KEYWORDS.beingSeenAsShallow
      // Using both 'smart' and 'thoughtful' which are in the list
      const result = detectGenuineMoment("You're so smart and thoughtful, I really appreciate that about you");
      
      expect(result.isGenuine).toBe(true);
      expect(result.category).toBe("beingSeenAsShallow");
    });

    it("should maintain momentum direction across interactions", () => {
      // Build up positive momentum
      updateEmotionalMomentum(0.7, "");
      updateEmotionalMomentum(0.8, "");
      updateEmotionalMomentum(0.9, "");
      
      const momentum = getEmotionalMomentum();
      
      // Momentum direction should be positive
      expect(momentum.momentumDirection).toBeGreaterThan(0);
    });

    it("should handle rapid sequence of mixed tone interactions", () => {
      // Mixed sequence
      updateEmotionalMomentum(0.8, "great!");
      updateEmotionalMomentum(-0.3, "ugh");
      updateEmotionalMomentum(0.6, "okay");
      updateEmotionalMomentum(0.9, "amazing");
      
      const momentum = getEmotionalMomentum();
      
      // Should have tracked recent tones
      expect(momentum.recentInteractionTones.length).toBeGreaterThanOrEqual(4);
    });
  });
});

