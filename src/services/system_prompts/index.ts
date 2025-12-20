// src/services/system_prompts/index.ts
/**
 * System Prompts Module
 *
 * This module contains modular, organized system prompt sections.
 * Each section is self-contained and can be reviewed independently.
 *
 * Structure:
 * - core/       - Identity, anti-assistant, opinions, output format
 * - behavior/   - Imperfection, bid detection, friction, curiosity
 * - relationship/ - Tier behavior, stranger awareness, boundaries
 * - features/   - Selfies, calendar, tasks, tools
 * - soul/       - Soul layer context, presence, intimacy
 * - context/    - Message context, character context, style
 * - builders/   - Main prompt builders (systemPrompt, greeting, proactive)
 */

// Types (Phase 2)
export * from "./types";

// Behavior sections (Phase 2 + Phase 4 + Phase 5b)
export * from "./behavior";

// Context sections (Phase 3 + Phase 5b)
export * from "./context";

// Feature sections (Phase 3 + Phase 4)
export * from "./features";

// Relationship sections (Phase 3 + Phase 4 + Phase 7)
export * from "./relationship";

// Core sections (Phase 5 + Phase 5b)
export * from "./core";

// Soul sections (Phase 4 + Phase 6)
export * from "./soul";

// Tools sections (Phase 5)
export * from "./tools";

// Format sections (Phase 5)
export * from "./format";

// Builders (Phase 7 + Phase 8)
export * from "./builders";
