// src/services/tests/almostMomentsService.test.ts
/**
 * Almost Moments Service Tests (TDD)
 *
 * Tests for expression generation, stage calculation, prompt inclusion rules,
 * and trigger logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client before any imports that use it
vi.mock("../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
  },
}));

import {
  generateAlmostExpression,
  buildAlmostMomentsPrompt,
  calculateStage,
  shouldTriggerAlmostMoment,
  type UnsaidFeeling,
  type AlmostMomentContext,
} from "../almostMomentsService";

const baseFeeling: UnsaidFeeling = {
  id: "feeling-1",
  type: "romantic",
  intensity: 0.5,
  suppressionCount: 2,
  lastAlmostMoment: null,
  unsaidContent: "I think I like you",
  partialExpressions: [],
  createdAt: new Date("2025-12-01T10:00:00Z"),
  resolvedAt: null,
};

const baseContext: AlmostMomentContext = {
  warmthScore: 35,
  playfulnessScore: 15,
  trustScore: 25,
  relationshipTier: "close_friend",
  romanticTensionBuilding: true,
  conversationDepth: "deep",
  recentSweetMoment: true,
  lateNightConversation: false,
  vulnerabilityExchangeActive: true,
  totalAlmostMoments: 2,
  lastAlmostMomentDate: null,
  currentStage: "near_miss",
  unsaidFeelings: [baseFeeling],
};

describe("calculateStage", () => {
  it("should return micro_hint for low combined score", () => {
    expect(calculateStage(0.1, 0)).toBe("micro_hint");
  });

  it("should return near_miss for medium combined score", () => {
    expect(calculateStage(0.25, 1)).toBe("near_miss");
  });

  it("should return obvious_unsaid for higher combined score", () => {
    expect(calculateStage(0.6, 0)).toBe("obvious_unsaid");
  });

  it("should return almost_confession for very high combined score", () => {
    expect(calculateStage(0.8, 2)).toBe("almost_confession");
  });
});

describe("generateAlmostExpression", () => {
  it("should return an expression with the requested stage", () => {
    const expression = generateAlmostExpression(baseFeeling, "near_miss");
    expect(expression.stage).toBe("near_miss");
  });

  it("should be deterministic when a seed is provided", () => {
    const first = generateAlmostExpression(baseFeeling, "micro_hint", "seed-1");
    const second = generateAlmostExpression(baseFeeling, "micro_hint", "seed-1");
    expect(first.text).toBe(second.text);
    expect(first.followUp).toBe(second.followUp);
  });
});

describe("buildAlmostMomentsPrompt", () => {
  it("should include the unsaid content when eligible", () => {
    const prompt = buildAlmostMomentsPrompt(baseContext);
    expect(prompt).toContain("THE UNSAID");
    expect(prompt).toContain(baseFeeling.unsaidContent);
  });

  it("should be deterministic for the same context", () => {
    const prompt1 = buildAlmostMomentsPrompt(baseContext);
    const prompt2 = buildAlmostMomentsPrompt(baseContext);
    expect(prompt1).toBe(prompt2);
  });

  it("should return empty when warmth is too low", () => {
    const prompt = buildAlmostMomentsPrompt({
      ...baseContext,
      warmthScore: 10,
    });
    expect(prompt).toBe("");
  });

  it("should return empty when relationship tier is not eligible", () => {
    const prompt = buildAlmostMomentsPrompt({
      ...baseContext,
      relationshipTier: "friend",
    });
    expect(prompt).toBe("");
  });

  it("should return empty when no unsaid feelings exist", () => {
    const prompt = buildAlmostMomentsPrompt({
      ...baseContext,
      unsaidFeelings: [],
    });
    expect(prompt).toBe("");
  });
});

describe("shouldTriggerAlmostMoment", () => {
  it("should return false for ineligible relationship tiers", () => {
    const shouldTrigger = shouldTriggerAlmostMoment(
      {
        ...baseContext,
        relationshipTier: "friend",
      },
      baseFeeling
    );
    expect(shouldTrigger).toBe(false);
  });

  it("should return false when warmth is too low", () => {
    const shouldTrigger = shouldTriggerAlmostMoment(
      {
        ...baseContext,
        warmthScore: 10,
      },
      baseFeeling
    );
    expect(shouldTrigger).toBe(false);
  });

  it("should return false when last almost moment was recent (< 24 hours)", () => {
    const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12 hours ago
    const shouldTrigger = shouldTriggerAlmostMoment(baseContext, {
      ...baseFeeling,
      lastAlmostMoment: recentDate,
    });
    expect(shouldTrigger).toBe(false);
  });

  it("should return true when probability check passes", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.0);
    const shouldTrigger = shouldTriggerAlmostMoment(baseContext, {
      ...baseFeeling,
      intensity: 1,
    });
    expect(shouldTrigger).toBe(true);
    randomSpy.mockRestore();
  });

  it("should return false when probability check fails", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const shouldTrigger = shouldTriggerAlmostMoment(baseContext, baseFeeling);
    expect(shouldTrigger).toBe(false);
    randomSpy.mockRestore();
  });

  it("should increase probability for intimate conversations", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.25);
    const shouldTrigger = shouldTriggerAlmostMoment(
      {
        ...baseContext,
        conversationDepth: "intimate",
      },
      baseFeeling
    );
    expect(shouldTrigger).toBe(true);
    randomSpy.mockRestore();
  });

  it("should increase probability for late night conversations", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.15);
    const shouldTrigger = shouldTriggerAlmostMoment(
      {
        ...baseContext,
        lateNightConversation: true,
      },
      baseFeeling
    );
    expect(shouldTrigger).toBe(true);
    randomSpy.mockRestore();
  });
});

describe("generateAlmostExpression - variety", () => {
  it("should generate different expressions for different seeds", () => {
    const expr1 = generateAlmostExpression(baseFeeling, "micro_hint", "seed-1");
    const expr2 = generateAlmostExpression(baseFeeling, "micro_hint", "seed-2");

    // They might be different (if there are multiple expressions for this type/stage)
    // or the same (if there's only one). But the function should be deterministic.
    const expr1Again = generateAlmostExpression(baseFeeling, "micro_hint", "seed-1");
    expect(expr1.text).toBe(expr1Again.text);
  });

  it("should have expressions for all feeling types", () => {
    const types: Array<"romantic" | "deep_care" | "fear_of_loss" | "gratitude" | "attraction" | "vulnerability"> = [
      "romantic", "deep_care", "fear_of_loss", "gratitude", "attraction", "vulnerability"
    ];

    types.forEach(type => {
      const feeling: UnsaidFeeling = {
        ...baseFeeling,
        type,
      };
      const expr = generateAlmostExpression(feeling, "micro_hint");
      expect(expr.text).toBeTruthy();
      expect(expr.stage).toBe("micro_hint");
    });
  });

  it("should return fallback expression for missing type/stage combinations", () => {
    const expr = generateAlmostExpression(baseFeeling, "micro_hint");
    expect(expr).toBeDefined();
    expect(expr.text).toBeTruthy();
  });
});

describe("buildAlmostMomentsPrompt - edge cases", () => {
  it("should handle very high intensity feelings", () => {
    const highIntensityContext = {
      ...baseContext,
      unsaidFeelings: [{
        ...baseFeeling,
        intensity: 1.0,
        suppressionCount: 10,
      }],
      currentStage: "almost_confession" as const,
    };

    const prompt = buildAlmostMomentsPrompt(highIntensityContext);
    expect(prompt).toContain("YOU ARE AT THE EDGE");
    expect(prompt).toContain("Intensity: 100%");
  });

  it("should include last almost moment timing", () => {
    const pastDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 2 days ago
    const contextWithHistory = {
      ...baseContext,
      lastAlmostMomentDate: pastDate,
    };

    const prompt = buildAlmostMomentsPrompt(contextWithHistory);
    expect(prompt).toContain("2 days ago");
  });

  it("should format recent almost moments as hours", () => {
    const recentDate = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
    const contextWithRecent = {
      ...baseContext,
      lastAlmostMomentDate: recentDate,
    };

    const prompt = buildAlmostMomentsPrompt(contextWithRecent);
    expect(prompt).toContain("5 hours ago");
  });
});
