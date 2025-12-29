# Sub-Agent Usage Guide

> **Last Updated**: 2025-12-26
> **Purpose**: How to effectively use Claude Code sub-agents for this project
> **Context**: Lessons learned from implementing the Spontaneity System

---

## Overview

This project includes **10 specialized sub-agents** that provide domain-specific expertise. Each agent has deep knowledge of its domain and access to specific tools. This guide explains when and how to use each agent effectively.

---

## Agent Reference

### 1. `prompt-architect`

**Domain**: System prompt architecture, character behavior, output format

**When to Use**:
- Adding new prompt sections to `src/services/system_prompts/`
- Modifying character behavior or personality
- Changing output format or JSON schema
- Implementing conditional prompt inclusion

**Example Invocation**:
```
Use the prompt-architect to create a new spontaneity prompt section
```

**Key Skills**:
- Knows the modular prompt architecture
- Follows token efficiency patterns
- Creates tests alongside implementations
- Exports from barrel files correctly

**Files It Knows**:
- `src/services/system_prompts/` (all folders)
- `docs/System_Prompt_Guidelines.md`
- `src/services/promptUtils.ts`

---

### 2. `chat-engine-specialist`

**Domain**: AI providers, response optimization, tool calling, latency

**When to Use**:
- Integrating new features into the chat flow
- Optimizing response latency (<2s target)
- Adding new AI providers
- Modifying how responses are generated

**Example Invocation**:
```
Use the chat-engine-specialist to integrate spontaneity into the main chat flow
```

**Key Skills**:
- Understands the Fast Router pattern
- Knows how to run operations in parallel
- Can optimize for latency without blocking
- Integrates with `BaseAIService.ts`

**Files It Knows**:
- `src/services/BaseAIService.ts`
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
- AI provider files (Gemini, OpenAI, Grok)

---

### 3. `state-manager`

**Domain**: Supabase, caching, database operations, state persistence

**When to Use**:
- Creating new database tables
- Writing SQL migrations
- Implementing state tracking services
- Optimizing database queries
- Managing cache invalidation

**Example Invocation**:
```
Use the state-manager to create SQL migrations for the spontaneity tables
```

**Key Skills**:
- Writes proper SQL migrations
- Follows RLS (Row Level Security) patterns
- Implements caching with TTL
- Creates RPC functions for unified fetches

**Files It Knows**:
- `supabase/migrations/`
- `src/services/stateService.ts`
- `src/services/supabaseClient.ts`
- Cache-related patterns

---

### 4. `test-engineer`

**Domain**: Vitest, testing patterns, mocking, coverage

**When to Use**:
- Writing tests for new features (TDD approach)
- Fixing failing tests
- Improving test coverage
- Creating snapshot tests

**Example Invocation**:
```
Use the test-engineer to write comprehensive tests for the spontaneity tracker
```

**Key Skills**:
- Follows TDD (tests first, then implementation)
- Knows Vitest patterns (describe, it, expect)
- Creates proper mocks with `vi.mock()`
- Writes snapshot tests for prompts

**Files It Knows**:
- `src/services/tests/`
- `src/services/__tests__/`
- Existing test patterns in the codebase

---

### 5. `presence-proactivity`

**Domain**: Proactive behavior, idle breaker, open loops, callbacks

**When to Use**:
- Implementing features that trigger without user input
- Managing ongoing threads (mental weather)
- Creating idle thoughts or session reflections
- Handling user absence

**Example Invocation**:
```
Use the presence-proactivity agent to create the session reflection and idle thoughts system
```

**Key Skills**:
- Knows the presence director patterns
- Understands callback timing and decay
- Manages thread lifecycle
- Creates proactive conversation starters

**Files It Knows**:
- `src/services/presenceDirector.ts`
- `src/services/ongoingThreads.ts`
- Open loop tracking patterns

---

### 6. `relationship-dynamics`

**Domain**: Relationship tiers, milestones, user patterns, trust/warmth

**When to Use**:
- Modifying tier progression logic
- Adding new relationship milestones
- Implementing rupture/repair mechanics
- Tracking relationship dimensions

**Example Invocation**:
```
Use the relationship-dynamics agent to implement milestone-gated tier advancement
```

**Key Skills**:
- Knows tier behavior rules
- Understands dimension effects (warmth, trust, playfulness)
- Implements milestone detection
- Handles rupture penalties

**Files It Knows**:
- `src/services/relationshipService.ts`
- `src/services/system_prompts/relationship/`
- Relationship database tables

---

### 7. `intent-analyst`

**Domain**: Intent detection, mood analysis, tone detection, topics

**When to Use**:
- Analyzing user messages
- Detecting emotional signals
- Extracting conversation topics
- Calculating mood from context

**Example Invocation**:
```
Use the intent-analyst to create the association engine for topic matching
```

**Key Skills**:
- Knows the intent detection pipeline
- Understands mood calculation
- Implements topic similarity
- Works with semantic analysis

**Files It Knows**:
- `src/services/intentService.ts`
- Intent-related types and patterns
- Mood knob calculations

---

### 8. `external-integrations`

**Domain**: Google OAuth, Gmail, Calendar, ElevenLabs, external APIs

**When to Use**:
- Integrating external services
- Handling OAuth flows
- Working with email/calendar data
- Voice synthesis integration

**Example Invocation**:
```
Use the external-integrations agent to add calendar event integration
```

**Key Skills**:
- OAuth token management
- API error handling
- Rate limiting
- Data transformation

**Files It Knows**:
- Auth-related services
- Google API integrations
- External API patterns

---

### 9. `memory-knowledge`

**Domain**: Memory systems, semantic search, user facts, character facts, narrative arcs, dynamic relationships

**When to Use**:
- Storing/retrieving user facts or character facts
- Implementing semantic search
- Managing conversation history
- Working with embeddings
- Tracking Kayley's ongoing life events (narrative arcs)
- Managing Kayley's relationships with people in her life (dynamic relationships)

**Example Invocation**:
```
Use the memory-knowledge agent to improve fact retrieval for the prompt
```

**Key Skills**:
- Fact storage patterns (user_facts, character_facts, narrative arcs, dynamic relationships)
- Embedding-based search
- Memory consolidation
- Contradiction detection
- Narrative arc lifecycle management
- Dual-perspective relationship tracking (Kayley's view + user's view)

**Files It Knows**:
- `src/services/memoryService.ts`
- `src/services/narrativeArcsService.ts`
- `src/services/characterFactsService.ts`
- `src/services/dynamicRelationshipsService.ts`
- Fact-related database tables
- `kayley_narrative_arcs` table
- `kayley_people` + `user_person_relationships` tables
- Embedding patterns

---

### 10. `image-generation-specialist`

**Domain**: AI image generation, reference image selection, visual consistency

**When to Use**:
- Adding new reference images for selfies
- Modifying image selection scoring logic
- Implementing LLM-based context detection for images
- Optimizing selfie generation performance
- Debugging why certain references are selected

**Example Invocation**:
```
Use the image-generation-specialist to add a new reference image for athletic outfit
```

**Key Skills**:
- Multi-reference image system (6 references)
- LLM-based temporal detection (old vs current photo)
- Multi-factor scoring algorithm (8+ factors)
- Current look locking for consistency
- Anti-repetition with contextual exceptions
- Performance optimization via caching

**Files It Knows**:
- `src/services/imageGenerationService.ts`
- `src/services/imageGeneration/` (temporalDetection, contextEnhancer, referenceSelector, currentLookService)
- `src/utils/base64ReferenceImages/` (registry and base64 files)
- Database tables: `current_look_state`, `selfie_generation_history`

**Key Patterns**:
- **Never use regex for temporal detection** - Use LLM (Gemini Flash) instead
- **Lock current look for 24h** - Hairstyle stays consistent within a day
- **Allow same reference for same scene** - Don't penalize repetition if user is in the same location
- **Log full selection reasoning** - All scoring factors are logged for debugging

---

## Best Practices

### 1. Use Multiple Agents in Parallel

When tasks span multiple domains, launch agents in parallel:

```
I need to implement the Spontaneity System. Launch these agents in parallel:
1. state-manager - Create SQL migrations
2. test-engineer - Write tests first (TDD)
3. prompt-architect - Create prompt sections
```

### 2. Be Specific About Deliverables

Tell the agent exactly what you expect:

```
Use the test-engineer to write comprehensive tests for the spontaneity tracker.
Create tests for:
1. calculateSpontaneityProbability - 10+ test cases
2. trackMessage - edge cases for topic limits
3. buildSpontaneityContext - all fields populated

Write tests first (TDD). Do NOT implement the code yet.
```

### 3. Reference Existing Patterns

Point agents to existing code for consistency:

```
Use the state-manager to create a new service like moodKnobs.ts:
- Follow the caching pattern in moodKnobs.ts
- Use the same async function signatures
- Include cache invalidation on writes
```

### 4. TDD Workflow

For new features, use this workflow:

1. **Test-engineer first**: Write comprehensive tests
2. **Run tests**: Verify they fail (red phase)
3. **Implement**: Use appropriate agent to make tests pass
4. **Refactor**: Clean up if needed

### 5. Resuming Agents

Each agent returns an `agentId`. Use it to resume if needed:

```
Resume agent ae76e47 to add error handling to the prompt builder
```

---

## Common Patterns

### Creating a New Feature

1. **Plan**: Create implementation plan document
2. **Database**: `state-manager` creates SQL migrations
3. **Types**: Define TypeScript interfaces
4. **Tests**: `test-engineer` writes tests (TDD)
5. **Implementation**: Appropriate agent implements code
6. **Integration**: `chat-engine-specialist` wires into chat flow
7. **Documentation**: Update README and guidelines

### Adding a Prompt Section

1. **Prompt-architect**: Create the builder function
2. **Test-engineer**: Write prompt snapshot tests
3. **Chat-engine-specialist**: Wire into systemPromptBuilder
4. **Documentation**: Update System_Prompt_Guidelines.md

### Database Changes

1. **State-manager**: Create migration file
2. **State-manager**: Update stateService.ts
3. **State-manager**: Update RPC functions if needed
4. **Test-engineer**: Write integration tests

### Adding Reference Images

1. **Image-generation-specialist**: Add base64 file to `src/utils/base64ReferenceImages/`
2. **Image-generation-specialist**: Update registry with metadata (scenes, moods, frequency)
3. **Image-generation-specialist**: Adjust scoring weights if needed
4. **Test-engineer**: Write tests for reference selection
5. **Test actual generation**: Verify visual consistency

---

## Agent Limitations

- **No cross-domain awareness**: Agents don't see each other's work
- **Context window**: Complex tasks may need to be broken down
- **File access**: Agents can only read/write files (no browser, no network)
- **No persistence**: Each invocation starts fresh unless resumed

---

## Lessons from Spontaneity Implementation

### What Worked Well

1. **Parallel agent execution** - Launching 3 agents in parallel saved significant time
2. **TDD approach** - Tests caught edge cases early
3. **Specific prompts** - Detailed requirements led to better outputs
4. **Agent specialization** - Each agent excelled in its domain

### What to Avoid

1. **Vague prompts** - "Make it better" doesn't work
2. **Skipping tests** - TDD catches issues early
3. **Single agent for everything** - Use specialization
4. **Not reading existing code first** - Explore agent helps understand patterns

---

## Quick Reference

| Task | Agent | Key Command |
|------|-------|-------------|
| New prompt section | prompt-architect | "Create a new section for X" |
| SQL migration | state-manager | "Create tables for X" |
| Write tests first | test-engineer | "Write tests for X (TDD)" |
| Integration | chat-engine-specialist | "Wire X into the chat flow" |
| Proactive features | presence-proactivity | "Create idle/reflection for X" |
| Relationship logic | relationship-dynamics | "Implement tier progression" |
| Topic analysis | intent-analyst | "Create topic matching for X" |
| External APIs | external-integrations | "Integrate X API" |
| Memory/facts | memory-knowledge | "Improve fact retrieval" |
| Image generation | image-generation-specialist | "Add new reference image for X" |

---

## Related Documents

- [System Prompt Guidelines](./System_Prompt_Guidelines.md)
- [Tool Integration Checklist](./Tool_Integration_Checklist.md) - **NEW**: 8-step checklist for adding LLM tools
- [README - Sub-Agents Section](../README.md#claude-code-sub-agents)
- [Spontaneity Integration Guide](./Spontaneity_Integration_Guide.md)
- [Narrative Arcs Implementation Summary](./NARRATIVE_ARCS_IMPLEMENTATION_SUMMARY.md)
- [Narrative Arcs Service Documentation](../src/services/docs/NarrativeArcsService.md)
- [Dynamic Relationships Service Documentation](../src/services/docs/DynamicRelationshipsService.md)
- Agent definitions: `.claude/agents/*.md`
