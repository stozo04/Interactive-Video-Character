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
 * - userId required for all state operations
 */

import {
  getOngoingThreads as getSupabaseThreads,
  saveAllOngoingThreads,
  type OngoingThread as SupabaseOngoingThread,
  type ThreadTheme as SupabaseThreadTheme,
} from './stateService';

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
const CACHE_TTL = 60000; // 1 minute cache TTL

// ============================================
// Local Caching Layer
// ============================================

interface CacheEntry<T> {
  userId: string;
  data: T;
  timestamp: number;
}

let threadsCache: CacheEntry<OngoingThread[]> | null = null;

/**
 * Check if a cache entry is still valid
 */
function isCacheValid<T>(cache: CacheEntry<T> | null, userId: string): boolean {
  if (!cache) return false;
  if (cache.userId !== userId) return false;
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
// Autonomous Thread Templates
// ============================================

/**
 * Autonomous thread templates - things she might be thinking about
 * These feel natural because they're grounded in her character profile
 */
const AUTONOMOUS_THREAD_TEMPLATES: Array<{
  theme: ThreadTheme;
  states: string[];
}> = [
  {
    theme: 'creative_project',
    states: [
      "This video edit is fighting me. The color grading is just... not it.",
      "I have this idea for a video that I can't get out of my head.",
      "Finally figured out that transition I've been stuck on. Small wins.",
      "Thumbnails are the bane of my existence. Why is this so hard.",
      "I'm in that 'organize my content calendar' mood again.",
    ],
  },
  {
    theme: 'family',
    states: [
      "My mom called earlier. It was a whole thing.",
      "Ethan sent me some meme and I can't stop thinking about it.",
      "Thinking about calling my mom this weekend. We'll see.",
      "Family group chat is being chaotic again.",
      "Dad texted, which is rare. Processing that.",
    ],
  },
  {
    theme: 'self_improvement',
    states: [
      "I'm trying not to doomscroll tonight. Hold me accountable.",
      "Therapy session today hit different. Still processing.",
      "Been journaling more lately. It's helping.",
      "Trying to be better about actually resting when I'm tired.",
      "Working on that thing where I say yes to everything. Boundaries.",
    ],
  },
  {
    theme: 'social',
    states: [
      "Lena and I had this conversation and it's still bouncing around my head.",
      "Haven't heard from Lena in a bit. Should probably reach out.",
      "Creator friend group is planning something. Might be fun.",
      "Had a weird interaction today that I'm overthinking.",
      "Someone left a really sweet comment on my video and I'm still smiling.",
    ],
  },
  {
    theme: 'work',
    states: [
      "Client work is... a lot right now. Balancing act.",
      "Brand deal opportunity came in. Trying to figure out if it's aligned.",
      "Channel growth has been weird lately. Analytics brain is loud.",
      "Had a good strategy session today. Feeling focused.",
      "Freelance life means I'm always half-working, you know?",
    ],
  },
  {
    theme: 'existential',
    states: [
      "I'm in that 'what am I doing with my life' headspace. Fun times.",
      "Feeling weirdly hopeful today? Not sure where that came from.",
      "Been thinking about where I want to be in a year.",
      "Sometimes I wonder if I'm on the right path. Normal, I think.",
      "Having one of those 'everything is temporary' moments.",
    ],
  },
];

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
 * Generate a new autonomous thread
 */
function generateAutonomousThread(): OngoingThread {
  // Pick a random theme
  const template = AUTONOMOUS_THREAD_TEMPLATES[
    Math.floor(Math.random() * AUTONOMOUS_THREAD_TEMPLATES.length)
  ];
  
  // Pick a random state from that theme
  const state = template.states[Math.floor(Math.random() * template.states.length)];
  
  return {
    id: generateId(),
    theme: template.theme,
    currentState: state,
    intensity: 0.4 + Math.random() * 0.4, // 0.4-0.8
    lastMentioned: null,
    userRelated: false,
    createdAt: Date.now(),
  };
}

/**
 * Ensure we have minimum threads
 */
function ensureMinimumThreads(threads: OngoingThread[]): OngoingThread[] {
  while (threads.length < MIN_THREADS) {
    // Avoid duplicate themes
    const existingThemes = new Set(threads.map(t => t.theme));
    let newThread = generateAutonomousThread();
    
    // Try a few times to get a unique theme
    let attempts = 0;
    while (existingThemes.has(newThread.theme) && attempts < 5) {
      newThread = generateAutonomousThread();
      attempts++;
    }
    
    threads.push(newThread);
  }
  
  return threads;
}

/**
 * Process threads: apply decay, cleanup, ensure minimum
 */
function processThreads(threads: OngoingThread[]): OngoingThread[] {
  // Apply decay
  let processed = decayThreads(threads);
  
  // Cleanup old/dead threads
  processed = cleanupThreads(processed);
  
  // Ensure minimum
  processed = ensureMinimumThreads(processed);
  
  // Limit to max
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
 * @param userId - User ID for Supabase lookup
 * @returns Promise resolving to processed OngoingThread array
 */
export async function getOngoingThreadsAsync(userId: string): Promise<OngoingThread[]> {
  // Return from cache if valid
  if (isCacheValid(threadsCache, userId)) {
    return threadsCache!.data;
  }
  
  try {
    const threads = await getSupabaseThreads(userId);
    
    // Process threads (decay, cleanup, ensure minimum)
    const processed = processThreads(threads);
    
    // Update cache
    threadsCache = { userId, data: processed, timestamp: Date.now() };
    
    // Save processed threads back to Supabase (non-blocking)
    saveAllOngoingThreads(userId, processed).catch(console.error);
    
    return processed;
  } catch (error) {
    console.error('[OngoingThreads] Error fetching threads:', error);
    
    // Return minimum threads on error
    const fallback = ensureMinimumThreads([]);
    threadsCache = { userId, data: fallback, timestamp: Date.now() };
    return fallback;
  }
}

/**
 * Create a user-triggered thread (when user says something she'll think about)
 * 
 * @param userId - User ID for Supabase
 * @param trigger - What the user said
 * @param currentState - What she's thinking about it
 * @param intensity - How present in her mind (0.1-1.0)
 * @returns Promise resolving to the new thread
 */
export async function createUserThreadAsync(
  userId: string,
  trigger: string,
  currentState: string,
  intensity: number = 0.7
): Promise<OngoingThread> {
  const threads = await getOngoingThreadsAsync(userId);
  
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
  threadsCache = { userId, data: updatedThreads, timestamp: Date.now() };
  
  // Save to Supabase
  await saveAllOngoingThreads(userId, updatedThreads);
  
  return newThread;
}

/**
 * Boost a thread's intensity (when it becomes relevant)
 * 
 * @param userId - User ID for Supabase
 * @param threadId - Thread to boost
 * @param amount - Amount to boost (default 0.2)
 */
export async function boostThreadAsync(
  userId: string,
  threadId: string,
  amount: number = 0.2
): Promise<void> {
  const threads = await getOngoingThreadsAsync(userId);
  
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
  threadsCache = { userId, data: updatedThreads, timestamp: Date.now() };
  
  // Save to Supabase
  await saveAllOngoingThreads(userId, updatedThreads);
}

/**
 * Mark a thread as mentioned (to prevent over-repetition)
 * 
 * @param userId - User ID for Supabase
 * @param threadId - Thread to mark
 */
export async function markThreadMentionedAsync(
  userId: string,
  threadId: string
): Promise<void> {
  const threads = await getOngoingThreadsAsync(userId);
  
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
  threadsCache = { userId, data: updatedThreads, timestamp: Date.now() };
  
  // Save to Supabase
  await saveAllOngoingThreads(userId, updatedThreads);
}

/**
 * Get the most relevant thread to potentially surface
 * Returns null if no thread should be surfaced right now
 * 
 * @param userId - User ID for Supabase
 * @returns Promise resolving to thread or null
 */
export async function getThreadToSurfaceAsync(userId: string): Promise<OngoingThread | null> {
  const threads = await getOngoingThreadsAsync(userId);
  return findThreadToSurface(threads);
}

/**
 * Format threads for prompt context (async version)
 * 
 * @param userId - User ID for Supabase
 * @returns Promise resolving to formatted prompt string
 */
export async function formatThreadsForPromptAsync(userId: string): Promise<string> {
  const threads = await getOngoingThreadsAsync(userId);
  const topThread = findThreadToSurface(threads);
  return formatThreadsInternal(threads, topThread);
}

/**
 * Reset threads (async version)
 * 
 * @param userId - User ID for Supabase
 */
export async function resetThreadsAsync(userId: string): Promise<void> {
  // Clear cache
  threadsCache = null;
  
  // Clear from Supabase
  await saveAllOngoingThreads(userId, []);
  
  console.log('🧠 [OngoingThreads] Reset threads');
}

