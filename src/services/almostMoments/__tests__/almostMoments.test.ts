// src/services/almostMoments/__tests__/almostMoments.test.ts
/**
 * Almost Moments Tests (TDD)
 *
 * Tests for expression generation, stage calculation, prompt inclusion rules,
 * and trigger logic.
 */

import { describe, it, expect, vi } from "vitest";
import { generateAlmostExpression } from "../expressionGenerator";
import { buildAlmostMomentsPrompt } from "../almostMomentsPromptBuilder";
import {
  calculateStage,
  shouldTriggerAlmostMoment,
} from "../almostMomentsService";
import type { UnsaidFeeling, AlmostMomentContext } from "../types";

const baseFeeling: UnsaidFeeling = {
  id: "feeling-1",
  userId: "user-1",
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

  it("should return true when probability check passes", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.0);
    const shouldTrigger = shouldTriggerAlmostMoment(baseContext, {
      ...baseFeeling,
      intensity: 1,
    });
    expect(shouldTrigger).toBe(true);
    randomSpy.mockRestore();
  });
});
