create table public.intimacy_states (
  id uuid not null default gen_random_uuid (),
  recent_tone_modifier numeric(3, 2) not null default 0.0,
  vulnerability_exchange_active boolean not null default false,
  last_vulnerability_at timestamp with time zone null,
  low_effort_streak integer not null default 0,
  recent_quality numeric(3, 2) not null default 0.5,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint intimacy_states_pkey primary key (id),
  constraint intimacy_states_low_effort_streak_check check ((low_effort_streak >= 0)),
  constraint intimacy_states_recent_quality_check check (
    (
      (recent_quality >= (0)::numeric)
      and (recent_quality <= (1)::numeric)
    )
  ),
  constraint intimacy_states_recent_tone_modifier_check check (
    (
      (recent_tone_modifier >= '-0.5'::numeric)
      and (recent_tone_modifier <= 0.5)
    )
  )
) TABLESPACE pg_default;

create trigger trigger_intimacy_states_updated_at BEFORE
update on intimacy_states for EACH row
execute FUNCTION update_updated_at_column ();