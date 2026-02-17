-- Context Synthesis table
-- Stores daily synthesized context documents produced by background LLM job.
-- One row per day. The system prompt builder reads the latest non-expired row.

create table public.context_synthesis (
  id uuid not null default extensions.uuid_generate_v4 (),
  synthesis_date date not null,
  schema_version integer not null default 1,
  document jsonb not null,
  source_watermarks jsonb null,
  model_used text null,
  generation_duration_ms integer null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint context_synthesis_pkey primary key (id),
  constraint context_synthesis_date_unique unique (synthesis_date)
) TABLESPACE pg_default;

create index if not exists idx_context_synthesis_expires
  on public.context_synthesis using btree (expires_at desc) TABLESPACE pg_default;

create index if not exists idx_context_synthesis_date
  on public.context_synthesis using btree (synthesis_date desc) TABLESPACE pg_default;

-- Auto-update updated_at on row change
create trigger update_context_synthesis_updated_at
  before update on public.context_synthesis
  for each row
  execute function update_updated_at_column();
