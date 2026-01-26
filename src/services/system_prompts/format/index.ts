// src/services/system_prompts/format/index.ts
/**
 * Output Format Sections
 *
 * CRITICAL: These sections must be at the END of the prompt due to recency bias.
 */

export {
  buildOutputFormatSectionForNonGreeting,
  buildOutputFormatSectionForGreeting,
  buildCriticalOutputRulesSection,
} from "./outputFormat";
