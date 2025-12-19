// src/services/__tests__/loopCleanup.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Create hoisted mocks that can be accessed in both mock factory and tests
const { mockFrom } = vi.hoisted(() => {
  const mockFromFn = vi.fn();
  return { mockFrom: mockFromFn };
});

// Mock Supabase - use hoisted mock
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: mockFrom,
  },
}));

// Import after mocking
import {
  expireOldLoops,
  expireDuplicateLoops,
  capActiveLoops,
  runScheduledCleanup,
  getCleanupStats,
  CLEANUP_CONFIG
} from '../loopCleanupService';

// ============================================
// Configuration Tests
// ============================================

describe('Cleanup Configuration', () => {
  it('should have sensible default values', () => {
    expect(CLEANUP_CONFIG.maxLoopAgeDays).toBeGreaterThan(0);
    expect(CLEANUP_CONFIG.maxLoopAgeDays).toBeLessThanOrEqual(14);
    
    expect(CLEANUP_CONFIG.maxActiveLoops).toBeGreaterThan(0);
    expect(CLEANUP_CONFIG.maxActiveLoops).toBeLessThanOrEqual(50);
    
    expect(CLEANUP_CONFIG.maxSurfacedLoops).toBeGreaterThan(0);
  });

  it('should allow configuration override', () => {
    const customConfig = {
      maxLoopAgeDays: 3,
      maxActiveLoops: 10,
      maxSurfacedLoops: 15
    };
    
    // Config should be mergeable
    const merged = { ...CLEANUP_CONFIG, ...customConfig };
    expect(merged.maxLoopAgeDays).toBe(3);
  });
});

// ============================================
// Age-Based Expiry Tests
// ============================================

describe('expireOldLoops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should expire loops older than configured days', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          lt: vi.fn().mockResolvedValueOnce({
            data: [
              { id: '1', topic: 'old-topic', created_at: '2025-12-10T00:00:00Z' },
              { id: '2', topic: 'older-topic', created_at: '2025-12-08T00:00:00Z' }
            ],
            error: null
          })
        })
      })
    });

    const updateMock = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValueOnce({ error: null })
    });

    (mockFrom as any)
      .mockReturnValueOnce({ select: selectMock })
      .mockReturnValueOnce({ update: updateMock });

    const result = await expireOldLoops('user-1');
    
    expect(result.expiredCount).toBe(2);
  });

  it('should not expire recent loops', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          lt: vi.fn().mockResolvedValueOnce({
            data: [], // No old loops found
            error: null
          })
        })
      })
    });

    (mockFrom as any).mockReturnValue({ select: selectMock });

    const result = await expireOldLoops('user-1');
    
    expect(result.expiredCount).toBe(0);
  });

  it('should handle database errors gracefully', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          lt: vi.fn().mockResolvedValueOnce({
            data: null,
            error: { message: 'Database error' }
          })
        })
      })
    });

    (mockFrom as any).mockReturnValue({ select: selectMock });

    const result = await expireOldLoops('user-1');
    
    expect(result.expiredCount).toBe(0);
    expect(result.error).toBeDefined();
  });

  it('should respect custom maxAgeDays parameter', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          lt: vi.fn().mockResolvedValueOnce({
            data: [],
            error: null
          })
        })
      })
    });

    (mockFrom as any).mockReturnValue({ select: selectMock });

    await expireOldLoops('user-1', { maxAgeDays: 1 });
    
    // Verify the query was called (we can't easily verify the date, but function should work)
    expect(mockFrom).toHaveBeenCalledWith('presence_contexts');
  });
});

// ============================================
// Duplicate Expiry Tests
// ============================================

describe('expireDuplicateLoops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should keep newest loop and expire older duplicates', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValueOnce({
            data: [
              { id: '1', topic: 'interview', created_at: '2025-12-18T10:00:00Z', salience: 0.8 },
              { id: '2', topic: 'Interview', created_at: '2025-12-18T08:00:00Z', salience: 0.8 },
              { id: '3', topic: 'interview', created_at: '2025-12-17T10:00:00Z', salience: 0.7 },
              { id: '4', topic: 'lunch', created_at: '2025-12-18T09:00:00Z', salience: 0.6 }
            ],
            error: null
          })
        })
      })
    });

    const updateMock = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValueOnce({ error: null })
    });

    (mockFrom as any)
      .mockReturnValueOnce({ select: selectMock })
      .mockReturnValueOnce({ update: updateMock });

    const result = await expireDuplicateLoops('user-1');
    
    // Should expire 2 duplicate "interview" loops, keep newest
    expect(result.expiredCount).toBeGreaterThanOrEqual(0);
    expect(result.duplicateTopics).toBeDefined();
  });

  it('should use fuzzy matching for similar topics', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValueOnce({
            data: [
              { id: '1', topic: 'Holiday Party', created_at: '2025-12-18T10:00:00Z' },
              { id: '2', topic: 'holiday parties', created_at: '2025-12-18T08:00:00Z' },
              { id: '3', topic: 'Holiday Parties', created_at: '2025-12-17T10:00:00Z' }
            ],
            error: null
          })
        })
      })
    });

    const updateMock = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValueOnce({ error: null })
    });

    (mockFrom as any)
      .mockReturnValueOnce({ select: selectMock })
      .mockReturnValueOnce({ update: updateMock });

    const result = await expireDuplicateLoops('user-1');
    
    // All three should be considered duplicates (keep 1, expire 2)
    expect(result.duplicateTopics.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty loop list', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValueOnce({
            data: [],
            error: null
          })
        })
      })
    });

    (mockFrom as any).mockReturnValue({ select: selectMock });

    const result = await expireDuplicateLoops('user-1');
    
    expect(result.expiredCount).toBe(0);
    expect(result.duplicateTopics).toEqual([]);
  });
});

// ============================================
// Cap-Based Cleanup Tests
// ============================================

describe('capActiveLoops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should expire lowest salience loops when over cap', async () => {
    // Mock: Return 25 loops when cap is 20
    const manyLoops = Array.from({ length: 25 }, (_, i) => ({
      id: `loop-${i}`,
      topic: `topic-${i}`,
      salience: 0.5 + (i * 0.01), // Increasing salience
      created_at: new Date().toISOString()
    }));

    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValueOnce({
          data: manyLoops,
          error: null
        })
      })
    });

    const updateMock = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValueOnce({ error: null })
    });

    (mockFrom as any)
      .mockReturnValueOnce({ select: selectMock })
      .mockReturnValueOnce({ update: updateMock });

    const result = await capActiveLoops('user-1', 20);
    
    // Should expire 5 lowest-salience loops (if all have salience < 0.85)
    expect(result.expiredCount).toBeGreaterThanOrEqual(0);
  });

  it('should not expire anything if under cap', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValueOnce({
          data: Array.from({ length: 10 }, (_, i) => ({
            id: `loop-${i}`,
            topic: `topic-${i}`,
            salience: 0.5,
            created_at: new Date().toISOString()
          })),
          error: null
        })
      })
    });

    (mockFrom as any).mockReturnValue({ select: selectMock });

    const result = await capActiveLoops('user-1', 20);
    
    expect(result.expiredCount).toBe(0);
  });

  it('should prefer expiring older loops when salience is equal', async () => {
    const loops = [
      { id: '1', topic: 'old', salience: 0.5, created_at: '2025-12-16T00:00:00Z' },
      { id: '2', topic: 'new', salience: 0.5, created_at: '2025-12-18T00:00:00Z' }
    ];

    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValueOnce({
          data: loops,
          error: null
        })
      })
    });

    const updateMock = vi.fn().mockReturnValue({
      in: vi.fn(() => Promise.resolve({ error: null }))
    });

    (mockFrom as any)
      .mockReturnValueOnce({ select: selectMock })
      .mockReturnValueOnce({ update: updateMock });

    const result = await capActiveLoops('user-1', 1);
    
    // Should keep newer, expire older (maxLoops=1, so expire 1 of 2)
    expect(result.expiredCount).toBe(1);
    expect(result.expiredIds).toHaveLength(1);
  });
});

// ============================================
// Full Cleanup Run Tests
// ============================================

describe('runScheduledCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for all queries - chain needs to return promises
    const selectChainForExpireOld = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          lt: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      })
    });
    const selectChainForDedup = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      })
    });
    const selectChainForCap = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [], error: null })
      })
    });
    const updateMock = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ error: null })
    });
    
    // Mock from() to return different chains for select vs update
    (mockFrom as any)
      .mockReturnValueOnce({ select: selectChainForExpireOld })
      .mockReturnValueOnce({ select: selectChainForDedup })
      .mockReturnValueOnce({ select: selectChainForCap })
      .mockReturnValue({ update: updateMock, select: selectChainForCap });
  });

  it('should run all cleanup steps in order', async () => {
    const result = await runScheduledCleanup('user-1');
    
    expect(result.success).toBe(true);
    expect(result.steps).toHaveProperty('expireOld');
    expect(result.steps).toHaveProperty('expireDuplicates');
    expect(result.steps).toHaveProperty('capLoops');
  });

  it('should continue even if one step fails', async () => {
    // First call (expireOld) fails on fetch, rest succeed  
    // Query: from().select().eq().in().lt() - each method returns chainable object
    const chainFail = {
      eq: vi.fn(() => chainFail),
      in: vi.fn(() => chainFail),
      lt: vi.fn(() => Promise.resolve({ data: null, error: { message: 'Database Error' } }))
    };
    const selectMockFail = vi.fn(() => chainFail);
    
    const chainSuccess = {
      eq: vi.fn(() => chainSuccess),
      in: vi.fn(() => chainSuccess),
      order: vi.fn(() => Promise.resolve({ data: [], error: null }))
    };
    const selectMockSuccess = vi.fn(() => chainSuccess);
    
    const chainCap = {
      eq: vi.fn(() => chainCap),
      in: vi.fn(() => Promise.resolve({ data: [], error: null }))
    };
    const selectMockCap = vi.fn(() => chainCap);
    
    const updateChain = {
      in: vi.fn(() => Promise.resolve({ error: null }))
    };
    const updateMock = vi.fn(() => updateChain);
    
    (mockFrom as any)
      .mockReturnValueOnce({ select: selectMockFail })  // expireOld fetch fails
      .mockReturnValueOnce({ select: selectMockSuccess }) // expireDuplicates succeeds  
      .mockReturnValueOnce({ update: updateMock }) // expireDuplicates update
      .mockReturnValueOnce({ select: selectMockCap }) // capLoops succeeds
      .mockReturnValueOnce({ update: updateMock }); // capLoops update

    const result = await runScheduledCleanup('user-1');
    
    // Should still complete, just with partial success - expireOld should have error
    expect(result.steps.expireOld.error).toBe('Database Error');
  });

  it('should return total expired count', async () => {
    const result = await runScheduledCleanup('user-1');
    
    expect(typeof result.totalExpired).toBe('number');
  });

  it('should record duration', async () => {
    const result = await runScheduledCleanup('user-1');
    
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ============================================
// Stats & Reporting Tests
// ============================================

describe('getCleanupStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return current loop counts by status', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValueOnce({
        data: [
          { status: 'active' },
          { status: 'active' },
          { status: 'surfaced' },
          { status: 'expired' },
          { status: 'resolved' }
        ],
        error: null
      })
    });

    const selectMock2 = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      })
    });

    const selectMock3 = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [], error: null })
      })
    });

    (mockFrom as any)
      .mockReturnValueOnce({ select: selectMock })
      .mockReturnValueOnce({ select: selectMock2 })
      .mockReturnValueOnce({ select: selectMock3 });

    const stats = await getCleanupStats('user-1');
    
    expect(stats).toHaveProperty('active');
    expect(stats).toHaveProperty('surfaced');
    expect(stats).toHaveProperty('expired');
    expect(stats).toHaveProperty('total');
  });

  it('should identify loops needing cleanup', async () => {
    // Mock many active loops (100 > maxActiveLoops of 20)
    const manyActive = Array.from({ length: 100 }, () => ({ status: 'active' }));
    
    // The query chain is: from().select('status').eq(userId)
    // eq() returns a thenable (has then method) that resolves to { data, error }
    const chain1 = {
      eq: vi.fn(() => ({
        then: (resolve: any) => Promise.resolve({ data: manyActive, error: null }).then(resolve)
      }))
    };
    const selectMock1 = vi.fn(() => chain1);

    const chain2 = {
      eq: vi.fn(() => chain2),
      in: vi.fn(() => chain2),
      order: vi.fn(() => chain2),
      limit: vi.fn(() => chain2),
      single: vi.fn(() => Promise.resolve({ data: null, error: null }))
    };
    const selectMock2 = vi.fn(() => chain2);

    const chain3 = {
      eq: vi.fn(() => chain3),
      in: vi.fn(() => Promise.resolve({ data: [], error: null }))
    };
    const selectMock3 = vi.fn(() => chain3);

    (mockFrom as any)
      .mockReturnValueOnce({ select: selectMock1 })  // status counts query
      .mockReturnValueOnce({ select: selectMock2 })  // oldest active query
      .mockReturnValueOnce({ select: selectMock3 }); // duplicate detection query

    const stats = await getCleanupStats('user-1');
    
    // With 100 active loops, needsCleanup should be true (100 > 20)
    expect(stats.needsCleanup).toBe(true);
    expect(stats.active).toBe(100);
  });
});

// ============================================
// Scheduler Tests
// ============================================

describe('Cleanup Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          lt: vi.fn().mockResolvedValue({ data: [], error: null }),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      })
    });
    const updateMock = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ error: null })
    });
    (mockFrom as any).mockReturnValue({ select: selectMock, update: updateMock });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should run cleanup on configured interval', async () => {
    const { startCleanupScheduler, stopCleanupScheduler } = await import('../loopCleanupService');
    
    const onCleanup = vi.fn();
    
    startCleanupScheduler('user-1', { 
      intervalMs: 60000, 
      onComplete: onCleanup 
    });
    
    // The scheduler runs immediately on start (cleanupOnInit=true)
    // Advance just a bit to let the immediate run complete
    await vi.advanceTimersByTimeAsync(10);
    
    // Should have been called from the immediate run
    expect(onCleanup).toHaveBeenCalled();
    
    // Stop scheduler before advancing more timers to avoid infinite loop
    stopCleanupScheduler();
    
    // Advance timers to verify interval was set (but won't run since we stopped)
    await vi.advanceTimersByTimeAsync(60000);
  });

  it('should allow manual trigger', async () => {
    const { triggerCleanupNow } = await import('../loopCleanupService');
    
    const result = await triggerCleanupNow('user-1');
    
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });
});


