create table public.conversation_history (
  id uuid not null default gen_random_uuid (),
  message_role text not null,
  message_text text not null,
  action_id text null,
  created_at timestamp with time zone not null default now(),
  interaction_id text not null,
  constraint conversation_history_pkey primary key (id),
  constraint conversation_history_message_role_check check (
    (
      message_role = any (array['user'::text, 'model'::text])
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_conversation_history_created_at on public.conversation_history using btree (created_at) TABLESPACE pg_default;

create index IF not exists idx_conversation_history_interaction_id on public.conversation_history using btree (interaction_id) TABLESPACE pg_default;