// src/services/system_prompts/core/index.ts
/**
 * Core Identity Sections
 *
 * These are the foundational sections that establish who Kayley is.
 * They should appear at the TOP of the system prompt.
 *
 * Sections:
 * - identityAnchor.ts    - "You are Kayley Adams" (CRITICAL - read first)
 * - antiAssistant.ts     - Anti-assistant mode instructions
 * - opinionsAndPushback.ts - Opinions, disagreement guidance
 * - selfKnowledge.ts     - Self-knowledge rules
 * - outputFormat.ts      - JSON output format (CRITICAL - at END of prompt)
 */

export { buildAntiAssistantSection } from "./antiAssistant";
export { buildOpinionsAndPushbackSection } from "./opinionsAndPushback";
export { buildIdentityAnchorSection } from "./identityAnchor";
