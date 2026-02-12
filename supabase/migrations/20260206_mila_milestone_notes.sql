create table public.mila_milestone_notes (
  id uuid not null default extensions.uuid_generate_v4 (),
  note_entry_date date not null,
  note text not null default '',
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint mila_milestone_notes_pkey primary key (id),
  constraint mila_milestone_notes_date_unique unique (note_entry_date)
) TABLESPACE pg_default;

create index if not exists idx_mila_milestone_notes_date
  on public.mila_milestone_notes (note_entry_date) TABLESPACE pg_default;

create trigger trigger_mila_milestone_notes_updated_at BEFORE
update on mila_milestone_notes for EACH row
execute FUNCTION update_updated_at_column ();
