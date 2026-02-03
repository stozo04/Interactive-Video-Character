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

export {
  buildSystemPromptForNonGreeting,
  buildSystemPromptForGreeting,
  type GreetingContext,
} from "./systemPromptBuilder";


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

export { buildNonGreetingPrompt, buildGreetingPrompt } from "./greetingPromptBuilders";