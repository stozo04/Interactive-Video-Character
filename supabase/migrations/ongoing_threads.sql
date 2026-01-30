create table public.ongoing_threads (
  id text not null,
  theme text not null,
  current_state text not null,
  intensity numeric(3, 2) not null default 0.5,
  last_mentioned timestamp with time zone null,
  user_related boolean not null default false,
  user_trigger text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint ongoing_threads_pkey primary key (id),
  constraint ongoing_threads_intensity_check check (
    (
      (intensity >= (0)::numeric)
      and (intensity <= (1)::numeric)
    )
  ),
  constraint ongoing_threads_theme_check check (
    (
      theme = any (
        array[
          'creative_project'::text,
          'family'::text,
          'self_improvement'::text,
          'social'::text,
          'work'::text,
          'existential'::text,
          'user_reflection'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create trigger trigger_ongoing_threads_updated_at BEFORE
update on ongoing_threads for EACH row
execute FUNCTION update_updated_at_column ();