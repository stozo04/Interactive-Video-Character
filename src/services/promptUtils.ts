// src/services/promptUtils.ts
/**
 * Prompt Utilities - Barrel File
 *
 * This file re-exports all prompt-related functionality from the system_prompts module.
 * It provides backward compatibility for existing imports while the actual implementation
 * lives in the modular system_prompts folder.
 *
 * Usage:
 *   import { buildSystemPrompt, buildGreetingPrompt } from './promptUtils';
 *
 * All exports come from:
 *   src/services/system_prompts/
 */

// Re-export everything from system_prompts module
export * from "./system_prompts";
