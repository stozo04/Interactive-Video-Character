/**
 * Unit Tests for Acquaintance Behavior Tests
 * 
 * Tests the test case structure, analysis functions, and report generation
 * for acquaintance behavior consistency tests.
 */

import { describe, it, expect } from "vitest";
import {
  ACQUAINTANCE_BEHAVIOR_TEST_CASES,
  analyzeAcquaintanceBehaviorInconsistency,
  generateAcquaintanceBehaviorReport,
  type AcquaintanceTestCase,
} from "./acquaintanceBehaviorTests";

describe("Acquaintance Behavior Tests", () => {
  describe("Test Case Structure", () => {
    it("should have all required test cases", () => {
      expect(ACQUAINTANCE_BEHAVIOR_TEST_CASES.length).toBeGreaterThan(0);
    });

    it("should have unique IDs for all test cases", () => {
      const ids = ACQUAINTANCE_BEHAVIOR_TEST_CASES.map((tc) => tc.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have all test cases with acquaintance tier", () => {
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        expect(testCase.relationshipState.tier).toBe("acquaintance");
      });
    });

    it("should have trust scores in appropriate range for acquaintances", () => {
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        // Acquaintances typically have trust scores between -9 and 9
        // But we allow some flexibility for edge cases (e.g., after inappropriate behavior)
        expect(testCase.relationshipState.trust).toBeGreaterThanOrEqual(-10);
        expect(testCase.relationshipState.trust).toBeLessThan(10);
      });
    });

    it("should have warmth scores in appropriate range for acquaintances", () => {
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        // Acquaintances typically have warmth scores between -9 and 9
        // But we allow some flexibility for edge cases
        expect(testCase.relationshipState.warmth).toBeGreaterThanOrEqual(-10);
        expect(testCase.relationshipState.warmth).toBeLessThan(10);
      });
    });

    it("should have valid familiarity stages", () => {
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        expect(["early", "developing"]).toContain(
          testCase.relationshipState.familiarity
        );
      });
    });

    it("should have valid mood states", () => {
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        expect(testCase.moodState.verbosity).toBeGreaterThanOrEqual(0);
        expect(testCase.moodState.verbosity).toBeLessThanOrEqual(1);
        expect(["guarded", "neutral", "open"]).toContain(
          testCase.moodState.warmthAvailability
        );
        expect(["slow", "normal", "quick"]).toContain(
          testCase.moodState.patienceDecay
        );
      });
    });

    it("should have expected behavior descriptions", () => {
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        expect(testCase.expectedBehavior).toBeTruthy();
        expect(testCase.expectedBehavior.length).toBeGreaterThan(10);
      });
    });

    it("should have human behavior notes", () => {
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        expect(testCase.humanBehaviorNotes).toBeTruthy();
        expect(testCase.humanBehaviorNotes.length).toBeGreaterThan(10);
      });
    });
  });

  describe("Test Case Categories", () => {
    it("should cover warmer responses than strangers", () => {
      const warmerTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter((tc) =>
        tc.scenario.toLowerCase().includes("warmer") ||
        tc.expectedBehavior.toLowerCase().includes("warmer")
      );
      expect(warmerTests.length).toBeGreaterThan(0);
    });

    it("should cover memory across conversations", () => {
      const memoryTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter((tc) =>
        tc.scenario.toLowerCase().includes("memory") ||
        tc.scenario.toLowerCase().includes("remember") ||
        tc.expectedBehavior.toLowerCase().includes("remember")
      );
      expect(memoryTests.length).toBeGreaterThan(0);
    });

    it("should cover boundary setting", () => {
      const boundaryTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter((tc) =>
        tc.scenario.toLowerCase().includes("boundary") ||
        tc.expectedBehavior.toLowerCase().includes("boundary")
      );
      expect(boundaryTests.length).toBeGreaterThan(0);
    });

    it("should cover inappropriate behavior handling", () => {
      const inappropriateTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter((tc) =>
        tc.scenario.toLowerCase().includes("inappropriate") ||
        tc.userMessage.toLowerCase().includes("nude") ||
        tc.userMessage.toLowerCase().includes("single")
      );
      expect(inappropriateTests.length).toBeGreaterThan(0);
    });

    it("should cover playfulness", () => {
      const playfulnessTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter((tc) =>
        tc.scenario.toLowerCase().includes("playful") ||
        tc.scenario.toLowerCase().includes("joke")
      );
      expect(playfulnessTests.length).toBeGreaterThan(0);
    });
  });

  describe("Analysis Function", () => {
    it("should return inconsistencies and recommendations", () => {
      const testCase = ACQUAINTANCE_BEHAVIOR_TEST_CASES[0];
      const result = analyzeAcquaintanceBehaviorInconsistency(testCase);

      expect(result).toHaveProperty("inconsistencies");
      expect(result).toHaveProperty("recommendations");
      expect(Array.isArray(result.inconsistencies)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it("should include potential issues in inconsistencies", () => {
      const testCase = ACQUAINTANCE_BEHAVIOR_TEST_CASES[0];
      const result = analyzeAcquaintanceBehaviorInconsistency(testCase);

      expect(result.inconsistencies.length).toBeGreaterThan(0);
      expect(result.inconsistencies).toEqual(
        expect.arrayContaining(testCase.potentialIssues)
      );
    });

    it("should include human behavior notes in recommendations", () => {
      const testCase = ACQUAINTANCE_BEHAVIOR_TEST_CASES[0];
      const result = analyzeAcquaintanceBehaviorInconsistency(testCase);

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations[0]).toContain(
        testCase.humanBehaviorNotes
      );
    });
  });

  describe("Report Generation", () => {
    it("should generate a report", () => {
      const report = generateAcquaintanceBehaviorReport();
      expect(report).toBeTruthy();
      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(100);
    });

    it("should include report title", () => {
      const report = generateAcquaintanceBehaviorReport();
      expect(report).toContain("Acquaintance Behavior Consistency Report");
    });

    it("should include all test cases", () => {
      const report = generateAcquaintanceBehaviorReport();
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        expect(report).toContain(testCase.id);
        expect(report).toContain(testCase.scenario);
        expect(report).toContain(testCase.userMessage);
      });
    });

    it("should include relationship state information", () => {
      const report = generateAcquaintanceBehaviorReport();
      const testCase = ACQUAINTANCE_BEHAVIOR_TEST_CASES[0];
      expect(report).toContain(`Trust: ${testCase.relationshipState.trust}`);
      expect(report).toContain(`Warmth: ${testCase.relationshipState.warmth}`);
    });

    it("should include expected behavior", () => {
      const report = generateAcquaintanceBehaviorReport();
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        expect(report).toContain(testCase.expectedBehavior);
      });
    });

    it("should include potential issues", () => {
      const report = generateAcquaintanceBehaviorReport();
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        testCase.potentialIssues.forEach((issue) => {
          expect(report).toContain(issue);
        });
      });
    });

    it("should include human behavior notes", () => {
      const report = generateAcquaintanceBehaviorReport();
      ACQUAINTANCE_BEHAVIOR_TEST_CASES.forEach((testCase) => {
        expect(report).toContain(testCase.humanBehaviorNotes);
      });
    });
  });

  describe("Acquaintance vs Stranger Differences", () => {
    it("should have test cases that explicitly test warmer responses", () => {
      const warmerTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter((tc) =>
        tc.expectedBehavior.toLowerCase().includes("warmer") ||
        tc.humanBehaviorNotes.toLowerCase().includes("warmer")
      );
      expect(warmerTests.length).toBeGreaterThan(0);
    });

    it("should have test cases that test less harsh boundary setting", () => {
      const lessHarshTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter((tc) =>
        tc.expectedBehavior.toLowerCase().includes("less harsh") ||
        tc.humanBehaviorNotes.toLowerCase().includes("less harsh")
      );
      expect(lessHarshTests.length).toBeGreaterThan(0);
    });

    it("should have test cases that test better memory", () => {
      const memoryTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter((tc) =>
        tc.scenario.toLowerCase().includes("memory") ||
        tc.scenario.toLowerCase().includes("remember") ||
        tc.expectedBehavior.toLowerCase().includes("remember")
      );
      expect(memoryTests.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle test cases with negative trust/warmth (after inappropriate behavior)", () => {
      const negativeTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter(
        (tc) =>
          tc.relationshipState.trust < 0 ||
          tc.relationshipState.warmth < 0
      );
      expect(negativeTests.length).toBeGreaterThan(0);

      negativeTests.forEach((testCase) => {
        expect(testCase.expectedBehavior).toContain("guard");
        expect(testCase.expectedBehavior.toLowerCase()).toMatch(
          /guard|inappropriate|boundary|remember/
        );
      });
    });

    it("should handle test cases with bad mood", () => {
      const badMoodTests = ACQUAINTANCE_BEHAVIOR_TEST_CASES.filter(
        (tc) =>
          tc.moodState.warmthAvailability === "guarded" ||
          tc.moodState.verbosity < 0.5
      );
      expect(badMoodTests.length).toBeGreaterThan(0);

      badMoodTests.forEach((testCase) => {
        expect(testCase.expectedBehavior.toLowerCase()).toMatch(
          /mood|low|rough|tough|guard|honest/
        );
      });
    });
  });
});
