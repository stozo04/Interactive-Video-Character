-- Phase 2B: Semantic Active Recall Embeddings
-- Stores source embeddings and provides semantic similarity lookup for active recall.

create extension if not exists vector;

create table if not exists public.fact_embeddings (
  id uuid not null default extensions.uuid_generate_v4(),
  source_type text not null,
  source_id text not null,
  source_key text not null,
  source_value text not null,
  source_updated_at timestamptz not null,
  confidence numeric not null default 0.6,
  pinned boolean not null default false,
  embedding_model text not null,
  embedding vector(768) not null,
  embedding_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fact_embeddings_pkey primary key (id),
  constraint fact_embeddings_source_type_check
    check (source_type in ('user_fact', 'character_fact', 'storyline')),
  constraint fact_embeddings_unique
    unique (source_type, source_id, embedding_model, embedding_version)
);

create index if not exists idx_fact_embeddings_source
  on public.fact_embeddings using btree (source_type, source_id);

create index if not exists idx_fact_embeddings_updated
  on public.fact_embeddings using btree (source_updated_at desc);

create index if not exists idx_fact_embeddings_vector
  on public.fact_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

drop trigger if exists update_fact_embeddings_updated_at on public.fact_embeddings;
create trigger update_fact_embeddings_updated_at
  before update on public.fact_embeddings
  for each row
  execute function update_updated_at_column();

drop function if exists public.match_fact_embeddings(vector, double precision, integer, text, integer);
create or replace function public.match_fact_embeddings(
  query_embedding vector(768),
  match_threshold double precision,
  match_count integer,
  embedding_model text,
  embedding_version integer
)
returns table (
  source_type text,
  source_id text,
  source_key text,
  source_value text,
  source_updated_at timestamptz,
  confidence numeric,
  pinned boolean,
  similarity double precision
)
language sql
stable
as $$
  select
    fe.source_type,
    fe.source_id,
    fe.source_key,
    fe.source_value,
    fe.source_updated_at,
    fe.confidence,
    fe.pinned,
    1 - (fe.embedding <=> query_embedding) as similarity
  from public.fact_embeddings fe
  where fe.embedding_model = match_fact_embeddings.embedding_model
    and fe.embedding_version = match_fact_embeddings.embedding_version
    and 1 - (fe.embedding <=> query_embedding) >= match_threshold
  order by similarity desc
  limit greatest(1, match_count);
$$;
