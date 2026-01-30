create table public.relationship_events (
  id uuid not null default gen_random_uuid (),
  relationship_id uuid not null,
  event_type text not null,
  source text not null,
  sentiment_toward_character text null,
  sentiment_intensity integer null,
  user_mood text null,
  score_change numeric(5, 2) not null default 0.0,
  warmth_change numeric(5, 2) not null default 0.0,
  trust_change numeric(5, 2) not null default 0.0,
  playfulness_change numeric(5, 2) not null default 0.0,
  stability_change numeric(5, 2) not null default 0.0,
  previous_relationship_score numeric(6, 2) null,
  new_relationship_score numeric(6, 2) null,
  previous_tier text null,
  new_tier text null,
  user_message text null,
  notes text null,
  created_at timestamp with time zone not null default now(),
  constraint relationship_events_pkey primary key (id),
  constraint fk_events_relationship foreign KEY (relationship_id) references character_relationships (id) on delete CASCADE,
  constraint relationship_events_event_type_check check (
    (
      event_type = any (
        array[
          'positive'::text,
          'negative'::text,
          'neutral'::text,
          'milestone'::text,
          'rupture'::text,
          'repair'::text
        ]
      )
    )
  ),
  constraint relationship_events_sentiment_intensity_check check (
    (
      (sentiment_intensity >= 1)
      and (sentiment_intensity <= 10)
    )
  ),
  constraint relationship_events_sentiment_toward_character_check check (
    (
      sentiment_toward_character = any (
        array[
          'positive'::text,
          'neutral'::text,
          'negative'::text
        ]
      )
    )
  ),
  constraint relationship_events_source_check check (
    (
      source = any (
        array[
          'chat'::text,
          'video_request'::text,
          'system'::text,
          'milestone'::text,
          'decay'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_relationship_events_relationship on public.relationship_events using btree (relationship_id) TABLESPACE pg_default;

create index IF not exists idx_relationship_events_created_at on public.relationship_events using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_relationship_events_type on public.relationship_events using btree (event_type) TABLESPACE pg_default;

create index IF not exists idx_relationship_events_sentiment on public.relationship_events using btree (sentiment_toward_character) TABLESPACE pg_default;