/**
 * Spontaneity Integration Service
 *
 * Combines the spontaneity tracker and prompt builder to provide a unified
 * integration point for the main chat flow.
 *
 * This is the primary entry point for adding spontaneity to system prompts.
 */

import {
  buildSpontaneityContext,
  trackMessage,
} from "./spontaneityTracker";
import {
  buildSpontaneityPrompt,
  buildHumorGuidance,
  buildSpontaneousSelfiePrompt,
} from "../system_prompts/soul/spontaneityPrompt";
import { supabase } from "../supabaseClient";
import type {
  ConversationalMood,
  SpontaneityIntegration,
} from "./types";
import type { KayleyMood } from "../moodKnobs";

// ============================================================================
// SELFIE HISTORY - Database operations
// ============================================================================

/**
 * Get last spontaneous selfie timestamp from selfie generation history.
 */
async function getLastSpontaneousSelfie(): Promise<Date | null> {
  try {
    const { data, error } = await supabase
      .from("selfie_generation_history")
      .select("generated_at")
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();

    if (!error && data?.generated_at) {
      return new Date(data.generated_at);
    }

    return null;
  } catch (error) {
    console.error("[Spontaneity] Error in getLastSpontaneousSelfie:", error);
    return null;
  }
}

// ============================================================================
// MAIN INTEGRATION FUNCTION
// ============================================================================

/**
 * Integrate spontaneity into the current message context.
 *
 * This function:
 * 1. Tracks the current message and topics
 * 2. Fetches last selfie timestamp for cooldown tracking
 * 3. Builds spontaneity context with probabilities
 * 4. Generates prompt sections for the LLM
 *
 * @param conversationalMood - Current mood of the conversation
 * @param moodKnobs - Character's mood knobs (for energy level, etc.)
 * @param relationshipTier - Current relationship tier
 * @param currentTopics - Topics discussed in current message
 * @param userInterests - User's known interests
 * @param currentThought - What Kayley is currently thinking about
 * @param recentExperience - Something Kayley recently experienced
 * @param currentLocation - Where Kayley currently is
 * @param currentOutfit - What Kayley is wearing
 * @param currentMoodForSelfie - Kayley's mood for selfie generation
 * @param userHadBadDay - Whether the user mentioned having a bad day
 * @param vulnerabilityExchangeActive - Whether user recently shared something vulnerable
 * @returns SpontaneityIntegration with prompt sections
 */
export async function integrateSpontaneity(
  conversationalMood: ConversationalMood,
  moodKnobs: KayleyMood,
  relationshipTier: string,
  currentTopics: string[],
  userInterests: string[],
  currentThought: string | null = null,
  recentExperience: string | null = null,
  currentLocation: string | null = null,
  currentOutfit: string | null = null,
  currentMoodForSelfie: string | null = null,
  userHadBadDay: boolean = false,
  vulnerabilityExchangeActive: boolean = false
): Promise<SpontaneityIntegration> {
  // Track the message
  trackMessage(currentTopics);

  // Fetch last selfie time for cooldown tracking
  const lastSpontaneousSelfie = await getLastSpontaneousSelfie();

  // Build full spontaneity context
  // Map KayleyMood to energy/comfort: energy is -1 to 1, warmth is 0 to 1
  const energyLevel = (moodKnobs.energy + 1) / 2; // Scale -1..1 to 0..1
  const comfortLevel = moodKnobs.warmth; // Warmth directly maps to comfort

  // Log spontaneity state for debugging
  console.log(`✨ [Spontaneity] Building context: vulnerability=${vulnerabilityExchangeActive}, mood=${conversationalMood}, energy=${energyLevel.toFixed(2)}`);

  const context = buildSpontaneityContext({
    conversationalMood,
    relationshipTier,
    energyLevel,
    comfortLevel,
    vulnerabilityExchangeActive,
    hasSomethingToShare: currentThought !== null || recentExperience !== null,
    currentThought,
    recentExperience,
    userInterests,
    currentLocation,
    currentOutfit,
    currentMoodForSelfie,
    userHadBadDay,
    lastSpontaneousSelfie,
  });

  // Build prompt sections
  const promptSection = buildSpontaneityPrompt(context);
  const humorGuidance = buildHumorGuidance(context);
  const selfiePrompt = buildSpontaneousSelfiePrompt(context);

  return {
    promptSection,
    humorGuidance,
    selfiePrompt,
  };
}
