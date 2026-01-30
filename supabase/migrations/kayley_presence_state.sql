create table public.kayley_presence_state (
  id uuid not null default gen_random_uuid (),
  current_outfit text null,
  current_mood text null,
  current_activity text null,
  current_location text null,
  last_mentioned_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone null,
  confidence real null default 1.0,
  source_message_id text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint kayley_presence_state_pkey primary key (id),
  constraint kayley_presence_state_confidence_check check (
    (
      (confidence >= (0)::double precision)
      and (confidence <= (1)::double precision)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_kps_expires_last on public.kayley_presence_state using btree (
  expires_at,
  last_mentioned_at desc,
  created_at desc
) TABLESPACE pg_default;

create index IF not exists idx_kayley_presence_expires on public.kayley_presence_state using btree (expires_at) TABLESPACE pg_default
where
  (expires_at is not null);

create trigger trigger_kayley_presence_updated_at BEFORE
update on kayley_presence_state for EACH row
execute FUNCTION update_updated_at_column ();