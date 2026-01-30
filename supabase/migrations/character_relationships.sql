create table public.character_relationships (
  id uuid not null default gen_random_uuid (),
  relationship_score numeric(6, 2) not null default 0.0,
  relationship_tier text not null default 'acquaintance'::text,
  warmth_score numeric(5, 2) not null default 0.0,
  trust_score numeric(5, 2) not null default 0.0,
  playfulness_score numeric(5, 2) not null default 0.0,
  stability_score numeric(5, 2) not null default 0.0,
  familiarity_stage text not null default 'early'::text,
  total_interactions integer not null default 0,
  positive_interactions integer not null default 0,
  negative_interactions integer not null default 0,
  first_interaction_at timestamp with time zone null,
  last_interaction_at timestamp with time zone null,
  is_ruptured boolean not null default false,
  last_rupture_at timestamp with time zone null,
  rupture_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint character_relationships_pkey primary key (id),
  constraint character_relationships_negative_interactions_check check ((negative_interactions >= 0)),
  constraint character_relationships_playfulness_score_check check (
    (
      (playfulness_score >= ('-50'::integer)::numeric)
      and (playfulness_score <= (50)::numeric)
    )
  ),
  constraint character_relationships_positive_interactions_check check ((positive_interactions >= 0)),
  constraint character_relationships_relationship_score_check check (
    (
      (relationship_score >= ('-100'::integer)::numeric)
      and (relationship_score <= (100)::numeric)
    )
  ),
  constraint character_relationships_relationship_tier_check check (
    (
      relationship_tier = any (
        array[
          'adversarial'::text,
          'neutral_negative'::text,
          'acquaintance'::text,
          'friend'::text,
          'close_friend'::text,
          'deeply_loving'::text
        ]
      )
    )
  ),
  constraint character_relationships_rupture_count_check check ((rupture_count >= 0)),
  constraint character_relationships_stability_score_check check (
    (
      (stability_score >= ('-50'::integer)::numeric)
      and (stability_score <= (50)::numeric)
    )
  ),
  constraint character_relationships_total_interactions_check check ((total_interactions >= 0)),
  constraint character_relationships_trust_score_check check (
    (
      (trust_score >= ('-50'::integer)::numeric)
      and (trust_score <= (50)::numeric)
    )
  ),
  constraint character_relationships_warmth_score_check check (
    (
      (warmth_score >= ('-50'::integer)::numeric)
      and (warmth_score <= (50)::numeric)
    )
  ),
  constraint character_relationships_familiarity_stage_check check (
    (
      familiarity_stage = any (
        array[
          'early'::text,
          'developing'::text,
          'established'::text
        ]
      )
    )
  ),
  constraint check_interaction_counts check (
    (
      (positive_interactions + negative_interactions) <= total_interactions
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_character_relationships_score on public.character_relationships using btree (relationship_score) TABLESPACE pg_default;

create index IF not exists idx_character_relationships_tier on public.character_relationships using btree (relationship_tier) TABLESPACE pg_default;

create index IF not exists idx_character_relationships_last_interaction on public.character_relationships using btree (last_interaction_at) TABLESPACE pg_default;

create trigger trigger_update_relationship_tier BEFORE INSERT
or
update OF relationship_score on character_relationships for EACH row
execute FUNCTION update_relationship_tier ();

create trigger trigger_update_familiarity_stage BEFORE INSERT
or
update OF total_interactions,
first_interaction_at on character_relationships for EACH row
execute FUNCTION update_familiarity_stage ();

create trigger trigger_update_relationship_updated_at BEFORE
update on character_relationships for EACH row
execute FUNCTION update_relationship_updated_at ();