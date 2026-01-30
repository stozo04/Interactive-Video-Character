create table public.user_facts (
  id uuid not null default extensions.uuid_generate_v4 (),
  category text not null,
  fact_key text not null,
  fact_value text not null,
  source_message_id uuid null,
  confidence numeric(3, 2) null default 1.0,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint user_facts_pkey primary key (id),
  constraint user_facts_category_key_unique unique (category, fact_key),
  constraint user_facts_source_message_id_fkey foreign KEY (source_message_id) references conversation_history (id) on delete set null,
  constraint user_facts_category_check check (
    (
      category = any (
        array[
          'identity'::text,
          'preference'::text,
          'relationship'::text,
          'context'::text
        ]
      )
    )
  ),
  constraint user_facts_confidence_check check (
    (
      (confidence >= (0)::numeric)
      and (confidence <= (1)::numeric)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_user_facts_value_search on public.user_facts using gin (to_tsvector('english'::regconfig, fact_value)) TABLESPACE pg_default;

create trigger trigger_update_user_facts_updated_at BEFORE
update on user_facts for EACH row
execute FUNCTION update_user_facts_updated_at ();

create trigger trigger_user_facts_updated_at BEFORE
update on user_facts for EACH row
execute FUNCTION update_updated_at_column ();