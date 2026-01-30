create table public.kayley_almost_moment_log (
  id uuid not null default gen_random_uuid (),
  unsaid_feeling_id uuid null,
  stage text not null,
  expression_used text null,
  conversation_context text null,
  occurred_at timestamp without time zone null default now(),
  constraint kayley_almost_moment_log_pkey primary key (id),
  constraint kayley_almost_moment_log_unsaid_feeling_id_fkey foreign KEY (unsaid_feeling_id) references kayley_unsaid_feelings (id)
) TABLESPACE pg_default;