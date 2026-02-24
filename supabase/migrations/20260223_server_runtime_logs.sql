-- Server runtime logs for debugging and dashboard visibility.
-- Captures severity, agent/ticket context, and structured details.

create table if not exists public.server_runtime_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  occurred_at timestamptz,
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  agent_name text,
  ticket_id text,
  run_id text,
  request_id text,
  route text,
  source text,
  process_id integer
);

create index if not exists server_runtime_logs_created_at_idx
  on public.server_runtime_logs (created_at desc);

create index if not exists server_runtime_logs_severity_idx
  on public.server_runtime_logs (severity);

create index if not exists server_runtime_logs_agent_name_idx
  on public.server_runtime_logs (agent_name);

create index if not exists server_runtime_logs_ticket_id_idx
  on public.server_runtime_logs (ticket_id);

create index if not exists server_runtime_logs_run_id_idx
  on public.server_runtime_logs (run_id);

create index if not exists server_runtime_logs_request_id_idx
  on public.server_runtime_logs (request_id);
