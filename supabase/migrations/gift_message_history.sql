create table public.gift_message_history (
  id uuid not null default gen_random_uuid (),
  gift_type text not null,
  message_text text not null,
  selfie_url text null,
  sent_at timestamp with time zone not null default now(),
  constraint gift_message_history_pkey primary key (id),
  constraint gift_message_history_gift_type_check check (
    (
      gift_type = any (array['selfie'::text, 'thought'::text])
    )
  )
) TABLESPACE pg_default;