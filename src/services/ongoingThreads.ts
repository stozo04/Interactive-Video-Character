// src/services/ongoingThreads.ts
/**
 * Ongoing Threads Service
 * 
 * Manages Kayley's "mental weather" - 3-5 ongoing things she's thinking about
 * that create continuity and make her feel like a person with her own inner life.
 * 
 * Key principle: Less "life events generator", more "ongoing mental weather"
 * 
 * Threads can be:
 * - Autonomous (her own stuff: creative projects, family, self-improvement)
 * - User-triggered ("I keep thinking about what you said")
 * 
 * Phase 3 Supabase Migration:
 * - All state now persisted to Supabase via stateService
 * - Local caching to avoid DB hits on every call
 * - Async-first API with sync fallbacks for backwards compatibility
 */

import {
  getOngoingThreads as getSupabaseThreads,
  saveAllOngoingThreads,
  type OngoingThread as SupabaseOngoingThread,
  type ThreadTheme as SupabaseThreadTheme,
} from './stateService';
import { getMoodAsync, type KayleyMood } from './moodKnobs';
import { getRelationship } from './relationshipService';
import { loadConversationHistory } from './conversationHistoryService';
import { getUserFacts } from './memoryService';
import { getRecentLifeEvents } from './lifeEventService';
import {
  generateAutonomousThoughtCached,
  type ThoughtGenerationContext,
  type ThoughtMessage,
} from './autonomousThoughtService';
import { KAYLEY_FULL_PROFILE } from '../domain/characters/kayleyCharacterProfile';

// ============================================
// Types (re-export for backwards compatibility)
// ============================================

export type ThreadTheme = SupabaseThreadTheme;
export type OngoingThread = SupabaseOngoingThread;

// ============================================
// Constants
// ============================================

const MAX_THREADS = 5;
const MIN_THREADS = 2;
// Cache TTL: 60 seconds for single-user prototype
// NOTE: Caching is for PERFORMANCE only, not correctness.
// Supabase is the single source of truth. In-memory cache can lead to state drift
// if multiple tabs are open or serverless functions scale up/down.
// For production with high read volume, consider keeping cache but with shorter TTL.
const CACHE_TTL = 60000; // 60 seconds cache TTL

// ============================================
// Local Caching Layer
// ============================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let threadsCache: CacheEntry<OngoingThread[]> | null = null;

/**
 * Check if a cache entry is still valid
 */
function isCacheValid<T>(cache: CacheEntry<T> | null): boolean {
  if (!cache) return false;
  if (Date.now() - cache.timestamp > CACHE_TTL) return false;
  return true;
}

/**
 * Clear threads cache (for testing or user switch)
 */
export function clearThreadsCache(): void {
  threadsCache = null;
}

// ============================================
// Autonomous Thread Themes
// ============================================

const AUTONOMOUS_THEMES: ThreadTheme[] = [
  "creative_project",
  "family",
  "self_improvement",
  "social",
  "work",
  "existential",
];

const MAX_AUTONOMOUS_ATTEMPTS = 6;

type ThoughtContextBase = Omit<ThoughtGenerationContext, "theme">;

// ============================================
// Internal Helper Functions
// ============================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Decay thread intensities over time
 */
function decayThreads(threads: OngoingThread[]): OngoingThread[] {
  const now = Date.now();
  const hourInMs = 1000 * 60 * 60;
  
  return threads.map(thread => {
    // Decay based on time since last update
    const hoursSinceUpdate = (now - (thread.lastMentioned || thread.createdAt)) / hourInMs;
    
    // Faster decay for user-related threads (they're more ephemeral)
    const decayRate = thread.userRelated ? 0.05 : 0.02;
    const decayAmount = hoursSinceUpdate * decayRate;
    
    return {
      ...thread,
      intensity: Math.max(0.1, thread.intensity - decayAmount),
    };
  });
}



/**
 * Clean up threads that are too old or too low intensity
 */
function cleanupThreads(threads: OngoingThread[]): OngoingThread[] {
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  return threads.filter(thread => {
    // Remove if too old
    if (now - thread.createdAt > maxAge) return false;
    
    // Remove if intensity dropped too low (unless it's user-related - keep those a bit longer)
    if (thread.intensity < 0.15 && !thread.userRelated) return false;
    if (thread.intensity < 0.1) return false;
    
    return true;
  });
}


/**
 * Map conversation history to thought messages.
 */
function mapConversationHistoryToThoughtMessages(
  history: Array<{ role: string; text: string }>
): ThoughtMessage[] {
  return history.slice(-5).map((message) => ({
    role: message.role === "user" ? "user" : "assistant",
    content: message.text,
  }));
}

/**
 * Build the shared context for autonomous thought generation.
 */
async function buildThoughtContextBase(): Promise<ThoughtContextBase> {
  const [mood, relationship, lifeEvents, facts, history] = await Promise.all([
    getMoodAsync().catch(() => ({ energy: 0, warmth: 0.5, genuineMoment: false })),
    getRelationship().catch(() => null),
    getRecentLifeEvents().catch(() => []),
    getUserFacts("all").catch(() => []),
    loadConversationHistory().catch(() => []),
  ]);

  const recentConversations = mapConversationHistoryToThoughtMessages(history);
  const userFacts = facts
    .slice(0, 10)
    .map((fact) => `${fact.category}: ${fact.fact_key} = ${fact.fact_value}`);

  return {
    characterProfile: KAYLEY_FULL_PROFILE,
    recentConversations,
    currentMood: mood as KayleyMood,
    relationshipTier: relationship?.relationshipTier ?? "acquaintance",
    recentLifeEvents: lifeEvents,
    userFacts,
  };
}

function pickAutonomousTheme(existingThemes: Set<ThreadTheme>): ThreadTheme {
  const availableThemes = AUTONOMOUS_THEMES.filter(
    (theme) => !existingThemes.has(theme)
  );
  const pool = availableThemes.length > 0 ? availableThemes : AUTONOMOUS_THEMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate a new autonomous thread using the LLM thought service.
 */
async function createAutonomousThread(
  theme: ThreadTheme,
  baseContext: ThoughtContextBase
): Promise<OngoingThread | null> {
  const thought = await generateAutonomousThoughtCached({
    theme,
    ...baseContext,
  });

  if (!thought.shouldMention || thought.confidence < 0.5 || !thought.content) {
    console.log(`[OngoingThreads] Skipping low-confidence thought: ${thought.content}`);
    return null;
  }

  const intensity = Math.min(1, Math.max(0.2, thought.intensity || 0.4));

  return {
    id: generateId(),
    theme,
    currentState: thought.content,
    intensity,
    lastMentioned: null,
    userRelated: false,
    createdAt: Date.now(),
  };
}

/**
 * Ensure we have minimum threads (async, LLM-backed)
 */
async function ensureMinimumThreadsAsync(
  threads: OngoingThread[]
): Promise<OngoingThread[]> {
  if (threads.length >= MIN_THREADS) {
    return threads;
  }

  const baseContext = await buildThoughtContextBase();
  const existingThemes = new Set(threads.map((thread) => thread.theme));
  const updated = [...threads];

  let attempts = 0;
  while (updated.length < MIN_THREADS && attempts < MAX_AUTONOMOUS_ATTEMPTS) {
    const theme = pickAutonomousTheme(existingThemes);
    const newThread = await createAutonomousThread(theme, baseContext);
    attempts += 1;

    if (!newThread) {
      continue;
    }

    updated.push(newThread);
    existingThemes.add(newThread.theme);
  }

  return updated;
}

/**
 * Process threads: apply decay and cleanup (sync)
 */
function processThreadsBase(threads: OngoingThread[]): OngoingThread[] {
  let processed = decayThreads(threads);
  processed = cleanupThreads(processed);
  return processed;
}

/**
 * Process threads: apply decay, cleanup, ensure minimum (async)
 */
async function processThreadsAsync(threads: OngoingThread[]): Promise<OngoingThread[]> {
  let processed = processThreadsBase(threads);
  processed = await ensureMinimumThreadsAsync(processed);
  processed = processed.slice(0, MAX_THREADS);
  return processed;
}

/**
 * Get the most relevant thread to potentially surface (internal logic)
 * Returns null if no thread should be surfaced right now
 */
function findThreadToSurface(threads: OngoingThread[]): OngoingThread | null {
  // Find threads that are high intensity and haven't been mentioned recently
  const now = Date.now();
  const cooldownMs = 1000 * 60 * 30; // 30 minutes between mentions of same thread
  
  const candidates = threads.filter(thread => {
    // Must have decent intensity
    if (thread.intensity < 0.4) return false;
    
    // Must not have been mentioned recently
    if (thread.lastMentioned && now - thread.lastMentioned < cooldownMs) {
      return false;
    }
    
    return true;
  });
  
  if (candidates.length === 0) return null;
  
  // Weight by intensity - higher intensity = more likely
  const totalIntensity = candidates.reduce((sum, t) => sum + t.intensity, 0);
  let random = Math.random() * totalIntensity;
  
  for (const thread of candidates) {
    random -= thread.intensity;
    if (random <= 0) {
      return thread;
    }
  }
  
  return candidates[0];
}

/**
 * Select a proactive thread for conversation starters.
 * 
 * Selection criteria:
 * 1. Intensity >= 0.6 (she's thinking about it a lot)
 * 2. Not mentioned in last 24 hours (or never mentioned)
 * 3. At least 4 hours old (settling time)
 * 4. User-related threads get a 0.1 boost
 * 
 * @param threads - Array of ongoing threads to select from
 * @returns Selected thread or null if none eligible
 */
export function selectProactiveThread(threads: OngoingThread[]): OngoingThread | null {
  if (threads.length === 0) {
    return null;
  }

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const MIN_INTENSITY = 0.6;

  // Filter eligible threads
  const candidates = threads.filter(thread => {
    // Must have minimum intensity
    if (thread.intensity < MIN_INTENSITY) {
      return false;
    }

    // Must not have been mentioned in last 24 hours
    if (thread.lastMentioned) {
      const hoursSinceMention = (now - thread.lastMentioned) / (1000 * 60 * 60);
      if (hoursSinceMention < 24) {
        return false;
      }
    }

    // Must be at least 4 hours old (settling time)
    const hoursSinceCreation = (now - thread.createdAt) / (1000 * 60 * 60);
    if (hoursSinceCreation < 4) {
      return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    return null;
  }

  // Calculate effective priority (intensity + boost for user-related)
  const candidatesWithPriority = candidates.map(thread => ({
    thread,
    effectiveIntensity: thread.intensity + (thread.userRelated ? 0.1 : 0),
  }));

  // Sort by effective intensity (highest first)
  candidatesWithPriority.sort((a, b) => b.effectiveIntensity - a.effectiveIntensity);

  // Return the thread with highest effective intensity
  return candidatesWithPriority[0].thread;
}

/**
 * Format threads for prompt (internal logic)
 */
function formatThreadsInternal(threads: OngoingThread[], topThread: OngoingThread | null): string {
  if (threads.length === 0) {
    return '';
  }
  
  let prompt = `
ONGOING MENTAL THREADS:
You have a few things on your mind right now. They affect your mood but you don't always share them.

`;

  // Show top 2-3 threads by intensity
  const sorted = [...threads].sort((a, b) => b.intensity - a.intensity).slice(0, 3);
  
  sorted.forEach((thread) => {
    const intensityLabel = thread.intensity > 0.7 ? 'strongly' : 
                          thread.intensity > 0.4 ? 'somewhat' : 'faintly';
    prompt += `- ${intensityLabel} thinking about: "${thread.currentState}"${thread.userRelated ? ' (about something user said)' : ''}\n`;
  });

  if (topThread) {
    prompt += `
You MAY naturally bring up "${topThread.currentState}" if it fits the conversation flow.
But don't force it. Let it emerge if there's a natural opening.
`;
  } else {
    prompt += `
No thread is pressing enough to bring up right now. Just be present.
`;
  }

  return prompt;
}

// ============================================
// Async Functions (Primary API - Supabase-backed)
// ============================================

/**
 * Get ongoing threads from Supabase with caching and processing.
 * 
 * @returns Promise resolving to processed OngoingThread array
 */
export async function getOngoingThreadsAsync(): Promise<OngoingThread[]> {
  // Return from cache if valid
  if (isCacheValid(threadsCache)) {
    return threadsCache!.data;
  }
  
  try {
    const threads = await getSupabaseThreads();
    
    // Process threads (decay, cleanup, ensure minimum)
    const processed = await processThreadsAsync(threads);
    
    // Update cache
    threadsCache = { data: processed, timestamp: Date.now() };
    
    // Save processed threads back to Supabase (non-blocking)
    saveAllOngoingThreads(processed).catch(console.error);
    
    return processed;
  } catch (error) {
    console.error('[OngoingThreads] Error fetching threads:', error);
    
    // Return minimum threads on error
    const fallback = await processThreadsAsync([]);
    threadsCache = { data: fallback, timestamp: Date.now() };
    return fallback;
  }
}

/**
 * Create a user-triggered thread (when user says something she'll think about)
 * 
 * @param trigger - What the user said
 * @param currentState - What she's thinking about it
 * @param intensity - How present in her mind (0.1-1.0)
 * @returns Promise resolving to the new thread
 */
export async function createUserThreadAsync(
  trigger: string,
  currentState: string,
  intensity: number = 0.7
): Promise<OngoingThread> {
  const threads = await getOngoingThreadsAsync();
  
  const newThread: OngoingThread = {
    id: generateId(),
    theme: 'user_reflection',
    currentState,
    intensity: Math.min(1.0, intensity),
    lastMentioned: null,
    userRelated: true,
    createdAt: Date.now(),
    userTrigger: trigger,
  };
  
  // Add to threads (remove oldest if at max)
  let updatedThreads = [...threads, newThread];
  if (updatedThreads.length > MAX_THREADS) {
    // Remove lowest intensity non-user thread first
    updatedThreads.sort((a, b) => {
      if (a.userRelated !== b.userRelated) return a.userRelated ? 1 : -1;
      return a.intensity - b.intensity;
    });
    updatedThreads = updatedThreads.slice(1);
  }
  
  // Update cache
  threadsCache = { data: updatedThreads, timestamp: Date.now() };
  
  // Save to Supabase
  await saveAllOngoingThreads(updatedThreads);
  
  return newThread;
}

/**
 * Boost a thread's intensity (when it becomes relevant)
 * 
 * @param threadId - Thread to boost
 * @param amount - Amount to boost (default 0.2)
 */
export async function boostThreadAsync(
  threadId: string,
  amount: number = 0.2
): Promise<void> {
  const threads = await getOngoingThreadsAsync();
  
  const updatedThreads = threads.map(thread => {
    if (thread.id === threadId) {
      return {
        ...thread,
        intensity: Math.min(1.0, thread.intensity + amount),
      };
    }
    return thread;
  });
  
  // Update cache
  threadsCache = { data: updatedThreads, timestamp: Date.now() };
  
  // Save to Supabase
  await saveAllOngoingThreads(updatedThreads);
}

/**
 * Mark a thread as mentioned (to prevent over-repetition)
 * 
 * @param threadId - Thread to mark
 */
export async function markThreadMentionedAsync(
  threadId: string
): Promise<void> {
  const threads = await getOngoingThreadsAsync();
  
  const updatedThreads = threads.map(thread => {
    if (thread.id === threadId) {
      return {
        ...thread,
        lastMentioned: Date.now(),
        // Reduce intensity after mentioning to prevent spam
        intensity: thread.intensity * 0.7,
      };
    }
    return thread;
  });
  
  // Update cache
  threadsCache = { data: updatedThreads, timestamp: Date.now() };
  
  // Save to Supabase
  await saveAllOngoingThreads(updatedThreads);
}

/**
 * Get the most relevant thread to potentially surface
 * Returns null if no thread should be surfaced right now
 * 
 * @returns Promise resolving to thread or null
 */
export async function getThreadToSurfaceAsync(): Promise<OngoingThread | null> {
  const threads = await getOngoingThreadsAsync();
  return findThreadToSurface(threads);
}

/**
 * Format threads for prompt from pre-fetched data.
 * OPTIMIZATION: Avoids redundant DB fetch when data already available.
 * 
 * @param threads - Pre-fetched ongoing threads array
 * @returns Formatted prompt string
 */
export function formatThreadsFromData(threads: OngoingThread[]): string {
  // Process threads (decay, cleanup) without LLM calls
  const processed = processThreadsBase(threads);
  
  // Find top thread to potentially surface
  const topThread = findThreadToSurface(processed);
  
  // Format for prompt (CPU-only, fast)
  return formatThreadsInternal(processed, topThread);
}

/**
 * Format threads for prompt context (async version)
 * 
 * @returns Promise resolving to formatted prompt string
 */
export async function formatThreadsForPromptAsync(): Promise<string> {
  const threads = await getOngoingThreadsAsync();
  const topThread = findThreadToSurface(threads);
  return formatThreadsInternal(threads, topThread);
}

/**
 * Reset threads (async version)
 * 
 */
export async function resetThreadsAsync(): Promise<void> {
  // Clear cache
  threadsCache = null;
  
  // Clear from Supabase
  await saveAllOngoingThreads([]);
  
  console.log('🧠 [OngoingThreads] Reset threads');
}

