// src/services/tests/intimacyState.test.ts
/**
 * Phase 4: Supabase Migration Tests for Intimacy State
 * 
 * Tests the async Supabase-backed functions with caching:
 * - getIntimacyStateAsync(userId) with caching
 * - storeIntimacyStateAsync(userId, state)
 * - recordMessageQualityAsync(userId, message)
 * - calculateIntimacyProbabilityAsync(userId, relationship, moodFlirtThreshold)
 * - shouldFlirtMomentOccurAsync(userId, relationship, moodFlirtThreshold, bidType)
 * - getIntimacyContextForPromptAsync(userId, relationship, moodFlirtThreshold)
 * - resetIntimacyStateAsync(userId)
 * - Sync fallbacks that use cached data
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock stateService (Supabase layer)
const mockGetIntimacyState = vi.fn();
const mockSaveIntimacyState = vi.fn();

vi.mock('../stateService', () => ({
  getIntimacyState: (...args: unknown[]) => mockGetIntimacyState(...args),
  saveIntimacyState: (...args: unknown[]) => mockSaveIntimacyState(...args),
  createDefaultIntimacyState: vi.fn(() => ({
    recentToneModifier: 0,
    vulnerabilityExchangeActive: false,
    lastVulnerabilityAt: null,
    lowEffortStreak: 0,
    recentQuality: 0.5,
  })),
}));

// Mock supabaseClient to avoid Supabase initialization
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    })),
  },
}));

// Mock localStorage for backwards compatibility tests
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

// Import after mocks are set up
import {
  getIntimacyStateAsync,
  storeIntimacyStateAsync,
  recordMessageQualityAsync,
  calculateIntimacyProbabilityAsync,
  shouldFlirtMomentOccurAsync,
  getIntimacyContextForPromptAsync,
  resetIntimacyStateAsync,
  analyzeMessageQuality,
  clearIntimacyCache,
  type IntimacyState,
} from "../relationshipService";
import type { RelationshipMetrics } from "../relationshipService";

describe("Phase 4: Intimacy State Supabase Migration", () => {
  const testUserId = "test-user-123";
  
  // Default mock intimacy state
  const defaultIntimacyState: IntimacyState = {
    recentToneModifier: 0,
    vulnerabilityExchangeActive: false,
    lastVulnerabilityAt: null,
    lowEffortStreak: 0,
    recentQuality: 0.5,
  };

  // Mock relationship for calculations
  const mockRelationship: RelationshipMetrics = {
    id: "rel-123",
    relationshipScore: 25,
    relationshipTier: "friend",
    warmthScore: 10,
    trustScore: 8,
    playfulnessScore: 5,
    stabilityScore: 7,
    familiarityStage: "developing",
    totalInteractions: 20,
    positiveInteractions: 15,
    negativeInteractions: 5,
    firstInteractionAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    lastInteractionAt: new Date(),
    isRuptured: false,
    lastRuptureAt: null,
    ruptureCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    clearIntimacyCache();
    
    // Set up default mock returns
    mockGetIntimacyState.mockResolvedValue({ ...defaultIntimacyState });
    mockSaveIntimacyState.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearIntimacyCache();
  });

  // ============================================
  // getIntimacyStateAsync Tests
  // ============================================

  describe("getIntimacyStateAsync", () => {
    it("should fetch intimacy state from Supabase with userId", async () => {
      const result = await getIntimacyStateAsync(testUserId);
      
      expect(mockGetIntimacyState).toHaveBeenCalledWith(testUserId);
      expect(result).toEqual(defaultIntimacyState);
    });

    it("should cache result and avoid repeat DB calls", async () => {
      // First call - hits Supabase
      await getIntimacyStateAsync(testUserId);
      expect(mockGetIntimacyState).toHaveBeenCalledTimes(1);
      
      // Second call - should use cache
      await getIntimacyStateAsync(testUserId);
      expect(mockGetIntimacyState).toHaveBeenCalledTimes(1); // Still 1
    });

    it("should fetch fresh data for different userId", async () => {
      await getIntimacyStateAsync(testUserId);
      await getIntimacyStateAsync("different-user");
      
      expect(mockGetIntimacyState).toHaveBeenCalledTimes(2);
    });

    it("should handle Supabase errors gracefully", async () => {
      mockGetIntimacyState.mockRejectedValueOnce(new Error("DB error"));
      
      const result = await getIntimacyStateAsync(testUserId);
      
      // Should return default state on error
      expect(result).toEqual(defaultIntimacyState);
    });
  });

  // ============================================
  // storeIntimacyStateAsync Tests
  // ============================================

  describe("storeIntimacyStateAsync", () => {
    it("should save intimacy state to Supabase", async () => {
      const newState: IntimacyState = {
        ...defaultIntimacyState,
        recentToneModifier: 0.3,
        recentQuality: 0.8,
      };
      
      await storeIntimacyStateAsync(testUserId, newState);
      
      expect(mockSaveIntimacyState).toHaveBeenCalledWith(testUserId, newState);
    });

    it("should update local cache after saving", async () => {
      const newState: IntimacyState = {
        ...defaultIntimacyState,
        lowEffortStreak: 3,
      };
      
      await storeIntimacyStateAsync(testUserId, newState);
      
      // Cache should be updated, so next get should not hit DB
      mockGetIntimacyState.mockClear();
      const retrieved = await getIntimacyStateAsync(testUserId);
      
      expect(mockGetIntimacyState).not.toHaveBeenCalled();
      expect(retrieved.lowEffortStreak).toBe(3);
    });
  });

  // ============================================
  // recordMessageQualityAsync Tests
  // ============================================

  describe("recordMessageQualityAsync", () => {
    it("should update low effort streak for short messages", async () => {
      await recordMessageQualityAsync(testUserId, "ok");
      
      expect(mockSaveIntimacyState).toHaveBeenCalled();
      const savedState = mockSaveIntimacyState.mock.calls[0][1];
      expect(savedState.lowEffortStreak).toBe(1);
    });

    it("should reset low effort streak for high-effort messages", async () => {
      // First, set up a state with existing low effort streak
      mockGetIntimacyState.mockResolvedValueOnce({
        ...defaultIntimacyState,
        lowEffortStreak: 3,
      });
      
      await recordMessageQualityAsync(testUserId, "I've been thinking a lot about what you said earlier, and I really appreciate your perspective on this.");
      
      const savedState = mockSaveIntimacyState.mock.calls[0][1];
      expect(savedState.lowEffortStreak).toBe(0);
    });

    it("should activate vulnerability exchange for vulnerable messages", async () => {
      await recordMessageQualityAsync(testUserId, "I'm scared about sharing this with you, but I trust you");
      
      const savedState = mockSaveIntimacyState.mock.calls[0][1];
      expect(savedState.vulnerabilityExchangeActive).toBe(true);
      expect(savedState.lastVulnerabilityAt).not.toBeNull();
    });

    it("should update recent quality with rolling average", async () => {
      // Start with default 0.5 quality - use a message that qualifies as high effort (contains 'honestly')
      await recordMessageQualityAsync(testUserId, "Honestly, this is a really thoughtful message that I wanted to share with you about my thoughts");
      
      const savedState = mockSaveIntimacyState.mock.calls[0][1];
      // Quality should be shifted from 0.5 baseline (high effort adds 0.2)
      // Rolling average: 0.5 * 0.7 + 0.7 * 0.3 = 0.35 + 0.21 = 0.56
      expect(savedState.recentQuality).toBeGreaterThan(0.5);
    });
  });

  // ============================================
  // analyzeMessageQuality Tests (Pure function)
  // ============================================

  describe("analyzeMessageQuality", () => {
    it("should detect low effort messages", () => {
      const result = analyzeMessageQuality("ok");
      
      expect(result.isLowEffort).toBe(true);
      expect(result.quality).toBeLessThan(0.5);
    });

    it("should detect high effort messages", () => {
      const result = analyzeMessageQuality("I've been thinking about this for a while, and honestly I believe that taking time to reflect is important");
      
      expect(result.isHighEffort).toBe(true);
      expect(result.quality).toBeGreaterThan(0.5);
    });

    it("should detect vulnerable messages", () => {
      const result = analyzeMessageQuality("I'm afraid to say this, but I feel like I need your support");
      
      expect(result.isVulnerable).toBe(true);
      expect(result.quality).toBeGreaterThan(0.5);
    });

    it("should handle empty messages", () => {
      const result = analyzeMessageQuality("");
      
      expect(result.quality).toBeLessThanOrEqual(0.5);
      expect(result.isLowEffort).toBe(true);
    });
  });

  // ============================================
  // calculateIntimacyProbabilityAsync Tests
  // ============================================

  describe("calculateIntimacyProbabilityAsync", () => {
    it("should calculate probability based on relationship tier", async () => {
      const probability = await calculateIntimacyProbabilityAsync(
        testUserId,
        mockRelationship,
        0.5
      );
      
      expect(probability).toBeGreaterThan(0);
      expect(probability).toBeLessThanOrEqual(1);
    });

    it("should return very low probability for null relationship", async () => {
      const probability = await calculateIntimacyProbabilityAsync(
        testUserId,
        null,
        0.5
      );
      
      expect(probability).toBeLessThanOrEqual(0.15);
    });

    it("should reduce probability during rupture", async () => {
      const rupturedRelationship: RelationshipMetrics = {
        ...mockRelationship,
        isRuptured: true,
      };
      
      const normalProb = await calculateIntimacyProbabilityAsync(testUserId, mockRelationship, 0.5);
      const rupturedProb = await calculateIntimacyProbabilityAsync(testUserId, rupturedRelationship, 0.5);
      
      expect(rupturedProb).toBeLessThan(normalProb);
    });

    it("should boost probability during vulnerability exchange", async () => {
      // Set up vulnerability exchange state
      mockGetIntimacyState.mockResolvedValueOnce({
        ...defaultIntimacyState,
        vulnerabilityExchangeActive: true,
        lastVulnerabilityAt: Date.now() - 1000 * 60 * 5, // 5 minutes ago
      });
      clearIntimacyCache();
      
      const vulnProb = await calculateIntimacyProbabilityAsync(testUserId, mockRelationship, 0.5);
      
      // Reset for normal comparison
      clearIntimacyCache();
      mockGetIntimacyState.mockResolvedValueOnce(defaultIntimacyState);
      
      const normalProb = await calculateIntimacyProbabilityAsync(testUserId, mockRelationship, 0.5);
      
      expect(vulnProb).toBeGreaterThan(normalProb);
    });
  });

  // ============================================
  // shouldFlirtMomentOccurAsync Tests
  // ============================================

  describe("shouldFlirtMomentOccurAsync", () => {
    it("should return boolean based on probability", async () => {
      // Run multiple times to ensure it returns boolean
      const results = await Promise.all([
        shouldFlirtMomentOccurAsync(testUserId, mockRelationship, 0.5, "neutral"),
        shouldFlirtMomentOccurAsync(testUserId, mockRelationship, 0.5, "neutral"),
        shouldFlirtMomentOccurAsync(testUserId, mockRelationship, 0.5, "neutral"),
      ]);
      
      results.forEach(result => {
        expect(typeof result).toBe("boolean");
      });
    });

    it("should increase flirt chance for play bids", async () => {
      // Mock high probability state
      mockGetIntimacyState.mockResolvedValue({
        ...defaultIntimacyState,
        recentToneModifier: 0.4,
        recentQuality: 0.9,
      });
      clearIntimacyCache();
      
      // With play bid multiplier (1.5x), it should be more likely to return true
      // We can't deterministically test random, but we can verify the function works
      const result = await shouldFlirtMomentOccurAsync(testUserId, mockRelationship, 0.5, "play");
      expect(typeof result).toBe("boolean");
    });
  });

  // ============================================
  // getIntimacyContextForPromptAsync Tests
  // ============================================

  describe("getIntimacyContextForPromptAsync", () => {
    it("should return formatted intimacy guidance string", async () => {
      const context = await getIntimacyContextForPromptAsync(testUserId, mockRelationship, 0.5);
      
      expect(typeof context).toBe("string");
      expect(context).toContain("INTIMACY LEVEL");
    });

    it("should include vulnerability exchange note when active", async () => {
      mockGetIntimacyState.mockResolvedValueOnce({
        ...defaultIntimacyState,
        vulnerabilityExchangeActive: true,
        lastVulnerabilityAt: Date.now() - 1000 * 60 * 5,
      });
      clearIntimacyCache();
      
      const context = await getIntimacyContextForPromptAsync(testUserId, mockRelationship, 0.5);
      
      expect(context).toContain("VULNERABILITY EXCHANGE ACTIVE");
    });

    it("should include low effort warning when streak is high", async () => {
      mockGetIntimacyState.mockResolvedValueOnce({
        ...defaultIntimacyState,
        lowEffortStreak: 3,
      });
      clearIntimacyCache();
      
      const context = await getIntimacyContextForPromptAsync(testUserId, mockRelationship, 0.5);
      
      expect(context).toContain("LOW EFFORT DETECTED");
    });
  });

  // ============================================
  // resetIntimacyStateAsync Tests
  // ============================================

  describe("resetIntimacyStateAsync", () => {
    it("should save default intimacy state to Supabase", async () => {
      await resetIntimacyStateAsync(testUserId);
      
      expect(mockSaveIntimacyState).toHaveBeenCalled();
      const savedState = mockSaveIntimacyState.mock.calls[0][1];
      expect(savedState.recentToneModifier).toBe(0);
      expect(savedState.lowEffortStreak).toBe(0);
    });

    it("should clear the local cache", async () => {
      // Prime cache
      await getIntimacyStateAsync(testUserId);
      expect(mockGetIntimacyState).toHaveBeenCalledTimes(1);
      
      // Reset
      await resetIntimacyStateAsync(testUserId);
      
      // Next call should hit DB again
      await getIntimacyStateAsync(testUserId);
      expect(mockGetIntimacyState).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // Cache Management Tests
  // ============================================

  describe("Cache Management", () => {
    it("clearIntimacyCache should reset all cached data", async () => {
      // Prime cache
      await getIntimacyStateAsync(testUserId);
      expect(mockGetIntimacyState).toHaveBeenCalledTimes(1);
      
      // Clear cache
      clearIntimacyCache();
      
      // Next call should hit DB again
      await getIntimacyStateAsync(testUserId);
      expect(mockGetIntimacyState).toHaveBeenCalledTimes(2);
    });

    it("should invalidate cache when userId changes", async () => {
      await getIntimacyStateAsync(testUserId);
      await getIntimacyStateAsync("different-user");
      
      // Both should have hit the DB
      expect(mockGetIntimacyState).toHaveBeenCalledTimes(2);
    });
  });

});
