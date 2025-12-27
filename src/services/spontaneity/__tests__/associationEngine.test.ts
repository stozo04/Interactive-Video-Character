// src/services/spontaneity/__tests__/associationEngine.test.ts
/**
 * Association Engine Tests (TDD)
 *
 * Tests for the association engine that matches pending shares to current conversation topics.
 * This enables Kayley to naturally bring up things she's been wanting to share when
 * relevant topics come up ("Oh! Speaking of work, I've been meaning to tell you...").
 *
 * WRITE TESTS FIRST - Implementation comes after!
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  findRelevantAssociations,
  calculateTopicSimilarity,
  generateAssociationOpener,
} from "../associationEngine";
import type { PendingShare, AssociationMatch } from "../types";

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockPendingShare = (
  overrides: Partial<PendingShare> = {}
): PendingShare => {
  const baseDate = new Date("2025-12-26T12:00:00Z");
  const expiresDate = new Date("2025-12-27T12:00:00Z");

  return {
    id: `share-${Math.random()}`,
    content: "I saw the funniest thing today",
    type: "story",
    urgency: 0.5,
    relevanceTopics: ["funny", "random"],
    naturalOpener: "Oh! I've been meaning to tell you...",
    canInterrupt: false,
    expiresAt: expiresDate,
    createdAt: baseDate,
    ...overrides,
  };
};

// ============================================================================
// calculateTopicSimilarity Tests
// ============================================================================

describe("calculateTopicSimilarity", () => {
  describe("exact matches", () => {
    it("should return 1.0 for identical topics", () => {
      const similarity = calculateTopicSimilarity("work", "work");
      expect(similarity).toBe(1.0);
    });

    it("should return 1.0 for identical topics with different casing", () => {
      const similarity = calculateTopicSimilarity("Work", "work");
      expect(similarity).toBe(1.0);
    });

    it("should return 1.0 for identical multi-word topics", () => {
      const similarity = calculateTopicSimilarity("job interview", "job interview");
      expect(similarity).toBe(1.0);
    });
  });

  describe("contains matches", () => {
    it("should return 0.8 for partial match when one topic contains another", () => {
      const similarity = calculateTopicSimilarity("work", "working");
      expect(similarity).toBe(0.8);
    });

    it("should return 0.8 for partial match in reverse order", () => {
      const similarity = calculateTopicSimilarity("working", "work");
      expect(similarity).toBe(0.8);
    });

    it("should return 0.8 when topic is substring of phrase", () => {
      const similarity = calculateTopicSimilarity("job", "job interview");
      expect(similarity).toBe(0.8);
    });

    it("should return 0.8 when phrase contains topic", () => {
      const similarity = calculateTopicSimilarity("job interview", "job");
      expect(similarity).toBe(0.8);
    });

    it("should handle contains match case-insensitively", () => {
      const similarity = calculateTopicSimilarity("Work", "working");
      expect(similarity).toBe(0.8);
    });
  });

  describe("related topic matches", () => {
    it("should return 0.6 for work-related topics", () => {
      expect(calculateTopicSimilarity("work", "job")).toBe(0.6);
      expect(calculateTopicSimilarity("work", "career")).toBe(0.6);
      expect(calculateTopicSimilarity("job", "career")).toBe(0.6);
    });

    it("should return 0.6 for work-related topics in reverse", () => {
      expect(calculateTopicSimilarity("job", "work")).toBe(0.6);
      expect(calculateTopicSimilarity("career", "work")).toBe(0.6);
      expect(calculateTopicSimilarity("career", "job")).toBe(0.6);
    });

    it("should return 0.6 for work-related topics with variations", () => {
      expect(calculateTopicSimilarity("work", "office")).toBe(0.6);
      expect(calculateTopicSimilarity("work", "boss")).toBe(0.6);
      expect(calculateTopicSimilarity("work", "coworker")).toBe(0.6);
      expect(calculateTopicSimilarity("work", "meeting")).toBe(0.6);
    });

    it("should return 0.6 for family-related topics", () => {
      expect(calculateTopicSimilarity("family", "mom")).toBe(0.6);
      expect(calculateTopicSimilarity("family", "dad")).toBe(0.6);
      expect(calculateTopicSimilarity("family", "parents")).toBe(0.6);
      expect(calculateTopicSimilarity("mom", "parents")).toBe(0.6);
    });

    it("should return 0.6 for relationship-related topics", () => {
      expect(calculateTopicSimilarity("relationship", "dating")).toBe(0.6);
      expect(calculateTopicSimilarity("relationship", "boyfriend")).toBe(0.6);
      expect(calculateTopicSimilarity("relationship", "girlfriend")).toBe(0.6);
      expect(calculateTopicSimilarity("dating", "romance")).toBe(0.6);
    });

    it("should return 0.6 for hobby-related topics", () => {
      expect(calculateTopicSimilarity("gaming", "video games")).toBe(0.6);
      expect(calculateTopicSimilarity("gaming", "games")).toBe(0.6);
      expect(calculateTopicSimilarity("music", "concert")).toBe(0.6);
      expect(calculateTopicSimilarity("music", "band")).toBe(0.6);
    });

    it("should return 0.6 for emotion-related topics", () => {
      expect(calculateTopicSimilarity("happy", "joy")).toBe(0.6);
      expect(calculateTopicSimilarity("sad", "depressed")).toBe(0.6);
      expect(calculateTopicSimilarity("anxious", "stressed")).toBe(0.6);
      expect(calculateTopicSimilarity("angry", "frustrated")).toBe(0.6);
    });

    it("should handle related topics case-insensitively", () => {
      expect(calculateTopicSimilarity("Work", "Job")).toBe(0.6);
      expect(calculateTopicSimilarity("FAMILY", "mom")).toBe(0.6);
    });
  });

  describe("unrelated topics", () => {
    it("should return 0 for completely unrelated topics", () => {
      expect(calculateTopicSimilarity("work", "pizza")).toBe(0);
      expect(calculateTopicSimilarity("family", "coding")).toBe(0);
      expect(calculateTopicSimilarity("gaming", "cooking")).toBe(0);
    });

    it("should return 0 for empty strings", () => {
      expect(calculateTopicSimilarity("", "work")).toBe(0);
      expect(calculateTopicSimilarity("work", "")).toBe(0);
      expect(calculateTopicSimilarity("", "")).toBe(0);
    });

    it("should return 0 for whitespace-only strings", () => {
      expect(calculateTopicSimilarity("  ", "work")).toBe(0);
      expect(calculateTopicSimilarity("work", "  ")).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle topics with special characters", () => {
      expect(calculateTopicSimilarity("work!", "work")).toBeGreaterThan(0);
    });

    it("should handle very long topics", () => {
      const longTopic = "a".repeat(1000);
      expect(calculateTopicSimilarity(longTopic, longTopic)).toBe(1.0);
    });

    it("should handle topics with numbers", () => {
      expect(calculateTopicSimilarity("web3", "web3")).toBe(1.0);
      expect(calculateTopicSimilarity("covid19", "covid")).toBe(0.8);
    });
  });
});

// ============================================================================
// findRelevantAssociations Tests
// ============================================================================

describe("findRelevantAssociations", () => {
  let mockPendingShares: PendingShare[];

  beforeEach(() => {
    mockPendingShares = [
      createMockPendingShare({
        id: "share-1",
        content: "My boss said the funniest thing today",
        relevanceTopics: ["work", "funny", "boss"],
        urgency: 0.5,
      }),
      createMockPendingShare({
        id: "share-2",
        content: "I've been thinking about career changes",
        relevanceTopics: ["career", "job", "future"],
        urgency: 0.7,
      }),
      createMockPendingShare({
        id: "share-3",
        content: "Had a weird dream last night",
        relevanceTopics: ["dream", "sleep", "random"],
        urgency: 0.3,
      }),
      createMockPendingShare({
        id: "share-4",
        content: "My family is driving me crazy",
        relevanceTopics: ["family", "parents", "stress"],
        urgency: 0.6,
      }),
    ];
  });

  describe("exact topic matches", () => {
    it("should find exact match for single topic", () => {
      const matches = findRelevantAssociations(mockPendingShares, ["work"]);

      expect(matches.length).toBeGreaterThan(0);
      const workMatch = matches.find((m) => m.share.id === "share-1");
      expect(workMatch).toBeDefined();
      expect(workMatch?.matchedTopic).toBe("work");
      expect(workMatch?.relevanceScore).toBe(1.0);
    });

    it("should find multiple exact matches for different shares", () => {
      const matches = findRelevantAssociations(mockPendingShares, [
        "work",
        "family",
      ]);

      expect(matches.length).toBeGreaterThanOrEqual(2);
      expect(matches.some((m) => m.share.id === "share-1")).toBe(true);
      expect(matches.some((m) => m.share.id === "share-4")).toBe(true);
    });

    it("should find exact match for multi-word topic", () => {
      const shares = [
        createMockPendingShare({
          relevanceTopics: ["job interview", "career"],
        }),
      ];

      const matches = findRelevantAssociations(shares, ["job interview"]);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].relevanceScore).toBe(1.0);
    });
  });

  describe("partial topic matches", () => {
    it("should find partial match when current topic contains relevance topic", () => {
      const matches = findRelevantAssociations(mockPendingShares, ["working"]);

      const workMatch = matches.find((m) => m.share.id === "share-1");
      expect(workMatch).toBeDefined();
      expect(workMatch?.relevanceScore).toBe(0.8);
    });

    it("should find partial match when relevance topic contains current topic", () => {
      const shares = [
        createMockPendingShare({
          relevanceTopics: ["working"],
        }),
      ];

      const matches = findRelevantAssociations(shares, ["work"]);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].relevanceScore).toBe(0.8);
    });
  });

  describe("related topic matches", () => {
    it("should find related work topics", () => {
      const matches = findRelevantAssociations(mockPendingShares, ["job"]);

      // Should match both share-1 (work/boss) and share-2 (career/job)
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((m) => m.relevanceScore === 0.6 || m.relevanceScore === 1.0)).toBe(true);
    });

    it("should find related family topics", () => {
      const matches = findRelevantAssociations(mockPendingShares, ["mom"]);

      const familyMatch = matches.find((m) => m.share.id === "share-4");
      expect(familyMatch).toBeDefined();
      expect(familyMatch?.relevanceScore).toBe(0.6);
    });

    it("should find multiple related topics for same share", () => {
      const matches = findRelevantAssociations(mockPendingShares, [
        "career",
        "future",
      ]);

      // share-2 has both career and future in its relevance topics
      const careerMatches = matches.filter((m) => m.share.id === "share-2");
      expect(careerMatches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("no matches", () => {
    it("should return empty array when no topics match", () => {
      const matches = findRelevantAssociations(mockPendingShares, ["pizza"]);

      expect(matches).toEqual([]);
    });

    it("should return empty array when current topics array is empty", () => {
      const matches = findRelevantAssociations(mockPendingShares, []);

      expect(matches).toEqual([]);
    });

    it("should return empty array when pending shares array is empty", () => {
      const matches = findRelevantAssociations([], ["work"]);

      expect(matches).toEqual([]);
    });
  });

  describe("sorting and relevance", () => {
    it("should return matches sorted by relevance score descending", () => {
      // Create shares with different match qualities
      const shares = [
        createMockPendingShare({
          id: "exact",
          relevanceTopics: ["work"],
          urgency: 0.5,
        }),
        createMockPendingShare({
          id: "partial",
          relevanceTopics: ["working"],
          urgency: 0.5,
        }),
        createMockPendingShare({
          id: "related",
          relevanceTopics: ["job"],
          urgency: 0.5,
        }),
      ];

      const matches = findRelevantAssociations(shares, ["work"]);

      expect(matches.length).toBe(3);
      // Exact should be first (1.0)
      expect(matches[0].relevanceScore).toBeGreaterThanOrEqual(
        matches[1].relevanceScore
      );
      // Each subsequent should be <= previous
      expect(matches[1].relevanceScore).toBeGreaterThanOrEqual(
        matches[2].relevanceScore
      );
    });

    it("should factor urgency into relevance when scores are equal", () => {
      const shares = [
        createMockPendingShare({
          id: "low-urgency",
          relevanceTopics: ["work"],
          urgency: 0.3,
        }),
        createMockPendingShare({
          id: "high-urgency",
          relevanceTopics: ["work"],
          urgency: 0.9,
        }),
      ];

      const matches = findRelevantAssociations(shares, ["work"]);

      // Both have same topic match (1.0), but urgency should affect final score
      expect(matches.length).toBe(2);
      // Higher urgency should be ranked higher when base similarity is equal
      expect(matches[0].share.urgency).toBeGreaterThan(matches[1].share.urgency);
    });

    it("should not include urgency for low-relevance matches", () => {
      const shares = [
        createMockPendingShare({
          id: "unrelated-high-urgency",
          relevanceTopics: ["pizza"],
          urgency: 1.0,
        }),
      ];

      const matches = findRelevantAssociations(shares, ["work"]);

      // Should not match at all despite high urgency
      expect(matches).toEqual([]);
    });
  });

  describe("handling best match per share", () => {
    it("should use best matching topic when share has multiple relevance topics", () => {
      const shares = [
        createMockPendingShare({
          relevanceTopics: ["pizza", "work", "random"],
        }),
      ];

      const matches = findRelevantAssociations(shares, ["work"]);

      expect(matches.length).toBe(1);
      expect(matches[0].matchedTopic).toBe("work");
      expect(matches[0].relevanceScore).toBe(1.0);
    });

    it("should match best topic from current topics list", () => {
      const shares = [
        createMockPendingShare({
          relevanceTopics: ["work"],
        }),
      ];

      // "work" is exact, "job" is related (0.6)
      const matches = findRelevantAssociations(shares, ["job", "work"]);

      expect(matches.length).toBe(1);
      expect(matches[0].matchedTopic).toBe("work");
      expect(matches[0].relevanceScore).toBe(1.0);
    });
  });

  describe("case insensitivity", () => {
    it("should match topics regardless of case in pending shares", () => {
      const shares = [
        createMockPendingShare({
          relevanceTopics: ["WORK", "JOB"],
        }),
      ];

      const matches = findRelevantAssociations(shares, ["work"]);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].relevanceScore).toBe(1.0);
    });

    it("should match topics regardless of case in current topics", () => {
      const matches = findRelevantAssociations(mockPendingShares, ["WORK"]);

      const workMatch = matches.find((m) => m.share.id === "share-1");
      expect(workMatch).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("should handle shares with empty relevance topics", () => {
      const shares = [
        createMockPendingShare({
          relevanceTopics: [],
        }),
      ];

      const matches = findRelevantAssociations(shares, ["work"]);

      expect(matches).toEqual([]);
    });

    it("should handle current topics with whitespace", () => {
      const matches = findRelevantAssociations(mockPendingShares, ["  work  "]);

      const workMatch = matches.find((m) => m.share.id === "share-1");
      expect(workMatch).toBeDefined();
    });

    it("should handle very large pending shares array", () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) =>
        createMockPendingShare({
          id: `share-${i}`,
          relevanceTopics: i === 500 ? ["work"] : ["random"],
        })
      );

      const matches = findRelevantAssociations(largeArray, ["work"]);

      expect(matches.length).toBeGreaterThan(0);
    });

    it("should handle very large current topics array", () => {
      const largeTopics = Array.from({ length: 100 }, (_, i) => `topic-${i}`);
      largeTopics.push("work");

      const matches = findRelevantAssociations(mockPendingShares, largeTopics);

      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe("multiple matches per share", () => {
    it("should return single best match per share, not duplicate entries", () => {
      const shares = [
        createMockPendingShare({
          id: "multi-match",
          relevanceTopics: ["work", "job", "career"],
        }),
      ];

      // All three topics are work-related
      const matches = findRelevantAssociations(shares, ["work", "job", "career"]);

      // Should only return ONE match per share with the best score
      const multiMatches = matches.filter((m) => m.share.id === "multi-match");
      expect(multiMatches.length).toBe(1);
      expect(multiMatches[0].relevanceScore).toBe(1.0);
    });
  });
});

// ============================================================================
// generateAssociationOpener Tests
// ============================================================================

describe("generateAssociationOpener", () => {
  let mockMatch: AssociationMatch;

  beforeEach(() => {
    mockMatch = {
      share: createMockPendingShare({
        content: "I saw the funniest thing at work today",
        relevanceTopics: ["work", "funny"],
        naturalOpener: "Oh! I've been meaning to tell you...",
      }),
      matchedTopic: "work",
      relevanceScore: 1.0,
    };
  });

  describe("basic opener generation", () => {
    it("should return a string", () => {
      const opener = generateAssociationOpener(mockMatch);

      expect(typeof opener).toBe("string");
      expect(opener.length).toBeGreaterThan(0);
    });

    it("should include the matched topic in the opener", () => {
      const opener = generateAssociationOpener(mockMatch);

      expect(opener.toLowerCase()).toContain("work");
    });

    it("should return a natural-sounding opener", () => {
      const opener = generateAssociationOpener(mockMatch);

      // Should contain conversational elements
      const hasConversationalElement =
        opener.includes("oh") ||
        opener.includes("Oh") ||
        opener.includes("speaking of") ||
        opener.includes("Speaking of") ||
        opener.includes("that reminds me") ||
        opener.includes("That reminds me");

      expect(hasConversationalElement).toBe(true);
    });
  });

  describe("opener variety", () => {
    it("should vary openers - not always return the same one", () => {
      // Generate multiple openers
      const openers = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const opener = generateAssociationOpener(mockMatch);
        openers.add(opener);
      }

      // Should have generated at least 2 different openers
      expect(openers.size).toBeGreaterThan(1);
    });

    it("should vary openers for different topics", () => {
      const workMatch = mockMatch;
      const familyMatch: AssociationMatch = {
        share: createMockPendingShare({
          relevanceTopics: ["family"],
        }),
        matchedTopic: "family",
        relevanceScore: 1.0,
      };

      const workOpener = generateAssociationOpener(workMatch);
      const familyOpener = generateAssociationOpener(familyMatch);

      // Not a strict requirement that they're different, but topics should appear
      expect(workOpener.toLowerCase()).toContain("work");
      expect(familyOpener.toLowerCase()).toContain("family");
    });
  });

  describe("topic integration", () => {
    it("should handle single-word topics", () => {
      mockMatch.matchedTopic = "gaming";

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.toLowerCase()).toContain("gaming");
    });

    it("should handle multi-word topics", () => {
      mockMatch.matchedTopic = "job interview";

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.toLowerCase()).toContain("job interview");
    });

    it("should handle topics with special characters gracefully", () => {
      mockMatch.matchedTopic = "work!";

      const opener = generateAssociationOpener(mockMatch);

      expect(typeof opener).toBe("string");
      expect(opener.length).toBeGreaterThan(0);
    });
  });

  describe("relevance score consideration", () => {
    it("should generate opener for high relevance score", () => {
      mockMatch.relevanceScore = 1.0;

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
    });

    it("should generate opener for medium relevance score", () => {
      mockMatch.relevanceScore = 0.6;

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
    });

    it("should handle low relevance score", () => {
      mockMatch.relevanceScore = 0.3;

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
    });
  });

  describe("different share types", () => {
    it("should generate opener for story type", () => {
      mockMatch.share.type = "story";

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
    });

    it("should generate opener for thought type", () => {
      mockMatch.share.type = "thought";

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
    });

    it("should generate opener for question type", () => {
      mockMatch.share.type = "question";

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
    });

    it("should generate opener for vent type", () => {
      mockMatch.share.type = "vent";

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("should handle empty matched topic gracefully", () => {
      mockMatch.matchedTopic = "";

      const opener = generateAssociationOpener(mockMatch);

      expect(typeof opener).toBe("string");
    });

    it("should handle very long topics", () => {
      mockMatch.matchedTopic = "a very long topic about something complex and detailed";

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
    });

    it("should handle topics with numbers", () => {
      mockMatch.matchedTopic = "covid19";

      const opener = generateAssociationOpener(mockMatch);

      expect(typeof opener).toBe("string");
    });

    it("should handle topics with unicode characters", () => {
      mockMatch.matchedTopic = "café";

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
    });
  });

  describe("urgency consideration (optional)", () => {
    it("should generate appropriate opener for urgent shares", () => {
      mockMatch.share.urgency = 0.9;
      mockMatch.share.canInterrupt = true;

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
      // Might be more emphatic for urgent shares
    });

    it("should generate appropriate opener for low-urgency shares", () => {
      mockMatch.share.urgency = 0.2;
      mockMatch.share.canInterrupt = false;

      const opener = generateAssociationOpener(mockMatch);

      expect(opener.length).toBeGreaterThan(0);
      // Might be more casual for low-urgency shares
    });
  });
});
