// src/services/system_prompts/context/messageContext.ts
/**
 * Message Context Helpers
 *
 * Functions for building semantic context from relationship data.
 * These convert numeric scores to semantic descriptions that LLMs understand better.
 *
 * Move 37: buildMinifiedSemanticIntent removed - main LLM reads messages directly.
 * The create_open_loop tool now handles follow-up creation explicitly.
 */

import type { RelationshipMetrics } from "../../relationshipService";

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

// Move 37: buildMinifiedSemanticIntent has been removed
// The main LLM now reads messages directly without pre-processing.
// This saves ~10K tokens per message and reduces latency.
//
// What was handled by intent detection is now handled by:
// - create_open_loop tool: Kayley decides what to remember for follow-up
// - store_user_info tool: Kayley corrects facts when user contradicts
// - Main LLM: Understands tone, topics, signals directly from message

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
