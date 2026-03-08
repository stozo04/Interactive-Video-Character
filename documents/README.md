# Preferred Way To Request a New Feature

When you want a new feature (especially a new tool call), please provide:

1. Goal (one sentence):
   - What do you want the AI to do?
2. Tool name(s) (snake_case):
   - Example: `kayley_private_moment`, `retrieve_kayley_private_moments`
3. Data model:
   - Table name:
   - Columns (include date/time convention):
   - Should it be append-only?
4. Retrieval needs:
   - Time filters (e.g., by month)?
   - Format (with or without dates)?
5. Prompt behavior:
   - Should it appear in the system prompt?
   - Example guidance text or sample triggers
6. Privacy / access constraints:
   - If you want it unreadable to you, say so explicitly.
   - Note: true “unreadable to the app owner” requires encryption or server-side restrictions.

If you want a “Kayley private moments” tool:
- Confirm the tool name(s), table name, and whether we must encrypt at rest.
- If encryption is required, specify who holds the key (client, server, or not at all).

# Documentation Index

Use this as the single entry point for core project documentation.

## Start Here
- App architecture and message flow: `src/App.README.md`
- System prompt rules: `documents/AI_Notes_System_Prompt_Guidelines.md`
- Tool integration checklist (required): `documents/AI_Notes_Tool_Integration_Checklist.md`
- Tool recipe template: `documents/Tool_Recipe_Template.md`
- Supabase gotchas: `documents/Supabase_Gotchas.md`

## New Tool Flow (Quick Path)
1. Read `documents/AI_Notes_Tool_Integration_Checklist.md`
2. Fill out `documents/Tool_Recipe_Template.md`
3. Check prompt rules in `documents/AI_Notes_System_Prompt_Guidelines.md`
4. If data is needed, review `documents/Supabase_Gotchas.md`

## Features
- Feature index: `documents/features/README.md`
- Daily Notes: `documents/features/Daily_Notes.md`
- Lessons Learned: `documents/features/Lessons_Learned.md`
- Mila Milestones: `documents/features/Mila_Milestones.md`

## Service Documentation
- Service documents hub: `src/services/documents/README.md`

## Plans, Bugs, Archive
- Plans: `documents/plans/`
- Bugs: `documents/bugs/`
- Archive: `documents/archive/`
