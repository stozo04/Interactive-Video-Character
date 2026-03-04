# Monthly Notes

Monthly Notes are an append-only archive lane that Kayley controls via tool calls. The goal is to keep a tidy month-level memory log when daily notes get long.

## Why It Exists
- Daily notes can grow large over time.
- Monthly notes provide a compact archive for monthly summaries.
- Notes are append-only and retrieved on demand (not auto-injected into prompts).

## Schema (Supabase)
Migration: `supabase/migrations/20260304_kayley_monthly_notes.sql`

Table: `kayley_monthly_notes`
- `id` (uuid, PK)
- `month_key` (text, unique) - CST month key in `YYYY-MM`
- `notes` (text) - bullet list, append-only
- `created_at`, `updated_at` (UTC timestamps)

## Tools

### store_monthly_note
Append a short bullet to the current CST month row.

Rules:
- Append-only (never overwrite)
- Store only the note text (no dates/timestamps)
- Notes are formatted as `- ...`

### retrieve_monthly_notes
Retrieve monthly notes for a specific month (CST). If `year` or `month` are omitted, defaults to the current CST month.
