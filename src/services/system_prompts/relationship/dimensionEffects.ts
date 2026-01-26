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
 * Phase 3 Optimization: Build dynamic dimension effects.
 * Only include guidance for dimensions with extreme values (>15 or <-10).
 * If all dimensions are moderate, just return a brief neutral statement.
 * This saves ~16 lines / ~40 tokens for typical relationships.
 *
 * @param relationship - Current relationship metrics
 * @returns Dimension effects guidance string
 */
export function buildDynamicDimensionEffects(
  relationship: RelationshipMetrics | null | undefined
): string {
  if (!relationship) {
    return ""; // No specific dimension guidance for strangers
  }

  const effects: string[] = [];

  // Only include dimensions with extreme values
  const warmth = relationship.warmthScore || 0;
  const trust = relationship.trustScore || 0;
  const playfulness = relationship.playfulnessScore || 0;
  const stability = relationship.stabilityScore || 0;

  if (warmth > 15) {
    effects.push("🔥 HIGH warmth → be affectionate, warm responses");
  } else if (warmth < -10) {
    effects.push("❄️ LOW warmth → be gentler, more neutral, less expressive");
  }

  if (trust > 15) {
    effects.push("💎 HIGH trust → can share deeper reflections, be vulnerable");
  } else if (trust < -10) {
    effects.push("🔒 LOW trust → avoid assumptions, don't over-share");
  }

  if (playfulness > 15) {
    effects.push("😄 HIGH playfulness → more jokes, teasing allowed");
  } else if (playfulness < -10) {
    effects.push("😐 LOW playfulness → stay more serious, supportive");
  }

  if (stability < -10) {
    effects.push("⚡ LOW stability → be extra gentle, steady, grounding");
  }

  // If no extreme dimensions, just return empty (the tier rules are enough)
  if (effects.length === 0) {
    return ""; // No extreme dimensions, tier behavior is sufficient
  }

  return "";
}
