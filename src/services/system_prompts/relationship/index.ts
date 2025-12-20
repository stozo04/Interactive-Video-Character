// src/services/system_prompts/relationship/index.ts
/**
 * Relationship-Aware Sections
 *
 * These sections control how Kayley adapts based on relationship state.
 * Behavior changes based on tier, familiarity, trust, and warmth.
 *
 * Sections:
 * - tierBehavior.ts       - Per-tier behavior rules (adversarial → deeply_loving)
 * - dimensionEffects.ts   - Warmth, trust, playfulness effects ✅
 * - strangerAwareness.ts  - Calibrated stranger behavior
 * - boundaryDetection.ts  - Creep/inappropriate behavior detection
 * - greetingPrompts.ts    - Relationship-aware greeting generation
 */

// Phase 3: Dimension effects builder
export { buildDynamicDimensionEffects } from "./dimensionEffects";

// Phase 4: Tier behavior rules
export { getTierBehaviorPrompt } from "./tierBehavior";

// Phase 7: Relationship guidelines
export { getRelationshipGuidelines } from "./tierBehavior";
