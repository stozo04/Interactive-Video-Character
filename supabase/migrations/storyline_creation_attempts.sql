create table public.storyline_creation_attempts (
  id uuid not null default gen_random_uuid (),
  attempted_at timestamp with time zone not null default now(),
  title text not null,
  category text not null,
  storyline_type text null,
  success boolean not null,
  failure_reason text null,
  cooldown_hours_remaining integer null,
  duplicate_match text null,
  active_storyline_blocking uuid null,
  source text not null default 'conversation'::text,
  constraint storyline_creation_attempts_pkey primary key (id),
  constraint storyline_creation_attempts_active_storyline_blocking_fkey foreign KEY (active_storyline_blocking) references life_storylines (id)
) TABLESPACE pg_default;

create index IF not exists idx_storyline_attempts_time on public.storyline_creation_attempts using btree (attempted_at desc) TABLESPACE pg_default;

create index IF not exists idx_storyline_attempts_success on public.storyline_creation_attempts using btree (success) TABLESPACE pg_default;

create index IF not exists idx_storyline_attempts_failure on public.storyline_creation_attempts using btree (failure_reason) TABLESPACE pg_default
where
  (success = false);