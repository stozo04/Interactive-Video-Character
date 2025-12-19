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
| `promptUtils.ts` (~3K lines) | Dynamic system prompt generation with conditional sections |
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

**Read `docs/System_Prompt_Guidelines.md` before modifying `promptUtils.ts`.**

Key principles:
1. **Code logic over prompt logic** - Pre-compute applicable rules in code, don't list all options for LLM to pick
2. **Conditional inclusion** - Use helper functions like `getTierBehaviorPrompt(tier)` to include only relevant sections
3. **Recency bias** - Critical output rules (JSON schema) must be at the END of the prompt
4. **Test-driven** - Every prompt change needs tests in `systemPrompt.test.ts`

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
