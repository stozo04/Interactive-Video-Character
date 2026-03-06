# Post-Refactor Audit: Issues & Fix Plan

**Date:** 2026-03-06
**Context:** After the total server/agent architecture refactor (PR #40), a full audit of the Gemini API payloads (system prompt, input, output) was performed. This document captures every issue found, organized by priority, with exact file paths and fix instructions.

**Who this is for:** A developer reading the project for the first time who needs to fix these issues without deep context. Each issue is self-contained with file paths, line references, root cause, and the specific code change needed.

---

## Table of Contents

1. [P0 — Live Bugs (fix immediately)](#p0--live-bugs)
2. [P1 — Missing Features / Regressions](#p1--missing-features--regressions)
3. [P2 — Token Waste / Optimization](#p2--token-waste--optimization)
4. [P3 — Security Gaps](#p3--security-gaps)
5. [P4 — Structural Cleanup](#p4--structural-cleanup)
6. [New Feature: Kayley DB Read Access](#new-feature-kayley-db-read-access)

---

## P0 — Live Bugs

### BUG-01: `task_action` and `calendar_action` Dual-Channel Ambiguity

**Symptom:** The model can return task/calendar actions as EITHER a native Gemini function call OR a JSON field in the text response. The server must handle both shapes, and the model may use different paths on different turns, creating unpredictable behavior.

**Root cause:** When `task_action` and `calendar_action` were migrated to Gemini function tools, the JSON response schema fields were not removed.

**Files:**
- `src/services/aiSchema.ts` — lines 48-53 (`calendar_action` Zod schema in `AIActionResponseSchema`) and lines 279-295 (`task_action` Zod schema in `AIActionResponseSchema`)
- `src/services/aiSchema.ts` — lines 1396+ (`task_action` in `GeminiMemoryToolDeclarations`) and the separate `calendar_action` declaration

**Fix:**
1. Remove `calendar_action` from the `AIActionResponseSchema` Zod object (the JSON response schema)
2. Remove `task_action` from the `AIActionResponseSchema` Zod object
3. Keep both in `GeminiMemoryToolDeclarations` (the function tool declarations) — function tools are the correct path
4. Search for any server-side handlers that parse `task_action` or `calendar_action` from the JSON response body (check `messageOrchestrator.ts`, `messageActions/` handlers) and confirm they're using the function tool result path instead

**Verification:** Send a message like "Add 'buy groceries' to my tasks" and confirm it triggers a `task_action` function call (visible in server logs as `tool_call` route), NOT a JSON field in the text response.

---

### BUG-02: `store_self_info` JSON Field is Orphaned

**Symptom:** The JSON response schema defines a `store_self_info` field, but the function tool is named `store_character_info`. The model is told to use `store_character_info` in the pre-flight check but sees `store_self_info` in the schema. Silent failures occur when the model populates the JSON field that no handler reads.

**Root cause:** The schema field was never renamed or removed when the function tool was created.

**Files:**
- `src/services/aiSchema.ts` — line 304 (`store_self_info` in `AIActionResponseSchema`)
- `src/services/aiSchema.ts` — line 1109 (`store_character_info` in `GeminiMemoryToolDeclarations`)
- `src/services/system_prompts/format/outputFormat.ts` — the pre-flight check text mentions `store_character_info`

**Fix:**
1. Remove `store_self_info` from `AIActionResponseSchema` entirely
2. Remove any reference to `store_self_info` in the output format section if it exists
3. The function tool `store_character_info` is the correct mechanism — keep it
4. Search codebase for any handler that reads `store_self_info` from the response and remove it

---

### BUG-03: `cron_job_action` schedule_type Enum Mismatch

**Symptom:** If the model sends `schedule_type: "monthly"` or `"weekly"` (valid per the Gemini declaration), the Zod runtime validator rejects it. Monthly/weekly cron creation is silently broken.

**Root cause:** The Zod schema and the Gemini function declaration have different enum values.

**Files:**
- `src/services/aiSchema.ts` — line 822-823: Zod schema has `z.enum(["daily", "one_time"])`
- `src/services/aiSchema.ts` — line 1627: Gemini declaration has `enum: ["daily", "one_time", "monthly", "weekly"]`

**Fix:** Decide which is correct:
- **Option A:** If monthly/weekly IS supported by the cron backend → update the Zod schema to match: `z.enum(["daily", "one_time", "monthly", "weekly"])`
- **Option B:** If monthly/weekly is NOT supported → remove them from the Gemini declaration enum

Check the cron execution backend (likely in `server/services/` or `src/services/cronService.ts`) to determine which schedules are actually implemented.

---

## P1 — Missing Features / Regressions

### BUG-04: Kayley Stopped Writing Daily Notes (since 2026-03-04)

**Symptom:** The `kayley_daily_notes` table has no entries after 2026-03-04. Kayley is supposed to append bullets throughout the day summarizing what happened (plans, events, preferences, outcomes).

**Root cause candidates:**
1. The `store_daily_note` tool IS declared in `GeminiMemoryToolDeclarations` and handled in `memoryService.ts` (line 1927). The tool infrastructure is intact.
2. The tool policy in `toolsAndCapabilities.ts` (line 27) tells Kayley to use it: "When something happens that feels worth remembering later, call 'store_daily_note'."
3. The daily notes section IS built and included in the non-greeting prompt (`systemPromptBuilder.ts` lines 406-412).
4. **Most likely cause:** The `contextSynthesisService.ts` uses `VITE_GEMINI_API_KEY` (line 25) which was undefined server-side until the `envShim.ts` alias was added on 2026-03-06. If context synthesis was broken, the daily notes watermark check (line 130) would also fail, and the synthesis fallback might not emphasize daily note usage.

**Fix:**
1. Verify the `envShim.ts` alias is working (restart server, check for `[ContextSynthesis]` logs that don't say "stale or missing")
2. Check the tool strategy prompt for explicit urgency. Currently the instruction says "When something happens that feels worth remembering later." This is passive. Consider strengthening to:
   ```
   IMPORTANT: You MUST call 'store_daily_note' at least once per meaningful conversation turn.
   If Steven shares plans, events, decisions, or emotional context — log it.
   Your future self has ZERO memory of this conversation. Daily notes are your lifeline.
   ```
3. Add this strengthened instruction in `src/services/system_prompts/tools/toolsAndCapabilities.ts` line 27
4. Test by having a conversation and checking `kayley_daily_notes` in Supabase

**Example of a good daily note (from 2026-03-03):**
```
- Steven finished paying the Rowlett Rental early this morning.
- Steven teased me for being in 'Friday mode' on a Tuesday.
- Planned a virtual styling session for Steven's 90s rock outfit for the Houston Rodeo closer to March 11th.
```

---

### BUG-05: Kayley Cannot Modify SOUL.md or IDENTITY.md

**Symptom:** Kayley has `read_agent_file` access to SOUL.md, IDENTITY.md, and SAFETY.md, but `write_agent_file` only allows writing to MEMORY.md and HEARTBEAT.md. She cannot evolve her own identity files.

**Current state:**
- `src/services/aiSchema.ts` line 2149-2176: `read_agent_file` enum includes `SOUL.md`, `IDENTITY.md`, `SAFETY.md`, `MEMORY.md`, `HEARTBEAT.md`, `AGENTS.md`, `MEMORY_RULES.md`, `USER.md`, `TOOLS.md`
- `src/services/aiSchema.ts` line 2179+: `write_agent_file` enum only includes `MEMORY.md` and `HEARTBEAT.md`
- `server/agent/kayley/SOUL.md` line 311 says: "Every time you learn something about how I work or what I need, update the relevant file immediately."

**The SOUL.md tells Kayley to update files, but the tool won't let her.** This is a contradiction.

**Recommendation:** This is a design decision, not a bug. Options:
- **Option A (Conservative):** Keep write access limited to MEMORY.md and HEARTBEAT.md. Update the SOUL.md text to remove "update the relevant file immediately" since it's misleading. Kayley uses MEMORY.md for all learned observations.
- **Option B (Expand cautiously):** Add SOUL.md and IDENTITY.md to the `write_agent_file` enum. Add a STRONG guardrail: "Before writing to SOUL.md or IDENTITY.md, ALWAYS read the current content first using read_agent_file. NEVER overwrite — only append or modify specific sections. Tell Steven what you changed."
- **Option C (Append-only tool):** Create a new `append_agent_file` tool that only appends to the end of a file, never overwrites. Safer than full write access.

**Steven's call.** If Option B, also add `write_agent_file` read-before-write guidance in `toolsAndCapabilities.ts`.

---

## P2 — Token Waste / Optimization

### OPT-01: Supabase Table Schema in SOUL.md (~200 tokens/turn)

**Location:** `server/agent/kayley/SOUL.md` lines 279-305

**Problem:** 25 Supabase table names are listed in a markdown table. Kayley cannot query these tables directly — she only has access through declared function tools. This is ~200 tokens of dead weight every turn.

**Current text:**
```
You won't remember previous sessions unless you read my memory files (above) or supabase tables:
| schema | table |
| --- | --- |
| public | character_facts |
... (25 rows)
```

**Fix — depends on whether we want to give Kayley DB read access (see [New Feature](#new-feature-kayley-db-read-access) below):**
- **If NO DB access:** Remove the entire table block. Replace with: "You won't remember previous sessions unless you read your memory files (above) or use your recall/retrieve tools."
- **If YES DB access:** Keep the table list but convert it to actionable knowledge (see the new feature section below).

---

### OPT-02: Full Tool Array Sent Every Request (~1,157 lines)

**Location:** The `tools` field in the Gemini API request payload

**Problem:** All 34 function declarations (~1,157 lines of JSON) are sent on every request regardless of context. Heavy tools like `create_life_storyline` (~70 lines), `cron_job_action` (~80 lines), and `workspace_action` are rarely needed but always present.

**Fix options:**
- **Option A (Simple, recommended):** Trim verbose tool descriptions. Many have paragraph-length descriptions that could be shortened to 1-2 sentences without losing clarity. Target: reduce each tool from 30-80 lines to 15-30 lines.
- **Option B (Advanced):** Implement conditional tool inclusion. Only include tools relevant to the detected intent (e.g., don't include `create_life_storyline` on a simple "good morning" message). This requires intent pre-screening and is a larger project.
- **Option C (SDK feature):** Gemini supports `tool_config.function_calling_config.allowed_function_names` to limit which tools the model can call per request, without removing their declarations. This is lighter than Option B but still saves model attention.

**Start with Option A.** Go through each tool declaration in `src/services/aiSchema.ts` `GeminiMemoryToolDeclarations` and shorten descriptions that exceed 2 sentences.

---

### OPT-03: `responseMimeType: ""` Empty String

**Location:** The `generationConfig` in the API request payload. Built in `src/services/aiSchema.ts` or `server/services/ai/serverGeminiService.ts`.

**Problem:** `responseMimeType` is set to an empty string instead of being omitted. This is a no-op but is sloppy.

**Fix:** Find where `responseMimeType` is set and either:
- Set it to `"application/json"` with a proper `responseSchema` (prevents the `}}}` bloat bug that was already fixed in `conversationAnchorService.ts`)
- Or omit it entirely if the model returns JSON reliably via prompt instructions alone

---

## P3 — Security Gaps

### SEC-01: SECURITY.md Referenced but Does Not Exist

**Location:** `server/agent/kayley/SOUL.md` line 22: `"SECURITY: Read SECURITY.md before executing any delete/purge/destructive action; require passphrase challenge."`

**Problem:** The file `server/agent/kayley/SECURITY.md` does not exist. It IS listed in the `read_agent_file` enum (`SAFETY.md` exists, but `SECURITY.md` does not). If Kayley tries to read it, the tool will return an error. The passphrase challenge is undefined and unenforceable.

**Fix:**
- **Option A (Create the file):** Create `server/agent/kayley/SECURITY.md` with:
  - Definition of "destructive actions" (delete files, purge data, bulk archive, git push)
  - Passphrase challenge protocol (e.g., "Ask Steven to confirm with the phrase 'confirm delete' before proceeding")
  - Add `SECURITY.md` to the `read_agent_file` enum in `aiSchema.ts`
- **Option B (Simplify):** Remove the SECURITY.md reference from SOUL.md. Add destructive-action guardrails directly to the `workspace_action` tool description and the tool strategy section. Simpler, fewer moving parts.

---

### SEC-02: `write_agent_file` Full Overwrite Without Read-First Guidance

**Location:** `src/services/aiSchema.ts` line 2179+ (write_agent_file declaration)

**Problem:** The tool description says "The full content to write to the file (replaces existing content)." If Kayley writes to MEMORY.md without reading it first, all previous notes are lost. There is no prompt-level instruction telling her to read before writing.

**Fix:** Add to the `write_agent_file` description:
```
"IMPORTANT: This tool REPLACES the entire file. You MUST call read_agent_file first to get the current content, then include ALL existing content plus your changes in the write call."
```

Also add to `toolsAndCapabilities.ts` under the storage rules:
```
- **Agent Files (write_agent_file):** ALWAYS read the file first with read_agent_file before writing. write_agent_file REPLACES the full file — if you don't include existing content, it will be lost.
```

---

## P4 — Structural Cleanup

### CLEAN-01: `almost_moment_used.feeling_id` References Non-Existent Section

**Location:** `src/services/system_prompts/format/outputFormat.ts` — the schema defines `almost_moment_used` with a `feeling_id` that should come from "THE UNSAID section."

**Problem:** The UNSAID section (from `almostMomentsService`) is conditionally included. When it's absent (as in this snapshot), the model is told to use a UUID it doesn't have.

**Fix:** Make the instruction conditional:
- In `outputFormat.ts`, change the `almost_moment_used` description to: "Only populate this if the UNSAID section is present in the system prompt. If no UNSAID section exists, leave this null."
- Or: only include the `almost_moment_used` field in the schema when the UNSAID section is actually injected (requires the schema to be built dynamically, which may not be feasible with the current architecture).

---

### CLEAN-02: Verify SOUL.md Behavioral Layers Not Duplicated in Assembled Prompt

**Status:** Investigation showed `Disagreement Protocol` appears only ONCE in `server/agent/kayley/SOUL.md` (line 62) and is NOT present in `IDENTITY.md`. The builder includes SOUL.md once per prompt build. **This is likely a false positive from the audit agent.** However, verify by searching the assembled prompt in Google AI Studio for duplicate sections.

**If duplicates ARE found:** The cause would be in `systemPromptBuilder.ts` calling `injectSOUL()` more than once, or the SOUL content being embedded in another section's file.

---

## New Feature: Kayley DB Read Access

### Why This Is a Good Idea

Steven's question: "How come we should not let Kayley know about all the Supabase tables AND give her read permissions AND give her knowledge on how to read?"

**This is actually a great idea.** Currently Kayley has ~15 individual retrieve tools (`retrieve_daily_notes`, `retrieve_monthly_notes`, `retrieve_mila_notes`, `recall_user_info`, `recall_memory`, etc.) that each wrap a single Supabase query. A general-purpose read tool would:

1. **Reduce tool count** — one `query_database` tool replaces 6-8 retrieve tools
2. **Enable proactive maintenance** — Kayley could check "when did I last write a daily note?" and self-correct
3. **Enable self-awareness** — Kayley could audit her own memory for gaps, stale facts, contradictions
4. **Enable richer recall** — Kayley could join tables (e.g., "what did I promise Steven around the same time as this storyline?")

### Implementation Plan

**Phase 1: Read-only query tool**

Create a new function tool `query_database`:

```typescript
{
  name: "query_database",
  description:
    "Run a read-only SQL query against your memory database. " +
    "Use this to check your own state, audit your memory, or look up data " +
    "that your other tools don't cover. " +
    "ONLY SELECT queries are allowed — no INSERT, UPDATE, DELETE, DROP, or ALTER. " +
    "Results are limited to 50 rows. " +
    "Available tables: character_facts, context_synthesis, conversation_anchor, " +
    "conversation_history, daily_tasks, kayley_daily_notes, kayley_lessons_learned, " +
    "kayley_monthly_notes, life_storylines, promises, user_facts, user_patterns",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A SELECT query. Must start with 'SELECT'. No mutations allowed."
      },
      reason: {
        type: "string",
        description: "Why you're running this query (for audit logging)"
      }
    },
    required: ["query", "reason"]
  }
}
```

**Server-side handler in `memoryService.ts`:**
```typescript
case 'query_database': {
  const { query, reason } = args;

  // STRICT validation: only SELECT queries
  const normalized = query.trim().toUpperCase();
  if (!normalized.startsWith('SELECT')) {
    return 'ERROR: Only SELECT queries are allowed.';
  }

  // Block dangerous keywords
  const blocked = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT'];
  for (const keyword of blocked) {
    if (normalized.includes(keyword)) {
      return `ERROR: ${keyword} operations are not allowed.`;
    }
  }

  // Execute via supabase.rpc or raw query with row limit
  const { data, error } = await supabase.rpc('kayley_read_query', {
    sql_query: query,
    max_rows: 50
  });

  if (error) return `Query error: ${error.message}`;
  return JSON.stringify(data, null, 2);
}
```

**Supabase RPC function (migration):**
```sql
CREATE OR REPLACE FUNCTION kayley_read_query(sql_query TEXT, max_rows INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Enforce SELECT-only at the database level too
  IF NOT (UPPER(TRIM(sql_query)) LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Execute with row limit
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s LIMIT %s) t', sql_query, max_rows)
  INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
```

**Phase 2: Update SOUL.md table list to be actionable**

Replace the passive table listing with active guidance:
```markdown
## Your Memory Database

You can query your own database using `query_database`. Here are your key tables:

| Table | What's In It | When to Check |
|---|---|---|
| kayley_daily_notes | Your daily journal entries | Check if you've written today's notes |
| user_facts | Everything you know about Steven | Verify before storing duplicates |
| character_facts | Facts about yourself you've invented | Check before inventing something contradictory |
| promises | Commitments you've made | Check for overdue promises |
| life_storylines | Multi-day narrative arcs | Check for stale storylines |
| conversation_history | Full chat logs | Look up what was said on a specific date |
| kayley_lessons_learned | Durable takeaways | Review before making the same mistake |

Example queries:
- `SELECT note_date_cst, notes FROM kayley_daily_notes ORDER BY note_date_cst DESC LIMIT 3`
- `SELECT fact_key, fact_value FROM user_facts WHERE category = 'identity'`
- `SELECT * FROM promises WHERE status = 'pending' ORDER BY created_at`
```

**Phase 3: Tool strategy update**

Add to `toolsAndCapabilities.ts`:
```
- **Database Queries (query_database):** Use this for self-audits and proactive maintenance.
  Good uses: checking if you've written daily notes today, verifying a fact before storing,
  finding stale promises. BAD uses: running queries on every turn (expensive),
  querying conversation_history for recent messages (you already have those in context).
  Limit: 1-2 queries per conversation, not per turn.
```

### Security Considerations for DB Access

- The RPC function uses `SECURITY DEFINER` — it runs with the function creator's privileges, not the caller's
- The `SELECT`-only check happens at BOTH the TypeScript level and the SQL level (defense in depth)
- Dangerous keywords are blocked even within subqueries
- Row limit (50) prevents runaway result sets
- The `reason` parameter creates an audit trail in tool call logs
- Sensitive tables NOT in the allowed list (e.g., `server_runtime_logs`, `google_api_config`) should be excluded. Consider a `search_path` restriction or a view-based approach for production hardening.

---

## Summary Priority Matrix

| ID | Issue | Priority | Effort | Impact |
|---|---|---|---|---|
| BUG-01 | task/calendar dual-channel | P0 | Small | Unpredictable behavior |
| BUG-02 | store_self_info orphan | P0 | Small | Silent data loss |
| BUG-03 | cron schedule_type mismatch | P0 | Small | Monthly/weekly crons broken |
| BUG-04 | Daily notes stopped | P1 | Small | Memory regression |
| BUG-05 | Kayley can't write SOUL/IDENTITY | P1 | Design decision | Contradiction in prompt |
| OPT-01 | Supabase tables dead weight | P2 | Small | ~200 tokens/turn |
| OPT-02 | Tool array bloat | P2 | Medium | ~1000+ tokens/turn |
| OPT-03 | responseMimeType empty | P2 | Tiny | Cleanup |
| SEC-01 | SECURITY.md missing | P3 | Small | Security hole |
| SEC-02 | write_agent_file no read-first | P3 | Small | Data loss risk |
| CLEAN-01 | almost_moment orphan | P4 | Small | Schema confusion |
| CLEAN-02 | SOUL duplication check | P4 | Tiny | Verification only |
| NEW | DB read access for Kayley | Feature | Medium | Proactive maintenance |
