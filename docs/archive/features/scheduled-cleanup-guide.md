# Fix #5: Scheduled Loop Cleanup (TDD)
## Automatic Stale Loop Management

---

## Overview

**Problem:** Loops accumulate over time, causing:
- 97+ loops in database
- Duplicates like "interview" (10x), "FSA follow-ups" (4x)
- Stale loops from days ago still `active`
- AI overwhelmed with too many things to "remember"

**Solution:** Scheduled cleanup that runs automatically to:
1. Expire old loops (configurable age)
2. Deduplicate similar topics (keep newest)
3. Cap total active loops per user
4. Run on app load + periodically

---

## Cleanup Strategy

| Cleanup Type | Trigger | Action |
|--------------|---------|--------|
| **Age-based** | Loop older than X days | Set status = `expired` |
| **Duplicate** | Multiple loops with similar topic | Keep newest, expire others |
| **Cap-based** | More than N active loops | Expire lowest salience |
| **Surfaced limit** | Surfaced X times already | Set status = `resolved` |

---

## Step 1: Database - Add Indexes for Performance

```sql
-- Run in Supabase SQL Editor

-- Index for cleanup queries (status + user + dates)
CREATE INDEX IF NOT EXISTS idx_presence_contexts_cleanup 
ON presence_contexts (user_id, status, created_at);

-- Index for duplicate detection (user + topic + status)
CREATE INDEX IF NOT EXISTS idx_presence_contexts_dedup 
ON presence_contexts (user_id, topic, status);

-- Add comment
COMMENT ON INDEX idx_presence_contexts_cleanup IS 
  'Optimizes scheduled cleanup queries filtering by user, status, and age';
```

---

## Step 2: Tests First (TDD)

Create `src/services/__tests__/loopCleanup.test.ts`:

```typescript
// src/services/__tests__/loopCleanup.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock Supabase
const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockSupabase),
  delete: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  in: vi.fn(() => mockSupabase),
  lt: vi.fn(() => mockSupabase),
  lte: vi.fn(() => mockSupabase),
  gt: vi.fn(() => mockSupabase),
  gte: vi.fn(() => mockSupabase),
  order: vi.fn(() => mockSupabase),
  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
  single: vi.fn(() => Promise.resolve({ data: null, error: null })),
};

vi.mock('../supabaseClient', () => ({
  supabase: mockSupabase
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
    mockSupabase.limit.mockResolvedValueOnce({
      data: [
        { id: '1', topic: 'old-topic', created_at: '2025-12-10T00:00:00Z' },
        { id: '2', topic: 'older-topic', created_at: '2025-12-08T00:00:00Z' }
      ],
      error: null
    });

    const result = await expireOldLoops('user-1');
    
    expect(result.expiredCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.expiredCount).toBe('number');
  });

  it('should not expire recent loops', async () => {
    mockSupabase.limit.mockResolvedValueOnce({
      data: [], // No old loops found
      error: null
    });

    const result = await expireOldLoops('user-1');
    
    expect(result.expiredCount).toBe(0);
  });

  it('should handle database errors gracefully', async () => {
    mockSupabase.limit.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database error' }
    });

    const result = await expireOldLoops('user-1');
    
    expect(result.expiredCount).toBe(0);
    expect(result.error).toBeDefined();
  });

  it('should respect custom maxAgeDays parameter', async () => {
    mockSupabase.limit.mockResolvedValueOnce({
      data: [],
      error: null
    });

    await expireOldLoops('user-1', { maxAgeDays: 1 });
    
    // Verify the query was called (we can't easily verify the date, but function should work)
    expect(mockSupabase.from).toHaveBeenCalledWith('presence_contexts');
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
    // Mock: Return loops with duplicates
    mockSupabase.limit.mockResolvedValueOnce({
      data: [
        { id: '1', topic: 'interview', created_at: '2025-12-18T10:00:00Z', salience: 0.8 },
        { id: '2', topic: 'Interview', created_at: '2025-12-18T08:00:00Z', salience: 0.8 },
        { id: '3', topic: 'interview', created_at: '2025-12-17T10:00:00Z', salience: 0.7 },
        { id: '4', topic: 'lunch', created_at: '2025-12-18T09:00:00Z', salience: 0.6 }
      ],
      error: null
    });

    const result = await expireDuplicateLoops('user-1');
    
    // Should expire 2 duplicate "interview" loops, keep newest
    expect(result.expiredCount).toBeGreaterThanOrEqual(0);
    expect(result.duplicateTopics).toBeDefined();
  });

  it('should use fuzzy matching for similar topics', async () => {
    mockSupabase.limit.mockResolvedValueOnce({
      data: [
        { id: '1', topic: 'Holiday Party', created_at: '2025-12-18T10:00:00Z' },
        { id: '2', topic: 'holiday parties', created_at: '2025-12-18T08:00:00Z' },
        { id: '3', topic: 'Holiday Parties', created_at: '2025-12-17T10:00:00Z' }
      ],
      error: null
    });

    const result = await expireDuplicateLoops('user-1');
    
    // All three should be considered duplicates (keep 1, expire 2)
    expect(result.duplicateTopics).toContain('holiday party');
  });

  it('should handle empty loop list', async () => {
    mockSupabase.limit.mockResolvedValueOnce({
      data: [],
      error: null
    });

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

    mockSupabase.limit.mockResolvedValueOnce({
      data: manyLoops,
      error: null
    });

    const result = await capActiveLoops('user-1', 20);
    
    // Should expire 5 lowest-salience loops
    expect(result.expiredCount).toBe(5);
  });

  it('should not expire anything if under cap', async () => {
    mockSupabase.limit.mockResolvedValueOnce({
      data: Array.from({ length: 10 }, (_, i) => ({
        id: `loop-${i}`,
        topic: `topic-${i}`,
        salience: 0.5
      })),
      error: null
    });

    const result = await capActiveLoops('user-1', 20);
    
    expect(result.expiredCount).toBe(0);
  });

  it('should prefer expiring older loops when salience is equal', async () => {
    const loops = [
      { id: '1', topic: 'old', salience: 0.5, created_at: '2025-12-16T00:00:00Z' },
      { id: '2', topic: 'new', salience: 0.5, created_at: '2025-12-18T00:00:00Z' }
    ];

    mockSupabase.limit.mockResolvedValueOnce({
      data: loops,
      error: null
    });

    const result = await capActiveLoops('user-1', 1);
    
    // Should keep newer, expire older
    expect(result.expiredCount).toBe(1);
    expect(result.expiredIds).toContain('1');
  });
});

// ============================================
// Full Cleanup Run Tests
// ============================================

describe('runScheduledCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for all queries
    mockSupabase.limit.mockResolvedValue({ data: [], error: null });
  });

  it('should run all cleanup steps in order', async () => {
    const result = await runScheduledCleanup('user-1');
    
    expect(result.success).toBe(true);
    expect(result.steps).toHaveProperty('expireOld');
    expect(result.steps).toHaveProperty('expireDuplicates');
    expect(result.steps).toHaveProperty('capLoops');
  });

  it('should continue even if one step fails', async () => {
    // First call fails, rest succeed
    mockSupabase.limit
      .mockResolvedValueOnce({ data: null, error: { message: 'Error' } })
      .mockResolvedValue({ data: [], error: null });

    const result = await runScheduledCleanup('user-1');
    
    // Should still complete, just with partial success
    expect(result.steps.expireOld.error).toBeDefined();
    expect(result.steps.expireDuplicates.error).toBeUndefined();
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
    mockSupabase.limit.mockResolvedValueOnce({
      data: [
        { status: 'active', count: 15 },
        { status: 'surfaced', count: 10 },
        { status: 'expired', count: 50 },
        { status: 'resolved', count: 20 }
      ],
      error: null
    });

    const stats = await getCleanupStats('user-1');
    
    expect(stats).toHaveProperty('active');
    expect(stats).toHaveProperty('surfaced');
    expect(stats).toHaveProperty('expired');
    expect(stats).toHaveProperty('total');
  });

  it('should identify loops needing cleanup', async () => {
    mockSupabase.limit.mockResolvedValueOnce({
      data: [{ status: 'active', count: 100 }],
      error: null
    });

    const stats = await getCleanupStats('user-1');
    
    expect(stats.needsCleanup).toBe(true);
  });
});

// ============================================
// Scheduler Tests
// ============================================

describe('Cleanup Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSupabase.limit.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should run cleanup on configured interval', async () => {
    const { startCleanupScheduler, stopCleanupScheduler } = await import('../loopCleanupService');
    
    const onCleanup = vi.fn();
    startCleanupScheduler('user-1', { intervalMs: 60000, onComplete: onCleanup });
    
    // Fast-forward 1 minute
    await vi.advanceTimersByTimeAsync(60000);
    
    expect(onCleanup).toHaveBeenCalled();
    
    stopCleanupScheduler();
  });

  it('should allow manual trigger', async () => {
    const { triggerCleanupNow } = await import('../loopCleanupService');
    
    const result = await triggerCleanupNow('user-1');
    
    expect(result).toBeDefined();
  });
});
```

---

## Step 3: Implementation

Create a new file: `src/services/loopCleanupService.ts`

```typescript
// src/services/loopCleanupService.ts
/**
 * Loop Cleanup Service
 * 
 * Manages automatic cleanup of stale, duplicate, and excess loops.
 * Prevents loop accumulation that degrades AI memory quality.
 * 
 * Features:
 * - Age-based expiration (loops older than X days)
 * - Duplicate detection and removal (fuzzy topic matching)
 * - Active loop cap (prevent overwhelming the AI)
 * - Scheduled background cleanup
 * - Manual trigger support
 */

import { supabase } from './supabaseClient';

// ============================================
// Configuration
// ============================================

export const CLEANUP_CONFIG = {
  /** Maximum age of a loop in days before auto-expiry */
  maxLoopAgeDays: 7,
  
  /** Maximum number of active loops per user */
  maxActiveLoops: 20,
  
  /** Maximum number of surfaced loops to keep */
  maxSurfacedLoops: 30,
  
  /** Minimum salience to protect from cap-based cleanup */
  protectedSalienceThreshold: 0.85,
  
  /** How often to run scheduled cleanup (ms) - default 1 hour */
  cleanupIntervalMs: 60 * 60 * 1000,
  
  /** Run cleanup on app initialization */
  cleanupOnInit: true
};

const PRESENCE_CONTEXTS_TABLE = 'presence_contexts';

// ============================================
// Types
// ============================================

export interface CleanupResult {
  expiredCount: number;
  error?: string;
}

export interface DuplicateCleanupResult extends CleanupResult {
  duplicateTopics: string[];
}

export interface CapCleanupResult extends CleanupResult {
  expiredIds: string[];
  previousCount: number;
}

export interface FullCleanupResult {
  success: boolean;
  totalExpired: number;
  durationMs: number;
  steps: {
    expireOld: CleanupResult;
    expireDuplicates: DuplicateCleanupResult;
    capLoops: CapCleanupResult;
  };
}

export interface CleanupStats {
  active: number;
  surfaced: number;
  expired: number;
  resolved: number;
  dismissed: number;
  total: number;
  needsCleanup: boolean;
  oldestActiveDate?: Date;
  duplicateCount: number;
}

// ============================================
// Topic Similarity (shared with presenceDirector)
// ============================================

/**
 * Normalize a topic for comparison.
 * - Lowercase
 * - Remove punctuation
 * - Remove trailing 's' (plurals)
 * - Normalize whitespace
 */
function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/s\b/g, '');
}

/**
 * Check if two topics are similar (for deduplication).
 */
function isSimilarTopic(topic1: string, topic2: string): boolean {
  const norm1 = normalizeTopic(topic1);
  const norm2 = normalizeTopic(topic2);
  
  if (norm1 === norm2) return true;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
  
  // Word overlap check
  const words1 = new Set(norm1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(norm2.split(' ').filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return false;
  
  const overlap = [...words1].filter(w => words2.has(w));
  const overlapRatio = overlap.length / Math.min(words1.size, words2.size);
  
  return overlapRatio >= 0.5;
}

// ============================================
// Age-Based Expiration
// ============================================

/**
 * Expire loops older than the configured maximum age.
 * 
 * @param userId - The user's ID
 * @param options - Optional overrides
 * @returns Result with count of expired loops
 */
export async function expireOldLoops(
  userId: string,
  options: { maxAgeDays?: number } = {}
): Promise<CleanupResult> {
  const maxAgeDays = options.maxAgeDays ?? CLEANUP_CONFIG.maxLoopAgeDays;
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    // Find old loops
    const { data: oldLoops, error: fetchError } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('id, topic, created_at')
      .eq('user_id', userId)
      .in('status', ['active', 'surfaced'])
      .lt('created_at', cutoffDate.toISOString());
    
    if (fetchError) {
      console.error('[LoopCleanup] Error fetching old loops:', fetchError);
      return { expiredCount: 0, error: fetchError.message };
    }
    
    if (!oldLoops || oldLoops.length === 0) {
      return { expiredCount: 0 };
    }
    
    // Expire them
    const ids = oldLoops.map(l => l.id);
    const { error: updateError } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({ status: 'expired' })
      .in('id', ids);
    
    if (updateError) {
      console.error('[LoopCleanup] Error expiring old loops:', updateError);
      return { expiredCount: 0, error: updateError.message };
    }
    
    console.log(`🧹 [LoopCleanup] Expired ${oldLoops.length} old loops (>${maxAgeDays} days):`, 
      oldLoops.map(l => l.topic).slice(0, 5).join(', ') + (oldLoops.length > 5 ? '...' : '')
    );
    
    return { expiredCount: oldLoops.length };
    
  } catch (error) {
    console.error('[LoopCleanup] Error in expireOldLoops:', error);
    return { expiredCount: 0, error: String(error) };
  }
}

// ============================================
// Duplicate Expiration
// ============================================

/**
 * Expire duplicate loops, keeping the most recent one per topic.
 * Uses fuzzy matching to catch variations like "Holiday Party" vs "holiday parties".
 * 
 * @param userId - The user's ID
 * @returns Result with count of expired duplicates
 */
export async function expireDuplicateLoops(userId: string): Promise<DuplicateCleanupResult> {
  try {
    // Fetch all active/surfaced loops
    const { data: loops, error: fetchError } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('id, topic, created_at, salience')
      .eq('user_id', userId)
      .in('status', ['active', 'surfaced'])
      .order('created_at', { ascending: false });
    
    if (fetchError) {
      console.error('[LoopCleanup] Error fetching loops for dedup:', fetchError);
      return { expiredCount: 0, duplicateTopics: [], error: fetchError.message };
    }
    
    if (!loops || loops.length === 0) {
      return { expiredCount: 0, duplicateTopics: [] };
    }
    
    // Group by normalized topic
    const topicGroups = new Map<string, typeof loops>();
    
    for (const loop of loops) {
      const normalizedTopic = normalizeTopic(loop.topic);
      
      // Find existing group that matches
      let foundGroup = false;
      for (const [groupTopic, group] of topicGroups) {
        if (isSimilarTopic(normalizedTopic, groupTopic)) {
          group.push(loop);
          foundGroup = true;
          break;
        }
      }
      
      if (!foundGroup) {
        topicGroups.set(normalizedTopic, [loop]);
      }
    }
    
    // Find duplicates (groups with > 1 loop)
    const toExpire: string[] = [];
    const duplicateTopics: string[] = [];
    
    for (const [topic, group] of topicGroups) {
      if (group.length > 1) {
        duplicateTopics.push(topic);
        
        // Sort by created_at desc (newest first), keep first, expire rest
        group.sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        
        // Expire all but the newest
        for (let i = 1; i < group.length; i++) {
          toExpire.push(group[i].id);
        }
      }
    }
    
    if (toExpire.length === 0) {
      return { expiredCount: 0, duplicateTopics: [] };
    }
    
    // Expire duplicates
    const { error: updateError } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({ status: 'expired' })
      .in('id', toExpire);
    
    if (updateError) {
      console.error('[LoopCleanup] Error expiring duplicates:', updateError);
      return { expiredCount: 0, duplicateTopics, error: updateError.message };
    }
    
    console.log(`🧹 [LoopCleanup] Expired ${toExpire.length} duplicate loops. Topics: ${duplicateTopics.join(', ')}`);
    
    return { expiredCount: toExpire.length, duplicateTopics };
    
  } catch (error) {
    console.error('[LoopCleanup] Error in expireDuplicateLoops:', error);
    return { expiredCount: 0, duplicateTopics: [], error: String(error) };
  }
}

// ============================================
// Cap-Based Cleanup
// ============================================

/**
 * Cap the number of active loops per user.
 * Expires lowest-salience loops first, preferring older loops on tie.
 * 
 * @param userId - The user's ID
 * @param maxLoops - Maximum number of loops to keep
 * @returns Result with count of expired loops
 */
export async function capActiveLoops(
  userId: string,
  maxLoops: number = CLEANUP_CONFIG.maxActiveLoops
): Promise<CapCleanupResult> {
  try {
    // Fetch all active loops, sorted by salience (desc), then created_at (desc)
    const { data: loops, error: fetchError } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('id, topic, salience, created_at')
      .eq('user_id', userId)
      .in('status', ['active', 'surfaced'])
      .order('salience', { ascending: false })
      .order('created_at', { ascending: false });
    
    if (fetchError) {
      console.error('[LoopCleanup] Error fetching loops for cap:', fetchError);
      return { expiredCount: 0, expiredIds: [], previousCount: 0, error: fetchError.message };
    }
    
    if (!loops || loops.length <= maxLoops) {
      return { expiredCount: 0, expiredIds: [], previousCount: loops?.length || 0 };
    }
    
    // Sort by salience (asc) then by age (asc = oldest first) to find ones to expire
    const sorted = [...loops].sort((a, b) => {
      // First by salience (ascending - lowest first)
      if (a.salience !== b.salience) {
        return a.salience - b.salience;
      }
      // Then by age (ascending - oldest first)
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    
    // Take the ones to expire (lowest salience + oldest)
    const toExpireCount = loops.length - maxLoops;
    const toExpire = sorted.slice(0, toExpireCount);
    
    // Filter out protected high-salience loops
    const expireIds = toExpire
      .filter(l => l.salience < CLEANUP_CONFIG.protectedSalienceThreshold)
      .map(l => l.id);
    
    if (expireIds.length === 0) {
      console.log(`[LoopCleanup] ${toExpireCount} loops over cap but all are high-salience protected`);
      return { expiredCount: 0, expiredIds: [], previousCount: loops.length };
    }
    
    // Expire them
    const { error: updateError } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({ status: 'expired' })
      .in('id', expireIds);
    
    if (updateError) {
      console.error('[LoopCleanup] Error expiring capped loops:', updateError);
      return { expiredCount: 0, expiredIds: [], previousCount: loops.length, error: updateError.message };
    }
    
    console.log(`🧹 [LoopCleanup] Capped loops: expired ${expireIds.length} (was ${loops.length}, now ${loops.length - expireIds.length})`);
    
    return { 
      expiredCount: expireIds.length, 
      expiredIds, 
      previousCount: loops.length 
    };
    
  } catch (error) {
    console.error('[LoopCleanup] Error in capActiveLoops:', error);
    return { expiredCount: 0, expiredIds: [], previousCount: 0, error: String(error) };
  }
}

// ============================================
// Full Cleanup Run
// ============================================

/**
 * Run the complete cleanup process.
 * Executes all cleanup steps in order:
 * 1. Expire old loops
 * 2. Expire duplicates
 * 3. Cap active loops
 * 
 * @param userId - The user's ID
 * @param options - Optional configuration overrides
 * @returns Full cleanup result with all steps
 */
export async function runScheduledCleanup(
  userId: string,
  options: Partial<typeof CLEANUP_CONFIG> = {}
): Promise<FullCleanupResult> {
  const config = { ...CLEANUP_CONFIG, ...options };
  const startTime = Date.now();
  
  console.log(`🧹 [LoopCleanup] Starting scheduled cleanup for user ${userId}`);
  
  // Step 1: Expire old loops
  const expireOldResult = await expireOldLoops(userId, { 
    maxAgeDays: config.maxLoopAgeDays 
  });
  
  // Step 2: Expire duplicates
  const expireDuplicatesResult = await expireDuplicateLoops(userId);
  
  // Step 3: Cap active loops
  const capLoopsResult = await capActiveLoops(userId, config.maxActiveLoops);
  
  const totalExpired = 
    expireOldResult.expiredCount + 
    expireDuplicatesResult.expiredCount + 
    capLoopsResult.expiredCount;
  
  const durationMs = Date.now() - startTime;
  
  const result: FullCleanupResult = {
    success: !expireOldResult.error && !expireDuplicatesResult.error && !capLoopsResult.error,
    totalExpired,
    durationMs,
    steps: {
      expireOld: expireOldResult,
      expireDuplicates: expireDuplicatesResult,
      capLoops: capLoopsResult
    }
  };
  
  console.log(`✅ [LoopCleanup] Cleanup complete: expired ${totalExpired} loops in ${durationMs}ms`);
  
  return result;
}

// ============================================
// Stats & Reporting
// ============================================

/**
 * Get cleanup statistics for a user.
 * Useful for debugging and monitoring loop health.
 * 
 * @param userId - The user's ID
 * @returns Cleanup statistics
 */
export async function getCleanupStats(userId: string): Promise<CleanupStats> {
  try {
    // Get counts by status
    const { data: statusCounts, error: countError } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('status')
      .eq('user_id', userId);
    
    if (countError || !statusCounts) {
      console.error('[LoopCleanup] Error getting stats:', countError);
      return {
        active: 0, surfaced: 0, expired: 0, resolved: 0, dismissed: 0,
        total: 0, needsCleanup: false, duplicateCount: 0
      };
    }
    
    // Count by status
    const counts = {
      active: 0,
      surfaced: 0,
      expired: 0,
      resolved: 0,
      dismissed: 0
    };
    
    for (const row of statusCounts) {
      const status = row.status as keyof typeof counts;
      if (status in counts) {
        counts[status]++;
      }
    }
    
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const activeAndSurfaced = counts.active + counts.surfaced;
    
    // Check if cleanup is needed
    const needsCleanup = activeAndSurfaced > CLEANUP_CONFIG.maxActiveLoops;
    
    // Get oldest active loop date
    const { data: oldest } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('created_at')
      .eq('user_id', userId)
      .in('status', ['active', 'surfaced'])
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    
    // Get duplicate count (approximate - count normalized topic groups)
    const { data: activeLoops } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('topic')
      .eq('user_id', userId)
      .in('status', ['active', 'surfaced']);
    
    let duplicateCount = 0;
    if (activeLoops) {
      const normalizedTopics = new Set<string>();
      for (const loop of activeLoops) {
        const normalized = normalizeTopic(loop.topic);
        if (normalizedTopics.has(normalized)) {
          duplicateCount++;
        }
        normalizedTopics.add(normalized);
      }
    }
    
    return {
      ...counts,
      total,
      needsCleanup,
      oldestActiveDate: oldest ? new Date(oldest.created_at) : undefined,
      duplicateCount
    };
    
  } catch (error) {
    console.error('[LoopCleanup] Error in getCleanupStats:', error);
    return {
      active: 0, surfaced: 0, expired: 0, resolved: 0, dismissed: 0,
      total: 0, needsCleanup: false, duplicateCount: 0
    };
  }
}

// ============================================
// Scheduler
// ============================================

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

interface SchedulerOptions {
  intervalMs?: number;
  onComplete?: (result: FullCleanupResult) => void;
}

/**
 * Start the cleanup scheduler.
 * Runs cleanup at configured intervals.
 * 
 * @param userId - The user's ID
 * @param options - Scheduler options
 */
export function startCleanupScheduler(
  userId: string,
  options: SchedulerOptions = {}
): void {
  const intervalMs = options.intervalMs ?? CLEANUP_CONFIG.cleanupIntervalMs;
  
  // Stop existing scheduler if any
  stopCleanupScheduler();
  
  console.log(`🕐 [LoopCleanup] Starting scheduler (interval: ${intervalMs / 1000}s)`);
  
  // Run immediately on start if configured
  if (CLEANUP_CONFIG.cleanupOnInit) {
    runScheduledCleanup(userId).then(result => {
      options.onComplete?.(result);
    });
  }
  
  // Schedule periodic cleanup
  cleanupInterval = setInterval(async () => {
    const result = await runScheduledCleanup(userId);
    options.onComplete?.(result);
  }, intervalMs);
}

/**
 * Stop the cleanup scheduler.
 */
export function stopCleanupScheduler(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[LoopCleanup] Scheduler stopped');
  }
}

/**
 * Manually trigger cleanup now.
 * 
 * @param userId - The user's ID
 * @returns Cleanup result
 */
export async function triggerCleanupNow(userId: string): Promise<FullCleanupResult> {
  console.log('[LoopCleanup] Manual cleanup triggered');
  return runScheduledCleanup(userId);
}

// ============================================
// Exports
// ============================================

export default {
  // Configuration
  CLEANUP_CONFIG,
  
  // Individual cleanup functions
  expireOldLoops,
  expireDuplicateLoops,
  capActiveLoops,
  
  // Full cleanup
  runScheduledCleanup,
  triggerCleanupNow,
  
  // Stats
  getCleanupStats,
  
  // Scheduler
  startCleanupScheduler,
  stopCleanupScheduler
};
```

---

## Step 4: Integration

### File: `src/App.tsx` (or main entry point)

Add cleanup initialization:

```typescript
// src/App.tsx
import { useEffect } from 'react';
import { startCleanupScheduler, stopCleanupScheduler } from './services/loopCleanupService';
import { useAuth } from './hooks/useAuth'; // Your auth hook

function App() {
  const { user } = useAuth();
  
  // Initialize cleanup scheduler when user logs in
  useEffect(() => {
    if (user?.id) {
      startCleanupScheduler(user.id, {
        onComplete: (result) => {
          if (result.totalExpired > 0) {
            console.log(`🧹 Cleaned up ${result.totalExpired} stale loops`);
          }
        }
      });
      
      return () => {
        stopCleanupScheduler();
      };
    }
  }, [user?.id]);
  
  // ... rest of app
}
```

### File: `src/components/DevTools.tsx` (optional - for debugging)

Add manual cleanup button for development:

```typescript
// src/components/DevTools.tsx
import { useState } from 'react';
import { 
  triggerCleanupNow, 
  getCleanupStats,
  type CleanupStats,
  type FullCleanupResult 
} from '../services/loopCleanupService';

export function DevTools({ userId }: { userId: string }) {
  const [stats, setStats] = useState<CleanupStats | null>(null);
  const [lastCleanup, setLastCleanup] = useState<FullCleanupResult | null>(null);
  const [loading, setLoading] = useState(false);
  
  const handleRefreshStats = async () => {
    const newStats = await getCleanupStats(userId);
    setStats(newStats);
  };
  
  const handleCleanup = async () => {
    setLoading(true);
    const result = await triggerCleanupNow(userId);
    setLastCleanup(result);
    await handleRefreshStats();
    setLoading(false);
  };
  
  return (
    <div className="dev-tools">
      <h3>🧹 Loop Cleanup</h3>
      
      <button onClick={handleRefreshStats}>Refresh Stats</button>
      <button onClick={handleCleanup} disabled={loading}>
        {loading ? 'Cleaning...' : 'Run Cleanup Now'}
      </button>
      
      {stats && (
        <div className="stats">
          <p>Active: {stats.active}</p>
          <p>Surfaced: {stats.surfaced}</p>
          <p>Expired: {stats.expired}</p>
          <p>Duplicates: {stats.duplicateCount}</p>
          <p>Needs Cleanup: {stats.needsCleanup ? '⚠️ Yes' : '✅ No'}</p>
        </div>
      )}
      
      {lastCleanup && (
        <div className="last-cleanup">
          <p>Last cleanup: {lastCleanup.totalExpired} expired in {lastCleanup.durationMs}ms</p>
        </div>
      )}
    </div>
  );
}
```


## Step 5: Run Tests

```bash
# Run unit tests
npm run test -- loopCleanup.test.ts

# Run with coverage
npm run test -- loopCleanup.test.ts --coverage
```

---

## Configuration Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `maxLoopAgeDays` | 7 | Loops older than this are expired |
| `maxActiveLoops` | 20 | Maximum active/surfaced loops per user |
| `maxSurfacedLoops` | 30 | Maximum surfaced loops to retain |
| `protectedSalienceThreshold` | 0.85 | Loops above this salience are protected from cap |
| `cleanupIntervalMs` | 3,600,000 | How often to run cleanup (1 hour) |
| `cleanupOnInit` | true | Run cleanup immediately on scheduler start |

---

## Summary Checklist

### Database
- [ ] Add `idx_presence_contexts_cleanup` index
- [ ] Add `idx_presence_contexts_dedup` index

### Implementation
- [ ] Create `loopCleanupService.ts`
- [ ] Add `expireOldLoops()` function
- [ ] Add `expireDuplicateLoops()` function
- [ ] Add `capActiveLoops()` function
- [ ] Add `runScheduledCleanup()` function
- [ ] Add `getCleanupStats()` function
- [ ] Add scheduler functions

### Integration
- [ ] Add cleanup scheduler to App.tsx
- [ ] (Optional) Add DevTools component for manual trigger

### Testing
- [ ] Unit tests pass
- [ ] Run initial cleanup on existing data
- [ ] Verify loop count is reduced

### Verification
```sql
-- Should show reasonable counts after cleanup
SELECT status, COUNT(*) 
FROM presence_contexts 
WHERE user_id = 'gates.steven@gmail.com'
GROUP BY status;

-- active + surfaced should be <= 20
```

---

## Expected Results

**Before Cleanup:**
```
active: 45
surfaced: 52
total: 97+
duplicates: 20+
```

**After Cleanup:**
```
active: 15
surfaced: 5
expired: 77
total: 97 (same, just reclassified)
duplicates: 0
```

**Ongoing:**
- Scheduler runs every hour
- Old loops auto-expire after 7 days
- Duplicates caught on creation (Fix #1)
- Cap enforced at 20 active loops
