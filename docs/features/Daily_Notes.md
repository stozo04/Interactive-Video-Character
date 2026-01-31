# Daily Notes

Daily Notes are an append-only memory lane that Kayley controls via tool calls. The goal is to let her save small pieces of context that feel useful later, without polluting structured user facts.

## Why It Exists
- Kayley does not retain prior conversation context day-to-day.
- Daily Notes are a low-friction place to store contextual memory and retrieve it later.
- Notes are append-only and presented back as bullet lines in the system prompt.

## Schema (Supabase)
Migration: `supabase/migrations/20260131_kayley_daily_notes.sql`

Table: `kayley_daily_notes`
- `id` (uuid, PK)
- `note_date_cst` (date, unique) — CST day key
- `notes` (text) — bullet list, append-only
- `created_at`, `updated_at` (UTC timestamps)

## Tools

### store_daily_note
Append a short bullet to today’s CST row.

Rules:
- Append-only (never overwrite)
- Store only the note text (no dates/timestamps)
- Notes are formatted as `- ...`

### retrieve_daily_notes
Retrieve all daily notes as bullet lines (no dates).

## Prompt Section
The system prompt always includes a `DAILY NOTES` block. If there are no notes, it shows a placeholder.

Behavioral guidance:
- This is Kayley’s running memory for later.
- If relevant, weave in one or two notes naturally.
- Do not mention the section or dump all notes.
