# Sub-Agents Implementation Plan

This document outlines the optimal sub-agents to create for the Interactive Video Character project based on analysis of the `src/services/` architecture.

## Overview

The codebase has **9 logical service domains** that map well to specialized sub-agents. Each sub-agent will be hyper-specialized in its domain, understanding the patterns, dependencies, and best practices specific to that area.

---

## Recommended Sub-Agents

### 1. `chat-engine-specialist`

**Domain:** Core AI Provider Architecture

**Files Covered:**
- `BaseAIService.ts` (628 lines) - Core orchestration
- `geminiChatService.ts` - Gemini provider
- `chatGPTService.ts` - OpenAI provider
- `grokChatService.ts` - XAI provider
- `mockChatService.ts` - Testing mock
- `aiService.ts` - Interfaces
- `aiSchema.ts` - Zod response validation

**Expertise:**
- Fast Router pattern (parallel intent + context fetch)
- Provider abstraction via `IAIChatService` interface
- Response streaming and JSON extraction
- Tool/function calling integration
- Idle breaker triggering logic
- Target <2s response times

**When to Use:**
> Adding new AI providers, modifying response flow, optimizing chat latency, implementing new tool calls

---

### 2. `prompt-architect`

**Domain:** System Prompt Architecture

**Files Covered:**
- `system_prompts/` (entire module)
  - `builders/` - Main assembly functions
  - `core/` - Identity, anti-assistant rules
  - `behavior/` - Behavioral guidance
  - `relationship/` - Tier-based behavior
  - `soul/` - Soul layer, presence
  - `context/` - Dynamic context injection
  - `features/` - Selfie rules, etc.
  - `tools/` - Tool usage instructions
  - `format/` - Output formatting, JSON schema
- `promptUtils.ts` - Barrel file

**Expertise:**
- Modular prompt architecture (single-responsibility files)
- Conditional inclusion patterns
- Recency bias (critical rules at END)
- Snapshot testing for prompt changes
- Code logic over prompt logic principle

**When to Use:**
> Modifying character behavior, adding new prompt sections, changing output format, relationship tier rules

**Special Instructions:**
- Always run `npm test -- --run -t "snapshot"` after changes
- Follow `docs/System_Prompt_Guidelines.md`

---

### 3. `intent-analyst`

**Domain:** Intent Detection & Semantic Analysis

**Files Covered:**
- `intentService.ts` (~81KB) - LLM-based intent detection
- `messageAnalyzer.ts` - Orchestrates all analysis
- `moodKnobs.ts` (~37KB) - Mood → behavior parameters

**Expertise:**
- `FullMessageIntent` structure (tone, topics, genuine moments, open loops, signals)
- Fast-path bypass for functional commands (`isFunctionalCommand()`)
- Gemini Flash for cheap/fast intent calls
- Emotional momentum calculation
- Intensity-based mood updates

**When to Use:**
> Adding new intent types, modifying tone detection, optimizing intent caching, mood calculation changes

---

### 4. `state-manager`

**Domain:** State Persistence & Caching

**Files Covered:**
- `stateService.ts` - Central CRUD operations
- `cacheService.ts` - 30s TTL caching layer
- `supabaseClient.ts` - Client initialization

**Expertise:**
- Supabase as single source of truth
- 30s TTL cache strategy
- Tables: `mood_states`, `emotional_momentum`, `ongoing_threads`, `intimacy_states`
- `getFullCharacterContext()` RPC for unified fetch
- Cache invalidation on writes

**When to Use:**
> Adding new state tables, modifying cache strategy, optimizing DB queries, new RPC functions

---

### 5. `relationship-dynamics`

**Domain:** Relationship Tracking & Social Dynamics

**Files Covered:**
- `relationshipService.ts` (~42KB) - Metrics, scoring, rupture detection
- `relationshipMilestones.ts` - Key moments tracking
- `userPatterns.ts` - Cross-session behavioral patterns

**Expertise:**
- 6 relationship tiers (stranger → soulmate)
- Warmth/trust/playfulness dimensions
- Rupture detection and repair
- Milestone unlocking (first vulnerability, anniversaries)
- Pattern detection (3+ observations, 7+ days apart)

**When to Use:**
> Modifying tier thresholds, adding new milestones, pattern detection logic, relationship events

---

### 6. `presence-proactivity`

**Domain:** Proactive Behavior & Mental Weather

**Files Covered:**
- `presenceDirector.ts` (~40KB) - Open loops, opinions
- `ongoingThreads.ts` (~18KB) - Mental weather (3-5 thoughts)
- `loopCleanupService.ts` (~18KB) - Loop maintenance
- `callbackDirector.ts` (~25KB) - Micro-memory callbacks
- `prefetchService.ts` - Idle prefetching

**Expertise:**
- 4-tier idle breaker priority system
- Loop salience scoring and expiration
- Fuzzy duplicate detection
- Callback selection (1 per 6-10 exchanges)
- Thread decay and refresh logic

**When to Use:**
> Modifying idle breaker logic, loop cleanup rules, callback frequency, proactive thread selection

---

### 7. `memory-knowledge`

**Domain:** Memory & Knowledge Systems

**Files Covered:**
- `memoryService.ts` (~39KB) - Semantic search, user facts
- `characterFactsService.ts` - Kayley's emergent facts
- `conversationHistoryService.ts` - Chat persistence

**Expertise:**
- Semantic memory search via embeddings
- User fact detection and storage
- Character fact emergence
- `executeMemoryTool()` for provider integration
- Conversation history pagination

**When to Use:**
> Adding new memory types, modifying fact detection, search optimization, history management

---

### 8. `external-integrations`

**Domain:** External API Integrations

**Files Covered:**
- `googleAuth.ts` - OAuth2 flow
- `gmailService.ts` - Gmail API v1
- `calendarService.ts` - Calendar API v3
- `calendarCheckinService.ts` - Smart check-ins
- `elevenLabsService.ts` - Text-to-speech
- `imageGenerationService.ts` - Selfie generation
- `newsService.ts` - Hacker News API

**Expertise:**
- OAuth2 token refresh patterns
- Gmail batch API operations
- Calendar event CRUD
- Proactive calendar check-ins (day before, approaching, post-event)
- ElevenLabs voice synthesis
- Rate limiting and error handling

**When to Use:**
> Adding new integrations, fixing OAuth issues, calendar/email features, TTS improvements

---

### 9. `test-engineer`

**Domain:** Testing & Quality Assurance

**Files Covered:**
- `src/services/tests/` - All test files
- `src/services/__tests__/` - Additional tests
- Snapshot tests for prompts

**Expertise:**
- 554+ existing tests
- Vitest configuration
- Snapshot testing for prompts
- Mocking patterns for services
- Coverage requirements

**When to Use:**
> Writing new tests, fixing failing tests, improving coverage, test refactoring

---

## Sub-Agent Priority

Based on complexity and frequency of changes:

| Priority | Sub-Agent | Rationale |
|----------|-----------|-----------|
| **P0** | `prompt-architect` | Most frequently modified, high impact |
| **P0** | `chat-engine-specialist` | Core flow, performance-critical |
| **P1** | `intent-analyst` | Complex LLM integration |
| **P1** | `presence-proactivity` | Complex state management |
| **P2** | `relationship-dynamics` | Intricate scoring logic |
| **P2** | `memory-knowledge` | Growing complexity |
| **P3** | `state-manager` | Stable, well-defined |
| **P3** | `external-integrations` | Modular, isolated |
| **P3** | `test-engineer` | Support role |

---

## Implementation Steps

### Phase 1: Create Directory Structure

```bash
mkdir -p .claude/agents
```

### Phase 2: Create P0 Sub-Agents

1. Create `.claude/agents/prompt-architect.md`
2. Create `.claude/agents/chat-engine-specialist.md`

### Phase 3: Create P1 Sub-Agents

3. Create `.claude/agents/intent-analyst.md`
4. Create `.claude/agents/presence-proactivity.md`

### Phase 4: Create P2-P3 Sub-Agents

5. Create remaining sub-agents as needed

### Phase 5: Test & Iterate

- Test each sub-agent with explicit invocation
- Refine system prompts based on results
- Commit to version control

---

## Sub-Agent File Template

Each sub-agent follows this structure:

```markdown
---
name: agent-name
description: One-line description. Use proactively for [domain] tasks.
tools: Read, Edit, Bash, Write, Glob, Grep
model: sonnet
---

You are a [domain] specialist for the Interactive Video Character project.

**Your Domain:**
[List of files you own]

**Key Patterns:**
[Critical patterns and conventions]

**Best Practices:**
[Domain-specific best practices]

**Anti-Patterns to Avoid:**
[Common mistakes to prevent]

**Testing Requirements:**
[Relevant test commands]
```

---

## Cross-Agent Dependencies

Some tasks require multiple sub-agents:

| Task | Primary Agent | Supporting Agents |
|------|---------------|-------------------|
| Add new AI provider | `chat-engine-specialist` | `prompt-architect`, `test-engineer` |
| New relationship tier | `relationship-dynamics` | `prompt-architect`, `presence-proactivity` |
| Add external API | `external-integrations` | `state-manager`, `test-engineer` |
| Modify idle breaker | `presence-proactivity` | `chat-engine-specialist` |

---

## Success Metrics

After implementing sub-agents:

1. **Context Efficiency** - Each sub-agent operates with clean, focused context
2. **Specialization Quality** - Responses demonstrate deep domain knowledge
3. **Reduced Errors** - Fewer cross-domain mistakes
4. **Team Reusability** - Sub-agents can be shared via `.claude/agents/` in git

---

## Next Steps

1. Review this plan
2. Start with P0 sub-agents (`prompt-architect`, `chat-engine-specialist`)
3. Test with explicit invocation: "Use the prompt-architect to..."
4. Iterate on system prompts based on results
5. Add remaining sub-agents incrementally
