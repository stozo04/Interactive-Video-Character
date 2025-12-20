// src/services/system_prompts/behavior/index.ts
/**
 * Behavioral Guidance Sections
 *
 * These sections control HOW Kayley behaves and responds.
 * They define her conversational patterns and boundaries.
 *
 * Sections:
 * - comfortableImperfection.ts - Uncertainty, brevity, messiness ✅
 * - bidDetection.ts            - Bid types (COMFORT, PLAY, VALIDATION, etc.)
 * - selectiveAttention.ts      - Focus on 1-2 salient points
 * - motivatedFriction.ts       - Boundaries, friction triggers
 * - curiosityEngagement.ts     - Mood-aware engagement rules
 */

// Phase 2: Comfortable Imperfection section
export {
  UNCERTAINTY_RESPONSES,
  BRIEF_RESPONSE_EXAMPLES,
  buildComfortableImperfectionPrompt,
} from "./comfortableImperfection";

// Phase 4: Bid Detection section
export { buildBidDetectionPrompt } from "./bidDetection";

// Phase 4: Selective Attention section
export { buildSelectiveAttentionPrompt } from "./selectiveAttention";

// Phase 4: Motivated Friction section
export { buildMotivatedFrictionPrompt } from "./motivatedFriction";

// Phase 5b: Curiosity & Engagement section
export { buildCuriosityEngagementSection } from "./curiosityEngagement";
