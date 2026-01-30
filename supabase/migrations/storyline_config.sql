create table public.storyline_config (
  id integer not null,
  last_processed_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  last_storyline_created_at timestamp with time zone null,
  constraint storyline_config_pkey primary key (id),
  constraint storyline_config_id_check check ((id = 1))
) TABLESPACE pg_default;