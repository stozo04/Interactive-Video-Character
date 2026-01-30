create table public.relationship_milestones (
  id uuid not null default gen_random_uuid (),
  milestone_type text not null,
  description text not null,
  trigger_context text null,
  occurred_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  has_been_referenced boolean not null default false,
  reference_count integer not null default 0,
  last_referenced_at timestamp with time zone null,
  constraint relationship_milestones_pkey primary key (id),
  constraint relationship_milestones_milestone_type_check check (
    (
      milestone_type = any (
        array[
          'first_vulnerability'::text,
          'first_joke'::text,
          'first_support'::text,
          'first_deep_talk'::text,
          'first_return'::text,
          'breakthrough_moment'::text,
          'anniversary_week'::text,
          'anniversary_month'::text,
          'interaction_50'::text,
          'interaction_100'::text,
          'confirmed_dating'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_milestones_type on public.relationship_milestones using btree (milestone_type) TABLESPACE pg_default;

create index IF not exists idx_milestones_occurred on public.relationship_milestones using btree (occurred_at) TABLESPACE pg_default;