create table public.storyline_updates (
  id uuid not null default gen_random_uuid (),
  storyline_id uuid not null,
  update_type text not null,
  content text not null,
  emotional_tone text null,
  mentioned boolean not null default false,
  mentioned_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  should_reveal_at timestamp with time zone null default now(),
  constraint storyline_updates_pkey primary key (id),
  constraint storyline_updates_storyline_id_fkey foreign KEY (storyline_id) references life_storylines (id) on delete CASCADE,
  constraint storyline_updates_update_type_check check (
    (
      update_type = any (
        array[
          'initial_reaction'::text,
          'processing'::text,
          'daydreaming'::text,
          'planning'::text,
          'anticipation'::text,
          'challenge'::text,
          'complication'::text,
          'doubt'::text,
          'realization'::text,
          'progress'::text,
          'setback'::text,
          'milestone'::text,
          'mood_shift'::text,
          'decision_point'::text,
          'final_push'::text,
          'moment_of_truth'::text,
          'outcome_reaction'::text,
          'emotional_processing'::text,
          'meaning_making'::text,
          'reflection'::text,
          'lesson_learned'::text,
          'gratitude'::text,
          'anniversary'::text,
          'callback'::text,
          'comparison'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_updates_storyline on public.storyline_updates using btree (storyline_id) TABLESPACE pg_default;

create index IF not exists idx_updates_unmentioned on public.storyline_updates using btree (storyline_id, mentioned) TABLESPACE pg_default
where
  (mentioned = false);

create index IF not exists idx_updates_created_at on public.storyline_updates using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_updates_should_reveal_at on public.storyline_updates using btree (should_reveal_at) TABLESPACE pg_default;