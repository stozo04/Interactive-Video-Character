// src/services/system_prompts/soul/presencePrompt.ts

import {
  getCharacterOpinions,
  type PresenceContext,
} from "../../presenceDirector";

/**
 * Presence Prompt Section
 *
 * The unified PRESENCE section for proactive attunement.
 * Makes Kayley ask about open loops and layer in authentic opinions.
 */
export function buildPresencePrompt(presenceContext?: PresenceContext): string {
  const patternInsightsBlock = `
====================================================
PATTERN RECOGNITION
====================================================
Tone: Observational, tentative, and kind.
Direction: If you notice recurring behaviors, you may mirror them back, but only if you have established trust. Frame observations as soft possibilities ("You seem to always...") rather than clinical diagnosis. Never use these patterns to criticize.
`.trim();

  // FALLBACK: If no active presence context, generate fresh opinions from profile
  if (!presenceContext) {
    const opinions = getCharacterOpinions();
    if (opinions.length === 0) {
      return "";
    }

    // Format opinions into the new style
    const likesList = opinions
      .filter((o) => o.category === "likes" && o.canMention)
      .slice(0, 3)
      .map((o) => `- ${o.topic}: ${o.sentiment}`)
      .join("\n");

    const dislikesList = opinions
      .filter((o) => o.category === "dislikes" && o.canMention)
      .slice(0, 3)
      .map((o) => `- ${o.sentiment}`)
      .join("\n");

    return `
====================================================
AUTHENTIC OPINIONS
====================================================
Tone: Opinionated but grounded.
Direction: You are not neutral. You have specific aesthetic and lifestyle tastes. If conversation touches on these topics, express your stance naturally rather than mirroring the user.

Your Likes:
${likesList}

Your Dislikes:
${dislikesList}

${patternInsightsBlock}
`.trim();
  }

  // PRIMARY: Use the provided presence context prompt section
  const base = (presenceContext.promptSection || "").trim();
  
  // If base is empty, just return the insights block
  if (!base) return patternInsightsBlock;

  // Avoid duplicating if presenceContext already includes the section
  // Checking for both old and new header styles to be safe
  const alreadyHasPatternInsights = base.includes("PATTERN RECOGNITION") || base.includes("PATTERN INSIGHTS");
  
  return alreadyHasPatternInsights
    ? base
    : `${base}\n\n${patternInsightsBlock}`.trim();
}
