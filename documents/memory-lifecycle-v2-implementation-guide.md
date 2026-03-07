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
- Use an LLM to classify memory type and normalize keys/values.
- Avoid giant hardcoded rule trees.

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
- `canonical_key text null` (optional if keeping existing `fact_key`)
- `normalized_value text null` (optional)

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
- full text / embedding hooks as needed

---

## LLM Contracts

Implement two structured LLM calls.

## A) Memory Classifier
Input:
- message snippet
- proposed `{category,key,value}`
- known concept registry

Output JSON:
```json
{
  "memory_class": "immutable|durable|situational|episodic|reject",
  "canonical_category": "identity|preference|relationship|context|quirk|experience|detail|other",
  "canonical_key": "string",
  "concept_id": "string",
  "normalized_value": "string",
  "ttl_hours": 0,
  "reason": "string",
  "confidence": 0.0
}
```

## B) Semantic Dedupe Resolver
Input:
- normalized candidate
- top semantic matches from embeddings

Output JSON:
```json
{
  "decision": "duplicate|update_existing|merge_existing|create_new|reject",
  "target_id": "uuid-or-null",
  "canonical_key": "string",
  "concept_id": "string",
  "normalized_value": "string",
  "reason": "string"
}
```

---

## Write Pipeline (Both User and Character)

Apply this for:
- `memoryService.ts` (`store_user_info`)
- `characterFactsService.ts` (`storeCharacterFact` path)

Step-by-step:
1. Receive proposed fact.
2. Call Memory Classifier LLM.
3. Apply guardrails:
   - immutable allowlist check
   - class validity check
4. Query semantic candidates:
   - use embeddings service (`fact_embeddings`) for nearest matches
5. Call Dedupe Resolver LLM.
6. Execute write action:
   - immutable/durable -> facts table (`user_facts` or `character_facts`)
   - situational/episodic -> event table
   - duplicate/reject -> skip write
7. Upsert embeddings for whichever table received the write.
8. Log decision metadata (`reason`, `decision`, `memory_class`) for observability.

Why:
- Keeps logic compact and robust.
- Prevents key drift and semantic duplicates.
- Guarantees lifecycle correctness.

---

## Prompt Retrieval Rules

Update prompt builders so memory classes are separated:

1. Durable/Immutable context
- Used in “what you know about user/character”.
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

## Key Standardization Strategy

Create a small concept registry:
- `memory_concepts` (or two registries by domain)

Columns:
- `domain` (`user`/`character`)
- `canonical_key`
- `concept_id`
- `allowed_categories`
- `immutable_eligible boolean`
- `description`

Rule:
- LLM should map to existing registry entries first.
- Only create new concept keys when no close match exists.

Why:
- Stops accidental “new key by wording/order change”.

---

## Pruning Existing Data (Required)

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
- values containing explicit “today/right now/this morning/etc.”

## Phase 2: LLM reclassification batch
For each row:
1. classify with Memory Classifier
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
- Prompt preview no longer shows stale “current activity” as durable truth.

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

## Stage 1: Shadow mode (no write impact)
- Run classifier/dedupe in parallel, log decisions only.
- Compare with current behavior for 3-7 days.

## Stage 2: Soft enforce
- Write to new event tables.
- Keep old durable writes, but log conflicts and mismatches.

## Stage 3: Full enforce
- Route writes by class strictly.
- Enable pruning migration.
- Update prompt retrieval to class-aware mode.

## Stage 4: Cleanup complete
- Execute one-time migration + dedupe for both domains.
- Backfill and verify embeddings.

---

## Junior Developer Checklist

1. Create DB migrations:
- table/column changes + constraints + indexes

2. Build LLM services:
- memory classifier
- dedupe resolver

3. Integrate write paths:
- `store_user_info`
- `storeCharacterFact`

4. Add class-aware retrieval:
- system prompt builders

5. Add cron hygiene handlers:
- expire/purge/promote/audit

6. Build one-time prune job:
- reclassify + move + dedupe + embedding refresh

7. Add telemetry dashboards:
- decision counts, duplicate prevention, stale-memory incidents

8. Run staged rollout:
- shadow -> soft -> full

---

## Success Criteria

You are done when:
- Kayley stops using stale short-term context as long-term truth.
- Duplicate semantic facts collapse into a single canonical concept.
- Immutable memory only contains allowlisted identity anchors.
- Both `user_facts` and `character_facts` follow the same lifecycle model.
- Prompt quality feels stable, fresh, and consistent over weeks.

