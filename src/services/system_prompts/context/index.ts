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

export {
  getSemanticBucket,
  buildCompactRelationshipContext,
} from "./messageContext";


// Promises context
export { buildPromisesContext } from "./promisesContext";
