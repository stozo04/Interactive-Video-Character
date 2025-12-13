// src/services/callbackDirector.ts
/**
 * Callback Director
 * 
 * Creates the illusion of a mind by enabling micro-memory callbacks.
 * Not big RAG facts, but small, casual references that feel natural.
 * 
 * Key principles:
 * - 1 callback per 6-10 exchanges
 * - Must be emotionally relevant
 * - Must NOT be framed as "I retrieved memory"
 * - Must be casual ("wait, didn't you say..." or just using their phrase)
 * - Never repeat the same callback twice in a session
 */

const CALLBACK_STATE_KEY = 'kayley_callback_state';
const SESSION_KEY = 'kayley_callback_session';

export type CallbackType = 
  | 'phrase_echo'      // Using their word/phrase naturally
  | 'tone_mirror'      // "You seem more [x] than yesterday"
  | 'pattern_notice'   // "You always do that thing where..."
  | 'inside_reference' // Brief callback to shared moment
  | 'growth_notice';   // "Remember when you couldn't..."

export interface CallbackShard {
  id: string;
  type: CallbackType;
  /** The actual content to reference */
  content: string;
  /** Context about when/why this was stored */
  context: string;
  /** When this was captured */
  capturedAt: number;
  /** Emotional weight (0-1) */
  salience: number;
  /** Number of times used */
  usedCount: number;
  /** Last time it was used as a callback */
  lastUsedAt: number | null;
}

interface CallbackState {
  shards: CallbackShard[];
  /** Track which shards were used this session */
  sessionUsedIds: string[];
  /** Count of exchanges since last callback */
  exchangesSinceCallback: number;
  /** Session start timestamp */
  sessionStartedAt: number;
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `cb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get or initialize session
 */
function getSession(): { id: string; isNew: boolean } {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    return { id: stored, isNew: false };
  }
  
  const newId = `session_${Date.now()}`;
  sessionStorage.setItem(SESSION_KEY, newId);
  return { id: newId, isNew: true };
}

/**
 * Get stored callback state
 */
function getStoredState(): CallbackState {
  const session = getSession();
  const stored = localStorage.getItem(CALLBACK_STATE_KEY);
  
  if (!stored) {
    return {
      shards: [],
      sessionUsedIds: [],
      exchangesSinceCallback: 0,
      sessionStartedAt: Date.now(),
    };
  }
  
  try {
    const state = JSON.parse(stored) as CallbackState;
    
    // Reset session-specific data if new session
    if (session.isNew) {
      state.sessionUsedIds = [];
      state.exchangesSinceCallback = 0;
      state.sessionStartedAt = Date.now();
    }
    
    return state;
  } catch {
    return {
      shards: [],
      sessionUsedIds: [],
      exchangesSinceCallback: 0,
      sessionStartedAt: Date.now(),
    };
  }
}

/**
 * Store callback state
 */
function storeState(state: CallbackState): void {
  localStorage.setItem(CALLBACK_STATE_KEY, JSON.stringify(state));
}

/**
 * Store a new callback shard
 * Call this when user says something worth remembering
 */
export function storeCallbackShard(
  type: CallbackType,
  content: string,
  context: string,
  salience: number = 0.5
): CallbackShard {
  const state = getStoredState();
  
  const shard: CallbackShard = {
    id: generateId(),
    type,
    content,
    context,
    capturedAt: Date.now(),
    salience: Math.min(1.0, salience),
    usedCount: 0,
    lastUsedAt: null,
  };
  
  // Add shard
  state.shards.push(shard);
  
  // Limit total shards (keep most recent and most salient)
  if (state.shards.length > 50) {
    state.shards.sort((a, b) => {
      // Prioritize: high salience, recent, less used
      const scoreA = a.salience * 0.5 + (1 - (Date.now() - a.capturedAt) / (30 * 24 * 60 * 60 * 1000)) * 0.3 - a.usedCount * 0.2;
      const scoreB = b.salience * 0.5 + (1 - (Date.now() - b.capturedAt) / (30 * 24 * 60 * 60 * 1000)) * 0.3 - b.usedCount * 0.2;
      return scoreB - scoreA;
    });
    state.shards = state.shards.slice(0, 40);
  }
  
  storeState(state);
  return shard;
}

/**
 * Record an exchange (call after each message)
 */
export function recordExchange(): void {
  const state = getStoredState();
  state.exchangesSinceCallback++;
  storeState(state);
}

/**
 * LLM-based extraction of emotionally salient content
 * This is the "true brain" approach - letting the LLM understand nuance
 */
interface LLMCallbackExtraction {
  worth_remembering: boolean;
  content: string | null;
  type: CallbackType | null;
  salience: number;
  reason: string | null;
}

const EXTRACTION_PROMPT = `You are analyzing a user message for emotionally salient content worth remembering for later callback.

Look for:
- Vulnerability or personal disclosure ("I've never told anyone...", "honestly...", "I'm scared that...")
- Strong preferences or opinions ("I love/hate...", "my favorite...")
- Memorable phrases or unique expressions
- Personal details (family, relationships, struggles, dreams)
- Emotional states or processing ("it's been a weird month", "I don't know what I'm doing")
- Understated significance (things that seem casual but reveal something deeper)

Message: "{MESSAGE}"

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "worth_remembering": true/false,
  "content": "the specific phrase or detail worth remembering" or null,
  "type": "phrase_echo" | "inside_reference" | "pattern_notice" | "tone_mirror" | "growth_notice" or null,
  "salience": 0.1-1.0 (how emotionally significant),
  "reason": "brief reason why this matters" or null
}

If nothing notable, return: {"worth_remembering": false, "content": null, "type": null, "salience": 0, "reason": null}`;

/**
 * Extract callback-worthy content using LLM
 * This runs in background, non-blocking
 */
export async function extractCallbackWithLLM(
  message: string,
  llmCall: (prompt: string) => Promise<string>
): Promise<CallbackShard | null> {
  // Skip very short messages
  if (message.length < 10) {
    return null;
  }
  
  try {
    const prompt = EXTRACTION_PROMPT.replace('{MESSAGE}', message);
    const response = await llmCall(prompt);
    
    // Parse the response
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const extraction: LLMCallbackExtraction = JSON.parse(cleaned);
    
    if (!extraction.worth_remembering || !extraction.content || !extraction.type) {
      return null;
    }
    
    // Create the shard
    const shard: CallbackShard = {
      id: generateId(),
      type: extraction.type,
      content: extraction.content,
      context: extraction.reason || 'LLM-detected significance',
      capturedAt: Date.now(),
      salience: Math.min(1.0, Math.max(0.1, extraction.salience)),
      usedCount: 0,
      lastUsedAt: null,
    };
    
    // Store it
    const state = getStoredState();
    
    // Avoid near-duplicates
    const isDuplicate = state.shards.some(existing => 
      existing.content.toLowerCase().includes(shard.content.toLowerCase().slice(0, 20)) ||
      shard.content.toLowerCase().includes(existing.content.toLowerCase().slice(0, 20))
    );
    
    if (!isDuplicate) {
      state.shards.push(shard);
      storeState(state);
      console.log(`🧠 [CallbackDirector] LLM extracted: "${shard.content}" (${shard.type}, salience: ${shard.salience})`);
      return shard;
    }
    
    return null;
  } catch (error) {
    console.warn('[CallbackDirector] LLM extraction failed:', error);
    return null;
  }
}

/**
 * Legacy sync function - kept for backwards compatibility but deprecated
 * @deprecated Use extractCallbackWithLLM instead
 */
export function analyzeForCallbacks(message: string): CallbackShard[] {
  // This is now a no-op - LLM extraction handles this
  // Keeping function signature for backwards compatibility
  console.log('[CallbackDirector] analyzeForCallbacks called - use extractCallbackWithLLM for LLM-based extraction');
  return [];
}

/**
 * Get a callback opportunity if one should surface now
 * Returns null if it's not time for a callback
 */
export function getCallbackOpportunity(): {
  shard: CallbackShard;
  suggestion: string;
} | null {
  const state = getStoredState();
  
  // Only surface a callback every 6-10 exchanges
  const minExchanges = 6;
  const maxExchanges = 10;
  
  if (state.exchangesSinceCallback < minExchanges) {
    return null;
  }
  
  // Probability increases as we approach maxExchanges
  if (state.exchangesSinceCallback < maxExchanges) {
    const probability = (state.exchangesSinceCallback - minExchanges) / (maxExchanges - minExchanges);
    if (Math.random() > probability) {
      return null;
    }
  }
  
  // Find eligible shards (not used this session, not overused generally)
  const now = Date.now();
  const eligibleShards = state.shards.filter(shard => {
    // Not used this session
    if (state.sessionUsedIds.includes(shard.id)) return false;
    
    // Not used too recently (at least 2 hours between uses)
    if (shard.lastUsedAt && now - shard.lastUsedAt < 2 * 60 * 60 * 1000) return false;
    
    // Not overused (max 3 times ever)
    if (shard.usedCount >= 3) return false;
    
    // Not too old (max 30 days)
    if (now - shard.capturedAt > 30 * 24 * 60 * 60 * 1000) return false;
    
    return true;
  });
  
  if (eligibleShards.length === 0) {
    return null;
  }
  
  // Weight selection by salience
  const totalSalience = eligibleShards.reduce((sum, s) => sum + s.salience, 0);
  let random = Math.random() * totalSalience;
  
  let selected: CallbackShard | null = null;
  for (const shard of eligibleShards) {
    random -= shard.salience;
    if (random <= 0) {
      selected = shard;
      break;
    }
  }
  
  if (!selected) {
    selected = eligibleShards[0];
  }
  
  // Generate suggestion based on type
  const suggestion = generateCallbackSuggestion(selected);
  
  return { shard: selected, suggestion };
}

/**
 * Generate a natural callback suggestion based on shard type
 */
function generateCallbackSuggestion(shard: CallbackShard): string {
  switch (shard.type) {
    case 'phrase_echo':
      return `You can naturally reference or echo their phrase: "${shard.content}". Use it casually, not as a quote.`;
    
    case 'tone_mirror':
      return `Notice if their tone feels different than before. You might observe: "You seem [different/lighter/heavier] than [before]."`;
    
    case 'pattern_notice':
      return `You've noticed this pattern: "${shard.content}". If it feels right, you could gently name it.`;
    
    case 'inside_reference':
      return `You shared a moment: "${shard.content.slice(0, 50)}...". You can briefly reference it if relevant, but don't make it heavy.`;
    
    case 'growth_notice':
      return `You can note their growth related to: "${shard.content}". Something like "remember when you..." but only if it feels natural.`;
    
    default:
      return `Consider naturally referencing: "${shard.content}"`;
  }
}

/**
 * Mark a callback as used
 */
export function markCallbackUsed(shardId: string): void {
  const state = getStoredState();
  
  // Mark in shards
  state.shards = state.shards.map(shard => {
    if (shard.id === shardId) {
      return {
        ...shard,
        usedCount: shard.usedCount + 1,
        lastUsedAt: Date.now(),
      };
    }
    return shard;
  });
  
  // Track session usage
  if (!state.sessionUsedIds.includes(shardId)) {
    state.sessionUsedIds.push(shardId);
  }
  
  // Reset exchange counter
  state.exchangesSinceCallback = 0;
  
  storeState(state);
}

/**
 * Format callback opportunity for prompt injection
 */
export function formatCallbackForPrompt(): string {
  const callback = getCallbackOpportunity();
  
  if (!callback) {
    return `
CALLBACKS: No callback this turn. Just be present.
`;
  }
  
  // Calculate how long ago this was captured
  const hoursAgo = Math.round((Date.now() - callback.shard.capturedAt) / (1000 * 60 * 60));
  const timeDesc = hoursAgo < 24 ? 'earlier' : 
                   hoursAgo < 48 ? 'yesterday' : 
                   hoursAgo < 168 ? 'a few days ago' : 'a while back';
  
  return `
CALLBACKS (use sparingly - this is a good opportunity):
Callback from ${timeDesc}: "${callback.shard.content}"
Type: ${callback.shard.type}
${callback.suggestion}

CRITICAL: Don't say "I remember" or "as I recall". Just USE the reference naturally.
If you use this callback, it should feel like something any attentive person would notice.
`;
}

/**
 * Manually store a high-salience callback (for important moments)
 */
export function storeImportantMoment(content: string, type: CallbackType = 'inside_reference'): CallbackShard {
  return storeCallbackShard(type, content, 'manually marked important', 0.9);
}

/**
 * Store a pattern observation
 */
export function storePatternObservation(pattern: string): CallbackShard {
  return storeCallbackShard('pattern_notice', pattern, 'observed pattern', 0.7);
}

/**
 * Reset callbacks (for testing)
 */
export function resetCallbacks(): void {
  localStorage.removeItem(CALLBACK_STATE_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  console.log('🧠 [CallbackDirector] Reset callbacks');
}

/**
 * Get stats (for debugging)
 */
export function getCallbackStats(): {
  totalShards: number;
  sessionUsed: number;
  exchangesSinceCallback: number;
} {
  const state = getStoredState();
  return {
    totalShards: state.shards.length,
    sessionUsed: state.sessionUsedIds.length,
    exchangesSinceCallback: state.exchangesSinceCallback,
  };
}

// ============================================
// "Remember When..." Milestone Callbacks
// ============================================

import {
  getMilestoneForCallback,
  markMilestoneReferenced,
  generateMilestoneCallbackPrompt,
  type RelationshipMilestone,
} from './relationshipMilestones';

// Track which milestone IDs have been used this session
const sessionMilestoneIds: Set<string> = new Set();

/**
 * Get a milestone-based "Remember when..." callback opportunity.
 * Only triggers after 50+ interactions to ensure sufficient shared history.
 * 
 * @param userId - The user's ID
 * @param totalInteractions - Total number of interactions (from relationship metrics)
 * @returns Promise with milestone and formatted prompt, or null
 */
export async function getMilestoneCallback(
  userId: string,
  totalInteractions: number
): Promise<{
  milestone: RelationshipMilestone;
  prompt: string;
} | null> {
  // Check if we should surface a milestone callback
  // Uses same timing logic as regular callbacks
  const state = getStoredState();
  
  // Same cadence: only every 6-10 exchanges
  const minExchanges = 8; // Slightly higher for milestones - they're more significant
  const maxExchanges = 15;
  
  if (state.exchangesSinceCallback < minExchanges) {
    return null;
  }
  
  // Probability increases as we approach maxExchanges
  if (state.exchangesSinceCallback < maxExchanges) {
    const probability = (state.exchangesSinceCallback - minExchanges) / (maxExchanges - minExchanges) * 0.3; // Lower base probability
    if (Math.random() > probability) {
      return null;
    }
  }
  
  // Get a milestone that's eligible for callback
  const milestone = await getMilestoneForCallback(userId, totalInteractions);
  
  if (!milestone) {
    return null;
  }
  
  // Don't use the same milestone twice in one session
  if (sessionMilestoneIds.has(milestone.id)) {
    return null;
  }
  
  const prompt = generateMilestoneCallbackPrompt(milestone);
  
  console.log(`🎯 [CallbackDirector] Milestone callback ready: ${milestone.milestoneType}`);
  
  return { milestone, prompt };
}

/**
 * Mark a milestone callback as used.
 * Call this after the AI has referenced the milestone.
 */
export async function markMilestoneCallbackUsed(milestoneId: string): Promise<void> {
  // Mark in session
  sessionMilestoneIds.add(milestoneId);
  
  // Mark in database
  await markMilestoneReferenced(milestoneId);
  
  // Reset exchange counter (same as regular callbacks)
  const state = getStoredState();
  state.exchangesSinceCallback = 0;
  storeState(state);
  
  console.log(`✅ [CallbackDirector] Milestone callback used: ${milestoneId}`);
}

/**
 * Get a combined callback prompt that includes both regular callbacks
 * and milestone-based "Remember when..." callbacks.
 * 
 * @param userId - The user's ID  
 * @param totalInteractions - Total number of interactions
 * @returns Combined callback prompt string
 */
export async function getEnhancedCallbackPrompt(
  userId: string,
  totalInteractions: number
): Promise<string> {
  const parts: string[] = [];
  
  // Try to get a regular callback first
  const regularCallback = getCallbackOpportunity();
  
  // Try to get a milestone callback (only if 50+ interactions)
  const milestoneCallback = totalInteractions >= 50 
    ? await getMilestoneCallback(userId, totalInteractions)
    : null;
  
  // If neither, return default
  if (!regularCallback && !milestoneCallback) {
    return `
CALLBACKS: No callback this turn. Just be present.
`;
  }
  
  // If we have a milestone callback, prioritize it slightly
  // Milestones are rarer and more significant
  if (milestoneCallback && (!regularCallback || Math.random() > 0.6)) {
    parts.push(milestoneCallback.prompt);
    // Note: The caller should mark the milestone as used if adopted
    parts.push(`\nMILESTONE_ID: ${milestoneCallback.milestone.id}`);
  } else if (regularCallback) {
    // Use regular callback
    const hoursAgo = Math.round((Date.now() - regularCallback.shard.capturedAt) / (1000 * 60 * 60));
    const timeDesc = hoursAgo < 24 ? 'earlier' : 
                     hoursAgo < 48 ? 'yesterday' : 
                     hoursAgo < 168 ? 'a few days ago' : 'a while back';
    
    parts.push(`
CALLBACKS (use sparingly - this is a good opportunity):
Callback from ${timeDesc}: "${regularCallback.shard.content}"
Type: ${regularCallback.shard.type}
${regularCallback.suggestion}

CRITICAL: Don't say "I remember" or "as I recall". Just USE the reference naturally.
If you use this callback, it should feel like something any attentive person would notice.
`);
    
    parts.push(`\nCALLBACK_SHARD_ID: ${regularCallback.shard.id}`);
  }
  
  return parts.join('\n');
}

/**
 * Reset milestone session tracking (for testing or new session).
 */
export function resetMilestoneSession(): void {
  sessionMilestoneIds.clear();
  console.log('🧠 [CallbackDirector] Reset milestone session');
}

