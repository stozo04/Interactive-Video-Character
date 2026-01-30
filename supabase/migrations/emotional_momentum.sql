create table public.emotional_momentum (
  id uuid not null default gen_random_uuid (),
  current_mood_level numeric(3, 2) not null default 0.0,
  momentum_direction numeric(3, 2) not null default 0.0,
  positive_interaction_streak integer not null default 0,
  recent_interaction_tones jsonb not null default '[]'::jsonb,
  genuine_moment_detected boolean not null default false,
  last_genuine_moment_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint emotional_momentum_pkey primary key (id),
  constraint emotional_momentum_current_mood_level_check check (
    (
      (current_mood_level >= ('-1'::integer)::numeric)
      and (current_mood_level <= (1)::numeric)
    )
  ),
  constraint emotional_momentum_momentum_direction_check check (
    (
      (momentum_direction >= ('-1'::integer)::numeric)
      and (momentum_direction <= (1)::numeric)
    )
  ),
  constraint emotional_momentum_positive_interaction_streak_check check ((positive_interaction_streak >= 0))
) TABLESPACE pg_default;

create trigger trigger_emotional_momentum_updated_at BEFORE
update on emotional_momentum for EACH row
execute FUNCTION update_updated_at_column ();