create table public.idle_action_log (
  id uuid not null default extensions.uuid_generate_v4 (),
  action_type text not null,
  run_date date not null,
  run_count integer not null default 0,
  last_run_at timestamp with time zone null default now(),
  constraint idle_action_log_pkey primary key (id),
  constraint idle_action_log_action_type_check check (
    action_type = any (array['storyline'::text, 'browse'::text, 'question'::text])
  ),
  constraint idle_action_log_unique unique (action_type, run_date)
) TABLESPACE pg_default;

create index IF not exists idx_idle_action_log_run_date on public.idle_action_log using btree (run_date desc) TABLESPACE pg_default;

create table public.idle_questions (
  id uuid not null default extensions.uuid_generate_v4 (),
  question text not null,
  status text not null default 'queued'::text,
  created_at timestamp with time zone null default now(),
  asked_at timestamp with time zone null,
  answered_at timestamp with time zone null,
  constraint idle_questions_pkey primary key (id),
  constraint idle_questions_status_check check (
    status = any (array['queued'::text, 'asked'::text, 'answered'::text])
  ),
  constraint idle_questions_unique unique (question)
) TABLESPACE pg_default;

create index IF not exists idx_idle_questions_status on public.idle_questions using btree (status, created_at desc) TABLESPACE pg_default;

create table public.idle_browse_notes (
  id uuid not null default extensions.uuid_generate_v4 (),
  topic text not null,
  summary text not null,
  created_at timestamp with time zone null default now(),
  constraint idle_browse_notes_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists idx_idle_browse_notes_created_at on public.idle_browse_notes using btree (created_at desc) TABLESPACE pg_default;

alter table public.idle_browse_notes
  add column status text not null default 'queued'::text;

alter table public.idle_browse_notes
  add constraint idle_browse_notes_status_check
  check (status = any (array['queued'::text, 'shared'::text]));

create index IF not exists idx_idle_browse_notes_status
  on public.idle_browse_notes using btree (status, created_at desc) TABLESPACE pg_default;

alter table public.idle_browse_notes
  add column item_title text null,
  add column item_url text null;

create index IF not exists idx_idle_browse_notes_item_url
  on public.idle_browse_notes using btree (item_url) TABLESPACE pg_default;

alter table public.idle_questions
  add column answer_text text null;

create index IF not exists idx_idle_questions_answered
  on public.idle_questions using btree (status, answered_at desc) TABLESPACE pg_default;
