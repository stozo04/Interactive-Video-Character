alter table public.kayley_tool_suggestions
  add column if not exists theme text null,
  add column if not exists seed_id text null;

create index IF not exists idx_kayley_tool_suggestions_theme
  on public.kayley_tool_suggestions using btree (theme) TABLESPACE pg_default;

create index IF not exists idx_kayley_tool_suggestions_seed_id
  on public.kayley_tool_suggestions using btree (seed_id) TABLESPACE pg_default;
