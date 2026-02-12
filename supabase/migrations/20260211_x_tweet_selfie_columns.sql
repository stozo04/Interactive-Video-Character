-- Phase 7: Add selfie attachment columns to x_tweet_drafts
alter table public.x_tweet_drafts
  add column if not exists include_selfie boolean not null default false,
  add column if not exists selfie_scene text null,
  add column if not exists media_id text null;
