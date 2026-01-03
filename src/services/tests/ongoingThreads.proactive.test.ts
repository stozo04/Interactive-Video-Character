import { describe, it, expect, beforeEach, vi } from 'vitest';
import { selectProactiveThread, markThreadMentionedAsync, clearThreadsCache } from '../ongoingThreads';
import type { OngoingThread } from '../ongoingThreads';

// Mock stateService
const mockGetOngoingThreads = vi.fn();
const mockSaveAllOngoingThreads = vi.fn();

vi.mock('../stateService', () => ({
  getOngoingThreads: (...args: unknown[]) => mockGetOngoingThreads(...args),
  saveAllOngoingThreads: (...args: unknown[]) => mockSaveAllOngoingThreads(...args),
}));

describe('selectProactiveThread', () => {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  it('should return null if no threads provided', () => {
    expect(selectProactiveThread([])).toBeNull();
  });

  it('should return null if all threads have intensity < 0.6', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.5,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
      }
    ];
    expect(selectProactiveThread(threads)).toBeNull();
  });

  it('should return null if thread was mentioned in last 24 hours', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: now - (12 * 60 * 60 * 1000), // 12 hours ago
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
      }
    ];
    expect(selectProactiveThread(threads)).toBeNull();
  });

  it('should return null if thread is less than 4 hours old', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - (2 * 60 * 60 * 1000), // 2 hours ago
      }
    ];
    expect(selectProactiveThread(threads)).toBeNull();
  });

  it('should return thread with highest intensity when multiple eligible', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
      },
      {
        id: '2',
        theme: 'family',
        currentState: 'Thinking about family',
        intensity: 0.9, // Higher intensity
        lastMentioned: null,
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
      }
    ];
    const result = selectProactiveThread(threads);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('2');
    expect(result!.intensity).toBe(0.9);
  });

  it('should boost user-related threads by 0.1', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.75,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - ONE_DAY_MS,
      },
      {
        id: '2',
        theme: 'user_reflection',
        currentState: 'Thinking about what user said',
        intensity: 0.7, // Lower intensity BUT user-related
        lastMentioned: null,
        userRelated: true, // Gets 0.1 boost = 0.8 total
        createdAt: now - ONE_DAY_MS,
      }
    ];
    const result = selectProactiveThread(threads);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('2'); // Should win due to boost
  });

  it('should return thread that was mentioned more than 24 hours ago', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: now - (25 * 60 * 60 * 1000), // 25 hours ago
        userRelated: false,
        createdAt: now - (2 * ONE_DAY_MS),
      }
    ];
    const result = selectProactiveThread(threads);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('1');
  });

  it('should return thread that is at least 4 hours old', () => {
    const threads: OngoingThread[] = [
      {
        id: '1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: null,
        userRelated: false,
        createdAt: now - (5 * 60 * 60 * 1000), // 5 hours ago
      }
    ];
    const result = selectProactiveThread(threads);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('1');
  });
});

describe('markThreadMentionedAsync', () => {
  const testUserId = 'test-user-123';
  
  beforeEach(() => {
    vi.clearAllMocks();
    clearThreadsCache(); // Clear cache to ensure fresh fetch
    mockGetOngoingThreads.mockResolvedValue([
      {
        id: 'thread1',
        theme: 'creative_project',
        currentState: 'Working on a video',
        intensity: 0.7,
        lastMentioned: null,
        userRelated: false,
        createdAt: Date.now() - 1000 * 60 * 60 * 24,
      },
      {
        id: 'thread2',
        theme: 'family',
        currentState: 'Thinking about family',
        intensity: 0.8,
        lastMentioned: null,
        userRelated: false,
        createdAt: Date.now() - 1000 * 60 * 60 * 24,
      }
    ]);
    mockSaveAllOngoingThreads.mockResolvedValue(undefined);
  });

  it('should update lastMentioned timestamp for specified thread', async () => {
    await markThreadMentionedAsync('thread1');
    
    // getOngoingThreadsAsync may also save (non-blocking), so we check the last call
    expect(mockSaveAllOngoingThreads).toHaveBeenCalled();
    const lastCall = mockSaveAllOngoingThreads.mock.calls[mockSaveAllOngoingThreads.mock.calls.length - 1];
    const savedThreads = lastCall[1] as OngoingThread[];
    
    const updatedThread = savedThreads.find(t => t.id === 'thread1');
    expect(updatedThread).toBeDefined();
    expect(updatedThread!.lastMentioned).not.toBeNull();
    expect(updatedThread!.lastMentioned).toBeGreaterThan(Date.now() - 1000); // Within last second
    
    // Other thread should be unchanged
    const unchangedThread = savedThreads.find(t => t.id === 'thread2');
    expect(unchangedThread!.lastMentioned).toBeNull();
  });

  it('should handle thread not found gracefully', async () => {
    await markThreadMentionedAsync('nonexistent-thread');
    
    // Should still save threads (no crash)
    // getOngoingThreadsAsync may also save (non-blocking), so we check that save was called
    expect(mockSaveAllOngoingThreads).toHaveBeenCalled();
    const lastCall = mockSaveAllOngoingThreads.mock.calls[mockSaveAllOngoingThreads.mock.calls.length - 1];
    const savedThreads = lastCall[1] as OngoingThread[];
    expect(savedThreads.length).toBe(2); // Both threads still present
  });

  it('should handle Supabase errors gracefully', async () => {
    // Clear cache and mock error
    clearThreadsCache();
    mockGetOngoingThreads.mockRejectedValueOnce(new Error('Supabase error'));
    
    // getOngoingThreadsAsync catches errors and returns fallback, so markThreadMentionedAsync
    // will still run but with empty/fallback threads. The error is handled gracefully.
    // We verify it doesn't crash - it will try to save empty threads or handle the error
    await expect(markThreadMentionedAsync('thread1')).resolves.not.toThrow();
  });
});

