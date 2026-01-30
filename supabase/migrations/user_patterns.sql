create table public.user_patterns (
  id uuid not null default gen_random_uuid (),
  pattern_type text not null,
  observation text not null,
  pattern_data jsonb null,
  frequency integer not null default 1,
  confidence numeric(3, 2) null default 0.50,
  first_observed timestamp with time zone not null default now(),
  last_observed timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  has_been_surfaced boolean not null default false,
  surface_count integer not null default 0,
  last_surfaced_at timestamp with time zone null,
  constraint user_patterns_pkey primary key (id),
  constraint user_patterns_pattern_type_check check (
    (
      pattern_type = any (
        array[
          'mood_time'::text,
          'topic_correlation'::text,
          'behavior'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_patterns_type on public.user_patterns using btree (pattern_type) TABLESPACE pg_default;

create index IF not exists idx_patterns_frequency on public.user_patterns using btree (frequency desc) TABLESPACE pg_default;

create index IF not exists idx_patterns_last_observed on public.user_patterns using btree (last_observed desc) TABLESPACE pg_default;