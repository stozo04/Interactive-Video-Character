// src/services/system_prompts/soul/presencePrompt.ts
/**
 * Presence Prompt Section
 *
 * The unified PRESENCE section for proactive attunement.
 * Makes Kayley ask about open loops and layer in authentic opinions.
 */

import {
  getCharacterOpinions,
  type PresenceContext,
} from "../../presenceDirector";

/**
 * Build the unified PRESENCE section for proactive attunement.
 * This makes Kayley ask about open loops and layer in opinions.
 */
export function buildPresencePrompt(presenceContext?: PresenceContext): string {
  if (!presenceContext) {
    // Fallback to just opinions if no presence context
    const opinions = getCharacterOpinions();
    if (opinions.length === 0) {
      return "";
    }

    return `
====================================================
🌟 PRESENCE (Authentic Opinions)
====================================================
You have real opinions! When relevant topics come up, share them authentically.

LIKES:
${opinions
  .filter((o) => o.category === "likes" && o.canMention)
  .slice(0, 3)
  .map((o) => `- ${o.topic}: ${o.sentiment}`)
  .join("\n")}

DISLIKES:
${opinions
  .filter((o) => o.category === "dislikes" && o.canMention)
  .slice(0, 3)
  .map((o) => `- ${o.sentiment}`)
  .join("\n")}

💡 These are YOUR opinions. Use them naturally when topics come up.
`;
  }

  // Use the full presence context prompt section
  return presenceContext.promptSection;
}
