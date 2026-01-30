create table public.character_facts (
  id uuid not null default extensions.uuid_generate_v4 (),
  character_id text not null default 'kayley'::text,
  category text not null,
  fact_key text not null,
  fact_value text not null,
  source_message_id uuid null,
  confidence numeric(3, 2) null default 1.0,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint character_facts_pkey primary key (id),
  constraint character_facts_character_id_category_fact_key_key unique (character_id, category, fact_key),
  constraint character_facts_source_message_id_fkey foreign KEY (source_message_id) references conversation_history (id) on delete set null,
  constraint character_facts_category_check check (
    (
      category = any (
        array[
          'quirk'::text,
          'relationship'::text,
          'experience'::text,
          'preference'::text,
          'detail'::text,
          'other'::text
        ]
      )
    )
  ),
  constraint character_facts_confidence_check check (
    (
      (confidence >= (0)::numeric)
      and (confidence <= (1)::numeric)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_character_facts_character_id on public.character_facts using btree (character_id) TABLESPACE pg_default;

create index IF not exists idx_character_facts_category on public.character_facts using btree (character_id, category) TABLESPACE pg_default;

create index IF not exists idx_character_facts_created_at on public.character_facts using btree (created_at desc) TABLESPACE pg_default;