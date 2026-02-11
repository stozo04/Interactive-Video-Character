-- Phase 10: Create x_mentions table for tracking @mentions and replies
create table if not exists public.x_mentions (
  id uuid not null default extensions.uuid_generate_v4(),
  tweet_id text not null unique,
  author_id text not null,
  author_username text not null,
  text text not null,
  conversation_id text null,
  in_reply_to_tweet_id text null,
  status text not null default 'pending' check (status in ('pending', 'reply_drafted', 'replied', 'ignored', 'skipped')),
  reply_text text null,
  reply_tweet_id text null,
  is_known_user boolean not null default false,
  created_at timestamp with time zone not null default now(),
  replied_at timestamp with time zone null,
  constraint x_mentions_pkey primary key (id)
);

-- Index for polling (fetch unprocessed mentions)
create index if not exists idx_x_mentions_status on public.x_mentions (status);

-- Index for dedup check
create index if not exists idx_x_mentions_tweet_id on public.x_mentions (tweet_id);

-- RLS
alter table public.x_mentions enable row level security;
create policy "Allow all for authenticated users"
  on public.x_mentions for all
  using (true)
  with check (true);
