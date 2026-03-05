-- Extend server_runtime_logs severity to include 'verbose'

alter table public.server_runtime_logs
  drop constraint if exists server_runtime_logs_severity_check;

alter table public.server_runtime_logs
  add constraint server_runtime_logs_severity_check
  check (severity in ('verbose', 'info', 'warning', 'error', 'critical'));
