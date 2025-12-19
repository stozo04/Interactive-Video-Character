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
    // Fetch all active loops (we'll sort client-side)
    const { data: loops, error: fetchError } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('id, topic, salience, created_at')
      .eq('user_id', userId)
      .in('status', ['active', 'surfaced']);
    
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
      expiredIds: expireIds, 
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

