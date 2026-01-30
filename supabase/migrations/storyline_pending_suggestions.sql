create table public.storyline_pending_suggestions (
  id uuid not null default gen_random_uuid (),
  category text not null,
  theme text not null,
  reasoning text not null,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  surfaced boolean not null default false,
  surfaced_at timestamp with time zone null,
  was_created boolean not null default false,
  storyline_id uuid null,
  rejected_reason text null,
  constraint storyline_pending_suggestions_pkey primary key (id),
  constraint storyline_pending_suggestions_storyline_id_fkey foreign KEY (storyline_id) references life_storylines (id),
  constraint storyline_pending_suggestions_category_check check (
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
  )
) TABLESPACE pg_default;

create index IF not exists idx_pending_suggestions_active on public.storyline_pending_suggestions using btree (created_at desc) TABLESPACE pg_default
where
  (surfaced = false);

create index IF not exists idx_pending_suggestions_category on public.storyline_pending_suggestions using btree (category) TABLESPACE pg_default;

create index IF not exists idx_pending_suggestions_expires on public.storyline_pending_suggestions using btree (expires_at) TABLESPACE pg_default;