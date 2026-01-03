// src/services/__tests__/idleThoughtsScheduler.test.ts
/**
 * Unit tests for Idle Thoughts Scheduler Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startIdleThoughtsScheduler,
  stopIdleThoughtsScheduler,
  isSchedulerRunning,
  IDLE_THOUGHTS_CONFIG
} from '../idleThoughtsScheduler';

// Mock dependencies
vi.mock('../stateService', () => ({
  getMoodState: vi.fn(),
}));

vi.mock('../spontaneity/idleThoughts', () => ({
  generateIdleThought: vi.fn(),
  MIN_ABSENCE_MINUTES_FOR_THOUGHT: 10, // Must include this export used by the scheduler
}));

vi.mock('../ongoingThreads', () => ({
  createUserThreadAsync: vi.fn(),
}));

// Mock idleLife module (Part Two: Kayley Lives Her Life)
vi.mock('../idleLife', () => ({
  generateKayleyExperience: vi.fn(),
  buildExperienceContext: vi.fn(),
  checkCalendarForMessage: vi.fn(),
  maybeGenerateGiftMessage: vi.fn(),
  hasUndeliveredMessage: vi.fn().mockResolvedValue(false),
}));

import { getMoodState } from '../stateService';
import { generateIdleThought } from '../spontaneity/idleThoughts';
import { createUserThreadAsync } from '../ongoingThreads';

describe('Idle Thoughts Scheduler', () => {
  const userId = 'test-user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    stopIdleThoughtsScheduler(); // Clean state before each test
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopIdleThoughtsScheduler(); // Clean up after each test
    vi.useRealTimers();
  });

  describe('Configuration', () => {
    it('should have correct configuration constants', () => {
      expect(IDLE_THOUGHTS_CONFIG.checkIntervalMs).toBe(1 * 60 * 1000); // 1 minute
      expect(IDLE_THOUGHTS_CONFIG.minAbsenceMinutes).toBe(10); // 10 minutes before generating thoughts
      expect(IDLE_THOUGHTS_CONFIG.thoughtIntensity).toBe(0.7);
    });
  });

  describe('Scheduler Control', () => {
    it('should start scheduler and set running state', () => {
      expect(isSchedulerRunning()).toBe(false);

      startIdleThoughtsScheduler();

      expect(isSchedulerRunning()).toBe(true);
    });

    it('should stop scheduler and clear running state', () => {
      startIdleThoughtsScheduler();
      expect(isSchedulerRunning()).toBe(true);

      stopIdleThoughtsScheduler();

      expect(isSchedulerRunning()).toBe(false);
    });

    it('should not crash when stopping already stopped scheduler', () => {
      stopIdleThoughtsScheduler();

      expect(() => stopIdleThoughtsScheduler()).not.toThrow();
      expect(isSchedulerRunning()).toBe(false);
    });

    it('should replace existing scheduler when starting twice', () => {
      startIdleThoughtsScheduler();
      const firstRunning = isSchedulerRunning();

      startIdleThoughtsScheduler(); // Start again

      expect(firstRunning).toBe(true);
      expect(isSchedulerRunning()).toBe(true);
    });
  });

  describe('Thought Generation Logic', () => {
    it('should generate thought when user away >= 10 minutes', async () => {
      const mockMoodState = {
        lastInteractionAt: Date.now() - (15 * 60 * 1000), // 15 minutes ago
        dailyEnergy: 0.7,
        socialBattery: 1.0,
      };

      const mockThought = {
        id: 'thought-123',
        content: 'Been thinking about what you said about work',
        thoughtType: 'memory' as const,
        emotionalTone: 'thoughtful',
      };

      vi.mocked(getMoodState).mockResolvedValue(mockMoodState as any);
      vi.mocked(generateIdleThought).mockResolvedValue(mockThought as any);
      vi.mocked(createUserThreadAsync).mockResolvedValue({} as any);

      startIdleThoughtsScheduler();

      // Stop scheduler to prevent interval from running, but immediate call is already in-flight
      stopIdleThoughtsScheduler();

      // Flush pending microtasks to let the already-started processIdleThought complete
      await vi.runOnlyPendingTimersAsync();

      expect(generateIdleThought).toHaveBeenCalledWith(0.25, 'neutral'); // 15 min = 0.25 hours
      expect(createUserThreadAsync).toHaveBeenCalledWith(
        'idle reflection',
        mockThought.content,
        IDLE_THOUGHTS_CONFIG.thoughtIntensity
      );
    });

    it('should NOT generate thought when user away < 1 minute', async () => {
      const mockMoodState = {
        lastInteractionAt: Date.now() - (30 * 1000), // 30 seconds ago (too recent for 1-min threshold)
        dailyEnergy: 0.7,
        socialBattery: 1.0,
      };

      vi.mocked(getMoodState).mockResolvedValue(mockMoodState as any);

      startIdleThoughtsScheduler();

      // Fast-forward to trigger the check
      await vi.advanceTimersByTimeAsync(1000);

      expect(generateIdleThought).not.toHaveBeenCalled();
      expect(createUserThreadAsync).not.toHaveBeenCalled();
    });

    it('should handle case when generateIdleThought returns null', async () => {
      const mockMoodState = {
        lastInteractionAt: Date.now() - (15 * 60 * 1000),
        dailyEnergy: 0.7,
        socialBattery: 1.0,
      };

      vi.mocked(getMoodState).mockResolvedValue(mockMoodState as any);
      vi.mocked(generateIdleThought).mockResolvedValue(null); // No thought generated (cooldown)

      startIdleThoughtsScheduler();

      // Stop scheduler to prevent interval from running, but immediate call is already in-flight
      stopIdleThoughtsScheduler();

      // Flush pending microtasks to let the already-started processIdleThought complete
      await vi.runOnlyPendingTimersAsync();

      expect(generateIdleThought).toHaveBeenCalledWith(0.25, 'neutral'); // 15 min = 0.25 hours
      expect(createUserThreadAsync).not.toHaveBeenCalled(); // Should not try to create thread
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(getMoodState).mockRejectedValue(new Error('Database error'));

      startIdleThoughtsScheduler();

      // Should not throw - errors are caught and logged
      await vi.advanceTimersByTimeAsync(1000);

      // Verify thought generation was NOT called (due to error)
      expect(generateIdleThought).not.toHaveBeenCalled();
    });
  });

  describe('Periodic Execution', () => {
    it('should run check at configured intervals', async () => {
      const mockMoodState = {
        lastInteractionAt: Date.now() - (5 * 60 * 1000), // Not long enough
        dailyEnergy: 0.7,
        socialBattery: 1.0,
      };

      vi.mocked(getMoodState).mockResolvedValue(mockMoodState as any);

      startIdleThoughtsScheduler();

      // First check (immediate)
      await vi.advanceTimersByTimeAsync(1000);
      const firstCallCount = vi.mocked(getMoodState).mock.calls.length;

      // Second check (after interval)
      await vi.advanceTimersByTimeAsync(IDLE_THOUGHTS_CONFIG.checkIntervalMs);
      const secondCallCount = vi.mocked(getMoodState).mock.calls.length;

      expect(secondCallCount).toBeGreaterThan(firstCallCount);
    });
  });
});
