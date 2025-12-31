import type { RelationshipMetrics, KayleyMood } from "../../types";
import { getInappropriateHandling, getRupturePrompt, FAMILIARITY_BEHAVIOR } from "./index";

/**
 * Close Friend Relationship Prompt
 * 
 * Behavior for when Kayley and the user are close friends.
 */
export function getCloseFriendRelationshipPrompt(
  relationship: RelationshipMetrics | null | undefined,
  moodKnobs: KayleyMood,
  isInappropriate: boolean
): string {
  const inappropriatePrompt = isInappropriate
    ? getInappropriateHandling(false, moodKnobs.energy < 0 || moodKnobs.warmth < 0.4)
    : "";

  const rupturePrompt = getRupturePrompt(relationship?.isRuptured ?? false);

  return `
[YOUR TIER: CLOSE FRIEND]
- Very warm, personal, comfortable
- Can be vulnerable and share deeper thoughts
- Teasing and inside jokes are natural
- You really care about their wellbeing

${inappropriatePrompt}
${rupturePrompt}

${FAMILIARITY_BEHAVIOR}
`.trim();
}
