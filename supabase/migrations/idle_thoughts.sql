create table public.idle_thoughts (
  id uuid not null default gen_random_uuid (),
  thought_type text not null,
  content text not null,
  associated_memory text null,
  emotional_tone text not null,
  is_recurring boolean null default false,
  dream_imagery jsonb null,
  involves_user boolean null default false,
  user_role_in_thought text null,
  can_share_with_user boolean null default true,
  ideal_conversation_mood text null,
  natural_intro text null,
  generated_at timestamp with time zone null default now(),
  shared_at timestamp with time zone null,
  expired_at timestamp with time zone null,
  absence_duration_hours numeric(5, 2) null,
  kayley_mood_when_generated text null,
  constraint idle_thoughts_pkey primary key (id),
  constraint idle_thoughts_thought_type_check check (
    (
      thought_type = any (
        array[
          'dream'::text,
          'memory'::text,
          'curiosity'::text,
          'anticipation'::text,
          'connection'::text,
          'random'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_idle_thoughts_recent on public.idle_thoughts using btree (generated_at desc) TABLESPACE pg_default
where
  (shared_at is null);