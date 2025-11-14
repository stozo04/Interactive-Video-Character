-- relationship_insights.sql

CREATE TABLE IF NOT EXISTS public.relationship_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → character_relationships.id
  relationship_id uuid NOT NULL,
  insight_type text NOT NULL CHECK (insight_type IN ('pattern', 'milestone', 'trigger')),

  key text NOT NULL,
  summary text NOT NULL,

  confidence numeric(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  times_observed integer NOT NULL DEFAULT 0 CHECK (times_observed >= 0),

  last_observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT relationship_insights_relationship_fk
    FOREIGN KEY (relationship_id)
    REFERENCES public.character_relationships (id)
    ON DELETE CASCADE,

  CONSTRAINT relationship_insights_unique_key_per_relationship
    UNIQUE (relationship_id, key)
);
