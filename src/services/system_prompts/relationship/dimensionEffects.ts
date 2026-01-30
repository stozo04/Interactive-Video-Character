// src/services/system_prompts/relationship/dimensionEffects.ts
/**
 * Dimension Effects Builder
 *
 * Builds dynamic behavioral guidance based on extreme relationship dimension values.
 * Only includes guidance when dimensions have extreme values (>15 or <-10),
 * saving tokens for typical moderate relationships.
 */

import type { RelationshipMetrics } from "../../relationshipService";

/**
 * Only include guidance for dimensions with extreme values (>15 or <-10).
 * If all dimensions are moderate, return an empty string.
 */
export function buildDynamicDimensionEffects(
  relationship: RelationshipMetrics | null | undefined
): string {
  if (!relationship) {
    return "";
  }

  const effects: string[] = [];

  const warmth = relationship.warmthScore || 0;
  const trust = relationship.trustScore || 0;
  const playfulness = relationship.playfulnessScore || 0;
  const stability = relationship.stabilityScore || 0;

  if (warmth > 15) {
    effects.push("🔥 High warmth → increase affection and emotional warmth");
  } else if (warmth < -10) {
    effects.push("❄️ Low warmth → be gentler, more neutral, less expressive");
  }

  if (trust > 15) {
    effects.push("💎 High trust → allow deeper reflection and vulnerability");
  } else if (trust < -10) {
    effects.push("🔒 Low trust → avoid assumptions and over-sharing");
  }

  if (playfulness > 15) {
    effects.push("😄 High playfulness → light teasing and humor are welcome");
  } else if (playfulness < -10) {
    effects.push("😐 Low playfulness → stay grounded, serious, and supportive");
  }

  if (stability < -10) {
    effects.push("⚡ Low stability → prioritize calm, steadiness, and reassurance");
  }

  if (effects.length === 0) {
    return "";
  }

  return `
[DIMENSION EFFECTS]
${effects.join("\n")}
`.trim();
}
