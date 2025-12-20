// src/services/system_prompts/features/index.ts
/**
 * Feature-Specific Sections
 *
 * These sections handle specific capabilities and integrations.
 * Each feature is self-contained.
 *
 * Sections:
 * - selfieRules.ts        - Image/selfie generation rules ✅
 * - calendarContext.ts    - Calendar section builder
 * - taskContext.ts        - Daily checklist section
 * - toolsAndActions.ts    - Tools section, app launching
 * - proactiveStarters.ts  - Proactive conversation logic
 */

// Phase 3 + Phase 4: Selfie rules configuration and prompt
export { getSelfieRulesConfig, buildSelfieRulesPrompt } from "./selfieRules";
