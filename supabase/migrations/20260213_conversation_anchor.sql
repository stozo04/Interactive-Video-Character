-- Phase 1b: Conversation Working Memory Anchor
-- Creates table to store turn-local conversation state for long-thread continuity

create table public.conversation_anchor (
  id uuid not null default extensions.uuid_generate_v4(),
  interaction_id text not null,
  schema_version integer not null default 1,
  anchor_summary text not null default '',
  unresolved_asks jsonb not null default '[]'::jsonb,
  active_emotional_context text not null default '',
  pending_commitments jsonb not null default '[]'::jsonb,
  last_user_message text not null default '',
  last_turn_index integer not null default 0,
  last_topic_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_anchor_pkey primary key (id),
  constraint conversation_anchor_interaction_id_unique unique (interaction_id)
);

-- Indexes for efficient lookups
create index if not exists idx_conversation_anchor_interaction_id
  on public.conversation_anchor using btree (interaction_id);

create index if not exists idx_conversation_anchor_updated_at
  on public.conversation_anchor using btree (updated_at desc);

-- Auto-update updated_at on row changes
create trigger update_conversation_anchor_updated_at
  before update on public.conversation_anchor
  for each row
  execute function update_updated_at_column();
