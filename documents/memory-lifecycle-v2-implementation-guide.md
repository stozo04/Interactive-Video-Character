# Memory Lifecycle V2 Implementation Guide

## Who This Is For
This guide is for a junior developer implementing a robust memory system for:
- `user_facts` (facts about Steven)
- `character_facts` (facts about Kayley)

The goal is to stop stale/duplicate memory behavior and make memory feel intentional and human.

---

## Why We Need This

Current problems:
- Transient facts are treated as permanent facts.
- Similar facts are duplicated under different keys.
- Key naming is inconsistent (`current_activity` vs `user_current_activity`).
- Prompt sections treat all stored facts as equally durable.

Real impact:
- Kayley asks about old/stale context as if it is still true.
- Memory quality degrades over time.
- Trust drops.

---

## Design Principles

1. LLM-first classification and normalization
- Use a single LLM call to classify memory type, normalize keys/values, and resolve duplicates.
- Avoid giant hardcoded rule trees.
- Avoid over-engineering: let real patterns emerge before adding registry layers.

2. Deterministic guardrails for safety
- Only use hard rules for:
  - immutable eligibility
  - write constraints
  - TTL enforcement

3. Separate memory by lifecycle
- A fact can be true now without being true forever.

4. No automatic promotion to immutable
- Repetition can promote to durable, never to immutable.

---

## Target Memory Model

Use four classes:
- `immutable`: core identity anchors; closed allowlist only
- `durable`: long-term but editable
- `situational`: valid for a short period
- `episodic`: one-off events/snapshots

### Examples
- `birthday` -> immutable
- `favorite_color_on_kayley` -> durable
- `build_mode` -> situational
- `recent_meal` -> episodic

---

## Immutable Policy (Critical)

Immutable facts must come from explicit user statements and approved concept IDs.

### User immutable allowlist (v1)
- `identity.birth_date`
- `identity.legal_name` (optional; include only if product wants this immutable)

### Character immutable allowlist (v1)
- Default: empty for `character_facts`
- Reason: Kayley core identity should live in profile files (`SOUL.md`, `IDENTITY.md`), not emergent memory rows.

### Hard rule
- If LLM returns `memory_class = immutable` for non-allowlisted concept:
  - downgrade to `durable` or reject
  - never write into immutable storage

---

## Data Model Changes

## 1) Keep existing tables for durable/immutable
- `user_facts`
- `character_facts`

Add columns to both tables:
- `concept_id text null` (canonical semantic key, ex: `context.current_activity`)
- `memory_class text not null default 'durable'`
- `is_immutable boolean not null default false`

Add constraints:
- `memory_class in ('immutable','durable')` for these two tables
- `is_immutable = true` only when `memory_class = 'immutable'`

## 2) Add short-term event tables
- `user_memory_events`
- `character_memory_events`

Fields:
- `id uuid`
- `category text`
- `concept_id text`
- `fact_key text`
- `fact_value text`
- `memory_class text` (`situational` or `episodic`)
- `confidence numeric`
- `observed_at timestamptz`
- `last_seen_at timestamptz`
- `expires_at timestamptz`
- `status text` (`active`/`expired`)
- `source_message_id uuid null`
- `created_at`, `updated_at`

Indexes:
- `(status, expires_at)`
- `(concept_id, status)`

---

## LLM Contract (Single Call)

**One structured LLM call per write** — combines classification, key normalization, and duplicate detection into a single round-trip. Two separate LLM calls (classifier + dedupe resolver) would double write latency on every memory operation; this is not acceptable for a mid-conversation fire-and-forget path.

Input:
- message snippet
- proposed `{category, key, value}`
- top semantic candidates from embeddings (passed in, not fetched inside the LLM call)

Output JSON:
```json
{
  "memory_class": "immutable|durable|situational|episodic|reject",
  "canonical_category": "identity|preference|relationship|context|quirk|experience|detail|other",
  "canonical_key": "string",
  "concept_id": "string",
  "normalized_value": "string",
  "ttl_hours": 0,
  "decision": "create_new|update_existing|merge_existing|duplicate|reject",
  "target_id": "uuid-or-null",
  "reason": "string",
  "confidence": 0.0
}
```

Why merged:
- Classification context directly informs deduplication — splitting them forces the second call to re-derive context the first call already had.
- Halves per-write LLM cost.
- Simpler to test and observe — one input, one output, one decision log row.

---

## Write Pipeline (Both User and Character)

Apply this for:
- `memoryService.ts` (`store_user_info`)
- `characterFactsService.ts` (`storeCharacterFact` path)

Step-by-step:
1. Receive proposed fact.
2. Query semantic candidates from embeddings (`fact_embeddings`, nearest matches).
3. Call single Memory LLM (classifier + dedupe combined).
4. Apply guardrails:
   - immutable allowlist check
   - class validity check
5. Execute write action:
   - immutable/durable → facts table (`user_facts` or `character_facts`)
   - situational/episodic → event table
   - duplicate/reject → skip write
6. Upsert embeddings for whichever table received the write.
7. Log decision metadata (`reason`, `decision`, `memory_class`, `confidence`) for observability.

---

## Key Normalization Strategy

The LLM call is responsible for normalizing keys and assigning `concept_id`. No separate concept registry table in v1.

Rule:
- LLM normalizes keys using canonical patterns in its system prompt (e.g., `context.current_activity`, `identity.birth_date`).
- If a close semantic match exists in the embedding candidates, prefer the existing key.
- Only coin a new `concept_id` when no close match exists.

Why no registry table in v1:
- A registry table requires maintenance and becomes hardcoded rules by another name.
- Real concept patterns should emerge from observed data before being codified.
- Revisit in v2 once real key distributions are visible in the telemetry.

---

## Prompt Retrieval Rules

Update prompt builders so memory classes are separated:

1. Durable/Immutable context
- Used in "what you know about user/character".
- Safe as long-term truth.

2. Recent context block
- Pull from active, non-expired `*_memory_events`.
- Label clearly as short-term context.

3. Never mix recent context into immutable framing
- This prevents stale assumptions in curiosity prompts.

Target files:
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
- Any builder injecting character facts directly into core identity sections

---

## Pruning Existing Data (Required — Do Last)

**Do not run this migration until the new write pipeline has been live for at least one week and is proven stable.**

Do this for both `user_facts` and `character_facts`.

Important:
- DELETE privileges are revoked for anon/authenticated in protected tables.
- Use service-role/admin path for cleanup jobs.

## Phase 0: Backup First
- Export snapshots of:
  - `user_facts`
  - `character_facts`
  - `fact_embeddings` (for replay if needed)

## Phase 1: Detect suspicious rows
Find transient-like facts currently in durable tables:
- keys containing `current`, `recent`, `today`, `now`, `tonight`
- values containing explicit "today/right now/this morning/etc."

## Phase 2: LLM reclassification batch
For each row:
1. classify with Memory LLM (same single call as write pipeline)
2. if class is situational/episodic:
   - move to event table with TTL
   - remove from durable table
3. if class remains durable/immutable:
   - keep and normalize concept/key/value

## Phase 3: Semantic dedupe + key canonicalization
For remaining durable rows:
1. group by semantic similarity
2. choose canonical survivor row
3. merge or update duplicates
4. write consistent `concept_id` and canonical key

## Phase 4: Rebuild embeddings
- Re-upsert embeddings for all surviving rows and active events.

## Phase 5: Validate
- No transient classes in durable tables.
- No duplicate concept IDs per domain/category.
- Prompt preview no longer shows stale "current activity" as durable truth.

---

## Cron Jobs (Lifecycle Hygiene)

Add scheduler jobs:

1. Every 6 hours
- mark expired events (`status = expired`)

2. Daily (2:30 AM CST)
- purge expired events older than 2 days

3. Weekly (Sunday 3:00 AM CST)
- run promotion analysis:
  - repeated episodic patterns can promote to durable
  - never auto-promote to immutable

4. Weekly audit report
- counts by class
- top duplicates merged
- top promoted concepts
- rejected writes

Use existing scheduler architecture in:
- `server/scheduler/cronScheduler.ts`

---

## Rollout Plan (Safe)

## Stage 1: Shadow mode (no write impact) — prove classification first
- Run the Memory LLM in parallel on every write, log decisions only.
- Do NOT write to new tables yet.
- Compare classification output with current behavior for 3-7 days.
- Gate on: classification accuracy looks correct, no runaway rejections, confidence distribution is healthy.

## Stage 2: Soft enforce
- Write to new event tables for situational/episodic.
- Keep old durable writes unchanged.
- Log conflicts and mismatches.

## Stage 3: Full enforce
- Route all writes by class strictly.
- Update prompt retrieval to class-aware mode.

## Stage 4: Cleanup (run last)
- Execute one-time pruning migration (Phases 0-5 above).
- Backfill and verify embeddings.

---

## Junior Developer Checklist

1. Create DB migrations:
- table/column changes + constraints + indexes

2. Build single Memory LLM service:
- combined classifier + dedupe resolver in one call
- system prompt must include canonical key pattern examples

3. Integrate write paths:
- `store_user_info`
- `storeCharacterFact`

4. Add class-aware retrieval:
- system prompt builders

5. Add cron hygiene handlers:
- expire/purge/promote/audit

6. Build one-time prune job (last):
- reclassify + move + dedupe + embedding refresh

7. Add telemetry:
- decision counts, duplicate prevention, stale-memory incidents

8. Run staged rollout:
- shadow (prove it) → soft → full → cleanup

---

## Success Criteria

You are done when:
- Kayley stops using stale short-term context as long-term truth.
- Duplicate semantic facts collapse into a single canonical concept.
- Immutable memory only contains allowlisted identity anchors.
- Both `user_facts` and `character_facts` follow the same lifecycle model.
- Prompt quality feels stable, fresh, and consistent over weeks.
