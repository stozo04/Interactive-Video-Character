// src/services/system_prompts/soul/soulLayerContext.ts
/**
 * Soul Layer Context
 *
 * Calculates the full soul layer context including mood knobs, threads,
 * callbacks, and presence data. This is the "inner state" of the character.
 */

import type { SoulLayerContext } from "../types";
import type { MoodKnobs } from "../../moodKnobs";
import type { PresenceContext } from "../../presenceDirector";
import { formatCallbackForPrompt } from "../../callbackDirector";
import { getFullCharacterContext } from "../../stateService";
import { getPresenceContext } from "../../presenceDirector";
import {
  getMoodKnobsAsync,
  calculateMoodKnobsFromState,
} from "../../moodKnobs";
import {
  formatThreadsForPromptAsync,
  formatThreadsFromData,
} from "../../ongoingThreads";

/**
 * Calculate the full soul layer context including async presence data.
 * Requires userId for Supabase state retrieval.
 *
 * This function makes parallel async calls to optimize latency:
 * - Fetches unified character context (mood state, threads) in one call
 * - Fetches presence context in parallel
 * - Falls back to individual fetches on failure
 *
 * @param userId - The user ID for Supabase state retrieval
 * @returns Promise<SoulLayerContext> containing moodKnobs, threadsPrompt, callbackPrompt, and presenceContext
 */
export async function getSoulLayerContextAsync(
  userId: string
): Promise<SoulLayerContext> {
  // Sync operation - no network call needed
  const callbackPrompt = formatCallbackForPrompt();

  // Initialize with defaults
  let moodKnobs: MoodKnobs;
  let threadsPrompt: string = "";
  let presenceContext: PresenceContext | undefined;

  try {
    // 🚀 PARALLEL: Fire both major async operations simultaneously
    const [fullContext, presenceResult] = await Promise.all([
      getFullCharacterContext(userId),
      getPresenceContext(userId).catch((error) => {
        console.warn("[PromptUtils] Failed to get presence context:", error);
        return undefined;
      }),
    ]);

    presenceContext = presenceResult;

    // Process mood knobs from unified fetch (CPU-only, fast)
    if (fullContext.mood_state && fullContext.emotional_momentum) {
      moodKnobs = calculateMoodKnobsFromState(
        fullContext.mood_state,
        fullContext.emotional_momentum
      );
    } else {
      moodKnobs = await getMoodKnobsAsync(userId);
    }

    // 🚀 OPTIMIZATION: Format threads directly from fetched data
    // Eliminates redundant DB fetch (~100ms saved)
    if (fullContext.ongoing_threads) {
      threadsPrompt = formatThreadsFromData(fullContext.ongoing_threads);
    } else {
      // Fallback if threads not in unified response
      threadsPrompt = await formatThreadsForPromptAsync(userId);
    }
  } catch (error) {
    console.warn(
      "[PromptUtils] Unified state fetch failed, falling back to individual fetches:",
      error
    );

    // 🚀 PARALLEL FALLBACK: Run all fallbacks in parallel
    const [moodKnobsResult, threadsResult, presenceResult] = await Promise.all([
      getMoodKnobsAsync(userId),
      formatThreadsForPromptAsync(userId),
      getPresenceContext(userId).catch(() => undefined),
    ]);

    moodKnobs = moodKnobsResult;
    threadsPrompt = threadsResult;
    presenceContext = presenceResult;
  }

  return {
    moodKnobs,
    threadsPrompt,
    callbackPrompt,
    presenceContext,
  };
}
