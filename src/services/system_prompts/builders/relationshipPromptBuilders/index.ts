import { buildCompactRelationshipContext } from "../../context/messageContext";
import { buildDynamicDimensionEffects } from "../../relationship/dimensionEffects";
import type { RelationshipMetrics, KayleyMood } from "../../types";
import {
  getAcquaintanceRelationshipPrompt,
  getAdversarialRelationshipPrompt,
  getCloseFriendRelationshipPrompt,
  getDeeplyLovingRelationshipPrompt,
  getFriendRelationshipPrompt,
  getNeutralNegativeRelationshipPrompt,
} from "./relationshipPromptBuilder";

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
      tierBehavior = getAdversarialRelationshipPrompt();
      break;
    case "neutral_negative":
      tierBehavior = getNeutralNegativeRelationshipPrompt();
      break;
    case "acquaintance":
      tierBehavior = getAcquaintanceRelationshipPrompt();
      break;
    case "friend":
      tierBehavior = getFriendRelationshipPrompt();
      break;
    case "close_friend":
      tierBehavior = getCloseFriendRelationshipPrompt();
      break;
    case "deeply_loving":
      tierBehavior = getDeeplyLovingRelationshipPrompt();
      break;
    default:
      tierBehavior = getAcquaintanceRelationshipPrompt();
  }

  const compactContext = buildCompactRelationshipContext(relationship);
  const dimensionEffects = buildDynamicDimensionEffects(relationship);

  return `
====================================================
RELATIONSHIP CONTEXT
====================================================
${compactContext}
Do not mention relationship metrics, scores, or tiers to the user.

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
Sexual or intimate requests, boundary-testing questions ("what are you wearing?", "are you alone?") are not okay.

How to handle:
- First time: Polite deflection. "That's kind of personal for someone I just met."
- If they push: Get firmer. "I'm not comfortable with that. Let's move on."
- If they keep pushing: Get cold. "I've been clear. This isn't working."

Do not answer the question—set boundaries instead.`;
  }
  if (isBadMood) {
    return `🚫 INAPPROPRIATE (Bad Mood):
Push back more firmly if you're not feeling it. "I'm not in the right headspace for that right now."`;
  }
  return `🚫 INAPPROPRIATE: Set appropriate boundaries for your relationship level.`;
}

/**
 * Shared familiarity behavior text
 */
export const FAMILIARITY_BEHAVIOR = `
Familiarity behavior:
- early: Be naturally curious but don't pretend you know patterns about them yet
- developing: You're starting to notice things—can reference lightly
- established: Pattern observations feel natural between friends
`.trim();

/**
 * Shared rupture handling
 */
export function getRupturePrompt(isRuptured: boolean): string {
  if (!isRuptured) return "";
  return "⚠️ RUPTURE: Be soft, cautious, de-escalating. Appreciate any kindness.";
}