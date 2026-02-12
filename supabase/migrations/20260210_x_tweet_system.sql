-- X Tweet Posting System
-- Adds x_auth_tokens for OAuth 2.0 token storage
-- Adds x_tweet_drafts for tweet draft management
-- Updates idle_action_log to include 'x_post' action type

-- ============================================
-- 1. X Auth Tokens
-- ============================================

create table public.x_auth_tokens (
  id uuid not null default extensions.uuid_generate_v4 (),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamp with time zone not null,
  scope text not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint x_auth_tokens_pkey primary key (id)
) TABLESPACE pg_default;

-- ============================================
-- 2. X Tweet Drafts
-- ============================================

create table public.x_tweet_drafts (
  id uuid not null default extensions.uuid_generate_v4 (),
  tweet_text text not null,
  status text not null default 'pending_approval'::text,
  intent text null,
  reasoning text null,
  tweet_id text null,
  tweet_url text null,
  generation_context jsonb null,
  rejection_reason text null,
  error_message text null,
  posted_at timestamp with time zone null,
  created_at timestamp with time zone null default now(),
  constraint x_tweet_drafts_pkey primary key (id),
  constraint x_tweet_drafts_status_check check (
    status = any (array[
      'pending_approval'::text,
      'queued'::text,
      'posted'::text,
      'rejected'::text,
      'failed'::text
    ])
  )
) TABLESPACE pg_default;

create index if not exists idx_x_tweet_drafts_status
  on public.x_tweet_drafts using btree (status, created_at desc) TABLESPACE pg_default;

create index if not exists idx_x_tweet_drafts_created
  on public.x_tweet_drafts using btree (created_at desc) TABLESPACE pg_default;

-- ============================================
-- 3. Update idle_action_log to allow 'x_post'
-- ============================================

alter table public.idle_action_log
  drop constraint if exists idle_action_log_action_type_check;

alter table public.idle_action_log
  add constraint idle_action_log_action_type_check
  check (
    action_type = any (
      array['storyline'::text, 'browse'::text, 'question'::text, 'tool_discovery'::text, 'x_post'::text]
    )
  );
