# Context Synthesis Architecture -- Living Knowledge Document

> **Status:** Phase 1 IMPLEMENTED (not yet merged). Phase 1b next. Phase 2 after that.
> **Last updated:** 2026-02-12, end of Phase 1 implementation session.

---

## PHASE 1 STATUS: COMPLETE (pending merge)

All code is written, compiles clean (`tsc --noEmit` + `vite build` pass), and has been through **two rounds of code review** with all findings resolved. Migrations have NOT been run against Supabase yet.

### What Was Built

**New files created:**
| File | Purpose |
|---|---|
| `supabase/migrations/20260213_context_synthesis.sql` | `context_synthesis` table (JSONB synthesis docs, schema versioning, source watermarks, explicit expiry) |
| `supabase/migrations/20260213_topic_exhaustion.sql` | `topic_exhaustion` table (mention tracking, cooldowns, user-override). Also expands `idle_action_log` CHECK constraint to include `synthesis`, `tool_discovery`, `x_post`, `x_mention_poll` |
| `src/services/topicExhaustionService.ts` | Topic mention tracking, cooldown management, suppression prompt section, frequency summary, topic seeding, post-turn extraction |
| `src/services/contextSynthesisService.ts` | Synthesis generation via Gemini, storage, staleness checking, invalidation, prompt section building, topic seeding from LLM output |

**Files modified:**
| File | Change |
|---|---|
| `src/services/system_prompts/builders/systemPromptBuilder.ts` | Added synthesis/fallback conditional path in `buildSystemPromptForNonGreeting()`. Feature flag `VITE_USE_CONTEXT_SYNTHESIS` (default ON, set `"false"` to disable). Synthesis path skips: curiosity, dailyNotes, milaMilestones, characterFacts, relationshipTier, storylines, proactiveStarters. Fallback path is identical to original behavior. `integrateAlmostMoments` only fetched in fallback branch. |
| `src/services/idleThinkingService.ts` | Added `"synthesis"` to `IdleActionType`, `SYNTHESIS_DAILY_CAP = 4`, `runSynthesisAction()` (includes `decayOldMentions`), `allowSynthesis` option. Priority scheduling: if synthesis is stale, it runs FIRST before random action selection. |
| `src/services/messageOrchestrator.ts` | Added fire-and-forget `extractAndRecordTopics()` call in post-processing phase. Zero latency impact. |
| `src/services/memoryService.ts` | Added fire-and-forget `invalidateSynthesis()` calls after successful `store_user_info` and `mila_note` writes. Uses dynamic `import()` to avoid circular deps. |

### Key Design Decisions Made During Implementation

1. **`checkSynthesisFreshness()` returns `{ stale, row }`** -- avoids double DB read on the hot path (prompt build). `isSynthesisStale()` is a simple boolean wrapper for idle thinking.
2. **`invalidateSynthesis()` expires ALL non-expired rows** (not just today's) -- handles post-midnight edge case where latest valid row is from previous date.
3. **Topic seeding uses LLM-labeled `seed_topics` field** -- the synthesis LLM outputs 10-20 canonical snake_case topic keys (e.g., `espresso_machine`, `valentines_day`). Quality filter rejects keys <4 chars, >40 chars, <2 words, >5 words, or starting with generic prefixes (`he_`, `she_`, `the_`, etc.).
4. **Suppression source of truth = live `topic_exhaustion` table**, NOT synthesis document. Synthesis `suppress_topics` are used for seeding only, not injected into prompt (avoids duplication).
5. **Feature flag default = ON** (`!== "false"`), matching the documented rollback contract. Set `VITE_USE_CONTEXT_SYNTHESIS=false` in `.env` for instant rollback.

### What Still Needs To Happen Before Merge

1. **Run migrations** on Supabase (`20260213_context_synthesis.sql` then `20260213_topic_exhaustion.sql`)
2. **Add `VITE_USE_CONTEXT_SYNTHESIS=true`** to `.env` (optional -- defaults ON, but explicit is better)
3. **Manual smoke test:**
   - Trigger synthesis manually (call `generateSynthesis()` from console)
   - Verify JSON stored in `context_synthesis` table
   - Verify prompt builder uses synthesis path (log: `"Using synthesis path"`)
   - Send a few messages, verify `topic_exhaustion` table populates
   - Delete synthesis row, verify fallback path kicks in (identical to old behavior)
4. **Monitor prompt token count** before/after (expect ~70% reduction in data sections)
5. **Run existing tests** (`npm test -- --run`) to verify no regressions

---

## THE PROBLEM (unchanged)

Kayley's system prompt dumps ALL raw data from 10+ Supabase tables (~600+ lines, ~4000+ tokens). This causes:
1. **Attention dilution** -- LLM can't prioritize; all 100+ facts have equal weight
2. **Topic exhaustion** -- Same topics resurface every conversation (espresso machine, Valentine's Day, Penelope plant)
3. **Known facts treated as new** -- Facts buried deep get surprise reactions
4. **No scene variety** -- Prompt examples act as templates

See "FAILURE MODE EXAMPLES" section below for detailed cases.

---

## ARCHITECTURE OVERVIEW

```
Raw Supabase Tables (unchanged)
        |
        v
[Synthesis Job] --LLM call--> context_synthesis table (JSONB document)
        |                            |
        v                            v
[Topic Exhaustion Tracker]    [System Prompt Builder]
  (post-turn updates)          reads synthesis OR falls back to raw dumps
```

**Three layers:**
- **Layer 1 (Static Shell):** Persona, rules, output format -- unchanged
- **Layer 2 (Synthesis Document):** Background job condenses all raw data into prioritized briefing (~600 tokens)
- **Layer 3 (Topic Exhaustion):** Lightweight tracker prevents repetitive topic surfacing

---

## SYNTHESIS DOCUMENT SCHEMA (v1)

```typescript
interface SynthesisDocument {
  relationship_pulse: string;      // 2-3 sentences on emotional state
  steven_right_now: string;        // current life context summary
  active_threads: Array<{ title: string; status: string }>;  // top 3 storylines
  suppress_topics: string[];       // topics to avoid initiating
  seed_topics: string[];           // 10-20 canonical topic labels for tracker bootstrap
  available_scenes: string[];      // 12 varied scene options
  priority_facts: Array<{ fact: string; reason: string }>;   // 10-15 most relevant
  emotional_register: string;      // tone guidance
  confidence_notes?: string[];     // uncertain fact flags
}
```

Stored in `context_synthesis` table with: `schema_version`, `source_watermarks` (for event-driven invalidation), `expires_at` (8h TTL), `generation_duration_ms`.

---

## TOPIC EXHAUSTION POLICY

- Cooldown triggers at **3+ AI-initiated mentions** within 7 days
- Default cooldown duration: **3 days**
- **User-initiated topics are NEVER suppressed** -- if Steven asks about Penelope, Kayley responds normally and the cooldown is lifted
- Mentions older than 7 days are decayed to 0
- Topic tracker is bootstrapped from synthesis `seed_topics` + `suppress_topics` output
- Post-turn extraction matches conversation text against tracked keys (no new key creation in Phase 1)

---

## CRITICAL FILE REFERENCE

### New Services
- **`src/services/contextSynthesisService.ts`** -- `generateSynthesis()`, `getLatestSynthesis()`, `checkSynthesisFreshness()`, `isSynthesisStale()`, `invalidateSynthesis()`, `buildSynthesisPromptSection()`
- **`src/services/topicExhaustionService.ts`** -- `recordTopicMention()`, `recordTopicMentions()`, `getSuppressedTopics()`, `getTopicFrequencySummary()`, `buildTopicSuppressionPromptSection()`, `decayOldMentions()`, `extractAndRecordTopics()`, `seedTopics()`

### Modified Files
- **`src/services/system_prompts/builders/systemPromptBuilder.ts`** -- `buildSystemPromptForNonGreeting()` has synthesis/fallback branching
- **`src/services/idleThinkingService.ts`** -- `runSynthesisAction()`, priority scheduling in `runIdleThinkingTick()`
- **`src/services/messageOrchestrator.ts`** -- post-turn `extractAndRecordTopics()` hook
- **`src/services/memoryService.ts`** -- `invalidateSynthesis()` calls in `store_user_info` and `mila_note`

### Existing Services Used
- `getUserFacts("all")` -- `src/services/memoryService.ts`
- `getCharacterFacts()` -- `src/services/characterFactsService.ts`
- `getActiveStorylines()` -- `src/services/storylineService.ts` (field is `.phase` not `.currentPhase`)
- `getPendingPromises()` -- `src/services/promiseService.ts`
- `getAllDailyNotes()` -- `src/services/memoryService.ts`
- `GoogleGenAI` / `@google/genai` -- same pattern as idle thinking

---

## WHAT THE SYNTHESIS REPLACES (AND WHAT STAYS)

### REPLACED by synthesis (when fresh synthesis exists):
| Section | Replaced By |
|---|---|
| `buildCuriositySection()` (all user facts dump) | `priority_facts` in synthesis |
| `buildDailyNotesPromptSection()` (today's note bullets) | Digested into synthesis |
| `buildMilaMilestonesPromptSection()` | Digested into synthesis |
| `formatCharacterFactsForPrompt()` | Digested into synthesis |
| `buildRelationshipTierPrompt()` | `relationship_pulse` + `emotional_register` |
| `getStorylinePromptContext()` | `active_threads` |
| `buildProactiveConversationStarters()` | `available_scenes` |
| `integrateAlmostMoments()` | Not fetched on synthesis path (perf optimization) |

### STAYS regardless (real-time or actionable, have IDs for tool calls):
- `KAYLEY_CONDENSED_PROFILE`, `buildAntiAssistantSection()`, `buildCurrentWorldContext()`
- `buildIdleBrowseNotesPromptSection()`, `buildToolSuggestionsPromptSection()`
- `buildXTweetPromptSection()`, `buildMentionsPromptSection()`
- `buildIdleQuestionPromptSection()`
- `buildOpinionsAndPushbackSection()`, `buildCurrentContextSection()`
- `buildPromisesContext()` (needs promise IDs)
- `buildSelfieRulesPrompt()`, `buildVideoRulesPrompt()`
- `getRecentNewsContext()`, `buildGoogleCalendarEventsPrompt()`
- `buildToolStrategySection()`, `buildStandardOutputSection()`

---

## REVIEW FINDINGS HISTORY

### Round 1 (10 findings -- all resolved):
1. Staleness not enforced on read path -> `buildSynthesisPromptSection()` now checks via `checkSynthesisFreshness()`
2. Event-driven invalidation not wired -> Added to `store_user_info` and `mila_note` in `memoryService.ts`
3. No topic bootstrap path -> Added `seedTopics()` + LLM `seed_topics` field
4. `invalidateSynthesis()` only expired today's row -> Now expires all active rows
5. Feature flag default wrong -> Changed to `!== "false"`
6. Duplicate suppression in prompt -> Removed from synthesis section; live table is source of truth
7. `confidence_notes` type mismatch -> Standardized to `string[]`
8. Weak frequency signal to synthesis -> Added `getTopicFrequencySummary()` with count/initiator/cooldown status
9. `integrateAlmostMoments` fetched unnecessarily -> Moved to fallback-only branch
10. Migration constraint drop unguarded -> Added `DO $$ IF EXISTS $$` guard with `table_schema = 'public'`

### Round 2 (3 findings -- all resolved):
1. Noisy topic seeding from priority_facts -> Replaced with LLM-labeled `seed_topics` + `isQualityTopicKey()` filter
2. Double DB read on hot path -> Refactored to `checkSynthesisFreshness()` returning `{ stale, row }`
3. Migration guard not schema-scoped -> Added `and table_schema = 'public'`

---

## PHASE 1b: CONVERSATION WORKING MEMORY ANCHOR (Next PR)

Identified by Codex review as critical for long-thread continuity. Fixes the "how did the mom call go?" intra-conversation failure.

**What it does:**
- New table: `conversation_anchor` -- short turn-local summary per conversation
- New service: `conversationAnchorService.ts`
- Updated every 3-5 turns or on sharp topic changes
- Carries: unresolved asks, active emotional context, pending commitments
- Injected into prompt AHEAD of synthesis (highest priority context)

**Not yet started. This is the next thing to build.**

---

## PHASE 2: PER-TURN RELEVANCE MATCHING (Future)

On each incoming user message, run a fast semantic match against stored facts and pull the top 5-7 most relevant. This is the "active recall" that mimics human cognition during conversation. Adds ~100-200ms latency per turn.

Start deterministic (lexical overlap + recency + confidence boost), evolve to semantic if needed.

---

## PHASE 3: OBSERVABILITY DASHBOARD (Future)

p50/p95 prompt tokens, snapshot freshness distribution, repeated-topic initiation rate, known-fact miss rate, continuity misses. Phase 1 logs basics (generation duration, token counts) but skips formal metrics infrastructure.

---

## FAILURE MODE EXAMPLES (reference)

### 1. Espresso Machine Repetition
Persona prompt contains example: "fighting with my espresso machine". Model pattern-matches to it every morning. No tracking of what scenes have been used.

### 2. Valentine's Day Beaten To Death
`valentines_day_preference` in user_facts + current date near Feb 14 = model surfaces it every conversation. No concept of topic exhaustion.

### 3. "Wait, Your Mom Is A CPA?!"
`mom_profession: "CPA"` buried 150+ lines deep in prompt. Attention diluted to near-zero. Model reacts to it as novel when user mentions it.

### 4. End-Of-Conversation Amnesia
Long conversations cause beginning to decay in attention. Kayley asks about something discussed in first messages. (Phase 1b target)

### 5. Penelope Plant Constant Topic
Appears in character_facts, daily_notes, user_facts. High combined attention weight with no exhaustion signal.

---

## KEY METRICS TO TRACK
- Prompt token count before/after synthesis (expect ~70% reduction in data sections)
- Synthesis generation duration (stored in `generation_duration_ms`)
- Topic exhaustion effectiveness (are repeated topics actually cooling down?)
- Qualitative: Does Kayley stop repeating espresso machine / Valentine's Day / Penelope?

---

## OPEN QUESTIONS
- Should the greeting prompt also use synthesis? (Currently: no, it's already lean)
- Should we expose a manual "refresh synthesis" trigger in the UI? (Nice-to-have for debugging)
- Should `expires_at` default be configurable via env var? (Currently hardcoded 8h)
