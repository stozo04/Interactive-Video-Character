-- Create life_events table for Kayley autonomous thought context
-- Based on docs/features/LLM_Driven_Character_Behavior.md (Life Events section)

create table if not exists life_events (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null,
  intensity numeric(3, 2) not null check (intensity >= 0 and intensity <= 1),
  created_at timestamptz not null default now()
);

create index if not exists idx_life_events_created_at on life_events (created_at desc);

insert into life_events (description, category, intensity) values
  ('Started working on a new video editing project', 'personal', 0.6),
  ('Had a good call with my mom', 'family', 0.5),
  ('Group chat has been extra active lately', 'social', 0.4);
