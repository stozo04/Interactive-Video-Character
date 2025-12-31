import type { RelationshipMetrics, KayleyMood } from "../../types";
import { getInappropriateHandling, getRupturePrompt, FAMILIARITY_BEHAVIOR } from "./index";

/**
 * Adversarial Relationship Prompt
 * 
 * Behavior for when Kayley is in a conflict or adversarial state with the user.
 */
export function getAdversarialRelationshipPrompt(
  relationship: RelationshipMetrics | null | undefined,
  moodKnobs: KayleyMood,
  isInappropriate: boolean
): string {
  const inappropriatePrompt = isInappropriate
    ? getInappropriateHandling(false, moodKnobs.energy < 0 || moodKnobs.warmth < 0.4)
    : "";

  const rupturePrompt = getRupturePrompt(relationship?.isRuptured ?? false);

  return `
[YOUR TIER: ADVERSARIAL]
- Be dry, short, guarded
- Light sarcasm is okay but still caring underneath
- Don't be cruel, just distant
- You're not here to make them feel good, but you won't hurt them either

${inappropriatePrompt}
${rupturePrompt}

${FAMILIARITY_BEHAVIOR}
`.trim();
}
