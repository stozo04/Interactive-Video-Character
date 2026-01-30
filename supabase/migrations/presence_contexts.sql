create table public.presence_contexts (
  id uuid not null default gen_random_uuid (),
  loop_type text not null,
  topic text not null,
  trigger_context text null,
  suggested_followup text null,
  created_at timestamp with time zone not null default now(),
  should_surface_after timestamp with time zone null,
  last_surfaced_at timestamp with time zone null,
  expires_at timestamp with time zone null,
  status text not null default 'active'::text,
  salience real not null default 0.5,
  surface_count integer not null default 0,
  max_surfaces integer not null default 2,
  source_message_id uuid null,
  source_calendar_event_id text null,
  event_datetime timestamp with time zone null,
  constraint presence_contexts_pkey primary key (id),
  constraint presence_contexts_loop_type_check check (
    (
      loop_type = any (
        array[
          'pending_event'::text,
          'emotional_followup'::text,
          'commitment_check'::text,
          'curiosity_thread'::text,
          'pattern_observation'::text
        ]
      )
    )
  ),
  constraint presence_contexts_salience_check check (
    (
      (salience >= (0)::double precision)
      and (salience <= (1)::double precision)
    )
  ),
  constraint presence_contexts_status_check check (
    (
      status = any (
        array[
          'active'::text,
          'surfaced'::text,
          'resolved'::text,
          'expired'::text,
          'dismissed'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_presence_contexts_status on public.presence_contexts using btree (status) TABLESPACE pg_default;

create index IF not exists idx_presence_contexts_expires on public.presence_contexts using btree (expires_at) TABLESPACE pg_default
where
  (expires_at is not null);

create index IF not exists idx_presence_contexts_event_datetime on public.presence_contexts using btree (event_datetime) TABLESPACE pg_default
where
  (event_datetime is not null);