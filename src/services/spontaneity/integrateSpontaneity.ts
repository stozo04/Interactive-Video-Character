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
import { supabase } from "../supabaseClient";
import type {
  ConversationalMood,
  SpontaneityIntegration,
  PendingShare,
  PendingShareType,
} from "./types";
import type { KayleyMood } from "../moodKnobs";

// ============================================================================
// PENDING SHARES - Database operations
// ============================================================================

const USER_ID = import.meta.env.VITE_USER_ID;

/**
 * Get pending shares from database.
 * Returns active shares that haven't been shared, dismissed, or expired.
 */
async function getPendingShares(): Promise<PendingShare[]> {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("kayley_pending_shares")
      .select("*")
      .eq("user_id", USER_ID)
      .is("shared_at", null)
      .is("dismissed_at", null)
      .gt("expires_at", now)
      .order("urgency", { ascending: false })
      .limit(5);

    if (error) {
      console.error("[Spontaneity] Error fetching pending shares:", error);
      return [];
    }

    // Map database rows to PendingShare type
    return (data || []).map((row) => ({
      id: row.id,
      content: row.content,
      type: row.share_type as PendingShareType,
      urgency: row.urgency,
      relevanceTopics: row.relevance_topics || [],
      naturalOpener: row.natural_opener || "",
      canInterrupt: row.can_interrupt || false,
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
      // Selfie-specific context (only for type === 'selfie')
      ...(row.share_type === "selfie" && row.selfie_reason
        ? {
            selfieContext: {
              reason: row.selfie_reason,
              scene: row.selfie_scene || "",
              mood: row.selfie_mood || "",
              outfit: row.selfie_outfit_hint,
              caption: row.content,
            },
          }
        : {}),
    }));
  } catch (error) {
    console.error("[Spontaneity] Error in getPendingShares:", error);
    return [];
  }
}

/**
 * Get last spontaneous selfie timestamp from history or conversation state.
 */
async function getLastSpontaneousSelfie(): Promise<Date | null> {
  try {
    // First check conversation_spontaneity_state (faster, single row)
    const { data: stateData, error: stateError } = await supabase
      .from("conversation_spontaneity_state")
      .select("last_spontaneous_selfie")
      .eq("user_id", USER_ID)
      .single();

    if (!stateError && stateData?.last_spontaneous_selfie) {
      return new Date(stateData.last_spontaneous_selfie);
    }

    // Fallback: Check selfie history for most recent
    const { data: historyData, error: historyError } = await supabase
      .from("spontaneous_selfie_history")
      .select("sent_at")
      .eq("user_id", USER_ID)
      .order("sent_at", { ascending: false })
      .limit(1)
      .single();

    if (!historyError && historyData?.sent_at) {
      return new Date(historyData.sent_at);
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
