create table public.current_look_state (
  id uuid not null default gen_random_uuid (),
  hairstyle text not null,
  reference_image_id text not null,
  locked_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  lock_reason text not null,
  is_current_look boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint current_look_state_pkey primary key (id),
  constraint current_look_state_hairstyle_check check (
    (
      hairstyle = any (
        array[
          'curly'::text,
          'straight'::text,
          'messy_bun'::text,
          'waves'::text,
          'ponytail'::text,
          'headband'::text,
          'claw_clip'::text,
          'half_up'::text,
          'heatless_curls'::text,
          'dutch_braid'::text,
          'styled_bun'::text
        ]
      )
    )
  ),
  constraint current_look_state_lock_reason_check check (
    (
      lock_reason = any (
        array[
          'session_start'::text,
          'first_selfie_of_day'::text,
          'explicit_now_selfie'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create unique INDEX IF not exists one_current_look on public.current_look_state using btree (is_current_look) TABLESPACE pg_default
where
  (is_current_look = true);

create index IF not exists idx_current_look_expires on public.current_look_state using btree (expires_at) TABLESPACE pg_default;

create trigger trigger_current_look_updated_at BEFORE
update on current_look_state for EACH row
execute FUNCTION update_updated_at_column ();