create table public.mood_states (
  id uuid not null default gen_random_uuid (),
  daily_energy numeric(3, 2) not null default 0.7,
  social_battery numeric(3, 2) not null default 1.0,
  internal_processing boolean not null default false,
  daily_seed integer not null default 0,
  last_interaction_at timestamp with time zone null,
  last_interaction_tone numeric(3, 2) null default 0.0,
  calculated_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint mood_states_pkey primary key (id),
  constraint mood_states_daily_energy_check check (
    (
      (daily_energy >= (0)::numeric)
      and (daily_energy <= (1)::numeric)
    )
  ),
  constraint mood_states_last_interaction_tone_check check (
    (
      (last_interaction_tone >= ('-1'::integer)::numeric)
      and (last_interaction_tone <= (1)::numeric)
    )
  ),
  constraint mood_states_social_battery_check check (
    (
      (social_battery >= (0)::numeric)
      and (social_battery <= (1)::numeric)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_mood_states_updated on public.mood_states using btree (updated_at) TABLESPACE pg_default;

create trigger trigger_mood_states_updated_at BEFORE
update on mood_states for EACH row
execute FUNCTION update_updated_at_column ();