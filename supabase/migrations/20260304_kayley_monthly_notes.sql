create table public.kayley_monthly_notes (
  id uuid not null default extensions.uuid_generate_v4 (),
  month_key text not null,
  notes text not null default '',
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint kayley_monthly_notes_pkey primary key (id),
  constraint kayley_monthly_notes_month_unique unique (month_key)
) TABLESPACE pg_default;

create index IF not exists idx_kayley_monthly_notes_month on public.kayley_monthly_notes (month_key) TABLESPACE pg_default;

create trigger trigger_kayley_monthly_notes_updated_at BEFORE
update on kayley_monthly_notes for EACH row
execute FUNCTION update_updated_at_column ();
