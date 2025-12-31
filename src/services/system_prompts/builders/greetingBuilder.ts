// src/services/system_prompts/builders/greetingBuilder.ts

/**
 * Greeting Prompt Builder
 *
 * Creates relationship-aware greeting prompts by orchestrating specialized builders.
 * The greeting reflects the actual relationship state, history, and any 
 * proactive context (open loops, threads, pending messages).
 */

// Consume the consolidated builders
export { 
  buildGreetingPrompt, 
  buildNonGreetingPrompt 
} from "./greetingPromptBuilders";

/**
 * Note: Logic for buildProactiveSection and buildPendingMessageSection 
 * has been moved to ./greetingPromptBuilders/index.ts to keep this file clean.
 */
