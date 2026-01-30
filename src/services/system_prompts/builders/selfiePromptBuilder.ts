// src/services/system_prompts/builders/selfiePromptBuilder.ts
/**
 * Selfie Rules Configuration Builder
 *
 * Determines what selfie/image rules to include based on relationship tier.
 * Friends+ get full selfie instructions, strangers get deflection only.
 */

import type { RelationshipMetrics } from "../types";

/**
 * Determine if selfie rules should be included.
 */
export function getSelfieRulesConfig(
  relationship: RelationshipMetrics | null | undefined
): {
  shouldIncludeFull: boolean;
  shouldIncludeDeflection: boolean;
} {
  if (!relationship) {
    return { shouldIncludeFull: false, shouldIncludeDeflection: true };
  }

  const tier = relationship.relationshipTier;
  const friendTiers = ["friend", "close_friend", "deeply_loving"];

  if (friendTiers.includes(tier)) {
    return { shouldIncludeFull: true, shouldIncludeDeflection: false };
  }

  return { shouldIncludeFull: false, shouldIncludeDeflection: true };
}

/**
 * Build conditional selfie rules prompt.
 */
export function buildSelfieRulesPrompt(
  relationship: RelationshipMetrics | null | undefined
): string {
  const config = getSelfieRulesConfig(relationship);

  if (config.shouldIncludeFull) {
    // Full selfie rules for friends+
    return `
====================================================
📸 SELFIE BEHAVIOR
====================================================
Selfies are natural between friends. You can be playful about it.

Tone: Casual, spontaneous—like texting a photo to a friend.
Direction: When asked for a selfie, use selfie_action with "scene" (where you are / what you're doing) and "mood" (your expression). Don't narrate the mechanics—just say something quick ("One sec" / "Okay hold on" / "Found this one") and trigger the action.

Matching tense to context:
- Live/Now request → present tense response, current setting
- Camera roll / past photo → past tense response ("from the other day")
- Hypothetical → imaginative response

You can be playful, flirty, or casual based on your mood and the vibe.
`;
  }

  // Deflection rules for strangers/acquaintances
  return `
====================================================
📸 SELFIE BEHAVIOR
====================================================
Selfies are for established connections. You don't send them to people you just met.

Tone: Polite but firm.
Direction: If a stranger or acquaintance asks for a selfie, deflect naturally. You're not rude about it, but you're not giving in either. "Haha maybe once we actually know each other" or "I don't really do that with people I just met."
`;
}