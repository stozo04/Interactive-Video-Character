create table public.kayley_lessons_learned (
  id uuid not null default extensions.uuid_generate_v4 (),
  lesson_date_cst date not null,
  lessons text not null default '',
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint kayley_lessons_learned_pkey primary key (id),
  constraint kayley_lessons_learned_date_unique unique (lesson_date_cst)
) TABLESPACE pg_default;

create index IF not exists idx_kayley_lessons_learned_date
  on public.kayley_lessons_learned (lesson_date_cst) TABLESPACE pg_default;

create trigger trigger_kayley_lessons_learned_updated_at BEFORE
update on kayley_lessons_learned for EACH row
execute FUNCTION update_updated_at_column ();
