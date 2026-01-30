create table public.kayley_narrative_arcs (
  id uuid not null default extensions.uuid_generate_v4 (),
  arc_key text not null,
  arc_title text not null,
  arc_type text not null,
  started_at timestamp with time zone null default now(),
  resolved_at timestamp with time zone null,
  resolution_summary text null,
  events jsonb null default '[]'::jsonb,
  mentioned_to_users text[] null default '{}'::text[],
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint kayley_narrative_arcs_pkey primary key (id),
  constraint kayley_narrative_arcs_arc_key_key unique (arc_key),
  constraint kayley_narrative_arcs_arc_type_check check (
    (
      arc_type = any (
        array[
          'ongoing'::text,
          'resolved'::text,
          'paused'::text,
          'abandoned'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_narrative_arcs_ongoing on public.kayley_narrative_arcs using btree (arc_type, started_at desc) TABLESPACE pg_default
where
  (arc_type = 'ongoing'::text);

create index IF not exists idx_narrative_arcs_users on public.kayley_narrative_arcs using gin (mentioned_to_users) TABLESPACE pg_default;

create index IF not exists idx_narrative_arcs_timeline on public.kayley_narrative_arcs using btree (started_at desc) TABLESPACE pg_default;

create trigger trigger_update_narrative_arcs_updated_at BEFORE
update on kayley_narrative_arcs for EACH row
execute FUNCTION update_narrative_arcs_updated_at ();