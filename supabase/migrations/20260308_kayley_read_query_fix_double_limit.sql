-- Migration: fix kayley_read_query double-LIMIT crash
--
-- Root cause: the original function wrapped the user query as:
--   SELECT jsonb_agg(...) FROM (<sql_query> LIMIT 50) t
--
-- If Kayley's query already contains LIMIT (e.g. "SELECT ... LIMIT 5"),
-- the result was "... LIMIT 5 LIMIT 50" which PostgreSQL rejects with:
--   ERROR 42601: syntax error at or near "LIMIT"
--
-- Fix: wrap via CTE instead. The inner query's LIMIT applies inside the CTE,
-- and the outer LIMIT acts as a safety cap without conflicting.
-- Result: min(query_limit, max_rows) rows returned, always valid SQL.

CREATE OR REPLACE FUNCTION kayley_read_query(sql_query TEXT, max_rows INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Enforce SELECT-only at the database level
  IF NOT (UPPER(TRIM(sql_query)) LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Wrap via CTE so any LIMIT already in sql_query doesn't conflict with
  -- the outer safety cap (double LIMIT is a syntax error in PostgreSQL).
  EXECUTE format(
    'WITH _q AS (%s) SELECT jsonb_agg(row_to_json(t)) FROM (SELECT * FROM _q LIMIT %s) t',
    sql_query,
    max_rows
  ) INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
