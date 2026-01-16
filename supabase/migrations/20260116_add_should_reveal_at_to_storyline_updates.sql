-- Add reveal scheduling for storyline updates (Phase 5 pacing)
-- Allows closure updates to surface one per day

alter table if exists storyline_updates
  add column if not exists should_reveal_at timestamptz;

-- Default to immediate reveal for existing behavior
alter table if exists storyline_updates
  alter column should_reveal_at set default now();

create index if not exists idx_updates_should_reveal_at
  on storyline_updates(should_reveal_at);
