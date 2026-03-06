-- ============================================================
-- Migration: agent_no_delete_policy
-- ============================================================
-- Revokes DELETE from the `anon` and `authenticated` roles on all
-- critical "brain" tables. These are tables whose data, if deleted,
-- cannot be recovered from a backup in any reasonable timeframe.
--
-- WHY THIS APPROACH:
-- Both Kayley (src/services/memoryService.ts via supabaseClient.ts)
-- and Opey (server/agent/opey-dev/ticketStore.ts via anon key) use
-- the Supabase `anon` role. REVOKE at the privilege level is checked
-- BEFORE row-level security and BEFORE application code runs, making
-- it an absolute database-level enforcement — not a SOUL.md "hope."
--
-- SERVICE ROLE IS UNAFFECTED:
-- supabaseAdmin (server/services/supabaseAdmin.ts) uses the service
-- role key which bypasses all table-level grants. Admin operations,
-- GDPR deletions, and system cleanup can still use supabaseAdmin.
--
-- KNOWN BREAKAGES (acceptable tradeoffs):
-- 1. conversationHistoryService.ts pruning  → conversation_history
--    DELETE will be silently blocked. History grows but is never lost.
--    Fix: move pruning to use supabaseAdmin (server-side only).
-- 2. memoryService.ts deleteUserFact        → user_facts
--    DELETE will fail. deleteUserFact is NOT an AI tool, only called
--    directly by admin code. Fix: use supabaseAdmin there.
-- 3. userPatterns.ts pattern cleanup        → NOT PROTECTED (see below)
--    user_patterns is left off the list — cleanup is important there.
--
-- TABLES NOT PROTECTED (operational, DELETE is intentional):
-- daily_tasks, cron_jobs, google_api_auth_tokens, x_tweets,
-- x_mentions, workspace_agent_runs, idle_action_log, promises,
-- open_loops, user_patterns, life_storylines, scheduled_digests,
-- server_runtime_logs, fact_embeddings, topic_exhaustion_log
-- ============================================================


-- user_facts: Core identity (name, job, address, preferences).
-- Loss = Kayley forgets who Steven is entirely.
REVOKE DELETE ON TABLE public.user_facts FROM anon, authenticated;

-- conversation_history: Complete chat archive.
-- Loss = years of context gone permanently.
REVOKE DELETE ON TABLE public.conversation_history FROM anon, authenticated;

-- kayley_daily_notes: Kayley's daily memory log.
REVOKE DELETE ON TABLE public.kayley_daily_notes FROM anon, authenticated;

-- kayley_monthly_notes: Monthly memory archive.
REVOKE DELETE ON TABLE public.kayley_monthly_notes FROM anon, authenticated;

-- kayley_lessons_learned: Accumulated behavioral insights.
REVOKE DELETE ON TABLE public.kayley_lessons_learned FROM anon, authenticated;

-- mila_milestone_notes: Baby milestones — irreplaceable memories.
REVOKE DELETE ON TABLE public.mila_milestone_notes FROM anon, authenticated;

-- character_facts: Kayley's self-identity (plants, preferences, invented details).
REVOKE DELETE ON TABLE public.character_facts FROM anon, authenticated;

-- engineering_tickets: Opey's work queue.
-- Deleting a ticket in-flight would lose all tracking of the work.
REVOKE DELETE ON TABLE public.engineering_tickets FROM anon, authenticated;

-- engineering_ticket_events: Opey's lifecycle event log.
REVOKE DELETE ON TABLE public.engineering_ticket_events FROM anon, authenticated;


-- ============================================================
-- VERIFICATION (run in Supabase SQL editor after applying):
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND grantee = 'anon'
--   AND privilege_type = 'DELETE'
--   AND table_name IN (
--     'user_facts', 'conversation_history', 'kayley_daily_notes',
--     'kayley_monthly_notes', 'kayley_lessons_learned',
--     'mila_milestone_notes', 'character_facts',
--     'engineering_tickets', 'engineering_ticket_events'
--   )
-- ORDER BY table_name;
--
-- Expected result: 0 rows
-- ============================================================
