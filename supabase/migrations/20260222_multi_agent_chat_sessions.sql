-- Multi-agent chat sessions (Phase 11 stretch).

create table if not exists public.engineering_chat_sessions (
  id text not null,
  title text not null default '',
  mode text not null check (mode in ('direct_agent', 'team_room')),
  ticket_id text null,
  status text not null default 'open',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engineering_chat_sessions_pkey primary key (id),
  constraint engineering_chat_sessions_ticket_id_fkey
    foreign key (ticket_id)
    references public.engineering_tickets(id)
    on delete set null
);

create table if not exists public.engineering_chat_messages (
  id text not null,
  session_id text not null,
  role text not null check (role in ('human', 'system', 'kera', 'opey', 'claudy')),
  message_text text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint engineering_chat_messages_pkey primary key (id),
  constraint engineering_chat_messages_session_id_fkey
    foreign key (session_id)
    references public.engineering_chat_sessions(id)
    on delete cascade
);

create index if not exists idx_engineering_chat_sessions_created_at
  on public.engineering_chat_sessions using btree (created_at desc);

create index if not exists idx_engineering_chat_messages_session_id_created_at
  on public.engineering_chat_messages using btree (session_id, created_at desc);

drop trigger if exists update_engineering_chat_sessions_updated_at on public.engineering_chat_sessions;
create trigger update_engineering_chat_sessions_updated_at
  before update on public.engineering_chat_sessions
  for each row
  execute function update_updated_at_column();
