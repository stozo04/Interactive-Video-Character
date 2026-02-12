-- Phase 9: Add engagement metrics columns to x_tweet_drafts
alter table public.x_tweet_drafts
  add column if not exists like_count integer null default 0,
  add column if not exists repost_count integer null default 0,
  add column if not exists reply_count integer null default 0,
  add column if not exists impression_count integer null default 0,
  add column if not exists metrics_updated_at timestamp with time zone null;
