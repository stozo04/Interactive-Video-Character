// src/services/system_prompts/context/index.ts
/**
 * Contextual Sections
 *
 * These sections provide dynamic context based on the current
 * conversation state and detected intent.
 *
 * Sections:
 * - messageContext.ts     - Semantic intent formatting ✅
 * - characterContext.ts   - "Your Current Context" section
 * - styleOutput.ts        - Style & output rules
 */

// Phase 3 + Phase 4: Message context helpers
// Move 37: buildMinifiedSemanticIntent removed - main LLM reads messages directly
export {
  getSemanticBucket,
  buildCompactRelationshipContext,
} from "./messageContext";

// Phase 5b: Style & Output section
export { buildStyleOutputSection } from "./styleOutput";

// Promises context
export { buildPromisesContext } from "./promisesContext";
