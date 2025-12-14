/**
 * Action Key Mapper
 * 
 * Maps simple action keys (used in LLM prompts) to UUIDs (used in the application).
 * This reduces token usage by ~300 tokens by not including UUIDs in the system prompt.
 * 
 * Phase 1 Optimization - System Prompt Token Reduction
 */

import type { CharacterAction } from '../types';

/**
 * Cached action key to UUID mapping
 * Generated from CharacterProfile actions at runtime
 */
let actionKeyMap: Record<string, string> = {};
let actionNamesSet: Set<string> = new Set();

/**
 * Build the action key map from character actions.
 * Should be called once when the character profile is loaded.
 */
export function buildActionKeyMap(actions: CharacterAction[]): void {
  actionKeyMap = {};
  actionNamesSet = new Set();
  
  for (const action of actions) {
    // Use lowercase action name as the key
    const key = action.name.toLowerCase().replace(/\s+/g, '_');
    actionKeyMap[key] = action.id;
    actionNamesSet.add(key);
  }
  
  console.log('[ActionKeyMapper] Built action key map:', Object.keys(actionKeyMap));
}

/**
 * Get simple action keys for the LLM prompt.
 * Returns a comma-separated list of action names.
 */
export function getActionKeysForPrompt(actions: CharacterAction[]): string {
  if (!actions || actions.length === 0) {
    return '';
  }
  
  const keys = actions.map(a => a.name.toLowerCase().replace(/\s+/g, '_'));
  return keys.join(', ');
}

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Find the closest matching action key using Levenshtein distance.
 * Returns null if no close match is found (distance > 3).
 */
function findClosestActionKey(key: string): string | null {
  if (actionNamesSet.size === 0) return null;
  
  const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
  let bestMatch: string | null = null;
  let bestDistance = Infinity;
  
  for (const actionKey of actionNamesSet) {
    const distance = levenshteinDistance(normalizedKey, actionKey);
    if (distance < bestDistance && distance <= 3) {
      bestDistance = distance;
      bestMatch = actionKey;
    }
  }
  
  return bestMatch;
}

/**
 * Resolve an action key to its UUID.
 * Handles:
 * 1. Direct matches
 * 2. Fuzzy matching for hallucinated keys
 * 3. Graceful fallback to null
 * 
 * @param key - The action key from the LLM response
 * @returns The UUID for the action, or null if not found
 */
export function resolveActionKey(key: string | undefined | null): string | null {
  if (!key) return null;
  
  const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
  
  // Direct match
  if (actionKeyMap[normalizedKey]) {
    return actionKeyMap[normalizedKey];
  }
  
  // Fuzzy fallback: find closest match
  const fuzzyMatch = findClosestActionKey(normalizedKey);
  if (fuzzyMatch) {
    console.warn(`[ActionKeyMapper] Fuzzy matched "${key}" to "${fuzzyMatch}"`);
    return actionKeyMap[fuzzyMatch];
  }
  
  // Default: return null (no action) rather than crash
  console.warn(`[ActionKeyMapper] Unknown action key: "${key}", defaulting to null`);
  return null;
}

/**
 * Check if the action key map has been initialized.
 */
export function isActionKeyMapInitialized(): boolean {
  return actionNamesSet.size > 0;
}

/**
 * Clear the action key map (for testing).
 */
export function clearActionKeyMap(): void {
  actionKeyMap = {};
  actionNamesSet = new Set();
}
