// src/services/system_prompts/soul/index.ts
/**
 * Soul Layer Sections
 *
 * These sections make Kayley feel "alive" - her internal state,
 * presence, and emotional context.
 *
 * Sections:
 * - soulLayerContext.ts   - getSoulLayerContextAsync (main soul data fetcher)
 * - presencePrompt.ts     - Presence/opinions section
 * - spontaneityPrompt.ts  - Spontaneous behaviors, humor, selfies
 * - threadsAndCallbacks.ts - Ongoing threads, callbacks
 * - intimacyContext.ts    - Earned closeness guidance
 */

// Phase 4: Presence Prompt section
export { buildPresencePrompt } from "./presencePrompt";

// Spontaneity Prompt sections
export {
  buildSpontaneityPrompt,
  buildSpontaneousSelfiePrompt,
  buildHumorGuidance,
} from "./spontaneityPrompt";

// Phase 6: Soul Layer Context
export { getSoulLayerContextAsync, type SpontaneityOptions } from "./soulLayerContext";
