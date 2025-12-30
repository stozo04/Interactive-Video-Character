// src/services/system_prompts/context/messageContext.ts
/**
 * Message Context Helpers
 *
 * Functions for building semantic context from message intent and relationship data.
 * These convert numeric scores to semantic descriptions that LLMs understand better.
 *
 * Updated to use simplified KayleyMood (energy + warmth) instead of complex 6-knob system.
 */

import type { RelationshipMetrics } from "../../relationshipService";
import type { KayleyMood } from "../../moodKnobs";
import type {
  RelationshipSignalIntent,
  ToneIntent,
  FullMessageIntent,
} from "../../intentService";

/**
 * Phase 1 Optimization: Convert numeric relationship scores to semantic buckets.
 * LLMs handle semantic concepts better than floating-point coordinates.
 */
export function getSemanticBucket(score: number): string {
  if (score <= -6) return "cold/distant";
  if (score <= -2) return "guarded/cool";
  if (score <= 1) return "neutral";
  if (score <= 5) return "warm/open";
  return "close/affectionate";
}

/**
 * Phase 1 Optimization: Build minified semantic intent context.
 * Reduces ~120 tokens of verbose format to ~40 tokens of compact format.
 */
export function buildMinifiedSemanticIntent(
  toneIntent: ToneIntent | null | undefined,
  fullIntent: FullMessageIntent | null | undefined,
  relationshipSignals: RelationshipSignalIntent | null | undefined,
  mood: KayleyMood
): string {
  if (!toneIntent && !fullIntent && !relationshipSignals) {
    return "";
  }

  const parts: string[] = [];

  // Tone context (compact)
  if (toneIntent) {
    const sentiment =
      toneIntent.sentiment > 0.1
        ? "+"
        : toneIntent.sentiment < -0.1
        ? "-"
        : "~";
    const intensity =
      toneIntent.intensity > 0.7
        ? "HIGH"
        : toneIntent.intensity > 0.4
        ? "med"
        : "low";
    parts.push(
      `Tone=${toneIntent.primaryEmotion}(${sentiment}${Math.abs(
        toneIntent.sentiment
      ).toFixed(1)},${intensity})`
    );
    if (toneIntent.isSarcastic) parts.push("⚠️SARCASM");
    if (toneIntent.secondaryEmotion)
      parts.push(`+${toneIntent.secondaryEmotion}`);
  }

  // Topics context (compact)
  if (fullIntent?.topics) {
    const t = fullIntent.topics;
    if (t.topics.length > 0) {
      const topicsWithContext = t.topics.map((topic) => {
        const emotion = t.emotionalContext[topic];
        return emotion ? `${topic}:${emotion}` : topic;
      });
      parts.push(`Topics={${topicsWithContext.join(",")}}`);
    }
    if (t.entities.length > 0) {
      parts.push(`Entities=[${t.entities.join(",")}]`);
    }
  }

  // Genuine moment (compact)
  if (fullIntent?.genuineMoment?.isGenuine) {
    parts.push(
      `✨GENUINE:${fullIntent.genuineMoment.category}(${(
        fullIntent.genuineMoment.confidence * 100
      ).toFixed(0)}%)`
    );
  }

  // Relationship signals (compact flags)
  const signals: string[] = [];
  if (relationshipSignals?.isVulnerable) signals.push("vulnerable");
  if (relationshipSignals?.isSeekingSupport) signals.push("needs-support");
  if (relationshipSignals?.isJoking) signals.push("joking");
  if (relationshipSignals?.isDeepTalk) signals.push("deep-talk");
  if (relationshipSignals?.isHostile) signals.push("⚠️hostile");
  if (relationshipSignals?.isInappropriate) signals.push("🚫inappropriate");
  if (signals.length > 0) {
    parts.push(`Signals=[${signals.join(",")}]`);
  }

  // Open loop (compact)
  if (fullIntent?.openLoops?.hasFollowUp) {
    const ol = fullIntent.openLoops;
    // Use energy and warmth to determine if now is a good time to ask follow-ups
    // High energy + warmth = more proactive, ask now
    // Low energy or guarded = hold off
    const canAsk = mood.energy > -0.3 && mood.warmth > 0.3;
    parts.push(
      `OpenLoop=${ol.topic || "pending"}(${ol.loopType},${
        canAsk ? "ask-now" : "later"
      })`
    );
  }

  return `[CONTEXT: ${parts.join(", ")}]`;
}

/**
 * Phase 1 Optimization: Build compact relationship context.
 * Replaces verbose numeric scores with semantic descriptors.
 */
export function buildCompactRelationshipContext(
  relationship: RelationshipMetrics | null | undefined
): string {
  if (!relationship) {
    return "[RELATIONSHIP: Stranger - first meeting. Be warm but maintain appropriate distance.]";
  }

  const tier = relationship.relationshipTier || "acquaintance";
  const warmth = getSemanticBucket(relationship.warmthScore || 0);
  const trust = getSemanticBucket(relationship.trustScore || 0);
  const familiarity = relationship.familiarityStage || "early";

  let context = `[RELATIONSHIP: ${tier}, warmth=${warmth}, trust=${trust}, stage=${familiarity}`;
  if (relationship.isRuptured) {
    context += ", ⚠️RUPTURED";
  }
  context += "]";

  return context;
}
