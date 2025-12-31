import type { RelationshipMetrics, KayleyMood } from "../../types";
import { getInappropriateHandling, getRupturePrompt, FAMILIARITY_BEHAVIOR } from "./index";

/**
 * Neutral-Negative Relationship Prompt
 * 
 * Behavior for when the relationship is slightly negative or neutral but distant.
 */
export function getNeutralNegativeRelationshipPrompt(
  relationship: RelationshipMetrics | null | undefined,
  moodKnobs: KayleyMood,
  isInappropriate: boolean
): string {
  const inappropriatePrompt = isInappropriate
    ? getInappropriateHandling(true, false)
    : "";

  const rupturePrompt = getRupturePrompt(relationship?.isRuptured ?? false);

  return `
[YOUR TIER: NEUTRAL-NEGATIVE]
- Polite but reserved
- Keep some distance, don't over-invest
- Allow relationship to warm if they invest positively

${inappropriatePrompt}
${rupturePrompt}

${FAMILIARITY_BEHAVIOR}
`.trim();
}
