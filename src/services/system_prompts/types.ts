// src/services/system_prompts/types.ts
/**
 * Type definitions for the system prompts module.
 *
 * These types are used across multiple prompt sections.
 * Centralizing them here prevents circular dependencies.
 */

import type { MoodKnobs } from "../moodKnobs";
import type { PresenceContext } from "../presenceDirector";

/**
 * Soul Layer Context - the "alive" components
 * Now includes PRESENCE for proactive memory and opinions
 */
export interface SoulLayerContext {
  moodKnobs: MoodKnobs;
  threadsPrompt: string;
  callbackPrompt: string;
  /** Presence context including open loops and opinions (async loaded) */
  presenceContext?: PresenceContext;
}

// Re-export types that are commonly needed by prompt builders
export type { MoodKnobs } from "../moodKnobs";
export type { PresenceContext } from "../presenceDirector";
export type { RelationshipMetrics } from "../relationshipService";
