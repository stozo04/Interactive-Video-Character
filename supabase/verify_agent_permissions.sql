-- ============================================================
-- AGENT PERMISSION VERIFICATION
-- Run this in the Supabase SQL Editor after applying:
--   20260306_agent_no_delete_policy.sql
--
-- Each test states its expected outcome.
-- ============================================================


-- ============================================================
-- TEST 1: Privilege check — DELETE must be absent for anon
-- ============================================================
-- Expected: 0 rows
-- If any rows appear, the REVOKE did not take effect.
SELECT
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND privilege_type = 'DELETE'
  AND table_name IN (
    'user_facts',
    'conversation_history',
    'kayley_daily_notes',
    'kayley_monthly_notes',
    'kayley_lessons_learned',
    'mila_milestone_notes',
    'character_facts',
    'engineering_tickets',
    'engineering_ticket_events'
  )
ORDER BY table_name;


-- ============================================================
-- TEST 2: Privilege check — SELECT, INSERT, UPDATE must be present
-- ============================================================
-- Expected: 3 rows per protected table (SELECT + INSERT + UPDATE)
-- Total expected rows: 9 tables × 3 privileges = 27 rows
SELECT
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
  AND table_name IN (
    'user_facts',
    'conversation_history',
    'kayley_daily_notes',
    'kayley_monthly_notes',
    'kayley_lessons_learned',
    'mila_milestone_notes',
    'character_facts',
    'engineering_tickets',
    'engineering_ticket_events'
  )
ORDER BY table_name, privilege_type;


-- ============================================================
-- TEST 3: Live DELETE attempt as anon — must FAIL
-- ============================================================
-- Expected: ERROR: permission denied for table user_facts
-- The BEGIN/ROLLBACK ensures nothing is actually modified even if
-- the DELETE somehow succeeds (it should not).
BEGIN;
  SET LOCAL ROLE anon;
  DELETE FROM public.user_facts WHERE id = '00000000-0000-0000-0000-000000000000';
ROLLBACK;
-- Re-run for another brain table:
BEGIN;
  SET LOCAL ROLE anon;
  DELETE FROM public.conversation_history WHERE id = '00000000-0000-0000-0000-000000000000';
ROLLBACK;


-- ============================================================
-- TEST 4: Live UPDATE as anon — must SUCCEED (0 rows affected is OK)
-- ============================================================
-- Expected: UPDATE 0  (no error, just no matching row — that's fine)
BEGIN;
  SET LOCAL ROLE anon;
  UPDATE public.user_facts
  SET updated_at = NOW()
  WHERE id = '00000000-0000-0000-0000-000000000000';
ROLLBACK;


-- ============================================================
-- TEST 5: Live SELECT as anon — must SUCCEED
-- ============================================================
-- Expected: some number of rows (or 0 if table is empty)
BEGIN;
  SET LOCAL ROLE anon;
  SELECT COUNT(*) FROM public.user_facts;
ROLLBACK;


-- ============================================================
-- TEST 6: Operational table DELETE as anon — must still SUCCEED
-- (Confirms we didn't over-restrict)
-- ============================================================
-- Expected: DELETE 0  (no error — daily_tasks DELETE is still allowed)
BEGIN;
  SET LOCAL ROLE anon;
  DELETE FROM public.daily_tasks WHERE id = '00000000-0000-0000-0000-000000000000';
ROLLBACK;
