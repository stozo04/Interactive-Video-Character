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
 */

const THREADS_KEY = 'kayley_ongoing_threads';
const MAX_THREADS = 5;
const MIN_THREADS = 2;

export type ThreadTheme = 
  | 'creative_project'   // video editing, content ideas
  | 'family'             // mom, brother Ethan, relationships
  | 'self_improvement'   // therapy, habits, growth
  | 'social'             // Lena, creator friends
  | 'work'               // freelance clients, channel growth
  | 'existential'        // life meaning, future, choices
  | 'user_reflection';   // thinking about something user said

export interface OngoingThread {
  id: string;
  theme: ThreadTheme;
  /** What she's currently feeling/thinking about this */
  currentState: string;
  /** 0.1-1.0 - how present is this in her mind? */
  intensity: number;
  /** Prevent over-repetition */
  lastMentioned: number | null;
  /** Is this about something user said? */
  userRelated: boolean;
  /** When this thread was created */
  createdAt: number;
  /** Optional: what the user said that triggered this */
  userTrigger?: string;
}

interface ThreadsState {
  threads: OngoingThread[];
  lastUpdated: number;
}

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

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get stored threads state
 */
function getStoredThreads(): ThreadsState {
  const stored = localStorage.getItem(THREADS_KEY);
  if (!stored) {
    return { threads: [], lastUpdated: 0 };
  }
  
  try {
    return JSON.parse(stored);
  } catch {
    return { threads: [], lastUpdated: 0 };
  }
}

/**
 * Store threads state
 */
function storeThreads(state: ThreadsState): void {
  localStorage.setItem(THREADS_KEY, JSON.stringify(state));
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
 * Get current threads, processing decay and cleanup
 */
export function getOngoingThreads(): OngoingThread[] {
  const state = getStoredThreads();
  
  // Apply decay
  let threads = decayThreads(state.threads);
  
  // Cleanup old/dead threads
  threads = cleanupThreads(threads);
  
  // Ensure minimum
  threads = ensureMinimumThreads(threads);
  
  // Limit to max
  threads = threads.slice(0, MAX_THREADS);
  
  // Store updated state
  storeThreads({
    threads,
    lastUpdated: Date.now(),
  });
  
  return threads;
}

/**
 * Create a user-triggered thread (when user says something she'll think about)
 */
export function createUserThread(
  trigger: string,
  currentState: string,
  intensity: number = 0.7
): OngoingThread {
  const state = getStoredThreads();
  
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
  let threads = [...state.threads, newThread];
  if (threads.length > MAX_THREADS) {
    // Remove lowest intensity non-user thread first
    threads.sort((a, b) => {
      if (a.userRelated !== b.userRelated) return a.userRelated ? 1 : -1;
      return a.intensity - b.intensity;
    });
    threads = threads.slice(1);
  }
  
  storeThreads({
    threads,
    lastUpdated: Date.now(),
  });
  
  return newThread;
}

/**
 * Boost a thread's intensity (when it becomes relevant)
 */
export function boostThread(threadId: string, amount: number = 0.2): void {
  const state = getStoredThreads();
  
  const threads = state.threads.map(thread => {
    if (thread.id === threadId) {
      return {
        ...thread,
        intensity: Math.min(1.0, thread.intensity + amount),
      };
    }
    return thread;
  });
  
  storeThreads({
    threads,
    lastUpdated: Date.now(),
  });
}

/**
 * Mark a thread as mentioned (to prevent over-repetition)
 */
export function markThreadMentioned(threadId: string): void {
  const state = getStoredThreads();
  
  const threads = state.threads.map(thread => {
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
  
  storeThreads({
    threads,
    lastUpdated: Date.now(),
  });
}

/**
 * Get the most relevant thread to potentially surface
 * Returns null if no thread should be surfaced right now
 */
export function getThreadToSurface(): OngoingThread | null {
  const threads = getOngoingThreads();
  
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
 * Format threads for prompt context (doesn't reveal everything - just sets mental state)
 */
export function formatThreadsForPrompt(): string {
  const threads = getOngoingThreads();
  const topThread = getThreadToSurface();
  
  if (threads.length === 0) {
    return '';
  }
  
  let prompt = `
ONGOING MENTAL THREADS:
You have a few things on your mind right now. They affect your mood but you don't always share them.

`;

  // Show top 2-3 threads by intensity
  const sorted = [...threads].sort((a, b) => b.intensity - a.intensity).slice(0, 3);
  
  sorted.forEach((thread, i) => {
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

/**
 * Reset threads (for testing)
 */
export function resetThreads(): void {
  localStorage.removeItem(THREADS_KEY);
  console.log('🧠 [OngoingThreads] Reset threads');
}

