alter table public.idle_action_log
  drop constraint if exists idle_action_log_action_type_check;

alter table public.idle_action_log
  add constraint idle_action_log_action_type_check
  check (
    action_type = any (
      array['storyline'::text, 'browse'::text, 'question'::text, 'tool_discovery'::text]
    )
  );

create table public.kayley_tool_suggestions (
  id uuid not null default extensions.uuid_generate_v4 (),
  tool_key text not null,
  title text not null,
  reasoning text not null,
  user_value text not null,
  trigger text not null,
  sample_prompt text not null,
  permissions_needed text[] not null default '{}'::text[],
  status text not null default 'queued'::text,
  trigger_source text not null default 'idle'::text,
  trigger_text text null,
  trigger_reason text null,
  created_at timestamp with time zone null default now(),
  shared_at timestamp with time zone null,
  constraint kayley_tool_suggestions_pkey primary key (id),
  constraint kayley_tool_suggestions_status_check check (
    status = any (array['queued'::text, 'shared'::text])
  ),
  constraint kayley_tool_suggestions_trigger_source_check check (
    trigger_source = any (array['idle'::text, 'live'::text])
  ),
  constraint kayley_tool_suggestions_tool_key_unique unique (tool_key)
) TABLESPACE pg_default;

create index IF not exists idx_kayley_tool_suggestions_status
  on public.kayley_tool_suggestions using btree (status, created_at desc) TABLESPACE pg_default;

create index IF not exists idx_kayley_tool_suggestions_created_at
  on public.kayley_tool_suggestions using btree (created_at desc) TABLESPACE pg_default;
