-- Migration: kayley_read_query RPC
-- Allows Kayley to run read-only SELECT queries against her own memory tables.
-- Used by the query_database function tool in memoryService.ts.
--
-- Security:
-- - SECURITY DEFINER runs with function creator's privileges
-- - SELECT-only enforced at BOTH TypeScript level (memoryService) and SQL level (here)
-- - Row limit (50) prevents runaway result sets

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

  -- Execute with row limit
  EXECUTE format(
    'SELECT jsonb_agg(row_to_json(t)) FROM (%s LIMIT %s) t',
    sql_query,
    max_rows
  ) INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
