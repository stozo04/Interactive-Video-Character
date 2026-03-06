# Mila Milestones

Mila Milestones are an append-only memory lane for recording Mila's key moments. The goal is to capture milestones and memorable events so monthly summaries and blog drafts are accurate and complete.

## Why It Exists
- Mila's progress can happen quickly and can be easy to forget.
- Milestones are often referenced later (monthly recaps, family updates).
- This keeps the AI companion consistent and proactive when summarizing.

## Schema (Supabase)
Migration: `supabase/migrations/20260206_mila_milestone_notes.sql`

Table: `mila_milestone_notes`
- `id` (uuid, PK)
- `note_entry_date` (date, unique) — UTC day key
- `note` (text) — bullet list, append-only
- `created_at`, `updated_at` (UTC timestamps)
- No `user_id` or `character_id` (single-user app)

## Tools

### mila_note
Append a short milestone note to today's UTC row.

Rules:
- Append-only (never overwrite)
- Store only the note text (no dates/timestamps)
- Include what happened and any helpful context (what triggered it)

Example:
- "Mila clapped her hands when Steven cheered after tummy time."

### retrieve_mila_notes
Retrieve all Mila milestone notes for a specific month (UTC).

Args:
- `year` (number)
- `month` (1-12)

Example:
- "What did Mila do in July 2026?"

## Prompt Section
The system prompt includes a `MILA MILESTONES` block.

Behavioral guidance:
- This is the running memory for Mila's moments.
- Store new milestones immediately with `mila_note`.
- For monthly summaries, call `retrieve_mila_notes` with year + month.
- Do not mention the section explicitly.
