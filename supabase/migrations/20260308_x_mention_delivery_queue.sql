alter table public.x_mentions
  add column if not exists announcement_text text null,
  add column if not exists announcement_created_at timestamp with time zone null,
  add column if not exists telegram_sent_at timestamp with time zone null,
  add column if not exists whatsapp_sent_at timestamp with time zone null,
  add column if not exists history_logged_at timestamp with time zone null;

create index if not exists idx_x_mentions_whatsapp_queue
  on public.x_mentions (announcement_created_at asc)
  where announcement_created_at is not null and whatsapp_sent_at is null;

