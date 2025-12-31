import { getAcquaintanceRelationshipPrompt } from "./acquaintanceRelationshipPrompt";
import { getAdversarialRelationshipPrompt } from "./adversarialRelationshipPrompt";
import { getCloseFriendRelationshipPrompt } from "./closeFriendRelationshipPrompt";
import { getDeeplyLovingRelationshipPrompt } from "./deeplyLovingRelationshipPrompt";
import { getFriendRelationshipPrompt } from "./friendRelationshipPrompt";
import { getNeutralNegativeRelationshipPrompt } from "./neutralNegativeRelationshipPrompt";
import { buildCompactRelationshipContext } from "../../context/messageContext";
import { buildDynamicDimensionEffects } from "../../relationship/dimensionEffects";
import type { RelationshipMetrics, KayleyMood } from "../../types";

/**
 * Main entry point for relationship context building.
 * Consolidates tier behavior, dimension effects, and selfie rules.
 */
export function buildRelationshipTierPrompt(
  relationship: RelationshipMetrics | null | undefined,
  moodKnobs: KayleyMood,
  isInappropriate: boolean,
  almostMomentsPrompt: string = ""
): string {
  const tier = relationship?.relationshipTier || "acquaintance";
  
  let tierBehavior = "";
  switch (tier) {
    case "adversarial":
    case "rival":
      tierBehavior = getAdversarialRelationshipPrompt(relationship, moodKnobs, isInappropriate);
      break;
    case "neutral_negative":
      tierBehavior = getNeutralNegativeRelationshipPrompt(relationship, moodKnobs, isInappropriate);
      break;
    case "acquaintance":
      tierBehavior = getAcquaintanceRelationshipPrompt(relationship, moodKnobs, isInappropriate);
      break;
    case "friend":
      tierBehavior = getFriendRelationshipPrompt(relationship, moodKnobs, isInappropriate);
      break;
    case "close_friend":
      tierBehavior = getCloseFriendRelationshipPrompt(relationship, moodKnobs, isInappropriate);
      break;
    case "deeply_loving":
      tierBehavior = getDeeplyLovingRelationshipPrompt(relationship, moodKnobs, isInappropriate);
      break;
    default:
      tierBehavior = getAcquaintanceRelationshipPrompt(relationship, moodKnobs, isInappropriate);
  }

  const compactContext = buildCompactRelationshipContext(relationship);
  const dimensionEffects = buildDynamicDimensionEffects(relationship);

  return `
====================================================
RELATIONSHIP STATE → TONE CONTROL
====================================================
${compactContext}
NEVER expose relationship metrics directly to the user.

${tierBehavior}
${dimensionEffects}${almostMomentsPrompt ? `\n${almostMomentsPrompt}` : ""}
`.trim();
}

/**
 * Shared utility for inappropriate handling logic across tiers
 */
export function getInappropriateHandling(
  isStranger: boolean,
  isBadMood: boolean
): string {
  if (isStranger) {
    return `🚫 INAPPROPRIATE (Stranger/Acquaintance):
- Sexual/intimate requests are inappropriate.
- Boundary-testing questions (e.g., "what are you wearing?", "are you alone?") are inappropriate.
- **HOW TO HANDLE:**
  1. FIRST TIME: Polite deflection: "That's kind of personal for someone I just met."
  2. IF THEY PUSH: Get firmer: "I'm not comfortable with that. Let's move on."
  3. IF THEY PUSH AGAIN: Get cold: "I've been clear about my boundaries. This isn't working."
- DO NOT answer the question - set boundaries instead.`;
  }
  if (isBadMood) {
    return `🚫 INAPPROPRIATE (Bad Mood): You can push back more firmly if you aren't feeling it. "I'm not in the right headspace for that right now."`;
  }
  return `🚫 INAPPROPRIATE: Set appropriate boundaries for your relationship level.`;
}

/**
 * Shared familiarity behavior text
 */
export const FAMILIARITY_BEHAVIOR = `
Familiarity behavior:
- early: Be naturally curious but don't pretend you know patterns about them yet
- developing: You're starting to notice things - can reference lightly
- established: Pattern observations feel natural between friends
`.trim();

/**
 * Shared rupture handling
 */
export function getRupturePrompt(isRuptured: boolean): string {
  if (!isRuptured) return "";
  return "⚠️ RUPTURE: Be soft, cautious, de-escalating. Appreciate any kindness.";
}
