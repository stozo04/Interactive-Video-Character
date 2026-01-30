create table public.pending_messages (
  id uuid not null default gen_random_uuid (),
  message_text text not null,
  message_type text not null default 'text'::text,
  trigger text not null,
  trigger_event_id text null,
  trigger_event_title text null,
  priority text not null default 'normal'::text,
  created_at timestamp with time zone not null default now(),
  delivered_at timestamp with time zone null,
  metadata jsonb null default '{}'::jsonb,
  selfie_url text null,
  constraint pending_messages_pkey primary key (id),
  constraint pending_messages_message_type_check check (
    (
      message_type = any (array['text'::text, 'photo'::text])
    )
  ),
  constraint pending_messages_priority_check check (
    (
      priority = any (array['low'::text, 'normal'::text, 'high'::text])
    )
  ),
  constraint pending_messages_trigger_check_v2 check (
    (
      trigger = any (
        array[
          'calendar'::text,
          'gift'::text,
          'urgent'::text,
          'promise'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;