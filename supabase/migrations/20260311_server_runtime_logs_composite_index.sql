-- Fix slow queries on server_runtime_logs that filter by occurred_at + severity.
-- The existing indexes are single-column; a query like:
--   WHERE occurred_at > NOW() - INTERVAL '1 hour' AND severity <> 'info'
-- can't use them together efficiently, causing statement timeouts on large tables.
--
-- Partial index: covers the common "non-info logs in recent window" query pattern.
-- severity IN ('warning','error','critical') covers all non-info severities.

create index if not exists server_runtime_logs_occurred_at_severity_idx
  on public.server_runtime_logs (occurred_at desc)
  where severity in ('warning', 'error', 'critical');

-- Also add a plain occurred_at index since queries sometimes filter by time alone
-- and the existing index is on created_at (not occurred_at).
create index if not exists server_runtime_logs_occurred_at_idx
  on public.server_runtime_logs (occurred_at desc);
