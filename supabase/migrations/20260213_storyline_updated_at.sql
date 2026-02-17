-- Add updated_at column to life_storylines for accurate recency scoring.
-- Backfill existing rows with created_at so they have a valid timestamp.

alter table public.life_storylines
  add column if not exists updated_at timestamptz not null default now();

-- Backfill BEFORE creating the trigger, so it doesn't overwrite with now()
update public.life_storylines
  set updated_at = created_at;

-- Auto-update updated_at on row change (must come AFTER backfill)
create trigger update_life_storylines_updated_at
  before update on public.life_storylines
  for each row
  execute function update_updated_at_column();
