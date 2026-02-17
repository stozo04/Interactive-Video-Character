# Tool Recipe Template

Use this short template when adding a new LLM tool. It keeps the implementation consistent and avoids missed wiring.

## 1) Basics
- Tool name (snake_case):
- Purpose (one sentence):
- When to use:
- When NOT to use:

## 2) Data Schema
- Table name:
- Columns:
- Date/time convention (UTC/CST/etc.):
- User/character scoping: (e.g., no `user_id` or `character_id`)
- Migration file:

## 3) Tool Wiring Checklist
- `src/services/aiSchema.ts`
  - Schema + args types
  - Tool declarations
  - `MemoryToolArgs` union
  - `PendingToolCall` names
- `src/services/memoryService.ts`
  - `MemoryToolName` union
  - `ToolCallArgs` interface
  - `executeMemoryTool()` case
  - Helper functions
- `src/services/system_prompts/tools/toolsAndCapabilities.ts`
  - When/how guidance
- `src/services/system_prompts/builders/systemPromptBuilder.ts`
  - Prompt injection (if needed)
- `src/services/toolCatalog.ts`
  - Tool catalog entry

## 4) Prompt Section (if needed)
- Section title:
- Behavior rules:
- Example lines:

## 5) Tests / Verification
- Snapshot tests (if prompt changed):
  - `npm test -- --run -t "snapshot"`
- Full run:
  - `npm test -- --run`

---

## Example (Mila Milestones)

Basics:
- Tool: `mila_note`, `retrieve_mila_notes`
- Purpose: Append Mila milestone notes + retrieve by month.
- Use: New milestones, monthly blog summaries.
- Don’t use: Standard user facts or daily tasks.

Data schema:
- Table: `mila_milestone_notes`
- Columns: `note_entry_date`, `note`, `created_at`, `updated_at`
- Date: UTC date (YYYY-MM-DD)
- Migration: `supabase/migrations/20260206_mila_milestone_notes.sql`
