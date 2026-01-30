create table public.life_storylines (
  id uuid not null default gen_random_uuid (),
  title text not null,
  category text not null,
  storyline_type text not null,
  phase text not null default 'announced'::text,
  phase_started_at timestamp with time zone not null default now(),
  current_emotional_tone text null,
  emotional_intensity double precision not null default 0.7,
  outcome text null,
  outcome_description text null,
  resolution_emotion text null,
  times_mentioned integer not null default 0,
  last_mentioned_at timestamp with time zone null,
  should_mention_by timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone null,
  initial_announcement text null,
  stakes text null,
  user_involvement text null,
  constraint life_storylines_pkey primary key (id),
  constraint life_storylines_category_check check (
    (
      category = any (
        array[
          'work'::text,
          'personal'::text,
          'family'::text,
          'social'::text,
          'creative'::text
        ]
      )
    )
  ),
  constraint life_storylines_emotional_intensity_check check (
    (
      (emotional_intensity >= (0)::double precision)
      and (emotional_intensity <= (1)::double precision)
    )
  ),
  constraint life_storylines_outcome_check check (
    (
      (
        outcome = any (
          array[
            'success'::text,
            'failure'::text,
            'abandoned'::text,
            'transformed'::text,
            'ongoing'::text
          ]
        )
      )
      or (outcome is null)
    )
  ),
  constraint life_storylines_phase_check check (
    (
      phase = any (
        array[
          'announced'::text,
          'honeymoon'::text,
          'reality'::text,
          'active'::text,
          'climax'::text,
          'resolving'::text,
          'resolved'::text,
          'reflecting'::text
        ]
      )
    )
  ),
  constraint life_storylines_storyline_type_check check (
    (
      storyline_type = any (
        array[
          'project'::text,
          'opportunity'::text,
          'challenge'::text,
          'relationship'::text,
          'goal'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_storylines_active on public.life_storylines using btree (phase) TABLESPACE pg_default
where
  (outcome is null);

create index IF not exists idx_storylines_mention on public.life_storylines using btree (should_mention_by) TABLESPACE pg_default
where
  (outcome is null);

create index IF not exists idx_storylines_created_at on public.life_storylines using btree (created_at desc) TABLESPACE pg_default;