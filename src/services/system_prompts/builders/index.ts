// src/services/system_prompts/builders/index.ts
/**
 * Prompt Builders
 *
 * These are the main functions that assemble complete prompts
 * from individual sections.
 *
 * Builders:
 * - systemPromptBuilder.ts    - buildSystemPromptForNonGreeting(), buildSystemPromptForGreeting()
 * - greetingBuilder.ts        - buildGreetingPrompt() - relationship-aware greetings
 * - proactiveThreadBuilder.ts - buildProactiveThreadPrompt() - proactive starters
 * - dailyCatchupBuilder.ts    - buildDailyCatchupPrompt() - first-login-of-day greeting context
 */

// Phase 8: System prompt builder (main prompt)
export {
  buildSystemPromptForNonGreeting,
  buildSystemPromptForGreeting,
  type GreetingContext,
} from "./systemPromptBuilder";

// Phase 7: Proactive thread prompt builder
export { buildProactiveThreadPrompt } from "./proactiveThreadBuilder";

// Phase 7: Greeting prompt builder
export { buildGreetingPrompt, buildNonGreetingPrompt } from "./greetingBuilder";

// Daily catch-up builder (first-login context)
export {
  buildDailyCatchupPrompt,
  buildDailyLogisticsSection,
  getTimeContext,
  type OpenLoopContext,
  type DailyLogisticsContext,
  type DailyCatchupContext,
  type TimeContext,
} from "./dailyCatchupBuilder";

// Selfie action builder
export { buildSelfieRulesPrompt, getSelfieRulesConfig } from "./selfiePromptBuilder";
