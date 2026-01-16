-- Create storyline_updates table for Life Event Storylines feature
-- Based on docs/features/Life_Event_Storylines.md
-- Phase 1: Data Foundation

create table if not exists storyline_updates (
  id uuid primary key default gen_random_uuid(),
  storyline_id uuid not null references life_storylines(id) on delete cascade,

  -- Update content
  update_type text not null check (update_type in (
    'initial_reaction', 'processing', 'daydreaming', 'planning', 'anticipation',
    'challenge', 'complication', 'doubt', 'realization', 'progress', 'setback',
    'milestone', 'mood_shift', 'decision_point', 'final_push', 'moment_of_truth',
    'outcome_reaction', 'emotional_processing', 'meaning_making', 'reflection',
    'lesson_learned', 'gratitude', 'anniversary', 'callback', 'comparison'
  )),
  content text not null,
  emotional_tone text,

  -- Tracking
  mentioned boolean not null default false,
  mentioned_at timestamptz,

  created_at timestamptz not null default now()
);

-- Indexes for unmentioned updates
create index if not exists idx_updates_storyline on storyline_updates(storyline_id);
create index if not exists idx_updates_unmentioned on storyline_updates(storyline_id, mentioned) where mentioned = false;
create index if not exists idx_updates_created_at on storyline_updates(created_at desc);
