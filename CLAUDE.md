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
| `moodKnobs.ts` | KayleyMood (energy, warmth, genuineMoment) from mood state |
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
import type { KayleyMood } from "../../moodKnobs";

export function buildNewBehaviorSection(mood: KayleyMood): string {
  // KayleyMood has: energy (-1 to 1), warmth (0 to 1), genuineMoment (boolean)
  const isLowEnergy = mood.energy < 0;
  return `
====================================================
NEW BEHAVIOR GUIDANCE
====================================================
${isLowEnergy ? "Keep it brief - you're tired." : ""}
`;
}

// Then in behavior/index.ts, add:
export { buildNewBehaviorSection } from "./newBehavior";

// Then in builders/systemPromptBuilder.ts, import and use:
prompt += buildNewBehaviorSection(soulContext.moodKnobs); // KayleyMood
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

## ⚠️ CRITICAL: Adding New LLM Tools

> **WARNING**: Skipping steps in the Tool Integration Checklist will cause type errors and runtime failures!
>
> When adding a new tool that the AI can call (like `manage_narrative_arc` or `manage_dynamic_relationship`), you **MUST** follow the **8-step integration checklist** in order. **DO NOT SKIP ANY STEPS.**

### 📋 Required Reading

**STOP! Read this first**: [`docs/Tool_Integration_Checklist.md`](docs/Tool_Integration_Checklist.md)

The checklist provides detailed examples and explanations for each step.

### The 8 Critical Integration Points

**Complete ALL 8 steps in order:**

1. **`memoryService.ts`** - Add to `MemoryToolName`, `ToolCallArgs`, and `executeMemoryTool()` switch
2. **`aiSchema.ts`** - Add to `GeminiMemoryToolDeclarations` array
3. **`aiSchema.ts`** - Add to `MemoryToolArgs` union type ⚠️ **CRITICAL - DON'T FORGET**
4. **`aiSchema.ts`** - Add to `PendingToolCall.name` union type ⚠️ **CRITICAL - DON'T FORGET**
5. **`aiSchema.ts`** - Add to `OpenAIMemoryToolDeclarations` (if using OpenAI)
6. **`toolsAndCapabilities.ts`** - Add documentation with examples
7. **`systemPromptBuilder.ts`** - Add context injection (if needed)
8. **Snapshot Tests** - Run `npm test -- --run -t "snapshot" -u`

### ❌ Common Mistakes That WILL Break Your Code

- **Forgetting step 3 (`MemoryToolArgs`)** → TypeScript errors, tool args not validated
- **Forgetting step 4 (`PendingToolCall.name`)** → Runtime failures, tool calls silently fail
- **Skipping step 8 (snapshot updates)** → All tests fail, CI blocks merge
- **Wrong order** → Cascading errors that are hard to debug

### ✅ How to Verify Success

After completing all 8 steps:
```bash
# 1. Check types compile
npm run build

# 2. Run tests
npm test -- --run

# 3. Test the tool manually
npm run dev
# → Trigger the tool in conversation and verify it works
```

If any step fails, review the checklist and ensure you completed ALL 8 steps.

## ⚠️ CRITICAL: Creating New Services

> **IMPORTANT**: When creating a new service, you **MUST** follow this complete checklist to ensure proper documentation and integration.

### 📋 The Complete New Service Checklist

**Complete ALL steps when creating a new service:**

#### 1. Implementation

1. **Create service file** - `src/services/yourNewService.ts`
   - Follow existing patterns (see `characterFactsService.ts` as reference)
   - Include proper TypeScript types
   - Export all public functions
   - Use Supabase for data persistence

2. **Create tests** - `src/services/tests/yourNewService.test.ts`
   - Follow TDD approach (write tests first)
   - Use Vitest with proper mocking
   - Cover all core functions
   - Run: `npm test -- --run -t "yourNewService"`

3. **Create migration** - `supabase/migrations/create_your_tables.sql`
   - Include proper indexes
   - Add foreign keys where needed
   - Include seed data if applicable
   - **DO NOT apply** - let user apply manually

#### 2. Tool Integration (If Needed)

If the service needs LLM tools (e.g., `store_character_info`), follow the **8-step Tool Integration Checklist** (see section above).

#### 3. System Prompt Integration

1. **Import in systemPromptBuilder.ts**
   ```typescript
   import { formatYourDataForPrompt } from '../yourNewService';
   ```

2. **Add to parallel fetching array**
   ```typescript
   const [soulContext, characterFacts, yourNewData] = await Promise.all([...]);
   ```

3. **Inject into prompt**
   ```typescript
   ${yourNewDataPrompt}
   ```

#### 4. Documentation (CRITICAL - Don't Skip!)

1. **Create service documentation** - `src/services/docs/YourNewService.md`
   - Follow pattern from existing service docs
   - Include: Overview, Schema, Functions, LLM Tools, Examples, Troubleshooting
   - See existing service docs in `src/services/docs/` for structure

2. **Update service docs hub** - `src/services/docs/README.md`
   - Add link to your new service doc under appropriate category

3. **Update sub-agent** - `.claude/agents/memory-knowledge.md` (or appropriate agent)
   - Add service file to "Files It Owns"
   - Add service description to "Capabilities"
   - Add key functions and patterns
   - Update "Common Tasks" table

4. **Update sub-agent usage guide** - `docs/Sub_Agent_Usage_Guide.md`
   - Add service to agent's "Files It Knows"
   - Add capabilities to "Key Skills"
   - Add reference to new service doc in "Related Documents"

5. **Create implementation summary** (optional but recommended)
   - `docs/Phase_X_Implementation_Summary.md`
   - Include: Overview, What Was Implemented, Files Modified, User Flow Examples
   - Useful for future reference and onboarding

#### 5. Verification

```bash
# 1. Check types compile
npm run build

# 2. Run all tests
npm test -- --run

# 3. Update snapshots if needed
npm test -- --run -t "snapshot" -u

# 4. Verify documentation links work
```

### 📚 Examples to Follow

**Good Examples:**
- `src/services/characterFactsService.ts` - Kayley's emergent facts about herself
- `src/services/memoryService.ts` - Semantic search and user facts
- `src/services/intentService.ts` - Message intent detection

**Documentation Pattern:**
```markdown
# Service Name

**File:** `src/services/yourService.ts`
**Table:** `your_table_name`
**Purpose:** What this service does

## Overview
## Table Schema
## Service Functions
## LLM Tool Integration (if applicable)
## System Prompt Integration
## Use Cases
## Design Decisions
## Testing
## Common Patterns
## Performance Considerations
## Troubleshooting
## Summary
```

### ❌ Common Documentation Mistakes

- **Creating service but not documenting it** → Future developers (and you) won't know how it works
- **Skipping sub-agent updates** → Agent won't have domain knowledge when needed
- **Not updating README.md** → Service is hidden, hard to discover
- **No implementation summary** → Context is lost, hard to remember decisions later
- **Incomplete examples** → Users don't know how to use the service

### ✅ How to Know You're Done

Checklist complete when:
- ✅ Service file created with all functions
- ✅ Tests written and passing
- ✅ Migration file created (user will apply)
- ✅ Tool integration complete (if needed)
- ✅ System prompt integration complete
- ✅ Service documentation created in `src/services/docs/`
- ✅ `src/services/docs/README.md` updated
- ✅ Appropriate sub-agent updated
- ✅ `docs/Sub_Agent_Usage_Guide.md` updated
- ✅ Implementation summary created (recommended)
- ✅ All tests pass
- ✅ Build succeeds

If any item is missing, the service implementation is **NOT COMPLETE**.

## File Organization

```
src/
├── components/      # React UI components
├── services/        # Business logic (AI providers, state, prompts)
│   └── docs/        # Technical service documentation
├── contexts/        # React Context (auth, AI service selection)
├── hooks/           # Custom hooks (caching, media queues)
├── domain/          # Domain models (characters, relationships)
└── utils/           # Utilities

supabase/migrations/ # Database schema (15+ migrations)

docs/
├── features/        # Complete feature documentation (production-ready)
├── plans/           # Implementation plans (work in progress)
├── bugs/            # Active bug reports (unresolved)
├── archive/         # Historical docs (resolved bugs, deprecated features)
└── *.md             # General documentation (guides, processes)
```

**Key Documentation:**
- **`docs/features/`** - Comprehensive docs for completed features
- **`docs/Kayley_Thinking_Process.md`** - How Kayley processes information
- **`docs/System_Prompt_Guidelines.md`** - System prompt architecture
- **`.claude/agents/`** - Sub-agent domain expertise

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
