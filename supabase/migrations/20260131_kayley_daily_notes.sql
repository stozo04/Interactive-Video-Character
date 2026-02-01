create table public.kayley_daily_notes (
  id uuid not null default extensions.uuid_generate_v4 (),
  note_date_cst date not null,
  notes text not null default '',
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint kayley_daily_notes_pkey primary key (id),
  constraint kayley_daily_notes_date_unique unique (note_date_cst)
) TABLESPACE pg_default;

create index IF not exists idx_kayley_daily_notes_date on public.kayley_daily_notes (note_date_cst) TABLESPACE pg_default;

create trigger trigger_kayley_daily_notes_updated_at BEFORE
update on kayley_daily_notes for EACH row
execute FUNCTION update_updated_at_column ();
