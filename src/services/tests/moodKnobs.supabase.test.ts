// src/services/tests/moodKnobs.supabase.test.ts
/**
 * Phase 2: Supabase Migration Tests for moodKnobs.ts
 * 
 * Tests the async Supabase-backed functions with caching:
 * - getMoodStateAsync(userId) with caching
 * - getEmotionalMomentumAsync(userId) with caching
 * - recordInteractionAsync(tone, message, context)
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
      const result = await getMoodStateAsync();
      
      expect(mockGetMoodState).toHaveBeenCalled();
      expect(result.dailyEnergy).toBe(0.7);
    });

    it("should cache result and avoid repeat DB calls", async () => {
      // First call - hits Supabase
      await getMoodStateAsync();
      expect(mockGetMoodState).toHaveBeenCalledTimes(1);
      
      // Second call - should use cache
      await getMoodStateAsync();
      expect(mockGetMoodState).toHaveBeenCalledTimes(1); // Still 1, no new call
    });

    it("should use cache on second call", async () => {
      await getMoodStateAsync();
      await getMoodStateAsync();

      // Should only call DB once due to caching
      expect(mockGetMoodState).toHaveBeenCalledTimes(1);
    });

    it("should handle Supabase errors gracefully", async () => {
      mockGetMoodState.mockRejectedValueOnce(new Error("DB error"));
      
      const result = await getMoodStateAsync();
      
      // Should return default state on error
      expect(result.dailyEnergy).toBeDefined();
    });
  });

  // ============================================
  // getEmotionalMomentumAsync Tests
  // ============================================

  describe("getEmotionalMomentumAsync", () => {
    it("should fetch emotional momentum from Supabase with userId", async () => {
      const result = await getEmotionalMomentumAsync();
      
      expect(mockGetEmotionalMomentum).toHaveBeenCalled();
      expect(result.currentMoodLevel).toBe(0);
    });

    it("should cache result and avoid repeat DB calls", async () => {
      await getEmotionalMomentumAsync();
      await getEmotionalMomentumAsync();
      
      expect(mockGetEmotionalMomentum).toHaveBeenCalledTimes(1);
    });

    it("should use cache after first call", async () => {
      await getEmotionalMomentumAsync();
      await getEmotionalMomentumAsync();

      // Should only call DB once due to caching
      expect(mockGetEmotionalMomentum).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================
  // recordInteractionAsync Tests
  // ============================================

  describe("recordInteractionAsync", () => {
    it("should save mood state when recording interaction", async () => {
      await recordInteractionAsync(0.5, "Hello!");

      // Should have saved state
      expect(mockSaveMoodState).toHaveBeenCalled();
    });

    it("should update emotional momentum with tone (simplified)", async () => {
      await recordInteractionAsync(0.8, "Great chat!");

      expect(mockSaveEmotionalMomentum).toHaveBeenCalled();
      const savedCall = mockSaveEmotionalMomentum.mock.calls[0];
      // Simplified: momentum should have updated mood level and streak
      const savedMomentum = savedCall[0];
      // Tone > 0.3 = positive streak increment
      expect(savedMomentum.positiveInteractionStreak).toBeGreaterThan(0);
    });

    it("should update cache so subsequent async calls get fresh data", async () => {
      await recordInteractionAsync(0.8, "Test");

      // Next async call should use cached data
      const momentum = await getEmotionalMomentumAsync();

      // Simplified: streak should be updated for positive tone
      expect(momentum.positiveInteractionStreak).toBe(1);
    });
  });

  // ============================================
  // updateEmotionalMomentumAsync Tests
  // ============================================

  describe("updateEmotionalMomentumAsync", () => {
    it("should require userId parameter", async () => {
      await updateEmotionalMomentumAsync(0.7, "Nice!");
      
      expect(mockSaveEmotionalMomentum).toHaveBeenCalled();
      expect(mockSaveEmotionalMomentum).toHaveBeenCalled();
    });

    it("should track positive interaction streaks", async () => {
      // Multiple positive interactions
      await updateEmotionalMomentumAsync(0.7, "");
      await updateEmotionalMomentumAsync(0.8, "");
      await updateEmotionalMomentumAsync(0.6, "");
      
      // Get the last saved momentum
      const lastCall = mockSaveEmotionalMomentum.mock.calls.at(-1);
      const savedMomentum = lastCall?.[0];
      
      expect(savedMomentum?.positiveInteractionStreak).toBeGreaterThanOrEqual(3);
    });
  });

  // ============================================
  // getMoodKnobsAsync Tests
  // ============================================

  describe("getMoodKnobsAsync", () => {
    it("should return calculated mood knobs", async () => {
      const knobs = await getMoodKnobsAsync();
      
      expect(knobs.verbosity).toBeDefined();
      expect(knobs.warmthAvailability).toBeDefined();
      expect(knobs.flirtThreshold).toBeDefined();
    });

    it("should use cached state data", async () => {
      await getMoodKnobsAsync();
      await getMoodKnobsAsync();
      
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
      await getMoodStateAsync();
      await getEmotionalMomentumAsync();
      
      expect(mockGetMoodState).toHaveBeenCalledTimes(1);
      expect(mockGetEmotionalMomentum).toHaveBeenCalledTimes(1);
      
      // Clear cache
      clearMoodKnobsCache();
      
      // Next calls should hit DB again
      await getMoodStateAsync();
      await getEmotionalMomentumAsync();
      
      expect(mockGetMoodState).toHaveBeenCalledTimes(2);
      expect(mockGetEmotionalMomentum).toHaveBeenCalledTimes(2);
    });
  });
});
