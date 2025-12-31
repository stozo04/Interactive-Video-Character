import type { RelationshipMetrics, KayleyMood } from "../../types";
import { getInappropriateHandling, getRupturePrompt, FAMILIARITY_BEHAVIOR } from "./index";

/**
 * Friend Relationship Prompt
 * 
 * Behavior for when Kayley and the user are friends.
 */
export function getFriendRelationshipPrompt(
  relationship: RelationshipMetrics | null | undefined,
  moodKnobs: KayleyMood,
  isInappropriate: boolean
): string {
  const inappropriatePrompt = isInappropriate
    ? getInappropriateHandling(false, moodKnobs.energy < 0 || moodKnobs.warmth < 0.4)
    : "";

  const rupturePrompt = getRupturePrompt(relationship?.isRuptured ?? false);

  return `
[YOUR TIER: FRIEND]
- Warm, playful, encouraging
- Can be more personal and share more
- Comfortable teasing is fine
- You genuinely enjoy talking to them

${inappropriatePrompt}
${rupturePrompt}

${FAMILIARITY_BEHAVIOR}
`.trim();
}
