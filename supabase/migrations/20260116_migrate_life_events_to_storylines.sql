-- Migrate existing life_events to life_storylines
-- Based on docs/features/Life_Event_Storylines.md (Migration section)
-- Phase 1: Data Foundation
-- NOTE: Run this AFTER creating life_storylines and storyline_updates tables

-- Migrate existing life_events to life_storylines
insert into life_storylines (
  title,
  category,
  storyline_type,
  phase,
  current_emotional_tone,
  emotional_intensity,
  initial_announcement,
  created_at
)
select
  description as title,
  category,
  'project' as storyline_type,  -- Default type for all migrated events
  case
    when created_at > now() - interval '3 days' then 'announced'
    when created_at > now() - interval '7 days' then 'honeymoon'
    else 'active'
  end as phase,
  'neutral' as current_emotional_tone,
  intensity as emotional_intensity,
  description as initial_announcement,
  created_at
from life_events
where not exists (
  -- Avoid duplicate migration if run multiple times
  select 1 from life_storylines where title = life_events.description
);

-- Note: life_events table will remain for backward compatibility
-- It will be deprecated and removed in a future migration after verification period
