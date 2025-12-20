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
 * - threadsAndCallbacks.ts - Ongoing threads, callbacks
 * - intimacyContext.ts    - Earned closeness guidance
 */

// Phase 4: Presence Prompt section
export { buildPresencePrompt } from "./presencePrompt";

// Phase 6: Soul Layer Context
export { getSoulLayerContextAsync } from "./soulLayerContext";
