alter table public.selfie_generation_history
  add column if not exists message_text text null,
  add column if not exists delivery_channel text null,
  add column if not exists delivery_status text not null default 'generated',
  add column if not exists delivered_at timestamp with time zone null,
  add column if not exists delivery_error text null;

alter table public.selfie_generation_history
  drop constraint if exists selfie_generation_history_delivery_status_check;

alter table public.selfie_generation_history
  add constraint selfie_generation_history_delivery_status_check
  check (delivery_status = any (array['generated'::text, 'delivered'::text, 'failed'::text]));

create index if not exists idx_selfie_generation_history_delivery_status
  on public.selfie_generation_history (delivery_status, delivered_at desc);

create table if not exists public.video_generation_history (
  id uuid not null default gen_random_uuid(),
  scene text not null,
  mood text null,
  message_text text null,
  video_url text not null,
  duration_seconds integer null,
  request_id text null,
  aspect_ratio text null,
  resolution text null,
  delivery_channel text null,
  delivery_status text not null default 'generated',
  delivered_at timestamp with time zone null,
  delivery_error text null,
  generated_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint video_generation_history_pkey primary key (id),
  constraint video_generation_history_delivery_status_check
    check (delivery_status = any (array['generated'::text, 'delivered'::text, 'failed'::text]))
);

create index if not exists idx_video_generation_history_delivery_status
  on public.video_generation_history (delivery_status, delivered_at desc);

create trigger trigger_video_generation_history_updated_at before update
on public.video_generation_history for each row
execute function update_updated_at_column();

create table if not exists public.voice_note_generation_history (
  id uuid not null default gen_random_uuid(),
  message_text text not null,
  provider text null,
  audio_mime_type text null,
  delivery_channel text null,
  delivery_status text not null default 'generated',
  delivered_at timestamp with time zone null,
  delivery_error text null,
  generated_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint voice_note_generation_history_pkey primary key (id),
  constraint voice_note_generation_history_delivery_status_check
    check (delivery_status = any (array['generated'::text, 'delivered'::text, 'failed'::text]))
);

create index if not exists idx_voice_note_generation_history_delivery_status
  on public.voice_note_generation_history (delivery_status, delivered_at desc);

create trigger trigger_voice_note_generation_history_updated_at before update
on public.voice_note_generation_history for each row
execute function update_updated_at_column();
