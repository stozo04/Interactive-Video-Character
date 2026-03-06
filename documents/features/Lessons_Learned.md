# Lessons Learned

Lessons Learned are an append-only memory lane for Kayley's durable takeaways. The goal is to preserve insights she wants to remember after memory resets, without polluting structured facts.

## Why It Exists
- Kayley does not retain prior conversation context day-to-day.
- Lessons Learned capture stable takeaways from experience or reflection.
- Lessons are append-only and presented back as bullet lines in the system prompt.

## Schema (Supabase)
Migration: `supabase/migrations/20260303_kayley_lessons_learned.sql`

Table: `kayley_lessons_learned`
- `id` (uuid, PK)
- `lesson_date_cst` (date, unique) - CST day key
- `lessons` (text) — bullet list, append-only
- `created_at`, `updated_at` (UTC timestamps)

## Tools

### store_lessons_learned
Append a short bullet to today's CST row.

Rules:
- Append-only (never overwrite)
- Store only the lesson text (no dates/timestamps)
- Lessons are formatted as `- ...`

### retrieve_lessons_learned
Retrieve all lessons learned as bullet lines (no dates).

## Prompt Section
The system prompt always includes a `LESSONS LEARNED` block. If there are no lessons, it shows a placeholder.

Behavioral guidance:
- These are durable takeaways to guide future responses.
- If relevant, weave in one or two lessons naturally.
- Do not mention the section or dump all lessons.
