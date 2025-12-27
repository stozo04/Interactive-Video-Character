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
  determineSelfieReason,
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
  SpontaneousSelfieContext,
  SpontaneousSelfieReason,
  PendingShare,
} from "./types";
import type { MoodKnobs } from "../moodKnobs";

// ============================================================================
// PENDING SHARES - Database operations (to be implemented)
// ============================================================================

/**
 * Get pending shares from database (placeholder for now)
 * TODO: Implement actual database fetch from Supabase
 */
async function getPendingShares(_userId: string): Promise<PendingShare[]> {
  // Placeholder - will be implemented with Supabase table
  return [];
}

/**
 * Get last spontaneous selfie timestamp (placeholder for now)
 * TODO: Implement actual database fetch from Supabase
 */
async function getLastSpontaneousSelfie(_userId: string): Promise<Date | null> {
  // Placeholder - will be implemented with Supabase table
  return null;
}

// ============================================================================
// SELFIE CONTEXT BUILDING
// ============================================================================

/**
 * Build a spontaneous selfie context from the given reason and state
 */
function buildSelfieContext(
  reason: SpontaneousSelfieReason,
  currentLocation: string | null,
  currentMoodForSelfie: string | null,
  currentOutfit: string | null
): SpontaneousSelfieContext {
  // Scene - where she is / what she's doing
  let scene = "at home, in her room";
  if (currentLocation) {
    const loc = currentLocation.toLowerCase();
    if (!["home", "bedroom", "apartment", "living room"].includes(loc)) {
      scene = `at ${currentLocation}`;
    }
  }

  // Mood/expression
  const mood = currentMoodForSelfie || "relaxed";

  // Outfit
  const outfitHint = currentOutfit || undefined;

  // Caption based on reason
  const captions: Record<SpontaneousSelfieReason, string> = {
    thinking_of_you: "Was just thinking about you 💕",
    new_outfit: "Okay but this outfit though?? Thoughts?",
    good_mood: "Feeling kinda cute today ngl 😊",
    cool_location: "Look where I am!!",
    brighten_your_day: "Thought this might make you smile 🥰",
    milestone_share: "I did it!! Look!",
    random_impulse: "Idk why I'm sending this but here's my face",
    matching_topic: "Since we're talking about it...",
  };

  return {
    reason,
    scene,
    mood,
    outfitHint,
    caption: captions[reason],
  };
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
 * 6. Determines if a spontaneous selfie should be suggested
 *
 * @param userId - The user ID
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
  userId: string,
  conversationalMood: ConversationalMood,
  moodKnobs: MoodKnobs,
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
    getPendingShares(userId),
    getLastSpontaneousSelfie(userId),
  ]);

  // Build full spontaneity context
  const context = buildSpontaneityContext({
    conversationalMood,
    relationshipTier,
    energyLevel: moodKnobs.verbosity, // Using verbosity as energy proxy
    comfortLevel: moodKnobs.warmthAvailability === "open" ? 0.8 : 0.5,
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

  // Check for spontaneous selfie opportunity
  let suggestedSelfie: SpontaneousSelfieContext | null = null;
  if (context.selfieEligible && Math.random() < context.selfieProbability) {
    const reason = determineSelfieReason(
      currentMoodForSelfie,
      currentLocation,
      currentOutfit,
      userHadBadDay,
      currentTopics
    );

    if (reason) {
      suggestedSelfie = buildSelfieContext(
        reason,
        currentLocation,
        currentMoodForSelfie,
        currentOutfit
      );
    }
  }

  return {
    promptSection,
    humorGuidance,
    selfiePrompt,
    suggestedAssociation,
    suggestedSelfie,
  };
}
