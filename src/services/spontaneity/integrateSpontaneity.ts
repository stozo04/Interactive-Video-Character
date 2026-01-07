/**
 * Spontaneity Integration Service
 *
 * Combines the spontaneity tracker, prompt builder, and association engine
 * to provide a unified integration point for the main chat flow.
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
import {
  findRelevantAssociations,
  generateAssociationOpener,
} from "./associationEngine";
import type {
  ConversationalMood,
  SpontaneityIntegration,
  PendingShare,
} from "./types";
import type { KayleyMood } from "../moodKnobs";

// ============================================================================
// PENDING SHARES - Database operations (to be implemented)
// ============================================================================

/**
 * Get pending shares from database (placeholder for now)
 * TODO: GATES!!! Implement actual database fetch from Supabase
 */
async function getPendingShares(): Promise<PendingShare[]> {
  // Placeholder - will be implemented with Supabase table
  return [];
}

/**
 * Get last spontaneous selfie timestamp (placeholder for now)
 * TODO:GATES  Implement actual database fetch from Supabase
 */
async function getLastSpontaneousSelfie(): Promise<Date | null> {
  // Placeholder - will be implemented with Supabase table
  return null;
}

// ============================================================================
// MAIN INTEGRATION FUNCTION
// ============================================================================

/**
 * Integrate spontaneity into the current message context.
 *
 * This function:
 * 1. Tracks the current message and topics
 * 2. Fetches pending shares and last selfie timestamp
 * 3. Builds spontaneity context with probabilities
 * 4. Generates prompt sections for the LLM
 * 5. Finds relevant associations to suggest
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
 * @returns SpontaneityIntegration with prompt sections and suggestions
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
  userHadBadDay: boolean = false
): Promise<SpontaneityIntegration> {
  // Track the message
  trackMessage(currentTopics);

  // Fetch pending shares and last selfie time in parallel
  const [pendingShares, lastSpontaneousSelfie] = await Promise.all([
    getPendingShares(),
    getLastSpontaneousSelfie(),
  ]);

  // Build full spontaneity context
  // Map KayleyMood to energy/comfort: energy is -1 to 1, warmth is 0 to 1
  const energyLevel = (moodKnobs.energy + 1) / 2; // Scale -1..1 to 0..1
  const comfortLevel = moodKnobs.warmth; // Warmth directly maps to comfort

  const context = buildSpontaneityContext({
    conversationalMood,
    relationshipTier,
    energyLevel,
    comfortLevel,
    vulnerabilityExchangeActive: false, // TODO: Wire from relationship service
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
  const promptSection = buildSpontaneityPrompt(context, pendingShares);
  const humorGuidance = buildHumorGuidance(context);
  const selfiePrompt = buildSpontaneousSelfiePrompt(context);

  // Find relevant associations
  let suggestedAssociation = null;
  if (pendingShares.length > 0 && Math.random() < context.spontaneityProbability) {
    const associations = findRelevantAssociations(pendingShares, currentTopics);

    if (associations.length > 0) {
      const topMatch = associations[0];
      suggestedAssociation = {
        opener: generateAssociationOpener(topMatch),
        content: topMatch.share.content,
        shareId: topMatch.share.id,
      };
    }
  }

  return {
    promptSection,
    humorGuidance,
    selfiePrompt,
    suggestedAssociation,
  };
}
