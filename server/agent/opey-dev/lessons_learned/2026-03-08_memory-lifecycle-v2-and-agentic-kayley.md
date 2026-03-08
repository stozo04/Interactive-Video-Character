# Lessons Learned — 2026-03-08

## Tickets / Topics Covered
- Memory Lifecycle V2 (Stage 1 shadow classifier)
- Kayley self-healing protocol + server restart mechanic
- Kayley agentic tool use (server logs, Google Drive)
- Tool retry loop in toolBridge.ts

---

## Memory Lifecycle V2 — What Was Built

### The Problem
`user_facts` and `character_facts` were full of transient/stale data being injected into every system prompt as durable truth. Examples: `current_activity = "getting a haircut"` (from Feb 28), `recent_meal` stored twice with different values, `build_mode`, `working_on`. Kayley was reading these as current truth months later.

### What Was Cleaned (2026-03-08 baseline)
- `user_facts`: 236 → 185 rows
- `character_facts`: 70 → 59 rows
- `fact_embeddings`: orphaned rows cascade-deleted
- **SECURITY ISSUE FOUND AND FIXED:** `kayley_email_password` was stored in plaintext in `character_facts`. Deleted. Never store credentials in memory tables.

### Stage 1 (Shadow Mode) — NOW LIVE
**`server/services/memoryClassifier.ts`** — new service:
- `classifyMemoryWrite(input)` → queries top 5 semantic candidates via `querySemanticFactEmbeddingMatches`, then calls Gemini (`gemini-2.0-flash`, temp 0.1) with combined classification + dedupe prompt
- Returns `ClassifierResult`: `memory_class`, `canonical_key`, `concept_id`, `decision`, `target_id`, `confidence`, `reason`
- `runClassifierShadow()` = fire-and-forget wrapper, logs to `server_runtime_logs`, zero write impact

**`server/services/ai/toolBridge.ts`** — hooked after successful writes:
- `store_user_info` → `runClassifierShadow({ domain: 'user', ... })`
- `store_self_info` / `store_character_info` → `runClassifierShadow({ domain: 'character', ... })`

**Validation SQL** (run this after Kayley stores any fact):
```sql
SELECT occurred_at, message, details
FROM server_runtime_logs
WHERE source = 'memoryClassifier'
ORDER BY occurred_at DESC LIMIT 10;
```

### Stage 2 — NOT YET BUILT (next session)
Gate writes BEFORE `executeMemoryTool` in `toolBridge.ts`. Decision routing:
- `reject` → skip write, return reason to Kayley
- `duplicate` → skip write silently
- `update_existing` → UPDATE the `target_id` row instead of INSERT
- `situational` / `episodic` → write to `user_memory_events` / `character_memory_events` (new tables — NOT YET CREATED, need migrations)

DB migrations needed for Stage 2:
- Add `memory_class text`, `concept_id text` columns to `user_facts` and `character_facts`
- Create `user_memory_events` and `character_memory_events` tables (see implementation guide)

**Gate for Stage 2:** Run shadow for ~1 week. Verify: situational/episodic caught, no false positives on durable facts, duplicates detected correctly. Then promote.

### Architecture Facts — Critical
- `factEmbeddingsService.ts` lives in `src/` but works server-side — uses `import.meta.env.VITE_GEMINI_API_KEY` which envShim loads. Does NOT use `import.meta.glob` so no server-side issue.
- `querySemanticFactEmbeddingMatches` was NEVER called anywhere before this session. Classifier is its first real caller.
- `recall_memory` uses plain ILIKE text search on `conversation_history`, NOT embeddings.
- `recall_user_info` does direct `getUserFacts(category)` table read, NOT embeddings.
- Embeddings sync is fire-and-forget after every successful fact write.
- Multiple embedding rows per fact are normal — conflict key is `(source_type, source_id, embedding_model, embedding_version)`.
- `fact_embeddings` cascade delete fix: `source_id` is `text`, `id` in facts tables is `uuid` — must cast: `source_id::uuid NOT IN (SELECT id FROM user_facts)`.

### Living Doc
`documents/memory-lifecycle-v2-implementation-guide.md` — updated this session. Single LLM call (not two), no concept registry in v1, staged rollout.

---

## Kayley Agentic Capabilities — Unlocked This Session

### server_runtime_logs awareness
Added `server_runtime_logs` to `query_database` tool's available tables list in `aiSchema.ts` and documented it in `toolsAndCapabilities.ts` section 18. Kayley can now run real SQL against live server logs.

**Proven working:** Kayley queried server_runtime_logs, returned real counts grouped by source matching Supabase ground truth.

### Google Drive (proven in production)
Kayley chained `workspace_action` (write local file) → `google_cli drive upload` completely unprompted. Created `tonight_log.txt` locally AND uploaded to Drive in one turn. First autonomous multi-tool chain in production.

### Self-Healing Protocol (section 19 in toolsAndCapabilities.ts)
- Up to 3 attempts before reporting back to Steven
- Investigate with `query_database` → `server_runtime_logs` first
- Server restart mechanic via tsx watch trigger files

### Server Restart Mechanic
- `server/restartTrigger.ts` — imported by `server/index.ts`
- `server/telegram/restartTrigger.ts` — imported by `server/telegram/index.ts`
- Both files are in tsx watch dependency graph. Writing to them triggers restart.
- `server/.restart-trigger` (dotfile) does NOT work — tsx watch only monitors the dependency graph, not arbitrary files. Deleted.
- `telegram:dev` npm script changed from plain `tsx` to `tsx watch` this session.

### Tool Retry Loop (toolBridge.ts)
`failureCount` closure variable in `createCallableTools()`. Persists across `callTool()` invocations within one turn, resets on new turn.
- Failures 1-2: tell Kayley attempts remaining + nudge to try differently
- Failure 3: hard stop — report back to Steven honestly, no more retrying
- `failureCount` also logged in `tool_call_summary` for observability.

---

## Gotchas & Traps

### tsx watch only monitors dependency graph
Writing to an arbitrary file (e.g., `server/.restart-trigger`) does NOT trigger tsx watch restart. The file must be `import`ed by the entry point. This is why `restartTrigger.ts` files were created and imported.

### fact_embeddings orphan cleanup needs cast
```sql
-- WRONG — type mismatch text vs uuid
DELETE FROM fact_embeddings WHERE source_id NOT IN (SELECT id FROM user_facts);
-- CORRECT
DELETE FROM fact_embeddings WHERE source_id::uuid NOT IN (SELECT id FROM user_facts);
```

### Memory analysis JSON was useless
`documents/data/memory_migration_analysis.json` (303KB) classified ALL 306 facts as durable. Zero situational/episodic, zero duplicates found. The analysis was done by an LLM that was too conservative. Ignore it. The actual cleanup was done manually via SQL pattern matching.

### Shadow mode hook goes in toolBridge.ts, not memoryService.ts
`memoryService.ts` is in `src/` and runs in both client and server contexts. The classifier needs server-side Gemini access. Hook in `toolBridge.ts` which is already server-only.

### Kayley fabricated health check on first test
When asked "check logs for any errors" vaguely, Kayley said everything was clean without calling any tool. Fabricated. Only used the tool when asked for a specific, concrete question ("what's the most active log source in the last 2 hours, give me top 3 with counts"). Lesson: vague health check prompts trigger hallucination; specific data prompts trigger tool use.

---

## What Future Sessions Should Do First

1. **Run the validation SQL** to check if shadow classifier is producing output:
```sql
SELECT occurred_at, message, details
FROM server_runtime_logs
WHERE source = 'memoryClassifier'
ORDER BY occurred_at DESC LIMIT 10;
```

2. **After ~1 week of shadow data** — review decisions. Are situational/episodic facts being caught? Are duplicates detected? Any false positives (durable facts misclassified)? If accuracy looks good, build Stage 2.

3. **Stage 2 entry point** — `toolBridge.ts`, intercept BEFORE `executeMemoryTool` for `store_user_info`/`store_self_info`/`store_character_info`. Use `ClassifierResult.decision` to route: reject, skip, update, or write to event tables.

4. **Read `documents/memory-lifecycle-v2-implementation-guide.md`** before any Stage 2 work.
