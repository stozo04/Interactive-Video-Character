-- Create life_storylines table for Life Event Storylines feature
-- Based on docs/features/Life_Event_Storylines.md
-- Phase 1: Data Foundation

create table if not exists life_storylines (
  id uuid primary key default gen_random_uuid(),

  -- Core identity
  title text not null,
  category text not null check (category in ('work', 'personal', 'family', 'social', 'creative')),
  storyline_type text not null check (storyline_type in ('project', 'opportunity', 'challenge', 'relationship', 'goal')),

  -- Current state
  phase text not null default 'announced' check (phase in ('announced', 'honeymoon', 'reality', 'active', 'climax', 'resolving', 'resolved', 'reflecting')),
  phase_started_at timestamptz not null default now(),

  -- Emotional texture
  current_emotional_tone text,
  emotional_intensity float not null default 0.7 check (emotional_intensity >= 0 and emotional_intensity <= 1),

  -- Outcome tracking
  outcome text check (outcome in ('success', 'failure', 'abandoned', 'transformed', 'ongoing') or outcome is null),
  outcome_description text,
  resolution_emotion text,

  -- Mention tracking
  times_mentioned integer not null default 0,
  last_mentioned_at timestamptz,
  should_mention_by timestamptz,

  -- Lifecycle
  created_at timestamptz not null default now(),
  resolved_at timestamptz,

  -- Metadata
  initial_announcement text,
  stakes text,
  user_involvement text
);

-- Indexes for active storylines
create index if not exists idx_storylines_active on life_storylines(phase) where outcome is null;
create index if not exists idx_storylines_mention on life_storylines(should_mention_by) where outcome is null;
create index if not exists idx_storylines_created_at on life_storylines(created_at desc);
