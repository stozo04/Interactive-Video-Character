-- Topic Exhaustion table
-- Tracks how often specific topics are mentioned to prevent repetitive surfacing.
-- Cooldowns only apply to AI-initiated repeats; user-initiated topics are never suppressed.

create table public.topic_exhaustion (
  id uuid not null default extensions.uuid_generate_v4 (),
  topic_key text not null,
  mention_count_7d integer not null default 1,
  last_mentioned_at timestamp with time zone not null default now(),
  last_initiated_by text not null default 'ai',
  cooldown_until timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint topic_exhaustion_pkey primary key (id),
  constraint topic_exhaustion_topic_key_unique unique (topic_key),
  constraint topic_exhaustion_initiated_by_check check (
    last_initiated_by = any (array['ai'::text, 'user'::text])
  )
) TABLESPACE pg_default;

create index if not exists idx_topic_exhaustion_cooldown
  on public.topic_exhaustion using btree (cooldown_until) TABLESPACE pg_default
  where cooldown_until is not null;

create index if not exists idx_topic_exhaustion_last_mentioned
  on public.topic_exhaustion using btree (last_mentioned_at desc) TABLESPACE pg_default;

-- Auto-update updated_at on row change
create trigger update_topic_exhaustion_updated_at
  before update on public.topic_exhaustion
  for each row
  execute function update_updated_at_column();

-- Expand idle_action_log CHECK constraint to include new action types
-- (synthesis, tool_discovery, x_post, x_mention_poll are used in code but missing from original constraint)
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'idle_action_log_action_type_check'
      and table_name = 'idle_action_log'
      and table_schema = 'public'
  ) then
    alter table public.idle_action_log
      drop constraint idle_action_log_action_type_check;
  end if;
end $$;

alter table public.idle_action_log
  add constraint idle_action_log_action_type_check check (
    action_type = any (array[
      'storyline'::text,
      'browse'::text,
      'question'::text,
      'tool_discovery'::text,
      'x_post'::text,
      'x_mention_poll'::text,
      'synthesis'::text
    ])
  );
