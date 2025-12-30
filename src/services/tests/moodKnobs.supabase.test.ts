// src/services/tests/moodKnobs.supabase.test.ts
/**
 * Phase 2: Supabase Migration Tests for moodKnobs.ts
 * 
 * Tests the async Supabase-backed functions with caching:
 * - getMoodStateAsync(userId) with caching
 * - getEmotionalMomentumAsync(userId) with caching
 * - recordInteractionAsync(userId, tone, message, context)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock stateService (Supabase layer)
const mockGetMoodState = vi.fn();
const mockSaveMoodState = vi.fn();
const mockGetEmotionalMomentum = vi.fn();
const mockSaveEmotionalMomentum = vi.fn();
const mockCreateDefaultMoodState = vi.fn();
const mockCreateDefaultEmotionalMomentum = vi.fn();

vi.mock('../stateService', () => ({
  getMoodState: (...args: unknown[]) => mockGetMoodState(...args),
  saveMoodState: (...args: unknown[]) => mockSaveMoodState(...args),
  getEmotionalMomentum: (...args: unknown[]) => mockGetEmotionalMomentum(...args),
  saveEmotionalMomentum: (...args: unknown[]) => mockSaveEmotionalMomentum(...args),
  createDefaultMoodState: () => mockCreateDefaultMoodState(),
  createDefaultEmotionalMomentum: () => mockCreateDefaultEmotionalMomentum(),
}));

// Mock intentService for genuine moment detection
vi.mock('../intentService', () => ({
  detectGenuineMomentLLMCached: vi.fn().mockResolvedValue({
    isGenuine: false,
    category: null,
    confidence: 0,
    explanation: 'No genuine moment detected',
  }),
  mapCategoryToInsecurity: vi.fn((cat: string) => cat),
}));

// Import after mocks are set up
import {
  getMoodStateAsync,
  getEmotionalMomentumAsync,
  recordInteractionAsync,
  updateEmotionalMomentumAsync,
  getMoodKnobsAsync,
  clearMoodKnobsCache,
  type MoodState,
  type EmotionalMomentum,
} from "../moodKnobs";

describe("Phase 2: moodKnobs Supabase Migration", () => {
  const testUserId = "test-user-123";
  
  // Helper to get today's daily seed (matches getDailySeed() logic)
  const getTodaySeed = (): number => {
    const today = new Date();
    return today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  };

  // Default mock data
  const defaultMoodState: MoodState = {
    dailyEnergy: 0.7,
    socialBattery: 1.0,
    internalProcessing: false,
    calculatedAt: Date.now(),
    dailySeed: getTodaySeed(), // Use today's seed to avoid "new day" logic
    lastInteractionAt: Date.now(),
    lastInteractionTone: 0,
  };
  
  const defaultMomentum: EmotionalMomentum = {
    currentMoodLevel: 0,
    momentumDirection: 0,
    positiveInteractionStreak: 0,
    recentInteractionTones: [],
    genuineMomentDetected: false,
    lastGenuineMomentAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearMoodKnobsCache();
    
    // Set up default mock returns
    mockCreateDefaultMoodState.mockReturnValue({ ...defaultMoodState });
    mockCreateDefaultEmotionalMomentum.mockReturnValue({ ...defaultMomentum });
    mockGetMoodState.mockResolvedValue({ ...defaultMoodState });
    mockGetEmotionalMomentum.mockResolvedValue({ ...defaultMomentum });
    mockSaveMoodState.mockResolvedValue(undefined);
    mockSaveEmotionalMomentum.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearMoodKnobsCache();
  });

  // ============================================
  // getMoodStateAsync Tests
  // ============================================

  describe("getMoodStateAsync", () => {
    it("should fetch mood state from Supabase with userId", async () => {
      const result = await getMoodStateAsync(testUserId);
      
      expect(mockGetMoodState).toHaveBeenCalledWith(testUserId);
      expect(result.dailyEnergy).toBe(0.7);
    });

    it("should cache result and avoid repeat DB calls", async () => {
      // First call - hits Supabase
      await getMoodStateAsync(testUserId);
      expect(mockGetMoodState).toHaveBeenCalledTimes(1);
      
      // Second call - should use cache
      await getMoodStateAsync(testUserId);
      expect(mockGetMoodState).toHaveBeenCalledTimes(1); // Still 1, no new call
    });

    it("should fetch fresh data for different userId", async () => {
      await getMoodStateAsync(testUserId);
      await getMoodStateAsync("different-user");
      
      expect(mockGetMoodState).toHaveBeenCalledTimes(2);
    });

    it("should handle Supabase errors gracefully", async () => {
      mockGetMoodState.mockRejectedValueOnce(new Error("DB error"));
      
      const result = await getMoodStateAsync(testUserId);
      
      // Should return default state on error
      expect(result.dailyEnergy).toBeDefined();
    });
  });

  // ============================================
  // getEmotionalMomentumAsync Tests
  // ============================================

  describe("getEmotionalMomentumAsync", () => {
    it("should fetch emotional momentum from Supabase with userId", async () => {
      const result = await getEmotionalMomentumAsync(testUserId);
      
      expect(mockGetEmotionalMomentum).toHaveBeenCalledWith(testUserId);
      expect(result.currentMoodLevel).toBe(0);
    });

    it("should cache result and avoid repeat DB calls", async () => {
      await getEmotionalMomentumAsync(testUserId);
      await getEmotionalMomentumAsync(testUserId);
      
      expect(mockGetEmotionalMomentum).toHaveBeenCalledTimes(1);
    });

    it("should invalidate cache for different userId", async () => {
      await getEmotionalMomentumAsync(testUserId);
      await getEmotionalMomentumAsync("another-user");
      
      expect(mockGetEmotionalMomentum).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // recordInteractionAsync Tests
  // ============================================

  describe("recordInteractionAsync", () => {
    it("should accept userId as first parameter", async () => {
      await recordInteractionAsync(testUserId, 0.5, "Hello!");
      
      // Should have saved state with userId
      expect(mockSaveMoodState).toHaveBeenCalled();
      const savedCall = mockSaveMoodState.mock.calls[0];
      expect(savedCall[0]).toBe(testUserId);
    });

    it("should update emotional momentum with tone (simplified)", async () => {
      await recordInteractionAsync(testUserId, 0.8, "Great chat!");

      expect(mockSaveEmotionalMomentum).toHaveBeenCalled();
      const savedCall = mockSaveEmotionalMomentum.mock.calls[0];
      expect(savedCall[0]).toBe(testUserId);
      // Simplified: momentum should have updated mood level and streak
      const savedMomentum = savedCall[1];
      // Tone > 0.3 = positive streak increment
      expect(savedMomentum.positiveInteractionStreak).toBeGreaterThan(0);
    });

    it("should update cache so subsequent async calls get fresh data", async () => {
      await recordInteractionAsync(testUserId, 0.8, "Test");

      // Next async call should use cached data
      const momentum = await getEmotionalMomentumAsync(testUserId);

      // Simplified: streak should be updated for positive tone
      expect(momentum.positiveInteractionStreak).toBe(1);
    });
  });

  // ============================================
  // updateEmotionalMomentumAsync Tests
  // ============================================

  describe("updateEmotionalMomentumAsync", () => {
    it("should require userId parameter", async () => {
      await updateEmotionalMomentumAsync(testUserId, 0.7, "Nice!");
      
      expect(mockSaveEmotionalMomentum).toHaveBeenCalled();
      expect(mockSaveEmotionalMomentum.mock.calls[0][0]).toBe(testUserId);
    });

    it("should track positive interaction streaks", async () => {
      // Multiple positive interactions
      await updateEmotionalMomentumAsync(testUserId, 0.7, "");
      await updateEmotionalMomentumAsync(testUserId, 0.8, "");
      await updateEmotionalMomentumAsync(testUserId, 0.6, "");
      
      // Get the last saved momentum
      const lastCall = mockSaveEmotionalMomentum.mock.calls.at(-1);
      const savedMomentum = lastCall?.[1];
      
      expect(savedMomentum?.positiveInteractionStreak).toBeGreaterThanOrEqual(3);
    });
  });

  // ============================================
  // getMoodKnobsAsync Tests
  // ============================================

  describe("getMoodKnobsAsync", () => {
    it("should return calculated mood knobs", async () => {
      const knobs = await getMoodKnobsAsync(testUserId);
      
      expect(knobs.verbosity).toBeDefined();
      expect(knobs.warmthAvailability).toBeDefined();
      expect(knobs.flirtThreshold).toBeDefined();
    });

    it("should use cached state data", async () => {
      await getMoodKnobsAsync(testUserId);
      await getMoodKnobsAsync(testUserId);
      
      // Should only call stateService once due to caching
      expect(mockGetMoodState).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================
  // Cache Invalidation Tests
  // ============================================

  describe("Cache Management", () => {
    it("clearMoodKnobsCache should reset all cached data", async () => {
      // Prime caches
      await getMoodStateAsync(testUserId);
      await getEmotionalMomentumAsync(testUserId);
      
      expect(mockGetMoodState).toHaveBeenCalledTimes(1);
      expect(mockGetEmotionalMomentum).toHaveBeenCalledTimes(1);
      
      // Clear cache
      clearMoodKnobsCache();
      
      // Next calls should hit DB again
      await getMoodStateAsync(testUserId);
      await getEmotionalMomentumAsync(testUserId);
      
      expect(mockGetMoodState).toHaveBeenCalledTimes(2);
      expect(mockGetEmotionalMomentum).toHaveBeenCalledTimes(2);
    });
  });
});
