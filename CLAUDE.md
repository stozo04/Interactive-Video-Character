# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Interactive AI video character companion system. A React web app that enables real-time interaction with an AI character ("Kayley") through chat, with responses delivered via generated video/audio. Supports multiple AI providers (Google Gemini, OpenAI, XAI Grok) and uses Supabase for cloud state persistence.

## Development Workflow

For complex tasks:
1. **Create a plan first** - Write implementation plans in a separate Markdown file in `docs/` before coding
2. **Break down into steps** - Decompose complex features into small, testable increments
3. **Follow TDD** - Write tests before implementation; tests must pass before merge
4. **Execute incrementally** - Complete and verify each step before moving to the next

## Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm test             # Run tests in watch mode
npm test -- --run    # Run tests once (CI mode)
npm test -- --run -t "pattern"  # Run specific tests matching pattern
npm run test:ui      # Visual test dashboard
npm run test:coverage # Coverage report
```

## Architecture

### Fast Router Pattern (Sub-2s Response Times)

The app maintains <2s response times through parallel execution:
- Intent detection and main chat run concurrently (~1.8-1.9s)
- Database writes are non-blocking (fire-and-forget in background)
- Single unified RPC call (`getFullCharacterContext`) replaces 3-4 separate fetches

### Service Layer Abstraction

```
App.tsx (UI orchestration)
    ↓
BaseAIService (Abstract base class)
    ├── GeminiChatService
    ├── ChatGPTService
    └── GrokChatService
```

All providers implement `IAIChatService` interface, allowing seamless switching.

### Key Services

| Service | Purpose |
|---------|---------|
| `promptUtils.ts` | Barrel file re-exporting from `system_prompts/` module |
| `system_prompts/` | **Modular system prompt architecture** (see below) |
| `intentService.ts` | LLM-based message intent detection (tone, topics, signals) |
| `presenceDirector.ts` | Determines character availability and actions |
| `relationshipService.ts` | Relationship tier calculation and metrics |
| `moodKnobs.ts` | Maps mood state to behavior parameters |
| `stateService.ts` | Supabase CRUD operations for all state |
| `ongoingThreads.ts` | Mental thread management with decay |

### State Management

Supabase is the single source of truth. Key tables:
- `mood_states` - Daily energy, social battery
- `emotional_momentum` - Current mood, interaction streaks
- `ongoing_threads` - Character's "mental weather" (3-5 active thoughts)
- `intimacy_states` - Relationship vulnerability tracking
- `presence_contexts` - Current actions/demeanor

Caching: 30s TTL, auto-invalidates on writes. Cache is for performance only.

### Intent Detection Pipeline

One LLM call computes all intent data upfront:
```
User Message → detectFullIntentLLMCached() → FullMessageIntent
                                               ├── tone, mood
                                               ├── topics
                                               ├── genuine moments
                                               ├── open loops
                                               └── relationship signals
```
This is passed to both main chat and background analysis, avoiding redundant LLM calls.

## Working with the System Prompt

**Read `docs/System_Prompt_Guidelines.md` before modifying the system prompt.**

### System Prompt Architecture

The system prompt is built from modular, single-responsibility files in `src/services/system_prompts/`:

```
system_prompts/
├── builders/           # Main prompt assembly functions
│   ├── systemPromptBuilder.ts    # buildSystemPrompt() - main entry point
│   ├── greetingBuilder.ts        # buildGreetingPrompt()
│   └── proactiveThreadBuilder.ts # buildProactiveThreadPrompt()
├── core/               # Identity & character foundation
│   ├── identityAnchor.ts         # "You are Kayley Adams"
│   ├── antiAssistant.ts          # Anti-AI-assistant instructions
│   ├── opinionsAndPushback.ts    # Opinions, disagreement
│   └── selfKnowledge.ts          # Self-knowledge rules
├── behavior/           # How the character behaves
│   ├── comfortableImperfection.ts # Uncertainty, brevity
│   ├── bidDetection.ts           # Emotional bid types
│   ├── selectiveAttention.ts     # Focus on 1-2 points
│   ├── motivatedFriction.ts      # Boundaries, friction
│   └── curiosityEngagement.ts    # Mood-aware engagement
├── relationship/       # Relationship-dependent behavior
│   ├── tierBehavior.ts           # Per-tier rules + guidelines
│   └── dimensionEffects.ts       # Warmth/trust/playfulness effects
├── context/            # Dynamic context injection
│   ├── messageContext.ts         # Semantic intent formatting
│   └── styleOutput.ts            # Style rules, boundary detection
├── features/           # Specific feature rules
│   └── selfieRules.ts            # Image generation rules
├── soul/               # "Alive" components
│   ├── soulLayerContext.ts       # getSoulLayerContextAsync()
│   └── presencePrompt.ts         # Presence/opinions
├── tools/              # Tool usage instructions
│   └── index.ts                  # Tools, tool rules, app launching
├── format/             # Output formatting
│   └── index.ts                  # JSON schema, critical rules
└── types.ts            # Type definitions (SoulLayerContext)
```

### How to Modify the System Prompt

**Adding a new section:**
1. Identify which folder it belongs to (behavior, relationship, features, etc.)
2. Create a new `.ts` file with a `build___Section()` function
3. Export from the folder's `index.ts`
4. Import and call in `builders/systemPromptBuilder.ts`
5. Run snapshot tests: `npm test -- --run -t "snapshot"`

**Modifying an existing section:**
1. Find the file in `system_prompts/` (use folder names as guide)
2. Edit the template string in the `build___` function
3. Run snapshot tests to see the diff
4. Update snapshots if change is intentional: `npm test -- --run -t "snapshot" -u`

**Example - Adding a new behavior:**
```typescript
// src/services/system_prompts/behavior/newBehavior.ts
export function buildNewBehaviorSection(moodKnobs: MoodKnobs): string {
  return `
====================================================
NEW BEHAVIOR GUIDANCE
====================================================
Your instructions here...
`;
}

// Then in behavior/index.ts, add:
export { buildNewBehaviorSection } from "./newBehavior";

// Then in builders/systemPromptBuilder.ts, import and use:
prompt += buildNewBehaviorSection(moodKnobs);
```

### Key Principles

1. **Code logic over prompt logic** - Pre-compute applicable rules in code, don't list all options for LLM to pick
2. **Conditional inclusion** - Use helper functions like `getTierBehaviorPrompt(tier)` to include only relevant sections
3. **Recency bias** - Critical output rules (JSON schema) must be at the END of the prompt
4. **Test-driven** - Run snapshot tests after every change
5. **Single responsibility** - Each file handles ONE aspect of the prompt

Example of conditional inclusion:
```typescript
// Only include current tier's behavior, not all 6 tiers
${getTierBehaviorPrompt(relationship?.relationshipTier)}
```

## Testing

554+ tests covering core functionality. Test files are in `src/services/tests/` and `src/services/__tests__/`.

Run all tests before merging prompt changes:
```bash
npm test -- --run
```

## Adding New LLM Tools

When adding a new tool that the AI can call (like `manage_narrative_arc` or `manage_dynamic_relationship`), you **MUST** follow the **8-step integration checklist**:

**📋 See**: [`docs/Tool_Integration_Checklist.md`](docs/Tool_Integration_Checklist.md) for the complete step-by-step guide.

**The 8 Critical Integration Points**:
1. `memoryService.ts` - Add to MemoryToolName, ToolCallArgs, executeMemoryTool()
2. `aiSchema.ts` - Add to GeminiMemoryToolDeclarations
3. `aiSchema.ts` - Add to MemoryToolArgs union (**DON'T FORGET**)
4. `aiSchema.ts` - Add to PendingToolCall.name union (**DON'T FORGET**)
5. `aiSchema.ts` - Add to OpenAIMemoryToolDeclarations (if using OpenAI)
6. `toolsAndCapabilities.ts` - Add documentation with examples
7. `systemPromptBuilder.ts` - Add context injection (if needed)
8. Snapshot tests - Update with `-u` flag

**Common Mistakes**:
- ❌ Forgetting steps 3 or 4 → Type errors and runtime failures
- ❌ Skipping snapshot updates → Tests fail

## File Organization

```
src/
├── components/      # React UI components
├── services/        # Business logic (AI providers, state, prompts)
├── contexts/        # React Context (auth, AI service selection)
├── hooks/           # Custom hooks (caching, media queues)
├── domain/          # Domain models (characters, relationships)
└── utils/           # Utilities
supabase/migrations/ # Database schema (15+ migrations)
docs/                # Developer documentation and implementation plans
```

## Environment Variables

Required in `.env.local`:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
```

## Performance Guidelines

- Keep database operations parallel or in background
- Use `getFullCharacterContext()` RPC for unified state fetch
- Target <2s response times
- Cache has 30s TTL; trust Supabase for correctness

## Sub-Agents

This project includes specialized sub-agents in `.claude/agents/` for domain-specific tasks:

| Agent | When to Use |
|-------|-------------|
| `prompt-architect` | System prompt changes, character behavior, output format |
| `chat-engine-specialist` | AI provider changes, response optimization, tool calling |
| `intent-analyst` | Intent detection, mood calculation, tone analysis |
| `state-manager` | Supabase tables, caching, database queries |
| `relationship-dynamics` | Relationship tiers, milestones, user patterns |
| `presence-proactivity` | Idle breaker, open loops, ongoing threads, callbacks |
| `memory-knowledge` | Memory search, fact storage, conversation history |
| `external-integrations` | Google OAuth, Gmail, Calendar, ElevenLabs, APIs |
| `test-engineer` | Writing tests, fixing failures, coverage |

**Usage:** Sub-agents are automatically invoked based on task context, or explicitly via:
```
> Use the prompt-architect to add a new behavior section
```

**Location:** `.claude/agents/*.md` - Each file contains domain expertise and best practices.

**Note:** Restart Claude Code after adding new agents for them to be recognized.
