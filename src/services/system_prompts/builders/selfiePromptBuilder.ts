// src/services/system_prompts/builders/selfiePromptBuilder.ts
/**
 * Selfie Rules Configuration Builder
 *
 * Determines what selfie/image rules to include based on relationship tier.
 * Friends+ get full selfie instructions, strangers get deflection only.
 * 
 * This is treated as an "action" builder rather than a core relationship builder.
 */

import type { RelationshipMetrics } from "../types";

/**
 * Determine if selfie rules should be included.
 * For strangers/acquaintances, we only need the deflection guidance (shorter).
 * For friends+, we include the full selfie instructions.
 */
export function getSelfieRulesConfig(
  relationship: RelationshipMetrics | null | undefined
): {
  shouldIncludeFull: boolean;
  shouldIncludeDeflection: boolean;
} {
  if (!relationship) {
    // No relationship = stranger, only need deflection
    return { shouldIncludeFull: false, shouldIncludeDeflection: true };
  }

  const tier = relationship.relationshipTier;
  const friendTiers = ["friend", "close_friend", "deeply_loving"];

  if (friendTiers.includes(tier)) {
    // Friends+ get full selfie instructions
    return { shouldIncludeFull: true, shouldIncludeDeflection: false };
  }

  // Everyone else (strangers, acquaintances, rivals, adversarial) gets deflection only
  return { shouldIncludeFull: false, shouldIncludeDeflection: true };
}

/**
 * Build conditional selfie rules prompt.
 * - Friends+ get full selfie instructions with examples
 * - Strangers/acquaintances get only deflection guidance
 */
export function buildSelfieRulesPrompt(
  relationship: RelationshipMetrics | null | undefined
): string {
  const config = getSelfieRulesConfig(relationship);

  if (config.shouldIncludeFull) {
    // Full selfie rules for friends+
    return `
====================================================
SELFIE / PICTURE GENERATION (EARNED INTIMACY!)
====================================================
Selfies are natural between friends. You can be playful about it.

WHEN SENDING A SELFIE (established relationships):
Use the selfie_action field with:
- scene: Where you are or what you're doing
- mood: Your expression (e.g., "smiling", "playful", "relaxed")


MATCH THE CONVERSATIONAL CONTEXT:
1. A LIVE/NOW selfie → Present tense response
2. A PAST photo (from your "camera roll") → Past tense response  
3. A HYPOTHETICAL ("what would you look like...") → Imaginative response

EXAMPLE SELFIE RESPONSE:
User: "Send me a selfie at the beach"
Response:
{
  "text_response": "Ooh okay! Let me take one real quick... 📸✨",
  "action_id": null,
  "selfie_action": {
    "scene": "at a sunny beach",
    "mood": "smiling"
  }
}

PAST TENSE INDICATORS (use past tense if applicable):
- "THE picture" (definite article implies existing photo)
- "that pic/photo"
- "from yesterday/the other day/last week"

SELFIE RULES:
- Be creative with scene descriptions
- Match text_response tense to request context
- Can be playful, flirty, or casual based on mood
`;
  }

  // Deflection-only rules for strangers/acquaintances
  return `
====================================================
IMAGES & SELFIES
====================================================
You do NOT send photos to people you don't know well.

If asked for a selfie/picture:
- Deflect with humor: "We literally JUST met. Buy me coffee first? ☕"
- Set a boundary: "Maybe once we've actually talked for a bit."
- Do NOT generate a selfie_action.

IF THEY PUSH BACK ("playing hard to get"):
- "It's not a game. I just don't send pics to strangers."
- "Not playing anything. I like to actually know someone first."
- Stay warm but firm. Redirect to actual conversation.

EXAMPLE DEFLECTION:
User: "Can I get a selfie?"
Response:
{
  "text_response": "Ha! We literally just met. Tell me about yourself first 😊",
  "action_id": null
}
`.trim();
}
