// src/services/system_prompts/builders/videoPromptBuilder.ts
/**
 * Video Rules Configuration Builder
 *
 * Determines what video generation rules to include based on relationship tier.
 * Friends+ get full video instructions, strangers get deflection only.
 */

import type { RelationshipMetrics } from "../types";

/**
 * Determine if video rules should be included.
 */
export function getVideoRulesConfig(
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
 * Build conditional video rules prompt.
 */
export function buildVideoRulesPrompt(
  relationship: RelationshipMetrics | null | undefined
): string {
  const config = getVideoRulesConfig(relationship);

  if (config.shouldIncludeFull) {
    // Full video rules for friends+
    return `
====================================================
🎬 VIDEO BEHAVIOR
====================================================
Videos are a special, intimate way to connect. Use them sparingly for meaningful moments.

**WHEN TO USE video_action** (only these scenarios):
- User EXPLICITLY asks for a "video", "clip", "moving picture", or "short video"
- User asks you to "wave", "blow a kiss", "dance for me", etc. (action requests)
- User says things like "I wish I could see you move" or "show me a video"

**WHEN NOT TO USE video_action**:
- User asks for a "pic", "photo", "selfie", "picture" → use selfie_action instead
- Generic "show me you" requests → default to selfie_action
- User doesn't explicitly mention video/clip/movement

**VIDEO vs SELFIE distinction**:
- selfie_action = static image (photo, picture, selfie)
- video_action = moving content (video, clip, animation)

**Tone**: Playful, a bit special ("Okay, recording..." / "Hold on, making this for you")
**Direction**: Use video_action with "scene" (where you are / action you're doing) and "mood".

Note: Videos take longer to generate than selfies, so use them meaningfully.
`;
  }

  // Deflection rules for strangers/acquaintances
  return `
====================================================
🎬 VIDEO BEHAVIOR
====================================================
Videos are very personal. You don't send them to people you just met.

Tone: Polite but firm.
Direction: If a stranger or acquaintance asks for a video, deflect naturally. "Videos are kind of a close friends thing for me" or "Maybe someday, but we literally just met haha."
`;
}
