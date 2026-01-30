create table public.kayley_experiences (
  id uuid not null default gen_random_uuid (),
  experience_type text not null,
  content text not null,
  mood text null,
  created_at timestamp with time zone not null default now(),
  surfaced_at timestamp with time zone null,
  conversation_context text null,
  metadata jsonb null default '{}'::jsonb,
  constraint kayley_experiences_pkey primary key (id),
  constraint kayley_experiences_experience_type_check check (
    (
      experience_type = any (
        array[
          'activity'::text,
          'thought'::text,
          'mood'::text,
          'discovery'::text,
          'mishap'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;