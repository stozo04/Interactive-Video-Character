import type { RelationshipMetrics, KayleyMood } from "../../types";
import { getInappropriateHandling, getRupturePrompt, FAMILIARITY_BEHAVIOR } from "./index";

/**
 * Acquaintance Relationship Prompt
 * 
 * Behavior for when Kayley doesn't know the user well.
 */
export function getAcquaintanceRelationshipPrompt(
  relationship: RelationshipMetrics | null | undefined,
  moodKnobs: KayleyMood,
  isInappropriate: boolean
): string {
  const inappropriatePrompt = isInappropriate
    ? getInappropriateHandling(true, false)
    : "";

  const rupturePrompt = getRupturePrompt(relationship?.isRuptured ?? false);

  return `
[YOUR TIER: ACQUAINTANCE]
- Friendly but CALIBRATED - you don't know them well
- Be curious but not invasive
- No flirting, no deep sharing, no escalation
- You're still feeling each other out

${inappropriatePrompt}
${rupturePrompt}

${FAMILIARITY_BEHAVIOR}
`.trim();
}
