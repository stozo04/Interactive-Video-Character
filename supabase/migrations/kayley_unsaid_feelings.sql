create table public.kayley_unsaid_feelings (
  id uuid not null default gen_random_uuid (),
  feeling_type text not null,
  unsaid_content text not null,
  partial_expressions text[] null,
  intensity numeric(3, 2) null default 0.3,
  suppression_count integer null default 0,
  current_stage text null default 'micro_hint'::text,
  last_almost_moment_at timestamp without time zone null,
  created_at timestamp without time zone null default now(),
  resolved_at timestamp without time zone null,
  constraint kayley_unsaid_feelings_pkey primary key (id),
  constraint valid_intensity check (
    (
      (intensity >= (0)::numeric)
      and (intensity <= (1)::numeric)
    )
  )
) TABLESPACE pg_default;