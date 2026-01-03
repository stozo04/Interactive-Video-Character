// src/services/system_prompts/soul/soulLayerContext.ts
/**
 * Soul Layer Context
 *
 * Calculates the full soul layer context including mood knobs, threads,
 * callbacks, and presence data. This is the "inner state" of the character.
 */

import type { SoulLayerContext } from "../types";
import type { KayleyMood } from "../../moodKnobs";
import type { PresenceContext } from "../../presenceDirector";
import type { ConversationalMood } from "../../spontaneity/types";
import { formatCallbackForPrompt } from "../../callbackDirector";
import { getFullCharacterContext } from "../../stateService";
import { getPresenceContext } from "../../presenceDirector";
import {
  getMoodAsync,
  calculateMoodFromState,
} from "../../moodKnobs";
import {
  formatThreadsForPromptAsync,
  formatThreadsFromData,
} from "../../ongoingThreads";
import { integrateSpontaneity } from "../../spontaneity/integrateSpontaneity";

/**
 * Options for spontaneity integration (optional)
 */
export interface SpontaneityOptions {
  conversationalMood: ConversationalMood;
  relationshipTier: string;
  currentTopics: string[];
  userInterests: string[];
  currentThought?: string | null;
  recentExperience?: string | null;
  currentLocation?: string | null;
  currentOutfit?: string | null;
  currentMoodForSelfie?: string | null;
  userHadBadDay?: boolean;
}

/**
 * Calculate the full soul layer context including async presence data.
 *
 * This function makes parallel async calls to optimize latency:
 * - Fetches unified character context (mood state, threads) in one call
 * - Fetches presence context in parallel
 * - Optionally integrates spontaneity (if options provided)
 * - Falls back to individual fetches on failure
 *
 * @param spontaneityOptions - Optional options for spontaneity integration
 * @returns Promise<SoulLayerContext> containing moodKnobs, threadsPrompt, callbackPrompt, presenceContext, and optionally spontaneityIntegration
 */
export async function getSoulLayerContextAsync(
  spontaneityOptions?: SpontaneityOptions
): Promise<SoulLayerContext> {
  // Sync operation - no network call needed
  const callbackPrompt = formatCallbackForPrompt();

  // Initialize with defaults
  let moodKnobs: KayleyMood;
  let threadsPrompt: string = "";
  let presenceContext: PresenceContext | undefined;

  try {
    // 🚀 PARALLEL: Fire both major async operations simultaneously
    const [fullContext, presenceResult] = await Promise.all([
      getFullCharacterContext(),
      getPresenceContext().catch((error) => {
        console.warn("[PromptUtils] Failed to get presence context:", error);
        return undefined;
      }),
    ]);

    presenceContext = presenceResult;

    // Process mood using SIMPLIFIED system (energy + warmth instead of 6 knobs)
    if (fullContext.mood_state && fullContext.emotional_momentum) {
      moodKnobs = calculateMoodFromState(
        fullContext.mood_state,
        fullContext.emotional_momentum
      );
    } else {
      moodKnobs = await getMoodAsync();
    }

    // 🚀 OPTIMIZATION: Format threads directly from fetched data
    // Eliminates redundant DB fetch (~100ms saved)
    if (fullContext.ongoing_threads) {
      threadsPrompt = formatThreadsFromData(fullContext.ongoing_threads);
    } else {
      // Fallback if threads not in unified response
      threadsPrompt = await formatThreadsForPromptAsync();
    }
  } catch (error) {
    console.warn(
      "[PromptUtils] Unified state fetch failed, falling back to individual fetches:",
      error
    );

    // 🚀 PARALLEL FALLBACK: Run all fallbacks in parallel
    const [moodKnobsResult, threadsResult, presenceResult] = await Promise.all([
      getMoodAsync(),
      formatThreadsForPromptAsync(),
      getPresenceContext().catch(() => undefined),
    ]);

    moodKnobs = moodKnobsResult;
    threadsPrompt = threadsResult;
    presenceContext = presenceResult;
  }

  // Optionally integrate spontaneity (if options provided)
  let spontaneityIntegration;
  if (spontaneityOptions) {
    try {
      spontaneityIntegration = await integrateSpontaneity(
        spontaneityOptions.conversationalMood,
        moodKnobs,
        spontaneityOptions.relationshipTier,
        spontaneityOptions.currentTopics,
        spontaneityOptions.userInterests,
        spontaneityOptions.currentThought,
        spontaneityOptions.recentExperience,
        spontaneityOptions.currentLocation,
        spontaneityOptions.currentOutfit,
        spontaneityOptions.currentMoodForSelfie,
        spontaneityOptions.userHadBadDay
      );
    } catch (error) {
      console.warn("[SoulLayerContext] Failed to integrate spontaneity:", error);
      // Continue without spontaneity - it's optional
    }
  }

  return {
    moodKnobs,
    threadsPrompt,
    callbackPrompt,
    presenceContext,
    spontaneityIntegration,
  };
}
